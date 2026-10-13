/* FlyJack - the fly's learning circuit.
 *
 * WHAT IS REAL (measured in the MaleCNS v1.0 connectome, see tools/build_circuit.py)
 *   - which projection neuron (PN) connects to which Kenyon cell (KC), and with how many synapses
 *   - which KC connects to which mushroom body output neuron (MBON), and with how many synapses
 *   - each MBON's transmitter, which sets whether it pushes the fly towards or away from a smell
 *   - how many synapses the reward (PAM) and punishment (PPL1) dopamine neurons make on each MBON
 *
 * WHAT IS ENGINEERED (my choices, a fly has no sense for playing cards)
 *   - how a game situation is turned into a "smell" (which glomeruli light up): blackjack's code
 *     is below, poker's is in src/poker.js; any game can bring its own through options.code
 *   - the neuron model: firing rates instead of spikes, and a "keep the top few percent" rule
 *     standing in for the APL neuron that keeps Kenyon cell activity sparse
 *   - the learning rule's exact form and its numbers (learning rate, choice noise)
 *
 * HOW A DECISION IS MADE
 *   The fly is offered two smells, "this hand + hit" and "this hand + stand", like the two arms
 *   of a T-maze. Each smell drives PNs -> KCs -> MBONs. Approach MBONs minus avoid MBONs gives the
 *   smell's valence; the fly usually picks the arm that smells better.
 *
 * HOW IT LEARNS
 *   The hand's result is compared with what the chosen smell predicted. Better than expected:
 *   PAM neurons fire and PPL1 neurons pause. Worse: the reverse. Dopamine weakens the synapses
 *   from the Kenyon cells that were just active onto the MBONs that dopamine neuron reaches,
 *   and a dopamine pause lets them recover. Nothing else is trained.
 */
(function (root) {
  'use strict';

  var MIN_TOTAL = 4, N_TOTAL = 17, N_DEALER = 10;
  var N_STATES = N_TOTAL * 2 * N_DEALER, N_ODORS = N_STATES * 2;   // odor = state * 2 + (0 hit | 1 stand)

  var DEFAULTS = {
    seed: 1,
    sparsity: 0.05,        // fraction of Kenyon cells left active by APL-like inhibition
    learningRate: 0.03,    // how far one hand moves a smell's valence towards the result (0..1)
    temperature: 0.04,     // choice noise: a valence gap of this many bets makes the choice about 73/27
    totalWidth: 1.0,       // tuning width, in glomeruli, of the "player total" code
    dealerWidth: 0.8,      // same for the "dealer card" code
    groupSizes: { total: 24, dealer: 14, soft: 3, hit: 8, stand: 8 },
    groupGain: { total: 1.0, dealer: 1.0, soft: 1.0, action: 0.6 },
    maxEfficacy: 2.0,      // a synapse can grow to this many times its measured strength
    valenceGain: 3.0,      // one bet won or lost = 1/valenceGain of the MBON population's balance
    wiring: 'real',        // 'real' | 'shuffled-pn-kc' | 'shuffled-kc-mbon'
    dopamine: 'real',      // 'real' | 'blocked' | 'swapped' | 'shuffled'
    code: null             // how situations become smells; null = blackjack (see BLACKJACK below)
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  /* e^x built only from + - * / and exact powers of two, which every JavaScript engine computes
   * bit for bit the same way. Math.exp is allowed to differ in its last digit between browsers,
   * and the one fly everyone shares (src/timeline.js) must come out identical on every machine. */
  var LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10, LOG2E = 1.44269504088896338700e+00;
  var pow2View = new DataView(new ArrayBuffer(8));
  function pow2(k) {                                   // 2^k exactly, k an integer
    if (k < -1022) return pow2(k + 60) * pow2(-60);
    pow2View.setUint32(0, (k + 1023) << 20); pow2View.setUint32(4, 0);
    return pow2View.getFloat64(0);
  }
  function exp(x) {
    if (x !== x) return x;
    if (x > 709.78) return Infinity;
    if (x < -745.2) return 0;
    var k = Math.round(x * LOG2E), r = (x - k * LN2_HI) - k * LN2_LO;   // x = k ln2 + r, |r| <= 0.35
    var p = 1 / FACT[14];                                                 // Taylor series to r^14 / 14!
    for (var n = 13; n >= 1; n--) p = p * r + 1 / FACT[n];
    p = p * r + 1;
    return k > 1023 ? p * pow2(1023) * pow2(k - 1023) : p * pow2(k);
  }
  var FACT = [1]; for (var f = 1; f <= 14; f++) FACT[f] = FACT[f - 1] * f;

  function shuffled(arr, rng) {
    var a = Array.prototype.slice.call(arr);
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function merge(a, b) {
    var o = {}, k;
    for (k in a) o[k] = (a[k] && typeof a[k] === 'object') ? merge(a[k], {}) : a[k];
    for (k in b) o[k] = (b[k] && typeof b[k] === 'object') ? merge(o[k] || {}, b[k]) : b[k];
    return o;
  }

  function stateIndex(total, soft, dealer) { return ((total - MIN_TOTAL) * 2 + (soft ? 1 : 0)) * N_DEALER + (dealer - 2); }

  /* Deal the glomeruli (already sorted strongest first) into feature groups so that every
   * group gets a fair mix of strong and weak ones. */
  function assignGlomeruli(nGlom, sizes, names) {
    var groups = {}, left = {}, sum = 0, n;
    for (n = 0; n < names.length; n++) { groups[names[n]] = []; left[names[n]] = sizes[names[n]]; sum += sizes[names[n]]; }
    if (sum !== nGlom) throw new Error('group sizes must add up to ' + nGlom + ' glomeruli, got ' + sum);
    for (var g = 0; g < nGlom; g++) {
      var bestName = null, bestNeed = -1;
      for (n = 0; n < names.length; n++) {
        var need = left[names[n]] / sizes[names[n]];
        if (left[names[n]] > 0 && need > bestNeed) { bestNeed = need; bestName = names[n]; }
      }
      groups[bestName].push(g); left[bestName]--;
    }
    return groups;
  }

  /* A smell code: how many smells there are, how many choices each situation offers, which
   * feature groups share out the glomeruli, and which glomeruli a smell lights up. */
  var BLACKJACK = {
    name: 'blackjack', nOdors: N_ODORS, nActions: 2,
    groupNames: ['total', 'dealer', 'soft', 'hit', 'stand'],
    pattern: function (brain, odor, out) {
      var o = brain.options, g = brain.groups, gain = o.groupGain;
      var action = odor % 2, st = (odor - action) / 2;
      var dealer = st % N_DEALER, soft = ((st - dealer) / N_DEALER) % 2, total = (st - dealer - soft * N_DEALER) / (2 * N_DEALER);
      out.fill(0);
      bump(out, g.total, total / (N_TOTAL - 1), o.totalWidth, gain.total);
      bump(out, g.dealer, dealer / (N_DEALER - 1), o.dealerWidth, gain.dealer);
      var i;
      if (soft) for (i = 0; i < g.soft.length; i++) out[g.soft[i]] = gain.soft;
      var act = action === 0 ? g.hit : g.stand;
      for (i = 0; i < act.length; i++) out[act[i]] = gain.action;
      return out;
    }
  };

  function Brain(circuit, options) {
    var code = (options && options.code) || BLACKJACK;
    var o = this.options = merge(DEFAULTS, options || {});
    this.code = code;
    var N_ODORS = this.nOdors = code.nOdors;
    var rng = this.rng = mulberry32(o.seed);
    var wiringRng = mulberry32(o.seed * 7919 + 13);
    this.circuit = circuit;
    var nG = this.nGlom = circuit.glomeruli.length, nP = this.nPn = circuit.pn.glom.length;
    var nK = this.nKc = circuit.kc.type.length, nM = this.nMbon = circuit.mbon.type.length;
    var i, j, k, e;

    // ---- wiring (optionally scrambled for control experiments)
    var pnKc = circuit.pnKc, kcMbon = circuit.kcMbon;
    if (o.wiring === 'shuffled-pn-kc') pnKc = shuffleTargets(pnKc, wiringRng);
    if (o.wiring === 'shuffled-kc-mbon') kcMbon = shuffleTargets(kcMbon, wiringRng);
    this.pnKc = pnKc; this.kcMbon = kcMbon;

    // ---- MBON side: synapse counts, sign, dopamine footprints
    // Connections are stored grouped by Kenyon cell: KC k owns edges kcStart[k] .. kcStart[k+1]-1.
    var nE = this.nEdges = kcMbon.length / 3;
    this.kcStart = new Int32Array(nK + 1);
    for (e = 0; e < kcMbon.length; e += 3) this.kcStart[kcMbon[e] + 1]++;
    for (k = 0; k < nK; k++) this.kcStart[k + 1] += this.kcStart[k];
    this.edgeMbon = new Uint8Array(nE); this.count = new Float32Array(nE);   // measured synapse counts
    this.edgeOrder = new Int32Array(nE);                                      // position in circuit.kcMbon
    var fill = this.kcStart.slice(0, nK);
    for (e = 0; e < kcMbon.length; e += 3) {
      var at = fill[kcMbon[e]]++;
      this.edgeMbon[at] = kcMbon[e + 1]; this.count[at] = kcMbon[e + 2]; this.edgeOrder[at] = e / 3;
    }
    this.weight = new Float32Array(this.count);       // the plastic strengths, start at the measured counts
    this.valence = Int8Array.from(circuit.mbon.valence);
    var pam = circuit.mbon.pamSynapses.slice(), ppl1 = circuit.mbon.ppl1Synapses.slice();
    if (o.dopamine === 'shuffled') { pam = shuffled(pam, wiringRng); ppl1 = shuffled(ppl1, wiringRng); }
    if (o.dopamine === 'swapped') { var t = pam; pam = ppl1; ppl1 = t; }
    var pamSum = 0, pplSum = 0;
    for (j = 0; j < nM; j++) { pamSum += pam[j]; pplSum += ppl1[j]; }
    this.pamShare = new Float32Array(nM); this.ppl1Share = new Float32Array(nM);
    for (j = 0; j < nM; j++) { this.pamShare[j] = pam[j] / pamSum; this.ppl1Share[j] = ppl1[j] / pplSum; }
    if (o.dopamine === 'ideal') {                     // diagnostic only: dopamine aimed perfectly by MBON sign
      for (j = 0; j < nM; j++) { this.pamShare[j] = this.valence[j] < 0 ? 1 / nM : 0; this.ppl1Share[j] = this.valence[j] > 0 ? 1 / nM : 0; }
    }

    // ---- card -> smell code
    this.groups = assignGlomeruli(nG, code === BLACKJACK ? o.groupSizes : code.groupSizes, code.groupNames);
    this.side = Uint8Array.from(circuit.kc.side.map(function (s) { return s === 'L' ? 0 : 1; }));

    // ---- precompute the Kenyon cell pattern of every smell (shared by flies wired alike)
    var od, cache = null, key = code.name + '|' + o.sparsity + '|' +
      JSON.stringify(code === BLACKJACK ? [o.groupSizes, o.groupGain, o.totalWidth, o.dealerWidth] : code.groupSizes);
    if (o.wiring === 'real') {
      if (!circuit.__odorCache) Object.defineProperty(circuit, '__odorCache', { value: {} });
      cache = circuit.__odorCache;
    }
    if (cache && cache[key]) {
      this.odorStart = cache[key].start; this.odorKc = cache[key].kc; this.odorX = cache[key].x;
    } else {
      this.odorStart = new Int32Array(N_ODORS + 1);
      var idx = [], val = [], glom = new Float32Array(nG), drive = new Float32Array(nK);
      for (od = 0; od < N_ODORS; od++) {
        this.glomerulusPattern(od, glom);
        drive.fill(0);
        for (e = 0; e < pnKc.length; e += 3) drive[pnKc[e + 1]] += pnKc[e + 2] * glom[circuit.pn.glom[pnKc[e]]];
        var active = sparsify(drive, this.side, o.sparsity), norm = 0;
        for (i = 0; i < active.length; i++) norm += active[i][1] * active[i][1];
        norm = Math.sqrt(norm) || 1;
        for (i = 0; i < active.length; i++) { idx.push(active[i][0]); val.push(active[i][1] / norm); }
        this.odorStart[od + 1] = idx.length;
      }
      this.odorKc = Int32Array.from(idx); this.odorX = Float32Array.from(val);
      if (cache) cache[key] = { start: this.odorStart, kc: this.odorKc, x: this.odorX };
    }

    // ---- balance approach against avoid for the untrained fly (average over all smells)
    this.mbon = new Float32Array(nM);
    this.mbonBaseline = new Float32Array(nM);         // each MBON's average response before any learning
    var app = 0, av = 0;
    for (od = 0; od < N_ODORS; od++) {
      this.respond(od);
      for (j = 0; j < nM; j++) {
        this.mbonBaseline[j] += this.mbon[j] / N_ODORS;
        if (this.valence[j] > 0) app += this.mbon[j]; else av += this.mbon[j];
      }
    }
    this.approachScale = o.valenceGain * N_ODORS / app; this.avoidScale = o.valenceGain * N_ODORS / av;

    // ---- how much one unit of dopamine moves valence, so learningRate has a plain meaning
    var kappa = 0;
    for (od = 0; od < N_ODORS; od++) {
      for (i = this.odorStart[od]; i < this.odorStart[od + 1]; i++) {
        k = this.odorKc[i]; var x2 = this.odorX[i] * this.odorX[i];
        for (e = this.kcStart[k]; e < this.kcStart[k + 1]; e++) {
          j = this.edgeMbon[e];
          var sgn = this.valence[j] > 0 ? this.approachScale : -this.avoidScale;
          kappa -= sgn * (this.pamShare[j] - this.ppl1Share[j]) * this.count[e] * x2;
        }
      }
    }
    this.dopamineGain = kappa / N_ODORS;              // > 0 means reward raises valence
    // scale by the size of the effect, never by its sign: if the wiring pointed the wrong way,
    // the fly would simply learn the wrong thing, and that is what the "swapped" control shows
    this.eta = o.dopamine === 'blocked' ? 0 : o.learningRate / Math.abs(this.dopamineGain);

    this.hands = 0; this.lastDopamine = 0;
  }

  /* Degree-preserving scramble: every source keeps its number and strength of connections,
   * every target keeps how many it receives, but who talks to whom is random. */
  function shuffleTargets(edges, rng) {
    var targets = [];
    for (var e = 0; e < edges.length; e += 3) targets.push(edges[e + 1]);
    targets = shuffled(targets, rng);
    var out = edges.slice();
    for (e = 0; e < edges.length; e += 3) out[e + 1] = targets[e / 3];
    return out;
  }

  /* APL-like inhibition: in each hemisphere only the most strongly driven fraction of Kenyon
   * cells stays active, and what remains is the drive above that cut-off. */
  function sparsify(drive, side, fraction) {
    var out = [];
    for (var s = 0; s < 2; s++) {
      var mine = [];
      for (var k = 0; k < drive.length; k++) if (side[k] === s) mine.push(drive[k]);
      mine.sort(function (a, b) { return b - a; });
      var cut = mine[Math.max(0, Math.floor(mine.length * fraction) - 1)];
      var floor = mine[Math.min(mine.length - 1, Math.floor(mine.length * fraction))];
      for (k = 0; k < drive.length; k++) if (side[k] === s && drive[k] >= cut && drive[k] > 0) out.push([k, drive[k] - floor + 1e-6]);
    }
    return out;
  }

  /* The engineered part: which glomeruli a (situation, choice) pair lights up, 0..1 each. */
  Brain.prototype.glomerulusPattern = function (odor, out) { return this.code.pattern(this, odor, out); };
  /* A value between 0 and 1 becomes a bump of activity along a row of glomeruli, so that
   * neighbouring values (15 and 16, say) smell similar. */
  function bump(out, glomeruli, position, width, gain) {
    var centre = position * (glomeruli.length - 1);
    for (var i = 0; i < glomeruli.length; i++) {
      var d = (i - centre) / width;
      out[glomeruli[i]] = gain * exp(-0.5 * d * d);
    }
  }

  /* Run one smell through the Kenyon cells into the MBONs. Fills this.mbon, returns the valence. */
  Brain.prototype.respond = function (odor) {
    var nM = this.nMbon, m = this.mbon, w = this.weight, mb = this.edgeMbon, ks = this.kcStart;
    var a = this.odorStart[odor], b = this.odorStart[odor + 1], j;
    m.fill(0);
    for (var i = a; i < b; i++) {
      var k = this.odorKc[i], x = this.odorX[i];
      for (var e = ks[k], end = ks[k + 1]; e < end; e++) m[mb[e]] += w[e] * x;
    }
    if (!this.approachScale) return 0;
    var app = 0, av = 0;
    for (j = 0; j < nM; j++) { if (this.valence[j] > 0) app += m[j]; else av += m[j]; }
    this.lastApproach = app * this.approachScale; this.lastAvoid = av * this.avoidScale;
    return this.lastApproach - this.lastAvoid;
  };

  Brain.prototype.valenceOf = function (total, soft, dealer, hit) {
    return this.respond(stateIndex(total, soft, dealer) * 2 + (hit ? 0 : 1));
  };
  Brain.prototype.pHit = function (total, soft, dealer) {
    var s = stateIndex(total, soft, dealer);
    var d = this.respond(s * 2) - this.respond(s * 2 + 1);
    return 1 / (1 + exp(-d / this.options.temperature));
  };
  /* Choose hit (true) or stand (false). Returns details for display too. */
  Brain.prototype.decide = function (total, soft, dealer) {
    var s = stateIndex(total, soft, dealer);
    var vHit = this.respond(s * 2), vStand = this.respond(s * 2 + 1);
    var p = 1 / (1 + exp(-(vHit - vStand) / this.options.temperature));
    var hit = this.rng() < p;
    return { hit: hit, pHit: p, vHit: vHit, vStand: vStand, odor: s * 2 + (hit ? 0 : 1) };
  };

  /* Any game: offered the choices `actions` (indices below code.nActions) in situation `state`,
   * the fly smells each one and usually goes for the one that smells best. */
  Brain.prototype.choose = function (state, actions) {
    var p = this.preferences(state, actions), r = this.rng(), pick = actions[actions.length - 1];
    for (var i = 0; i < actions.length; i++) { r -= p[actions[i]]; if (r < 0) { pick = actions[i]; break; } }
    return { action: pick, values: p.values, p: p, odor: state * this.code.nActions + pick };
  };
  /* How likely each choice is right now; p.values holds how good each one smells. */
  Brain.prototype.preferences = function (state, actions) {
    var A = this.code.nActions, T = this.options.temperature, p = {}, v = {}, best = -Infinity, sum = 0, i;
    for (i = 0; i < actions.length; i++) { v[actions[i]] = this.respond(state * A + actions[i]); best = Math.max(best, v[actions[i]]); }
    for (i = 0; i < actions.length; i++) sum += (p[actions[i]] = exp((v[actions[i]] - best) / T));
    for (i = 0; i < actions.length; i++) p[actions[i]] /= sum;
    Object.defineProperty(p, 'values', { value: v });
    return p;
  };

  /* Dopamine-gated learning for one chosen smell. reward is in bets (-1, 0, 1). Returns the
   * prediction error: positive = better than the smell predicted. */
  Brain.prototype.learn = function (odor, reward) {
    var error = reward - this.respond(odor);
    this.lastDopamine = error;
    if (!this.eta) return error;
    var w = this.weight, c = this.count, mb = this.edgeMbon, ks = this.kcStart, max = this.options.maxEfficacy;
    var nM = this.nMbon, push = this.push || (this.push = new Float32Array(nM)), step = this.eta * error;
    // PAM above baseline (error > 0) depresses its targets; PPL1 below baseline lets its targets
    // recover. For error < 0 the two swap roles.
    for (var j = 0; j < nM; j++) push[j] = step * (this.pamShare[j] - this.ppl1Share[j]);
    for (var i = this.odorStart[odor]; i < this.odorStart[odor + 1]; i++) {
      var k = this.odorKc[i], x = this.odorX[i];
      for (var e = ks[k], end = ks[k + 1]; e < end; e++) {
        var v = w[e] - push[mb[e]] * x * c[e], top = max * c[e];
        w[e] = v < 0 ? 0 : v > top ? top : v;
      }
    }
    return error;
  };

  /* Play one whole hand and learn from it. Returns the finished Blackjack.Hand, with
   * hand.trace = the fly's decisions and hand.surprise = the last prediction error (or null). */
  Brain.prototype.playHand = function (Blackjack, learn) {
    var hand = new Blackjack.Hand(this.rng), trace = [], surprise = null;
    while (!hand.done) {
      var d = this.decide(hand.total, hand.soft, hand.up);
      d.total = hand.total; d.soft = hand.soft; d.dealer = hand.up;
      trace.push(d);
      hand.act(d.hit);
    }
    if (learn !== false) surprise = this.learnHand(trace, hand.reward);
    this.hands++;
    hand.trace = trace; hand.surprise = surprise;
    return hand;
  };
  /* Every smell the fly chose during the hand is paired with the hand's result. */
  Brain.prototype.learnHand = function (trace, reward) {
    var r = Math.max(-1, Math.min(1, reward)), surprise = null;
    for (var i = 0; i < trace.length; i++) surprise = this.learn(trace[i].odor, r);
    return surprise;
  };

  /* The fly's current habits: probability of hitting in every state. */
  Brain.prototype.policy = function (greedy) {
    var p = new Float64Array(N_STATES);
    for (var s = 0; s < N_STATES; s++) {
      var d = this.respond(s * 2) - this.respond(s * 2 + 1);
      p[s] = greedy ? (d > 0 ? 1 : 0) : 1 / (1 + exp(-d / this.options.temperature));
    }
    return p;
  };

  /* Active Kenyon cells of a smell, for drawing: [[kcIndex, activity], ...] */
  Brain.prototype.activeKenyonCells = function (odor) {
    var out = [];
    for (var i = this.odorStart[odor]; i < this.odorStart[odor + 1]; i++) out.push([this.odorKc[i], this.odorX[i]]);
    return out;
  };

  /* Save / restore what the fly has learned (synapse strengths relative to measured, 16 bit). */
  Brain.prototype.exportMemory = function () {
    var out = new Uint16Array(this.nEdges), max = this.options.maxEfficacy;
    for (var e = 0; e < this.nEdges; e++) out[this.edgeOrder[e]] = Math.round(65535 * this.weight[e] / (max * this.count[e]));
    return { hands: this.hands, strengths: out };
  };
  Brain.prototype.importMemory = function (memory) {
    var max = this.options.maxEfficacy;
    if (!memory || !memory.strengths || memory.strengths.length !== this.nEdges) return false;
    for (var e = 0; e < this.nEdges; e++) this.weight[e] = memory.strengths[this.edgeOrder[e]] / 65535 * max * this.count[e];
    this.hands = memory.hands || 0;
    return true;
  };

  var api = { Brain: Brain, DEFAULTS: DEFAULTS, BLACKJACK: BLACKJACK, N_STATES: N_STATES, N_ODORS: N_ODORS, stateIndex: stateIndex, mulberry32: mulberry32, bump: bump, exp: exp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FlyBrain = api;
})(typeof self !== 'undefined' ? self : this);

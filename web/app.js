/* FlyJack - the page: runs the table (drawn by web/casino.js), draws the brain, keeps the learning record. */
(function () {
  'use strict';
  var BJ = self.Blackjack, FB = self.FlyBrain;
  var circuit = JSON.parse(document.getElementById('circuit-data').textContent);
  var $ = function (id) { return document.getElementById(id); };
  var reduceMotion = !!(self.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  var MODES = {
    intact: { options: {}, note: 'The circuit as it was mapped. A fresh fly plays close to a coin flip. Switch to Turbo for a minute, then come back to Watch.' },
    blocked: { options: { dopamine: 'blocked' }, note: 'Dopamine neurons are silenced, so no result ever reaches the synapses. This fly keeps its starting habits forever.' },
    swapped: { options: { dopamine: 'swapped' }, note: 'Reward neurons now do the punishment neurons\' job and the reverse. Wins push the fly away from what worked.' },
    scrambled: { options: { dopamine: 'shuffled' }, note: 'Each output neuron gets some other output\'s share of dopamine. Whether this fly learns anything depends on the luck of the shuffle.' },
    rewired: { options: { wiring: 'shuffled-pn-kc' }, note: 'Smell channels are reconnected to Kenyon cells at random, keeping how many connections each cell has. This fly learns about as well as the intact one.' }
  };
  var STORE_KEY = 'flyjack.intact.v1';
  var REF = {
    best: BJ.expectedReturn(null),
    stand: BJ.expectedReturn(new Float64Array(BJ.N_STATES)),
    coin: BJ.expectedReturn(new Float64Array(BJ.N_STATES).fill(0.5))
  };
  var BEST = BJ.evaluate(null).best;

  /* ---------- sessions: one fly per brain mode ---------- */
  var sessions = {}, mode = 'intact', S = null;
  function newSession(m) {
    var opts = { seed: (Math.random() * 1e9) | 0 }, o = MODES[m].options, k;
    for (k in o) opts[k] = o[k];
    var s = { mode: m, brain: new FB.Brain(circuit, opts), bank: 0, recent: [], curve: [], every: 10, last: null, dirty: false, rateT: 0, rateH: 0, rate: 0 };
    s.curve.push({ h: 0, s: skillOf(s.brain) });
    return s;
  }
  function skillOf(brain) { return BJ.expectedReturn(brain.policy(false)); }
  function useMode(m) {
    mode = m;
    S = sessions[m] || (sessions[m] = newSession(m));
    $('mode-note').textContent = MODES[m].note;
    watch.step = null; view.odor = -1; view.dopamine = 0;
    S.rateT = 0;
    clearTable(); refresh(true);
  }

  /* ---------- remembering the intact fly between visits ---------- */
  function b64(u16) {
    var b = new Uint8Array(u16.buffer), s = '';
    for (var i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
    return btoa(s);
  }
  function unb64(str) {
    var s = atob(str), b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return new Uint16Array(b.buffer);
  }
  function save() {
    var s = sessions.intact;
    if (!s || !s.dirty) return;
    try {
      var mem = s.brain.exportMemory();
      localStorage.setItem(STORE_KEY, JSON.stringify({ hands: mem.hands, bank: s.bank, curve: s.curve, every: s.every, edges: mem.strengths.length, strengths: b64(mem.strengths) }));
      s.dirty = false;
    } catch (e) { /* storage unavailable: the fly simply starts fresh next time */ }
  }
  function restore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var d = JSON.parse(raw), s = newSession('intact');
      if (d.edges !== s.brain.nEdges || !s.brain.importMemory({ hands: d.hands, strengths: unb64(d.strengths) })) return;
      s.bank = +d.bank || 0; s.every = d.every || 10;
      if (Array.isArray(d.curve) && d.curve.length) s.curve = d.curve;
      sessions.intact = s;
    } catch (e) { /* ignore a damaged save */ }
  }

  /* ---------- playing ---------- */
  var playing = !reduceMotion, speed = 'watch';
  var watch = { step: null, at: 0, hand: null, trace: [] };

  function record(hand) {
    S.bank += hand.reward; S.last = hand; S.dirty = true;
    S.recent.push(hand.reward); if (S.recent.length > 16) S.recent.shift();
    var c = S.curve, h = S.brain.hands;
    if (h - c[c.length - 1].h >= S.every) {
      c.push({ h: h, s: skillOf(S.brain) });
      if (c.length > 320) { S.curve = c.filter(function (p, i) { return i % 2 === 0 || i === c.length - 1; }); S.every *= 2; }
    }
  }
  function quickHand() { record(S.brain.playHand(BJ)); }

  /* Watch mode: one hand shown step by step. Each step returns [nextStep, delayMs]; the delays
     follow how long the casino scene needs to act the step out. */
  function stepDeal() {
    var hand = watch.hand = new BJ.Hand(S.brain.rng); watch.trace = [];
    view.odor = -1; view.dopamine = 0; view.label = 'waiting'; view.changed = true;
    var ms = scene.deal(hand); shown.hand = hand; describe(hand);
    showChoice(null); say(' ', ' ');
    return hand.done ? [stepResult, ms + 300] : [stepSniffHit, ms + 250];
  }
  function sniff(hit) {
    var h = watch.hand, st = FB.stateIndex(h.total, h.soft, h.up), odor = st * 2 + (hit ? 0 : 1);
    var v = S.brain.respond(odor);
    showOdor(odor, hit ? 'smelling "hit"' : 'smelling "stand"');
    scene.sniff(hit, v);
    return v;
  }
  function stepSniffHit() { watch.vHit = sniff(true); setMeter('hit', watch.vHit, false); setMeter('stand', null, false); $('odds').textContent = ''; return [stepSniffStand, 1000]; }
  function stepSniffStand() { watch.vStand = sniff(false); setMeter('stand', watch.vStand, false); return [stepChoose, 1000]; }
  function stepChoose() {
    var h = watch.hand, d = S.brain.decide(h.total, h.soft, h.up);
    d.total = h.total; d.soft = h.soft; d.dealer = h.up;
    watch.trace.push(d); watch.pick = d;
    showChoice(d); showOdor(d.odor, d.hit ? 'chose "hit"' : 'chose "stand"');
    say(d.hit ? 'The fly hits' : 'The fly stands', ' ');
    return [stepAct, scene.choose(d.hit)];
  }
  function stepAct() {
    var h = watch.hand; h.act(watch.pick.hit);
    var ms = scene.update(h); describe(h);
    return h.done ? [stepResult, ms + 200] : [stepSniffHit, ms + 350];
  }
  function stepResult() {                 // the brain learns now; the table shows the payout next
    var h = watch.hand;
    h.trace = watch.trace; h.surprise = S.brain.learnHand(watch.trace, h.reward); S.brain.hands++;
    record(h); h.recorded = true;
    var ms = scene.update(h); describe(h);
    return [stepSettle, ms + 250];
  }
  function stepSettle() {
    var h = watch.hand;
    announce(h); flashDopamine(h.surprise); scene.dopamine(S.mode === 'blocked' ? null : h.surprise);
    var ms = scene.settle(h);
    watch.hand = null;
    return [stepDeal, ms];
  }
  function finishWatchHand() {            // leaving Watch mid-hand: play it out at once
    var h = watch.hand;
    watch.hand = null; watch.step = null;
    if (!h || h.recorded) return;
    while (!h.done) { var d = S.brain.decide(h.total, h.soft, h.up); watch.trace.push(d); h.act(d.hit); }
    h.trace = watch.trace; h.surprise = S.brain.learnHand(watch.trace, h.reward); S.brain.hands++;
    record(h);
  }

  /* ---------- the table ---------- */
  var scene = self.Casino($('scene'), { reduceMotion: reduceMotion });
  var shown = { hand: null };
  function showHand(hand) { scene.show(hand); shown.hand = hand; describe(hand); }   // a finished hand, laid out at once
  function names(cards) { return cards.map(function (c) { return c.face; }).join(', '); }
  function describe(hand) {
    var p = BJ.handOf(hand.player), open = hand.holeShown || (hand.done && hand.result !== 'bust'), d = BJ.handOf(hand.dealer);
    $('scene-desc').textContent = 'The fly holds ' + names(hand.player) + ', ' + (p.soft && p.total < 21 ? 'soft ' : '') + p.total + '. ' +
      (open ? 'The dealer has ' + names(hand.dealer) + ', ' + d.total + '.' : 'The dealer shows ' + names([hand.dealer[0]]) + '.');
  }
  function clearTable() { scene.clear(); showChoice(null); say(' ', ' '); shown.hand = null; $('scene-desc').textContent = ''; }
  function setMeter(which, v, picked) {
    var el = $('meter-' + which), fill = el.querySelector('.fill'), val = el.querySelector('.val');
    el.classList.toggle('picked', !!picked);
    if (v === null || v === undefined) { fill.style.width = '0'; fill.style.left = '50%'; val.textContent = ' '; return; }
    var x = Math.max(-1.2, Math.min(1.2, v)) / 1.2 * 50;
    fill.style.left = (x < 0 ? 50 + x : 50) + '%'; fill.style.width = Math.abs(x) + '%';
    val.textContent = signed(v, 2);
  }
  function showChoice(d) {
    if (!d) { setMeter('hit', null, false); setMeter('stand', null, false); $('odds').textContent = ''; return; }
    setMeter('hit', d.vHit, d.hit); setMeter('stand', d.vStand, !d.hit);
    $('odds').textContent = 'hits ' + Math.round(100 * d.pHit) + '% of the time';
  }
  var RESULT_TEXT = { 'bust': 'Bust', 'dealer bust': 'Dealer busts', 'win': 'The fly wins', 'lose': 'The dealer wins', 'push': 'Push', 'blackjack': 'Blackjack', 'dealer blackjack': 'Dealer has blackjack' };
  function say(what, why) { $('verdict').textContent = what; $('dopamine-note').textContent = why; }
  function announce(hand) {
    var why;
    if (!hand.trace || !hand.trace.length) why = 'No choice was made, so there is nothing to learn from.';
    else if (S.mode === 'blocked') why = 'Dopamine is blocked. Nothing is learned.';
    else if (hand.surprise > 0.05) why = 'Better than the fly expected: reward dopamine fires.';
    else if (hand.surprise < -0.05) why = 'Worse than the fly expected: punishment dopamine fires.';
    else why = 'About what the fly expected: dopamine stays quiet.';
    say(RESULT_TEXT[hand.result] + ', ' + signed(hand.reward, hand.reward % 1 ? 1 : 0), why);
  }

  /* ---------- the brain view: a 3D model you can turn ---------- */
  var canvas = $('brain'), ctx = canvas.getContext('2d');
  var COLORS = { act: '#199e70', actHi: '#7df0c4', pos: '#3987e5', posHi: '#a9d0ff', neg: '#d95926', negHi: '#ffb08a', cloud: '201,212,205' };
  var view = { odor: -1, glom: new Float32Array(circuit.glomeruli.length), kc: [], mbon: new Float32Array(circuit.mbon.type.length), dopamine: 0, dopamineAt: 0, label: '', changed: true, w: 0, h: 0 };
  var cells = [];   // every neuron once: {x, y, z (centred, about -1..1; y up, z towards the back), group, i, type, id}
  var floorY = 0, rightSign = 1;
  (function layout() {
    var groups = ['kc', 'pn', 'mbon', 'pam', 'ppl1'], lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], g, i, d, sideX = { L: 0, R: 0 }, sideN = { L: 0, R: 0 };
    for (g = 0; g < groups.length; g++) for (i = 0; i < circuit[groups[g]].soma.length; i++) {
      var p = circuit[groups[g]].soma[i];
      for (d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], p[d]); hi[d] = Math.max(hi[d], p[d]); }
    }
    var half = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2, mid = [0, 1, 2].map(function (d) { return (lo[d] + hi[d]) / 2; });
    for (g = 0; g < groups.length; g++) {
      var c = circuit[groups[g]], seen = {};
      c.soma.forEach(function (q) { seen[q] = (seen[q] || 0) + 1; });   // cells with no soma in the connectome share their group's median
      for (i = 0; i < c.soma.length; i++) {
        var q = c.soma[i];
        // connectome voxels: x across the head, y downwards, z towards the back
        cells.push({ x: (q[0] - mid[0]) / half, y: -(q[1] - mid[1]) / half, z: (q[2] - mid[2]) / half, group: groups[g], i: i, type: c.type[i], id: c.bodyId[i], guess: seen[q] > 1 });
        if (c.side[i] in sideX) { sideX[c.side[i]] += q[0]; sideN[c.side[i]]++; }
      }
    }
    floorY = -(hi[1] - mid[1]) / half - 0.12;
    rightSign = sideX.R / (sideN.R || 1) >= sideX.L / (sideN.L || 1) ? 1 : -1;
  })();
  var byGroup = {};
  cells.forEach(function (c) { (byGroup[c.group] = byGroup[c.group] || []).push(c); });
  // inputs of each Kenyon cell (PN index, synapses), to draw the path a smell takes
  var kcInputs = byGroup.kc.map(function () { return []; }), kcOutputs = byGroup.kc.map(function () { return [-1, 0]; });
  (function wiring() {
    var e, t = circuit.pnKc, k = circuit.kcMbon;
    for (e = 0; e < t.length; e += 3) kcInputs[t[e + 1]].push([t[e], t[e + 2]]);
    for (e = 0; e < k.length; e += 3) if (k[e + 2] > kcOutputs[k[e]][1]) kcOutputs[k[e]] = [k[e + 1], k[e + 2]];   // strongest output of each KC
  })();

  /* the camera: turntable yaw, tilt (pitch), slow spin unless reduced motion; drag to turn */
  var HOME = { yaw: Math.PI + 0.55, pitch: -0.62 };
  var cam = { yaw: HOME.yaw, pitch: HOME.pitch, vYaw: 0, vPitch: 0, spin: reduceMotion ? 0 : 0.00012, heldUntil: 0, dist: 4.2, scale: 1, cx: 0, cy: 0 };
  var drag = null, visible = true, lastDraw = 0;
  function project(c) {
    var cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    var x1 = c.x * cy + c.z * sy, z1 = -c.x * sy + c.z * cy;
    var y2 = c.y * cp - z1 * sp, z2 = c.y * sp + z1 * cp, k = cam.dist / (cam.dist + z2);
    c.px = cam.cx + x1 * k * cam.scale; c.py = cam.cy - y2 * k * cam.scale; c.k = k; c.depth = z2;
  }
  function point(x, y, z) { var p = { x: x, y: y, z: z }; project(p); return p; }

  // one shaded sphere and one soft glow per colour, drawn once and stamped for every neuron
  var sprites = {};
  function sprite(color, kind) {
    var key = color + kind;
    if (sprites[key]) return sprites[key];
    var s = document.createElement('canvas'), n = 64, g = s.getContext('2d'), grad;
    s.width = s.height = n;
    if (kind === 'glow') {
      grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
      grad.addColorStop(0, color + 'aa'); grad.addColorStop(0.3, color + '44'); grad.addColorStop(1, color + '00');
    } else {
      grad = g.createRadialGradient(n * 0.36, n * 0.33, n * 0.02, n / 2, n / 2, n / 2);
      grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.18, color); grad.addColorStop(0.75, color); grad.addColorStop(1, '#05080a');
    }
    g.fillStyle = grad; g.beginPath(); g.arc(n / 2, n / 2, n / 2, 0, 6.2832); g.fill();
    return (sprites[key] = s);
  }
  function fog(c) { return Math.max(0.35, Math.min(1, 0.7 - 0.45 * c.depth)); }   // far neurons fade into the dark

  function fit() {
    var r = canvas.getBoundingClientRect(), dpr = Math.min(2, self.devicePixelRatio || 1);
    if (!r.width) return;
    view.w = r.width; view.h = r.height;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    cam.cx = r.width / 2; cam.cy = r.height * 0.56;
    cam.scale = Math.min(r.width * 0.5 / 1.2, r.height * 0.5 / 1.12);
    view.dpr = dpr; view.changed = true;
  }
  function drawFloor() {
    var n = 5, s = 1.15, i, a, b;
    ctx.lineWidth = 1;
    for (i = -n; i <= n; i++) {
      var t = i / n * s, edge = 1 - Math.abs(i) / (n + 1);
      a = point(t, floorY, -s); b = point(t, floorY, s);
      ctx.strokeStyle = 'rgba(120,170,150,' + (0.13 * edge).toFixed(3) + ')';
      ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
      a = point(-s, floorY, t); b = point(s, floorY, t);
      ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
    }
  }
  function drawGizmo() {         // which way is front, up and the fly's right
    var o = { x: 0, y: 0, z: 0 }, ax = [[{ x: 0, y: 0, z: -1 }, 'front', COLORS.actHi], [{ x: 0, y: 1, z: 0 }, 'top', '#c9d4cd'], [{ x: rightSign, y: 0, z: 0 }, 'right', '#8a988f']];
    var save = [cam.cx, cam.cy, cam.scale, cam.dist], ox = 50, oy = view.h - 38;
    cam.cx = ox; cam.cy = oy; cam.scale = 22; cam.dist = 1e6;
    project(o);
    ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 1.5;
    ax.forEach(function (a) {
      project(a[0]);
      ctx.globalAlpha = a[0].depth > 0.3 ? 0.45 : 0.9; ctx.strokeStyle = ctx.fillStyle = a[2];
      ctx.beginPath(); ctx.moveTo(o.px, o.py); ctx.lineTo(a[0].px, a[0].py); ctx.stroke();
      var dx = a[0].px - o.px, dy = a[0].py - o.py, len = Math.sqrt(dx * dx + dy * dy) || 1;
      ctx.fillText(a[1], Math.max(16, a[0].px + dx / len * 16), Math.min(view.h - 6, a[0].py + dy / len * 9));
    });
    cam.cx = save[0]; cam.cy = save[1]; cam.scale = save[2]; cam.dist = save[3];
    ctx.globalAlpha = 1;
  }
  function drawBrain(now) {
    var dt = Math.min(64, now - (lastDraw || now)); lastDraw = now;
    var fade = view.dopamine ? Math.max(0, 1 - (now - view.dopamineAt) / 1500) : 0;
    var moving = !!drag || Math.abs(cam.vYaw) > 1e-5 || Math.abs(cam.vPitch) > 1e-5 || (cam.spin && now > cam.heldUntil);
    if (!drag) {                    // inertia after a drag, then back to the slow spin
      cam.yaw += cam.vYaw * dt; cam.pitch = Math.max(-1.45, Math.min(1.2, cam.pitch + cam.vPitch * dt));
      cam.vYaw *= 0.92; cam.vPitch *= 0.92;
      if (cam.spin && now > cam.heldUntil) cam.yaw += cam.spin * dt;
    }
    if (!visible || (!view.changed && !fade && !view.fading && !moving)) return;
    view.fading = fade > 0; view.changed = false;
    if (!view.w) return;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    var bg = ctx.createRadialGradient(cam.cx, cam.cy, 0, cam.cx, cam.cy, Math.max(view.w, view.h) * 0.7);
    bg.addColorStop(0, '#0d1511'); bg.addColorStop(1, '#000000');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, view.w, view.h);
    for (var j = 0; j < cells.length; j++) project(cells[j]);
    drawFloor();

    var i, c, a, f, on = view.odor >= 0, vb = view.brain || S.brain;
    // Kenyon cells: a faint glowing cloud, brighter where it is dense and near
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgb(' + COLORS.cloud + ')';
    for (i = 0; i < byGroup.kc.length; i++) {
      c = byGroup.kc[i]; if (c.guess) continue;
      f = fog(c); a = 1.6 * c.k;
      ctx.globalAlpha = 0.16 * f; ctx.fillRect(c.px - a / 2, c.py - a / 2, a, a);
    }
    // the path this smell takes: driven projection neurons -> responding Kenyon cells -> their main output neuron
    if (on && view.kc.length) {
      ctx.lineWidth = 0.6; ctx.strokeStyle = COLORS.act;
      for (i = 0; i < view.kc.length; i++) {
        var kc = byGroup.kc[view.kc[i][0]], ins = kcInputs[view.kc[i][0]], out = kcOutputs[view.kc[i][0]];
        for (var e = 0; e < ins.length; e++) {
          a = view.glom[circuit.pn.glom[ins[e][0]]];
          if (a < 0.35) continue;
          c = byGroup.pn[ins[e][0]]; ctx.globalAlpha = 0.07 * a * fog(kc);
          ctx.beginPath(); ctx.moveTo(c.px, c.py); ctx.lineTo(kc.px, kc.py); ctx.stroke();
        }
        if (out[0] >= 0) {
          c = byGroup.mbon[out[0]]; ctx.globalAlpha = 0.12 * fog(kc); ctx.strokeStyle = vb.valence[out[0]] > 0 ? COLORS.pos : COLORS.neg;
          ctx.beginPath(); ctx.moveTo(kc.px, kc.py); ctx.lineTo(c.px, c.py); ctx.stroke(); ctx.strokeStyle = COLORS.act;
        }
      }
    }

    // every named neuron as a lit sphere, far ones first
    var reward = view.dopamine > 0 ? fade * Math.min(1, view.dopamine * 1.5 + 0.25) : 0;
    var punish = view.dopamine < 0 ? fade * Math.min(1, -view.dopamine * 1.5 + 0.25) : 0;
    var balls = [];
    function ball(c, r, color, alpha, glow) { balls.push({ c: c, r: 1.35 * r * c.k, color: color, alpha: alpha * fog(c), glow: glow }); }
    // dopamine neurons: reward (PAM) glows when things went better than expected, punishment (PPL1) when worse
    for (i = 0; i < byGroup.pam.length; i++) ball(byGroup.pam[i], 1.6 + 1.6 * reward, reward > 0.02 ? COLORS.posHi : COLORS.pos, 0.35 + 0.65 * reward, reward * 0.3);
    for (i = 0; i < byGroup.ppl1.length; i++) ball(byGroup.ppl1[i], 2.6 + 3 * punish, punish > 0.02 ? COLORS.negHi : COLORS.neg, 0.5 + 0.5 * punish, punish * 0.8);
    // projection neurons: brightness = how strongly their smell channel is driven
    for (i = 0; i < byGroup.pn.length; i++) { c = byGroup.pn[i]; a = on ? view.glom[circuit.pn.glom[c.i]] : 0; ball(c, 2 + 2 * a, a > 0.5 ? COLORS.actHi : COLORS.act, 0.3 + 0.7 * a, a > 0.5 ? a * 0.6 : 0); }
    // Kenyon cells: only the few that respond to this smell
    for (i = 0; i < view.kc.length; i++) { c = byGroup.kc[view.kc[i][0]]; a = Math.min(1, view.kc[i][1] * 9); ball(c, 1.3 + 1.5 * a, COLORS.actHi, 0.55 + 0.45 * a, a * 0.5); }
    // output neurons: size and brightness relative to their response before any learning
    for (i = 0; i < byGroup.mbon.length; i++) {
      c = byGroup.mbon[i]; a = on ? Math.min(2, view.mbon[c.i] / (vb.mbonBaseline[c.i] || 1)) : 0;
      ball(c, 2.6 + 2.2 * a, vb.valence[c.i] > 0 ? COLORS.pos : COLORS.neg, 0.45 + 0.3 * a, a > 1 ? (a - 1) * 0.7 : 0);
    }
    balls.sort(function (p, q) { return q.c.depth - p.c.depth; });
    for (i = 0; i < balls.length; i++) {
      var b = balls[i], r = b.r;
      if (b.glow > 0.02) {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, b.glow) * 0.55;
        ctx.drawImage(sprite(b.color, 'glow'), b.c.px - r * 2.8, b.c.py - r * 2.8, r * 5.6, r * 5.6);
      }
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = b.alpha;
      ctx.drawImage(sprite(b.color, 'ball'), b.c.px - r, b.c.py - r, 2 * r, 2 * r);
    }
    ctx.globalCompositeOperation = 'source-over';
    drawGizmo();
    $('scope-state').textContent = fade > 0 ? (view.dopamine > 0 ? 'reward dopamine' : 'punishment dopamine') : (view.label || ' ');
  }
  function showOdor(odor, label, brain) {      // brain: another fly's (the poker table), else this one's
    var b = view.brain = brain || S.brain;
    view.odor = odor; view.label = label;
    b.glomerulusPattern(odor, view.glom);
    view.kc = b.activeKenyonCells(odor);
    b.respond(odor); view.mbon.set(b.mbon);
    view.changed = true;
  }
  function flashDopamine(surprise) {
    if (surprise === null || surprise === undefined || S.mode === 'blocked' || Math.abs(surprise) <= 0.05) { view.dopamine = 0; return; }
    view.dopamine = surprise; view.dopamineAt = performance.now(); view.changed = true;
  }

  /* shared tooltip */
  var tip = $('tip');
  function showTip(x, y, build) {
    tip.textContent = ''; build(tip); tip.hidden = false;
    var w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(6, Math.min(innerWidth - w - 6, x + 12)) + 'px';
    tip.style.top = (y + h + 22 > innerHeight ? y - h - 10 : y + 16) + 'px';
  }
  function hideTip() { tip.hidden = true; }
  function line(parent, strong, rest) {
    var d = document.createElement('div'), b = document.createElement('b');
    b.textContent = strong; d.appendChild(b); d.appendChild(document.createTextNode(rest)); parent.appendChild(d);
  }
  var GROUP_NAME = { kc: 'Kenyon cell', pn: 'Projection neuron', mbon: 'Output neuron', pam: 'Reward dopamine neuron (PAM)', ppl1: 'Punishment dopamine neuron (PPL1)' };
  function hold(ms) { cam.heldUntil = Math.max(cam.heldUntil, performance.now() + ms); }
  canvas.addEventListener('pointerdown', function (e) {
    if (e.button) return;
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    cam.vYaw = cam.vPitch = 0; hideTip();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* already released */ }
  });
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (performance.now() - drag.t > 80) cam.vYaw = cam.vPitch = 0;   // let go after resting: no fling
    drag = null; hold(2500);
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('dblclick', function () { cam.yaw = HOME.yaw; cam.pitch = HOME.pitch; cam.vYaw = cam.vPitch = 0; hold(2500); });
  canvas.addEventListener('keydown', function (e) {
    var k = { ArrowLeft: [-0.15, 0], ArrowRight: [0.15, 0], ArrowUp: [0, -0.12], ArrowDown: [0, 0.12] }[e.key];
    if (e.key === 'Home') { cam.yaw = HOME.yaw; cam.pitch = HOME.pitch; }
    else if (!k) return;
    else { cam.yaw += k[0]; cam.pitch = Math.max(-1.45, Math.min(1.2, cam.pitch + k[1])); }
    e.preventDefault(); hold(4000); view.changed = true;
  });
  if (self.IntersectionObserver) new IntersectionObserver(function (es) { visible = es[es.length - 1].isIntersecting; view.changed = true; }).observe(canvas);
  canvas.addEventListener('pointermove', function (e) {
    if (drag) {
      if (e.pointerId !== drag.id) return;
      var now = performance.now(), dx = e.clientX - drag.x, dy = e.clientY - drag.y, dt = Math.max(1, now - drag.t);
      cam.yaw += dx * 0.009; cam.pitch = Math.max(-1.45, Math.min(1.2, cam.pitch - dy * 0.009));
      cam.vYaw = dx * 0.009 / dt; cam.vPitch = -dy * 0.009 / dt;
      drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
      return;
    }
    if (e.pointerType === 'mouse') hold(1500);              // hold still while someone is reading a neuron
    var r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, best = null, bd = 144;
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i], d = (c.px - x) * (c.px - x) + (c.py - y) * (c.py - y);
      if (c.group !== 'kc') d *= 0.35;                       // the sparse neurons are easier to hit than the cloud
      d *= 1 + 0.25 * c.depth;                               // and nearer ones win over those behind them
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return hideTip();
    showTip(e.clientX, e.clientY, function (t) {
      var extra = best.group === 'mbon' ? (circuit.mbon.valence[best.i] > 0 ? ', drives approach' : ', drives avoidance') :
        best.group === 'pn' ? ', smell channel ' + circuit.glomeruli[circuit.pn.glom[best.i]] : '';
      line(t, best.type, ' · ' + GROUP_NAME[best.group] + extra);
      line(t, '', 'Body ID ' + best.id + ' in MaleCNS v1.0');
      if (best.guess) line(t, '', 'Its cell body is not in the connectome, so it is drawn at the middle of its group.');
    });
  });
  canvas.addEventListener('pointerleave', hideTip);

  /* ---------- the learning record ---------- */
  function signed(v, digits) { var s = Math.abs(v).toFixed(digits); return (v < 0 && +s !== 0 ? '−' : v > 0 ? '+' : '') + s; }
  function pct(v) { return (v < 0 ? '−' : '') + (Math.abs(v) * 100).toFixed(1) + '%'; }
  function count(n) { return Math.round(n).toLocaleString('en-US'); }
  function compact(n) { return n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n % 1e3 ? 1 : 0) + 'K' : String(n); }
  function niceMax(h) {
    var steps = [100, 200, 500], m = 1;
    for (;;) { for (var i = 0; i < 3; i++) if (steps[i] * m >= h) return steps[i] * m; m *= 10; }
  }

  var chart = { pts: [], x: null, y: null };
  function drawChart() {
    var svg = $('chart'), W = $('chart-wrap').clientWidth || 600, H = 240, narrow = W < 520;
    var m = { l: 44, r: narrow ? 12 : 118, t: 12, b: 26 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var c = S.curve, hands = S.brain.hands, last = { h: hands, s: S.skill }, pts = c[c.length - 1].h === hands ? c : c.concat([last]);
    var xmax = niceMax(Math.max(100, hands)), y0 = -0.34, y1 = 0;
    var X = function (h) { return m.l + iw * h / xmax; }, Y = function (v) { return m.t + ih * (y1 - Math.max(y0, Math.min(y1, v))) / (y1 - y0); };
    chart.pts = pts; chart.X = X; chart.Y = Y; chart.m = m; chart.W = W; chart.H = H;
    var s = '', i;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    for (i = 0; i <= 3; i++) {
      var v = -0.1 * i;
      s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="var(--line)" stroke-width="1"/>' +
        '<text x="' + (m.l - 8) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + (i ? '−' + i * 10 : '0') + '%</text>';
    }
    for (i = 0; i <= 2; i++) s += '<text x="' + X(xmax * i / 2) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? 'start' : i === 2 ? 'end' : 'middle') + '">' + compact(xmax * i / 2) + (i === 2 ? ' hands' : '') + '</text>';
    var refs = [['expert', REF.best], ['always stand', REF.stand], ['coin flip', REF.coin]];
    for (i = 0; i < refs.length; i++) {
      var y = Y(refs[i][1]);
      s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y + '" y2="' + y + '" stroke="var(--ink-3)" stroke-width="1"/>';
      s += narrow ? '<text x="' + (W - m.r - 4) + '" y="' + (y + 13) + '" text-anchor="end">' + refs[i][0] + '</text>'
        : '<text x="' + (W - m.r + 8) + '" y="' + (y + 4) + '">' + refs[i][0] + ' ' + pct(refs[i][1]) + '</text>';
    }
    var d = '';
    for (i = 0; i < pts.length; i++) d += (i ? 'L' : 'M') + X(pts[i].h).toFixed(1) + ' ' + Y(pts[i].s).toFixed(1);
    s += '<path d="' + d + '" fill="none" stroke="var(--accent-line)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    var e = pts[pts.length - 1];
    s += '<circle cx="' + X(e.h) + '" cy="' + Y(e.s) + '" r="4.5" fill="var(--accent-line)" stroke="var(--bg)" stroke-width="2"/>';
    s += '<line id="cross" y1="' + m.t + '" y2="' + (H - m.b) + '" stroke="var(--ink-2)" stroke-width="1" visibility="hidden"/>';
    svg.innerHTML = s;
    // the same numbers as a table
    var rows = '<tr><th>Hands played</th><th>Result per hand</th></tr>', n = Math.min(12, pts.length);
    for (i = 0; i < n; i++) { var p = pts[Math.round(i * (pts.length - 1) / Math.max(1, n - 1))]; rows += '<tr><td>' + count(p.h) + '</td><td>' + pct(p.s) + '</td></tr>'; }
    $('chart-table').innerHTML = rows;
  }
  $('chart-wrap').addEventListener('pointermove', function (e) {
    var r = $('chart').getBoundingClientRect(), x = (e.clientX - r.left) * chart.W / r.width, pts = chart.pts, best = 0, bd = 1e9;
    if (!pts.length) return;
    for (var i = 0; i < pts.length; i++) { var d = Math.abs(chart.X(pts[i].h) - x); if (d < bd) { bd = d; best = i; } }
    var cross = $('cross');
    if (cross) { cross.setAttribute('x1', chart.X(pts[best].h)); cross.setAttribute('x2', chart.X(pts[best].h)); cross.setAttribute('visibility', 'visible'); }
    chart.hover = best;
    showTip(e.clientX, e.clientY, function (t) { line(t, pct(pts[best].s), ' per hand'); line(t, '', 'after ' + count(pts[best].h) + ' hands'); });
  });
  $('chart-wrap').addEventListener('pointerleave', function () { hideTip(); var c = $('cross'); if (c) c.setAttribute('visibility', 'hidden'); });

  /* strategy grids */
  var gridCells = [];
  function buildGrid(id, soft) {
    var t = $(id), html = '<tr><th></th>', d, total;
    for (d = 2; d <= 11; d++) html += '<th scope="col">' + (d === 11 ? 'A' : d) + '</th>';
    html += '</tr>';
    for (total = 20; total >= (soft ? 12 : 4); total--) {
      html += '<tr><th class="row" scope="row">' + total + '</th>';
      for (d = 2; d <= 11; d++) html += '<td data-s="' + BJ.stateIndex(total, soft, d) + '" data-t="' + total + '" data-d="' + d + '" data-soft="' + (soft ? 1 : 0) + '"></td>';
      html += '</tr>';
    }
    t.innerHTML = html;
    Array.prototype.forEach.call(t.querySelectorAll('td'), function (td) { gridCells.push(td); });
    t.addEventListener('pointermove', function (e) {
      var td = e.target.closest && e.target.closest('td');
      if (!td) return hideTip();
      var s = +td.dataset.s, p = S.habits[s], bestHit = BEST[s] === 1;
      showTip(e.clientX, e.clientY, function (tp) {
        line(tp, (td.dataset.soft === '1' ? 'Soft ' : 'Hard ') + td.dataset.t, ' against dealer ' + (td.dataset.d === '11' ? 'ace' : td.dataset.d));
        line(tp, Math.round(100 * p) + '%', ' of the time the fly hits');
        line(tp, '', 'An expert ' + (bestHit ? 'hits' : 'stands') + ' here');
      });
    });
    t.addEventListener('pointerleave', hideTip);
  }
  function drawGrids() {
    var agree = 0;
    for (var i = 0; i < gridCells.length; i++) {
      var td = gridCells[i], s = +td.dataset.s, p = S.habits[s], hit = p >= 0.5, ok = (hit ? 1 : 0) === BEST[s];
      td.style.setProperty('--p', p.toFixed(3));
      td.textContent = hit ? 'H' : 'S';
      td.className = (p > 0.55 ? 'hi' : '') + (ok ? '' : ' off');
      if (ok) agree++;
    }
    return agree / gridCells.length;
  }

  function drawRecent() {
    var box = $('recent'), html = '';
    for (var i = S.recent.length - 1; i >= 0; i--) {
      var r = S.recent[i];
      html += '<span class="' + (r > 0 ? 'won' : r === 0 ? 'even' : '') + '">' + (r ? signed(r, r % 1 ? 1 : 0) : '0') + '</span>';
    }
    box.innerHTML = html || '<span>none yet</span>';
  }

  var lastRefresh = 0;
  function refresh(force) {
    var now = performance.now();
    if (!force && now - lastRefresh < 250) return;
    lastRefresh = now;
    var b = S.brain;
    S.habits = b.policy(false); S.skill = BJ.expectedReturn(S.habits);
    if (S.rateT && now - S.rateT > 400) { S.rate = (b.hands - S.rateH) / ((now - S.rateT) / 1000); S.rateT = now; S.rateH = b.hands; }
    if (!S.rateT) { S.rateT = now; S.rateH = b.hands; S.rate = 0; }
    $('t-hands').textContent = count(b.hands);
    $('t-rate').textContent = playing && S.rate >= 5 ? count(S.rate) + ' hands a second' : ' ';
    $('t-skill').textContent = pct(S.skill);
    $('t-agree').textContent = Math.round(100 * drawGrids()) + '%';
    $('t-bank').textContent = signed(S.bank, 0).replace(/\d+/, function (n) { return count(+n); });
    drawRecent();
    drawChart();
    if (speed !== 'watch' && S.last && shown.hand !== S.last) {     // show the latest finished hand
      var h = S.last, d = h.trace && h.trace[h.trace.length - 1];
      showHand(h); showChoice(d || null); announce(h);
      if (d) showOdor(d.odor, 'last choice: "' + (d.hit ? 'hit' : 'stand') + '"');
      flashDopamine(h.surprise);
    }
  }

  /* ---------- main loop ---------- */
  var due = 0, prev = 0, suspended = false;   // suspended: the poker tab is showing
  function frame(now) {
    var dt = Math.min(100, now - (prev || now)); prev = now;
    if (playing && !suspended) {
      if (speed === 'watch') {
        if (!watch.step) { watch.step = stepDeal; watch.at = now; }
        if (now >= watch.at) { var next = watch.step(); watch.step = next[0]; watch.at = now + next[1]; refresh(true); }
      } else if (speed === 'fast') {
        due += dt * 0.012;
        while (due >= 1) { quickHand(); due--; }
      } else {
        var t0 = performance.now();
        while (performance.now() - t0 < 12) for (var i = 0; i < 40; i++) quickHand();
      }
    }
    if (!suspended) { refresh(false); scene.tick(now, playing && speed !== 'watch'); }
    drawBrain(now);
    requestAnimationFrame(frame);
  }

  /* ---------- controls ---------- */
  function setPlaying(p) { playing = p; $('play').textContent = p ? 'Pause' : 'Play'; if (!p) save(); S.rateT = 0; }
  $('play').addEventListener('click', function () { setPlaying(!playing); });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="speed"]'), function (r) {
    r.addEventListener('change', function () {
      if (!r.checked) return;
      if (speed === 'watch' && r.value !== 'watch') finishWatchHand();
      speed = r.value; watch.step = null; S.rateT = 0; due = 0;
      if (!playing) setPlaying(true);
    });
  });
  $('mode').addEventListener('change', function () { finishWatchHand(); save(); useMode($('mode').value); });
  $('reset').addEventListener('click', function () { $('reset-confirm').hidden = false; $('reset').hidden = true; });
  $('reset-no').addEventListener('click', function () { $('reset-confirm').hidden = true; $('reset').hidden = false; });
  $('reset-yes').addEventListener('click', function () {
    $('reset-confirm').hidden = true; $('reset').hidden = false;
    watch.hand = null; delete sessions[mode];
    if (mode === 'intact') { try { localStorage.removeItem(STORE_KEY); } catch (e) { /* nothing stored */ } }
    useMode(mode);
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) save(); });
  setInterval(save, 15000);
  if (self.ResizeObserver) new ResizeObserver(function () { fit(); if (S) drawChart(); }).observe($('brain'));
  else addEventListener('resize', function () { fit(); drawChart(); });

  /* ---------- start ---------- */
  buildGrid('grid-hard', false); buildGrid('grid-soft', true);
  restore();
  useMode('intact');
  fit();
  $('play').textContent = playing ? 'Pause' : 'Play';
  if (!playing) {                        // reduced motion: show one finished hand and wait for Play
    var h = S.brain.playHand(BJ, false); S.brain.hands--; S.last = h;
    var d = h.trace[h.trace.length - 1];
    showHand(h); showChoice(d || null); if (d) showOdor(d.odor, 'last choice');
  }
  requestAnimationFrame(frame);
  /* The poker tab borrows the brain view and pauses this table while it shows. */
  var scopeEl = document.querySelector('.scope');
  self.FlyJack = {
    sessions: sessions, current: function () { return S; }, circuit: circuit,
    suspend: function (on) {
      if (on === suspended) return;
      suspended = on; prev = 0;
      if (on) { save(); return; }
      view.brain = null; view.odor = -1; view.dopamine = 0; view.label = ' '; view.changed = true;
      S.rateT = 0; refresh(true);
    },
    scope: {
      mount: function (slot) { if (scopeEl.parentNode !== slot) slot.appendChild(scopeEl); view.changed = true; },
      show: function (brain, odor, label) { showOdor(odor, label, brain); },
      dopamine: function (surprise) {
        if (surprise === null || surprise === undefined || Math.abs(surprise) <= 0.05) return;
        view.dopamine = surprise; view.dopamineAt = performance.now(); view.changed = true;
      }
    }
  };
})();

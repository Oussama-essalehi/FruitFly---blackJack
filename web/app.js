/* FlyJack - the page: runs the table (drawn by web/casino.js), drives the brain model (web/brain3d.js), keeps the learning record. */
(function () {
  'use strict';
  var BJ = self.Blackjack, FB = self.FlyBrain;
  var circuit = JSON.parse(document.getElementById('circuit-data').textContent);
  var $ = function (id) { return document.getElementById(id); };
  var reduceMotion = !!(self.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  var MODES = {
    intact: { options: {}, note: 'The circuit as it was mapped. A fresh fly plays close to a coin flip and gets better with every hand.' },
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
    var s = { mode: m, brain: new FB.Brain(circuit, opts), bank: 0, recent: [], curve: [], every: 10, last: null, dirty: false };
    s.curve.push({ h: 0, s: skillOf(s.brain) });
    return s;
  }
  function skillOf(brain) { return BJ.expectedReturn(brain.policy(false)); }
  function useMode(m) {
    mode = m;
    S = sessions[m] || (sessions[m] = newSession(m));
    watch.step = null; view.odor = -1; view.dopamine = 0;
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
  var playing = true;                 // the table has no pause button: it plays whenever it is on screen
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

  /* Watch mode: one hand shown step by step. Each step returns [nextStep, delayMs]; the delays
     follow how long the casino scene needs to act the step out. */
  function stepDeal() {
    var hand = watch.hand = new BJ.Hand(S.brain.rng); watch.trace = [];
    view.odor = -1; view.dopamine = 0; view.label = 'waiting'; view.changed = true;
    reportRest();
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

  /* ---------- the brain view: the whole nervous system in 3D (drawn by web/brain3d.js) ---------- */
  var canvas = $('brain'), B3 = self.Brain3D, cloud = JSON.parse($('cloud-data').textContent), space = new B3.Space(cloud);
  var ROLE = { act: B3.rgb('#2ee6a8'), pos: B3.rgb('#4d8dff'), neg: B3.rgb('#ff5a45') };   // activity, approach / reward, avoid / punishment
  var view = { odor: -1, glom: new Float32Array(circuit.glomeruli.length), kc: [], mbon: new Float32Array(circuit.mbon.type.length), dopamine: 0, dopamineAt: 0, label: '', changed: true, w: 0, h: 0 };
  var cells = [];   // the learning circuit's neurons: {x, y, z (model space: y up, z towards the back), n (position in this list), group, i, type, id}
  var byGroup = {};
  (function layout() {
    ['kc', 'pn', 'mbon', 'pam', 'ppl1'].forEach(function (g) {
      var c = circuit[g], seen = {};
      c.soma.forEach(function (q) { seen[q] = (seen[q] || 0) + 1; });   // cells with no soma in the connectome share their group's median
      byGroup[g] = c.soma.map(function (q, i) {
        var m = space.toModel(q), cell = { x: m[0], y: m[1], z: m[2], n: cells.length, group: g, i: i, type: c.type[i], id: c.bodyId[i], guess: seen[q] > 1 };
        cells.push(cell);
        return cell;
      });
    });
  })();
  var model = B3.create(canvas, cloud, cells);
  if (!model) { canvas.hidden = true; $('scope-state').textContent = 'this browser cannot draw the 3D model'; }

  /* the camera: turntable yaw, tilt (pitch), slow spin unless reduced motion; drag to turn.
     Two framings: the whole nervous system, or close on the brain where the learning circuit is. */
  var HOME = { yaw: -2.45, pitch: -0.45 };
  var FRAMES = { whole: { zoom: 1, target: [0, -0.06, 0] }, brain: { zoom: 1.7, target: space.toModel(cloud.brainCentre) } };
  var cam = { yaw: HOME.yaw, pitch: HOME.pitch, vYaw: 0, vPitch: 0, spin: reduceMotion ? 0 : 0.00012, heldUntil: 0, dist: 4.2, base: 1, zoom: 1, scale: 1, cx: 0, cy: 0,
    tx: FRAMES.whole.target[0], ty: FRAMES.whole.target[1], tz: FRAMES.whole.target[2], frame: 'whole' };
  var drag = null, visible = true, lastDraw = 0, seeThrough = true;
  try { seeThrough = localStorage.getItem('flyjack.brainSolid') !== '1'; } catch (e) { /* no storage: start see-through */ }
  view.focus = 0; view.ghost = seeThrough ? 1 : 0;
  function project(c) {             // the same maths as the shaders in web/brain3d.js
    var cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    var x = c.x - cam.tx, y = c.y - cam.ty, z = c.z - cam.tz;
    var x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
    var y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp, k = cam.dist / (cam.dist + z2);
    c.px = cam.cx + x1 * k * cam.scale; c.py = cam.cy - y2 * k * cam.scale; c.k = k; c.depth = z2;
  }
  function fit() {
    var r = canvas.getBoundingClientRect(), dpr = Math.min(2, self.devicePixelRatio || 1);
    if (!r.width) return;
    view.w = r.width; view.h = r.height;
    cam.cx = r.width / 2; cam.cy = r.height / 2;
    cam.base = Math.min(r.width / 2.05, r.height / 1.42);
    if (model) { model.resize(r.width, r.height, dpr); model.setPaper(getComputedStyle(canvas.parentNode).getPropertyValue('--scope').trim() || '#0b0c12'); }
    view.changed = true;
    if (model && S) drawBrain(performance.now());      // resizing empties the picture: draw it again at once, not a frame later
  }
  function setFrame(name) {
    cam.frame = name; view.changed = true;
    $('scope-frame').textContent = name === 'brain' ? 'Zoom out' : 'Zoom in';
    $('scope-frame').setAttribute('aria-pressed', name === 'brain' ? 'true' : 'false');
  }
  function setSeeThrough(on) {
    seeThrough = on; view.changed = true;
    $('scope-ghost').textContent = on ? 'Full colours' : 'Fade it';
    $('scope-ghost').setAttribute('aria-pressed', on ? 'true' : 'false');
    try { localStorage.setItem('flyjack.brainSolid', on ? '0' : '1'); } catch (e) { /* not remembered */ }
  }
  /* which circuit neurons are lit, and how strongly; pop 1..0 makes them swell briefly as a new smell arrives */
  function paintActivity(fade, pop) {
    var i, c, a, on = view.odor >= 0, vb = view.brain || S.brain, big = (1 + 0.3 * view.ghost) * (1 + 0.55 * pop * pop);
    var reward = view.dopamine > 0 ? fade * Math.min(1, view.dopamine * 1.5 + 0.25) : 0;
    var punish = view.dopamine < 0 ? fade * Math.min(1, -view.dopamine * 1.5 + 0.25) : 0;
    model.clearActivity();
    // dopamine neurons: reward (PAM) lights up when things went better than expected, punishment (PPL1) when worse
    if (reward > 0.02) for (i = 0; i < byGroup.pam.length; i++) model.light(byGroup.pam[i].n, ROLE.pos, (0.018 + 0.012 * reward) * (1 + 0.3 * view.ghost), reward);
    if (punish > 0.02) for (i = 0; i < byGroup.ppl1.length; i++) model.light(byGroup.ppl1[i].n, ROLE.neg, (0.03 + 0.024 * punish) * (1 + 0.3 * view.ghost), punish);
    if (on) {
      // projection neurons: the smell channels this choice drives
      for (i = 0; i < byGroup.pn.length; i++) { c = byGroup.pn[i]; a = view.glom[circuit.pn.glom[c.i]]; if (a > 0.2) model.light(c.n, ROLE.act, (0.018 + 0.014 * a) * big, 0.35 + 0.65 * a); }
      // Kenyon cells: only the few that respond to this smell
      for (i = 0; i < view.kc.length; i++) { c = byGroup.kc[view.kc[i][0]]; a = Math.min(1, view.kc[i][1] * 9); model.light(c.n, ROLE.act, (0.013 + 0.01 * a) * big, 0.6 + 0.4 * a); }
      // output neurons: size and strength relative to their response before any learning
      for (i = 0; i < byGroup.mbon.length; i++) {
        c = byGroup.mbon[i]; a = Math.min(2, view.mbon[c.i] / (vb.mbonBaseline[c.i] || 1));
        if (a > 0.15) model.light(c.n, vb.valence[c.i] > 0 ? ROLE.pos : ROLE.neg, (0.02 + 0.012 * a) * big, Math.min(1, 0.45 + 0.35 * a));
      }
    }
    model.commitActivity();
    return on || reward > 0.02 || punish > 0.02;
  }
  function drawBrain(now) {
    var dt = Math.min(64, now - (lastDraw || now)); lastDraw = now;
    var fade = view.dopamine ? Math.max(0, 1 - (now - view.dopamineAt) / 1500) : 0;
    var pop = reduceMotion ? 0 : Math.max(0, 1 - (now - (view.popAt || 0)) / 380);
    var f = FRAMES[cam.frame], ease = 1 - Math.pow(0.992, dt);
    var settling = Math.abs(cam.zoom - f.zoom) > 0.002 || Math.abs(cam.tx - f.target[0]) + Math.abs(cam.ty - f.target[1]) + Math.abs(cam.tz - f.target[2]) > 0.002;
    var moving = !!drag || settling || Math.abs(cam.vYaw) > 1e-5 || Math.abs(cam.vPitch) > 1e-5 || (cam.spin && now > cam.heldUntil);
    if (!drag) {                    // inertia after a drag, then back to the slow spin
      cam.yaw += cam.vYaw * dt; cam.pitch = Math.max(-1.45, Math.min(1.2, cam.pitch + cam.vPitch * dt));
      cam.vYaw *= 0.92; cam.vPitch *= 0.92;
      if (cam.spin && now > cam.heldUntil) cam.yaw += cam.spin * dt;
    }
    if (settling) {                 // glide between the two framings
      cam.zoom += (f.zoom - cam.zoom) * ease;
      cam.tx += (f.target[0] - cam.tx) * ease; cam.ty += (f.target[1] - cam.ty) * ease; cam.tz += (f.target[2] - cam.tz) * ease;
    }
    cam.scale = cam.base * cam.zoom;
    if (!model || !visible || (!view.changed && !fade && !view.fading && !moving && !pop && !view.popping)) return;
    var redo = view.changed || fade > 0 || view.fading || pop > 0 || view.popping;
    view.fading = fade > 0; view.popping = pop > 0; view.changed = false;
    if (!view.w) return;
    var wash = !seeThrough && view.lit ? 0.12 : 0, ghost = seeThrough ? 1 : 0;
    view.focus += (wash - view.focus) * Math.min(1, dt / 220); view.ghost += (ghost - view.ghost) * Math.min(1, dt / 260);
    if (Math.abs(view.focus - wash) > 0.004 || Math.abs(view.ghost - ghost) > 0.004) view.changed = true;   // keep drawing until it settles
    if (redo || view.changed) view.lit = paintActivity(fade, pop);
    model.render(cam, view.focus, view.ghost);
    $('scope-state').textContent = fade > 0 ? (view.dopamine > 0 ? 'reward dopamine' : 'punishment dopamine') : (view.label || ' ');
  }
  var vbLast = null;
  function showOdor(odor, label, brain) {      // brain: another fly's (the poker table), else this one's
    var b = view.brain = brain || S.brain;
    if (odor !== view.odor || b !== vbLast) view.popAt = performance.now();
    vbLast = b; view.odor = odor; view.label = label;
    b.glomerulusPattern(odor, view.glom);
    view.kc = b.activeKenyonCells(odor);
    b.respond(odor); view.mbon.set(b.mbon);
    view.changed = true;
    report(b, label, 0);
  }
  /* The read-out over the casino (web/scene3d.js): how many of the circuit's cells this smell
     drives, and one raster column for a fixed sample of 96 of them. */
  var SAMPLE = (function () {
    var rows = [], kinds = [];
    function take(group, n, kind) { var list = byGroup[group]; for (var i = 0; i < n; i++) { rows.push(list[Math.floor(i * list.length / n)]); kinds.push(kind); } }
    take('pn', 24, 0); take('kc', 50, 1); take('mbon', 16, 2);
    for (var d = 0; d < 6; d++) { rows.push(null); kinds.push(3); }      // the last six rows: three for reward dopamine, three for punishment
    return { cells: rows, kinds: kinds, values: new Float32Array(rows.length) };
  })();
  function report(b, label, dopamine) {
    var v = SAMPLE.values, lit = {}, active = 0, i, c;
    v.fill(0);
    if (dopamine) {                                     // a burst of dopamine: only those neurons fire
      active = dopamine > 0 ? byGroup.pam.length : byGroup.ppl1.length;
      for (i = 0; i < 3; i++) v[v.length - (dopamine > 0 ? 6 : 3) + i] = Math.min(1, Math.abs(dopamine) * 1.5 + 0.25);
    } else {
      for (i = 0; i < view.kc.length; i++) { lit[view.kc[i][0]] = Math.min(1, view.kc[i][1] * 9); active++; }
      for (i = 0; i < byGroup.pn.length; i++) if (view.glom[circuit.pn.glom[i]] > 0.2) active++;
      for (i = 0; i < byGroup.mbon.length; i++) if (view.mbon[i] / (b.mbonBaseline[i] || 1) > 0.15) active++;
      for (i = 0; i < SAMPLE.cells.length; i++) {
        c = SAMPLE.cells[i]; if (!c) continue;
        v[i] = c.group === 'pn' ? view.glom[circuit.pn.glom[c.i]] : c.group === 'kc' ? (lit[c.i] || 0) : Math.min(1, view.mbon[c.i] / (b.mbonBaseline[c.i] || 1) / 2);
      }
    }
    self.Scene3D.pulse({ state: label, active: active, total: cells.length, rows: v, kinds: SAMPLE.kinds, hold: dopamine ? 1500 : 0 });
  }
  function reportRest() { SAMPLE.values.fill(0); self.Scene3D.pulse({ state: 'waiting', active: 0, total: cells.length, rows: SAMPLE.values, kinds: SAMPLE.kinds }); }
  function flashDopamine(surprise) {
    if (surprise === null || surprise === undefined || S.mode === 'blocked' || Math.abs(surprise) <= 0.05) { view.dopamine = 0; return; }
    view.dopamine = surprise; view.dopamineAt = performance.now(); view.changed = true;
    report(view.brain || S.brain, surprise > 0 ? 'reward dopamine' : 'punishment dopamine', surprise);
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
      var c = cells[i]; project(c);
      var d = (c.px - x) * (c.px - x) + (c.py - y) * (c.py - y);
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
  $('scope-frame').addEventListener('click', function () { setFrame(cam.frame === 'brain' ? 'whole' : 'brain'); hold(1500); });
  $('scope-ghost').addEventListener('click', function () { setSeeThrough(!seeThrough); });
  setSeeThrough(seeThrough);

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
    $('t-hands').textContent = count(b.hands);
    $('t-skill').textContent = pct(S.skill);
    $('t-agree').textContent = Math.round(100 * drawGrids()) + '%';
    $('t-bank').textContent = signed(S.bank, 0).replace(/\d+/, function (n) { return count(+n); });
    drawRecent();
    drawChart();
  }

  /* ---------- main loop ---------- */
  var suspended = false;   // suspended: the poker tab is showing
  function frame(now) {
    if (playing && !suspended) {
      if (!watch.step) { watch.step = stepDeal; watch.at = now; }
      if (now >= watch.at) { var next = watch.step(); watch.step = next[0]; watch.at = now + next[1]; refresh(true); }
    }
    if (!suspended) { refresh(false); scene.tick(now, false); }
    drawBrain(now);
    requestAnimationFrame(frame);
  }

  /* ---------- keeping the fly's memory ---------- */
  document.addEventListener('visibilitychange', function () { if (document.hidden) save(); });
  setInterval(save, 15000);
  if (self.ResizeObserver) new ResizeObserver(function () { fit(); if (S) drawChart(); }).observe($('brain'));
  else addEventListener('resize', function () { fit(); drawChart(); });

  /* ---------- start ---------- */
  function measureHeader() {            // the stage fills the window under the header (web/page.html)
    var bar = document.querySelector('.topbar');
    if (bar) document.documentElement.style.setProperty('--topbar-h', bar.offsetHeight + 'px');
  }
  measureHeader(); addEventListener('resize', measureHeader);
  buildGrid('grid-hard', false); buildGrid('grid-soft', true);
  restore();
  useMode('intact');
  fit();
  requestAnimationFrame(frame);
  /* The poker tab borrows the brain view and pauses this table while it shows. */
  var scopeEl = document.querySelector('.scope');
  self.FlyJack = {
    sessions: sessions, current: function () { return S; }, circuit: circuit,
    suspend: function (on) {
      if (on === suspended) return;
      suspended = on;
      if (on) { save(); return; }
      view.brain = null; view.odor = -1; view.dopamine = 0; view.label = ' '; view.changed = true;
      refresh(true);
    },
    scope: {
      mount: function (slot) { if (scopeEl.parentNode !== slot) slot.appendChild(scopeEl); view.changed = true; },
      show: function (brain, odor, label) { showOdor(odor, label, brain); },
      dopamine: function (surprise) {
        if (surprise === null || surprise === undefined || Math.abs(surprise) <= 0.05) return;
        view.dopamine = surprise; view.dopamineAt = performance.now(); view.changed = true;
        report(view.brain || S.brain, surprise > 0 ? 'reward dopamine' : 'punishment dopamine', surprise);
      }
    }
  };
})();

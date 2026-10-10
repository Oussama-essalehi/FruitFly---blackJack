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

  /* ---------- the brain view ---------- */
  var canvas = $('brain'), ctx = canvas.getContext('2d'), base = document.createElement('canvas');
  var COLORS = { act: '#199e70', actHi: '#7df0c4', pos: '#3987e5', posHi: '#a9d0ff', neg: '#d95926', negHi: '#ffb08a', dim: 'rgba(201,212,205,0.20)' };
  var view = { odor: -1, glom: new Float32Array(circuit.glomeruli.length), kc: [], mbon: new Float32Array(circuit.mbon.type.length), dopamine: 0, dopamineAt: 0, label: '', changed: true, w: 0, h: 0 };
  var cells = [];   // every neuron once: {x, y (0..1), group, i, type, id}
  (function layout() {
    var groups = ['kc', 'pn', 'mbon', 'pam', 'ppl1'], minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, g, i;
    for (g = 0; g < groups.length; g++) for (i = 0; i < circuit[groups[g]].soma.length; i++) {
      var p = circuit[groups[g]].soma[i];
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
    }
    for (g = 0; g < groups.length; g++) for (i = 0; i < circuit[groups[g]].soma.length; i++) {
      var q = circuit[groups[g]].soma[i], c = circuit[groups[g]];
      cells.push({ x: (q[0] - minX) / (maxX - minX), y: (q[2] - minZ) / (maxZ - minZ), group: groups[g], i: i, type: c.type[i], id: c.bodyId[i] });
    }
    view.aspect = (maxX - minX) / (maxZ - minZ);
  })();
  var byGroup = {};
  cells.forEach(function (c) { (byGroup[c.group] = byGroup[c.group] || []).push(c); });

  function fit() {
    var r = canvas.getBoundingClientRect(), dpr = Math.min(2, self.devicePixelRatio || 1);
    if (!r.width) return;
    view.w = r.width; view.h = r.height;
    canvas.width = base.width = Math.round(r.width * dpr); canvas.height = base.height = Math.round(r.height * dpr);
    var pad = 14, w = r.width - 2 * pad, h = r.height - 2 * pad, sc = Math.min(w / view.aspect, h);
    var ox = pad + (w - sc * view.aspect) / 2, oy = pad + (h - sc) / 2;
    cells.forEach(function (c) { c.px = ox + c.x * sc * view.aspect; c.py = oy + c.y * sc; });
    var b = base.getContext('2d'); b.setTransform(dpr, 0, 0, dpr, 0, 0); b.clearRect(0, 0, r.width, r.height);
    b.fillStyle = COLORS.dim;
    byGroup.kc.forEach(function (c) { b.fillRect(c.px - 0.6, c.py - 0.6, 1.2, 1.2); });
    view.dpr = dpr; view.changed = true;
  }
  function dot(c, r, color, alpha) { ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(c.px, c.py, r, 0, 6.2832); ctx.fill(); }
  function drawBrain(now) {
    var fade = view.dopamine ? Math.max(0, 1 - (now - view.dopamineAt) / 1500) : 0;
    if (!view.changed && !fade && !view.fading) return;
    view.fading = fade > 0; view.changed = false;
    if (!view.w) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    var i, c, a, on = view.odor >= 0;
    // dopamine neurons: reward (PAM) glows when things went better than expected, punishment (PPL1) when worse
    var reward = view.dopamine > 0 ? fade * Math.min(1, view.dopamine * 1.5 + 0.25) : 0;
    var punish = view.dopamine < 0 ? fade * Math.min(1, -view.dopamine * 1.5 + 0.25) : 0;
    for (i = 0; i < byGroup.pam.length; i++) { c = byGroup.pam[i]; dot(c, 1.6 + 1.6 * reward, reward > 0.02 ? COLORS.posHi : COLORS.pos, 0.28 + 0.72 * reward); }
    for (i = 0; i < byGroup.ppl1.length; i++) { c = byGroup.ppl1[i]; dot(c, 2.6 + 3 * punish, punish > 0.02 ? COLORS.negHi : COLORS.neg, 0.4 + 0.6 * punish); }
    // projection neurons: brightness = how strongly their smell channel is driven
    for (i = 0; i < byGroup.pn.length; i++) { c = byGroup.pn[i]; a = on ? view.glom[circuit.pn.glom[c.i]] : 0; dot(c, 2 + 2 * a, a > 0.5 ? COLORS.actHi : COLORS.act, 0.22 + 0.78 * a); }
    // Kenyon cells: only the few that respond to this smell
    for (i = 0; i < view.kc.length; i++) { c = byGroup.kc[view.kc[i][0]]; a = Math.min(1, view.kc[i][1] * 9); dot(c, 1.3 + 1.5 * a, COLORS.actHi, 0.45 + 0.55 * a); }
    // output neurons: size and brightness relative to their response before any learning
    for (i = 0; i < byGroup.mbon.length; i++) {
      c = byGroup.mbon[i]; a = on ? Math.min(2, view.mbon[c.i] / (S.brain.mbonBaseline[c.i] || 1)) : 0;
      dot(c, 2.6 + 2.2 * a, S.brain.valence[c.i] > 0 ? COLORS.pos : COLORS.neg, 0.3 + 0.35 * a);
      ctx.globalAlpha = 0.9; ctx.lineWidth = 1; ctx.strokeStyle = '#0a0e0c'; ctx.stroke();
    }
    ctx.globalAlpha = 1;
    $('scope-state').textContent = fade > 0 ? (view.dopamine > 0 ? 'reward dopamine' : 'punishment dopamine') : (view.label || ' ');
  }
  function showOdor(odor, label) {
    view.odor = odor; view.label = label;
    S.brain.glomerulusPattern(odor, view.glom);
    view.kc = S.brain.activeKenyonCells(odor);
    S.brain.respond(odor); view.mbon.set(S.brain.mbon);
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
  canvas.addEventListener('pointermove', function (e) {
    var r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, best = null, bd = 144;
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i], d = (c.px - x) * (c.px - x) + (c.py - y) * (c.py - y);
      if (c.group !== 'kc') d *= 0.35;                       // the sparse neurons are easier to hit than the cloud
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return hideTip();
    showTip(e.clientX, e.clientY, function (t) {
      var extra = best.group === 'mbon' ? (circuit.mbon.valence[best.i] > 0 ? ', drives approach' : ', drives avoidance') :
        best.group === 'pn' ? ', smell channel ' + circuit.glomeruli[circuit.pn.glom[best.i]] : '';
      line(t, best.type, ' · ' + GROUP_NAME[best.group] + extra);
      line(t, '', 'Body ID ' + best.id + ' in MaleCNS v1.0');
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
  var due = 0, prev = 0;
  function frame(now) {
    var dt = Math.min(100, now - (prev || now)); prev = now;
    if (playing) {
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
    refresh(false);
    scene.tick(now, playing && speed !== 'watch');
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
  self.FlyJack = { sessions: sessions, current: function () { return S; } };
})();

/* FlyJack - the poker game: five flies with their own copy of the circuit, one open seat, and
   anyone at this screen can sit down. Runs the hands, waits for people, teaches the flies. */
(function () {
  'use strict';
  var P = self.Poker, FB = self.FlyBrain, FJ = self.FlyJack;
  var $ = function (id) { return document.getElementById(id); };
  var reduceMotion = !!(self.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var STORE_KEY = 'flyjack.poker.v1', SEATS = 6, MINUS = '−';
  var STRAINS = [
    { name: 'Canton-S', note: 'wild type' }, { name: 'white', note: 'white eyes' }, { name: 'yellow', note: 'yellow body' },
    { name: 'ebony', note: 'dark body' }, { name: 'Curly', note: 'curled wings' }
  ];
  var ACTION_WORD = ['fold', 'call', 'raise'];
  var rng = FB.mulberry32((Math.random() * 1e9) | 0);

  /* ---------- the players ---------- */
  var flies = STRAINS.map(function (s, k) {
    return { kind: 'fly', k: k, name: s.name, note: s.note, look: s.name, brain: null, stack: P.START_STACK, profit: 0, hands: 0, won: 0, recent: [] };
  });
  var seats = [flies[0], flies[1], flies[2], null, flies[3], flies[4]];   // seat 3, at the front, is open
  var pending = {};                                                         // seat -> player or null, applied between hands
  var ready = false, active = false, playing = !reduceMotion, speed = 'watch', handsTotal = 0, buttonSeat = -1, biggest = null;
  var game = { hand: null, traces: {}, step: null, at: 0, waiting: false, pick: null, last: null, revealed: false, featured: -1 };
  var scene = null;

  function newBrain(f) {
    var o = { code: P.SMELLS, seed: 9173 + f.k * 7919 + ((Math.random() * 1e6) | 0) };
    for (var k in P.BRAIN_OPTIONS) o[k] = P.BRAIN_OPTIONS[k];
    return new FB.Brain(FJ.circuit, o);
  }
  function humans() { var n = 0; for (var i = 0; i < SEATS; i++) if (seats[i] && seats[i].kind === 'human') n++; return n; }
  function signed(v) { return (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(Math.round(v)); }
  function cardText(c) { return c.face + SceneKitPip(c.suit); }
  function SceneKitPip(s) { return self.SceneKit.PIPS[s]; }

  /* ---------- remembering the flies between visits ---------- */
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
  var dirty = false;
  function save() {
    if (!ready || !dirty) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ hands: handsTotal, flies: flies.map(function (f) {
        var mem = f.brain.exportMemory();
        return { hands: mem.hands, stack: f.stack, profit: f.profit, won: f.won, played: f.hands, recent: f.recent.slice(-300), edges: mem.strengths.length, strengths: b64(mem.strengths) };
      }) }));
      dirty = false;
    } catch (e) { /* storage full or blocked: the flies start fresh next time */ }
  }
  function restore() {
    try {
      var d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!d || !d.flies || d.flies.length !== flies.length) return;
      d.flies.forEach(function (m, k) {
        var f = flies[k];
        if (m.edges !== f.brain.nEdges || !f.brain.importMemory({ hands: m.hands, strengths: unb64(m.strengths) })) return;
        f.stack = Math.min(P.BANK_ABOVE, +m.stack || P.START_STACK); f.profit = +m.profit || 0; f.won = +m.won || 0; f.hands = +m.played || 0;
        f.recent = Array.isArray(m.recent) ? m.recent : [];
      });
      handsTotal = +d.hands || 0;
    } catch (e) { /* ignore a damaged save */ }
  }

  /* ---------- one hand ---------- */
  function applyPending() {
    var changed = false;
    for (var i = 0; i < SEATS; i++) if (i in pending) { seats[i] = pending[i]; delete pending[i]; changed = true; }
    if (changed) { scene.setSeats(seatList()); renderSeats(); syncSpeed(); }
  }
  function seatList() {
    return seats.map(function (p) { return p ? { kind: p.kind, name: p.name, look: p.look, stack: p.stack } : { kind: 'empty' }; });
  }
  function startHand() {
    applyPending();
    var players = [], i;
    for (i = 0; i < SEATS; i++) {
      var p = seats[i];
      if (!p) continue;
      if (p.stack < P.TOP_UP_BELOW || p.stack > P.BANK_ABOVE) { p.stack = P.START_STACK; scene.plate(i, { stack: p.stack }); }   // top up, or bank the winnings
      players.push({ seat: i, stack: p.stack });
    }
    if (players.length < 2) return null;
    for (i = 1; i <= SEATS; i++) { var s = (buttonSeat + i) % SEATS; if (seats[s]) { buttonSeat = s; break; } }
    var b = 0;
    players.forEach(function (q, k) { if (q.seat === buttonSeat) b = k; });
    game.hand = new P.Hand(players, b, rng); game.traces = {}; game.revealed = false;
    return game.hand;
  }
  function flyDecide(hand, i, sims) {
    var q = hand.p[i], f = seats[q.seat], sit = P.situation(hand, i, sims);
    var c = f.brain.choose(sit.state, sit.options.actions);
    (game.traces[q.seat] = game.traces[q.seat] || []).push({ odor: c.odor, inBefore: q.total });
    return { action: c.action, sit: sit, choice: c, fly: f };
  }
  /* The hand is over: stacks settle, every fly learns from what it won or lost. */
  function finishHand(hand) {
    handsTotal++; dirty = true;
    var pot = hand.pot();
    if (!biggest || pot > biggest.pot) {
      var w = hand.p[hand.winners[0].i];
      biggest = { pot: pot, text: (seats[w.seat] ? seats[w.seat].name : 'someone') + (hand.showdown ? ', ' + w.handName.toLowerCase() : '') + ', hand ' + handsTotal };
    }
    hand.p.forEach(function (q) {
      var p = seats[q.seat];
      if (!p) return;
      p.stack = q.stack; p.profit += q.net;
      if (p.kind !== 'fly') return;
      p.hands++; p.recent.push(q.net); if (p.recent.length > 1000) p.recent.shift();
      if (hand.winners.some(function (w) { return w.i === hand.p.indexOf(q); })) p.won++;
      // each choice is judged by what happened from then on: chips already in the pot are gone
      // whatever the fly does, so folding is always worth exactly 0 (12 chips count as one bet)
      var tr = game.traces[q.seat] || [];
      q.surprise = null;
      for (var k = 0; k < tr.length; k++) q.surprise = p.brain.learn(tr[k].odor, Math.max(-1, Math.min(1, (q.net + tr[k].inBefore) / 12)));
      p.brain.hands++;
    });
    game.last = hand;
  }
  function playQuick() {
    var hand = startHand();
    if (!hand) return null;
    while (!hand.done) {
      if (hand.toAct === -1) { hand.advance(); continue; }
      hand.act(flyDecide(hand, hand.toAct, 60).action);
    }
    finishHand(hand); game.hand = null;
    return hand;
  }

  /* ---------- Watch: one hand step by step. Each step returns [nextStep, delayMs] ---------- */
  function faceUp(seat) { return !!(seats[seat] && seats[seat].kind === 'human' && humans() === 1); }
  function stepDeal() {
    var hand = startHand();
    clearLog(); showMeters(null); say(' ', ' ');
    if (!hand) { scene.clear(); say('Waiting for players', 'A game needs at least two seats filled.'); return [stepDeal, 1500]; }
    log('New hand. ' + seats[buttonSeat].name + ' has the button.');
    return [stepNext, scene.deal(hand, faceUp)];
  }
  function stepNext() {
    var hand = game.hand;
    if (hand.done) return hand.showdown ? [stepShowdown, 300] : [stepPayout, 300];
    if (hand.toAct === -1) {
      var ms = scene.gather(hand.pot()), from = hand.board.length, dealt = hand.advance();
      if (hand.done) return [stepNext, ms];
      log(['', 'Flop', 'Turn', 'River'][hand.street] + ': ' + dealt.map(cardText).join(' '));
      return [stepNext, Math.max(ms, scene.board(dealt, from)) + 150];
    }
    var seat = hand.p[hand.toAct].seat;
    if (seats[seat].kind === 'fly') return [stepSniff, 150];
    waitForHuman(); return [null, 0];
  }
  function stepSniff() {
    var hand = game.hand, i = hand.toAct, d = game.pick = flyDecide(hand, i, 150), seat = hand.p[i].seat, lines = [];
    var o = d.sit.options, v = d.choice.values;
    o.actions.forEach(function (a) { lines.push({ label: actionLabel(a, o, hand), v: v[a] }); });
    scene.sniff(seat, lines);
    showMeters(d, hand);
    game.featured = seat;
    FJ.scope.show(d.fly.brain, d.choice.odor, d.fly.name + ' smells "' + actionLabel(d.action, o, hand) + '"');
    say(d.fly.name + ' is thinking', 'Holding ' + P.STRENGTH_NAMES[d.sit.strength] + ' cards for ' + (hand.inHand() - 1) + ' opponent' + (hand.inHand() > 2 ? 's' : '') + '.');
    return [stepFlyAct, 1050];
  }
  function stepFlyAct() {
    var hand = game.hand, i = hand.toAct, seat = hand.p[i].seat, ev = hand.act(game.pick.action);
    describeAct(ev);
    return [stepNext, scene.act(seat, ev, hand.p[i].stack)];
  }
  function stepShowdown() { return [stepPayout, scene.showdown(game.hand) + 700]; }
  function stepPayout() {
    var hand = game.hand;
    finishHand(hand);
    var ms = scene.payout(hand);
    hand.p.forEach(function (q) { scene.dopamine(q.seat, q.surprise); });
    announce(hand);
    game.hand = null;
    return [stepDeal, ms + 500];
  }
  function finishWatchHand() {                    // leaving Watch mid-hand: flies play it out at once
    var hand = game.hand;
    game.step = null; game.waiting = false; hideBar();
    if (!hand) return;
    while (!hand.done) {
      if (hand.toAct === -1) { hand.advance(); continue; }
      hand.act(flyDecide(hand, hand.toAct, 60).action);
    }
    finishHand(hand); game.hand = null;
  }

  /* ---------- people ---------- */
  function actionLabel(a, o, hand) { return a === P.FOLD ? 'fold' : a === P.CALL ? (o.toCall ? 'call' : 'check') : (hand.level === 0 ? 'bet' : 'raise'); }
  function waitForHuman() {
    var hand = game.hand, i = hand.toAct, seat = hand.p[i].seat, p = seats[seat], o = hand.options();
    if (!game.waiting) game.revealed = humans() === 1;
    game.waiting = true;
    scene.waitFor(seat); showMeters(null);
    say(p.name + ', your turn', o.toCall ? 'It costs ' + o.toCall + ' to stay in.' : 'Nobody has bet yet.');
    var bar = $('pk-actionbar');
    bar.hidden = false;
    $('pk-ab-name').textContent = p.name;
    $('pk-ab-label').textContent = game.revealed ? 'Your turn' : 'Pass the screen to';
    $('pk-reveal').hidden = game.revealed;
    $('pk-reveal').textContent = 'I\'m ' + p.name + ', show my cards';
    $('pk-fold').hidden = !game.revealed || !o.toCall;
    $('pk-call').hidden = !game.revealed;
    $('pk-raise').hidden = !game.revealed || !o.canRaise;
    $('pk-call').textContent = o.toCall ? 'Call ' + o.toCall : 'Check';
    $('pk-raise').textContent = (hand.level === 0 ? 'Bet ' : 'Raise to ') + o.raiseTo;
    showMyCards(game.revealed ? hand.p[i] : null);
    ($(game.revealed ? 'pk-call' : 'pk-reveal')).focus({ preventScroll: true });
  }
  function showMyCards(q) {
    var box = $('pk-ab-cards'), hand = game.hand;
    box.textContent = ''; $('pk-ab-hand').textContent = '';
    if (!q) return;
    q.hole.forEach(function (c) {
      var el = document.createElement('span');
      el.className = 'mcard' + (c.suit === 'h' || c.suit === 'd' ? ' red' : '');
      el.textContent = c.face + SceneKitPip(c.suit);
      box.appendChild(el);
    });
    var all = q.hole.concat(hand.board);
    var sit = P.situation(hand, hand.toAct, 300);
    $('pk-ab-hand').textContent = (hand.board.length ? P.describe(P.score(all)) + ' · ' : '') + 'about ' + Math.round(sit.equity * 100) + '% to win against ' + (hand.inHand() - 1);
  }
  function reveal() {
    if (!game.waiting) return;
    game.revealed = true;
    waitForHuman();                               // the cards show in the bar only, not on the table
  }
  function humanAct(action) {
    if (!game.waiting || !game.revealed) return;
    var hand = game.hand, i = hand.toAct, seat = hand.p[i].seat;
    var ev = hand.act(action);
    hideBar(); describeAct(ev);
    game.waiting = false;
    game.step = stepNext; game.at = performance.now() + scene.act(seat, ev, hand.p[i].stack);
  }
  function hideBar() { $('pk-actionbar').hidden = true; showMyCards(null); }
  $('pk-fold').addEventListener('click', function () { humanAct(P.FOLD); });
  $('pk-call').addEventListener('click', function () { humanAct(P.CALL); });
  $('pk-raise').addEventListener('click', function () { humanAct(P.RAISE); });
  $('pk-reveal').addEventListener('click', reveal);
  document.addEventListener('keydown', function (e) {
    if (!active || !game.waiting || !game.revealed || e.target.closest('input, select, textarea')) return;
    var k = e.key.toLowerCase();
    if (k === 'f' && !$('pk-fold').hidden) humanAct(P.FOLD);
    else if (k === 'c') humanAct(P.CALL);
    else if (k === 'r' && !$('pk-raise').hidden) humanAct(P.RAISE);
  });

  /* ---------- the panel beside the brain ---------- */
  function setMeter(which, v, picked, name) {
    var el = $('pk-meter-' + which), fill = el.querySelector('.fill'), val = el.querySelector('.val');
    el.classList.toggle('picked', !!picked);
    if (name) el.querySelector('.name').textContent = name;
    if (v === null || v === undefined) { fill.style.width = '0'; fill.style.left = '50%'; val.textContent = ' '; return; }
    var x = Math.max(-0.6, Math.min(0.6, v)) / 0.6 * 50;
    fill.style.left = (x < 0 ? 50 + x : 50) + '%'; fill.style.width = Math.abs(x) + '%';
    val.textContent = (v < 0 ? MINUS : '+') + Math.abs(v).toFixed(2);
  }
  function showMeters(d, hand) {
    if (!d) {
      ['fold', 'call', 'raise'].forEach(function (w) { setMeter(w, null, false); });
      $('pk-odds').textContent = ''; $('pk-choice-label').textContent = 'How each choice smells to the fly';
      return;
    }
    var o = d.sit.options, v = d.choice.values;
    $('pk-choice-label').textContent = 'How each choice smells to ' + d.fly.name;
    setMeter('fold', o.toCall ? v[P.FOLD] : null, d.action === P.FOLD, 'Fold');
    setMeter('call', v[P.CALL], d.action === P.CALL, o.toCall ? 'Call' : 'Check');
    setMeter('raise', o.canRaise ? v[P.RAISE] : null, d.action === P.RAISE, hand.level === 0 ? 'Bet' : 'Raise');
    $('pk-odds').textContent = Math.round(100 * d.choice.p[d.action]) + '% sure';
  }
  function say(what, why) { $('pk-verdict').textContent = what; $('pk-why').textContent = why; }
  function clearLog() { $('pk-log').textContent = ''; }
  function log(str) {
    var ol = $('pk-log'), li = document.createElement('li');
    li.textContent = str; ol.appendChild(li);
    while (ol.children.length > 7) ol.removeChild(ol.firstChild);
  }
  function describeAct(ev) {
    var name = seats[ev.seat].name;
    log(name + ' ' + (ev.type === 'fold' ? 'folds' : ev.type === 'check' ? 'checks' : ev.type === 'call' ? 'calls ' + ev.paid : (ev.type === 'bet' ? 'bets ' : 'raises to ') + ev.level));
  }
  function announce(hand) {
    var w = hand.winners.map(function (x) { return seats[hand.p[x.i].seat].name; });
    var q0 = hand.p[hand.winners[0].i];
    var what = w.join(' and ') + (w.length > 1 ? ' split ' : ' wins ') + hand.pot() + (hand.showdown ? ' with ' + q0.handName.toLowerCase() : '');
    log(what + (hand.showdown ? '' : ', everyone else folded'));
    var f = game.featured >= 0 && seats[game.featured] && seats[game.featured].kind === 'fly' ? game.featured : -1, why = ' ';
    hand.p.forEach(function (q) { if (q.seat === f && q.surprise !== null && q.surprise !== undefined) {
      var n = seats[f].name;
      why = q.surprise > 0.05 ? 'Better than ' + n + ' expected: reward dopamine fires.' : q.surprise < -0.05 ? 'Worse than ' + n + ' expected: punishment dopamine fires.' : 'About what ' + n + ' expected: dopamine stays quiet.';
      FJ.scope.dopamine(q.surprise);
    } });
    say(what, why);
  }

  /* ---------- who's at the table ---------- */
  function renderSeats() {
    var box = $('pk-seats');
    box.textContent = '';
    for (var i = 0; i < SEATS; i++) box.appendChild(seatCard(i));
  }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
  function seatCard(i) {
    var p = seats[i], next = i in pending ? pending[i] : undefined, card = el('div', 'seatcard' + (p ? ' ' + p.kind : ' empty'));
    card.appendChild(el('span', 'label', 'Seat ' + (i + 1) + (i === 2 || i === 3 ? ' · front' : '')));
    if (p) {
      card.appendChild(el('strong', 'who', p.name + (p.kind === 'human' ? ' (person)' : '')));
      card.appendChild(el('span', 'sub', p.kind === 'fly' ? p.note + ' · fly' : 'playing at this screen'));
      var st = el('span', 'num'); st.id = 'pk-seat-stack-' + i; st.textContent = 'stack ' + p.stack + ' · ' + signed(p.profit) + ' overall'; card.appendChild(st);
    } else {
      card.appendChild(el('strong', 'who', 'Open seat'));
    }
    if (next !== undefined) {
      card.appendChild(el('span', 'note', next ? next.name + ' sits down next hand' : 'leaves after this hand'));
      var undo = el('button', 'btn quiet', 'Undo'); undo.type = 'button';
      undo.addEventListener('click', function () { delete pending[i]; renderSeats(); syncSpeed(); });
      card.appendChild(undo);
      return card;
    }
    if (p) {
      var leave = el('button', 'btn quiet', p.kind === 'fly' ? 'Ask to leave' : 'Leave'); leave.type = 'button';
      leave.addEventListener('click', function () { change(i, null); });
      card.appendChild(leave);
      return card;
    }
    var form = el('form', 'join'), input = el('input'), sit = el('button', 'btn primary', 'Sit down');
    input.type = 'text'; input.id = 'pk-name-' + i; input.placeholder = 'Your name'; input.maxLength = 16; input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Name for seat ' + (i + 1));
    sit.type = 'submit';
    form.appendChild(input); form.appendChild(sit);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = input.value.trim().slice(0, 16);
      if (!name) { input.focus(); return; }
      change(i, { kind: 'human', name: name, look: null, stack: P.START_STACK, profit: 0 });
    });
    card.appendChild(form);
    var away = flies.filter(function (f) { return seats.indexOf(f) < 0 && !pendingHas(f); });
    if (away.length) {
      var row = el('div', 'join'), pick = el('select'), bring = el('button', 'btn quiet', 'Seat this fly');
      pick.setAttribute('aria-label', 'Fly for seat ' + (i + 1));
      away.forEach(function (f) { var o = el('option', '', f.name + ' (' + f.note + ')'); o.value = f.k; pick.appendChild(o); });
      bring.type = 'button';
      bring.addEventListener('click', function () { change(i, flies[+pick.value]); });
      row.appendChild(pick); row.appendChild(bring); card.appendChild(row);
    }
    return card;
  }
  function pendingHas(f) { for (var k in pending) if (pending[k] === f) return true; return false; }
  /* Sit someone down or stand them up: now if no hand is running, else after this hand. */
  function change(i, who) {
    if (game.hand) pending[i] = who;             // a hand is running: change seats when it ends
    else { seats[i] = who; scene.setSeats(seatList()); }
    renderSeats(); syncSpeed();
    if (who && who.kind === 'human' && !playing) setPlaying(true);
  }
  function focusSeat(i) {
    var input = $('pk-name-' + i);
    if (input) { input.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' }); input.focus({ preventScroll: true }); }
  }

  /* ---------- are they learning? ---------- */
  function policyStats(f) {
    var strong = 0, ns = 0, weak = 0, nw = 0, st, sn, pr;
    for (sn = 0; sn < P.N_STREET; sn++) for (pr = 0; pr < P.N_PRESSURE; pr++) {
      var acts = pr ? [P.FOLD, P.CALL, P.RAISE] : [P.CALL, P.RAISE];
      for (st = 8; st <= 9; st++) { strong += f.brain.preferences(P.stateIndex(st, sn, pr), acts)[P.RAISE]; ns++; }
      if (pr) for (st = 0; st <= 1; st++) { weak += f.brain.preferences(P.stateIndex(st, sn, pr), acts)[P.FOLD]; nw++; }
    }
    return { strong: strong / ns, weak: weak / nw };
  }
  function per100(f) {
    var r = f.recent, n = Math.min(r.length, 500), s = 0;
    for (var i = r.length - n; i < r.length; i++) s += r[i];
    return n ? 100 * s / n : null;
  }
  function pct(v) { return Math.round(v * 100) + '%'; }
  function drawBoard() {
    var rows = '<tr><th>Player</th><th>Stack</th><th>Overall</th><th>Per 100 hands, lately</th><th>Raises with strong hands</th><th>Folds weak hands to a bet</th></tr>';
    var everyone = flies.slice();
    seats.forEach(function (p) { if (p && p.kind === 'human') everyone.push(p); });
    everyone.forEach(function (p) {
      var sat = seats.indexOf(p) >= 0, s = p.kind === 'fly' ? policyStats(p) : null, r = p.kind === 'fly' ? per100(p) : null;
      rows += '<tr><td>' + esc(p.name) + (p.kind === 'fly' ? ' <span class="muted">' + p.note + (sat ? '' : ', not seated') + '</span>' : ' <span class="muted">person</span>') + '</td><td>' + p.stack + '</td><td>' + signed(p.profit) +
        '</td><td>' + (r === null ? '–' : signed(r)) + '</td><td>' + (s ? pct(s.strong) : '–') + '</td><td>' + (s ? pct(s.weak) : '–') + '</td></tr>';
    });
    $('pk-board').innerHTML = rows;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* the strategy grid of one fly: rows = how strong its cards are, columns = street x pressure */
  function buildGrid() {
    var t = $('pk-grid'), html = '<tr><th></th>', st, sn, pr;
    ['Before flop', 'Flop', 'Turn', 'River'].forEach(function (s) { html += '<th colspan="3" scope="colgroup" class="grp">' + s + '</th>'; });
    html += '</tr><tr><th></th>';
    for (sn = 0; sn < 4; sn++) html += '<th scope="col">free</th><th scope="col">bet</th><th scope="col">raise</th>';
    html += '</tr>';
    for (st = P.N_STRENGTH - 1; st >= 0; st--) {
      html += '<tr><th class="row" scope="row">' + P.STRENGTH_NAMES[st] + '</th>';
      for (sn = 0; sn < 4; sn++) for (pr = 0; pr < 3; pr++) html += '<td data-st="' + st + '" data-sn="' + sn + '" data-pr="' + pr + '"></td>';
      html += '</tr>';
    }
    t.innerHTML = html;
    var pick = $('pk-pick');
    flies.forEach(function (f) { var o = document.createElement('option'); o.value = f.k; o.textContent = f.name + ' (' + f.note + ')'; pick.appendChild(o); });
    pick.addEventListener('change', drawGrid);
  }
  function drawGrid() {
    var f = flies[+$('pk-pick').value];
    Array.prototype.forEach.call($('pk-grid').querySelectorAll('td'), function (td) {
      var pr = +td.dataset.pr, acts = pr ? [P.FOLD, P.CALL, P.RAISE] : [P.CALL, P.RAISE];
      var p = f.brain.preferences(P.stateIndex(+td.dataset.st, +td.dataset.sn, pr), acts), best = P.CALL;
      acts.forEach(function (a) { if (p[a] > p[best]) best = a; });
      td.className = 'a-' + ACTION_WORD[best];
      td.textContent = best === P.FOLD ? 'F' : best === P.CALL ? (pr ? 'C' : 'K') : 'R';
      td.title = (pr ? 'fold ' + pct(p[P.FOLD]) + ', call ' : 'check ') + pct(p[P.CALL]) + ', ' + (pr ? 'raise ' : 'bet ') + pct(p[P.RAISE]);
    });
  }

  var lastRefresh = 0, lastBoard = 0, rate = { t: 0, h: 0, v: 0 }, shownHand = null;
  function refresh(force) {
    var now = performance.now();
    if (!force && now - lastRefresh < 250) return;
    lastRefresh = now;
    if (!rate.t) { rate.t = now; rate.h = handsTotal; }
    else if (now - rate.t > 500) { rate.v = (handsTotal - rate.h) / ((now - rate.t) / 1000); rate.t = now; rate.h = handsTotal; }
    $('pk-t-hands').textContent = handsTotal.toLocaleString('en-US');
    $('pk-t-rate').textContent = playing && speed !== 'watch' && rate.v >= 2 ? Math.round(rate.v) + ' hands a second' : ' ';
    var best = null;
    flies.forEach(function (f) { var r = per100(f); if (r !== null && f.recent.length >= 50 && (!best || r > best.r)) best = { f: f, r: r }; });
    $('pk-t-best').textContent = best ? best.f.name : '–';
    $('pk-t-best-sub').textContent = best ? signed(best.r) + ' chips per 100 hands lately' : 'after 50 hands';
    var people = seats.filter(function (p) { return p && p.kind === 'human'; });
    $('pk-t-pot').textContent = biggest ? biggest.pot : '\u2013';
    $('pk-t-pot-sub').textContent = biggest ? biggest.text : ' ';
    $('pk-t-you').textContent = people.length ? people.map(function (p) { return signed(p.profit); }).join(' / ') : '–';
    $('pk-t-you-sub').textContent = people.length ? people.map(function (p) { return p.name; }).join(' / ') : 'nobody has sat down yet';
    for (var i = 0; i < SEATS; i++) { var s = $('pk-seat-stack-' + i); if (s && seats[i]) s.textContent = 'stack ' + seats[i].stack + ' · ' + signed(seats[i].profit) + ' overall'; }
    if (force || now - lastBoard > 1000) { lastBoard = now; drawBoard(); drawGrid(); }
    if (speed !== 'watch' && game.last && shownHand !== game.last) {
      var h = game.last; shownHand = h;
      scene.show(h, faceUp);
      if (h.winners.length) {
        var q = h.p[h.winners[0].i];
        say(seats[q.seat] ? seats[q.seat].name + ' wins ' + h.pot() + (h.showdown ? ' with ' + q.handName.toLowerCase() : '') : ' ', ' ');
      }
    }
  }

  /* ---------- controls ---------- */
  function setPlaying(p) { playing = p; $('pk-play').textContent = p ? 'Pause' : 'Play'; if (!p) save(); rate.t = 0; }
  function syncSpeed() {
    var people = humans() > 0 || Object.keys(pending).some(function (k) { return pending[k] && pending[k].kind === 'human'; });
    ['fast', 'turbo'].forEach(function (s) { $('pk-speed-' + s).disabled = people; });
    if (people && speed !== 'watch') { $('pk-speed-watch').checked = true; setSpeed('watch'); }
    $('pk-note').textContent = people ? 'People are playing, so the table runs at Watch speed. Fast and Turbo come back when everyone has left.' :
      'Five flies, each with its own copy of the mushroom body circuit, playing Limit Hold\'em against each other. Fresh flies play almost at random: let them play on Turbo for a few minutes, then sit down in the open seat.';
  }
  function setSpeed(v) {
    if (speed === 'watch' && v !== 'watch') finishWatchHand();
    speed = v; game.step = null; rate.t = 0; due = 0; shownHand = null;
    if (!playing) setPlaying(true);
  }
  $('pk-play').addEventListener('click', function () { setPlaying(!playing); });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="pk-speed"]'), function (r) {
    r.addEventListener('change', function () { if (r.checked) setSpeed(r.value); });
  });
  $('pk-join-open').addEventListener('click', function () {
    for (var i = 0; i < SEATS; i++) if (!seats[i] && !(i in pending)) return focusSeat(i);
    $('pk-note').textContent = 'Every seat is taken. Ask a fly to leave in the seat list below, then sit down there.';
    $('pk-seats').scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  });
  $('pk-reset').addEventListener('click', function () { $('pk-reset-confirm').hidden = false; $('pk-reset').hidden = true; });
  $('pk-reset-no').addEventListener('click', function () { $('pk-reset-confirm').hidden = true; $('pk-reset').hidden = false; });
  $('pk-reset-yes').addEventListener('click', function () {
    $('pk-reset-confirm').hidden = true; $('pk-reset').hidden = false;
    game.hand = null; game.step = null; game.waiting = false; game.last = null; hideBar();
    flies.forEach(function (f) { f.brain = newBrain(f); f.stack = P.START_STACK; f.profit = 0; f.hands = 0; f.won = 0; f.recent = []; });
    seats.forEach(function (p) { if (p && p.kind === 'human') { p.stack = P.START_STACK; p.profit = 0; } });
    handsTotal = 0; biggest = null;
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* nothing stored */ }
    scene.setSeats(seatList()); scene.clear(); renderSeats(); clearLog(); say(' ', ' '); refresh(true);
  });

  /* ---------- the loop ---------- */
  var due = 0, prev = 0;
  function frame(now) {
    var dt = Math.min(100, now - (prev || now)); prev = now;
    if (active) {
      if (playing) {
        if (speed === 'watch') {
          if (!game.waiting) {
            if (!game.step) { game.step = stepDeal; game.at = now; }
            if (now >= game.at) { var next = game.step(); game.step = next[0]; game.at = now + next[1]; refresh(true); }
          }
        } else if (speed === 'fast') {
          due += dt * 0.008;
          while (due >= 1) { playQuick(); due--; }
        } else {
          var t0 = performance.now();
          while (performance.now() - t0 < 14) playQuick();
        }
      }
      refresh(false);
      scene.tick(now, playing && speed !== 'watch');
    }
    requestAnimationFrame(frame);
  }

  /* ---------- switching games ---------- */
  function init() {
    if (ready) return;
    scene = self.PokerScene($('pk-scene'), { reduceMotion: reduceMotion });
    scene.onSeatClick(focusSeat);
    flies.forEach(function (f) { f.brain = newBrain(f); });
    restore();
    scene.setSeats(seatList());
    renderSeats(); buildGrid(); syncSpeed();
    ready = true;
    requestAnimationFrame(frame);
  }
  function showGame(name) {
    var poker = name === 'poker';
    $('game-blackjack').hidden = poker; $('game-poker').hidden = !poker;
    $('game-' + (poker ? 'pk' : 'bj')).checked = true;
    if (poker) { FJ.suspend(true); init(); FJ.scope.mount($('pk-scope-slot')); active = true; refresh(true); }
    else { active = false; save(); FJ.scope.mount($('bj-scope-slot')); FJ.suspend(false); }
    try { localStorage.setItem('flyjack.game', name); } catch (e) { /* fine */ }
    if (history.replaceState) history.replaceState(null, '', poker ? '#poker' : location.pathname + location.search);
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[name="game"]'), function (r) {
    r.addEventListener('change', function () { if (r.checked) showGame(r.value); });
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) save(); });
  setInterval(save, 15000);
  $('pk-play').textContent = playing ? 'Pause' : 'Play';
  var startGame = location.hash === '#poker' ? 'poker' : null;
  if (!startGame) { try { startGame = localStorage.getItem('flyjack.game'); } catch (e) { /* fine */ } }
  if (startGame === 'poker') showGame('poker');
  self.FlyJackPoker = {
    seats: seats, flies: flies, game: game, sit: change, policyStats: policyStats, per100: per100,
    train: function (n) { init(); for (var i = 0; i < n; i++) playQuick(); refresh(true); return handsTotal; }
  };
})();

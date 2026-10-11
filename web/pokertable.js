/* FlyJack - the poker table. Six seats around an oval table in the same casino room, the same
   dealer, and a copy of the blackjack fly for every fly seat, each wearing the look of a classic
   lab strain. The flies act out their choices: sniff, tap the felt to check, push chips in to
   call or raise, droop and slide their cards away to fold, hop when they take the pot. */
(function (root) {
  'use strict';
  var K = root.SceneKit, make = K.make, text = K.text, r2 = K.r2, easeIn = K.easeIn, Sprite = K.Sprite;
  var DECK = { x: 600, y: 286 }, MUCK = { x: 600, y: 300 }, POT = { x: 600, y: 338 }, FLY_SCALE = 0.62;
  var DEALER = { shoulderL: { x: 532, y: 222 }, shoulderR: { x: 668, y: 222 }, restL: { x: 522, y: 280 }, restR: { x: 678, y: 280 } };
  // every seat: where the fly stands, its hole cards, its bet, its name plate and its thought bubble
  var SEATS = [
    { fly: { x: 968, y: 400 }, flip: false, cards: { x: 866, y: 420 }, bet: { x: 806, y: 392 }, plate: { x: 990, y: 432 }, bubble: { x: 905, y: 262 } },
    { fly: { x: 968, y: 548 }, flip: false, cards: { x: 866, y: 528 }, bet: { x: 793, y: 498 }, plate: { x: 990, y: 580 }, bubble: { x: 820, y: 448 } },
    { fly: { x: 738, y: 610 }, flip: false, cards: { x: 655, y: 592 }, bet: { x: 650, y: 528 }, plate: { x: 778, y: 642 }, bubble: { x: 676, y: 474 } },
    { fly: { x: 462, y: 610 }, flip: true, cards: { x: 545, y: 592 }, bet: { x: 550, y: 528 }, plate: { x: 422, y: 642 }, bubble: { x: 524, y: 474 } },
    { fly: { x: 232, y: 548 }, flip: true, cards: { x: 334, y: 528 }, bet: { x: 407, y: 498 }, plate: { x: 210, y: 580 }, bubble: { x: 380, y: 448 } },
    { fly: { x: 232, y: 400 }, flip: true, cards: { x: 334, y: 420 }, bet: { x: 394, y: 392 }, plate: { x: 210, y: 432 }, bubble: { x: 295, y: 262 } }
  ];
  var LOOKS = {
    'Canton-S': {},
    'white': { eye: 'url(#cj-eye-white)' },
    'yellow': { thorax: 'url(#cj-thorax-yellow)', abdomen: 'url(#cj-abdomen-yellow)', headshell: '#e6c26a', scutellum: '#e9c873' },
    'ebony': { thorax: 'url(#cj-thorax-ebony)', abdomen: 'url(#cj-abdomen-ebony)', headshell: '#5e4535', scutellum: '#4a3427' },
    'Curly': { wingRest: -24 }
  };
  var SMELL_GOOD = '#6aa8ff', SMELL_BAD = '#ff8a50', AVATAR = ['#e0864a', '#5b8def', '#c45bb0', '#3fa77a', '#d6b25e', '#e05a5a'];

  function head(seat) { return { x: seat.fly.x + (seat.flip ? 41 : -41), y: seat.fly.y - 64 }; }

  function PokerScene(svg, options) {
    var reduce = !!(options && options.reduceMotion);
    var $ = function (id) { return document.getElementById(id); };
    var layer = { places: $('pk-places'), flies: $('pk-flies'), cards: $('pk-cards'), chips: $('pk-chips'), labels: $('pk-labels'), fx: $('pk-fx') };
    var bubble = $('pk-bubble'), scentG = $('pk-scent');
    var snap = false, tl = new K.Timeline(function () { return snap || reduce; });
    var move = tl.move.bind(tl), later = tl.later.bind(tl);
    var dealerBody = K.cloneDrawing($('cj-dealer')), dealerArms = K.cloneDrawing($('cj-arms'));
    $('pk-dealer').appendChild(dealerBody); $('pk-arms').appendChild(dealerArms);
    var dealer = new K.Dealer(dealerBody, dealerArms, tl, DEALER);
    var seats = [], holes = [], bets = [], board = [], pot = null, potLabel = null, button = null, onSeatClick = null;
    K.decorateRoom($('pk-bokeh'), 11);

    /* ---------- who sits where ---------- */
    function setSeats(list) {
      while (layer.places.firstChild) layer.places.removeChild(layer.places.firstChild);
      while (layer.flies.firstChild) layer.flies.removeChild(layer.flies.firstChild);
      seats = list.map(function (s, i) {
        var at = SEATS[i], out = { kind: s.kind, name: s.name, fly: null };
        if (s.kind === 'fly') {
          var g = K.cloneDrawing($('cj-fly')), look = LOOKS[s.look] || {};
          ['eye', 'thorax', 'abdomen', 'headshell', 'scutellum'].forEach(function (p) {
            var el = g.querySelector('[data-part="' + p + '"]');
            if (el && look[p]) el.setAttribute('fill', look[p]);
          });
          g.setAttribute('transform', 'translate(' + at.fly.x + ' ' + at.fly.y + ') scale(' + (at.flip ? -FLY_SCALE : FLY_SCALE) + ' ' + FLY_SCALE + ')');
          layer.flies.appendChild(g);
          out.g = g; out.fly = new K.Fly(g, { reduce: reduce, wingRest: look.wingRest || 0 });
        } else if (s.kind === 'human') {
          var a = make('g', { 'class': 'avatar', transform: 'translate(' + at.fly.x + ' ' + (at.fly.y - 50) + ')' }, layer.places);
          make('ellipse', { cy: 52, rx: 40, ry: 9, fill: '#000', opacity: 0.3 }, a);
          make('circle', { r: 33, fill: AVATAR[i % AVATAR.length], stroke: '#fbfaf5', 'stroke-width': 3 }, a);
          text(a, (s.name || '?').charAt(0).toUpperCase(), 0, 10, 'avatar-letter', '#fff', 'middle');
          out.g = a;
        } else {
          var e = make('g', { 'class': 'seat-open', transform: 'translate(' + at.fly.x + ' ' + (at.fly.y - 50) + ')', tabindex: 0, role: 'button', 'aria-label': 'Open seat ' + (i + 1) + ': join the game' }, layer.places);
          make('circle', { r: 33, fill: '#fff', 'fill-opacity': 0.04, stroke: '#e8c27a', 'stroke-opacity': 0.7, 'stroke-width': 2, 'stroke-dasharray': '6 6' }, e);
          text(e, '+', 0, 12, 'seat-plus', '#e8c27a', 'middle');
          var go = function () { if (onSeatClick) onSeatClick(i); };
          e.addEventListener('click', go);
          e.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
          out.g = e;
        }
        out.plate = make('g', { 'class': 'plate', transform: 'translate(' + at.plate.x + ' ' + at.plate.y + ')' }, layer.places);
        make('rect', { x: -66, y: -21, width: 132, height: 42, rx: 10 }, out.plate);
        out.nameEl = text(out.plate, s.kind === 'empty' ? 'Open seat' : s.name, 0, -4, 'plate-name', null, 'middle');
        out.stackEl = text(out.plate, s.kind === 'empty' ? 'click to join' : String(s.stack), 0, 13, 'plate-stack', null, 'middle');
        return out;
      });
    }
    function plate(i, o) {
      var s = seats[i];
      if (!s) return;
      if (o.stack !== undefined) s.stackEl.textContent = o.stack;
      if (o.acting !== undefined) s.plate.classList.toggle('acting', o.acting);
      if (o.folded !== undefined) { s.plate.classList.toggle('folded', o.folded); if (s.g) s.g.style.opacity = o.folded ? 0.5 : ''; }
    }

    /* ---------- cards ---------- */
    function holeSlot(i, k) { var c = SEATS[i].cards; return { x: c.x + (k ? 13 : -13), y: c.y + (k ? 2 : 0), r: k ? 7 : -7, s: FLY_SCALE }; }
    function boardSlot(k) { return { x: 460 + k * 70, y: 428, r: 0, s: 0.95 }; }
    function deal1(card, to, up, delay) {
      var sp = K.cardSprite(layer.cards, card);
      sp.x = DECK.x; sp.y = DECK.y; sp.r = -20; sp.s = 0.5; sp.o = 0; sp.draw();
      later(delay, function () { sp.o = 1; sp.draw(); dealer.flick(DECK); dealer.look(to, 400); });
      move(sp, { x: to.x, y: to.y, r: to.r, s: to.s }, 340, delay, { arc: 30 });
      if (up) later(delay + 170, function () { K.flip(tl, sp, true); });
      return sp;
    }
    function reveal(i, up) { (holes[i] || []).forEach(function (sp) { if (sp.up !== up) K.flip(tl, sp, up); }); }

    /* ---------- chips ---------- */
    function betLabel(i, amount) {
      var b = bets[i];
      if (b.label) b.label.remove();
      b.label = null;
      if (!amount) return;
      var at = SEATS[i].bet, g = make('g', {}, layer.labels), sp = new Sprite(g);
      text(g, String(amount), 0, 0, 'bet-label', null, 'middle');
      sp.x = at.x; sp.y = at.y + 26; sp.draw(); b.label = sp;
    }
    function setBet(i, amount, delay) {
      var b = bets[i] || (bets[i] = { sp: null, label: null, amount: 0 }), at = SEATS[i].bet, from = SEATS[i].plate;
      var chip = K.chipSprite(layer.chips, 'red');
      chip.x = from.x; chip.y = from.y - 20; chip.o = 0; chip.draw();
      later(delay, function () { chip.o = 1; chip.draw(); });
      move(chip, { x: at.x, y: at.y }, 360, delay, { arc: 26, done: function () {
        chip.remove();
        if (b.sp) b.sp.remove();
        b.sp = K.stackSprite(layer.chips, amount, 6); b.sp.x = at.x; b.sp.y = at.y; b.sp.draw();
        b.amount = amount; betLabel(i, amount);
      } });
    }
    function drawPot(amount) {
      if (pot) pot.remove();
      if (potLabel) potLabel.remove();
      pot = potLabel = null;
      if (!amount) return;
      pot = K.stackSprite(layer.chips, amount, 12); pot.x = POT.x; pot.y = POT.y; pot.draw();
      var g = make('g', {}, layer.labels); potLabel = new Sprite(g);
      make('rect', { x: -44, y: -14, width: 88, height: 28, rx: 14, 'class': 'pot-pill' }, g);
      text(g, 'Pot ' + amount, 0, 5, 'pot-label', null, 'middle');
      potLabel.x = POT.x + 92; potLabel.y = POT.y - 4; potLabel.draw();
    }
    function placeButton(i, delay) {
      var at = SEATS[i].bet, to = { x: at.x + (SEATS[i].flip ? -34 : 34), y: at.y + 22 };
      if (!button) {
        var g = make('g', {}, layer.chips);
        make('ellipse', { cy: 3, rx: 14, ry: 6, fill: '#bdb6a6' }, g);
        make('ellipse', { rx: 14, ry: 6, fill: '#fbfaf5' }, g);
        text(g, 'D', 0, 4, 'dealer-btn', '#1c1c1c', 'middle');
        button = new Sprite(g); button.x = to.x; button.y = to.y; button.draw();
      }
      move(button, to, 400, delay, { arc: 14 });
    }

    /* ---------- effects ---------- */
    function floatText(str, color, x, y, delay, cls) {
      var g = make('g', {}, layer.fx), sp = new Sprite(g);
      text(g, str, 0, 0, cls || 'fx-say', color, 'middle');
      sp.x = x; sp.y = y; sp.o = 0; sp.draw();
      later(delay, function () { sp.o = 1; sp.draw(); });
      move(sp, { y: y - 34 }, 1300, delay);
      move(sp, { o: 0 }, 1300, delay, { ease: easeIn, done: function () { sp.remove(); } });
    }
    function sparkle(n, cx, cy, spread, delay) {
      if (tl.instant()) return;
      var colors = ['#ffd46b', '#fff3c4', '#ff9fd0'];
      for (var i = 0; i < n; i++) {
        var g = make('g', {}, layer.fx), sp = new Sprite(g), a = Math.PI * 2 * i / n + Math.random() * 0.5, d = spread * (0.6 + Math.random() * 0.6);
        make('path', { d: 'M0 -8L2 -2L8 0L2 2L0 8L-2 2L-8 0L-2 -2Z', fill: colors[i % 3] }, g);
        sp.x = cx; sp.y = cy; sp.s = 0.3; sp.o = 0; sp.draw();
        (function (sp, dl) { later(dl, function () { sp.o = 1; sp.draw(); }); })(sp, delay + i * 18);
        move(sp, { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d * 0.7, s: 0.5 + Math.random() * 0.6, r: 140 }, 650, delay + i * 18);
        move(sp, { o: 0 }, 900, delay + i * 18, { ease: easeIn, done: sp.remove.bind(sp) });
      }
    }
    function ripple(i, delay) {
      if (tl.instant()) return;
      var at = SEATS[i], g = make('g', {}, layer.fx), sp = new Sprite(g);
      make('ellipse', { rx: 8, ry: 3, fill: 'none', stroke: '#fff', 'stroke-width': 2 }, g);
      sp.x = at.fly.x + (at.flip ? 50 : -50); sp.y = at.fly.y; sp.s = 0.4; sp.o = 0; sp.draw();
      later(delay, function () { sp.o = 0.9; sp.draw(); });
      move(sp, { s: 2.4, o: 0 }, 480, delay, { done: sp.remove.bind(sp) });
    }
    /* The thought bubble over seat i: a title, or up to three smell lines [{label, v}]. */
    function think(i, main, lines) {
      bubble.classList.toggle('on', i !== null && i !== undefined);
      if (i === null || i === undefined) return;
      var at = SEATS[i].bubble, h = head(SEATS[i]);
      bubble.setAttribute('transform', 'translate(' + at.x + ' ' + at.y + ')');
      var dx = h.x - at.x, dy = h.y - at.y;
      $('pk-bubble-dot1').setAttribute('cx', r2(dx * 0.55)); $('pk-bubble-dot1').setAttribute('cy', r2(dy * 0.55));
      $('pk-bubble-dot2').setAttribute('cx', r2(dx * 0.8)); $('pk-bubble-dot2').setAttribute('cy', r2(dy * 0.8));
      var rows = $('pk-bubble-rows');
      while (rows.firstChild) rows.removeChild(rows.firstChild);
      if (main) { text(rows, main, 0, 8, 'bubble-main', null, 'middle'); return; }
      (lines || []).forEach(function (l, k) {
        var y = (k - (lines.length - 1) / 2) * 19 + 5;
        text(rows, l.label, -8, y, 'bubble-row', null, 'end');
        text(rows, (l.v < 0 ? '−' : '+') + Math.abs(l.v).toFixed(2), 2, y, 'bubble-val', l.v >= 0 ? '#2c6fd0' : '#c4501c', 'start');
      });
    }
    function scent(i, color) {
      scentG.classList.toggle('on', !!color);
      if (!color) return;
      var c = SEATS[i].cards, h = head(SEATS[i]);
      K.scentPaths(scentG, c.x, c.y - 10, h.x + (SEATS[i].flip ? 6 : -6), h.y - 6);
      Array.prototype.forEach.call(scentG.children, function (p) { p.style.stroke = color; });
    }
    function puppet(i) { return seats[i] && seats[i].fly; }

    /* ---------- what the game asks for ---------- */
    function clearAll() {
      tl.clear();
      [layer.cards, layer.chips, layer.labels, layer.fx].forEach(function (l) { while (l.firstChild) l.removeChild(l.firstChild); });
      holes = []; bets = []; board = []; pot = potLabel = button = null;
      dealer.reset();
      think(null); scent(null);
    }
    function sweep() {
      var old = [];
      holes.forEach(function (h) { if (h) old = old.concat(h); });
      old = old.concat(board);
      holes = []; board = [];
      bets.forEach(function (b, i) { if (b) { if (b.sp) b.sp.remove(); betLabel(i, 0); } });
      bets = []; drawPot(0);
      think(null); scent(null);
      seats.forEach(function (s, i) { plate(i, { folded: false, acting: false }); if (s.fly) s.fly.act('idle'); });
      if (!old.length) return 0;
      if (tl.instant()) { old.forEach(function (sp) { sp.remove(); }); return 0; }
      dealer.reach(true, { x: 600, y: 400 }, 0);
      old.forEach(function (sp, k) { move(sp, { x: MUCK.x, y: MUCK.y, r: 0, s: 0.4, o: 0 }, 380, 80 + k * 25, { arc: 16, done: sp.remove.bind(sp) }); });
      return 480 + old.length * 25;
    }

    /* A new hand: the button moves, the blinds go in, two cards each, starting left of the button. */
    function deal(hand, faceUp) {
      var t = sweep(), n = hand.n, i;
      placeButton(hand.p[hand.button].seat, t);
      t += 250;
      [hand.sb, hand.bb].forEach(function (k) {
        var q = hand.p[k];
        setBet(q.seat, q.bet, t); t += 160;
        later(t, function () { plate(q.seat, { stack: q.stack }); });
      });
      t += 200;
      for (var round = 0; round < 2; round++) for (i = 0; i < n; i++) {
        var q = hand.p[(hand.sb + i) % n];
        var sp = deal1(q.hole[round], holeSlot(q.seat, round), faceUp(q.seat), t);
        (holes[q.seat] = holes[q.seat] || []).push(sp);
        t += 120;
      }
      return t + 350;
    }
    function sniff(i, lines) {
      var f = puppet(i), best = -Infinity;
      lines.forEach(function (l) { best = Math.max(best, l.v); });
      if (f) { f.act('sniff'); f.glow('#7df0c4', 0.45, 0); }
      think(i, null, lines);
      scent(i, best >= 0 ? SMELL_GOOD : SMELL_BAD);
      plate(i, { acting: true });
      dealer.look(head(SEATS[i]), 1500);
    }
    function waitFor(i) { plate(i, { acting: true }); dealer.look(head(SEATS[i]), 1e9); }
    var SAY = { fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise' };
    /* Seat i did ev (from Poker.Hand.act). Returns how long the gesture takes. */
    function act(i, ev, stack) {
      var f = puppet(i), at = SEATS[i], ms = 800;
      scent(null); dealer.look(null, 0);
      if (f) f.glow('#7df0c4', 0, 0);
      think(f ? i : null, ev.type === 'fold' ? 'Fold.' : ev.type === 'check' ? 'Check.' : SAY[ev.type] + (ev.type === 'call' ? ' ' + ev.paid : ' to ' + ev.level) + '!');
      floatText(ev.type === 'check' || ev.type === 'fold' ? SAY[ev.type] : SAY[ev.type] + ' ' + (ev.type === 'call' ? ev.paid : ev.level), ev.type === 'fold' ? '#ff9b7a' : '#f3ead2', at.bet.x, at.bet.y - 18, 150);
      if (ev.type === 'fold') {
        if (f) f.act('fold');
        (holes[i] || []).forEach(function (sp, k) { move(sp, { x: MUCK.x, y: MUCK.y, s: 0.4, o: 0, r: 0 }, 420, 250 + k * 60, { arc: 20, done: sp.remove.bind(sp) }); });
        holes[i] = [];
        later(500, function () { plate(i, { folded: true, acting: false }); });
        ms = 900;
      } else if (ev.type === 'check') {
        if (f) { f.act('tap'); ripple(i, 380); ripple(i, 760); }
        later(700, function () { plate(i, { acting: false }); });
        ms = 900;
      } else {
        if (f) f.act('push');
        setBet(i, ev.bet, 200);
        later(500, function () { plate(i, { acting: false, stack: stack }); });
        ms = 850;
      }
      later(ms, function () { if (f && ev.type !== 'fold') f.act('idle'); think(null); });
      return ms + 150;
    }
    /* The betting round is over: bets slide into the pot. */
    function gather(potAmount) {
      var t = 0;
      bets.forEach(function (b, i) {
        if (!b || !b.sp) return;
        var sp = b.sp; b.sp = null; betLabel(i, 0);
        move(sp, { x: POT.x, y: POT.y, o: 0.2 }, 380, t, { arc: 12, done: sp.remove.bind(sp) });
        t += 40;
      });
      bets = [];
      later(t + 380, function () { drawPot(potAmount); });
      return t + 450;
    }
    function deal_board(cards, from) {
      var t = 0;
      for (var k = 0; k < cards.length; k++) { board.push(deal1(cards[k], boardSlot(from + k), true, t)); t += 230; }
      dealer.look(boardSlot(from), 900);
      return t + 450;
    }
    /* Everyone still in turns their cards over; each hand's name appears above it. */
    function showdown(hand) {
      var t = 0;
      hand.p.forEach(function (q) {
        if (q.folded) return;
        reveal(q.seat, true);
        var c = SEATS[q.seat].cards;
        later(300, function () { floatName(q.handName, c.x, c.y - 52); });
        t = 900;
      });
      return t;
    }
    function floatName(str, x, y) {
      var g = make('g', {}, layer.labels), sp = new Sprite(g);
      text(g, str, 0, 0, 'hand-name', null, 'middle');
      sp.x = x; sp.y = y; sp.draw();
      return sp;
    }
    /* The pot goes to the winner(s); each fly reacts to how its hand went. */
    function payout(hand) {
      var amountTotal = hand.pot(), t = 200;
      think(null); scent(null);
      if (pot) { var p0 = pot; pot = null; p0.remove(); }
      drawPot(0);
      hand.winners.forEach(function (w, k) {
        var q = hand.p[w.i], at = SEATS[q.seat], sp = K.stackSprite(layer.chips, w.amount, 12);
        sp.x = POT.x; sp.y = POT.y; sp.draw();
        dealer.reach(k === 0, POT, 0);
        move(sp, { x: at.bet.x, y: at.bet.y }, 500, t + k * 150, { arc: 30, done: function () {
          move(sp, { x: at.plate.x, y: at.plate.y - 16, o: 0 }, 420, 500, { done: sp.remove.bind(sp) });
        } });
        floatText('+' + w.amount, '#ffd46b', at.bet.x, at.bet.y - 20, t + 400, 'fx-float');
        later(t + 1100, function () { plate(q.seat, { stack: q.stack }); });
        sparkle(w.amount >= 30 ? 22 : 10, head(at).x, head(at).y - 20, w.amount >= 30 ? 110 : 70, t + 350);
      });
      hand.p.forEach(function (q, i) {
        var f = puppet(q.seat), won = hand.winners.some(function (w) { return w.i === i; });
        if (!f) return;
        if (won) f.act(amountTotal >= 30 && hand.winners.length === 1 ? 'blackjack' : 'win');
        else if (!q.folded) f.act('lose');
        else if (q.net < -4) f.act('lose');
      });
      dealer.mood(hand.winners.some(function (w) { return seats[hand.p[w.i].seat].kind === 'human'; }) ? 'surprised' : 'smile', 1800);
      return amountTotal >= 30 ? 2700 : 2100;
    }
    function dopamine(i, surprise) {
      var f = puppet(i);
      if (!f || surprise === null || surprise === undefined || Math.abs(surprise) <= 0.05) return;
      f.glow(surprise > 0 ? '#4d9bff' : '#ff6a2e', Math.min(0.95, Math.abs(surprise) * 1.5 + 0.35), 1700);
    }
    /* A finished hand laid out at once (Fast and Turbo, or with reduced motion). */
    function show(hand, faceUp) {
      clearAll();
      snap = true;
      placeButton(hand.p[hand.button].seat, 0);
      hand.p.forEach(function (q) {
        plate(q.seat, { stack: q.stack, folded: q.folded, acting: false });
        if (q.folded) return;
        holes[q.seat] = q.hole.map(function (c, k) { return deal1(c, holeSlot(q.seat, k), hand.showdown || faceUp(q.seat), 0); });
        if (hand.showdown) { var c = SEATS[q.seat].cards; floatName(q.handName, c.x, c.y - 52); }
      });
      hand.board.forEach(function (c, k) { board.push(deal1(c, boardSlot(k), true, 0)); });
      snap = false;
    }
    function clear() { sweep(); if (button) { button.remove(); button = null; } }

    function tick(t, busy) {
      tl.run(t);
      seats.forEach(function (s) { if (s.fly) s.fly.pose(t, busy); });
      dealer.pose(t, { x: 600, y: 520 }, reduce);
    }

    // phones: frame the table so the cards stay readable
    function frame() { svg.setAttribute('viewBox', svg.clientWidth && svg.clientWidth < 560 ? '110 96 980 579' : '0 0 1200 675'); }
    if (root.ResizeObserver) new ResizeObserver(frame).observe(svg); else root.addEventListener('resize', frame);
    frame();

    return {
      setSeats: setSeats, plate: plate, deal: deal, sniff: sniff, waitFor: waitFor, act: act, gather: gather, board: deal_board,
      showdown: showdown, payout: payout, dopamine: dopamine, reveal: reveal, show: show, clear: clear, tick: tick,
      onSeatClick: function (fn) { onSeatClick = fn; }, looks: Object.keys(LOOKS)
    };
  }

  root.PokerScene = PokerScene;
})(self);

/* FlyJack - the poker table, in 3D. Six seats around an oval table in the same casino room, the
   same dealer, and a fly for every fly seat, each wearing the look of a classic lab strain. The
   flies act out their choices: sniff, tap the felt to check, push chips in to call or raise,
   droop and slide their cards away to fold, hop when they take the pot. Places are in table
   units (the old 1200 x 675 drawing), mapped onto the oval felt. */
(function (root) {
  'use strict';
  var K = root.SceneKit, S3 = root.Scene3D, T = root.THREE, easeIn = K.easeIn;
  var DECK = { x: 600, y: 286 }, MUCK = { x: 600, y: 300 }, POT = { x: 600, y: 338 }, CENTER = { x: 600, y: 452 };
  var RX = 470, RZ = 300, FLY_SCALE = 0.52, DEALER = { z: -372, restL: { x: 522, y: 280 }, restR: { x: 678, y: 280 } };
  // every seat: where the fly stands, its hole cards and its bet
  var SEATS = [
    { fly: { x: 968, y: 400 }, cards: { x: 866, y: 420 }, bet: { x: 806, y: 392 } },
    { fly: { x: 968, y: 548 }, cards: { x: 866, y: 528 }, bet: { x: 793, y: 498 } },
    { fly: { x: 738, y: 610 }, cards: { x: 655, y: 592 }, bet: { x: 650, y: 528 } },
    { fly: { x: 462, y: 610 }, cards: { x: 545, y: 592 }, bet: { x: 550, y: 528 } },
    { fly: { x: 232, y: 548 }, cards: { x: 334, y: 528 }, bet: { x: 407, y: 498 } },
    { fly: { x: 232, y: 400 }, cards: { x: 334, y: 420 }, bet: { x: 394, y: 392 } }
  ];
  var SMELL_GOOD = '#6aa8ff', SMELL_BAD = '#ff8a50', AVATAR = ['#e0864a', '#5b8def', '#c45bb0', '#3fa77a', '#d6b25e', '#e05a5a'];
  function feltXY(x, y) { return [x - 600, (y - 452) * 1.62]; }

  function PokerScene(el, options) {
    var reduce = !!(options && options.reduceMotion);
    var stage = new S3.Stage(el, {
      map: feltXY,
      views: { wide: { pos: [0, 520, 900], target: [0, 60, -20], fov: 42 }, narrow: { pos: [0, 900, 760], target: [0, -20, 60], fov: 56 } }
    });
    stage.reduce = reduce;
    new S3.Hud(stage, { corner: 'tr' });
    stage.pieces = new T.Group(); stage.scene.add(stage.pieces);
    var snap = false, tl = new K.Timeline(function () { return snap || reduce; });
    var move = tl.move.bind(tl), later = tl.later.bind(tl);

    S3.buildRoom(stage, {
      wallZ: -580, seed: 11, lamp: { x: 0, y: 540, z: 0, aim: [0, 0, 10] },
      neon: []
    });
    S3.pokerTable(stage, RX, RZ, function (g) {
      g.strokeStyle = 'rgba(39,224,208,0.55)'; g.lineWidth = 3.5;
      g.beginPath(); g.ellipse(0, 0, RX - 62, RZ - 52, 0, 0, 6.2832); g.stroke();
      for (var k = 0; k < 5; k++) { var b = feltXY(460 + k * 70, 428); g.strokeRect(b[0] - 30, b[1] - 43, 60, 86); }
      g.fillStyle = 'rgba(39,224,208,0.7)'; g.font = '600 17px ' + S3.MONO; g.textAlign = 'center'; g.textBaseline = 'middle';
      var c = feltXY(600, 497); g.fillText('LIMIT HOLD\'EM  ·  2 / 4', c[0], c[1] + 6);
    });
    var deck = new T.Group(), dk = feltXY(DECK.x, DECK.y); deck.position.set(dk[0] + 70, 0, dk[1]); stage.table.add(deck);
    for (var d = 0; d < 6; d++) {
      var cd = S3.card(stage, { face: 'A', suit: 's' }); S3.setFace(cd, false);
      stage.pieces.remove(cd.obj); deck.add(cd.obj); cd.obj.position.set(0, d, 0); cd.obj.rotation.y = d * 0.03;
    }
    S3.wineGlass(stage, -520, -170); S3.gnat(stage, -500, 200, -160);

    var dealer = new S3.Dealer(stage, tl, DEALER);
    var seats = [], holes = [], bets = [], board = [], pot = null, potLabel = null, button = null, onSeatClick = null, fx = [];
    var bubble = new S3.Bubble(stage), trail = new S3.Trail(stage);

    function seatPoint(i, h) { var a = SEATS[i].fly; return stage.map(a.x, a.y, h || 0); }
    function head(i) { var s = seats[i]; return s && s.fly ? s.fly.headAt() : seatPoint(i, 60); }

    /* ---------- who sits where ---------- */
    function setSeats(list) {
      seats.forEach(function (s) { s.parts.forEach(function (p) { if (p.isObject3D) { if (p.parent) p.parent.remove(p); } else p.remove(); }); });
      seats = list.map(function (s, i) {
        var at = SEATS[i], out = { kind: s.kind, name: s.name, fly: null, parts: [] }, base = seatPoint(i);
        if (s.kind === 'fly') {
          var f = out.fly = new K.Fly({ reduce: reduce, look: s.look }), aim = stage.map(CENTER.x, CENTER.y);
          f.group.position.copy(base); f.group.scale.setScalar(FLY_SCALE);
          f.group.rotation.y = Math.atan2(-(aim.z - base.z), aim.x - base.x);
          f.nearSide = Math.cos(f.group.rotation.y) > 0 ? 1 : -1;
          stage.scene.add(f.group); out.parts.push(f.group);
        } else if (s.kind === 'human') {
          var tok = new T.Group(), col = AVATAR[i % AVATAR.length]; tok.position.copy(base); stage.scene.add(tok);
          var ball = S3.mesh(S3.SPHERE, S3.std(col, { rough: 0.35 }), tok); ball.scale.setScalar(30); ball.position.y = 46;
          var ped = S3.mesh(new T.CylinderGeometry(22, 30, 14, 32), S3.std('#fbfaf5', { rough: 0.4 }), tok); ped.position.y = 7;
          out.token = tok; out.parts.push(tok);
          var letter = new S3.Label(stage, 'avatar-letter'); letter.text((s.name || '?').charAt(0).toUpperCase());
          letter.follow = function () { return base.clone().add(new T.Vector3(0, 46, 0)); }; out.parts.push(letter);
        } else {
          var btn = document.createElement('button'), open = new S3.Label(stage, 'seat-open-wrap');
          btn.type = 'button'; btn.className = 'seat-open'; btn.textContent = '+'; btn.setAttribute('aria-label', 'Open seat ' + (i + 1) + ': join the game');
          btn.addEventListener('click', function () { if (onSeatClick) onSeatClick(i); });
          open.el.appendChild(btn); open.follow = function () { return base.clone().add(new T.Vector3(0, 40, 0)); }; out.parts.push(open);
        }
        var plateL = out.plate = new S3.Label(stage, 'plate');
        plateL.el.innerHTML = '<b class="plate-name"></b><span class="plate-stack"></span>';
        plateL.el.querySelector('.plate-name').textContent = s.kind === 'empty' ? 'Open seat' : s.name;
        out.stackEl = plateL.el.querySelector('.plate-stack'); out.stackEl.textContent = s.kind === 'empty' ? 'click + to join' : String(s.stack);
        plateL.follow = function () { return base; }; plateL.dy = 30; out.parts.push(plateL);
        return out;
      });
    }
    function plate(i, o) {
      var s = seats[i];
      if (!s) return;
      if (o.stack !== undefined) s.stackEl.textContent = o.stack;
      if (o.acting !== undefined) s.plate.el.classList.toggle('acting', o.acting);
      if (o.folded !== undefined) {
        s.plate.el.classList.toggle('folded', o.folded);
        if (s.fly) s.fly.fade(o.folded ? 0.45 : 1);
      }
    }

    /* ---------- cards ---------- */
    function holeSlot(i, k) { var c = SEATS[i].cards; return { x: c.x + (k ? 15 : -15), y: c.y + (k ? 2 : 0), r: k ? 7 : -7, s: 0.8 }; }
    function boardSlot(k) { return { x: 460 + k * 70, y: 428, r: 0, s: 0.95 }; }
    function deal1(card, to, up, delay) {
      var sp = S3.card(stage, card);
      sp.x = DECK.x + 40; sp.y = DECK.y; sp.h = 8; sp.r = -20; sp.s = 0.8; sp.o = 0; sp.draw();
      later(delay, function () { sp.o = 1; sp.draw(); dealer.flick(DECK); dealer.look(to, 400); });
      move(sp, { x: to.x, y: to.y, r: to.r, s: to.s, h: 0 }, 340, delay, { arc: 30 });
      if (up) later(delay + 170, function () { S3.flip(tl, sp, true); });
      return sp;
    }
    function reveal(i, up) { (holes[i] || []).forEach(function (sp) { if (sp.up !== up) S3.flip(tl, sp, up); }); }

    /* ---------- chips ---------- */
    function betLabel(i, amount) {
      var b = bets[i];
      if (b.label) b.label.remove();
      b.label = null;
      if (!amount) return;
      var at = SEATS[i].bet, l = new S3.Label(stage, 'bet-label'); l.text(String(amount)); l.x = at.x; l.y = at.y; l.dy = 22; b.label = l;
    }
    function setBet(i, amount, delay) {
      var b = bets[i] || (bets[i] = { sp: null, label: null, amount: 0 }), at = SEATS[i].bet, from = SEATS[i].fly;
      var chip = S3.chip(stage, 'red');
      chip.x = from.x; chip.y = from.y; chip.h = 20; chip.o = 0; chip.draw();
      later(delay, function () { chip.o = 1; chip.draw(); });
      move(chip, { x: at.x, y: at.y, h: 0 }, 360, delay, { arc: 26, done: function () {
        chip.remove();
        if (b.sp) b.sp.remove();
        b.sp = S3.stack(stage, amount, 6); b.sp.x = at.x; b.sp.y = at.y; b.sp.draw();
        b.amount = amount; betLabel(i, amount);
      } });
    }
    function drawPot(amount) {
      if (pot) pot.remove();
      if (potLabel) potLabel.remove();
      pot = potLabel = null;
      if (!amount) return;
      pot = S3.stack(stage, amount, 12); pot.x = POT.x; pot.y = POT.y; pot.draw();
      potLabel = new S3.Label(stage, 'pot-pill'); potLabel.text('Pot ' + amount); potLabel.x = POT.x; potLabel.y = POT.y; potLabel.dx = 78;
    }
    function placeButton(i, delay) {
      var at = SEATS[i].bet, side = at.x > 600 ? -1 : 1, to = { x: at.x + side * 36, y: at.y + 18 };
      if (!button) {
        var c = S3.canvas(128, 128), g = c.getContext('2d');
        g.fillStyle = '#fbfaf5'; g.beginPath(); g.arc(64, 64, 64, 0, 6.2832); g.fill();
        g.fillStyle = '#1c1c1c'; g.font = '700 70px ' + S3.FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('D', 64, 68);
        var top = S3.std('#ffffff', { rough: 0.4, map: S3.texture(c) }), grp = new T.Group();
        S3.mesh(new T.CylinderGeometry(15, 15, 5, 32), [S3.std('#d8d2c2', { rough: 0.5 }), top, top], grp).position.y = 2.5;
        button = new S3.Piece(stage, grp); button.x = to.x; button.y = to.y; button.draw();
        stage.pieces.remove(grp); stage.table.add(grp);         // the button stays between hands
      }
      move(button, to, 400, delay, { arc: 14 });
    }

    /* ---------- effects ---------- */
    function floatText(str, color, x, y, delay, cls) {
      var l = new S3.Label(stage, cls || 'fx-say'); l.text(str); l.el.style.color = color;
      l.x = x; l.y = y; l.h = 20; l.o = 0; l.draw(); fx.push(l);
      later(delay, function () { l.o = 1; l.draw(); });
      move(l, { h: 90 }, 1300, delay);
      move(l, { o: 0 }, 1300, delay, { ease: easeIn, done: function () { l.remove(); } });
    }
    /* The thought bubble over seat i: a title, or up to three smell lines [{label, v}]. */
    function think(i, main, lines) {
      bubble.show(i !== null && i !== undefined);
      if (i === null || i === undefined) return;
      bubble.head = function () { return head(i); };
      bubble.side = SEATS[i].fly.x > 600 ? -1 : 1;
      var box = bubble.el; box.textContent = '';
      if (main) { var m = document.createElement('b'); m.className = 'think-main'; m.textContent = main; box.appendChild(m); return; }
      (lines || []).forEach(function (l) {
        var row = document.createElement('span'), a = document.createElement('span'), v = document.createElement('span');
        row.className = 'think-row'; a.textContent = l.label; v.className = 'think-val';
        v.textContent = (l.v < 0 ? '−' : '+') + Math.abs(l.v).toFixed(2); v.style.color = l.v >= 0 ? '#2c6fd0' : '#c4501c';
        row.appendChild(a); row.appendChild(v); box.appendChild(row);
      });
    }
    function scent(i, color) {
      if (!color) { trail.show(null); return; }
      var c = SEATS[i].cards;
      trail.show(color, function () { return stage.map(c.x, c.y, 6); }, function () { return head(i); });
    }
    function puppet(i) { return seats[i] && seats[i].fly; }

    /* ---------- what the game asks for ---------- */
    function clearAll() {
      tl.clear();
      while (stage.pieces.children.length) stage.pieces.remove(stage.pieces.children[0]);
      bets.forEach(function (b) { if (b && b.label) b.label.remove(); });
      if (potLabel) potLabel.remove();
      fx.forEach(function (l) { l.remove(); }); fx = [];
      holes = []; bets = []; board = []; pot = potLabel = null;
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
      old.forEach(function (sp, k) { move(sp, { x: MUCK.x, y: MUCK.y, h: 10, r: 0, s: 0.5, o: 0 }, 380, 80 + k * 25, { arc: 16, done: sp.remove.bind(sp) }); });
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
      dealer.look(head(i), 1500);
    }
    function waitFor(i) { plate(i, { acting: true }); dealer.look(head(i), 1e9); }
    var SAY = { fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise' };
    /* Seat i did ev (from Poker.Hand.act). Returns how long the gesture takes. */
    function act(i, ev, stack) {
      var f = puppet(i), at = SEATS[i], ms = 800;
      scent(null); dealer.look(null, 0);
      if (f) f.glow('#7df0c4', 0, 0);
      think(f ? i : null, ev.type === 'fold' ? 'Fold.' : ev.type === 'check' ? 'Check.' : SAY[ev.type] + (ev.type === 'call' ? ' ' + ev.paid : ' to ' + ev.level) + '!');
      floatText(ev.type === 'check' || ev.type === 'fold' ? SAY[ev.type] : SAY[ev.type] + ' ' + (ev.type === 'call' ? ev.paid : ev.level), ev.type === 'fold' ? '#ff9b7a' : '#f3ead2', at.bet.x, at.bet.y, 150);
      if (ev.type === 'fold') {
        if (f) f.act('fold');
        (holes[i] || []).forEach(function (sp, k) { move(sp, { x: MUCK.x, y: MUCK.y, h: 10, s: 0.5, o: 0, r: 0 }, 420, 250 + k * 60, { arc: 20, done: sp.remove.bind(sp) }); });
        holes[i] = [];
        later(500, function () { plate(i, { folded: true, acting: false }); });
        ms = 900;
      } else if (ev.type === 'check') {
        if (f) {
          f.act('tap');
          var c = SEATS[i].cards, p = { x: (at.fly.x * 2 + c.x) / 3, y: (at.fly.y * 2 + c.y) / 3 };
          S3.ripple(stage, tl, p.x, p.y, 380); S3.ripple(stage, tl, p.x, p.y, 760);
        }
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
    function dealBoard(cards, from) {
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
        later(300, function () { floatName(q.handName, c.x, c.y); });
        t = 900;
      });
      return t;
    }
    function floatName(str, x, y) {
      var l = new S3.Label(stage, 'hand-name'); l.text(str); l.x = x; l.y = y; l.h = 50; fx.push(l);
      return l;
    }
    /* The pot goes to the winner(s); each fly reacts to how its hand went. */
    function payout(hand) {
      var amountTotal = hand.pot(), t = 200;
      think(null); scent(null);
      if (pot) { var p0 = pot; pot = null; p0.remove(); }
      drawPot(0);
      hand.winners.forEach(function (w, k) {
        var q = hand.p[w.i], at = SEATS[q.seat], sp = S3.stack(stage, w.amount, 12);
        sp.x = POT.x; sp.y = POT.y; sp.draw();
        dealer.reach(k === 0, POT, 0);
        move(sp, { x: at.bet.x, y: at.bet.y }, 500, t + k * 150, { arc: 30, done: function () {
          move(sp, { x: at.fly.x, y: at.fly.y, o: 0 }, 420, 500, { done: sp.remove.bind(sp) });
        } });
        floatText('+' + w.amount, '#ffd46b', at.bet.x, at.bet.y, t + 400, 'fx-float');
        later(t + 1100, function () { plate(q.seat, { stack: q.stack }); });
        S3.sparkle(stage, tl, w.amount >= 30 ? 22 : 10, head(q.seat).add(new T.Vector3(0, 20, 0)), w.amount >= 30 ? 110 : 70, ['#ffd46b', '#fff3c4', '#ff9fd0'], t + 350);
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
    /* A finished hand laid out at once (with reduced motion). */
    function show(hand, faceUp) {
      clearAll();
      snap = true;
      placeButton(hand.p[hand.button].seat, 0);
      hand.p.forEach(function (q) {
        plate(q.seat, { stack: q.stack, folded: q.folded, acting: false });
        if (q.folded) return;
        holes[q.seat] = q.hole.map(function (c, k) { return deal1(c, holeSlot(q.seat, k), hand.showdown || faceUp(q.seat), 0); });
        if (hand.showdown) { var c = SEATS[q.seat].cards; floatName(q.handName, c.x, c.y); }
      });
      hand.board.forEach(function (c, k) { board.push(deal1(c, boardSlot(k), true, 0)); });
      snap = false;
    }
    function clear() { sweep(); if (button) { button.remove(); button = null; } }

    function tick(t, busy) {
      tl.run(t);
      seats.forEach(function (s) { if (s.fly) s.fly.pose(t, busy); });
      dealer.pose(t, { x: 600, y: 560, h: 40 }, reduce);
      stage.render(t);
    }

    return {
      setSeats: setSeats, plate: plate, deal: deal, sniff: sniff, waitFor: waitFor, act: act, gather: gather, board: dealBoard,
      showdown: showdown, payout: payout, dopamine: dopamine, reveal: reveal, show: show, clear: clear, tick: tick,
      onSeatClick: function (fn) { onSeatClick = fn; }, looks: Object.keys(K.FLY_LOOKS)
    };
  }

  root.PokerScene = PokerScene;
})(self);

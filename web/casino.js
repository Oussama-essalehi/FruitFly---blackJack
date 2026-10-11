/* FlyJack - the blackjack table, in 3D. The room, lamp, dealer and pieces come from
   web/scene3d.js and the fly from web/fly3d.js; this file deals the cards, moves the chips and
   makes the fly act out what its brain decided: it sniffs each choice, taps the felt to hit,
   waves a leg to stand. Places are in table units (the old 1200 x 675 drawing), mapped onto a
   half-round felt with the dealer behind its straight side. */
(function (root) {
  'use strict';
  var K = root.SceneKit, S3 = root.Scene3D, T = root.THREE, easeIn = K.easeIn;
  var SHOE = { x: 826, y: 288 }, DISCARD = { x: 320, y: 282 }, TRAY = { x: 600, y: 287 }, BET = { x: 690, y: 548 },
    POCKET = { x: 818, y: 556 }, FLY_AT = { x: 860, y: 566 }, FOOT = { x: 780, y: 565 };
  var R = 480, DEALER = { z: -78, restL: { x: 490, y: 298 }, restR: { x: 742, y: 300 } };
  var SMELL_GOOD = '#6aa8ff', SMELL_BAD = '#ff8a50';
  function feltXY(x, y) { return [x - 600, (y - 290) * 1.35]; }

  function Casino(el, options) {
    var reduce = !!(options && options.reduceMotion), BJ = root.Blackjack;
    var stage = new S3.Stage(el, {
      map: feltXY,
      views: { wide: { pos: [0, 330, 1000], target: [0, 95, 120], fov: 40 }, narrow: { pos: [40, 420, 720], target: [30, 40, 220], fov: 50 } }
    });
    stage.reduce = reduce;
    stage.pieces = new T.Group(); stage.scene.add(stage.pieces);
    var snap = false, tl = new K.Timeline(function () { return snap || reduce; });
    var move = tl.move.bind(tl), later = tl.later.bind(tl);

    /* ---------- the room and the table ---------- */
    S3.buildRoom(stage, {
      wallZ: -430, seed: 7, lamp: { x: 0, y: 500, z: 150, aim: [0, 0, 180] },
      neon: [{ text: 'FlyJack', fill: '#ffe1f1', glow: '#ff4fae', x: -470, y: 330, w: 440, size: 170 },
             { text: '♠ ♥ ♦ ♣', fill: '#d9f7ff', glow: '#39cfff', x: 470, y: 330, w: 420, size: 130, phase: 4 }]
    });
    S3.blackjackTable(stage, R, function (g) {
      g.fillStyle = 'rgba(232,194,122,0.62)'; g.font = '600 19px ' + S3.MONO; g.textAlign = 'center'; g.textBaseline = 'middle';
      var str = 'BLACKJACK PAYS 3 TO 2  ·  DEALER STANDS ON 17', r = 178, span = 1.9;
      for (var i = 0; i < str.length; i++) {
        var a = Math.PI / 2 + span / 2 - span * (i + 0.5) / str.length;
        g.save(); g.translate(r * Math.cos(a), r * Math.sin(a)); g.rotate(a - Math.PI / 2); g.fillText(str[i], 0, 0); g.restore();
      }
      g.strokeStyle = 'rgba(232,194,122,0.4)'; g.lineWidth = 2.5;
      g.beginPath(); g.arc(0, 0, 300, 0.25, Math.PI - 0.25); g.stroke();
      g.beginPath(); g.arc(0, 0, 410, 0.12, Math.PI - 0.12); g.stroke();
      var b = feltXY(BET.x, BET.y);
      g.lineWidth = 3; g.beginPath(); g.arc(b[0], b[1], 30, 0, 6.2832); g.stroke();
      g.lineWidth = 1.5; g.beginPath(); g.arc(b[0], b[1], 36, 0, 6.2832); g.stroke();
    });
    var t0 = feltXY(TRAY.x, TRAY.y); S3.chipTray(stage, t0[0], t0[1] - 6, ['red', 'green', 'black', 'blue', 'purple', 'white', 'red', 'green']);
    var s0 = feltXY(SHOE.x, SHOE.y); S3.shoe(stage, s0[0] + 20, s0[1] - 30);
    var d0 = feltXY(DISCARD.x, DISCARD.y), disc = S3.mesh(new T.BoxGeometry(70, 30, 96), S3.std('#1a1716', { rough: 0.3, opacity: 0.9 }), stage.table);
    disc.position.set(d0[0] - 10, 15, d0[1] - 30); disc.rotation.y = 0.3;
    S3.wineGlass(stage, 410, 40); S3.snack(stage, -340, 300); S3.gnat(stage, 420, 170, 40);

    /* ---------- the fly and the dealer ---------- */
    var fly = new K.Fly({ reduce: reduce }), f0 = feltXY(FLY_AT.x, FLY_AT.y), aim = feltXY(560, 400);
    fly.group.position.set(f0[0], 0, f0[1]); fly.group.scale.setScalar(0.72);
    fly.group.rotation.y = Math.atan2(-(aim[1] - f0[1]), aim[0] - f0[0]);
    fly.nearSide = Math.cos(fly.group.rotation.y) > 0 ? 1 : -1;
    stage.scene.add(fly.group);
    var dealer = new S3.Dealer(stage, tl, DEALER);
    var flyHead = function () { return fly.headAt(); };

    /* ---------- words over the table ---------- */
    var badges = { fly: new S3.Label(stage, 'badge'), dealer: new S3.Label(stage, 'badge') };
    badges.fly.x = 548; badges.fly.y = 500; badges.dealer.x = 480; badges.dealer.y = 372;
    [badges.fly, badges.dealer].forEach(function (b) { b.show(false); });
    var bubble = new S3.Bubble(stage); bubble.head = flyHead; bubble.side = 1;
    bubble.el.innerHTML = '<b class="think-main"></b><span class="think-sub"></span>';
    var trail = new S3.Trail(stage);
    var table = { hand: null, fly: [], dealer: [], bet: [], open: false }, fx = [];

    /* ---------- cards ---------- */
    function slot(seat, i, n) {
      if (seat === 'fly') { var gap = n > 5 ? 104 / (n - 1) : 30; return { x: 588 + i * gap, y: 470 - i * 3, r: -6 + i * 3 }; }
      var g2 = n > 6 ? 222 / (n - 1) : 46;
      return { x: 558 + i * g2, y: 350, r: i % 2 ? 1.5 : -1.5 };
    }
    function dealCard(seat, card, up, delay) {
      var list = table[seat], sp = S3.card(stage, card), n = list.length + 1, to = slot(seat, n - 1, n);
      list.push(sp);
      sp.x = SHOE.x; sp.y = SHOE.y - 10; sp.h = 30; sp.r = -24; sp.s = 0.9; sp.o = 0; sp.draw();
      later(delay, function () { sp.o = 1; sp.draw(); dealer.flick(SHOE); dealer.look(to, 500); });
      move(sp, { x: to.x, y: to.y, r: to.r, s: 1, h: 0 }, 380, delay, { arc: 40 });
      if (up) later(delay + 170, function () { S3.flip(tl, sp, true); });
      for (var j = 0; j < list.length - 1; j++) move(list[j], slot(seat, j, n), 260, delay);   // make room when the hand gets long
    }
    function isOpen(hand) { return !!(hand.holeShown || (hand.done && hand.result !== 'bust')); }

    /* the totals beside each hand */
    function badge(b, str, color) {
      if (!str) { b.show(false); return; }
      b.text(str); b.el.style.color = color || ''; b.show(true);
    }
    function flyBadge(hand) {
      var p = BJ.handOf(hand.player);
      badge(badges.fly, p.total > 21 ? p.total + ' bust' : (p.soft && p.total < 21 ? 'soft ' : '') + p.total, p.total > 21 ? '#ff9b7a' : p.total === 21 ? '#f2cf72' : '');
    }
    function dealerBadge(hand, n) {
      if (!table.open) { badge(badges.dealer, 'shows ' + (hand.up === 11 ? 'A' : hand.up)); return; }
      var d = BJ.handOf(hand.dealer.slice(0, n || hand.dealer.length));
      badge(badges.dealer, d.total > 21 ? d.total + ' bust' : String(d.total), d.total > 21 ? '#f2cf72' : '');
    }
    function hideBadges() { badge(badges.fly, ''); badge(badges.dealer, ''); }

    /* ---------- chips ---------- */
    function chipTo(sp, k, delay) { move(sp, { x: BET.x, y: BET.y, h: k * 5.2, o: 1 }, 380, delay, { arc: 28 }); }
    function placeBet(delay) {
      var sp = S3.chip(stage, 'red');
      sp.x = POCKET.x; sp.y = POCKET.y; sp.o = 0; sp.draw();
      table.bet.push(sp); chipTo(sp, 0, delay);
    }
    function chipsAway(to, delay) {
      table.bet.forEach(function (sp, k) { move(sp, { x: to.x, y: to.y, h: 0, o: 0, s: 0.8 }, 420, delay + k * 70, { arc: 20, done: function () { sp.remove(); } }); });
      table.bet = [];
    }

    /* ---------- effects ---------- */
    function floatText(str, color, x, y, delay) {
      var l = new S3.Label(stage, 'fx-float'); l.text(str); l.el.style.color = color;
      l.x = x; l.y = y; l.h = 30; l.o = 0; l.draw(); fx.push(l);
      later(delay, function () { l.o = 1; l.draw(); });
      move(l, { h: 120 }, 1400, delay);
      move(l, { o: 0 }, 1400, delay, { ease: easeIn, done: function () { l.remove(); } });
    }
    function think(main, sub, subColor) {
      bubble.show(!!main);
      if (!main) return;
      bubble.el.querySelector('.think-main').textContent = main;
      var s = bubble.el.querySelector('.think-sub'); s.textContent = sub || ''; s.style.color = subColor || '';
    }
    function scent(color) {
      var last = table.fly[table.fly.length - 1];
      trail.show(color, last ? function () { return last.obj.getWorldPosition(new T.Vector3()).add(new T.Vector3(0, 8, 0)); } : null, flyHead);
      if (!last) trail.show(null);
    }

    /* ---------- what the page asks for ---------- */
    function sweep() {
      var old = table.fly.concat(table.dealer);
      table.fly = []; table.dealer = []; table.hand = null; table.open = false;
      chipsAway(TRAY, 0);
      if (!old.length) return 0;
      if (tl.instant()) { old.forEach(function (sp) { sp.remove(); }); return 0; }
      dealer.reach(true, { x: 610, y: 400 }, 0);
      old.forEach(function (sp, i) {
        move(sp, { x: DISCARD.x + (i % 3) * 3, y: DISCARD.y - 4, h: 30, r: 0, s: 0.6, o: 0 }, 430, 120 + i * 45, { arc: 18, done: function () { sp.remove(); } });
      });
      return 520 + old.length * 45;
    }
    function clearAll() {
      tl.clear();
      while (stage.pieces.children.length) stage.pieces.remove(stage.pieces.children[0]);
      fx.forEach(function (l) { l.remove(); }); fx = [];
      table = { hand: null, fly: [], dealer: [], bet: [], open: false };
      dealer.reset();
    }

    /* A fresh hand: clear the old cards, bet, deal fly, dealer, fly, dealer (face down). */
    function deal(hand) {
      think(null); scent(null); fly.act('idle');
      var t = sweep();
      hideBadges();
      table.hand = hand;
      placeBet(t); t += 300;
      dealCard('fly', hand.player[0], true, t); t += 240;
      dealCard('dealer', hand.dealer[0], true, t); t += 240;
      dealCard('fly', hand.player[1], true, t); t += 240;
      dealCard('dealer', hand.dealer[1], false, t); t += 400;
      later(t - 80, function () { flyBadge(hand); dealerBadge(hand); });
      return t;
    }
    /* Show whatever the hand gained since last time: the fly's new card, the hole card, the
       dealer's draws. Returns how long that takes. */
    function update(hand) {
      if (hand !== table.hand) { show(hand); return 0; }
      var t = 0, i;
      for (i = table.fly.length; i < hand.player.length; i++) { dealCard('fly', hand.player[i], true, t); t += 300; }
      if (t) { t += 120; later(t, function () { flyBadge(hand); }); }
      if (isOpen(hand) && !table.open) {
        var hole = table.dealer[1];
        t += 250; dealer.reach(true, hole, t); dealer.look(hole, 900);
        later(t + 170, function () { table.open = true; S3.flip(tl, hole, true); });
        t += 520; later(t, function () { dealerBadge(hand, 2); });
        for (i = 2; i < hand.dealer.length; i++) {
          dealCard('dealer', hand.dealer[i], true, t); t += 560;
          (function (n) { later(t - 140, function () { dealerBadge(hand, n); }); })(i + 1);
        }
      }
      return t + 120;
    }
    function sniff(hit, v) {
      fly.act('sniff');
      var good = v >= 0;
      think(hit ? 'Hit?' : 'Stand?', 'smells ' + (good ? 'good ' : 'bad ') + (v < 0 ? '−' : '+') + Math.abs(v).toFixed(2), good ? '#2c6fd0' : '#c4501c');
      scent(good ? SMELL_GOOD : SMELL_BAD);
      fly.glow('#7df0c4', 0.45, 0);
    }
    function choose(hit) {
      scent(null); fly.glow('#7df0c4', 0, 0);
      fly.act(hit ? 'tap' : 'wave');
      think(hit ? 'Hit!' : 'Stand.', hit ? 'taps the felt' : 'waves it off', '#47564d');
      if (hit) { S3.ripple(stage, tl, FOOT.x, FOOT.y, 380); S3.ripple(stage, tl, FOOT.x, FOOT.y, 760); }
      dealer.look(FOOT, 900);
      return hit ? 900 : 1150;
    }
    function settle(hand) {
      var r = hand.reward, res = hand.result;
      think(null); scent(null);
      fly.act(res === 'blackjack' ? 'blackjack' : r > 0 ? 'win' : res === 'bust' ? 'bust' : r < 0 ? 'lose' : 'shrug');
      dealer.mood(r > 0 ? 'surprised' : r < 0 ? 'smile' : 'neutral', 1900);
      floatText(r > 0 ? '+' + r : r < 0 ? '−' + -r : 'push', r > 0 ? '#ffd46b' : r < 0 ? '#ff8a6b' : '#e8e2d4', BET.x, BET.y, 120);
      if (r > 0) {
        var pay = r === 1.5 ? ['red', 'blue'] : ['red'], n = table.bet.length;
        pay.forEach(function (c, k) {
          var sp = S3.chip(stage, c);
          sp.x = TRAY.x; sp.y = TRAY.y; sp.o = 0; sp.draw();
          table.bet.push(sp); chipTo(sp, n + k, 150 + k * 160);
        });
        dealer.look(BET, 900); dealer.reach(true, TRAY, 60);
        chipsAway(POCKET, 1050);
        S3.sparkle(stage, tl, res === 'blackjack' ? 26 : 12, fly.headAt().add(new T.Vector3(0, 30, 0)), res === 'blackjack' ? 140 : 80, ['#ffd46b', '#fff3c4', '#ff9fd0'], 200);
      } else if (r < 0) {
        dealer.reach(true, BET, 300); chipsAway(TRAY, 420);
      } else {
        chipsAway(POCKET, 700);
      }
      return res === 'blackjack' ? 2600 : 2000;
    }
    function dopamine(surprise) {
      if (surprise === null || surprise === undefined || Math.abs(surprise) <= 0.05) return;
      fly.glow(surprise > 0 ? '#4d9bff' : '#ff6a2e', Math.min(0.95, Math.abs(surprise) * 1.5 + 0.35), 1700);
    }
    /* A finished hand laid out at once (Fast and Turbo, or with reduced motion). */
    function show(hand) {
      clearAll();
      snap = true;
      table.hand = hand; table.open = isOpen(hand);
      for (var i = 0; i < hand.player.length; i++) dealCard('fly', hand.player[i], true, 0);
      for (i = 0; i < hand.dealer.length; i++) if (i < 2 || table.open) dealCard('dealer', hand.dealer[i], i !== 1 || table.open, 0);
      flyBadge(hand); dealerBadge(hand);
      think(null); scent(null);
      snap = false;
    }
    function clear() { think(null); scent(null); fly.act('idle'); sweep(); hideBadges(); }

    function tick(t, busy) {
      tl.run(t);
      fly.pose(t, busy);
      dealer.pose(t, flyHead(), reduce);
      stage.render(t);
    }

    return { tick: tick, deal: deal, update: update, sniff: sniff, choose: choose, settle: settle, dopamine: dopamine, show: show, clear: clear };
  }

  root.Casino = Casino;
})(self);

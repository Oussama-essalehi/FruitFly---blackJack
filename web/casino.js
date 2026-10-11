/* FlyJack - the blackjack table. The room, the table, the dealer and the fly are drawn in
   web/page.html, the moving pieces come from web/scenekit.js; this file deals the cards, moves
   the chips and makes the fly act out what its brain decided: it sniffs each choice, taps the
   felt to hit, waves a leg to stand. */
(function (root) {
  'use strict';
  var K = root.SceneKit, make = K.make, text = K.text, r2 = K.r2, easeIn = K.easeIn, Sprite = K.Sprite;
  // places on the table, in scene units (the scene is 1200 x 675)
  var SHOE = { x: 826, y: 288 }, DISCARD = { x: 320, y: 282 }, TRAY = { x: 600, y: 287 }, BET = { x: 690, y: 548 },
    POCKET = { x: 818, y: 556 }, FLY_HEAD = { x: 796, y: 462 }, FOOT = { x: 780, y: 565 };
  var DEALER = { shoulderL: { x: 532, y: 222 }, shoulderR: { x: 668, y: 222 }, restL: { x: 490, y: 298 }, restR: { x: 742, y: 300 } };
  var SMELL_GOOD = '#6aa8ff', SMELL_BAD = '#ff8a50';

  function Casino(svg, options) {
    var reduce = !!(options && options.reduceMotion), BJ = root.Blackjack;
    var $ = function (id) { return document.getElementById(id); };
    var layer = { cards: $('cj-cards'), chips: $('cj-chips'), fx: $('cj-fx') };
    var bubble = $('cj-bubble'), scentG = $('cj-scent'), gnat = $('cj-gnat');
    var snap = false, tl = new K.Timeline(function () { return snap || reduce; });
    var move = tl.move.bind(tl), later = tl.later.bind(tl);
    var fly = new K.Fly($('cj-fly'), { reduce: reduce });
    var dealer = new K.Dealer($('cj-dealer'), $('cj-arms'), tl, DEALER);
    var table = { hand: null, fly: [], dealer: [], bet: [], open: false };

    K.decorateRoom($('cj-bokeh'), 7);
    K.decorateTray($('cj-tray'), 506, 278);

    /* ---------- cards ---------- */
    function slot(seat, i, n) {
      if (seat === 'fly') { var gap = n > 5 ? 104 / (n - 1) : 26; return { x: 588 + i * gap, y: 470 - i * 3, r: -6 + i * 3 }; }
      var g2 = n > 6 ? 222 / (n - 1) : 44;
      return { x: 558 + i * g2, y: 350, r: i % 2 ? 1.5 : -1.5 };
    }
    function dealCard(seat, card, up, delay) {
      var list = table[seat], sp = K.cardSprite(layer.cards, card), n = list.length + 1, to = slot(seat, n - 1, n);
      list.push(sp);
      sp.x = SHOE.x; sp.y = SHOE.y; sp.r = -24; sp.s = 0.85; sp.o = 0; sp.draw();
      later(delay, function () { sp.o = 1; sp.draw(); dealer.flick(SHOE); dealer.look(to, 500); });
      move(sp, { x: to.x, y: to.y, r: to.r, s: 1 }, 380, delay, { arc: 40 });
      if (up) later(delay + 170, function () { K.flip(tl, sp, true); });
      for (var j = 0; j < list.length - 1; j++) move(list[j], slot(seat, j, n), 260, delay);   // make room when the hand gets long
    }
    function isOpen(hand) { return !!(hand.holeShown || (hand.done && hand.result !== 'bust')); }

    /* the totals in little pills beside each hand */
    function badge(id, str, right, y, color) {
      var g = $(id), t = g.querySelector('text'), rect = g.querySelector('rect');
      if (!str) { g.classList.remove('on'); return; }
      var w = Math.max(46, 18 + str.length * 9.7);
      t.textContent = str; t.style.fill = color || '';
      rect.setAttribute('x', r2(-w / 2)); rect.setAttribute('width', r2(w));
      g.setAttribute('transform', 'translate(' + r2(right - w / 2) + ' ' + y + ')');
      g.classList.add('on');
    }
    function flyBadge(hand) {
      var p = BJ.handOf(hand.player);
      badge('cj-badge-fly', p.total > 21 ? p.total + ' bust' : (p.soft && p.total < 21 ? 'soft ' : '') + p.total, 548, 474, p.total > 21 ? '#ff9b7a' : p.total === 21 ? '#f2cf72' : '');
    }
    function dealerBadge(hand, n) {
      if (!table.open) { badge('cj-badge-dealer', 'shows ' + (hand.up === 11 ? 'A' : hand.up), 520, 350); return; }
      var d = BJ.handOf(hand.dealer.slice(0, n || hand.dealer.length));
      badge('cj-badge-dealer', d.total > 21 ? d.total + ' bust' : String(d.total), 520, 350, d.total > 21 ? '#f2cf72' : '');
    }
    function hideBadges() { badge('cj-badge-fly', ''); badge('cj-badge-dealer', ''); }

    /* ---------- chips ---------- */
    function chipTo(sp, k, delay) { move(sp, { x: BET.x, y: BET.y - k * 5, o: 1 }, 380, delay, { arc: 28 }); }
    function placeBet(delay) {
      var sp = K.chipSprite(layer.chips, 'red');
      sp.x = POCKET.x; sp.y = POCKET.y; sp.o = 0; sp.draw();
      table.bet.push(sp); chipTo(sp, 0, delay);
    }
    function chipsAway(to, delay) {
      table.bet.forEach(function (sp, k) { move(sp, { x: to.x, y: to.y, o: 0, s: 0.8 }, 420, delay + k * 70, { arc: 20, done: function () { sp.remove(); } }); });
      table.bet = [];
    }

    /* ---------- effects ---------- */
    function floatText(str, color, x, y, delay) {
      var g = make('g', {}, layer.fx), sp = new Sprite(g);
      text(g, str, 0, 0, 'fx-float', color, 'middle');
      sp.x = x; sp.y = y; sp.o = 0; sp.draw();
      later(delay, function () { sp.o = 1; sp.draw(); });
      move(sp, { y: y - 56 }, 1400, delay);
      move(sp, { o: 0 }, 1400, delay, { ease: easeIn, done: function () { sp.remove(); } });
    }
    function sparkle(n, cx, cy, spread, colors, delay) {
      if (tl.instant()) return;
      for (var i = 0; i < n; i++) {
        var g = make('g', {}, layer.fx), sp = new Sprite(g), a = Math.PI * 2 * i / n + Math.random() * 0.5, d = spread * (0.6 + Math.random() * 0.6);
        make('path', { d: 'M0 -8L2 -2L8 0L2 2L0 8L-2 2L-8 0L-2 -2Z', fill: colors[i % colors.length] }, g);
        sp.x = cx; sp.y = cy; sp.s = 0.3; sp.o = 0; sp.draw();
        (function (sp, dl) { later(dl, function () { sp.o = 1; sp.draw(); }); })(sp, delay + i * 18);
        move(sp, { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d * 0.7, s: 0.6 + Math.random() * 0.7, r: 140 }, 650, delay + i * 18);
        move(sp, { o: 0 }, 900, delay + i * 18, { ease: easeIn, done: sp.remove.bind(sp) });
      }
    }
    function ripple(delay) {
      if (tl.instant()) return;
      var g = make('g', {}, layer.fx), sp = new Sprite(g);
      make('ellipse', { rx: 10, ry: 3.5, fill: 'none', stroke: '#fff', 'stroke-width': 2 }, g);
      sp.x = FOOT.x; sp.y = FOOT.y; sp.s = 0.4; sp.o = 0; sp.draw();
      later(delay, function () { sp.o = 0.9; sp.draw(); });
      move(sp, { s: 2.6, o: 0 }, 480, delay, { done: sp.remove.bind(sp) });
    }
    function think(main, sub, subColor) {
      bubble.classList.toggle('on', !!main);
      if (!main) return;
      $('cj-bubble-main').textContent = main;
      var s = $('cj-bubble-sub'); s.textContent = sub || ''; s.style.fill = subColor || '';
    }
    function scent(color) {
      scentG.classList.toggle('on', !!color);
      if (color) Array.prototype.forEach.call(scentG.children, function (p) { p.style.stroke = color; });
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
        move(sp, { x: DISCARD.x + (i % 3) * 3, y: DISCARD.y - 4, r: 0, s: 0.45, o: 0 }, 430, 120 + i * 45, { arc: 18, done: function () { sp.remove(); } });
      });
      return 520 + old.length * 45;
    }
    function clearAll() {
      tl.clear();
      [layer.cards, layer.chips, layer.fx].forEach(function (l) { while (l.firstChild) l.removeChild(l.firstChild); });
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
        later(t + 170, function () { table.open = true; K.flip(tl, hole, true); });
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
      if (hit) { ripple(380); ripple(760); }
      dealer.look(FOOT, 900);
      return hit ? 900 : 1150;
    }
    function settle(hand) {
      var r = hand.reward, res = hand.result;
      think(null); scent(null);
      fly.act(res === 'blackjack' ? 'blackjack' : r > 0 ? 'win' : res === 'bust' ? 'bust' : r < 0 ? 'lose' : 'shrug');
      dealer.mood(r > 0 ? 'surprised' : r < 0 ? 'smile' : 'neutral', 1900);
      floatText(r > 0 ? '+' + r : r < 0 ? '−' + -r : 'push', r > 0 ? '#ffd46b' : r < 0 ? '#ff8a6b' : '#e8e2d4', BET.x, BET.y - 34, 120);
      if (r > 0) {
        var pay = r === 1.5 ? ['red', 'blue'] : ['red'], n = table.bet.length;
        pay.forEach(function (c, k) {
          var sp = K.chipSprite(layer.chips, c);
          sp.x = TRAY.x; sp.y = TRAY.y; sp.o = 0; sp.draw();
          table.bet.push(sp); chipTo(sp, n + k, 150 + k * 160);
        });
        dealer.look(BET, 900); dealer.reach(true, TRAY, 60);
        chipsAway(POCKET, 1050);
        sparkle(res === 'blackjack' ? 26 : 12, FLY_HEAD.x + 40, FLY_HEAD.y - 30, res === 'blackjack' ? 140 : 80, ['#ffd46b', '#fff3c4', '#ff9fd0'], 200);
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
      dealer.pose(t, FLY_HEAD, reduce);
      if (!reduce) gnat.setAttribute('transform', 'translate(' + r2(1010 + 30 * Math.cos(t / 520)) + ' ' + r2(246 + 12 * Math.sin(t / 260) + 3 * Math.sin(t / 70)) + ')');
    }

    // phones: frame the middle of the room so the cards stay readable
    function frame() { svg.setAttribute('viewBox', svg.clientWidth && svg.clientWidth < 560 ? '170 40 860 610' : '0 0 1200 675'); }
    if (root.ResizeObserver) new ResizeObserver(frame).observe(svg); else root.addEventListener('resize', frame);
    frame();

    return { tick: tick, deal: deal, update: update, sniff: sniff, choose: choose, settle: settle, dopamine: dopamine, show: show, clear: clear };
  }

  root.Casino = Casino;
})(self);

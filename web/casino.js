/* FlyJack - the casino scene. The room, the table, the dealer and the fly are drawn in
   web/page.html; this file deals the cards, moves the chips and makes the fly act out what its
   brain decided: it sniffs each choice, taps the felt to hit, waves a leg to stand. */
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  // places on the table, in scene units (the scene is 1200 x 675)
  var SHOE = { x: 826, y: 288 }, DISCARD = { x: 320, y: 282 }, TRAY = { x: 600, y: 287 }, BET = { x: 690, y: 548 },
    POCKET = { x: 818, y: 556 }, FLY_HEAD = { x: 796, y: 462 }, FOOT = { x: 780, y: 565 };
  var SHOULDER_L = { x: 532, y: 222 }, SHOULDER_R = { x: 668, y: 222 }, REST_L = { x: 490, y: 298 }, REST_R = { x: 742, y: 300 };
  var PIPS = { s: '♠︎', h: '♥︎', d: '♦︎', c: '♣︎' };
  var CHIPS = { red: ['#c0392b', '#7d1f17'], blue: ['#2c5aa0', '#1a3866'] };
  var SMELL_GOOD = '#6aa8ff', SMELL_BAD = '#ff8a50';
  var MOUTH = { neutral: 'M592 167Q600 170 608 167', smile: 'M589 164Q600 176 611 164', surprised: 'M596 168a4 4.5 0 1 0 8 0a4 4.5 0 1 0 -8 0' };

  function make(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function r2(v) { return Math.round(v * 100) / 100; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeOut(p) { return 1 - Math.pow(1 - p, 3); }
  function easeIn(p) { return p * p * p; }
  function easeInOut(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function rot(el, a, cx, cy) { el.setAttribute('transform', 'rotate(' + r2(a) + ' ' + cx + ' ' + cy + ')'); }

  /* Anything that moves: a group drawn around (0, 0), placed at x, y, turned by r, sized by s.
     fx squeezes it sideways (a card flip) and lift raises it (a card's arc through the air). */
  function Sprite(g) { this.g = g; this.x = 0; this.y = 0; this.r = 0; this.s = 1; this.fx = 1; this.o = 1; this.lift = 0; }
  Sprite.prototype.draw = function () {
    this.g.setAttribute('transform', 'translate(' + r2(this.x) + ' ' + r2(this.y - this.lift) + ') rotate(' + r2(this.r) + ') scale(' + r2(this.fx * this.s) + ' ' + r2(this.s) + ')');
    this.g.setAttribute('opacity', r2(this.o));
  };
  Sprite.prototype.remove = function () { if (this.g.parentNode) this.g.parentNode.removeChild(this.g); };
  function Point(p) { this.x = p.x; this.y = p.y; }
  Point.prototype.draw = function () {};

  function Casino(svg, options) {
    var reduce = !!(options && options.reduceMotion), BJ = root.Blackjack;
    var $ = function (id) { return document.getElementById(id); };
    var layer = { cards: $('cj-cards'), chips: $('cj-chips'), fx: $('cj-fx') };
    var part = {
      body: $('cj-fly-body'), head: $('cj-fly-head'), ant: $('cj-fly-antenna'), wingN: $('cj-fly-wing-n'), wingF: $('cj-fly-wing-f'),
      legF: $('cj-fly-leg-f'), legFF: $('cj-fly-leg-ff'), shadow: $('cj-fly-shadow'), buzz: $('cj-fly-buzz'), glow: $('cj-fly-glow'),
      armL: $('cj-arm-l'), armR: $('cj-arm-r'), handL: $('cj-hand-l'), handR: $('cj-hand-r'), pupilL: $('cj-pupil-l'), pupilR: $('cj-pupil-r'),
      eyes: $('cj-eyes'), brows: $('cj-brows'), mouth: $('cj-mouth'), gnat: $('cj-gnat'), scent: $('cj-scent'), bubble: $('cj-bubble')
    };
    var table = { hand: null, fly: [], dealer: [], bet: [], open: false };
    var fly = { state: 'idle', since: -1e6 }, glow = { a: 0, at: 0, fade: 0 };
    var dealer = { handL: new Point(REST_L), handR: new Point(REST_R), look: null, lookUntil: 0, mood: 'neutral', moodUntil: 0 };
    var tweens = [], timers = [], snap = false;

    /* ---------- timing: every move is a tween, every pause a timer ---------- */
    function now() { return performance.now(); }
    function instant() { return snap || reduce; }
    function move(sp, to, ms, delay, o) {
      o = o || {};
      if (instant()) {
        for (var k in to) sp[k] = to[k];
        sp.lift = 0; sp.draw();
        if (o.done) o.done();
        return;
      }
      tweens.push({ sp: sp, to: to, ms: ms, at: now() + (delay || 0), arc: o.arc || 0, ease: o.ease || easeOut, done: o.done, from: null });
    }
    function later(ms, fn) { if (instant()) fn(); else timers.push({ at: now() + ms, fn: fn }); }
    function run(t) {
      var list = timers, i, k;
      timers = [];
      for (i = 0; i < list.length; i++) { if (t >= list[i].at) list[i].fn(); else timers.push(list[i]); }
      list = tweens; tweens = [];
      for (i = 0; i < list.length; i++) {
        var tw = list[i];
        if (t < tw.at) { tweens.push(tw); continue; }
        if (!tw.from) { tw.from = {}; for (k in tw.to) tw.from[k] = tw.sp[k]; }
        var p = tw.ms ? clamp01((t - tw.at) / tw.ms) : 1, e = tw.ease(p);
        for (k in tw.to) tw.sp[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
        if (tw.arc) tw.sp.lift = Math.sin(Math.PI * p) * tw.arc;
        tw.sp.draw();
        if (p < 1) tweens.push(tw); else if (tw.done) tw.done();
      }
    }

    /* ---------- the room ---------- */
    (function decorate() {
      var seed = 7, rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      var bokeh = $('cj-bokeh'), colors = ['#ffcf7a', '#ff8fb0', '#ffe0a8', '#9fd8ff'], i;
      for (i = 0; i < 20; i++) {
        var c = make('circle', { cx: r2(rnd() * 1200), cy: r2(20 + rnd() * 220), r: r2(5 + rnd() * 20), fill: colors[i % 4], 'fill-opacity': r2(0.08 + rnd() * 0.16) }, bokeh);
        c.style.animationDuration = r2(4 + rnd() * 6) + 's'; c.style.animationDelay = -r2(rnd() * 8) + 's';
      }
      var tray = $('cj-tray'), tc = ['#c0392b', '#1f7a4a', '#1b1b1f', '#2c5aa0', '#6a2c8a', '#e8e2d4', '#c0392b', '#1f7a4a'];
      for (i = 0; i < 8; i++) {
        var x = 506 + i * 24;
        make('rect', { x: x, y: 278, width: 20, height: 18, rx: 3, fill: tc[i] }, tray);
        make('path', { d: 'M' + (x + 4) + ' 279V295M' + (x + 10) + ' 279V295M' + (x + 16) + ' 279V295', stroke: '#fff', 'stroke-opacity': 0.35, 'stroke-width': 1.5, 'stroke-dasharray': '3 3' }, tray);
      }
    })();

    /* ---------- cards ---------- */
    function text(parent, str, x, y, cls, fill, anchor) {
      var t = make('text', { x: x, y: y, 'class': cls, fill: fill, 'text-anchor': anchor || 'start' }, parent);
      t.textContent = str;
      return t;
    }
    function cardSprite(card) {
      var g = make('g', {}, layer.cards), sp = new Sprite(g), col = card.suit === 'h' || card.suit === 'd' ? '#c2332d' : '#1c1c1c';
      sp.back = make('g', {}, g);
      make('rect', { x: -32, y: -45, width: 64, height: 90, rx: 6, fill: '#f4f1e8' }, sp.back);
      make('rect', { x: -28, y: -41, width: 56, height: 82, rx: 4, fill: 'url(#cj-back)' }, sp.back);
      make('ellipse', { rx: 12, ry: 17, fill: 'none', stroke: '#f4f1e8', 'stroke-opacity': 0.6, 'stroke-width': 1.5 }, sp.back);
      sp.face = make('g', {}, g);
      make('rect', { x: -32, y: -45, width: 64, height: 90, rx: 6, fill: '#fbfaf5', stroke: '#000', 'stroke-opacity': 0.18 }, sp.face);
      text(sp.face, card.face, -26, -24, 'c-rank', col);
      text(sp.face, PIPS[card.suit], -26, -8, 'c-pip-s', col);
      text(sp.face, PIPS[card.suit], 3, 28, 'c-pip', col, 'middle');
      text(sp.face, card.face, 0, 0, 'c-rank', col).setAttribute('transform', 'translate(26 24) rotate(180)');
      return sp;
    }
    function setFace(sp, up) {
      sp.up = up;
      sp.face.setAttribute('display', up ? 'inline' : 'none');
      sp.back.setAttribute('display', up ? 'none' : 'inline');
    }
    function flip(sp, up) {
      if (instant()) { setFace(sp, up); return; }
      move(sp, { fx: 0 }, 110, 0, { ease: easeIn, done: function () { setFace(sp, up); move(sp, { fx: 1 }, 120, 0); } });
    }
    function slot(seat, i, n) {
      if (seat === 'fly') { var gap = n > 5 ? 104 / (n - 1) : 26; return { x: 588 + i * gap, y: 470 - i * 3, r: -6 + i * 3 }; }
      var g2 = n > 6 ? 222 / (n - 1) : 44;
      return { x: 558 + i * g2, y: 350, r: i % 2 ? 1.5 : -1.5 };
    }
    function dealCard(seat, card, up, delay) {
      var list = table[seat], sp = cardSprite(card), n = list.length + 1, to = slot(seat, n - 1, n);
      list.push(sp); setFace(sp, false);
      sp.x = SHOE.x; sp.y = SHOE.y; sp.r = -24; sp.s = 0.85; sp.o = 0; sp.draw();
      later(delay, function () { sp.o = 1; sp.draw(); flick(); lookAt(to, 500); });
      move(sp, { x: to.x, y: to.y, r: to.r, s: 1 }, 380, delay, { arc: 40 });
      if (up) later(delay + 170, function () { flip(sp, true); });
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
    function chipSprite(color) {
      var g = make('g', {}, layer.chips), c = CHIPS[color];
      make('ellipse', { cy: 5, rx: 17, ry: 6.5, fill: c[1] }, g);
      make('rect', { x: -17, y: 0, width: 34, height: 5, fill: c[1] }, g);
      make('ellipse', { rx: 17, ry: 6.5, fill: c[0] }, g);
      make('ellipse', { rx: 17, ry: 6.5, fill: 'none', stroke: '#fbfaf5', 'stroke-width': 2.6, 'stroke-dasharray': '4 6.7' }, g);
      make('ellipse', { rx: 10, ry: 3.8, fill: 'none', stroke: '#fbfaf5', 'stroke-opacity': 0.55 }, g);
      return new Sprite(g);
    }
    function chipTo(sp, k, delay) { move(sp, { x: BET.x, y: BET.y - k * 5, o: 1 }, 380, delay, { arc: 28 }); }
    function placeBet(delay) {
      var sp = chipSprite('red');
      sp.x = POCKET.x; sp.y = POCKET.y; sp.o = 0; sp.draw();
      table.bet.push(sp); chipTo(sp, 0, delay);
    }
    function chipsAway(to, delay) {
      table.bet.forEach(function (sp, k) { move(sp, { x: to.x, y: to.y, o: 0, s: 0.8 }, 420, delay + k * 70, { arc: 20, done: function () { sp.remove(); } }); });
      table.bet = [];
    }

    /* ---------- effects ---------- */
    function floatText(str, color, x, y, delay) {
      var g = make('g', {}, layer.fx), sp = new Sprite(g), pos = { y: y - 56 };
      text(g, str, 0, 0, 'fx-float', color, 'middle');
      sp.x = x; sp.y = y; sp.o = 0; sp.draw();
      later(delay, function () { sp.o = 1; sp.draw(); });
      move(sp, pos, 1400, delay);
      move(sp, { o: 0 }, 1400, delay, { ease: easeIn, done: function () { sp.remove(); } });
    }
    function sparkle(n, cx, cy, spread, colors, delay) {
      if (instant()) return;
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
      if (instant()) return;
      var g = make('g', {}, layer.fx), sp = new Sprite(g);
      make('ellipse', { rx: 10, ry: 3.5, fill: 'none', stroke: '#fff', 'stroke-width': 2 }, g);
      sp.x = FOOT.x; sp.y = FOOT.y; sp.s = 0.4; sp.o = 0; sp.draw();
      later(delay, function () { sp.o = 0.9; sp.draw(); });
      move(sp, { s: 2.6, o: 0 }, 480, delay, { done: sp.remove.bind(sp) });
    }
    function think(main, sub, subColor) {
      part.bubble.classList.toggle('on', !!main);
      if (!main) return;
      $('cj-bubble-main').textContent = main;
      var s = $('cj-bubble-sub'); s.textContent = sub || ''; s.style.fill = subColor || '';
    }
    function scent(color) {
      part.scent.classList.toggle('on', !!color);
      if (color) Array.prototype.forEach.call(part.scent.children, function (p) { p.style.stroke = color; });
    }
    function setGlow(color, a, fade) { part.glow.setAttribute('fill', color); glow.a = a; glow.at = now(); glow.fade = fade; }

    /* ---------- the dealer ---------- */
    function flick() {
      var h = dealer.handR;
      move(h, { x: SHOE.x + 4, y: SHOE.y + 6 }, 90, 0, { done: function () { move(h, { x: REST_R.x, y: REST_R.y }, 160, 0); } });
    }
    function reach(handPt, target, delay, back) {
      move(handPt, { x: target.x, y: target.y + 8 }, 200, delay, { done: function () { move(handPt, { x: back.x, y: back.y }, 300, 120); } });
    }
    function lookAt(p, ms) { dealer.look = p; dealer.lookUntil = now() + ms; }
    function mood(m, ms) { dealer.mood = m; dealer.moodUntil = now() + ms; }
    function drawArm(path, el, s, h, side) {
      var mx = (s.x + h.x) / 2 + side * 14, my = (s.y + h.y) / 2 + 16;
      path.setAttribute('d', 'M' + s.x + ' ' + s.y + 'Q' + r2(mx) + ' ' + r2(my) + ' ' + r2(h.x) + ' ' + r2(h.y));
      el.setAttribute('cx', r2(h.x)); el.setAttribute('cy', r2(h.y));
    }
    function poseDealer(t) {
      drawArm(part.armL, part.handL, SHOULDER_L, dealer.handL, -1);
      drawArm(part.armR, part.handR, SHOULDER_R, dealer.handR, 1);
      var target = t < dealer.lookUntil && dealer.look ? dealer.look : FLY_HEAD;
      [[part.pupilL, 586], [part.pupilR, 614]].forEach(function (e) {
        var dx = target.x - e[1], dy = target.y - 139, d = Math.sqrt(dx * dx + dy * dy) || 1;
        e[0].setAttribute('cx', r2(e[1] + 2.4 * dx / d)); e[0].setAttribute('cy', r2(139 + 1.6 * dy / d));
      });
      var blink = !reduce && t % 4300 < 120;
      part.eyes.setAttribute('transform', blink ? 'translate(0 138) scale(1 0.12) translate(0 -138)' : '');
      var m = t < dealer.moodUntil ? dealer.mood : 'neutral';
      part.mouth.setAttribute('d', MOUTH[m]);
      part.brows.setAttribute('transform', m === 'surprised' ? 'translate(0 -4)' : m === 'smile' ? 'translate(0 1)' : '');
    }

    /* ---------- the fly ---------- */
    function act(state) { fly.state = state; fly.since = now(); }
    function poseFly(t, busy) {
      var e = reduce ? 1e6 : t - fly.since, st = busy ? 'hover' : fly.state, p, k;
      var x = 0, y = Math.sin(t / 700) * 1.2, lean = 0, spin = 0, head = 0, ant = Math.sin(t / 1300) * 3, wing = 0, legF = 0, legFF = 0, buzz = false;
      if (st === 'idle') {
        k = (e - 2600) % 8000;
        if (e > 2600 && k < 1800) {          // grooming: rub the front legs together, over the eyes
          p = Math.sin(Math.PI * k / 1800);
          legF = 88 * p + 10 * p * Math.sin(t / 55); legFF = 80 * p + 10 * p * Math.sin(t / 55 + 2); head = -5 * p; lean = -2 * p;
        }
        k = e % 5200; if (k < 260) wing = -12 * Math.sin(Math.PI * k / 260);
        k = t % 3100; if (k < 160) ant += 10 * Math.sin(Math.PI * k / 160);
      } else if (st === 'sniff') {
        p = clamp01(e / 260); lean = -5 * p; head = -6 * p; ant = -8 + 7 * Math.sin(t / 38);
      } else if (st === 'tap') {
        lean = -3; head = -4; legF = 40 * Math.abs(Math.sin(Math.PI * Math.min(e, 760) / 380));
      } else if (st === 'wave') {
        p = clamp01(e / 220) * clamp01((1250 - e) / 250);
        legF = p * (72 + 22 * Math.sin((e - 220) / 95)); head = 3 * Math.sin(e / 140) * p;
      } else if (st === 'win') {
        p = e / 430;
        if (p < 2) { y -= 42 * Math.abs(Math.sin(Math.PI * p)); buzz = true; }
        else wing = -14 * clamp01(1 - (e - 860) / 1000);
        ant = 6;
      } else if (st === 'blackjack') {
        k = e / 1900;
        if (k < 1) { y -= 120 * Math.sin(Math.PI * k); x = -60 * Math.sin(2 * Math.PI * k); spin = -360 * easeInOut(clamp01((k - 0.25) / 0.5)); buzz = true; }
        ant = 6;
      } else if (st === 'lose' || st === 'bust') {
        p = clamp01(e / 500);
        if (st === 'bust' && e < 500) x = Math.sin(e / 22) * 5 * (1 - e / 500);
        head = -10 * p; ant = -26 * p; wing = 7 * p; y += 3 * p; lean = -2 * p;
      } else if (st === 'push') {
        p = Math.sin(Math.PI * clamp01(e / 700)); wing = -10 * p; legF = 26 * p; y -= 4 * p;
      } else if (st === 'hover') {             // Fast and Turbo: too busy to land
        y = -36 + Math.sin(t / 170) * 5; x = Math.sin(t / 530) * 6; lean = -4 + Math.sin(t / 410) * 3; ant = Math.sin(t / 90) * 5; buzz = true;
      }
      if (buzz) wing = -36 + 28 * Math.sin(t * 0.83);
      part.body.setAttribute('transform', 'translate(' + r2(x) + ' ' + r2(y) + ') rotate(' + r2(lean + spin) + ' 0 -70)');
      rot(part.head, head, -40, -100); rot(part.ant, ant, -88, -124);
      rot(part.wingN, wing, 2, -118); rot(part.wingF, wing * 1.1 - 6, 2, -121);
      rot(part.legF, legF, -32, -66); rot(part.legFF, legFF, -26, -70);
      part.wingN.setAttribute('opacity', buzz ? 0.6 : 1);
      part.buzz.setAttribute('opacity', buzz ? 0.8 : 0);
      var h = Math.max(0, -y);
      part.shadow.setAttribute('transform', 'translate(' + r2(x) + ' 0) scale(' + r2(Math.max(0.4, 1 - h / 260)) + ' 1)');
      part.shadow.setAttribute('opacity', r2(0.35 * Math.max(0.3, 1 - h / 200)));
      var g = glow.fade ? glow.a * clamp01(1 - (t - glow.at) / glow.fade) : glow.a;
      part.glow.setAttribute('opacity', r2(g));
    }

    /* ---------- what the page asks for ---------- */
    function sweep() {
      var old = table.fly.concat(table.dealer);
      table.fly = []; table.dealer = []; table.hand = null; table.open = false;
      chipsAway(TRAY, 0);
      if (!old.length) return 0;
      if (instant()) { old.forEach(function (sp) { sp.remove(); }); return 0; }
      reach(dealer.handL, { x: 610, y: 400 }, 0, REST_L);
      old.forEach(function (sp, i) {
        move(sp, { x: DISCARD.x + (i % 3) * 3, y: DISCARD.y - 4, r: 0, s: 0.45, o: 0 }, 430, 120 + i * 45, { arc: 18, done: function () { sp.remove(); } });
      });
      return 520 + old.length * 45;
    }
    function clearAll() {
      tweens = []; timers = [];
      [layer.cards, layer.chips, layer.fx].forEach(function (l) { while (l.firstChild) l.removeChild(l.firstChild); });
      table = { hand: null, fly: [], dealer: [], bet: [], open: false };
      dealer.handL = new Point(REST_L); dealer.handR = new Point(REST_R);
    }

    /* A fresh hand: clear the old cards, bet, deal fly, dealer, fly, dealer (face down). */
    function deal(hand) {
      think(null); scent(null); act('idle');
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
        t += 250; reach(dealer.handL, hole, t, REST_L); lookAt(hole, 900);
        later(t + 170, function () { table.open = true; flip(hole, true); });
        t += 520; later(t, function () { dealerBadge(hand, 2); });
        for (i = 2; i < hand.dealer.length; i++) {
          dealCard('dealer', hand.dealer[i], true, t); t += 560;
          (function (n) { later(t - 140, function () { dealerBadge(hand, n); }); })(i + 1);
        }
      }
      return t + 120;
    }
    function sniff(hit, v) {
      act('sniff');
      var good = v >= 0;
      think(hit ? 'Hit?' : 'Stand?', 'smells ' + (good ? 'good ' : 'bad ') + (v < 0 ? '−' : '+') + Math.abs(v).toFixed(2), good ? '#2c6fd0' : '#c4501c');
      scent(good ? SMELL_GOOD : SMELL_BAD);
      setGlow('#7df0c4', 0.45, 0);
    }
    function choose(hit) {
      scent(null); setGlow('#7df0c4', 0, 0);
      act(hit ? 'tap' : 'wave');
      think(hit ? 'Hit!' : 'Stand.', hit ? 'taps the felt' : 'waves it off', '#47564d');
      if (hit) { ripple(380); ripple(760); }
      lookAt(FOOT, 900);
      return hit ? 900 : 1150;
    }
    function settle(hand) {
      var r = hand.reward, res = hand.result;
      think(null); scent(null);
      act(res === 'blackjack' ? 'blackjack' : r > 0 ? 'win' : res === 'bust' ? 'bust' : r < 0 ? 'lose' : 'push');
      mood(r > 0 ? 'surprised' : r < 0 ? 'smile' : 'neutral', 1900);
      floatText(r > 0 ? '+' + r : r < 0 ? '−' + -r : 'push', r > 0 ? '#ffd46b' : r < 0 ? '#ff8a6b' : '#e8e2d4', BET.x, BET.y - 34, 120);
      if (r > 0) {
        var pay = r === 1.5 ? ['red', 'blue'] : ['red'], n = table.bet.length;
        pay.forEach(function (c, k) {
          var sp = chipSprite(c);
          sp.x = TRAY.x; sp.y = TRAY.y; sp.o = 0; sp.draw();
          table.bet.push(sp); chipTo(sp, n + k, 150 + k * 160);
        });
        lookAt(BET, 900); reach(dealer.handL, TRAY, 60, REST_L);
        chipsAway(POCKET, 1050);
        sparkle(res === 'blackjack' ? 26 : 12, FLY_HEAD.x + 40, FLY_HEAD.y - 30, res === 'blackjack' ? 140 : 80, ['#ffd46b', '#fff3c4', '#ff9fd0'], 200);
      } else if (r < 0) {
        reach(dealer.handL, BET, 300, REST_L); chipsAway(TRAY, 420);
      } else {
        chipsAway(POCKET, 700);
      }
      return res === 'blackjack' ? 2600 : 2000;
    }
    function dopamine(surprise) {
      if (surprise === null || surprise === undefined || Math.abs(surprise) <= 0.05) return;
      setGlow(surprise > 0 ? '#4d9bff' : '#ff6a2e', Math.min(0.95, Math.abs(surprise) * 1.5 + 0.35), 1700);
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
    function clear() { think(null); scent(null); act('idle'); sweep(); hideBadges(); }

    function tick(t, busy) {
      run(t);
      poseFly(reduce ? 0 : t, busy);
      poseDealer(t);
      if (!reduce) part.gnat.setAttribute('transform', 'translate(' + r2(1010 + 30 * Math.cos(t / 520)) + ' ' + r2(246 + 12 * Math.sin(t / 260) + 3 * Math.sin(t / 70)) + ')');
    }

    // phones: frame the middle of the room so the cards stay readable
    function frame() { svg.setAttribute('viewBox', svg.clientWidth && svg.clientWidth < 560 ? '170 40 860 610' : '0 0 1200 675'); }
    if (root.ResizeObserver) new ResizeObserver(frame).observe(svg); else root.addEventListener('resize', frame);
    frame();

    return { tick: tick, deal: deal, update: update, sniff: sniff, choose: choose, settle: settle, dopamine: dopamine, show: show, clear: clear };
  }

  root.Casino = Casino;
})(self);

/* FlyJack - what both casino tables share: moving pieces, cards and chips, the dealer, and the
   fly puppet that acts out its brain's choices. The drawings themselves live in web/page.html;
   puppets find their parts there by data-part, so the same drawing can be cloned for many flies. */
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var PIPS = { s: '♠︎', h: '♥︎', d: '♦︎', c: '♣︎' };
  var CHIPS = { red: ['#c0392b', '#7d1f17'], blue: ['#2c5aa0', '#1a3866'], green: ['#1f7a4a', '#11482b'], black: ['#26262b', '#0e0e10'] };
  var MOUTH = { neutral: 'M592 167Q600 170 608 167', smile: 'M589 164Q600 176 611 164', surprised: 'M596 168a4 4.5 0 1 0 8 0a4 4.5 0 1 0 -8 0' };

  function make(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, str, x, y, cls, fill, anchor) {
    var t = make('text', { x: x, y: y, 'class': cls, 'text-anchor': anchor || 'start' }, parent);
    if (fill) t.setAttribute('fill', fill);
    t.textContent = str;
    return t;
  }
  function r2(v) { return Math.round(v * 100) / 100; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeOut(p) { return 1 - Math.pow(1 - p, 3); }
  function easeIn(p) { return p * p * p; }
  function easeInOut(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function rot(el, a, cx, cy) { if (el) el.setAttribute('transform', 'rotate(' + r2(a) + ' ' + cx + ' ' + cy + ')'); }
  function now() { return performance.now(); }

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

  /* Timing: every move is a tween, every pause a timer. When instant() is true (reduced motion,
     or a hand laid out at once) moves land immediately and timers fire straight away. */
  function Timeline(instant) { this.instant = instant; this.tweens = []; this.timers = []; }
  Timeline.prototype.move = function (sp, to, ms, delay, o) {
    o = o || {};
    if (this.instant()) {
      for (var k in to) sp[k] = to[k];
      sp.lift = 0; sp.draw();
      if (o.done) o.done();
      return;
    }
    this.tweens.push({ sp: sp, to: to, ms: ms, at: now() + (delay || 0), arc: o.arc || 0, ease: o.ease || easeOut, done: o.done, from: null });
  };
  Timeline.prototype.later = function (ms, fn) { if (this.instant()) fn(); else this.timers.push({ at: now() + ms, fn: fn }); };
  Timeline.prototype.clear = function () { this.tweens = []; this.timers = []; };
  Timeline.prototype.run = function (t) {
    var list = this.timers, i, k;
    this.timers = [];
    for (i = 0; i < list.length; i++) { if (t >= list[i].at) list[i].fn(); else this.timers.push(list[i]); }
    list = this.tweens; this.tweens = [];
    for (i = 0; i < list.length; i++) {
      var tw = list[i];
      if (t < tw.at) { this.tweens.push(tw); continue; }
      if (!tw.from) { tw.from = {}; for (k in tw.to) tw.from[k] = tw.sp[k]; }
      var p = tw.ms ? clamp01((t - tw.at) / tw.ms) : 1, e = tw.ease(p);
      for (k in tw.to) tw.sp[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
      if (tw.arc) tw.sp.lift = Math.sin(Math.PI * p) * tw.arc;
      tw.sp.draw();
      if (p < 1) this.tweens.push(tw); else if (tw.done) tw.done();
    }
  };

  /* ---------- cards and chips ---------- */
  function cardSprite(parent, card) {
    var g = make('g', {}, parent), sp = new Sprite(g), col = card.suit === 'h' || card.suit === 'd' ? '#c2332d' : '#1c1c1c';
    sp.card = card;
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
    setFace(sp, false);
    return sp;
  }
  function setFace(sp, up) {
    sp.up = up;
    sp.face.setAttribute('display', up ? 'inline' : 'none');
    sp.back.setAttribute('display', up ? 'none' : 'inline');
  }
  function flip(tl, sp, up) {
    if (tl.instant()) { setFace(sp, up); return; }
    var s = sp.s;
    tl.move(sp, { fx: 0 }, 110, 0, { ease: easeIn, done: function () { setFace(sp, up); tl.move(sp, { fx: 1 }, 120, 0); } });
    return s;
  }
  function chipSprite(parent, color) {
    var g = make('g', {}, parent), c = CHIPS[color] || CHIPS.red;
    chipShape(g, c, 0);
    return new Sprite(g);
  }
  function chipShape(g, c, y) {
    make('ellipse', { cy: y + 5, rx: 17, ry: 6.5, fill: c[1] }, g);
    make('rect', { x: -17, y: y, width: 34, height: 5, fill: c[1] }, g);
    make('ellipse', { cy: y, rx: 17, ry: 6.5, fill: c[0] }, g);
    make('ellipse', { cy: y, rx: 17, ry: 6.5, fill: 'none', stroke: '#fbfaf5', 'stroke-width': 2.6, 'stroke-dasharray': '4 6.7' }, g);
    make('ellipse', { cy: y, rx: 10, ry: 3.8, fill: 'none', stroke: '#fbfaf5', 'stroke-opacity': 0.55 }, g);
  }
  /* A stack of chips worth `amount`, as a sprite: one chip per two units, at most `max`. */
  function stackSprite(parent, amount, max) {
    var g = make('g', {}, parent), n = Math.max(1, Math.min(max || 8, Math.ceil(amount / 2))), colors = ['red', 'blue', 'green', 'black'];
    for (var i = 0; i < n; i++) chipShape(g, CHIPS[colors[Math.floor(i / 2) % 4]], -i * 4.5);
    return new Sprite(g);
  }

  /* ---------- the room ---------- */
  function decorateRoom(bokeh, seed) {
    var rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    var colors = ['#ffcf7a', '#ff8fb0', '#ffe0a8', '#9fd8ff'];
    for (var i = 0; i < 20; i++) {
      var c = make('circle', { cx: r2(rnd() * 1200), cy: r2(20 + rnd() * 220), r: r2(5 + rnd() * 20), fill: colors[i % 4], 'fill-opacity': r2(0.08 + rnd() * 0.16) }, bokeh);
      c.style.animationDuration = r2(4 + rnd() * 6) + 's'; c.style.animationDelay = -r2(rnd() * 8) + 's';
    }
  }
  function decorateTray(tray, x0, y0) {
    var tc = ['#c0392b', '#1f7a4a', '#1b1b1f', '#2c5aa0', '#6a2c8a', '#e8e2d4', '#c0392b', '#1f7a4a'];
    for (var i = 0; i < 8; i++) {
      var x = x0 + i * 24;
      make('rect', { x: x, y: y0, width: 20, height: 18, rx: 3, fill: tc[i] }, tray);
      make('path', { d: 'M' + (x + 4) + ' ' + (y0 + 1) + 'V' + (y0 + 17) + 'M' + (x + 10) + ' ' + (y0 + 1) + 'V' + (y0 + 17) + 'M' + (x + 16) + ' ' + (y0 + 1) + 'V' + (y0 + 17), stroke: '#fff', 'stroke-opacity': 0.35, 'stroke-width': 1.5, 'stroke-dasharray': '3 3' }, tray);
    }
  }
  /* A copy of a drawing with its ids removed, so it can appear many times. */
  function cloneDrawing(el) {
    var c = el.cloneNode(true);
    c.removeAttribute('id');
    Array.prototype.forEach.call(c.querySelectorAll('[id]'), function (n) { n.removeAttribute('id'); });
    return c;
  }

  /* ---------- the dealer ---------- */
  /* parts: the dealer's drawing and arms (found by data-part); o: {shoulderL, shoulderR, restL, restR, eyeY} */
  function Dealer(body, arms, tl, o) {
    var q = function (el, n) { return el.querySelector('[data-part="' + n + '"]'); };
    this.tl = tl; this.o = o;
    this.p = { armL: q(arms, 'arm-l'), armR: q(arms, 'arm-r'), handL: q(arms, 'hand-l'), handR: q(arms, 'hand-r'),
      pupilL: q(body, 'pupil-l'), pupilR: q(body, 'pupil-r'), eyes: q(body, 'eyes'), brows: q(body, 'brows'), mouth: q(body, 'mouth') };
    this.handL = new Point(o.restL); this.handR = new Point(o.restR);
    this.lookAt = null; this.lookUntil = 0; this.moodName = 'neutral'; this.moodUntil = 0;
  }
  Dealer.prototype.flick = function (from) {
    var h = this.handR, tl = this.tl, rest = this.o.restR;
    tl.move(h, { x: from.x + 4, y: from.y + 6 }, 90, 0, { done: function () { tl.move(h, { x: rest.x, y: rest.y }, 160, 0); } });
  };
  Dealer.prototype.reach = function (left, target, delay) {
    var h = left ? this.handL : this.handR, back = left ? this.o.restL : this.o.restR, tl = this.tl;
    tl.move(h, { x: target.x, y: target.y + 8 }, 200, delay, { done: function () { tl.move(h, { x: back.x, y: back.y }, 300, 120); } });
  };
  Dealer.prototype.look = function (p, ms) { this.lookAt = p; this.lookUntil = now() + ms; };
  Dealer.prototype.mood = function (m, ms) { this.moodName = m; this.moodUntil = now() + ms; };
  Dealer.prototype.reset = function () { this.handL = new Point(this.o.restL); this.handR = new Point(this.o.restR); };
  function drawArm(path, el, s, h, side) {
    var mx = (s.x + h.x) / 2 + side * 14, my = (s.y + h.y) / 2 + 16;
    path.setAttribute('d', 'M' + s.x + ' ' + s.y + 'Q' + r2(mx) + ' ' + r2(my) + ' ' + r2(h.x) + ' ' + r2(h.y));
    el.setAttribute('cx', r2(h.x)); el.setAttribute('cy', r2(h.y));
  }
  Dealer.prototype.pose = function (t, idleLook, reduce) {
    var p = this.p, o = this.o;
    drawArm(p.armL, p.handL, o.shoulderL, this.handL, -1);
    drawArm(p.armR, p.handR, o.shoulderR, this.handR, 1);
    var target = t < this.lookUntil && this.lookAt ? this.lookAt : idleLook;
    [[p.pupilL, 586], [p.pupilR, 614]].forEach(function (e) {
      var dx = target.x - e[1], dy = target.y - 139, d = Math.sqrt(dx * dx + dy * dy) || 1;
      e[0].setAttribute('cx', r2(e[1] + 2.4 * dx / d)); e[0].setAttribute('cy', r2(139 + 1.6 * dy / d));
    });
    var blink = !reduce && t % 4300 < 120;
    p.eyes.setAttribute('transform', blink ? 'translate(0 138) scale(1 0.12) translate(0 -138)' : '');
    var m = t < this.moodUntil ? this.moodName : 'neutral';
    p.mouth.setAttribute('d', MOUTH[m]);
    p.brows.setAttribute('transform', m === 'surprised' ? 'translate(0 -4)' : m === 'smile' ? 'translate(0 1)' : '');
  };

  /* ---------- the fly puppet ---------- */
  /* g: a fly drawing (see #cj-fly in page.html). o: {reduce, wingRest (degrees, Curly wings turn up)} */
  function Fly(g, o) {
    o = o || {};
    var q = function (n) { return g.querySelector('[data-part="' + n + '"]'); };
    this.g = g; this.reduce = !!o.reduce; this.wingRest = o.wingRest || 0;
    this.p = { body: q('body'), head: q('head'), ant: q('antenna'), wingN: q('wing-n'), wingF: q('wing-f'), legF: q('leg-f'), legFF: q('leg-ff'),
      shadow: q('shadow'), buzz: q('buzz'), glow: q('glow') };
    this.state = 'idle'; this.since = -1e6; this.glowA = 0; this.glowAt = 0; this.glowFade = 0;
  }
  Fly.prototype.act = function (state) { this.state = state; this.since = now(); };
  Fly.prototype.glow = function (color, a, fade) { this.p.glow.setAttribute('fill', color); this.glowA = a; this.glowAt = now(); this.glowFade = fade; };
  /* States: idle (grooms now and then), sniff, tap (hit or check), wave (stand), push (chips in),
     fold, win, blackjack (a flying somersault), lose, bust, push-even (a shrug), and hover when busy. */
  Fly.prototype.pose = function (t, busy) {
    var reduce = this.reduce, tt = reduce ? 0 : t, e = reduce ? 1e6 : t - this.since, st = busy ? 'hover' : this.state, p, k;
    var x = 0, y = Math.sin(tt / 700) * 1.2, lean = 0, spin = 0, head = 0, ant = Math.sin(tt / 1300) * 3, wing = 0, legF = 0, legFF = 0, buzz = false;
    if (st === 'idle') {
      k = (e - 2600) % 8000;
      if (e > 2600 && k < 1800) {          // grooming: rub the front legs together, over the eyes
        p = Math.sin(Math.PI * k / 1800);
        legF = 88 * p + 10 * p * Math.sin(tt / 55); legFF = 80 * p + 10 * p * Math.sin(tt / 55 + 2); head = -5 * p; lean = -2 * p;
      }
      k = e % 5200; if (k < 260) wing = -12 * Math.sin(Math.PI * k / 260);
      k = tt % 3100; if (k < 160) ant += 10 * Math.sin(Math.PI * k / 160);
    } else if (st === 'sniff') {
      p = clamp01(e / 260); lean = -5 * p; head = -6 * p; ant = -8 + 7 * Math.sin(tt / 38);
    } else if (st === 'tap') {
      lean = -3; head = -4; legF = 40 * Math.abs(Math.sin(Math.PI * Math.min(e, 760) / 380));
    } else if (st === 'wave') {
      p = clamp01(e / 220) * clamp01((1250 - e) / 250);
      legF = p * (72 + 22 * Math.sin((e - 220) / 95)); head = 3 * Math.sin(e / 140) * p;
    } else if (st === 'push') {
      p = clamp01(e / 200) * clamp01((900 - e) / 250); legF = 52 * p; legFF = 30 * p; lean = -5 * p; head = -3 * p;
    } else if (st === 'fold') {
      p = clamp01(e / 350); head = -9 * p; ant = -20 * p; lean = 2 * p; wing = -10 * Math.sin(Math.PI * clamp01(e / 300));
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
    } else if (st === 'shrug') {
      p = Math.sin(Math.PI * clamp01(e / 700)); wing = -10 * p; legF = 26 * p; y -= 4 * p;
    } else if (st === 'hover') {             // Fast and Turbo: too busy to land
      y = -36 + Math.sin(tt / 170 + this.wingRest) * 5; x = Math.sin(tt / 530) * 6; lean = -4 + Math.sin(tt / 410) * 3; ant = Math.sin(tt / 90) * 5; buzz = true;
    }
    if (buzz) wing = -36 + 28 * Math.sin(t * 0.83 + this.since);
    else wing += this.wingRest;
    var P = this.p;
    P.body.setAttribute('transform', 'translate(' + r2(x) + ' ' + r2(y) + ') rotate(' + r2(lean + spin) + ' 0 -70)');
    rot(P.head, head, -40, -100); rot(P.ant, ant, -88, -124);
    rot(P.wingN, wing, 2, -118); rot(P.wingF, wing * 1.1 - 6, 2, -121);
    rot(P.legF, legF, -32, -66); rot(P.legFF, legFF, -26, -70);
    P.wingN.setAttribute('opacity', buzz ? 0.6 : 1);
    P.buzz.setAttribute('opacity', buzz ? 0.8 : 0);
    var h = Math.max(0, -y);
    P.shadow.setAttribute('transform', 'translate(' + r2(x) + ' 0) scale(' + r2(Math.max(0.4, 1 - h / 260)) + ' 1)');
    P.shadow.setAttribute('opacity', r2(0.35 * Math.max(0.3, 1 - h / 200)));
    var gl = this.glowFade ? this.glowA * clamp01(1 - (t - this.glowAt) / this.glowFade) : this.glowA;
    P.glow.setAttribute('opacity', r2(gl));
  };

  /* Puffs of smell from (x0, y0) to (x1, y1), as three wavy paths. */
  function scentPaths(g, x0, y0, x1, y1) {
    while (g.firstChild) g.removeChild(g.firstChild);
    for (var i = 0; i < 3; i++) {
      var ox = (i - 1) * 16, oy = (i - 1) * 10, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      make('path', { d: 'M' + r2(x0 + ox) + ' ' + r2(y0 + oy) + 'C' + r2(mx - 20 + ox) + ' ' + r2(my - 40) + ' ' + r2(mx + 20) + ' ' + r2(my + 30 + oy) + ' ' + r2(x1) + ' ' + r2(y1 + oy / 2) }, g);
    }
  }

  root.SceneKit = {
    NS: NS, PIPS: PIPS, make: make, text: text, r2: r2, clamp01: clamp01, easeOut: easeOut, easeIn: easeIn, easeInOut: easeInOut, now: now,
    Sprite: Sprite, Point: Point, Timeline: Timeline, cardSprite: cardSprite, setFace: setFace, flip: flip, chipSprite: chipSprite,
    stackSprite: stackSprite, decorateRoom: decorateRoom, decorateTray: decorateTray, cloneDrawing: cloneDrawing, Dealer: Dealer, Fly: Fly,
    scentPaths: scentPaths
  };
})(self);

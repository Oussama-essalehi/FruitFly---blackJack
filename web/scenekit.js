/* FlyJack - what both casino tables share: timing (every move is a tween, every pause a timer),
   easing, and the suit symbols. The 3D pieces themselves are in web/scene3d.js. */
(function (root) {
  'use strict';
  var PIPS = { s: '♠︎', h: '♥︎', d: '♦︎', c: '♣︎' };

  function r2(v) { return Math.round(v * 100) / 100; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeOut(p) { return 1 - Math.pow(1 - p, 3); }
  function easeIn(p) { return p * p * p; }
  function easeInOut(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function now() { return performance.now(); }

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

  root.SceneKit = { PIPS: PIPS, r2: r2, clamp01: clamp01, easeOut: easeOut, easeIn: easeIn, easeInOut: easeInOut, now: now, Point: Point, Timeline: Timeline };
})(self);

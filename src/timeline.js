/* FlyJack - the one fly everyone shares, run by the clock.
 *
 * There is no server. Every hand the shared fly will ever play is already decided by three things:
 *   - where its memory stood at some saved moment (a checkpoint, or its birth),
 *   - the dice: hand number n always uses the same random numbers (handSeed below),
 *   - the clock: the fly was born at CONFIG.born and plays one hand after another, each taking
 *     as long as the page needs to show it (screenTime).
 * So any computer that starts from the same checkpoint plays exactly the same hands, learns exactly
 * the same way, and knows from the time of day which hand is on the table right now. Every browser
 * runs its own copy, but all the copies are the same fly.
 *
 * To make that true bit for bit, the brain's maths avoids anything an engine may round its own way
 * (see exp in src/flybrain.js), and every CONFIG.checkpointEvery hands the fly's memory is rounded
 * to the 16-bit form a checkpoint stores. Whoever loads that checkpoint therefore holds exactly the
 * same synapses as a copy that played through that moment.
 *
 * A GitHub Action (tools/advance_fly.js, .github/workflows/fly.yml) plays the fly forward every hour
 * and publishes the latest checkpoint, so a browser only has to catch up on the last few hundred
 * hands. Any checkpoint on the timeline leads to the same present; an older one just takes longer.
 */
(function (root) {
  'use strict';

  var CONFIG = {
    version: 1,
    seed: 20261013,
    born: Date.UTC(2026, 9, 13, 17, 0, 0),     // 13 October 2026, 19:00 in Paris
    checkpointEvery: 250,                       // hands between two checkpoints (about 45 minutes)
    remote: 'https://raw.githubusercontent.com/Oussama-essalehi/FruitFly---blackJack/fly-data/checkpoint.json'
  };

  function timelineId(cfg) { return 'v' + cfg.version + '-' + cfg.seed + '-' + cfg.born + '-' + cfg.checkpointEvery; }

  /* The dice for hand n: a seed mixed from the fly's seed and the hand number. */
  function handSeed(seed, n) {
    var h = Math.imul(seed ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul((n + 0x632BE59B) | 0, 0xC2B2AE35);
    h ^= h >>> 16; h = Math.imul(h, 0x7FEB352D);
    h ^= h >>> 15; h = Math.imul(h, 0x846CA68B);
    return (h ^ (h >>> 16)) | 0;
  }

  /* How long the page needs to act out a hand (web/casino.js and the steps in web/app.js): dealing,
     then about 4 s for each hit-or-stand the fly sniffs out, then about half a second per card
     the dealer draws, then the payout. */
  function screenTime(hand, decisions) {
    return 6000 + 4200 * decisions + 600 * Math.max(0, hand.dealer.length - 2);
  }

  /* base64 of 16-bit values, little-endian, the same in Node and in browsers */
  var ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function encode16(u16) {
    var bytes = new Uint8Array(u16.length * 2), i, out = [];
    for (i = 0; i < u16.length; i++) { bytes[2 * i] = u16[i] & 255; bytes[2 * i + 1] = u16[i] >>> 8; }
    for (i = 0; i < bytes.length; i += 3) {
      var a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      out.push(ABC[a >> 2], ABC[((a & 3) << 4) | (b >> 4)], i + 1 < bytes.length ? ABC[((b & 15) << 2) | (c >> 6)] : '=', i + 2 < bytes.length ? ABC[c & 63] : '=');
    }
    return out.join('');
  }
  function decode16(str) {
    var map = {}, i, n = 0;
    for (i = 0; i < 64; i++) map[ABC[i]] = i;
    str = str.replace(/[^A-Za-z0-9+/]/g, '');
    var bytes = new Uint8Array(Math.floor(str.length * 3 / 4));
    for (i = 0; i < str.length; i += 4) {
      var v = (map[str[i]] << 18) | (map[str[i + 1]] << 12) | ((map[str[i + 2]] || 0) << 6) | (map[str[i + 3]] || 0);
      if (n < bytes.length) bytes[n++] = v >> 16;
      if (n < bytes.length && i + 2 < str.length) bytes[n++] = (v >> 8) & 255;
      if (n < bytes.length && i + 3 < str.length) bytes[n++] = v & 255;
    }
    var out = new Uint16Array(bytes.length >> 1);
    for (i = 0; i < out.length; i++) out[i] = bytes[2 * i] | (bytes[2 * i + 1] << 8);
    return out;
  }

  /* The shared fly, at some point of its life.
     checkpoint: a saved moment (from checkpoint()), or null / unusable for the fly's birth. */
  function Timeline(circuit, deps, checkpoint, config) {
    var cfg = this.config = config || CONFIG;
    this.FB = deps.FlyBrain; this.BJ = deps.Blackjack;
    this.id = timelineId(cfg);
    this.brain = new this.FB.Brain(circuit, { seed: cfg.seed });
    this.fromCheckpoint = !!(checkpoint && this.load(checkpoint));
    if (!this.fromCheckpoint) {
      this.next = cfg.born;                   // when the next hand starts, in ms since 1970 (UTC)
      this.bank = 0; this.recent = []; this.every = 10;
      this.curve = [{ h: 0, s: this.skill() }];
    }
  }
  Timeline.prototype.skill = function () { return this.BJ.expectedReturn(this.brain.policy(false)); };

  Timeline.prototype.load = function (d) {
    try {
      if (!d || d.id !== this.id || d.edges !== this.brain.nEdges) return false;
      if (!this.brain.importMemory({ hands: d.hands, strengths: decode16(d.strengths) })) return false;
      this.next = d.next; this.bank = d.bank; this.every = d.every;
      this.curve = d.curve.slice(); this.recent = d.recent.slice();
      return typeof this.next === 'number' && this.curve.length > 0;
    } catch (e) { return false; }
  };

  /* Everything needed to carry on later from here. Only taken right after a checkpoint hand,
     when the memory is exactly what the 16-bit form can hold. */
  Timeline.prototype.checkpoint = function () {
    var mem = this.brain.exportMemory();
    return { id: this.id, hands: mem.hands, next: this.next, bank: this.bank, curve: this.curve.slice(), every: this.every,
      recent: this.recent.slice(), edges: mem.strengths.length, strengths: encode16(mem.strengths) };
  };
  Timeline.prototype.atCheckpoint = function () { return this.brain.hands > 0 && this.brain.hands % this.config.checkpointEvery === 0; };

  /* Play the next hand: the same cards and the same choices on every computer. Returns what the
     page needs to show it (the same record server-sent hands used to carry). */
  Timeline.prototype.step = function () {
    var brain = this.brain, BJ = this.BJ, n = brain.hands + 1, start = this.next;
    var dice = this.FB.mulberry32(handSeed(this.config.seed, n)), draws = [];
    brain.rng = function () { var x = dice(); draws.push(x); return x; };
    var hand = new BJ.Hand(brain.rng), trace = [];
    while (!hand.done) {
      var d = brain.decide(hand.total, hand.soft, hand.up);
      trace.push({ hit: d.hit, pHit: d.pHit, vHit: d.vHit, vStand: d.vStand, odor: d.odor });
      hand.act(d.hit);
    }
    var surprise = trace.length ? brain.learnHand(trace, hand.reward) : null;
    brain.hands = n;

    this.bank += hand.reward;
    this.recent.push(hand.reward); if (this.recent.length > 16) this.recent.shift();
    var c = this.curve, curveChanged = false;
    if (n - c[c.length - 1].h >= this.every) {
      c.push({ h: n, s: this.skill() }); curveChanged = true;
      if (c.length > 320) { this.curve = c.filter(function (p, i) { return i % 2 === 0 || i === c.length - 1; }); this.every *= 2; }
    }
    var boundary = n % this.config.checkpointEvery === 0;
    if (boundary) brain.importMemory(brain.exportMemory());   // round to what a checkpoint holds (see the top of this file)

    var ms = screenTime(hand, trace.length);
    this.next = start + ms;
    var rec = { hands: n, start: start, ms: ms, draws: draws, trace: trace, reward: hand.reward, result: hand.result,
      surprise: surprise, bank: this.bank, boundary: boundary };
    if (curveChanged) rec.curve = this.curve.slice();
    return rec;
  };

  /* Play every hand that has started by time t (ms since 1970). onHand(rec) sees each one.
     Stops early, returning false, once budgetMs of computing time is used (so a page can breathe). */
  Timeline.prototype.advanceTo = function (t, onHand, budgetMs) {
    var until = budgetMs ? Date.now() + budgetMs : Infinity;
    while (this.next <= t) {
      var rec = this.step();
      if (onHand) onHand(rec);
      if (Date.now() > until) return this.next > t;
    }
    return true;
  };

  /* Of several saved moments, the one furthest along on this timeline (null if none fits). */
  function latest(list, id) {
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (d && d.id === id && typeof d.hands === 'number' && (!best || d.hands > best.hands)) best = d;
    }
    return best;
  }

  var api = { Timeline: Timeline, CONFIG: CONFIG, timelineId: timelineId, handSeed: handSeed, screenTime: screenTime,
    encode16: encode16, decode16: decode16, latest: latest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FlyTimeline = api;
})(typeof self !== 'undefined' ? self : this);

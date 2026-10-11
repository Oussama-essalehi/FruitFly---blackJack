/* FlyJack - Limit Texas Hold'em rules, hand ranking, and how a poker situation becomes a smell.
 *
 * Rules: six seats, blinds 1 and 2, bets of 2 before the turn and 4 from the turn on, at most
 * one bet and three raises per round. Stacks are topped up to 100 whenever they fall below 50
 * (and winnings above 250 are banked, back to 100), and a hand can never cost more than 48, so
 * nobody is ever all-in and there are no side pots.
 *
 * A decision state is (strength, street, pressure):
 *   strength 0..9  how often the hand would win against the players still in, scaled so that a
 *                  fair share is in the middle
 *                  (estimated by dealing the rest out many times; the fly gets this as a smell,
 *                  it does not work it out itself)
 *   street   0..3  before the flop, flop, turn, river
 *   pressure 0..2  nothing to call, one bet to call, a raise to call
 * The choices are 0 fold, 1 check or call, 2 bet or raise.
 */
(function (root) {
  'use strict';

  var SB = 1, BB = 2, SMALL_BET = 2, BIG_BET = 4, CAP = 4, START_STACK = 100, TOP_UP_BELOW = 50, BANK_ABOVE = 250;
  var N_STRENGTH = 10, N_STREET = 4, N_PRESSURE = 3, N_STATES = N_STRENGTH * N_STREET * N_PRESSURE;
  var FOLD = 0, CALL = 1, RAISE = 2;
  // engineered: how loud hand strength is in the smell, and how adventurous the poker flies are
  var STRENGTH_WIDTH = 1.3, STRENGTH_GAIN = 1.6, BRAIN_OPTIONS = { temperature: 0.08 };
  var FACES = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  var PLURAL = { 2: 'twos', 3: 'threes', 4: 'fours', 5: 'fives', 6: 'sixes', 7: 'sevens', 8: 'eights', 9: 'nines', 10: 'tens', 11: 'jacks', 12: 'queens', 13: 'kings', 14: 'aces' };
  var SUITS = ['s', 'h', 'd', 'c'];
  var CATEGORY = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];

  function card(id) { var r = 2 + (id % 13), s = (id / 13) | 0; return { id: id, r: r, s: s, face: FACES[r], suit: SUITS[s] }; }
  var DECK = [];
  for (var i = 0; i < 52; i++) DECK.push(card(i));

  /* ---------- ranking seven cards ---------- */
  function straightHigh(mask) {
    if (mask & (1 << 14)) mask |= 2;                 // an ace also plays low
    for (var hi = 14; hi >= 5; hi--) if (((mask >> (hi - 4)) & 31) === 31) return hi;
    return 0;
  }
  function topRanks(mask, n, out) {
    for (var r = 14; r >= 2 && out.length < n; r--) if (mask & (1 << r)) out.push(r);
    return out;
  }
  function code(cat, ks) {
    var v = cat;
    for (var i = 0; i < 5; i++) v = v * 16 + (ks[i] || 0);
    return v;
  }
  /* A number that is higher for the better hand (best five of the cards given). */
  function score(cards) {
    var counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], suitMask = [0, 0, 0, 0], suitN = [0, 0, 0, 0], mask = 0, i, r;
    for (i = 0; i < cards.length; i++) {
      var c = cards[i]; counts[c.r]++; suitMask[c.s] |= 1 << c.r; suitN[c.s]++; mask |= 1 << c.r;
    }
    var flush = -1;
    for (i = 0; i < 4; i++) if (suitN[i] >= 5) flush = i;
    if (flush >= 0) { var sf = straightHigh(suitMask[flush]); if (sf) return code(8, [sf]); }
    var quad = 0, trips = [], pairs = [];
    for (r = 14; r >= 2; r--) {
      if (counts[r] === 4) quad = r; else if (counts[r] === 3) trips.push(r); else if (counts[r] === 2) pairs.push(r);
    }
    if (quad) return code(7, [quad, topRanks(mask & ~(1 << quad), 1, [])[0]]);
    if (trips.length && (trips.length > 1 || pairs.length)) return code(6, [trips[0], Math.max(trips[1] || 0, pairs[0] || 0)]);
    if (flush >= 0) return code(5, topRanks(suitMask[flush], 5, []));
    var st = straightHigh(mask);
    if (st) return code(4, [st]);
    if (trips.length) return code(3, [trips[0]].concat(topRanks(mask & ~(1 << trips[0]), 2, [])));
    if (pairs.length >= 2) return code(2, [pairs[0], pairs[1], topRanks(mask & ~(1 << pairs[0]) & ~(1 << pairs[1]), 1, [])[0]]);
    if (pairs.length) return code(1, [pairs[0]].concat(topRanks(mask & ~(1 << pairs[0]), 3, [])));
    return code(0, topRanks(mask, 5, []));
  }
  function describe(sc) {
    var ks = [], v = sc;
    for (var i = 0; i < 5; i++) { ks.unshift(v % 16); v = Math.floor(v / 16); }
    var cat = v;
    if (cat === 1) return 'Pair of ' + PLURAL[ks[0]];
    if (cat === 2) return PLURAL[ks[0]].replace(/^./, function (c) { return c.toUpperCase(); }) + ' and ' + PLURAL[ks[1]];
    if (cat === 3) return 'Three ' + PLURAL[ks[0]];
    if (cat === 6) return PLURAL[ks[0]].replace(/^./, function (c) { return c.toUpperCase(); }) + ' full of ' + PLURAL[ks[1]];
    if (cat === 8 && ks[0] === 14) return 'Royal flush';
    return CATEGORY[cat];
  }

  /* ---------- how strong is a hand? deal the rest out many times ---------- */
  function equity(hole, board, nOpp, sims, rng) {
    if (nOpp < 1) return 1;
    var used = {}, rest = [], i, k;
    for (i = 0; i < hole.length; i++) used[hole[i].id] = 1;
    for (i = 0; i < board.length; i++) used[board[i].id] = 1;
    for (i = 0; i < 52; i++) if (!used[i]) rest.push(DECK[i]);
    var need = 2 * nOpp + 5 - board.length, won = 0, mine = hole.concat(board), full = board.slice();
    for (var s = 0; s < sims; s++) {
      for (k = 0; k < need; k++) {                    // partial shuffle: the first `need` cards are the draw
        var j = k + Math.floor(rng() * (rest.length - k)), t = rest[k]; rest[k] = rest[j]; rest[j] = t;
      }
      full.length = board.length;
      for (k = 2 * nOpp; k < need; k++) full.push(rest[k]);
      var me = score(hole.concat(full)), best = 0, ties = 0;
      for (k = 0; k < nOpp; k++) {
        var o = score([rest[2 * k], rest[2 * k + 1]].concat(full));
        if (o > best) { best = o; ties = 0; } else if (o === best) ties++;
      }
      if (me > best) won += 1; else if (me === best) won += 1 / (ties + 2);
    }
    return won / sims;
  }
  var preflopCache = {};
  function preflopEquity(hole, nOpp, rng) {
    var a = Math.max(hole[0].r, hole[1].r), b = Math.min(hole[0].r, hole[1].r);
    var key = a + '-' + b + (a !== b && hole[0].s === hole[1].s ? 's' : 'o') + nOpp;
    if (preflopCache[key] === undefined) preflopCache[key] = equity(hole, [], nOpp, 400, rng);
    return preflopCache[key];
  }
  /* Chance of winning, rescaled so that a fair share (1 in nIn) sits in the middle whatever the
     number of players, then cut into ten steps: 0 never wins, 9 nearly always does. */
  function strengthOf(eq, nIn) {
    var u = nIn > 2 ? Math.pow(eq, Math.log(0.5) / Math.log(1 / nIn)) : eq;
    return Math.min(9, Math.floor(u * 10));
  }
  var STRENGTH_NAMES = ['hopeless', 'very weak', 'weak', 'below par', 'average', 'decent', 'good', 'strong', 'very strong', 'a monster'];

  /* ---------- one hand ---------- */
  /* players: [{seat, stack}] in seat order; button: index into players. */
  function Hand(players, button, rng) {
    var n = this.n = players.length, i;
    this.rng = rng;
    this.p = players.map(function (q) { return { seat: q.seat, stack: q.stack, start: q.stack, hole: [], bet: 0, total: 0, folded: false, acted: false }; });
    var deck = DECK.slice();
    for (i = deck.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
    this.deck = deck; this.board = []; this.street = 0; this.button = button; this.log = [];
    this.done = false; this.showdown = false; this.winners = [];
    this.sb = n === 2 ? button : (button + 1) % n; this.bb = (this.sb + 1) % n;
    this._pay(this.sb, SB); this._pay(this.bb, BB);
    for (var round = 0; round < 2; round++) for (i = 0; i < n; i++) this.p[(this.sb + i) % n].hole.push(deck.pop());
    this.level = BB; this.raises = 1; this.unit = SMALL_BET;
    this.toAct = (this.bb + 1) % n;
  }
  Hand.prototype._pay = function (i, amount) { var q = this.p[i]; q.stack -= amount; q.bet += amount; q.total += amount; };
  Hand.prototype.pot = function () { var s = 0; for (var i = 0; i < this.n; i++) s += this.p[i].total; return s; };
  Hand.prototype.inHand = function () { var c = 0; for (var i = 0; i < this.n; i++) if (!this.p[i].folded) c++; return c; };
  /* What the player to act may do. */
  Hand.prototype.options = function () {
    var q = this.p[this.toAct], toCall = this.level - q.bet, canRaise = this.raises < CAP;
    var actions = toCall > 0 ? [FOLD, CALL] : [CALL];
    if (canRaise) actions.push(RAISE);
    return { toCall: toCall, canRaise: canRaise, raiseTo: this.level + this.unit, actions: actions, bet: q.bet };
  };
  /* action: 0 fold, 1 check/call, 2 bet/raise. Returns what happened, for showing. */
  Hand.prototype.act = function (action) {
    var i = this.toAct, q = this.p[i], o = this.options(), ev = { i: i, seat: q.seat, street: this.street };
    if (action === FOLD && o.toCall === 0) action = CALL;           // folding for free makes no sense: check
    if (action === RAISE && !o.canRaise) action = CALL;
    if (action === FOLD) { q.folded = true; ev.type = 'fold'; ev.paid = 0; }
    else if (action === CALL) { this._pay(i, o.toCall); ev.type = o.toCall ? 'call' : 'check'; ev.paid = o.toCall; }
    else {
      var pay = o.raiseTo - q.bet;
      ev.type = this.level === 0 ? 'bet' : 'raise'; ev.paid = pay;
      this._pay(i, pay); this.level = o.raiseTo; this.raises++;
      for (var k = 0; k < this.n; k++) if (k !== i) this.p[k].acted = false;
    }
    q.acted = true; ev.level = this.level; ev.bet = q.bet; ev.pot = this.pot();
    this.log.push(ev);
    if (this.inHand() === 1) { this._finish(false); return ev; }
    this.toAct = -1;
    for (var s = 1; s <= this.n; s++) {
      var c = (i + s) % this.n, p = this.p[c];
      if (!p.folded && (!p.acted || p.bet < this.level)) { this.toAct = c; break; }
    }
    return ev;
  };
  /* The betting round is over (toAct === -1): deal the next street or show down. */
  Hand.prototype.advance = function () {
    for (var i = 0; i < this.n; i++) { this.p[i].bet = 0; this.p[i].acted = false; }
    this.street++;
    if (this.street === 4) { this._finish(true); return []; }
    var dealt = [];
    this.deck.pop();                                    // burn a card
    for (var k = 0; k < (this.street === 1 ? 3 : 1); k++) dealt.push(this.deck.pop());
    this.board = this.board.concat(dealt);
    this.level = 0; this.raises = 0; this.unit = this.street >= 2 ? BIG_BET : SMALL_BET;
    for (var s = 1; s <= this.n; s++) { var c = (this.button + s) % this.n; if (!this.p[c].folded) { this.toAct = c; break; } }
    return dealt;
  };
  Hand.prototype._finish = function (showdown) {
    var pot = this.pot(), live = [], i;
    for (i = 0; i < this.n; i++) if (!this.p[i].folded) live.push(i);
    this.showdown = showdown && live.length > 1; this.done = true; this.toAct = -1;
    var best = -1, win = [];
    for (i = 0; i < live.length; i++) {
      var q = this.p[live[i]];
      q.score = this.showdown ? score(q.hole.concat(this.board)) : 0;
      q.handName = this.showdown ? describe(q.score) : '';
      if (q.score > best) { best = q.score; win = [live[i]]; } else if (q.score === best) win.push(live[i]);
    }
    var share = Math.floor(pot / win.length), odd = pot - share * win.length;
    win.sort(function (a, b) { return ((a - this.button + this.n) % this.n) - ((b - this.button + this.n) % this.n); }.bind(this));
    this.winners = win.map(function (w, k) { return { i: w, amount: share + (k < odd ? 1 : 0) }; });
    for (i = 0; i < this.winners.length; i++) this.p[this.winners[i].i].stack += this.winners[i].amount;
    for (i = 0; i < this.n; i++) this.p[i].net = this.p[i].stack - this.p[i].start;
  };

  /* ---------- the smell code ---------- */
  /* The situation of player i, as the fly smells it. */
  function situation(hand, i, sims) {
    var q = hand.p[i], nIn = hand.inHand(), o = hand.options();
    var eq = hand.street === 0 ? preflopEquity(q.hole, nIn - 1, hand.rng) : equity(q.hole, hand.board, nIn - 1, sims || 120, hand.rng);
    var strength = strengthOf(eq, nIn), street = Math.min(3, hand.street);
    var pressure = o.toCall === 0 ? 0 : o.toCall <= hand.unit && hand.raises <= 1 ? 1 : 2;
    return { equity: eq, strength: strength, street: street, pressure: pressure, state: stateIndex(strength, street, pressure), options: o };
  }
  function stateIndex(strength, street, pressure) { return (strength * N_STREET + street) * N_PRESSURE + pressure; }

  var SMELLS = {
    name: 'poker-limit-holdem', nOdors: N_STATES * 3, nActions: 3,
    groupNames: ['strength', 'street', 'pressure', 'fold', 'call', 'raise'],
    groupSizes: { strength: 27, street: 8, pressure: 6, fold: 5, call: 6, raise: 5 },
    pattern: function (brain, odor, out) {
      var bump = root.FlyBrain.bump, g = brain.groups;
      var action = odor % 3, st = (odor - action) / 3, pressure = st % N_PRESSURE, rest = (st - pressure) / N_PRESSURE;
      var street = rest % N_STREET, strength = (rest - street) / N_STREET, i;
      out.fill(0);
      bump(out, g.strength, strength / (N_STRENGTH - 1), STRENGTH_WIDTH, STRENGTH_GAIN);   // the cards matter most
      bump(out, g.street, street / (N_STREET - 1), 0.8, 0.7);
      bump(out, g.pressure, pressure / (N_PRESSURE - 1), 0.7, 0.8);
      var act = action === FOLD ? g.fold : action === CALL ? g.call : g.raise;
      for (i = 0; i < act.length; i++) out[act[i]] = 0.6;
      return out;
    }
  };

  var api = {
    SB: SB, BB: BB, SMALL_BET: SMALL_BET, BIG_BET: BIG_BET, CAP: CAP, START_STACK: START_STACK, TOP_UP_BELOW: TOP_UP_BELOW, BANK_ABOVE: BANK_ABOVE,
    FOLD: FOLD, CALL: CALL, RAISE: RAISE, N_STRENGTH: N_STRENGTH, N_STREET: N_STREET, N_PRESSURE: N_PRESSURE, N_STATES: N_STATES,
    STRENGTH_NAMES: STRENGTH_NAMES, DECK: DECK, score: score, describe: describe, equity: equity, preflopEquity: preflopEquity,
    strengthOf: strengthOf, Hand: Hand, situation: situation, stateIndex: stateIndex, SMELLS: SMELLS, BRAIN_OPTIONS: BRAIN_OPTIONS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Poker = api;
})(typeof self !== 'undefined' ? self : this);

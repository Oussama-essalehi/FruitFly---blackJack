/* FlyJack - blackjack rules and exact maths.
 *
 * Rules: hit or stand only (no double, split, surrender or insurance), blackjack pays 3:2,
 * dealer stands on every 17, dealer checks for blackjack before the player acts, cards come
 * from a continuously shuffled shoe (every draw: 2-9 and ace 1/13 each, ten-value 4/13).
 *
 * A decision state is (total, soft, dealer):
 *   total  4..20   the player's total (21 stands automatically)
 *   soft   0|1     1 when an ace is being counted as 11
 *   dealer 2..11   the dealer's face-up card (11 = ace)
 */
(function (root) {
  'use strict';

  var CARDS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10, 11];
  var FACES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  var SUITS = ['s', 'h', 'd', 'c'];
  var VALUE_P = { 2: 1 / 13, 3: 1 / 13, 4: 1 / 13, 5: 1 / 13, 6: 1 / 13, 7: 1 / 13, 8: 1 / 13, 9: 1 / 13, 10: 4 / 13, 11: 1 / 13 };
  var VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

  var MIN_TOTAL = 4, MAX_TOTAL = 20, N_TOTAL = MAX_TOTAL - MIN_TOTAL + 1, N_DEALER = 10;
  var N_STATES = N_TOTAL * 2 * N_DEALER;

  function stateIndex(total, soft, dealer) {
    return ((total - MIN_TOTAL) * 2 + (soft ? 1 : 0)) * N_DEALER + (dealer - 2);
  }
  function stateExists(total, soft) { return soft ? total >= 12 : true; }

  function drawCard(rng) {
    var i = Math.floor(rng() * 13);
    return { value: CARDS[i], face: FACES[i], suit: SUITS[Math.floor(rng() * 4)] };
  }

  /* Add a card value to a (total, soft) hand. */
  function addCard(total, soft, v) {
    var t = total + v, aces = (soft ? 1 : 0) + (v === 11 ? 1 : 0);
    while (t > 21 && aces > 0) { t -= 10; aces--; }
    return { total: t, soft: aces > 0 };
  }
  function handOf(cards) {
    var h = { total: 0, soft: false };
    for (var i = 0; i < cards.length; i++) h = addCard(h.total, h.soft, cards[i].value);
    return h;
  }

  /* One hand as a little state machine, so a page can show it step by step.
   * policy(total, soft, dealer) must return true to hit, false to stand. */
  function Hand(rng) {
    this.rng = rng;
    this.player = [drawCard(rng), drawCard(rng)];
    this.dealer = [drawCard(rng), drawCard(rng)];   // dealer[0] is face up
    this.up = this.dealer[0].value;
    this.decisions = [];                              // {total, soft, dealer, hit}
    this.done = false; this.reward = 0; this.result = '';
    var p = handOf(this.player), d = handOf(this.dealer);
    this.total = p.total; this.soft = p.soft;
    if (p.total === 21 || d.total === 21) {
      this.holeShown = d.total === 21;
      if (p.total === 21 && d.total === 21) this._end(0, 'push');
      else if (p.total === 21) this._end(1.5, 'blackjack');
      else this._end(-1, 'dealer blackjack');
    }
  }
  Hand.prototype._end = function (reward, result) { this.done = true; this.reward = reward; this.result = result; };
  Hand.prototype.state = function () { return { total: this.total, soft: this.soft, dealer: this.up }; };
  Hand.prototype.act = function (hit) {
    this.decisions.push({ total: this.total, soft: this.soft, dealer: this.up, hit: hit });
    if (hit) {
      this.player.push(drawCard(this.rng));
      var p = handOf(this.player); this.total = p.total; this.soft = p.soft;
      if (p.total > 21) return this._end(-1, 'bust');
      if (p.total < 21) return;                       // another decision follows
    }
    this.holeShown = true;
    var d = handOf(this.dealer);
    while (d.total < 17) { this.dealer.push(drawCard(this.rng)); d = handOf(this.dealer); }
    if (d.total > 21) this._end(1, 'dealer bust');
    else if (d.total < this.total) this._end(1, 'win');
    else if (d.total > this.total) this._end(-1, 'lose');
    else this._end(0, 'push');
  };

  /* ---- exact maths (no simulation noise) ---- */

  var dealerCache = {};
  /* Distribution of the dealer's final total given the up card, knowing the dealer has no
   * blackjack. Returns {17..21: p, bust: p}. */
  function dealerOutcomes(up) {
    if (dealerCache[up]) return dealerCache[up];
    var out = { 17: 0, 18: 0, 19: 0, 20: 0, 21: 0, bust: 0 };
    function play(total, soft, p) {
      if (total > 21) { out.bust += p; return; }
      if (total >= 17) { out[total] += p; return; }
      for (var i = 0; i < VALUES.length; i++) {
        var h = addCard(total, soft, VALUES[i]);
        play(h.total, h.soft, p * VALUE_P[VALUES[i]]);
      }
    }
    var banned = up === 11 ? 10 : up === 10 ? 11 : 0;
    var norm = 1 - (banned ? VALUE_P[banned] : 0);
    for (var i = 0; i < VALUES.length; i++) {
      if (VALUES[i] === banned) continue;
      var h = addCard(up === 11 ? 11 : up, up === 11, VALUES[i]);
      play(h.total, h.soft, VALUE_P[VALUES[i]] / norm);
    }
    return (dealerCache[up] = out);
  }
  function standValue(total, up) {
    var d = dealerOutcomes(up), v = d.bust;
    for (var t = 17; t <= 21; t++) v += t < total ? d[t] : t > total ? -d[t] : 0;
    return v;
  }

  /* Expected values of every state for a policy given as pHit[stateIndex] in [0,1]
   * (pass null for the best possible play). Returns {q: Float64Array(2*N_STATES) [hit, stand],
   * value: Float64Array(N_STATES), best: Uint8Array(N_STATES) 1 = hit}. */
  function evaluate(pHit) {
    var q = new Float64Array(2 * N_STATES), value = new Float64Array(N_STATES), best = new Uint8Array(N_STATES);
    for (var up = 2; up <= 11; up++) {
      // a hit never lowers a hard total, so work down from 20; soft hands can fall back to hard ones
      for (var pass = 0; pass < 2; pass++) {             // pass 0: hard hands, pass 1: soft hands
        var soft = pass === 1;
        for (var total = MAX_TOTAL; total >= (soft ? 12 : MIN_TOTAL); total--) {
          var s = stateIndex(total, soft, up), hit = 0;
          for (var i = 0; i < VALUES.length; i++) {
            var h = addCard(total, soft, VALUES[i]), p = VALUE_P[VALUES[i]];
            if (h.total > 21) hit -= p;
            else if (h.total === 21) hit += p * standValue(21, up);
            else hit += p * value[stateIndex(h.total, h.soft, up)];
          }
          var stand = standValue(total, up);
          q[2 * s] = hit; q[2 * s + 1] = stand; best[s] = hit > stand ? 1 : 0;
          var ph = pHit ? pHit[s] : best[s];
          value[s] = ph * hit + (1 - ph) * stand;
        }
      }
    }
    return { q: q, value: value, best: best };
  }

  /* Expected winnings per hand (in bets) for a policy, including blackjacks. */
  function expectedReturn(pHit) {
    var ev = evaluate(pHit), total = 0;
    for (var a = 0; a < VALUES.length; a++) for (var b = 0; b < VALUES.length; b++) for (var u = 0; u < VALUES.length; u++) {
      var p = VALUE_P[VALUES[a]] * VALUE_P[VALUES[b]] * VALUE_P[VALUES[u]], up = VALUES[u];
      var h = addCard(VALUES[a] === 11 ? 11 : VALUES[a], VALUES[a] === 11, VALUES[b]);
      var dealerBj = up === 11 ? VALUE_P[10] : up === 10 ? VALUE_P[11] : 0;
      if (h.total === 21) total += p * 1.5 * (1 - dealerBj);
      else total += p * (-dealerBj + (1 - dealerBj) * ev.value[stateIndex(h.total, h.soft, up)]);
    }
    return total;
  }

  var api = {
    MIN_TOTAL: MIN_TOTAL, MAX_TOTAL: MAX_TOTAL, N_TOTAL: N_TOTAL, N_DEALER: N_DEALER, N_STATES: N_STATES,
    stateIndex: stateIndex, stateExists: stateExists, drawCard: drawCard, addCard: addCard, handOf: handOf,
    Hand: Hand, dealerOutcomes: dealerOutcomes, standValue: standValue, evaluate: evaluate, expectedReturn: expectedReturn
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Blackjack = api;
})(typeof self !== 'undefined' ? self : this);

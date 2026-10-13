/* FlyJack - play the shared fly forward to now and save its latest checkpoint.
 *
 * Run every hour by .github/workflows/fly.yml, which publishes the result on the fly-data branch,
 * where every page picks it up (src/timeline.js explains the whole idea). Nothing here decides
 * anything new: the hands are fixed by the clock and the dice, so this only saves browsers the
 * work of catching up from an old checkpoint.
 *
 * Usage: node tools/advance_fly.js [last-checkpoint.json] [new-checkpoint.json]
 *          the first file may be missing (the fly then starts from its birth)
 *        FLY_NOW=2026-10-20T12:00:00Z node tools/advance_fly.js ...   pretend it is another time
 */
'use strict';
var fs = require('fs'), path = require('path');
var ROOT = path.join(__dirname, '..');
var FB = require('../src/flybrain.js'), BJ = require('../src/blackjack.js'), TL = require('../src/timeline.js');

var input = process.argv[2], output = process.argv[3] || path.join(ROOT, 'checkpoint.json');
var now = process.env.FLY_NOW ? Date.parse(process.env.FLY_NOW) : Date.now();
if (!(now > 0)) throw new Error('FLY_NOW is not a date: ' + process.env.FLY_NOW);

var last = null;
if (input && fs.existsSync(input)) {
  try { last = JSON.parse(fs.readFileSync(input, 'utf8')); } catch (e) { console.log('The last checkpoint could not be read (' + e.message + ').'); }
}
var circuit = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/circuit.json'), 'utf8'));
var started = Date.now();
var fly = new TL.Timeline(circuit, { FlyBrain: FB, Blackjack: BJ }, last);
console.log(fly.fromCheckpoint ? 'Carrying on from hand ' + fly.brain.hands + '.' :
  (last ? 'The last checkpoint does not fit this fly, so it is replayed from its birth.' : 'No checkpoint yet: the fly is played from its birth.'));
if (now < TL.CONFIG.born) console.log('The fly is born on ' + new Date(TL.CONFIG.born).toISOString() + ': nothing to play yet.');

var saved = fly.fromCheckpoint ? last : null, startHands = fly.brain.hands;
fly.advanceTo(now, function (rec) { if (rec.boundary) saved = fly.checkpoint(); });

if (!saved) { console.log('No checkpoint to save yet (the first comes at hand ' + TL.CONFIG.checkpointEvery + ').'); process.exit(0); }
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, JSON.stringify(saved));
var point = saved.curve[saved.curve.length - 1];
console.log('Played hands ' + (startHands + 1) + ' to ' + fly.brain.hands + ' in ' + ((Date.now() - started) / 1000).toFixed(1) + ' s. ' +
  'Saved the checkpoint at hand ' + saved.hands + ' (skill ' + (100 * point.s).toFixed(1) + '% per hand, winnings ' + saved.bank + ' bets) to ' + output + '.');

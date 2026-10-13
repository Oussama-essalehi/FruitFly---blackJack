/* Train the fly offline and report how well it ends up playing.
 *
 *   node tools/experiment.js                      real wiring, 3 flies, 200,000 hands each
 *   node tools/experiment.js --controls           also run the control experiments
 *   node tools/experiment.js --hands 50000 --seeds 5 --set learningRate=0.05
 *
 * "Skill" numbers are exact: the fly's current habits are scored with the game's maths
 * (src/blackjack.js), not estimated from lucky or unlucky runs of cards.
 */
'use strict';
const path = require('path');
const Blackjack = require('../src/blackjack.js');
const { Brain } = require('../src/flybrain.js');
const circuit = require(path.join('..', 'data', 'circuit.json'));

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf('--' + name); return i < 0 ? dflt : args[i + 1]; };
const HANDS = +flag('hands', 200000), SEEDS = +flag('seeds', 3), QUIET = args.includes('--quiet');
const overrides = {};
args.forEach((a, i) => { if (a === '--set') { const [k, v] = args[i + 1].split('='); setPath(overrides, k, isNaN(+v) ? v : +v); } });
function setPath(o, key, v) { const p = key.split('.'); while (p.length > 1) { const k = p.shift(); o = o[k] = o[k] || {}; } o[p[0]] = v; }

const best = Blackjack.evaluate(null).best;
const REF = {
  best: Blackjack.expectedReturn(null),
  random: Blackjack.expectedReturn(new Float64Array(Blackjack.N_STATES).fill(0.5)),
  alwaysStand: Blackjack.expectedReturn(new Float64Array(Blackjack.N_STATES).fill(0))
};

function score(brain) {
  const habits = brain.policy(false), greedy = brain.policy(true);
  let agree = 0, n = 0;
  for (let t = 4; t <= 20; t++) for (let s = 0; s < 2; s++) for (let d = 2; d <= 11; d++) {
    if (!Blackjack.stateExists(t, s)) continue;
    const i = Blackjack.stateIndex(t, s, d); n++; if (greedy[i] === best[i]) agree++;
  }
  return { ev: Blackjack.expectedReturn(habits), evGreedy: Blackjack.expectedReturn(greedy), agree: agree / n };
}

function run(label, options) {
  const rows = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const t0 = Date.now();
    const brain = new Brain(circuit, Object.assign({ seed }, overrides, options));
    const start = score(brain);
    let won = 0;
    const checkpoints = [1000, 5000, 20000, 50000, 100000, HANDS].filter((h, i, a) => h <= HANDS && a.indexOf(h) === i);
    const curve = [];
    for (let h = 1; h <= HANDS; h++) {
      won += brain.playHand(Blackjack).reward;
      if (checkpoints.includes(h)) curve.push([h, score(brain)]);
    }
    const end = curve[curve.length - 1][1];
    rows.push({ start, end, curve, won: won / HANDS, gain: brain.dopamineGain, ms: Date.now() - t0 });
    if (!QUIET) console.log(`  ${label} fly ${seed}: untrained ${pct(start.ev)} -> ` + curve.map(([h, s]) => `${h / 1000}k ${pct(s.ev)}`).join('  ') +
      `  | matches best play ${(100 * end.agree).toFixed(0)}%  (${(HANDS / (rows[rows.length - 1].ms / 1000) | 0)} hands/s)`);
  }
  const mean = f => rows.reduce((a, r) => a + f(r), 0) / rows.length;
  const out = { label, untrained: mean(r => r.start.ev), trained: mean(r => r.end.ev), trainedGreedy: mean(r => r.end.evGreedy), agree: mean(r => r.end.agree), dopamineGain: mean(r => r.gain) };
  console.log(`${label.padEnd(34)} untrained ${pct(out.untrained)}  trained ${pct(out.trained)}  (no-noise ${pct(out.trainedGreedy)})  matches best play ${(100 * out.agree).toFixed(0)}%`);
  return out;
}
const pct = x => (x >= 0 ? '+' : '') + (100 * x).toFixed(1) + '%';

console.log(`Money won or lost per hand, as a share of the bet. ${HANDS} hands, ${SEEDS} flies each.`);
console.log(`reference: best possible ${pct(REF.best)}   always stand ${pct(REF.alwaysStand)}   coin flip ${pct(REF.random)}\n`);
const results = [run('real wiring', {})];
if (args.includes('--controls')) {
  results.push(run('dopamine blocked', { dopamine: 'blocked' }));
  results.push(run('reward/punishment swapped', { dopamine: 'swapped' }));
  results.push(run('dopamine targets shuffled', { dopamine: 'shuffled' }));
  results.push(run('PN->KC wiring shuffled', { wiring: 'shuffled-pn-kc' }));
  results.push(run('KC->MBON wiring shuffled', { wiring: 'shuffled-kc-mbon' }));
}
if (flag('json')) require('fs').writeFileSync(flag('json'), JSON.stringify({ hands: HANDS, seeds: SEEDS, reference: REF, results }, null, 1));

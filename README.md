# FlyJack

A fruit fly's learning circuit, wired from the real connectome, learns to play blackjack.

Open `web/index.html` in a browser. That is the whole app: no install, no server.

## What it does

The page runs 4,406 neurons from the mushroom body of the MaleCNS v1.0 connectome
(236 projection neurons, 3,741 Kenyon cells, 97 output neurons, 332 dopamine neurons,
78,937 connections). Each blackjack situation plus each choice ("hit" or "stand") is turned
into a smell. The fly picks the choice that smells better. Wins and losses arrive as dopamine,
which changes the synapses between Kenyon cells and output neurons. Nothing else is trained.

In Watch mode the fly acts it out at a casino table: it sniffs each choice (blue scent smells
good, orange smells bad), taps the felt to hit, waves a leg to stand, and its head glows with
reward or punishment dopamine when the hand is paid.

The casino is a 3D scene drawn with three.js (bundled into the page, so it still works offline)
in a retro pixel look: few polygons, flat shading and big pixels, on a neon-trimmed platform
above a city at night in the rain. A read-out over the scene follows the fly's brain: how many
of the circuit's cells are active, and a raster of 96 of them that scrolls with time. The model
works with activity levels, not spikes, so an active cell draws a bar. Drag the scene to walk
around the table; double-click to come back.

## The brain model

Beside the table, a 3D model shows the whole nervous system: one small sphere for each of the
139,462 neurons whose cell-body position is in the connectome, the brain with its eye lobes at
one end and the nerve cord at the other, in the mixed colours connectome pictures use. The
strands through the neck join each of 3,136 descending and ascending neurons to its strongest
partner on the other side. They show connections, not the neurons' real shapes: the full
shapes are tens of gigabytes and are not part of this project. The neurons of the learning
circuit light up on top as the fly smells, chooses and gets its dopamine. The model is drawn
faded so those firing neurons stand out; one button under it brings back the full colours and
another zooms in on the brain. Drag to turn the model.

## Poker

The Poker tab seats five flies at a Limit Texas Hold'em table: Canton-S, white, yellow, ebony
and Curly, dressed as classic lab strains but all running their own copy of the same circuit.
The sixth seat is open: anyone at the screen can type a name and sit down, or ask a fly to
leave and take its place. With two or more people, the table asks you to pass the screen before
it shows anyone's cards.

A poker situation smells of three things: how often the fly's cards would win against the
players still in (estimated by dealing the rest out a few hundred times, then scaled so a fair
share sits in the middle), the street, and whether there is a bet or a raise to call. Each
choice (fold, call, raise) is judged by the chips won or lost from that moment on, so folding
is always worth zero. In a headless run of 30,000 hands, flop decisions facing a bet went from
folding a monster 14% of the time and a weak hand about 30% of the time, to raising or calling
monsters nearly always and folding weak hands 60 to 85% of the time.

## Results (three flies, 200,000 hands each)

Average result per hand, as a share of the bet. Exact values from the game's maths.

| Brain                          | Before | After  | Plays like an expert |
|--------------------------------|--------|--------|----------------------|
| Intact                         | -25.8% | -4.3%  | 91%                  |
| Dopamine blocked               | -25.8% | -25.8% | 42%                  |
| Reward and punishment swapped  | -25.8% | -20.6% | 38%                  |
| Dopamine targets scrambled     | -25.8% | -16.6% | 51%                  |
| Smell wiring scrambled (PN-KC) | -34.3% | -4.2%  | 90%                  |
| KC-MBON wiring scrambled       | -28.3% | -5.3%  | 78%                  |

For reference: expert play -2.7%, always stand -16.0%, coin flip -29.9%.

Reproduce with `node tools/experiment.js --controls` (about six minutes).

## What is real and what is not

Real, measured in the connectome: who connects to whom and with how many synapses; each output
neuron's transmitter (which sets approach or avoid); how many synapses the reward (PAM) and
punishment (PPL1) dopamine neurons make on each output neuron.

Engineered: how cards become smells; the neuron model (activity levels, no spikes, top 5% of
Kenyon cells stay active); the exact learning rule and its numbers. `src/flybrain.js` starts
with the full list.

## Files

    web/index.html         the finished page (built, self-contained)
    web/page.html          page layout and styles
    web/scenekit.js        shared timing: tweens, timers, easing
    web/scene3d.js         the 3D casino: night city, tables, cards, chips, the dealer, labels, read-out, camera
    web/fly3d.js           the fly, modelled and animated in 3D
    web/vendor/three.min.js  three.js r149 (MIT, see web/vendor/three.LICENSE)
    web/casino.js          the blackjack table: dealing, chips, the fly's gestures
    web/brain3d.js         the 3D model of the whole nervous system
    web/app.js             blackjack game loop, brain activity, charts
    web/pokertable.js      the poker table: six seats, a fly per seat, pot, showdown
    web/pokerapp.js        the poker game: seats and joining, turns, learning, leaderboard
    src/poker.js           Limit Hold'em rules, hand ranking, strength estimate, poker smells
    src/flybrain.js        the brain: smell code, decision, dopamine learning
    src/blackjack.js       rules and exact maths
    data/circuit.json      the extracted circuit
    data/cns_cloud.json    every neuron's cell-body position, and the strands through the neck
    tools/build_circuit.py extracts data/circuit.json from the connectome
    tools/build_cloud.py   extracts data/cns_cloud.json from the connectome
    tools/build_web.py     assembles web/index.html
    tools/experiment.js    offline training and control experiments
    results/               output of the control experiments

## Rebuilding from the raw connectome

    mkdir raw && cd raw
    B=https://raw.githubusercontent.com/YijieYin/connectome_data_prep/main/data/maleCNS
    curl -LO $B/mcns_syncount_all_neuron.npz     # 79 MB
    curl -LO $B/mcns_all_neuron_meta.csv         # 28 MB
    cd ..
    pip install numpy scipy pandas
    python3 tools/build_circuit.py raw data/circuit.json
    python3 tools/build_cloud.py raw data/cns_cloud.json
    python3 tools/build_web.py

## Rules of the games

Blackjack: hit or stand only, blackjack pays 3 to 2, dealer stands on 17 and checks for
blackjack first, continuously shuffled shoe.

Poker: Limit Texas Hold'em, six seats, blinds 1 and 2, bets of 2 then 4 from the turn, one bet
and three raises per round. Stacks top up to 100 below 50 and bank winnings above 250, so no
one is ever all in.

## Credits

Connectome: MaleCNS v1.0, FlyEM at HHMI Janelia with the University of Cambridge, the MRC
Laboratory of Molecular Biology and Google Research (Berg et al.), CC BY 4.0,
https://male-cns.janelia.org. Read from the preprocessed matrices at
https://github.com/YijieYin/connectome_data_prep. Any published use must cite the dataset.

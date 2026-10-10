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
    web/casino.js          the animated casino scene: dealer, cards, chips, the fly's gestures
    web/app.js             game loop, brain view, charts
    src/flybrain.js        the brain: smell code, decision, dopamine learning
    src/blackjack.js       rules and exact maths
    data/circuit.json      the extracted circuit
    tools/build_circuit.py extracts data/circuit.json from the connectome
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
    python3 tools/build_web.py

## Rules of the game

Hit or stand only, blackjack pays 3 to 2, dealer stands on 17 and checks for blackjack first,
continuously shuffled shoe.

## Credits

Connectome: MaleCNS v1.0, FlyEM at HHMI Janelia with the University of Cambridge, the MRC
Laboratory of Molecular Biology and Google Research (Berg et al.), CC BY 4.0,
https://male-cns.janelia.org. Read from the preprocessed matrices at
https://github.com/YijieYin/connectome_data_prep. Any published use must cite the dataset.

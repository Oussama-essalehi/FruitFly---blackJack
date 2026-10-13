# FlyJack

**A real fruit fly brain, rebuilt in a browser, learns to play blackjack and poker.**

## Where this started

Scientists recently mapped, for the first time, the complete brain and nervous system of an adult
male fruit fly. Google Research worked with HHMI Janelia and other labs, using AI to turn millions
of microscope images into 3D neurons. The result is a full wiring diagram (a "connectome"): every
neuron and who it talks to.

![Google's announcement of the complete fruit fly brain map](google%20study.jpg)

That made me ask a simple question: **if we copy the real wiring of a fly's brain, can it learn
to play a game?**

## What this project does

FlyJack takes the part of the fly's brain that handles learning and memory (the *mushroom body*),
wired exactly as it is in the real map, and teaches it to play cards.

- Each game situation and each possible move is turned into a **smell**.
- The fly picks the move that **smells better**.
- When it wins, it gets a shot of **reward dopamine**. When it loses, **punishment dopamine**.
- Over time, the dopamine changes its connections, and the fly gets better.

Nothing else is trained. The learning comes from the real wiring and a simple dopamine rule.

## Try it

Open https://fruitfly-blackjack-web.vercel.app/ in your browser.

## One fly for everyone

Everyone who opens the page watches **the same fly**: same cards, same choices, same dopamine,
same learning curve. It was born on 13 October 2026 at 19:00 (Paris time) and has been playing
ever since, one hand every ten seconds or so, even when nobody is watching.

There is no server. The trick is that nothing about the fly is left to chance:

- **The dice are fixed.** Hand number *n* always uses the same random numbers, so the cards and
  the fly's choices are the same on every computer.
- **The clock sets the pace.** Each hand starts when the one before has been shown, counted from
  the fly's birth. Any browser knows from the time of day which hand is on the table right now.
- **The maths is the same everywhere.** Browsers are allowed to round `Math.exp` slightly
  differently (Chrome and Safari really do), so the brain uses its own version built from plain
  arithmetic. The fly comes out identical bit for bit in Node, Chrome and Safari's engine.

Every browser runs its own copy of the brain, but all the copies are the same fly. To save each
browser from replaying the fly's whole life, a GitHub Action (`.github/workflows/fly.yml`) plays it
forward every hour and saves a checkpoint of its memory on the `fly-data` branch. The page starts
from that checkpoint and only replays the last few hundred hands, which takes under a second.
If the Action ever stops, nothing breaks: pages catch up from an older checkpoint, just more
slowly. `src/timeline.js` explains the details.

To check on the hourly save, open the **Actions** tab of the repo. You can also start it by hand
there with **Run workflow**.

## What you'll see

**Blackjack.** A fly sits at a 3D casino table in a rainy neon city. It sniffs each choice
(blue smells good, orange smells bad), taps the table to hit, waves a leg to stand, and its head
glows when the dopamine arrives. Drag to look around; double-click to reset the view.

**The brain.** Next to the table, a 3D model shows the fly's whole nervous system, one dot per
neuron. The learning circuit lights up as the fly smells, decides and gets rewarded. Drag to
turn it.

**Poker.** Five flies, each with its own copy of the brain, play Texas Hold'em together. There's
an empty seat: type your name and join them, or swap out a fly. With several people at one
screen, the table asks you to pass it around before showing anyone's cards.

## Does it really learn?

Yes. At first the fly plays about as badly as flipping a coin. After training it plays very close
to an expert strategy. In poker it learns to bet with strong hands and fold weak ones.

To check that the learning really comes from the brain, I also tested "broken" flies:

| Fly                              | Does it learn? |
|----------------------------------|----------------|
| Normal brain                     | Yes, plays almost like an expert |
| Dopamine blocked                 | No, doesn't improve at all |
| Reward and punishment swapped    | Barely |
| Dopamine sent to the wrong place | Only a little |

So without working dopamine, the fly can't learn. Full numbers are in `results/`, and you can
rerun the tests with `node tools/experiment.js --controls`.

## What's real and what's not

**Real (from the brain map):** which neurons connect to which, and how strongly; whether each
output neuron pushes the fly toward or away from a choice; where the reward and punishment
dopamine neurons connect.

**Made up by me:** how cards are turned into smells, the simplified neuron model, and the exact
learning rule. The top of `src/flybrain.js` lists every assumption.

## How the project is organised

    web/    the app you open in the browser (3D casino, fly, brain model, games)
    src/    the brain, the blackjack rules, the poker rules and the shared fly's timeline
    data/   the brain circuit taken from the real map
    tools/  scripts to rebuild the data and the page, run the experiments, and save the shared fly
    results/  output of the "broken fly" tests

## Rebuilding from the raw brain map

You only need this if you want to regenerate the data yourself.

    mkdir raw && cd raw
    B=https://raw.githubusercontent.com/YijieYin/connectome_data_prep/main/data/maleCNS
    curl -LO $B/mcns_syncount_all_neuron.npz
    curl -LO $B/mcns_all_neuron_meta.csv
    cd ..
    pip install numpy scipy pandas
    python3 tools/build_circuit.py raw data/circuit.json
    python3 tools/build_cloud.py raw data/cns_cloud.json
    python3 tools/build_web.py

## Credits

Brain map: MaleCNS v1.0, by FlyEM at HHMI Janelia with the University of Cambridge, the MRC
Laboratory of Molecular Biology and Google Research (Berg et al.), CC BY 4.0,
https://male-cns.janelia.org. Read from the preprocessed data at
https://github.com/YijieYin/connectome_data_prep. Any published use must cite the dataset.

3D graphics: three.js (MIT licence, see `web/vendor/three.LICENSE`).

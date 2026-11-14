# ChartNet: a learned step-chart experiment for Fusemania

A time-boxed test of whether a model trained on the StepMania/ITG packs places steps better than the rule-based
generator in `scripts/lib/fusemania/generate.ts`. It follows Dance Dance Convolution (Donahue et al., 2017) in two stages:

1. **Step placement** (`onset.py`): per 10 ms frame, the probability of a step. Input: log-mel at three window sizes
   (3 × 64 bands), the song's beat phase (sin/cos at quarter, eighth and sixteenth), and the difficulty. A conv front end
   and a dilated residual stack (about ±1.3 s context). Trained on Apple MPS in about 20 minutes.
2. **Step selection** (`steps.py`): which arrows each row gets. A 2-layer GRU over rows, conditioned on the gap to the
   previous and next row, the beat-phase class, the difficulty and the audio at that row. Trained with the four mirror
   images of every chart. Holds, rolls and mines are not generated.

`gen.py` snaps the placed steps to the song's grid (16ths, triplets where the song swings) and enforces the rule
generator's minimum gaps. A **hybrid** (that learned rhythm with the rule generator's arrows, jumps, freezes and mines,
`generateCharts(analysis, placement)`) is evaluated for comparison. The game offers ChartNet v2, below.

## Data stays local

The packs (`fusemania-songs/packs`, 480 songs, 1,950 dance-single charts), their features, the trained weights and every
per-song file derived from them live in `$CHARTNET_WORK` (default `~/projects/personal/fusemania-songs/chartnet`) and are
never committed. Only this code and the generated charts for Fuse's own songs (`games/fusemania/charts/chartnet/`) are
in the repository.

## Running it

```bash
cd ~/projects/personal/fusemania-songs/chartnet && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python torch librosa soundfile numpy
```

```bash
P=~/projects/personal/fusemania-songs/chartnet/.venv/bin/python
$P scripts/chartnet/extract.py            # pack features → $CHARTNET_WORK/cache (≈1 min, 1.8 GB)
$P scripts/chartnet/extract_fuse.py       # Fuse songs' features and measured beat grid
$P scripts/chartnet/onset.py --phase 1 --name onset_phase   # placement model + F1 vs spectral-flux baselines
$P scripts/chartnet/steps.py              # arrow model + perplexity vs a bigram
$P scripts/chartnet/extract.py test-audio && pnpm exec tsx scripts/chartnet/rule-baseline.ts $CHARTNET_WORK/rulegen/jobs.json $CHARTNET_WORK/rulegen/out.json
$P scripts/chartnet/gen.py placement-eval && pnpm exec tsx scripts/chartnet/rule-baseline.ts $CHARTNET_WORK/rulegen/jobs.json $CHARTNET_WORK/rulegen/out_hybrid.json $CHARTNET_WORK/rulegen/placement.json
$P scripts/chartnet/gen.py eval           # held-out songs: human vs learned vs rule-based vs hybrid
$P scripts/chartnet/onset.py --phase 1 --density 1 --name onset_dens && $P scripts/chartnet/arrows.py   # v2 models
$P scripts/chartnet/gen2.py eval && $P scripts/chartnet/gen2.py fuse   # v2 held-out metrics, Fuse charts
pnpm exec tsx scripts/chartnet/bundle.ts $CHARTNET_WORK/out_fuse2 && (cd scripts/chartnet && $P gen.py fixup ../../games/fusemania/charts/*.ssc) && pnpm exec tsx scripts/fusemania-charts.ts bundle
```

## Results (48 held-out pack songs, 190 charts)

The rule-based generator is the one on `main` after Fusemania merged (with its reference priors and mines).
Step placement, F1 against the human charts with a ±20 ms tolerance:

| Difficulty | Learned (song's grid) | Learned (rule generator's grid) | Hybrid | Rule-based | Spectral flux on the grid |
| ---------- | --------------------- | ------------------------------- | ------ | ---------- | ------------------------- |
| Beginner   | **0.58**              | 0.47                            | 0.43   | 0.42       | 0.31                      |
| Easy       | **0.77**              | 0.61                            | 0.60   | 0.50       | 0.47                      |
| Medium     | **0.78**              | 0.66                            | 0.65   | 0.57       | 0.65                      |
| Hard       | **0.76**              | 0.73                            | 0.73   | 0.60       | 0.75                      |
| Challenge  | **0.70**              | 0.67                            | 0.67   | 0.59       | 0.72                      |

Beginner is compared with the rule generator's Easy. The middle columns are the fair end-to-end comparison: they use
the beat grid that `analyze.ts` estimates, as the rule generator does, so the gap is what the model knows about
_which_ moments to step on. Without beat-phase input the audio-only model reaches 0.71 overall (0.75 with it), and
plain spectral flux reaches 0.45. On these songs the learned rhythm is denser than the human charts on Hard and
Challenge (4.3 and 5.0 rows a second against 3.7 and 4.3); the Fuse charts fix the density instead (below).

Step selection: the GRU's perplexity is 3.85 against 4.90 for a per-difficulty bigram. Pattern statistics (means over
charts, shares of single steps):

| Difficulty | Chart      | 4-gram variety | Jacks | Crossovers | Up↔Down candles | Jumps |
| ---------- | ---------- | -------------- | ----- | ---------- | --------------- | ----- |
| Hard       | human      | 0.54           | 0.042 | 0.073      | 0.12            | 0.080 |
| Hard       | learned    | 0.42           | 0.051 | 0.118      | 0.17            | 0.048 |
| Hard       | rule-based | 0.73           | 0.027 | 0.061      | 0.15            | 0.075 |
| Hard       | hybrid     | 0.64           | 0.044 | 0.108      | 0.22            | 0.074 |
| Challenge  | human      | 0.58           | 0.034 | 0.086      | 0.15            | 0.074 |
| Challenge  | learned    | 0.45           | 0.060 | 0.132      | 0.19            | 0.076 |
| Challenge  | rule-based | 0.65           | 0.051 | 0.094      | 0.19            | 0.080 |
| Challenge  | hybrid     | 0.62           | 0.062 | 0.125      | 0.20            | 0.080 |

On Easy and Medium the learned arrows look like the human ones. On Hard and Challenge they are less varied and have
too many crossovers, so the game's ChartNet charts take the rule generator's arrows. With the learned (denser) rhythm
the rule generator's arrows cross over more than on its own rhythm; playtesting decides whether that matters.

## ChartNet v2

v2 learns the arrows too, and makes Hard and Challenge busier:

- **Placement** (`onset.py --density 1`): the same model, also told the density the chart should have (log steps per
  second). Asked for 6 steps a second it writes streams where the music carries them, not just more scattered
  steps. Told the human chart's density, its F1 is Easy 0.78, Medium 0.79, Hard 0.77 and Challenge 0.73.
- **Arrows** (`arrows.py`): a causal transformer over the last 64 rows. Each row it sees the previous arrows, the gaps
  to the neighbouring rows, the beat phase, the difficulty, the density, the audio, and where the feet are
  (`feet.py`). It chooses taps and freeze heads (80 tokens). It is trained on all four mirror images, in about
  4 minutes on MPS.
- **Foot flow**: sampling subtracts a per-difficulty penalty for crossovers, jacks, hands and stepping on a held
  panel, plus a small cost for repeating a four-row pattern from the last 32 rows (`CHARTNET_REPEAT`). Freeze tails
  end before the held panel is needed again.

On the held-out songs, with placement told the human chart's density (`gen2.py eval`). Crossovers are counted with the
better starting foot for every run of steps (`crossover_best_parity`); jacks and jumps are shares of steps:

| Difficulty | Chart      | F1   | Steps/s | 4-gram variety | Crossovers | Jacks | Jumps | Freezes |
| ---------- | ---------- | ---- | ------- | -------------- | ---------- | ----- | ----- | ------- |
| Hard       | human      |      | 3.73    | 0.54           | 0.078      | 0.042 | 0.080 | 0.022   |
| Hard       | v2         | 0.75 | 3.55    | 0.66           | 0.032      | 0.015 | 0.125 | 0.018   |
| Hard       | rule-based | 0.60 | 3.17    | 0.73           | 0.037      | 0.027 | 0.075 | 0.043   |
| Challenge  | human      |      | 4.30    | 0.58           | 0.068      | 0.034 | 0.074 | 0.065   |
| Challenge  | v2         | 0.69 | 4.08    | 0.67           | 0.040      | 0.025 | 0.137 | 0.052   |
| Challenge  | rule-based | 0.59 | 4.52    | 0.65           | 0.056      | 0.051 | 0.080 | 0.041   |

v2 is more varied than the human charts, with fewer crossovers and jacks, and somewhat more jumps. At human density
its runs of 16ths are short (longest 4.9 on average against 28.7 in the human Challenge charts); they come with
density, below.

## Fuse songs

Each song's charts keep its own header and timing (`bundle.ts`). The charts aim at
about the packs' 75th to 90th percentile of steps per second: Easy 1.8, Medium 2.8 and Hard 4.3; Challenge aims at 7.0, which these songs' tempos cap at about 12 steps a second
in 16th streams. Over the
20 songs (`gen2.py fuse`):

| Difficulty | Steps/s | 16th-stream share | Longest 16th run | 4-gram variety | Crossovers | Jacks | Jumps | Freezes |
| ---------- | ------- | ----------------- | ---------------- | -------------- | ---------- | ----- | ----- | ------- |
| Easy       | 1.68    | 0                 | 1                | 0.68           | 0.029      | 0     | 0.084 | 0.013   |
| Medium     | 2.57    | 0                 | 1                | 0.60           | 0.030      | 0.005 | 0.110 | 0.008   |
| Hard       | 3.96    | 0.14              | 5.9              | 0.44           | 0.038      | 0.023 | 0.077 | 0.010   |
| Challenge  | 6.43    | 0.68              | 37.5             | 0.35           | 0.028      | 0.023 | 0.059 | 0.021   |

The busiest two seconds of a Challenge chart reach a median of 9 steps a second (at most 10). Human Challenge charts in
the packs peak at a median of 7.5, 10.5 at the 90th percentile, and 15 at most.

These are the game's charts: `bundle.ts` writes them into `games/fusemania/charts/<id>.ssc` (credited `ChartNet`,
which `fusemania-charts.ts generate` leaves alone), and `gen.py fixup` keeps a one-second lead-in and ends a freeze
before any row that would need a third arrow. To rebuild: train (`onset.py --density 1 --name onset_dens`, `arrows.py`), then `gen2.py fuse` and
`pnpm exec tsx scripts/chartnet/bundle.ts $CHARTNET_WORK/out_fuse2`.

## ChartNet v3 (what the game offers now)

v3 is v2's two small models retrained on much more data, with sampling tuned against human charts.

- **Data.** 89 community packs from 2005 to 2016 (`community-packs.txt`, downloaded by `packs.py`) on top of the DDR
  and In The Groove packs: 3,417 songs and 11,028 charts, up from 480 and 1,950, and 2,959 Challenge charts where
  there were 182. The 48 DDR/ITG test songs are frozen in `$CHARTNET_WORK/test_keys.json`; `test2_keys.json` holds out
  128 community songs; a song held out in one pack is not trained on from another (`data.split`).
- **Training** runs on a rented GPU: all songs at once need about 18 GB of memory per run. `extract.py` (with
  `OMP_NUM_THREADS=1`: one thread per worker is 15 times faster than letting every worker thread), then
  `onset.py --phase 1 --density 1 --wide 1 --len 1000 --steps 12000 --name onset_v3` and
  `arrows.py --steps 24000 --name arrows_v3`. Scoring and generation run on the Mac and load only the songs they need.
- **Features.** `data.band_rhythm` adds the onset strength in 8 bands, bass to high melody, and each band's share of
  the onset energy over 4 seconds; `--wide 1` lets placement look about 5 seconds each way.
- **Sampling** (`arrows.generate`, `gen.place`): six candidate continuations per 16 rows, keeping the one the model
  likes best that repeats least; costs on jumps, freezes and jacks set so held-out charts land on human rates; the
  last 11% of a Challenge chart's steps prefer positions a sixteenth from a step already placed, so near-runs close
  up into streams; 24ths are placed by the model and kept only as runs.
- **Review notes** (`guidance.py`): a span and frequency band marked in the chart lab becomes steps on that band's
  onsets, placed before anything else.

What was measured, on the 48 held-out DDR/ITG songs (`gen2.py eval`, `gen2.py place-eval`):

| Held-out DDR/ITG charts     | Human | v2    | v3    |
| --------------------------- | ----- | ----- | ----- |
| Challenge: step timing F1   |       | 0.69  | 0.71  |
| Challenge: steps in streams | 0.25  | 0.12  | 0.25  |
| Challenge: longest 16th run | 28.7  | 4.9   | 11.9  |
| Challenge: jumps            | 0.074 | 0.137 | 0.087 |
| Challenge: freezes          | 0.065 | 0.052 | 0.079 |
| Challenge: jacks            | 0.034 | 0.025 | 0.028 |
| Hard: step timing F1        |       | 0.75  | 0.75  |
| Hard: jumps                 | 0.080 | 0.125 | 0.097 |
| Hard: freezes               | 0.022 | 0.018 | 0.022 |
| Hard: jacks                 | 0.042 | 0.015 | 0.034 |

Placement alone, told each human chart's step count: 0.737 overall for v2 and 0.742 for v3 (Challenge 0.691 and
0.729; the stream preference then trades 0.02 of that for the stream share). On the held-out community songs 0.750 and
0.765 (Challenge 0.794 and 0.823). What did not help: the band features (0.738 without, 0.742 with), the wider context
alone (0.740 without, 0.738 with), and a bigger arrow model (8 layers, d=384: best validation loss 1.06 against 1.04
for the small one, then it overfits). Data did: the arrow model's best validation loss is 1.19 on a quarter of the
songs, 1.10 on half and 1.04 on all of them.

Over the game's 36 songs (`gen2.py fuse`; a cover's Challenge aims at its original's density):

| Difficulty | Steps/s | 16th-stream share | 24th share | Longest 16th run | 4-gram variety | Jacks | Jumps | Freezes |
| ---------- | ------- | ----------------- | ---------- | ---------------- | -------------- | ----- | ----- | ------- |
| Easy       | 1.63    | 0                 | 0          | 1                | 0.62           | 0     | 0.034 | 0.037   |
| Medium     | 2.51    | 0                 | 0          | 1                | 0.58           | 0.003 | 0.073 | 0.040   |
| Hard       | 3.75    | 0.15              | 0.009      | 5.1              | 0.56           | 0.057 | 0.061 | 0.048   |
| Challenge  | 5.62    | 0.54              | 0.096      | 38.1             | 0.42           | 0.040 | 0.051 | 0.034   |

Human Challenge charts at 5.5 to 7.5 steps a second: 0.53 in 16th streams, 0.05 in 24ths, variety 0.42, jumps 0.05,
freezes 0.07. v2's Challenge charts for the same songs had variety 0.33.

Whole-chart variety (the share of distinct four-row patterns) falls as a chart gets denser, so compare it at equal
density: human Challenge charts score 0.58 at 4 to 5 steps a second and 0.42 at 5.5 to 7.5. `variety_w64` measures
it inside 64-row windows instead.

## Chart lab (reviewing charts against the music)

`games/fusemania/chart-lab.html`, served at `<base>fusemania/chart-lab.html?song=<id>` (live:
https://andeplane.github.io/fuse-games/fusemania/chart-lab.html?song=final-chase) and not linked from the game's menus.
Time runs down the page: the song's charts (arrows coloured by subdivision, StepMania style) beside the onset strength
ChartNet reads and a spectrogram, either constant-Q (24 bins an octave, each bin from the shortest FFT window that
resolves it, like a wavelet transform) or the 64 mel bands at a 2048 window that `features.py` feeds the model. It
plays the song with an assist tick on a chart's steps or on the beats, and edits taps (snapped, exported as `.ssc`).

Drag on the spectrogram to select a time span and a frequency band: the lab plots that band's onset flux (the
feature such a band would add) and counts each chart's steps by subdivision in the span. A selection becomes a review
note (`src/lab/notes.ts`, versioned JSON): kept in the browser, downloadable, copyable as text for a chat, or saved to
a file on every change (Chrome's file picker). `Load .ssc…` adds a candidate's charts (e.g. `gen2.py fuse` output)
beside the song's own for comparison. The DSP is `src/lab/spectrum.ts` and runs in a worker (about 8 s a song).

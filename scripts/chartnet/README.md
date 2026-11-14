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
generator's minimum gaps. The charts the game offers are a **hybrid**: that learned rhythm, with the rule generator's
arrows, jumps, freezes and mines (`generateCharts(analysis, placement)`, run by `hybrid.ts`).

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
$P scripts/chartnet/gen.py placement games/fusemania/charts/chartnet/placement.json   # learned rhythm for the Fuse songs
pnpm exec tsx scripts/chartnet/hybrid.ts  # → games/fusemania/charts/chartnet/<id>.ssc and the game's chartnet-data.ts
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

## Fuse songs

`games/fusemania/charts/chartnet/<id>.ssc` reuses each song's measured `#OFFSET`/`#BPMS`. Density is fixed at the packs'
median notes per second (Easy 1.5, Medium 2.3, Hard 3.2, Challenge 4.7), the model chooses where the steps go
(`placement.json`), and the rule generator adds the arrows. The game offers them after each song's own charts as
"Easy ChartNet" … "Challenge ChartNet"; the default chart is unchanged.

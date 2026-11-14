# ChartNet: a learned step-chart experiment for Fusemania

A time-boxed test of whether a model trained on the StepMania/ITG packs places steps better than the rule-based
generator in `scripts/lib/fusemania/generate.ts`. It follows Dance Dance Convolution (Donahue et al., 2017) in two stages:

1. **Step placement** (`onset.py`): per 10 ms frame, the probability of a step. Input: log-mel at three window sizes
   (3 × 64 bands), the song's beat phase (sin/cos at quarter, eighth and sixteenth), and the difficulty. A conv front end
   and a dilated residual stack (about ±1.3 s context). Trained on Apple MPS in about 20 minutes.
2. **Step selection** (`steps.py`): which arrows each row gets. A 2-layer GRU over rows, conditioned on the gap to the
   previous and next row, the beat-phase class, the difficulty and the audio at that row. Trained with the four mirror
   images of every chart. Holds, rolls and mines are not generated.

`gen.py` snaps the placed steps to the song's grid (16ths, triplets where the song swings), enforces the rule
generator's minimum gaps, and samples arrows.

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
$P scripts/chartnet/gen.py eval           # held-out songs: human vs learned vs rule-based
$P scripts/chartnet/gen.py fuse           # charts for the 20 Fuse songs → $CHARTNET_WORK/out_fuse
```

## Results (48 held-out pack songs, 190 charts)

Step placement, F1 against the human charts with a ±20 ms tolerance:

| Difficulty | Learned (song's grid) | Learned (rule generator's own grid) | Rule-based generator | Spectral flux on the grid |
| ---------- | --------------------- | ----------------------------------- | -------------------- | ------------------------- |
| Beginner   | **0.58**              | 0.47                                | 0.38 (its Easy)      | 0.31                      |
| Easy       | **0.77**              | 0.61                                | 0.47                 | 0.47                      |
| Medium     | **0.78**              | 0.66                                | 0.63                 | 0.65                      |
| Hard       | **0.76**              | 0.73                                | 0.69                 | 0.75                      |
| Challenge  | **0.70**              | 0.67                                | 0.62                 | 0.72                      |

The middle column is the fair end-to-end comparison: both use the beat grid that `analyze.ts` estimates, so the gap is
what the model knows about _which_ moments to step on. Without beat-phase input the audio-only model reaches 0.71
overall (0.75 with it), and plain spectral flux reaches 0.45.

Step selection: perplexity 3.85 against 4.90 for a per-difficulty bigram. Pattern statistics (means over charts):

| Difficulty | Chart      | 4-gram variety | Jacks | Crossovers | Up↔Down candles | Jumps |
| ---------- | ---------- | -------------- | ----- | ---------- | --------------- | ----- |
| Hard       | human      | 0.54           | 0.042 | 0.073      | 0.12            | 0.080 |
| Hard       | learned    | 0.42           | 0.051 | 0.118      | 0.17            | 0.048 |
| Hard       | rule-based | 0.53           | 0.004 | 0.086      | 0.23            | 0.098 |
| Challenge  | human      | 0.58           | 0.034 | 0.086      | 0.15            | 0.074 |
| Challenge  | learned    | 0.45           | 0.060 | 0.132      | 0.19            | 0.076 |
| Challenge  | rule-based | 0.24           | 0.003 | 0.074      | 0.27            | 0.055 |

On Easy and Medium the learned arrows look like the human ones (variety 0.68 to 0.74 against 0.68 to 0.70). On Hard
and Challenge they are less varied than human charts and have too many crossovers and jacks; the rule generator's
foot model keeps crossovers human-like but makes too many candles and, on Challenge, very repetitive patterns.

## Fuse songs

`games/fusemania/charts/chartnet/<id>.ssc` reuses each song's measured `#OFFSET`/`#BPMS`. Density is fixed at the packs'
median notes per second (Easy 1.5, Medium 2.3, Hard 3.2, Challenge 4.7) and the model chooses where the steps go.
Meters are placeholders (3, 6, 9, 11).

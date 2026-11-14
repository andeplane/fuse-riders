# Fusemania charts

Every piece of music in the Fuse portfolio is a Fusemania song with four generated charts: Easy, Medium, Hard and
Challenge. Nothing here is copied from an existing simfile; the charts are made from our own audio by
`scripts/fusemania-charts.ts`, using the conventions of StepMania and In The Groove packs as a guide to what a good
chart does.

| File                          | What it is                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `analysis/<id>.json`          | What the music does on its beat grid. Made from the audio; needs ffmpeg.          |
| `<id>.ssc`                    | The song's simfile: timing and four charts. Made from the analysis.               |
| `../src/engine/songs-data.ts` | Every `.ssc` and its audio URL, bundled for the game. Made from the `.ssc` files. |
| `reference-patterns.json`     | Statistics of published charts that generation aims at. See the last section.     |

All of them are committed, so the game builds without ffmpeg and a chart can be regenerated without the audio.

## Regenerating

```sh
pnpm exec tsx scripts/fusemania-charts.ts            # everything: analyze, generate, bundle, report
pnpm exec tsx scripts/fusemania-charts.ts analyze    # audio -> analysis/*.json (ffmpeg, about a minute)
pnpm exec tsx scripts/fusemania-charts.ts generate   # analysis -> *.ssc
pnpm exec tsx scripts/fusemania-charts.ts bundle     # *.ssc -> songs-data.ts
pnpm exec tsx scripts/fusemania-charts.ts report     # tempo, alignment and chart numbers per song
pnpm exec tsx scripts/fusemania-charts.ts compare    # the charts beside published charts' statistics
pnpm exec tsx --test games/fusemania/tests/charts.test.ts
```

`analyze`, `generate`, `report` and `compare` take song ids to narrow them (`... analyze match-day victory`). Generation is
deterministic: the same analysis gives the same file, and anything random is seeded from the song id and the
difficulty.

To add a song, add it to `scripts/lib/fusemania/songs.ts` (id, title, the file's place in the repository and its
URL on the site) and run the script.

## How a chart is made

**Analysis** (`scripts/lib/fusemania/analyze.ts`, `tempo.ts`, `metre.ts`). The audio is split into three bands and
onsets are picked from each with millisecond resolution, from zero-phase filters and a centred envelope so an
onset's time is its attack and not half a window later. The generated tracks are steady to the ear but not to the
millisecond (most speed up by a few tenths of a percent, a tenth of a second or more over a song), so the tempo is
followed rather than fitted once: the fastest steady pulse is tracked through the whole song, and the beat times
become as few constant-tempo `#BPMS` segments as stay within five milliseconds of them, changing only on bar
lines. The beat (how many pulses, which one) and the bar (kick on one and three, harmony changes, section changes,
the first sound of the song) are read from the whole song. Swung songs get a triplet grid: `slotsPerBeat` is 4 for
straight sixteenths, 3 or 6 for swing, and `levels` says which slots of a beat the song uses. The offset is then
settled on the mid and high bands' attacks.

The JSON holds, per grid slot, the onset strength in each band, new sustained pitches (melody and chords, with
where in pitch they are) and how much sound is sustained; per bar, loudness and how clear the pulse is; and
`quality`, the numbers to check before trusting a song:

- `align`: the share of strong onsets within 25 ms of a grid slot the charts may use, beside `chance`, what random
  onsets would score. Under about 0.7 the grid deserves a listen.
- `driftMs`: the worst median distance between onsets and the grid over any 25 seconds. Under 5 is good.
- `rampMs`: how far one constant tempo would have drifted, which is why a song has several `#BPMS`.
- `downbeat`: how clearly the chosen bar line beat the next candidate. Low means the bar may start on another
  beat (usually half a bar away); the steps are still on the beat.

**Generation** (`scripts/lib/fusemania/generate.ts`). All four charts come from the same analysis and each starts
from the easier one's rows, so Easy is the skeleton of Hard. A step only goes where the music has an onset. How
many a chart has is the published charts' median for its difficulty, a little fewer for a slow song and more for a
fast one; how many a bar gets follows its energy, so quiet sections thin out and busy ones fill in. Sixteenths
are kept to the busiest bars and off-beat eighths gather into runs. Accents (kick with snare or cymbal, bar lines,
phrase starts) become jumps and sustained notes become freezes, as many of each as published charts have. Arrows
are placed by a search over where the two feet are: feet alternate, no crossovers below Hard, a rising melody
moves right and a falling one left, and which arrow follows which is sampled from how often published charts step
it at that speed. A bar that repeats an earlier bar's rhythm sometimes gets its arrows or their mirror image.
Meters come from the measured density. `TUNING` at the top of the file holds the numbers for each difficulty;
`games/fusemania/tests/charts.test.ts` holds the limits every chart must keep.

## Editing a chart by hand

The `.ssc` files are ordinary StepMania simfiles, so a chart can be edited in a text editor or in StepMania's or
ArrowVortex's editor (put the `.ssc` beside its audio file, which `#MUSIC` names). Then:

```sh
pnpm exec tsx scripts/fusemania-charts.ts bundle
pnpm exec tsx --test games/fusemania/tests/charts.test.ts
```

`generate` overwrites the `.ssc` of every song it is given, so after a hand edit run it only for the other songs
(pass their ids), or the edit is lost. If a song's timing is wrong, fix the cause instead: correct `offset`, `bpms`
or the bar line in `analysis/<id>.json` (or the analysis code) and regenerate, so all four charts move together. A
song whose bar line is a beat late, for example, needs `offset` moved by one beat's length and its per-slot series
shifted by `slotsPerBeat` characters, which is easier done by fixing `metre.ts` and re-running `analyze`.

## Format notes

- `#OFFSET` is StepMania's: beat 0 is heard `-OFFSET` seconds into the audio. Beat 0 is the first bar line inside
  the file, so offsets are negative.
- Columns are Left, Down, Up, Right. `1` tap, `2` freeze head, `3` freeze tail, `M` mine (Hard and Challenge, a few).
- A measure is four beats and is written with the fewest rows that hold its notes: 4, 8 or 16 on a straight grid,
  12 or 24 where the song swings.
- Browsers and ffmpeg both drop an MP3's or Opus file's priming samples, so times measured by the analysis are the
  times `decodeAudioData` gives. A player that does not (some `<audio>` paths on Safari) hears MP3s about 25 ms
  late; that belongs in the game's audio calibration, not in the charts.

## Measured against real charts

`reference-patterns.json` holds statistics measured over 480 published simfiles (DDR 1st to Extreme, In The Groove
1 and 2; 1,950 charts), by family and difficulty. It holds rates and frequencies only: how many notes a second, the
share of quarters, eighths and sixteenths, how many jumps and freezes and where they fall, and how often each
two- and three-arrow pattern occurs at each speed. No chart content is in it and none is used: the generator
samples from those frequencies, on rhythms taken from our own audio.

The In The Groove buckets (`itg:easy` to `itg:challenge`) are the model. `scripts/lib/fusemania/reference.ts` reads
the file, `generate.ts` aims at it and `compare.ts` measures the generated charts the same way, so
`fusemania-charts.ts compare` prints the gap as numbers. Our grid is read by what a slot is in the song, so a swung
off-beat counts as an eighth; a gap between rows is read by its length in beats.

Each cell is In The Groove / our charts before tuning against the reference / our charts now. Per-chart numbers
are medians; shares are pooled over the 20 charts of a difficulty.

| Statistic                              | Easy               | Medium             | Hard               | Challenge          |
| -------------------------------------- | ------------------ | ------------------ | ------------------ | ------------------ |
| Notes per second                       | 1.50 / 1.38 / 1.49 | 2.28 / 2.78 / 2.29 | 3.22 / 4.69 / 3.28 | 4.71 / 6.69 / 4.74 |
| Most notes in one second               | 3 / 4 / 4          | 5 / 5 / 5          | 6 / 7 / 7          | 9 / 9 / 9          |
| Rows on quarters, %                    | 96 / 100 / 100     | 77 / 78 / 80       | 55 / 49 / 58       | 42 / 33 / 44       |
| Rows on eighths, %                     | 4 / 0 / 0          | 21 / 22 / 20       | 34 / 42 / 32       | 33 / 32 / 33       |
| Rows on sixteenths, %                  | 0 / 0 / 0          | 1 / 0 / 0          | 10 / 9 / 10        | 22 / 34 / 22       |
| Longest run of eighths, rows           | none               | 5 / 5 / 5          | 17 / 49 / 8        | 62 / 6 / 33        |
| Rows in sixteenth streams, %           | 0 / 0 / 0          | 0 / 0 / 0          | 0 / 0 / 1          | 14 / 48 / 18       |
| Rows that are jumps, %                 | 7 / 5 / 7          | 9 / 9 / 9          | 7 / 10 / 7         | 8 / 6 / 8          |
| Jumps on the bar's first beat, %       | 48 / 88 / 57       | 32 / 80 / 34       | 24 / 69 / 26       | 22 / 48 / 22       |
| Jumps off the beat, %                  | 2 / 0 / 0          | 9 / 0 / 9          | 24 / 9 / 25        | 30 / 12 / 29       |
| Notes that are freezes, %              | 3 / 4 / 3          | 5 / 4 / 5          | 4 / 2 / 4          | 6 / 0 / 2          |
| Freezes over two beats, %              | 34 / 2 / 32        | 27 / 0 / 23        | 19 / 2 / 15        | 11 / 2 / 16        |
| Mines                                  | 0 / 0 / 0          | 0 / 0 / 0          | 0 / 0 / 4          | 12 / 1 / 12        |
| Same arrow twice on quarters, %        | 27 / 0 / 22        | 17 / 1 / 20        | 14 / 0 / 15        | 16 / 0 / 21        |
| Same arrow twice on eighths, %         | 6 / none / none    | 7 / 0 / 4          | 7 / 0 / 5          | 12 / 1 / 13        |
| Same arrow twice on sixteenths, %      | none               | none               | 0 / 0 / 0          | 0 / 0 / 0          |
| Drills among sixteenth patterns, %     | none               | none               | 77 / 16 / 93       | 40 / 17 / 45       |
| Bar repeats the rhythm two back, %     | 48 / 60 / 54       | 34 / 36 / 36       | 29 / 29 / 24       | 30 / 14 / 20       |
| Bar repeats the arrows two back, %     | 5 / 20 / 4         | 2 / 6 / 2          | 1 / 3 / 1          | 1 / 2 / 0          |
| Three-arrow patterns on eighths, apart | 0.57 / 0.16 (4ths) | 0.54 / 0.15        | 0.40 / 0.14        | 0.53 / 0.11        |

The last row is the distance between our distribution of three-arrow patterns and the reference's (before / now):
0 is the same, 1 nothing in common. What does not match, and why:

- Easy has no off-beat eighths at all (published Easy charts have 4%), so a beginner's chart stays on the beat.
- Runs of eighths on Hard and Challenge are about half as long as published ones. At the reference's density the
  generator spreads its eighths over more bars where a charter gathers them into fewer, longer runs.
- Easy has one note more in its busiest second (a jump followed by two quarters).
- Challenge has a third as many freezes: a freeze is not held through sixteenths, and Challenge is full of them.
- Jumps are never on a sixteenth (4 to 6% of published jumps are).
- Every Hard chart gets four mines; half of the published ones have none and a quarter have ten or more.

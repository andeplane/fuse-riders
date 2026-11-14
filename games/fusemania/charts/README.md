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

All three are committed, so the game builds without ffmpeg and a chart can be regenerated without the audio.

## Regenerating

```sh
pnpm exec tsx scripts/fusemania-charts.ts            # everything: analyze, generate, bundle, report
pnpm exec tsx scripts/fusemania-charts.ts analyze    # audio -> analysis/*.json (ffmpeg, about a minute)
pnpm exec tsx scripts/fusemania-charts.ts generate   # analysis -> *.ssc
pnpm exec tsx scripts/fusemania-charts.ts bundle     # *.ssc -> songs-data.ts
pnpm exec tsx scripts/fusemania-charts.ts report     # tempo, alignment and chart numbers per song
pnpm exec tsx --test games/fusemania/tests/charts.test.ts
```

`analyze`, `generate` and `report` take song ids to narrow them (`... analyze match-day victory`). Generation is
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
from the easier one's rows, so Easy is the skeleton of Hard. A step only goes where the music has an onset; how
many a bar gets follows its energy, up to a ceiling per difficulty. Accents (kick with snare or cymbal, bar lines,
phrase starts) become jumps and sustained notes become freezes. Arrows are placed by a search over where the two
feet are: feet alternate, no crossovers or candles below Hard, a rising melody moves right and a falling one left,
the four arrows are used evenly, and a bar that repeats an earlier bar of the phrase gets that bar's arrows or
their mirror image. Meters come from the measured density. `TUNING` at the top of the file holds the numbers for
each difficulty; `games/fusemania/tests/charts.test.ts` holds the limits every chart must keep.

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
- Columns are Left, Down, Up, Right. `1` tap, `2` freeze head, `3` freeze tail, `M` mine (Challenge only, a few).
- A measure is four beats and is written with the fewest rows that hold its notes: 4, 8 or 16 on a straight grid,
  12 or 24 where the song swings.
- Browsers and ffmpeg both drop an MP3's or Opus file's priming samples, so times measured by the analysis are the
  times `decodeAudioData` gives. A player that does not (some `<audio>` paths on Safari) hears MP3s about 25 ms
  late; that belongs in the game's audio calibration, not in the charts.

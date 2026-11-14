# Fusemania

Fusemania is a four-arrow rhythm game for one to five players, in the tradition of StepMania and In The Groove. Arrows scroll to four targets; **hit each one as it reaches its target, on the beat**. Hold the long ones to their end, tap the zig-zag ones repeatedly (rolls), keep off the mines. The songs are the whole Fuse soundtrack, twenty tracks, each with Easy, Medium, Hard and Challenge charts. The name, the art and every chart are this project's own.

Charts are ordinary StepMania simfiles. The bundled ones are the `.ssc` files in `charts/`, and a player can load any 4-panel (`dance-single`) `.sm` or `.ssc` with its music for a solo run.

## Run it

```sh
pnpm install
pnpm dev          # builds, then serves every game; open the printed URL plus /fusemania/
```

`pnpm exec tsx service/dev.ts --port 8890` serves an existing `dist/` and walks to the next free port if that one is taken. Open `/fusemania/?mute` (silent: nothing is stored, and the arrows follow the room's clock) or `/fusemania/` to hear it, and pick one of:

- **Play, Single player**: the song select. Pick a song, a level and a mode, then **PLAY**. The result shows the grade, the score, every judgment count and this browser's best on that chart. **PLAY YOUR OWN STEPMANIA FILE** takes a simfile and its music from this device; nothing is uploaded.
- **Play, Host room**: a room with a QR invite, for up to five players. The host picks the song and the mode; every player picks their own level. **+ ADD AI RIVAL** seats a bot. Tick **Shared TV** first to play on one screen: the TV shows every field and each phone becomes four pads.
- **Settings**: keys, scroll speed and direction, the two timing offsets and **CALIBRATE**.

## Controls

| Control       | Keyboard (default)  | Touch    |
| ------------- | ------------------- | -------- |
| Left          | A, J or Left        | **←**    |
| Down          | S, K or Down        | **↓**    |
| Up            | W, I or Up          | **↑**    |
| Right         | D, L or Right       | **→**    |
| Throw an item | Space (battle only) | **ITEM** |

Every key can be changed in Settings, up to four keys an arrow. WASD and IJKL are both the arrows so two hands can share the work; a second key on an arrow that is already down counts as a new step.

## Judging and scoring

A step is judged by how far the press is from the note: Marvelous within 22 ms, Perfect 45, Great 90, Good 135, Boo 180, otherwise a Miss. The combo counts Marvelous to Good. The score is a rating out of 1,000,000: the share of the chart's best possible points, so players on different levels compare. Grades run D to AAAA.

## Battle mode

Every few seconds one arrow glows. Hitting it puts a power-up in your slot, better ones the further behind you are; Space throws it.

| Power-up                                                       | What it does                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| Drunk, Wave, Boomerang, Tornado, Hidden, Flip, Turbo, Blackout | Bends, hides or rearranges every rival's arrows for a while |
| Mines                                                          | Turns a third of every rival's arrows into mines            |
| Lag                                                            | Every rival's arrows arrive late, as on a slow connection   |
| Double                                                         | Your points count twice for a while                         |
| Star                                                           | Plays your arrows for you, perfectly, for a few seconds     |
| Shield                                                         | Blocks the next attack thrown at you                        |

An attack takes hold a moment after it is thrown, so a rival sees it coming.

## Timing

This is the part a rhythm game lives on, and it is built so that the sound, the picture and the judge agree:

- The song is a decoded buffer on the Web Audio clock (`fuse-ui/game-audio`'s `loadSong` and `clock`), started at an exact clock time. `src/app/song-clock.ts` turns `performance.now()` into the song position being heard, with the output latency taken off, and the arrows are drawn from that every frame. Nothing depends on frame times adding up.
- A key is stamped with the song time the device heard when it went down (`event.timeStamp` through the song clock) and travels in the room's log with that time. The fold judges it at that time, not at the 50 ms room tick it lands in, so a judgment is the same on every device and after a rollback.
- The local screen plays this device's own unfolded keys ahead on a copy of the world (`forecast`), so a press flashes at once and the fold changes nothing it showed.
- Two offsets in Settings: the input offset (taken off every press; Bluetooth audio, a slow keyboard) and the visual offset (the picture ahead of or behind the sound). **CALIBRATE** plays a click and measures the taps.

In a room the audio follows the room's shared clock, so everyone hears the same beat at the same room time; a device that is not making sound (a phone used as a pad for the shared TV) stamps its taps with the room clock.

## Charts

`scripts/fusemania-charts.ts` analyses each song's audio (onsets, tempo map, bar lines) and writes the four charts; see `charts/README.md` for the method, the conventions it follows and how to regenerate. The engine reads them from the generated `src/engine/songs-data.ts`. A change to a bundled chart changes what every device folds, so it comes with a bump of `RULES` in `src/engine/index.ts`.

## Layout

| Path          | What it is                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine/` | Deterministic rules, no imports from outside: simfile parser and writer, tempo map, compiled steps, judging, holds, mines, items, bots, the world |
| `src/online/` | The game behind `RollbackGame` (`game.ts`), the runtime that logs stamped keys and forecasts (`runtime.ts`), results                              |
| `src/render/` | Canvas 2D note field, judgment bursts, mods and the ranking board; reads only `engine/view.ts` and `view-kit.ts`                                  |
| `src/app/`    | The page: menu, song select, settings, song clock, calibration, presenter, sounds                                                                 |
| `charts/`     | The bundled `.ssc` charts and the analysis they were generated from                                                                               |
| `tests/`      | Engine, room fold and checkpoint, two devices over a lossy mesh, presenter, panels, song clock, renderer                                          |

## Debugging

On a room or solo page, `fusemania.clock()` in the console reports where the sound, the room and the picture are (`audible`, `driftMs`, `heardMs`, `roomMs`, `latencyMs`). A healthy page has `driftMs` within a millisecond or two.

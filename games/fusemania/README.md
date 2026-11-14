# Fusemania

Fusemania is a four-arrow rhythm game for one to five players, in the tradition of StepMania and In The Groove. Arrows scroll to four targets; **hit each one as it reaches its target, on the beat**. Hold the long ones to their end, tap the zig-zag ones repeatedly (rolls), keep off the mines. The songs are the whole Fuse soundtrack, twenty tracks, each with Easy, Medium, Hard and Challenge charts. The name, the art and every chart are this project's own.

Charts are ordinary StepMania simfiles. The bundled ones are the `.ssc` files in `charts/`, and a player can load any 4-panel (`dance-single`) `.sm` or `.ssc` with its music for a solo run.

## Run it

```sh
pnpm install
pnpm dev          # builds, then serves every game; open the printed URL plus /fusemania/
```

`pnpm exec tsx service/dev.ts --port 8890` serves an existing `dist/` and walks to the next free port if that one is taken. Open `/fusemania/?mute` (silent: no sound and no sound preference is stored, and the arrows follow the room's clock) or `/fusemania/` to hear it, and pick one of:

- **Play, Single player**: the song select. Pick a song (or press **RANDOM SONG**), a level and a mode, then **PLAY**. The result shows the grade, the score, every judgment count and this browser's best on that chart. **PLAY YOUR OWN STEPMANIA FILE** takes a simfile and its music from this device; nothing is uploaded.
- **Play, Host room**: a room with a QR invite, for up to five players. The players and their Join buttons are on top. Under them the host has the song select, the mode and the session; every other player sees the chosen song as one card (cover, tempo, mode, session) and picks only their own level and speed. **+ ADD AI RIVAL** seats a bot. Tick **Shared TV** first to play on one screen: the TV shows every field and each phone becomes four pads.
- **Settings**: keys, scroll speed and direction, the three timing offsets (audio, input, visual) and **CALIBRATE**.

**The song select** is a carousel of covers, the selected song in the middle. Left/Right (A/D, J/L), a swipe, a sideways scroll, the arrows at its sides or a click on a cover turn it; Up/Down (W/S, I/K) change the level; PageUp/PageDown or a pack's tab jump to another pack. Songs are grouped in **packs** (`src/app/packs.ts`), shown in pack order with a tab each: FUSEMANIA is the Fuse soundtrack, and DDR JAZZ MIX and ITG JAZZ MIX have their place in the order and appear when their first song is added (see "Adding a song" in `charts/README.md`). Each bundled song has a cover image in `public/music/covers/<id>.jpg`; a song without one, and a player's own simfile, wears a cover drawn from its id.

**The other players' fields.** With more than one player, a device shows every field: its own lit and framed in the player's colour (in the middle of three or five players, on the left of two or four) and the others' smaller beside it, so an attack can be seen landing. Their judgments, combos, attacks and power-ups are shown as they are, but their arrows are not there to be read: every column is drawn in another column's place, the same shuffle for every opponent, changing from match to match (`src/render/scramble.ts`). It is only the picture; the Shared TV and a watcher see every field as it is.

**Your speed.** The song select shows every player's own speed as chips (0.5x, 1x, 1.5x, 2x, 2.5x, 3x, 4x, 5x), and the Settings slider reaches the values between. It is saved on the device and only spreads that player's arrows apart on their own screen: the engine never sees it, so the beat, the judging and every other player are unchanged.

## Sessions

In a room the host can play several songs as one contest: **SONGS** sets a session of 3, 5 or 10 (1 is a single song), and **NEXT SONG** says who chooses them. With **HOST PICKS** the result's button leads back to the song select for the next one; with **RANDOM** the room draws every song when it starts, from the match's id so every device draws the same one, and never a song the session has already played while there is another.

Every finished song adds each rider's rating to their session total, and the winner gets a win. The total runs in the leaderboard boxes during a song, the standings show on every result and in the lobby between songs, and the last song ends on the final standings: most points, then most songs won. A song that is given up is not counted, a rider who joins in the middle starts from zero, and one who leaves keeps their row. Changing the number of songs in the middle starts a new session. The session is part of the room's state (`session` in `src/online/game.ts`) and travels in its checkpoint.

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

Every few seconds one arrow glows. Hitting it puts a power-up in your slot; Space throws it.

The drops rubber-band on the score. Each power-up has a power from 1 to 10 (`ITEM_POWER` in `src/engine/rules.ts`): for an attack, how hard it is to keep playing through (Flip 10, Blackout 8, Mines and Lag 7, down to Wave 2); for your own items, how much they are worth (Star 9, Double 8, Shield 2); Fade is 6 and Ping-pong 3. A rider behind the others draws the high-power ones more often and a rider ahead the low-power ones, in proportion to the gap: your rating against the others' average, as a share of the best rating, with 20% counting as a full gap. At a full gap Flip is about one drop in 170 for the leader and one in 9 for the rider behind; level riders get the plain `ITEM_BASE` table. `ITEM_BASE`, `ITEM_POWER`, `ITEM_TILT`, `ITEM_GAP_FULL_PCT` and `ITEM_GAP_FLOOR` are the knobs.

| Power-up                                                       | What it does                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| Drunk, Wave, Boomerang, Tornado, Hidden, Flip, Turbo, Blackout | Bends, hides or rearranges every rival's arrows for a while |
| Mines                                                          | Turns a third of every rival's arrows into mines            |
| Lag                                                            | Every rival's arrows arrive late, as on a slow connection   |
| Double                                                         | Your points count twice for a while                         |
| Star                                                           | Plays your arrows for you, perfectly, for a few seconds     |
| Shield                                                         | Blocks the next attack thrown at you                        |
| Fade                                                           | One rival's music fades away for five to ten seconds        |
| Ping-pong                                                      | One rival's music bounces from ear to ear on the beat       |

An attack takes hold a moment after it is thrown, so a rival sees it coming.

Fade and Ping-pong go for the ears, and land on one rival picked by the match's seed (a rider before a bot, the same one on every device). They change only how loud that rival's own device plays the song in each ear (`src/app/song-fx.ts`, through `ClockedSong.shape`): nothing is delayed or filtered, so the clock, the arrows and the judging are untouched. A fade leaves a trace of the song (4%) and Ping-pong is turned down as it swings, so neither is ever louder than the song. On a shared screen the one song is everybody's, so they do nothing there.

## Timing

This is the part a rhythm game lives on, and it is built so that the sound, the picture and the judge agree:

- The song is a decoded buffer on the Web Audio clock (`fuse-ui/game-audio`'s `loadSong` and `clock`), started at an exact clock time. `src/app/song-clock.ts` turns `performance.now()` into the song position being heard, from the browser's own pairing of a sample with the page-clock time it leaves the device (`getOutputTimestamp`), or from the stepped clock with the reported output latency taken off where there is none. The arrows are drawn from that every frame, one display refresh ahead, since that is the soonest a frame's pixels show. Nothing depends on frame times adding up.
- A key is stamped with the song time the device heard when it went down (`event.timeStamp` through the song clock) and travels in the room's log with that time. The fold judges it at that time, not at the 50 ms room tick it lands in, so a judgment is the same on every device and after a rollback.
- The local screen plays this device's own unfolded keys ahead on a copy of the world (`forecast`), so a press flashes at once and the fold changes nothing it showed.
- Three offsets in Settings: the audio offset (sound that arrives later than the browser knows: Bluetooth, a TV; it moves the arrows and the judging together), the input offset (taken off every press: a slow keyboard, a habit of tapping early; at most 150 ms, so a press stays inside the bounds of the tick it is logged for) and the visual offset (the picture ahead of or behind the sound). **CALIBRATE** plays a click, measures the taps and puts a large lag into the audio offset and a small one into the input offset.

In a room the audio follows the room's shared clock, so everyone hears the same beat at the same room time (a device is pulled back when it drifts more than 120 ms from the room, and its own presses are judged against what it heard either way); a device that is not making sound (a phone used as a pad for the shared TV) stamps its taps with the room clock.

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

On a room or solo page, `fusemania.clock()` in the console reports where the sound, the room and the picture are (`audible`, `driftMs`, `heardMs`, `roomMs`, `latencyMs`). A healthy page has `driftMs` within a few milliseconds, or a steady 10 to 20 where the audio device was still settling when the song started; it is the song against the room clock and no judgment depends on it.

`/fusemania/?debugtiming` is the timing lab: a panel with every press from the browser's stamp to its judgment, hit-error histograms by ear and by eye, the three offsets as live knobs, steady click tracks at 2, 2.5 and 3 ticks a second, and a microphone mode that hears the tick and the key and tells the device's lag from the player's. On a local dev server the whole session is written to `timing-logs/fusemania-<session>.jsonl`; elsewhere **SAVE LOG** downloads it. `LATENCY.md` explains every figure and what a page cannot measure.

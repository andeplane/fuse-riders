# Elasto Fuse

Elasto Fuse is a side-view motorbike trials game for one to five riders. The bike is a frame on two sprung wheels with a rider on top, and it rides over polygon terrain: **eat every apple, then touch the flower**. If the rider's head touches the ground the run is over and starts again at the start. The original Elasto Mania campaign is first, in its canonical 54-level order starting with Warm Up, followed by 503 external tracks. The name and art are this project's own.

Riders share a track and a clock but never touch: everyone else is a translucent ghost, and each rider has their own apples. The first rider home wins the race, and the others then have 30 seconds to finish. Choose a starting level beside Play Solo. In the multiplayer lobby, the host chooses **3, 5 or 10 levels**, either **In order** from a selected starting level or **Random**. Consecutive matches wrap to Warm Up after the final external track. Random matches draw distinct tracks from the full list, and every rider plays the same sequence. A rematch draws a new random sequence. Points for each place (10, 7, 5, 3, 2) accumulate across the match, with standings between races.

The random sequence is a pure function of the frozen match settings and logged match ID. Both are checkpointed, so rollback and reconnect recover the same order without a mutable random generator outside the authoritative state. The settings contract changed with `elasto-fuse-4`, and the play entries and the checkpoint with `elasto-fuse-5`; clients must use matching rules when joining a room.

The campaign geometry is extracted from an original `Elma.res` using `pnpm exec tsx scripts/elasto-fuse-campaign.ts /path/to/Elma.res`, then formatted with Prettier. The importer follows the original `QOPEN.CPP` resource table and `TOPOL.CPP` internal level layout, keeps gravity apples, and excludes decorative grass polygons. The external POT06 files are separate tracks, not the built-in campaign. Source resource files are not committed.

## Run it

```sh
pnpm install
pnpm dev          # builds, then serves every game; open the printed URL plus /elasto-fuse/
```

`pnpm exec tsx service/dev.ts --port 8890` serves an existing `dist/` and walks to the next free port if that one is taken. Open `/elasto-fuse/?mute` and pick one of:

- **PLAY SOLO**: a time trial on the map picked below the button (the last one ridden is remembered). The result shows the time and the best for that map, kept in this browser; **NEXT MAP** is the main button after a map ridden home and goes on to the next level (so does Enter), **RETRY** rides it again (so does R), **MENU** goes back.
- **CREATE ROOM**: a room with a QR invite. Others join by the code or the link; the creator picks **TOUR · ALL 12 MAPS** or one map and starts, alone or with up to four friends. Tick **Shared TV** first to play on one screen: **OPEN TV SCREEN** opens `?room=CODE&display=1`, which shows every rider in a pane of their own, and every phone becomes a full-screen controller.

`?mute` opens the page without sound and stores nothing; use it for previews.

## Controls

| Control                                        | Keyboard   | Gamepad           | Touch       |
| ---------------------------------------------- | ---------- | ----------------- | ----------- |
| Gas                                            | Up or W    | A or RT           | **GAS**     |
| Brake                                          | Down or S  | B or LT           | **BRAKE**   |
| Volt left (rotates the bike counter-clockwise) | Left or A  | LB or d-pad left  | **⟲**       |
| Volt right                                     | Right or D | RB or d-pad right | **⟳**       |
| Turn around                                    | Space      | X                 | **TURN**    |
| Restart at the start                           | Enter or R | Y                 | **RESTART** |

The gas drives the rear wheel, and full gas from a standstill lifts the front: feather it, and use the volts to level the bike in the air. On a phone the buttons sit under the picture (or over its bottom corners when the phone is on its side): volts and TURN for the left thumb, BRAKE and GAS for the right, a small RESTART on top. **MENU** keeps the controls at hand during a race; it does not pause a shared race.

## Layout

| Path                                                          | What it is                                                                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/engine/`                                                 | The deterministic rules: the bike's physics, the levels, a race (`world.ts`) and the view the presentation reads (`view.ts`, `view-kit.ts`). It imports nothing outside itself |
| `src/online/game.ts`                                          | `elastoFuseGame`, the `RollbackGame` the netcode runs: seats, the lobby's level choice, a race or the tour, standings, the checkpoint                                          |
| `src/online/runtime.ts`                                       | The room runtime plus this device's held controls and its own bike's clock (`flush`, `localRide`)                                                                              |
| `src/online/result.ts`                                        | Match results for the backend                                                                                                                                                  |
| `src/basics.ts`                                               | Constants and id rules with no imports, for the service                                                                                                                        |
| `src/platform.ts`                                             | The `GameRegistration` for `fuse-platform` (exported as `elasto-fuse/platform`)                                                                                                |
| `src/render/scene.ts`                                         | The Canvas 2D scene: one pane per followed rider, each with its camera. It reads only the engine's view contract                                                               |
| `src/render/terrain.ts`                                       | Ground and sky: the pane is filled with ground, clipped to the level's polygons with the even-odd rule and painted with sky, then edged                                        |
| `src/render/bike.ts`                                          | A bike and its rider: wheels, frame, suspension struts, and limbs by two-bone IK; sprites when loaded, neon line art otherwise                                                 |
| `src/render/objects.ts`                                       | Apples (with a gravity arrow), the flower and the killers                                                                                                                      |
| `src/render/camera.ts`                                        | Pane layout, zoom and the camera's placement rule                                                                                                                              |
| `src/render/cues.ts`                                          | What happened between two views (apple, crash, finish, countdown), for effects and sounds                                                                                      |
| `src/render/hud.ts`                                           | The words on a pane: clock, apples, place, closing countdown, banner                                                                                                           |
| `src/render/effects.ts`, `smooth.ts`, `tint.ts`, `palette.ts` | Sparks, ghost smoothing after a rollback, per-slot hue turning of the sprites, colours                                                                                         |
| `src/app/main.ts`                                             | The page: landing, lobby, race, table and result screens on `fuse-ui`, analytics, the frame loop                                                                               |
| `src/app/presenter.ts`                                        | One frame to what the page shows; pure                                                                                                                                         |
| `src/app/forward.ts`                                          | Plays every bike on a copy to its own clock: this device's to its own, the others as eased ghosts                                                                              |
| `src/app/controls.ts`, `gamepad.ts`                           | Keys, touch buttons and gamepads as held control bits                                                                                                                          |
| `src/app/audio.ts`                                            | WebAudio: the engine's hum and the cue sounds; silent with `?mute`                                                                                                             |
| `src/app/art.ts`                                              | The art manifest and loader (`public/games/elasto-fuse/art/v1/`, see `docs/design/elasto-fuse-art.md`)                                                                         |
| `src/app/session.ts`, `reports.ts`                            | The page's session from its query, safe storage, solo best times; result reports to the room service                                                                           |
| `tests/`                                                      | Engine, room, runtime and platform tests, plus `app-*.test.ts` and `render.test.ts` for the page and the renderer                                                              |

## Every rider on its own clock

Riders never touch, so a rider's bike does not run on the room's shared clock. A device runs its own bike on its own clock, started once from the room's countdown and never corrected by the network. It logs a `PLAY` entry (`[bits, at, round]`: the held bits from step `at` of its own clock, in race `round`) when the bits change, and once a tick to say how far the bike has run. The fold advances each rider to `at` with what it held until then (`advanceRider`), so the room computes exactly the ride the rider saw, on every device, from the log alone. The screen draws this device's bike from the room's copy played on with its not-yet-folded entries (`localRide`, `project`), and the other riders a few steps past the last word of them on an eased clock (`createGhosts`). A rider's finish time is its own steps. Do not put a rider back on the room's clock: a follower's clock is slewed, and that moved the bike under the rider's hands.

## Presentation rules

- Everything drawn comes from the view (`WorldView`), never from events: a rollback that changes an outcome changes the picture. Effects and sounds are read off the difference between two views.
- The renderer imports only `engine/view.ts` and `engine/view-kit.ts` (`tests/architecture.test.ts`). What is drawn where the rules collide (wheel, head and object radii, the level's polygons) comes from `view-kit.ts`, so what you see is what plays.
- The camera shows about 17 world units across on a desktop and fewer on a phone, with the bike level with the pane's middle and 15% of its width from the edge behind it, sliding across on a turn-around.
- Each roster slot has its own colour (cyan, pink, gold, green, violet). The sprites are painted with a cyan accent and turned to the slot's hue on an offscreen canvas at load.

## Tests

```sh
pnpm exec tsx --test games/elasto-fuse/tests/app-controls.test.ts   # keys, touch buttons, gamepads
pnpm exec tsx --test games/elasto-fuse/tests/app-screen.test.ts     # forward run, presenter, session, art, sound
pnpm exec tsx --test games/elasto-fuse/tests/app-reports.test.ts    # result reports
pnpm exec tsx --test games/elasto-fuse/tests/render.test.ts         # cues, HUD, camera, IK, tinting
```

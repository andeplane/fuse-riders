# The render boundary (issue #254)

Rendering depends on one thing the engine publishes, the `WorldView`, and on nothing else of the game. It never imports engine rules and never imports network code. A rule value the renderer needs travels as data in the view.

```
src/engine/view.ts       WorldView, RiderView, ViewRules, GameEvent + toView(state)   the contract
src/engine/view-kit.ts   the few pure kernels presentation runs itself                 the only other door
src/render/**            imports those two, other src/render/ files, and npm packages. Nothing else.
```

`tests/layer-boundaries.test.ts` enforces it from the import graph. `src/render/` has no entry in `tests/fixtures/layer-allowlist.json` and the test refuses one: a new edge from a render file to `engine/tuning`, `shared/`, `online/` or `client/` fails, and so does adding an exception for it.

All of #254 is `[hash-identical]`: `RULES` is main's `fuse-p2p-34` and the golden fixtures are main's, untouched.

## What is on the wire, and what is derived

The view is derived. `toView(state.game)` is called locally by whoever wants a picture (the rollback `World` for its two newest ticks, tests, scripts). Peers exchange log entries and, for a joiner, a checkpoint of `RoomState` through `src/engine/codec/checkpoint.ts`; the replica hash (`hashRoomState`) is over `RoomState`. Neither contains a view, and nothing serialises one (the match report picks named statistics out of it). So adding a derived field to the view is not a protocol change, needs no checkpoint guard and cannot move the golden. It would become one the day a view is sent to a peer; do not do that, send state.

`tests/view-contract.test.ts` replays the golden recording and shows two things: with the fields added by #254 taken off again, the view equals what `toSnapshot` produced before (a verbatim copy of that function is kept in `tests/fixtures/legacy-snapshot.ts` for the comparison); and each added field equals the rule it states.

## What `WorldView` carries

Everything it did as `GameSnapshot` plus the `tick` and `round` the rollback world used to spread on top (`ViewSnapshot`), and:

| Field                                                               | States                                                                                                            | Replaced in the renderer                                                                                                                                                                                                          |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rules.tickHz`                                                      | Ticks per second                                                                                                  | `TICK_HZ` in the self-locator's fade                                                                                                                                                                                              |
| `rules.blastVisibleTicks`                                           | How long a blast stays in `blasts`                                                                                | `BLAST_VISIBLE_TICKS` in the blast animation's age and in the debris' "is this blast new"                                                                                                                                         |
| `rules.trailWidth`                                                  | The width a trail collides and burns at                                                                           | `TRAIL_WIDTH` in the debris' burn test                                                                                                                                                                                            |
| `players[].speed`                                                   | World units the rider covers on the next tick: ramp, every Nitro and Snail in force on that tick, aiming slowdown | `RIDER_SPEED * riderSpeedMultiplier(drawing tick) * SPEED_RAMP_MAX / TICK_HZ` as the trail tip's cap, which dropped the tip whenever a Snail ended on the next tick and would have again for any speed effect it had not heard of |
| `players[].turn`                                                    | Radians the rider may turn on the next tick                                                                       | `riderMotionStep` called by the local rider's lead                                                                                                                                                                                |
| `players[].nextVolleyAngles`                                        | Where the next volley's bombs go, as offsets from the heading                                                     | `volleyAngles(angle, bombsPerShot(rider))`. Offsets, because presentation turns the rider between ticks: `angle + offset` is bit-identical to what the scene computed                                                             |
| `gravityFields[].durationTicks`                                     | A hole's lifetime                                                                                                 | `GRAVITY_FIELD_TICKS` in the ease-in                                                                                                                                                                                              |
| `gravityFields[].coreRadius`                                        | The lethal core                                                                                                   | `gravityCoreRadius(radius)`                                                                                                                                                                                                       |
| `rules.trailDecayPauseTicks`                                        | How long a detached or dead trail holds still before it shrinks                                                   | `TRAIL_DECAY_PAUSE_TICKS` in the detached-trail colour fade (`trailColor`)                                                                                                                                                        |
| `rules.gunRadius`, `rules.gunHoleRadius`, `rules.gunHeadshotRadius` | Where a gun ray stops, the hole it cuts in a trail, and how close it kills                                        | `GUN_RADIUS`, `GUN_HOLE_RADIUS`, `GUN_HEADSHOT_RADIUS` in the gun impacts and the portal pulse                                                                                                                                    |
| `rules.portalWallHalfWidth`                                         | Half a portal gate's thickness                                                                                    | `PORTAL_WALL_HALF_WIDTH` in the gun's portal pulse                                                                                                                                                                                |
| `openEdges`                                                         | Whether the board wraps right now                                                                                 | `edgesOpen(view)` from `arena-map.ts`, also in the gun impacts                                                                                                                                                                    |
| `presentationTick` (view and rider)                                 | Presentation's own fractional time. Optional, never set by `toView`                                               | unchanged                                                                                                                                                                                                                         |

`rules` is one frozen object shared by every view. There is no `shellRadius` and `view-kit` has no shell advance: the only code that projected a shell between ticks was the LAN extrapolation (`render-snapshot.ts`), deleted with the rest of the dead LAN client. Online presentation interpolates shells between two simulated ticks.

Adding to the contract: work the value out in `toView` from the state and the tuning, give it a doc comment that says what it states, and assert it in `tests/view-contract.test.ts`. Prefer a worked-out value (`coreRadius`) to a constant plus a formula the renderer has to know.

## `view-kit`

A kernel belongs there when presentation has to evaluate it at a time or place the simulation never did, and it is a function of its arguments:

| Export                                                    | Used by                         | Why presentation runs it                                                                                              |
| --------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `advanceRiderPose`, `gravityBend`, `MotionControls`       | `render/time/present.ts`        | The local rider is led a fraction of a tick ahead with the controls held now; `speed` and `turn` come from the view   |
| `bombLaunchDistance`                                      | `render/bomb-preview.ts`        | The charge marker is drawn at a fractional charge age                                                                 |
| `wrapCoordinate`, `wrapDelta`, `wrapImages`, `WrapOffset` | scene, `arena-views`, `present` | Folding and ghosting on an open-edged board is arithmetic on a width and a height                                     |
| `advanceTrail`, `segmentIntersectsDisk`                   | `render/trail-debris.ts`        | Debris is what a blast removed: the kept trail is aged as the simulation would have, the rest tested against the disk |
| `obstacleDistanceSquared`                                 | `render/phaser/gun-impacts.ts`  | An impact is drawn where a ray already stopped; it asks whether that point touches scenery, as the simulation did     |
| `PICKUP_TYPES`                                            | scene preload                   | One sprite per type is loaded before any view exists                                                                  |

If a renderer wants a constant from the engine, that is a field missing from the view, not an entry missing here.

## Layout

| Path                                            | Holds                                                                                                                                                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/render/phaser/`                            | The scene (`arena.ts`), its lifecycle state machine (`presentation.ts`), trail cache and tips, the WebGL trail ribbon (`trail-ribbon.ts`, `beveled-trails.ts`), the bomb aim guide (`bomb-aim.ts`), gun animation and impacts, one-shot effect transitions, backing-size observation |
| `src/render/time/present.ts`                    | Presentation time: `interpolateWorld` between two ticks, `presentWorld` with the local lead, `presentFrames` over what a runtime hands out                                                                                                                                           |
| `src/render/*.ts`                               | Pure, tested leaves: wall, map art, crossed-map views, blast animation, debris, ink, portal palettes, reload ring, self-locator, charge marker, themes                                                                                                                               |
| `src/render/avatar-atlas.ts`                    | The avatar sheet's frame order, a property of the image; pinned to the game's avatar ids by `tests/avatar-atlas.test.ts`                                                                                                                                                             |
| `src/render/power-indicator.ts`, `asset-url.ts` | Imported by the scene and by the app (the app may import render, not the reverse)                                                                                                                                                                                                    |
| `src/client/theme-choice.ts`                    | App: the stored style choice (`selectedTheme`, `storeTheme`), split from the theme registry so render does not import storage                                                                                                                                                        |
| `scripts/lib/benchmark-fixture.ts`              | Builds worlds with the engine for the browser scripts; never part of `src/`                                                                                                                                                                                                          |

`ArenaScene.paint` builds one `Frame` and calls `drawBackground`, `drawFloor`, `drawTrails`, `drawTransitions`, `drawGunImpacts`, `drawPickups`, `drawPortals`, `drawGunMuzzles`, `drawBombs`, `drawFields`, `drawBlasts`, `drawDebris`, `drawRiders`, `drawInk`. That order is the z-order within each Graphics layer.

The netcode does not interpolate or predict any more. `RoomRuntime.presentation()` returns the two newest frames, the fractional tick to show and how far to lead the local rider; the app passes them to `presentFrames`. `src/online/attract.ts` mounts Phaser and is app code; the layer map already classifies it so, and it stays under `src/online/` until #255 creates `src/app/`.

## Checking that nothing a player sees changed

`npx tsx scripts/render-parity.ts` replays the golden recording, takes the view at 39 moments chosen to cover every kind of thing the scene draws, renders each at a fixed clock on WebGL and Canvas in both themes, and prints a hash of the pixels: 156 frames. 31 moments are one frame after a `reset()`. The other 8 (`after-gun-*`, `after-death-*`, `after-blast-*`) draw the tick before and then the tick itself, so gun impacts, death sparks, rubble and debris launch are hashed too; `Math.random` is one seeded stream per page, every moment is drawn once before any is hashed, and the 2D canvas is software-rasterised, so the same revision prints the same hashes run after run.

`PARITY_REFERENCE=<ref> npx tsx scripts/render-parity.ts` hashes the checkout, then `<ref>` in a throwaway worktree running the same file (it resolves the renderer's path and `toSnapshot`/`toView` at run time), and lists every frame that differs. Against `origin/codex/arch-step-pipeline` at `4755160` (main `9479799`'s renderer in `src/client/`, reading engine constants), 156 of 156 frames are identical. It does not cover the interpolated tip between two ticks; that is covered by the unit tests of `trails` and `present`.

The one intended difference is not in those frames: a trail tip that used to be dropped for the tick on which a Snail ended is now drawn (`tests/phaser-trails.test.ts`).

## What remains

- **Hot path (P6).** `TrailHistoryCache` still reports `changed` on every tick a trail grows, so every trail is restroked in three passes at 20 Hz; debris still copies up to 2048 segments per rider per tick. Not changed here: each needs a before/after measurement on a recorded round first.
- **The allowlist is 8, none of it rendering**: five engine imports of `src/shared/` (`avatars.ts` three times, `duration-text.ts`, and `state.ts` naming `AvatarId` through `protocol.ts`) and three of `room-runtime.ts` (`status-notices.ts`, `avatars.ts`, `uuid.ts`). The first group closes by giving the engine the avatar-id vocabulary; the second belongs to #255.
- `src/shared/protocol.ts` still holds the LAN wire messages. `parseClientMessage` has had no caller under `src/` since #271; the audio director and the controller state still borrow the `ServerMessage` and `ClientMessage` shapes. `AudioDirector` consuming engine `GameEvent`s directly is the first app-layer follow-up (#255).
- App and net code still deep-import engine modules instead of `src/engine/index.ts` (#255).

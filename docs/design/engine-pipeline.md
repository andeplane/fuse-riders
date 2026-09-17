# Engine pipeline (issue #253, stage A2)

`step()` was one function of about 970 lines whose sections talked to each other through some twenty locals. It is now a loop over an ordered list, `PHASES` in `src/engine/sim/pipeline.ts`. Every commit of the stage is `[hash-identical]`: `RULES` stays `fuse-p2p-32` and `tests/fixtures/golden-hashes.json` is untouched. Nothing a player, a peer or a checkpoint can see has changed.

Adding a mechanic is now a new file in `src/engine/sim/phases/` and one row in `PHASES`. The order of that list is part of the rules: moving a phase changes outcomes and needs a `RULES` bump like any other behaviour change. `tests/pipeline.test.ts` writes the order down a second time on purpose, so it cannot move by accident.

## Layout

| Path                                                                                        | Holds                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine/index.ts`                                                                       | The public API: world and commands, `step`, `PHASES`, `applyTick`, `RULES`, the input log, room settings, bots, the checkpoint codec                                                |
| `src/engine/game.ts`                                                                        | The commands that change a world between ticks (`createGame` … `resetMatch`, `prepareRound`) and `step`, which is the early-out and the loop. Re-exports what it used to define     |
| `src/engine/state.ts`                                                                       | The state records — plain data, so rollback can `structuredClone` them and the checkpoint guards can name every field — and the ordered readers `sortedPlayers`/`Bombs`/`Obstacles` |
| `src/engine/tuning.ts`, `geometry.ts`, `rng.ts`, `pickup-types.ts`, `gravity.ts`, `view.ts` | Balance constants and the pure functions of them; plane geometry; the seeded stream (its position lives in the state); the pickup list; `gravityBend`; `toSnapshot`                 |
| `src/engine/sim/context.ts`                                                                 | `TickContext`, `Movement`, `DeathFact`, `TickFact`                                                                                                                                  |
| `src/engine/sim/pipeline.ts`                                                                | `Phase`, `PHASES`, `TickFault`                                                                                                                                                      |
| `src/engine/sim/phases/*.ts`                                                                | One phase per file (`explode.ts` has two entry points for one rule run twice)                                                                                                       |
| `src/engine/sim/field.ts`, `riders.ts`, `portals.ts`, `marks.ts`                            | Helpers more than one phase reads: bounds and open edges, immunity and reflection, gate and exit safety, the sweep's cause/shot/origin marks                                        |
| `src/engine/codec/checkpoint.ts`                                                            | The checkpoint guards, moved from `src/online/`                                                                                                                                     |
| `src/shared/`                                                                               | What is not simulation: `protocol`, `avatars`, `uuid`, `rider-name`, `duration-text`, `rating`, `elo`, `career-stats`, `firebase-config`                                            |

The engine's runtime imports are a DAG. Nothing under `sim/` imports `game.ts` (pinned by `tests/pipeline.test.ts`); phases import `state.ts`, `tuning.ts`, `geometry.ts`, `rng.ts` and the mechanic modules. `state.ts` is the one engine module that names wire types from `src/shared/protocol.ts`, so the old `game.ts → protocol.ts` allowlist edge was re-pathed to it 1:1; the move to `src/engine/` re-pathed all 56 edges 1:1 and added none (nine were then deleted, see the end of this note).

Rule used for the move: every file the layer guard (`tests/fixtures/source-guards.ts`) already classified as engine moved; the guard's `shared` set stayed. A simulation file that turns up in `src/shared/` later is still held to the engine's rules by the guard.

### Order of the work

The plan put the `git mv` first. It was done last instead, as one mechanical commit straight after a merge of `main`: other sessions merge engine changes roughly hourly, git follows a rename through a merge but cannot follow a function that has moved into another file, so the window in which `main` and this branch disagreed about where `step` lives was kept as short as possible. For the same reason the leaf modules (`geometry`, `rng`, `pickup-types`, `state`, `tuning`, `view`) were split out first rather than last: phases import them, which is what keeps `sim/` from importing `game.ts` at any commit.

Each phase was lifted out top to bottom, one commit each (a two-line phase shares a commit with its neighbour). `step` kept running the part not yet moved inline, reading its locals from the context, so every intermediate commit is a working engine and a hash break would bisect to one phase. None occurred.

## The tick contract

`step(state, inputs)` builds one `TickContext` and walks `PHASES`. Phases marked `*` run whatever the game phase; the tick ends at the first other phase when no round is in play (the early-out `step` always had). A context lives for one tick and is never stored.

| #   | Phase                   | Reads → writes                                                                                                                                                                                                      |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `advanceClock` \*       | `state.tick += 1`. Everything after reads `state.tick` as now                                                                                                                                                       |
| 2   | `expire` \*             | Drops portal pairs, black holes and blast marks whose time is up                                                                                                                                                    |
| 3   | `startPlay` \*          | Writes `ctx.pickupSchedule` from the riders alive; on the countdown's deadline the round starts on this tick                                                                                                        |
| 4   | `ageTrails`             | Live trail past its lifetime goes, detached debris erodes                                                                                                                                                           |
| 5   | `fitField`              | Writes `ctx.elapsed`, `ctx.open`, `ctx.trailBounds` and `state.boundaryInset` (overtime); refits gates, crushes scenery the walls reached, clamps black holes, clips trails (allocates trail-piece ids, seat order) |
| 6   | `spawnPickups`          | On the pacing interval: one draw for the type, two per placement attempt                                                                                                                                            |
| 7   | `moveRiders`            | Expires speed effects, steps the aiming slowdown, then writes `ctx.movements` in seat order. Nobody is moved yet                                                                                                    |
| 8   | `collectPickups`        | Pickups in id order, nearest step wins (seat breaks a tie), effect applies at once. A portal or gravity pickup draws from the stream                                                                                |
| 9   | `bounceImmuneRiders`    | An immune rider is turned back by the wall; after pickups, so a Star collected this tick already bounces                                                                                                            |
| 10  | `moveShells`            | Shells fly (bomb-id order) and keep their swept paths in `ctx.shellPaths`; spent gun tracers are removed                                                                                                            |
| 11  | `explodeFuses`          | Due bombs and their chains, bomb-id order, breadth-first → `ctx.fuseBlasts`; clears pickups and scenery                                                                                                             |
| 12  | `hitProjectiles`        | Landing bombs and swept shells mark `explosion`; a shell that hits is deleted                                                                                                                                       |
| 13  | `burnTrails`            | Captures dodge origins, then fuse blasts cut trails (piece ids, seat order)                                                                                                                                         |
| 14  | `detectHazards`         | Every step against fuse blasts, walls, black-hole cores, scenery (obstacle-id order) and trails: marks causes and first-contact times                                                                               |
| 15  | `detectRiderContacts`   | Every pair once, relative sweep; marks `rider` both ways unless immune                                                                                                                                              |
| 16  | `settleSceneryContacts` | A scenery contact later than a trail or rider contact is dropped; the rest mark `wall`. Keeps `ctx.sceneryReached` for the shield                                                                                   |
| 17  | `resolveDefences`       | A shield absorbs: spent, grace begins, rider turned back from scenery/wall, every mark on it forgotten                                                                                                              |
| 18  | `portalTransit`         | Unmarked riders crossing a gate get a transit, seat order, each seeing those already granted                                                                                                                        |
| 19  | `stopAtContact`         | A rider stopped by trail, rider or scenery goes no further than the contact; states a `survived` fact per rider                                                                                                     |
| 20  | `commitMovement`        | Steps become positions and trail. Marked riders become `DeathFact`s (sole queue: `ctx.deaths`)                                                                                                                      |
| 21  | `commitSweepDeaths`     | `commitDeaths`: drains the queue                                                                                                                                                                                    |
| 22  | `launchWeapons`         | Living riders' press/release/cancel, seat order, command by command: bomb ids, shot numbers, `shotFired`/`bombPlaced` facts                                                                                         |
| 23  | `fireGuns`              | Rays in bomb-id order against the committed board → `ctx.gunHits`; tracers past a gate or an open edge take the next bomb ids; holes are cut after all rays                                                         |
| 24  | `explodeInstant`        | The explosion rule again, for Target Bombs released this tick and what they chain → `ctx.instantBlasts`                                                                                                             |
| 25  | `resolveInstantHits`    | Seat order, per rider: burn its trail, then test its head against instant blasts and bullets → shield absorb (no bounce) or a `DeathFact`, committed at once (see below)                                            |
| 26  | `commitInstantDeaths`   | `commitDeaths` again; empty while `INSTANT_DEATHS_COMMIT_PER_RIDER` is on                                                                                                                                           |
| 27  | `observeDodges`         | One dodge per rider against the first blast, fuse blasts before instant ones                                                                                                                                        |
| 28  | `recordFacts`           | The only writer of match statistics, the shot log and moments: replays `ctx.facts` in order, then folds the observations into moments and reports them                                                              |
| 29  | `resolveRound`          | Last rider standing or the clock: placements in seat order, scores, match winner, decided round and rating standings                                                                                                |

What the pipeline preserves, and where it lives:

- **Random draws.** Only `spawnPickups` (6) and `collectPickups` (8) draw during play, in that order, pickups in id order. `prepareRound` draws the scenery between ticks.
- **Compute all, then commit.** Phases 7–19 write only the context and the marks; riders get positions in 20 and die in 21. Launches (22) therefore see every rider's committed place, independent of seat.
- **Cause priority.** `rider < trail < wall < explosion` (`sim/marks.ts`). A scenery contact only counts if nothing else stopped the rider first (16).
- **Id-sorted chains.** `explode.ts` builds and extends its queue in bomb-id order.
- **Shared counters.** Trail-piece ids are taken in 5, 13, 21, 23, 25 (and 26); bomb ids in 22 and 23. Within each, seat or id order.

## One death path

Both old paths now only state a `DeathFact { victim, cause, owners, shot?, x, y, trailAge?, landingHit?, shellHit? }`. `commitDeaths` (`sim/phases/commit-deaths.ts`) is the one place a rider dies during a tick: `takeOutOfRound` (not alive, no charge held, trail detached into debris, round ranking stamped — shared with the `eliminatePlayer` command), the `died` fact, the `playerEliminated` event and the highlight observation.

Written side by side, the two old commits credited identically: the statistics are given the sole owner of the winning cause, the victim itself included (`recordDeath` turns that into a self death), and the shot log never books a pull against its own shooter. So no credit flag was needed. Three real differences were found. All three are kept exactly, and named:

1. **When an instant death is committed** — `INSTANT_DEATHS_COMMIT_PER_RIDER`, `commit-deaths.ts`. The sweep finds every death and then commits them. The instant path has always, rider by rider in seat order, burnt that rider's trail and then committed its death before touching the next rider. A wreck's trail and a burnt trail take piece ids from one counter (`state.nextTrailPieceId`), and those ids are compared state, so committing instant deaths after the whole pass would renumber them whenever an earlier-seated rider dies and a later-seated rider's trail is cut by the same blast. `tests/death-path.test.ts` constructs exactly that and fails with the flag off (wreck 2, burn 1); the same test passes on `main` `75fb664`. The golden recording does not contain the case: it passes with the flag off, which is why the focused test exists. **For A4:** turning the flag off in a `[rules]` commit makes `resolveInstantHits` a pure detector and phase 26 the commit, like the sweep.
2. **Which shot a kill names.** The sweep keeps, per victim, the lowest bomb id _among sources that carry a shot_ (`markShot`). The instant path takes the lowest bomb id among its hits _whether or not it carries one_. Every bomb the engine makes names its shot, so they differ only for a bomb that arrived without one (`BombState.shot` is optional at the checkpoint boundary): the sweep would credit a later bomb's shot, the instant path none. Each detector still computes `DeathFact.shot` its own way. **For the owner:** pick one rule in A4.
3. **What an absorbed hit does.** A shield that absorbs in the sweep also turns the rider back from the scenery or wall it reached; an instant absorb only spends the shield (the rider is standing still by then). Kept where it was, in `resolveDefences` and `resolveInstantHits`.

## Statistics out of the physics

Phases state `TickFact`s — `pickupCollected`, `bombExploded`, `survived`, `portalCrossed`, `shotFired`, `bombPlaced`, `died` — carrying values as they were at that moment. `recordFacts` replays them in order. The order matters twice: a kill looks its shot up in the log, and a Target Bomb's pull is logged on the tick it kills. No phase before `recordFacts` reads match statistics, the shot log or moments, so deferring the writes cannot change an outcome. `tests/pipeline.test.ts` enforces it by import: under `sim/`, only `record-facts.ts` and `resolve-round.ts` may import the recorders. `resolveRound` is allowed because scoring the round and freezing the decided round's log is the round's outcome, not physics; the commands outside a tick (`eliminatePlayer`, `prepareRound`) also still write statistics directly.

Splitting the commit loop moved death facts after that tick's `portalCrossed` facts. They touch different counters, so the statistics are unchanged.

## `step` returns events only (C7)

`applyTick`, and so every re-simulated tick of a rollback, paid for a public snapshot it threw away. `step` now returns `{ events }`; a caller that wants a snapshot calls `toSnapshot(state)`, as `World.frame` already did.

Reproduce with `npx tsx scripts/benchmark-golden-replay.ts 5` (the script resolves the engine path at run time, so it can be copied onto an older revision). Workload: `tests/fixtures/mechanics-recording.json`, 12,779 ticks, match `replay`, two scripted humans and three bots, recorded by `makeRecording(20260918, 30000, true)`. Node v22.20.0, Apple silicon, other sessions running on the machine; three interleaved rounds of five runs each, minimum and median per round:

| Revision  | What                                                | `applyTick` only, min / median ms (rounds 1, 2, 3) | With the per-tick hash, min / median ms       |
| --------- | --------------------------------------------------- | -------------------------------------------------- | --------------------------------------------- |
| `75fb664` | `main` before the stage                             | 3048 / 3066 · 3021 / 3040 · 2997 / 3031            | 11875 / 11921 · 11949 / 11956 · 11866 / 11871 |
| `4012006` | Pipeline complete, `step` still returns a snapshot  | 3041 / 3095 · 3100 / 3108 · 3005 / 3077            | 11928 / 11949 · 11981 / 12011 · 11934 / 12030 |
| `f5886f4` | `step` returns events only, engine in `src/engine/` | 2806 / 2831 · 2770 / 2812 · 2956 / 3198            | 11583 / 11608 · 11678 / 11768 · 12587 / 12665 |

Rounds 1 and 2 agree: a replayed tick went from about 240 µs to about 220 µs, 8% less, and the final state hash is `580066382d649dd2` on all three revisions. Round 3 of the last revision was disturbed by other work on the machine (its minimum is still below the other two revisions' medians, its median is not); it is reported rather than rerun.

The pipeline itself costs nothing measurable (context allocation and one `try` per phase). `hashRoomState` remains about three quarters of a hashed replay; it is not touched here. The replay only hashes for the golden test and the runtime hashes every `HASH_INTERVAL` ticks, so it is the test that pays. It is the obvious next target if the golden test's 25 s matters.

Not done from C7: typed-array trails, clone cadence, bot replans on re-simulated ticks.

## Throw safety (C8): the engine part only

Two things changed, and neither changes what a throw does to a running room.

- **The known throw sources are gone.** The per-tick match-stats recorders threw on a rider the match never seated and on a distance that is not one. Only a damaged state can produce either, but a throw there left the tick half-done. They now tolerate: the rider is not counted, the distance is dropped (`match-stats.ts`; `finalizeMatchStatsRound` still rejects a contradictory round). The tolerance is silent; a once-per-match warning through the runtime's reporting path belongs to the follow-up.
- **A throw names its phase.** `step` wraps each phase and rethrows a `TickFault { tick, phase, cause }`. `step(state, inputs, phases = PHASES)` is the seam `tests/tick-fault.test.ts` uses to insert a throwing phase before `commitMovement`; `applyTick` passes it through. Nothing is patched.

What is **not** changed: a throw still leaves the state part-way through the tick — the clock has advanced, some phases have written, the rest have not — and the error still escapes `applyTick`, `World.advance` and the runtime's interval callback exactly as the raw error does on `main` (nothing in `src/online/` catches it; that iteration's packets and frame are skipped). `step` and `applyTick` are deliberately not transactional: a `structuredClone(RoomState)` per tick measured 182 µs on the golden recording against about 215 µs for the tick itself, which would undo C7 on every re-simulated tick.

Recovery — what the `World` and the runtime should do when a tick throws, bounded and honest about the fact that a deterministic throw happens on every replica at once — needs its own design and is a separate pull request stacked on this one. A first version was written in this branch and split out after review found that its resync loop was unbounded when every replica faults.

## What is left of #253

A3 (one tick driver, `GameState.settings` required) and A4 (registries) are untouched. For A4: the flag and the shot rule above; `explode.ts` still declares an unused `circle`; `applyBombActions` and the 18-arm pickup chain moved verbatim and are what the registries replace. After the move the primitives the simulation is written in (`PlayerId`, `AimPoint`, `BombAction`, `BombActionCommand`, `TrailSegment`, `BlastCircle`) were given to the engine (`src/engine/primitives.ts`; `protocol.ts` re-exports them), which deleted nine `engine → protocol.ts` edges: the allowlist is 47, down from 56. The engine's remaining outward imports are `state.ts → protocol.ts` (`AvatarId`, `GameEvent`, `GameSnapshot`), three imports of `avatars.ts` and `match-recap.ts → duration-text.ts`. App, net and render code still deep-import engine modules rather than `src/engine/index.ts`. Moving them, and moving `GameEvent` and the snapshot into the engine's view, is the layer work of #254/#255 and was left out to keep this change a refactor of the engine alone.

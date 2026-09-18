# Game speed runs extra steps per tick; the clock never changes rate (#258 N2)

When every human rider in a playing round is dead and a bot is still alive, the rest of the round is bots racing each other, and the game plays it three times faster. Until this change that speed-up was a change of the **shared clock's rate**: each member set `TickClock.rate` from its own speculative world on every loop pass (`RoomRuntime.paceClock`). A rollback that changed whether a human was alive changed the rate after the fact, clock time already spent at the other rate stayed spent, and a hidden member, whose world is frozen, could not judge at all, so it measured the authority's rate from packet timestamps (`observeRate`: a threshold, a streak of two readings, a 1.5 s deference rule). It took two same-day fixes and still left every tick-denominated bound three times shorter in wall time (ADR 047 C5).

Now the clock has one rate, `TICK_MS` per tick, always. The shared log advances one tick per 50 ms as it always did, the network sends what it always sent, and the tick driver steps the simulation three times inside one log tick while the rule holds. Every replica reads the rule off the same folded state, so the step count is part of the deterministic fold like everything else: a rollback that changes it re-simulates the ticks after it with the right count, and nobody needs to estimate anyone's clock.

## Where the step count is decided

`stepsPerTick(game, bots)` (`src/engine/tuning.ts`, replacing `simulationTimeScale`) is `BOTS_ONLY_STEPS_PER_TICK` = 3 when the round is playing, at least one human rider is seated, no human rider is alive and a bot is alive; otherwise 1. The predicate is the one `simulationTimeScale` used: a disconnected human who is still coasting counts as alive and keeps normal speed; a room of bots only (the attract mode, a bots-only showcase) is not a wait and keeps its pace.

`applyTick` evaluates it **once, first thing**, on the state as the previous log tick left it: before the tick's management entries and before any rider's entries fold. That is the folded state at the start of the tick, which every replica holds identically once it holds the same entries up to the previous tick. It passes the count to `driveGameTick`, which runs the first step with the tick's inputs and each further step with the later inputs (below), and **stops early when the round stops playing** (the round ended on step one or two). The round-over pause, the results and the next countdown therefore always run at normal speed, and a fast tick never steps into a phase the count was not decided for. `applyTick` never asks for more than `MAX_STEPS_PER_TICK` (= `BOTS_ONLY_STEPS_PER_TICK`), which is what the snapshot guard relies on.

Why not decide it inside the tick (after the management entries, or per step)? Any place works for determinism as long as it reads only folded state. The start of the tick was chosen because it is the simplest statement of "a pure function of the state before the tick", and because no management entry can change the answer during a round in a way that matters: a `PRESENCE`, `LEAVE` or `JOIN` mid-round does not revive a dead human, and a `BOT` or `ACTION` entry only applies outside play.

## Inputs within a fast tick

The log carries a rider's entries for one log tick; the fold turns them into held controls plus the tick's ordered bomb commands (`press`, `release`, `cancel`). Those commands reach **the first step only**. Every later step of the same tick gets:

- a human rider: its held controls as they stand after the fold (`intentOf(fold)`: steering, the held bomb flag and aim), without commands, so a press is one press and a release one release;
- a bot: `BotController.input` asked again on the game as the previous step left it, exactly as it would be asked on the next tick at normal speed. Bots decide per step, not per log tick; they play the fast phase as they played it when the clock itself ran fast.

Fast mode only engages when every human is dead, so in practice the human half matters only for correctness of the seam (`tests/tick-driver.test.ts` pins it with a forced count).

## Two counters: the log tick and the game's clock

`applyTick` used to read the log tick off the game (`game.tick + 1`). With three steps per tick the game's clock runs ahead of the log's, so `RoomState` now has its own counter, `RoomState.tick`: the log tick the state has folded through. `game.tick` stays the game's clock: the count of steps, which is what every rule inside the game reads.

| Uses the **log tick** (`RoomState.tick`, `World.tick`)                                                                                        | Uses the **game's clock** (`GameState.tick`, a frame's `tick`)                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry stamps, `StreamLog` windows and `through`, `completeTick()`, the stall rule, `pendingDisconnect`                                        | Phase ends (`phaseEndsAtTick`), countdown, round-over and match-winner pauses                                                                       |
| The shared clock (`TickClock`), catch-up, `BEHIND_TICKS`, `FUTURE_TICKS`                                                                      | The round timer, overtime (`OVERTIME_START_TICK`), the speed ramp, `ROUND_DRAW_TICK`                                                                |
| Rollback snapshots (keyed and spaced by log tick), `SNAPSHOT_INTERVAL`, retention and pruning, emitted-event keys                             | Fuses, cooldowns, pickups and effect deadlines, trail decay                                                                                         |
| The desync hash (`HASH_INTERVAL`, `HASH_LAG`, `hashAt`), snapshot serving and install (`servable`, the snapshot's `tick` field), stream bases | Match statistics (survival ticks, `eliminatedAtTick`), moments (`moment.tick`) and the replay recorder, which keys its frames by the frames' `tick` |
| `Frame.logTick`, which the runtime's `presentation()` uses to place the clock between two frames                                              | `WorldEvent.tick` (what the audio director, telemetry and the replay compare with frames), the arena announcer, the recap timing                    |

Statistics, moments and the replay were already game-clock quantities and stay that way: a bot that survives 60 fast log ticks survived 180 steps of play, and the numbers mean the same thing they meant when the clock ran fast. The replay recorder keeps the last few seconds of frames by game tick, and fast frames are three game ticks apart; a clip cut in the fast phase has a third of the frames it would have at 1× (it already skips frames it did not see) and plays back at the game's pace, which is how it looked when the clock ran fast too.

`returnToLobby` still preserves `game.tick` (the room restores it after `ACTION lobby`), so across a match the game's clock only grows. The invariant every state satisfies is `logTick ≤ game.tick ≤ logTick × BOTS_ONLY_STEPS_PER_TICK`: each log tick steps the game at least once and at most that many times, and nothing else moves either counter.

## Snapshots and checkpoints

A snapshot already carried both counters: the envelope's `tick` field is the log tick it is served at, and the game checkpoint inside carries `game.tick`. The guard used to require them to be equal; it now requires the invariant above (`stepsCover` in `src/engine/tick-driver.ts`), and `decodeSnapshot` builds `RoomState.tick` from the envelope. The game checkpoint's own guards (`decodeGameState`) compare only game-clock quantities with `game.tick` and are unchanged. `canonicalRoomState` now includes `tick`, so the desync hash and the golden cover the log counter too; that is part of the rules commit.

## The renderer

Frames are simulated one per log tick, so in the fast phase two consecutive frames are three game ticks apart. `RoomRuntime.presentation()` places the clock between the two frames' **log** ticks and returns the same fraction of the way between their **game** ticks as the tick to draw. `presentWorld` then interpolates rider and shell positions over the three steps and draws from the older frame's discrete state (trails, deaths, pickups), exactly as it did per tick. Anything the renderer animates by `view.tick` (blast rings, fuses, trail decay, the round timer) advances three times faster, which is how the game looks fast without the clock changing. The local rider's lead is measured in log ticks and applies only to a living local rider, which fast mode never has.

## What is deleted

- `TickClock.rate` and its re-basing; the clock is `tick = base + (now − t0) / TICK_MS` plus the slewed offset.
- `RoomRuntime.pace`, `observeRate`, `paceClock`, `RATE_WINDOW_MS`, `RATE_DEFER_MS`, and their rows and coupling C10 in ADR 047.
- `simulationTimeScale` and `BOTS_ONLY_TIME_SCALE`, replaced by `stepsPerTick` and `BOTS_ONLY_STEPS_PER_TICK`; `STEPS_PER_TICK` in the driver.
- The literal `50` in `room-runtime.ts` (review finding 3 on #258): peer clock estimates now use `TICK_MS`, and there is no rate for them to ignore.

## Consequences

- **Every tick bound keeps its wall-clock meaning.** `STALL_TICKS` is 2 s in every phase, above `DISCONNECT_MS` (1 s), so a silent rider is logged absent before anyone stalls on it, at any game speed (finding 6; ADR 047 C5, C6). `ROLLBACK_TICKS`, `RETAINED_TICKS` and the hash margin stop shrinking in the fast phase.
- **Hidden members need no heuristic.** A hidden follower's clock follows the authority's samples as always; when it shows again it catches up at `CATCHUP_TICKS` log ticks per pass, and every one of those ticks takes the step count its own folded state gives it.
- **Cost.** A fast log tick costs three steps, so a rollback or a catch-up pass across the fast phase simulates up to three times as many steps (at most `CATCHUP_TICKS × 3` = 24 steps per 10 ms pass). The fast phase has only bots alive, which step cheaply.
- **It is a rules change.** A round that ended in the fast phase ends on the same step as before only in step count, not in log tick, and the canonical state now has `tick`, so `RULES` moved and the golden was re-recorded. The recording plays bots-only endgames, and `fast:steps` in `REQUIREMENTS` (`tests/fixtures/replay-coverage.ts`) makes the recorder prove it keeps doing so.

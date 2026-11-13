# Killer Fuse engine

The rules of Killer Fuse live in `games/killer-fuse/src/engine`, a headless simulation with no rendering, no network and no clock. The page, the online layer and the headless runner (`scripts/killer-fuse-sim.ts`) all drive the same `stepRound`. The rules it implements are in [BRIEF.md](BRIEF.md); the bots are in [bots.md](bots.md) and the measured results in [balance.md](balance.md).

It is not wired to the page or to `fuse-netcode` yet: `src/game` still holds the template game. See "Not built yet" at the end.

## Determinism

Two peers that step the same state with the same inputs must reach the same state, bit for bit. The engine keeps to these rules, and `tests/architecture.test.ts` checks the ones that can be checked from the source:

- `src/engine` imports nothing outside itself.
- No `Math.sin`, `cos`, `atan2`, `hypot`, `pow`, `**` or `Math.random`, and no `Date` or `performance`.
- Every number in the state is an integer. Lengths are subpixels: one art pixel is `S = 1024`. Speeds are subpixels per step, times are steps. Ratios such as the 1.35 speed multiplier are integer fractions (`27 / 20`).
- Randomness comes from one mulberry32 stream kept in the state (`rng`). Only bots draw from it.
- The state is plain data: numbers, booleans, strings, arrays and plain objects. It survives `structuredClone` and a JSON round trip, so a rollback snapshot is a copy.
- One step is 1/60 s. The network runs three steps per 50 ms tick.

`hashRound` gives 16 hex characters over the whole state except `events`. The headless runner plays every game twice and fails if the two final hashes differ.

## Public surface

Everything is exported from `src/engine/index.ts`.

| Export                                                     | What it is                                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `RULES = "killer-fuse-1"`                                  | Bump on any behaviour change; peers on different rules refuse each other                     |
| `TICK_HZ = 60`, `MAX_PLAYERS = 6`, `S = 1024`              | Step rate, seats, subpixels per art pixel                                                    |
| `teamOf(slot)`, `isQueenSlot(slot)`                        | `slot % 2` and `slot < 2`: slots 0 and 1 are the Queens, 2 to 5 the Workers                  |
| `createRound(options: RoundOptions): Round`                | A new round: `{ seed, mapId?, botLevel?, humans?, teamLevels? }`                             |
| `stepRound(state: Round, inputs: readonly Input[]): Round` | One step, in place. `inputs[slot]` is read for slots people play; a missing one is neutral   |
| `viewOf(state: Round): RoundView`                          | What a renderer draws, in art pixels                                                         |
| `Input`, `NEUTRAL`                                         | `{ left, right, down, held, pressed }`; `pressed` is the button's edge                       |
| `packInput(input)`, `unpackInput(bits)`, `INPUT_*`         | An input as five bits (`INPUT_MASK = 31`)                                                    |
| `cloneRound(state)`, `hashRound(state)`                    | A deep copy, and the hash peers compare                                                      |
| `MAPS`, `MAP_IDS`, `arenaOf(id)`, `isMapId(value)`         | The three maps as data, and a map in subpixels                                               |
| `MAP_WIDTH = 480`, `MAP_HEIGHT = 270`, `WIDTH`, `HEIGHT`   | Screen size in art pixels and in subpixels                                                   |
| `wrapX(x)`, `wrapDelta(to, from)`                          | The horizontal wrap                                                                          |
| `BOT_LEVELS`, `BOT_LEVEL_ORDER`, `botInput(state, slot)`   | Bot levels and the controls a bot holds this step                                            |
| `moveUnit(unit, input, arena)`, `halfOf`, `heightOf`       | One unit's own motion, and the body sizes                                                    |
| Everything in `tuning.ts`                                  | Every tunable number, each with a comment saying whether it is the original's figure or ours |

Types: `Round`, `RoundOptions`, `Unit`, `UnitKind`, `LooseBerry`, `GateState`, `Snail`, `GameEvent`, `BotMind`, `BotGoal`, `BotLevel`, `VictoryKind`, `MapDef`, `MapId`, `Arena`, `Rect`, `Point`, `GateDef`, `GateKind`, `PileDef`, `RoundView`, `UnitView`, `GateView`, `LevelRules`.

## State

`Round` (`types.ts`):

| Field            | Meaning                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| `rules`, `mapId` | Rules version and the map                                                    |
| `seed`, `rng`    | The round's seed and the current value of the random stream                  |
| `botLevel`       | Level of the bots                                                            |
| `teamLevels`     | Level per team; differs from `botLevel` only in headless level-vs-level runs |
| `humans`         | Per slot: true when a person plays it                                        |
| `step`           | Steps simulated                                                              |
| `units`          | Six `Unit`s, by slot                                                         |
| `piles`          | Berries left per map pile                                                    |
| `loose`          | Dropped and kicked berries                                                   |
| `holes`          | Per team, per hive hole: filled or not                                       |
| `gates`          | Per gate: `owner` (team or -1) and `user` (slot or -1)                       |
| `snail`          | `x`, `rider`, `victim`, `eat` (steps left of the meal), `facing`             |
| `eggs`           | Queen lives left per team                                                    |
| `dry`            | Steps the piles have been empty                                              |
| `winner`         | `{ team, kind }` or null                                                     |
| `bots`           | Six `BotMind`s: bot memory is ordinary state                                 |
| `events`         | What happened on the last step, in order; cleared at the start of a step     |

A `Unit` is at `x` (centre) and `y` (feet), with `vx`, `vy`, `facing`, `ground` (platform index or -1), `kind` (`worker`, `warrior`, `queen`), `speed`, `carrying`, `gate` and `gateProgress`, `invuln`, `dead` and `respawn`, `riding`, `eaten`, `mountWait`, and three flags of the last step for the renderer: `jumping`, `flapped`, `diving`.

Events: `kill`, `queenKill`, `bounce`, `bump`, `berryPickup`, `berryDrop`, `berryKick`, `berryDeposit`, `berryKickIn`, `berryRegrow`, `gateUse`, `gateClaim`, `snailMount`, `snailEat`, `snailFree`, `respawn`, `victory`.

## View

`viewOf` returns a `RoundView` in art pixels: `map` (the `MapDef`), `step`, `units` (`UnitView`: position, kind, `grounded`, `moving`, `flapped`, `diving`, `carrying`, `invulnerable`, `dead`, `respawn` from 0 to 1, `riding`, `eaten`, `bot`), `piles` with counts, `loose`, `hives` (per team, every hole and whether it is filled), `gates` (`GateView`: kind, `owner`, `user`, `progress` from 0 to 1), `snail` (position, `facing`, `rider`, `victim`, `eating` from 0 to 1), `eggs`, `berries` (filled holes per team), `winner` and `events`. View numbers may be fractions; nothing in the view feeds back into the state.

## One step

`stepRound` runs in this fixed order:

1. Bots decide: each bot slot gets its input from `botInput`.
2. Timers: the dead count down to their respawn, invulnerability and the mount delay run out.
3. Every living unit moves on its own (`moveUnit`): controls to velocity, then a move against the platforms with the wrap.
4. The snail: mounting, hopping off, crawling, eating.
5. Combat: every touching enemy pair is resolved.
6. Berries: pickups, deposits, loose berry physics, kicks, regrowth.
7. Gates: claims by Queens, Workers entering and finishing.
8. Victory: military, then economy, then snail.

When both teams could take the same thing on the same step (a berry, the snail, a gate, or a victory), the team served first is a coin flipped from the seed and the step number (`firstTeam`). A plain alternation would favour one side, because mirrored bots arrive on the same step every game.

## Rules as built

Controls are one stick and one button. There is no attack button.

- **Worker.** Runs at 62.5 px/s. The button jumps; releasing it while rising halves the upward speed, so a tap is a short hop and a hold rises 50 px. One step of coyote time, no jump buffer. Carries one berry.
- **Warrior and Queen.** Each press is a flap that adds upward speed; about 8.6 presses a second hover. On the ground they walk at 0.84 times run speed. A Queen holding down in the air dives straight down at 4.6 px per step.
- **Combat.** A military unit kills an enemy Worker it touches. Between two military units the one whose middle is at least 4 px higher kills, a diving Queen kills what she lands on, and a hit from behind kills; otherwise both bounce apart. A Worker that is invulnerable (just respawned, just out of a gate, just freed from the snail) shoves a military unit it touches.
- **Death.** A unit respawns at its spawn point after 3 s, invulnerable for 1.5 s. A Warrior comes back as a plain Worker, without speed. A Queen has three eggs; her third death loses the game.
- **Berries.** A Worker picks one up by touching a pile or a resting loose berry and banks it by touching an empty hole of its own hive. A carrier that dies drops the berry. Any unit kicks a loose berry it touches; a berry that reaches an empty hole fills it for that hive's team, whoever kicked it. The supply is finite; 90 s after every pile is empty the piles refill.
- **Gates.** A Worker holding a berry stands in a gate for 2.5 s and comes out upgraded and invulnerable for 2 s: a warrior gate makes a Warrior, a speed gate a speed Worker (1.35 times run speed, jump and climb), and a speed Worker in a warrior gate a speed Warrior. A Worker in a gate can still be killed. A gate is neutral until a Queen touches it; then only her team may use it until the other Queen touches it.
- **Snail.** A Worker that touches the snail on the floor mounts it and it crawls toward that Worker's own goal at 5.6 px/s (1.35 times that with a speed rider). Nothing is banked: the other team can ride it back. An enemy Worker in front of its mouth is caught, the snail halts for 3.67 s (less with a speed rider) and then the Worker dies. Killing the rider, or the rider hopping off with the button, frees the Worker in the mouth. Reaching the goal wins.
- **Wrap.** The screen wraps horizontally for units, berries and distances. The snail stays between its goals.

Choices that differ from the arcade game, or that it leaves open:

- Mounting the snail is automatic on touch (a Worker hops over it to pass), and the button dismounts.
- Only an invulnerable Worker bumps military units; an ordinary one dies on contact.
- A hive has 12 holes, the arcade count, although the game is 3v3. With fewer holes economy wins came too fast against the 62/24/14 target; see [balance.md](balance.md).
- Jump, flight, body size and combat numbers are ours; the original publishes none. Each is marked in `tuning.ts`.

## Maps

A map is data (`maps.ts`): solid rectangles, hive holes per team, gates, berry piles, the snail's track and six spawn points, all in art pixels on the 480 by 270 screen with y growing downward. A map is written as its left half plus whatever sits on the centre line, and mirrored, so both sides are identical. Team 0 (Cyan) lives on the left.

Map 1, "Twin Hives" (balanced). Left half; the right half is its mirror image:

| Piece       | Where (x, top y, width)                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| Floor       | y 258, the whole width; the snail walks on it                                                            |
| Ledges      | (0, 214, 52) (96, 214, 72) (44, 170, 60) (160, 170, 56) (0, 126, 40) (88, 126, 62) (124, 82, 72), 6 high |
| Centre      | (208, 214, 64) and (200, 126, 80)                                                                        |
| Hive        | 12 holes above the top ledge: six at y 77 from x 132 every 10 px, six at y 69 offset by 5 px             |
| Gates       | Warrior at (20, 214), speed at (132, 214); a contested warrior gate at (240, 126)                        |
| Berry piles | 6 at (130, 258), 6 at (70, 170); 12 in the centre at (240, 214). 36 berries in all                       |
| Snail       | Starts at x 240 on the floor; goals at x 44 (team 0) and x 436 (team 1)                                  |
| Spawns      | Queen at (160, 82), Workers at (142, 82) and (178, 82), on the hive ledge                                |

Ledge levels are 44 px apart and a full Worker jump is 50 px, so each level is one jump from beside a ledge end. The side ledges at x 0 meet their mirror images across the wrap and form one walkway.

Map 2, "Short Leash" (snail): goals at x 128 and 352, so an unopposed ride takes about 20 s; hives out at the walls. Map 3, "Open Heart" (military): both hives in the exposed middle, goals at x 24 and 456. Maps 2 and 3 are first drafts; their numbers are in [balance.md](balance.md).

## Files

| File         | Holds                                                |
| ------------ | ---------------------------------------------------- |
| `tuning.ts`  | Every number, with its source                        |
| `types.ts`   | State, input and event types                         |
| `maps.ts`    | The three maps, mirroring, the wrap                  |
| `rng.ts`     | mulberry32 on the state, integer draws               |
| `round.ts`   | `createRound`                                        |
| `step.ts`    | `stepRound` and the victory check                    |
| `motion.ts`  | One unit's own motion and collision with platforms   |
| `units.ts`   | Shared helpers: touching, death, respawn, turn order |
| `combat.ts`  | Contact combat                                       |
| `berries.ts` | Piles, carrying, loose berries, hive holes, regrowth |
| `gates.ts`   | Gates and claims                                     |
| `snail.ts`   | The snail                                            |
| `nav.ts`     | Bot navigation tables derived from a map             |
| `bot.ts`     | Bot decisions and steering                           |
| `view.ts`    | `viewOf`                                             |
| `codec.ts`   | Input bits, clone, hash                              |

## Tests

`tests/engine-*.test.ts` cover the rules, `tests/bot-*.test.ts` the bots and the headless runner, and `tests/architecture.test.ts` the import and determinism rules. Run them with:

```sh
node --import tsx --test games/killer-fuse/tests/*.test.ts
```

Line coverage of `src/engine` is 100% and branch coverage 99% (measured with c8 over the engine, bot and architecture tests).

## Not built yet

- The engine is not connected to `fuse-netcode`: there is no `RollbackGame` adapter and no binary checkpoint codec. The state is JSON-safe and `packInput` gives the five input bits, so both are thin layers, but they do not exist.
- Sets of games on rotating maps (PARITY row 23) are not in the engine; a round is one game on one map.
- Nothing is rendered. `viewOf` is the intended input for the renderer and has not been used by one.
- No person has played it. Jump and flight feel, and every "ours" number in `tuning.ts`, are settled by bot runs only.

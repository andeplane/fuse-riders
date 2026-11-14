# Killer Fuse engine

The rules of Killer Fuse live in `games/killer-fuse/src/engine`, a headless simulation with no rendering, no network and no clock. The page, the online layer (`src/online`) and the headless runner (`scripts/killer-fuse-sim.ts`) all drive the same `stepRound`. The bots are described in [bots.md](bots.md) and the measured results in [balance.md](balance.md).

Since rules version `killer-fuse-4` (now `killer-fuse-5`, which changed only the bots and the lesson berry) the engine follows Killer Queen Black throughout: its movement, its sword combat with an attack button, and its timings. One Black unit ("u") is 11 art pixels here. What is deliberately ours, and what could not be checked against the original, is listed under "Deliberate differences" and "Not verified" below.

## Determinism

Two peers that step the same state with the same inputs must reach the same state, bit for bit. The engine keeps to these rules, and `tests/architecture.test.ts` checks the ones that can be checked from the source:

- `src/engine` imports nothing outside itself.
- No `Math.sin`, `cos`, `atan2`, `hypot`, `pow`, `**` or `Math.random`, no `Date` or `performance`, and no `process.env`.
- Every number in the state is an integer. Lengths are subpixels: one art pixel is `S = 1024`. Speeds are subpixels per step, times are steps. Ratios such as the 1.3 speed multiplier are integer fractions (`13 / 10`).
- Randomness comes from one mulberry32 stream kept in the state (`rng`). Only bots draw from it.
- The state is plain data: numbers, booleans, strings, arrays and plain objects. It survives `structuredClone` and a JSON round trip, so a rollback snapshot is a copy.
- One step is 1/60 s. The network runs three steps per 50 ms tick.

`hashRound` gives 16 hex characters over the whole state except `events`. The headless runner plays every game twice and fails if the two final hashes differ.

## Public surface

Everything is exported from `src/engine/index.ts`.

| Export                                                         | What it is                                                                                   |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `RULES = "killer-fuse-5"`                                      | Bumped on any behaviour change; peers on different rules refuse each other                   |
| `TICK_HZ = 60`, `MAX_PLAYERS = 6`, `S = 1024`, `UNIT = 11 * S` | Step rate, seats, subpixels per art pixel, one Black unit                                    |
| `teamOf(slot)`, `isQueenSlot(slot)`                            | `slot % 2` and `slot < 2`: slots 0 and 1 are the Queens, 2 to 5 the Workers                  |
| `createRound(options: RoundOptions): Round`                    | A new round: `{ seed, mapId?, botLevel?, humans?, teamLevels?, passive?, lesson? }`          |
| `stepRound(state, inputs): Round`                              | One step, in place. `inputs[slot]` is read for slots people play; a missing one is neutral   |
| `timedOut(state)`                                              | True once the five-minute clock, not a victory, decided the round                            |
| `viewOf(state): RoundView`                                     | What a renderer draws, in art pixels                                                         |
| `Input`, `NEUTRAL`                                             | `{ left, right, down, held, pressed, attack }`; `pressed` and `attack` are button edges      |
| `packInput`, `unpackInput`, `INPUT_*`                          | An input as six bits (`INPUT_ATTACK = 32`, `INPUT_MASK = 63`)                                |
| `cloneRound(state)`, `hashRound(state)`                        | A deep copy, and the hash peers compare                                                      |
| `MAPS`, `MAP_IDS`, `arenaOf(id)`, `isMapId(value)`             | The three maps as data, and a map in subpixels                                               |
| `MAP_WIDTH = 480`, `MAP_HEIGHT = 270`                          | Screen size in art pixels                                                                    |
| `wrapX(x)`, `wrapDelta(to, from)`, `standingOn(arena, x, y)`   | The horizontal wrap, and the platform under a feet point                                     |
| `BOT_LEVELS`, `BOT_LEVEL_ORDER`, `botInput(state, slot)`       | Bot levels and the controls a bot holds this step                                            |
| `moveUnit(unit, input, arena)`, `halfOf`, `heightOf`           | One unit's own motion, and the upright body sizes                                            |
| `COLLIDERS`, `HIT_BOXES`, `WEAPONS`                            | The box tables of `shapes.ts`                                                                |
| `colliderOf(unit)`, `hitBoxesOf(unit)`, `weaponOf(unit)`       | A unit's movement box, hit boxes and weapon for the state it is in                           |
| `lethal(unit)`                                                 | Whether its weapon kills on this step                                                        |
| `LESSONS`, `LESSON_SLOT = 2`                                   | The tutorial lessons a round can be set up for, and the seat the Worker lessons are made for |
| Everything in `tuning.ts`                                      | Every tunable number, each with a comment saying whether it is the original's figure or ours |

Types: `Round`, `RoundOptions`, `Input`, `Unit`, `UnitKind`, `LooseBerry`, `GateState`, `Snail`, `GameEvent`, `BotMind`, `BotGoal`, `BotLevel`, `VictoryKind`, `Lesson`, `MapDef`, `MapId`, `Arena`, `Rect`, `Point`, `GateDef`, `GateKind`, `PileDef`, `RoundView`, `UnitView`, `GateView`, `LevelRules`, `Box`, `Collider`, `Ratio`.

## State

`Round` (`types.ts`):

| Field            | Meaning                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| `rules`, `mapId` | Rules version and the map                                                    |
| `seed`, `rng`    | The round's seed and the current value of the random stream                  |
| `botLevel`       | Level of the bots                                                            |
| `teamLevels`     | Level per team; differs from `botLevel` only in headless level-vs-level runs |
| `humans`         | Per slot: true when a person plays it                                        |
| `passive`        | Tutorial rooms: bots hold no controls                                        |
| `step`           | Steps simulated                                                              |
| `units`          | Six `Unit`s, by slot                                                         |
| `piles`          | Berries left per map pile                                                    |
| `loose`          | Dropped and kicked berries                                                   |
| `holes`          | Per team, per hive hole: filled or not                                       |
| `gates`          | Per gate: `owner` (team or -1) and `user` (slot or -1)                       |
| `snail`          | `x`, `vx`, `rider`, `victim`, `eat` (steps left of the meal), `facing`       |
| `eggs`           | Queen lives left per team                                                    |
| `winner`         | `{ team, kind }` or null                                                     |
| `bots`           | Six `BotMind`s: bot memory is ordinary state                                 |
| `events`         | What happened on the last step, in order; cleared at the start of a step     |

A `Unit` is at `x` (centre) and `y` (feet), with `vx`, `vy`, `facing`, `ground` (platform index or -1), `kind` (`worker`, `warrior`, `queen`) and `speed`. Its motion remembers `coyote`, `jumping` and `jumpStep` (a Worker's jump), `flaps` (steps of thrust left in each of up to five flaps), `takeoff`, `light` (the weaker gravity until the next landing), `buffer` (a remembered press), `downHeld` and `diving`. Combat adds `attack` (the step of the running attack, 0 when another may start), `dashing`, `attackBuffer`, `stun` and `regular` (the stun came from a glance). The rest is `carrying`, `gate` and `gateProgress`, `deposit` and `depositStep`, `invuln`, `dead` and `respawn`, `riding`, `eaten`, `mountWait`, and `flapped` for the renderer.

### Events

| Event                                      | When                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| `attack { slot }`                          | An attack began: a sword dash                                                   |
| `glance { a, b, x, y }`                    | Sword met sword; nobody dies                                                    |
| `bounce { a, b, x, y }`                    | Two enemy bodies bumped and were thrown apart                                   |
| `stomped { slot, by, x, y }`               | `by` landed on `slot`'s head and sprang off                                     |
| `kill { victim, killer }`                  | A Worker or Warrior died                                                        |
| `queenKill { victim, killer, eggsLeft }`   | A Queen died                                                                    |
| `respawn { slot, egg }`                    | A unit is back; `egg` is the spare egg a Queen hatched from, -1 for anyone else |
| `berryPickup { slot, pile }`               | `pile` is -1 for a loose berry                                                  |
| `berryDrop`, `berryKick { slot }`          | A carrier lost its berry; a unit kicked a resting one                           |
| `depositStart { slot, team, hole }`        | A Worker climbed into a hive hole                                               |
| `berryDeposit { slot, team, hole }`        | Its berry counts, 1.5 s later                                                   |
| `berryKickIn { slot, team, hole }`         | A loose berry filled a hole                                                     |
| `gateOffer`, `gateLock { slot, gate }`     | A Worker began offering its berry; the gate took it                             |
| `gateUse { slot, gate, kind, x, y }`       | It stepped out transformed, at `x`, `y`                                         |
| `gateClaim { slot, gate, team }`           | A Queen tagged a gate                                                           |
| `snailMount { slot }`                      | A Worker mounted                                                                |
| `snailCatch`, `snailEat { victim, rider }` | The snail caught a Worker; the meal ended in its death                          |
| `snailFree { victim }`                     | The Worker in the mouth was let go                                              |
| `victory { team, kind }`                   | The round is decided                                                            |

`x` and `y` on `glance`, `bounce`, `stomped` and `gateUse` are whole art pixels. The type also keeps `bump` and `berryRegrow`, which the engine no longer emits, so older users of the type still compile.

## View

`viewOf` returns a `RoundView` in art pixels: `map` (the `MapDef`), `step`, `units`, `piles` with counts, `loose`, `hives` (per team, every hole and whether it is filled), `gates` (`GateView`: kind, `owner`, `user`, `progress` from 0 to 1), `snail` (position, `facing`, `rider`, `victim`, `eating` from 0 to 1), `eggs`, `spares` (per team, each spare egg's spot and whether it is still there), `hatching` (per team, the index in `spares` a dead Queen will hatch from, or -1), `berries` (filled holes per team), `winner`, `timeLeft` (whole seconds), `timeUp` and `events`.

A `UnitView` has the position, `kind`, `speed`, `facing`, `grounded`, `moving`, `flapped`, `diving`, `dashing`, `attacking` (the weapon kills on this step), `attackStep`, `stunned` and `stun`, `locked` (in a gate's lock), `depositing`, `carrying`, `invulnerable`, `dead`, `respawn` from 0 to 1, `riding`, `eaten` and `bot`. View numbers may be fractions; nothing in the view feeds back into the state.

For the renderer: a dashing unit's movement box is lifted off its feet (0.29 u for a Warrior, 0.67 u for a Queen), so during a dash along a floor `y` can read up to that much below the floor's top.

## One step

`stepRound` runs in this fixed order:

1. Bots decide: each bot slot gets its input from `botInput`.
2. Timers: the dead count down to their respawn, invulnerability and the mount delay run out.
3. Every living unit that is not carried or held moves on its own (`moveUnit`): the attack press, facing, jump or take-off, flaps and gravity, the dash or steering, then a move against the platforms with the wrap.
4. The snail: mounting, hopping off, crawling, eating.
5. Combat: glances, then kills, then bodies.
6. Berries: pickups, deposits, loose berry physics, kicks.
7. Gates: claims by Queens, Workers offering, locking and stepping out.
8. Victory: military, then economy, then snail.

The step after 300 s of play only decides the round by the clock. When both teams could take the same thing on the same step (a berry, the snail, a gate, or a victory), the team served first is a coin flipped from the seed and the step number (`firstTeam`).

## Rules as built

Controls are a stick, a jump / flap button and an attack button. `pressed` and `attack` are edges: holding either button repeats nothing.

- **Worker.** Runs at 7 u/s (77 px/s) and stops dead when the stick is let go. The button jumps at 14 u/s; holding it keeps pushing, so the jump height runs from 0.86 u (a tap) to 3.8 u (42 px, a full hold). A press up to 3 steps before landing still jumps, and so does one up to 3 steps after walking off a ledge. Carries one berry. A Worker has no weapon.
- **Warrior and Queen.** A press in the air starts a flap: 0.3 s of upward push. Up to five run at once and add up, so presses about 0.37 s apart hold a height and faster ones climb, to at most 10 u/s. A press on the ground is a take-off. They fly at 6 u/s sideways and walk at 5.6 u/s. The press rate against height gained is tabled in [balance.md](balance.md).
- **Dive.** A Queen who presses down in the air dives at 20 u/s for as long as down stays held. Her blade kills whatever it touches from any side.
- **Attack.** The attack button starts a sword dash. A Warrior's is lethal on steps 1 to 19, carries it 5.07 u and may be repeated every 44 steps; a Queen's is lethal on steps 1 to 17, a flat 16 u/s, every 36 steps. A press up to 6 steps early is remembered. The dash goes the held way unless that opposes the unit's motion; a flap during a Warrior's dash bends it into an arc. A dash ends at a wall it meets squarely; a body that sticks out below the wall slips under and a Queen that sticks out above is lifted onto the ledge.
- **Combat** (`combat.ts`), for each pair of enemies in this order:
  1. Two lethal weapons that touch, with their owners facing each other, **glance**: nobody dies, both attacks end, both are stunned for 21 steps and thrown apart.
  2. A lethal weapon that touches an enemy's hit box **kills**, when the enemy is in front of the attacker and no platform is on the line between them. So a hit from behind always kills, and two fighters can kill each other on the same step.
  3. Bodies that touch **bounce**. One that overlaps the other by less than 0.2 u from above springs off its head (`stomped`) and nobody is hurt. Anything else is a bump: both are stunned and thrown apart sideways at 10 u/s, and a dash ends. A bump's stun does not block attacking, so a bumped Warrior can dash at once.

  Teammates never interact. Invulnerable units, a Worker locked in a gate or sitting in a hive hole, and a Worker in the snail's mouth take no part.

- **Death.** A unit respawns after 3.2 s, invulnerable for 2.2 s. A Warrior comes back as a plain Worker on its spawn point. A Queen has three lives: she hatches in the air above the next of her two spare eggs, and her third death loses the game. Tagging a gate ends a Queen's invulnerability.
- **Berries.** Each pile holds a fixed number and nothing grows back. A Worker picks one up by touching a pile or a loose berry, and banks it by touching an open hole of its own hive: it sits in the hole for 1.5 s, untouchable, then the berry counts, and 0.56 s later it pops out, invulnerable for 2.2 s. A carrier that dies drops the berry. A unit that cannot pick up a resting berry kicks it straight up at 5 u/s; a flying berry is knocked away by bodies and the snail, and one that comes to an open hole fills it for that hive's team.
- **Gates.** A Worker holding a berry that stands still in a gate offers it for 0.5 s; moving, jumping or the enemy Queen tagging the gate cancels the offer, and the Worker can be killed. Then the gate locks it in for 2.0 s, untouchable, and it steps out transformed and invulnerable for 2.2 s. A warrior gate makes a Warrior, a speed gate a speed Worker (1.3 times run, flight and snail speed), and a speed Worker in a warrior gate a speed Warrior. A gate is neutral until a Queen touches it; then only her team may use it until the other Queen does. One Worker uses a gate at a time.
- **Snail.** A Worker standing wholly on the snail mounts it. It crawls toward that Worker's own goal at 0.8 u/s, only while the rider holds that way. An enemy Worker at its head is caught: the snail halts for a 5 s meal (3.5 s with a speed rider) and then the Worker dies. The rider being killed frees the Worker. The button hops the rider off, but not during a meal. Reaching the goal wins.
- **Clock.** After 300 s the team with more Queen eggs wins, then more berries banked, then the snail nearer its goal, then a coin flip from the seed.
- **Wrap.** The screen wraps horizontally for units, berries and distances, except where a map has walls. The snail stays between its goals.

## Tutorial rounds

Two options make a round fit for a lesson; both are deterministic and travel as room settings (see [online.md](online.md) for the room).

- `passive: true`: every bot holds no controls. Nobody attacks the learner, the enemy Queen stays where she hatches, and bots draw nothing from the random stream.
- `lesson`: `"berries"` and `"warrior"` lay one berry at rest two units from seat 2's spawn, on its own platform and clear of the other spawns (on map 2, whose spawn ledge is too short, the berry rests on the platform below that spot, where walking off the ledge lands the learner on it). `"snail"` starts the snail a quarter of the way from Cyan's goal, facing it. `"queen"` changes nothing on the map. Gates are neutral at the start of every round and passive Queens claim none, so a warrior gate is always free.

The lessons are made for a Cyan learner: seat 2 for the Worker lessons, seat 0 for the Queen's.

## Deliberate differences from Killer Queen Black

- Teams are three (a Queen and two Workers) on six seats, not four on eight.
- Three bot levels fill the empty seats.
- The three maps are the arcade's day, dusk and night maps ported to a 480 by 270 screen, not Black's maps.
- A game is decided by the clock after 300 s.
- The sword is the only weapon: no mace, laser or other Black weapons.
- The stick has no "up": flying is only ever the button.

## Not verified against the original

These were built from the figures we were given and could not be checked frame by frame:

- A full Worker jump tops out on step 22 and lands on step 46; the figures we were given suggest 24 and 50.
- The glance throw is scaled along the longer axis of the line between the two units (no square root) and capped at 10 u/s on each axis.
- The hole a kicked berry snaps into, and the Queen's guard against standing up under a ceiling, test squares rather than circles.
- A flying berry bounces off the snail's whole body box.
- A Warrior comes out of a gate standing on the gate's floor.
- A dash ending on a floor or ceiling cannot happen here: a dash has no vertical speed of its own, so that branch of the original is unreachable.
- The rule that lets a Warrior slip under a wall only when its lower quarter is below the wall's middle matters only for walls thinner than 6.3 px, which the three maps do not have.
- The bump event is named `bounce`, the name the renderer already used.

## Maps

A map is data (`maps.ts`): solid rectangles, hive holes per team, gates, berry piles, the snail's track and nets, six spawn points and the spare eggs' spots, all in art pixels on the 480 by 270 screen with y growing downward. A map is written as its left half plus whatever sits on the centre line, and mirrored, so both sides are identical. Team 0 (Cyan) lives on the left and rides the snail to the left goal.

- **Map 1, "Day".** Both hives sit near the top centre, and the snail runs along the ground.
- **Map 2, "Dusk".** The hives are tall walls in the middle whose holes are reached by jumping from the ledge under them or dropping past them from above.
- **Map 3, "Night".** The snail walks a platform across the middle of the screen with its goals nearer the centre than on the other two maps.

## Files

| File         | Holds                                                      |
| ------------ | ---------------------------------------------------------- |
| `tuning.ts`  | Every number, with its source                              |
| `types.ts`   | State, input and event types                               |
| `maps.ts`    | The three maps, mirroring, the wrap                        |
| `shapes.ts`  | Movement boxes, hit boxes and weapons per unit state       |
| `rng.ts`     | mulberry32 on the state, integer draws                     |
| `round.ts`   | `createRound` and the lesson setups                        |
| `step.ts`    | `stepRound`, the victory check and the clock               |
| `motion.ts`  | One unit's own motion: jump, flight, dive, dash, platforms |
| `units.ts`   | Shared helpers: touching, death, respawn, turn order       |
| `combat.ts`  | Glances, kills, bumps and head bounces                     |
| `berries.ts` | Piles, carrying, loose berries, hive holes                 |
| `gates.ts`   | Gates and claims                                           |
| `snail.ts`   | The snail                                                  |
| `nav.ts`     | Bot navigation tables derived from a map                   |
| `bot.ts`     | Bot decisions and steering                                 |
| `view.ts`    | `viewOf`                                                   |
| `codec.ts`   | Input bits, clone, hash                                    |

## Tests

`tests/engine-*.test.ts` cover the rules, `tests/bot-*.test.ts` the bots and the headless runner, and `tests/architecture.test.ts` the import and determinism rules. Run them with:

```sh
node --import tsx --test games/killer-fuse/tests/*.test.ts
```

Line coverage of `src/engine` is 100% and branch coverage 99.1% (c8 over the engine, bot and architecture tests).

## Open points

- No person's play has been measured. Every figure in [balance.md](balance.md) comes from bots.

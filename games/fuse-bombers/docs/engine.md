# Engine contract

`src/engine/` is the deterministic simulation of one Fuse Bombers round (plus a tiny match tracker). It has no DOM,
Phaser, npm or `node:` imports; everything else imports it through `src/engine/index.ts`. Design intent is in
[design.md](design.md); this page is the API that render, input/lobby and bot code build on.

## World and time

- Logical arena: `ARENA_WIDTH × ARENA_HEIGHT` = **1600 × 900** pixels, **y grows downward**. Scale this box to the
  screen; never convert units inside the engine.
- Fixed step: `TICK_HZ = 60`, `DT = 1/60`. One `step()` call = one tick. The app accumulates real time and calls `step`
  the right number of times; render interpolation (if any) is the renderer's business.
- Angles are radians in math convention: `0` = pointing right, `π/2` = straight up, `π` = pointing left. A rocket fired
  at angle `a` with speed `v` starts with velocity `(cos a · v, −sin a · v)`.
- Deterministic: a round is a pure function of `RoundConfig` and the sequence of `pressed` arrays, bit for bit on
  every JS engine, so an online replay of one input log agrees across browsers (the helper's bits were compared on V8
  and SpiderMonkey; JavaScriptCore has not been run). The RNG (mulberry32) state lives in `state.rng`; there is no
  `Math.random`, `Date` or wall clock. Numbers are plain doubles, combined only with operations IEEE 754 rounds exactly
  (`+ − × ÷`, `Math.sqrt`, `floor`, `round`, …). The `Math` functions the language leaves approximated (`sin`, `cos`,
  `atan2`, `hypot`, `exp`, `log2`, `pow`, `**` and the rest) differ in their last bits between engines and are refused
  in `src/engine/`; the engine uses `src/engine/det-math.ts` for the six it needs: fdlibm's algorithms in plain
  arithmetic, within an ulp or two of `Math`. [tests/architecture.test.ts](../tests/architecture.test.ts) refuses the
  banned forms, and `tests/engine-det-math.test.ts` pins the helper's bits.

## Lifecycle

```ts
import {
  createRound,
  step,
  predictTrajectory,
  type RoundView,
} from "../engine/index.js";

const round = createRound({ seed: 1234, playerCount: 4 }); // optional `tuning: Partial<Tuning>`
// every tick:
const events = step(round, pressed); // pressed[playerId] = button went DOWN this tick
render(round as RoundView, events);
if (round.result) {
  /* round over: keep stepping a second or two for the aftermath, then next round */
}
```

- `createRound(config)` → `RoundState`. Throws `RangeError` for `playerCount` outside 2..6. Every arena is fair: each
  castle can hit each other castle with some angle in its arc, both at spawn and in the duel the two would end up in
  (arcs narrowed toward each other). An arena that fails the check is re-rolled from a seed derived from `seed` (and
  after a few failures with lower peaks), so the same seed always gives the same arena.
- `step(state, pressed)` mutates `state` in place and returns the events of **this one tick** (also on `state.events`,
  which is replaced by the next `step`). An app that runs several steps per frame must collect the arrays of every call
  and hand all of them to render and audio, or it drops events. `pressed` is an **edge** per player id; missing entries
  count as `false`. A press only fires when the castle `isLoaded`. It fires at the angle the castle had _before_ this
  step, i.e. the angle the player was looking at. Once a player's castle is destroyed, the same button drives their
  ghost bomber (see Rules), which drops from where the blimp was _before_ this step when `isGhostLoaded`.
- After `state.result` is set (`phase === "over"`) `step` keeps moving rockets and carving craters for the aftermath but
  never fires, drops ghost bombs, damages (no `hit` or `ghost-bomb-hit`) or changes the result again.
- `view(state)` returns the same object typed as `RoundView` (deep read-only, without the RNG state and the spawn
  schedule, which would let a bot see the future). Hand render and bots a `RoundView`; only the app loop holds the
  mutable `RoundState`. Everything is plain data, so `structuredClone(state)` works.

Match helper (first to N wins, default 3): `createMatch({ seed, playerCount, winsToWin? })`,
`nextRoundConfig(match)` (derives a fresh seed per round), `recordRoundResult(match, result)` → match winner or null.
Draws count for nobody.

## The view (`RoundView`)

| Field                   | Meaning                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tick`                  | Ticks simulated so far.                                                                                                                                                  |
| `phase`                 | `"playing"` → `"sudden-death"` (fuse burnt out) → `"over"`.                                                                                                              |
| `result`                | `null` or `{ winner: id \| null, reason: "last-standing" \| "wipeout" \| "timeout", tick }`.                                                                             |
| `fuseTicks`, `maxTicks` | Fuse length (90 s) and hard stop (180 s). `fuseProgress(view)` gives 0..1 for the fuse bar.                                                                              |
| `terrain`               | `surface[column]` = y of the ground top per 1-px column (solid below). `version` bumps on change; `bedrock` is indestructible.                                           |
| `castles[id]`           | See below. `id` = player index, castles ordered left to right.                                                                                                           |
| `rockets[]`             | `{ id, owner, x, y, vx, vy, power, mega, bomb, ghost, gates, age }`. `owner` −1 = sudden-death bomb; `ghost`: from `owner`'s ghost. `power` > 1 if capped (draw bigger). |
| `gates[]`               | `{ id, multiplier, x, y, width, height, spawnTick, expireTick, … }` axis-aligned rectangle centred on `x, y`.                                                            |
| `crates[]`              | `{ id, card, x, y, radius, spawnTick }`. Cards: `unit`, `shield`, `rapid`, `repair`, `mega`.                                                                             |
| `ghosts[]`              | Ghost bombers of eliminated players: `{ owner, x, y, vx, reloadTicks, reloadTotalTicks, … }`, in the order they fell. `ghostOf(view, id)` finds one.                     |
| `tuning`                | The resolved `Tuning` (castle size, shield radius, reload, … everything the renderer needs).                                                                             |

Castle fields: `x, y` (ground contact, bottom centre), `hp / maxHp`, `alive`, `angle`, `arcMin / arcMax`, `sweepDir`,
`facing` (`"left" | "right" | "both"`), `reloadTicks / reloadTotalTicks` (reload ring), `units` (rockets per volley),
`shieldHp`, `megaReady`, `volleyLeft` (rockets still to leave the barrel), and `stats` (volleys, rocketsFired,
damageDealt, kills, gateSplits, crates, ghostBombs, ghostDamage) for an end-of-round screen. `damageDealt` and `kills`
include what the player's ghost did. Geometry helpers: `castleCenter(c, tuning)` (hit circle and shield centre),
`launcherPivot(c, tuning)`, `launchState(c, tuning, angle)`.

## Events (`TickEvent`, discriminated on `type`)

Every event carries the `tick` that produced it. `step` returns one tick's events only (see Lifecycle).

| type                            | payload                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `fired`                         | `castleId, angle, units, mega` — a volley started (rockets leave over the next ~0.1–1 s). |
| `gate-split`                    | `gateId, multiplier, owner, x, y, created` (`created` < multiplier−1 when capped).        |
| `hit`                           | `castleId, owner, x, y, damage, shielded, splash`.                                        |
| `shield-popped`                 | `castleId`.                                                                               |
| `crater`                        | `owner, x, y, radius, x0, x1` (changed columns, inclusive). Can be many per tick.         |
| `rocket-exploded`               | `owner, x, y, cause` — blew up without a crater (`"ground"` on bedrock, or `"expired"`).  |
| `castle-destroyed`              | `castleId, by, x, y` (`by` −1 = bomb). Then `ghost-spawned` for that player.              |
| `ghost-spawned`                 | `owner, x, y` — the blimp appears above the wreck.                                        |
| `ghost-bomb-dropped`            | `owner, rocketId, x, y` — the bomb is `rockets[]` entry `rocketId` (`ghost: true`).       |
| `ghost-bomb-hit`                | `owner, rocketId, x, y, castleIds, damage` — it blew up (also a `hit` / `crater`).        |
| `crate-spawned`                 | `crateId, card, x, y`.                                                                    |
| `crate-taken`                   | `crateId, card, castleId, x, y`.                                                          |
| `gate-spawned` / `gate-expired` | `gateId` (+ `multiplier` on spawn).                                                       |
| `sudden-death-started`          | —                                                                                         |
| `round-over`                    | `result`.                                                                                 |

## Prediction (aiming guide and bots)

`predictTrajectory(view, castleId, angle = current, { maxTicks = 360, stopAtGate = false })` replays exactly the physics
a rocket fired on the next `step` would get (same integrator and sub-steps, gates at their future positions, castles
and shields, current terrain), without the per-rocket random spread. Returns:

- `points`: launch point then one point per tick until impact. The dotted guide draws a prefix (e.g. the first 20).
- `impact`: `{ kind: "terrain" | "castle" | "shield" | "offscreen" | "gate" | "timeout", x, y, tick, castleId }`.
- `gates`: gates crossed in order, with `multiplier` (so a bot can value a ×10 shot), and `crates` it would collect.

`futureAngle(view, castleId, ticks)` gives the launcher angle `ticks` steps from now (the sweep is deterministic), so a
bot with reaction time R can evaluate `predictTrajectory(view, id, futureAngle(view, id, R))` and press R ticks early.
Bots get no other privileged information. Gate motion is also a pure function: `gatePositionAt(gate, tick)`.

Ghosts: `ghostPositionAt(ghost, tick)` gives the blimp's `{ x, y, vx }` at any tick, and `predictGhostBomb(view, owner,
ticks = 0)` returns a `Trajectory` (empty `gates`/`crates`) for a bomb dropped `ticks` steps from now, or null without a
ghost. The renderer can use it for a drop guide.

## Bots

`src/engine/bot.ts` plays a castle with the same one button as a human, using only the view, `futureAngle` and
`predictTrajectory`.

```ts
import { createBot, type Bot } from "../engine/index.js";

const bot: Bot = createBot({ difficulty: "normal", playerId: 3, seed }); // "easy" | "normal" | "hard"
pressed[3] = bot(view(round)); // call once per tick, before `step`; true = press this tick

// For a `(view, playerId) => boolean` policy:
const bots = new Map(
  ids.map((id) => [id, createBot({ difficulty, playerId: id, seed })]),
);
const policy = (v: RoundView, id: number) => bots.get(id)?.(v) ?? false;
```

A bot is a closure with a little memory: call it every tick of a round. The view may be the live state or a fresh copy
each tick (a snapshot or `structuredClone` is fine). It resets itself when a new round starts, detected by the tick going
backwards or `config.seed` changing (not by object identity), so one bot can play a whole match. Its RNG is reseeded
each round from `seed` and the round's seed, so every round gets its own timing errors and a reused bot plays exactly
like a fresh one. It is deterministic given `seed` and the views it sees, and never mutates the view.

How it plays: while reloading it evaluates one candidate shot per `thinkEvery` ticks (the angle `reaction` ticks ahead)
and scores it: a hit on an opponent, weighted towards the weakest castle, the leader and whoever hit it last; near misses
partly; gate multipliers multiply the value and crates add to it. Each score is smoothed with its neighbouring angles
(timing is never exact), and once loaded the bot presses when a shot is close to the best of the last sweep, relaxing
its standards the longer it waits. The press lands up to `timingError` ticks early or late.

An eliminated bot flies its ghost: when loaded it predicts the drop `reaction` ticks ahead with `predictGhostBomb` and
presses (with the same timing error) when the bomb would hit a castle or land within `ghostSlack` of one (easy 70 px,
normal 40, hard 25).

| Difficulty | Timing error | Thinks every | Other                                                  |
| ---------- | ------------ | ------------ | ------------------------------------------------------ |
| easy       | ±10 ticks    | 4 ticks      | often fires a nervous random shot, barely values gates |
| normal     | ±3 ticks     | 2 ticks      | likes gates and crates, some focus on weak castles     |
| hard       | ±1 tick      | 1 tick       | picky, hunts gates and crates, finishes low-HP castles |

Measured headlessly (bot-only rounds, `seed` 1..30 per pairing, sides swapped): easy beats "fire whenever loaded" 19 of
30 two-player rounds, normal beats easy 28/30, hard beats easy 29/30 and normal 23/30. Median round length with all
castles on one difficulty (20 seeds, 2–6 players): hard 31–60 s, normal 42–89 s, easy 95–128 s (easy rounds usually
need sudden death); none needed the 180 s hard stop. `predictTrajectory` costs ~70 µs, so five hard bots cost ~0.2 ms
per tick on average (p99 0.7 ms).

## Rules as implemented (defaults in `DEFAULT_TUNING`)

- **Terrain**: height map with rolling hills, a tall peak between each neighbouring pair of castles (and extra hills in
  wide gaps), flattened pads under castles. Every explosion carves a circular crater: each column the circle spans is
  cut down to the circle's bottom (a height map has no overhangs, so rock above it goes too), and 1–2 px needles left
  beside a crater are levelled with their higher neighbour. Castles fall onto the highest ground under their footprint.
- **Aim**: edge castles sweep a one-sided arc (8°–89° above the horizon, mirrored) in 1.5 s; middle castles sweep
  10°–170° in 2.4 s. When all living opponents are on one side, the arc narrows to that side. The steep end matters:
  neighbours in a 5–6 player arena stand 225–345 px apart behind a tall peak and can only be reached with a lob of
  about 85°. `createRound` guarantees every pair can hit each other (see Lifecycle).
- **Volleys**: launch speed 900 px/s, gravity 500 px/s². `units` rockets (start 5, max 30) leave every 5 ticks (packed
  tighter for big volleys so a volley lasts ≤ 1 s) with ±1.2° / ±1.5 % spread. Reload 2.6 s (first shot after 1.2 s).
- **Damage**: castle HP depends on the player count: 280 / 220 / 150 / 130 / 120 for 2 / 3 / 4 / 5 / 6 players, so
  small rounds do not end too fast and big ones not too slow. Direct rocket hit 4; ground explosion within reach of a
  castle deals 50 % splash. Own rockets never hurt their own castle or shield. A dying castle leaves a big crater.
- **Gates**: 3 (2–3 players) or 4 (4+ players) gates of ×2/×3/×5/×10 (weights 4/3/2/1) drift slowly and bob, live
  14–22 s and respawn elsewhere. Each gate drifts in its own lane, at least `gateSpacing` (80 px) from every other
  gate's lane, so gates never overlap; a new lane also avoids the crates present when it spawns. A rocket inside a gate splits into `multiplier` rockets fanned over up to 22°; every
  child remembers the gate so a lineage multiplies once per gate.
- **Rocket cap**: 1500 live rockets. Splits stop creating rockets at 1350 (the remaining 150 are reserved so volleys
  and bombs still appear) and instead multiply the `power` of the rockets that exist, so damage is conserved. Ghost
  bombs bypass the cap (there are only a few), so a loaded ghost's press always drops one.
- **Crates**: 2 (3 for 4+ players) floating crates, first at 3 s, respawn 5–9 s. The first rocket to touch one gives its
  owner the card: `unit` +1 rocket per volley, `shield` +50 shield HP (max 100, radius 60), `rapid` reload ×0.75 (min
  1.2 s), `repair` +40 HP, `mega` next volley does ×3 damage with ×2.5 craters. Rockets fly on through crates.
- **Fuse**: 90 s. Then sudden death: bombs (6 damage) fall near random living castles, from one per second to ten per
  second over 40 s, scattering less and less; all damage scales by `1 + suddenDeathSeconds / 30`. Bombs can be
  multiplied by gates too. At 180 s the round is decided on HP (tie = draw).
- **Ghost bombers** (`ghosts: true`): a destroyed castle's player gets a blimp at y 64 above the wreck. It drifts toward
  the middle at 110 px/s and bounces 40 px from the arena edges. Pressing drops a bomb (first after 2.5 s, then every
  3.5 s) that starts at 60 px/s downward with the blimp's `vx`. It deals 7 on a direct hit (a third of a 5-rocket
  volley, times the sudden-death scale; splash half), carves an 18 px crater, is never multiplied by gates and never
  takes crates. Ghosts cannot win: the round still ends when ≤ 1 castle stands, and they stop dropping once it is over.

Ghosts measured headlessly (bots only, all on one difficulty, seeds 1..20 per player count, the same seeds with
`ghosts: false`). Median round length without → with ghosts, and the ghosts' share of all damage (incl. sudden-death
bombs). 2-player rounds are unchanged (the first kill ends them). Rounds mostly get shorter because ghosts cut the
sudden-death tail (p90 never rose); none hit the 180 s stop.

| Bots   | 3p               | 4p               | 5p                | 6p                |
| ------ | ---------------- | ---------------- | ----------------- | ----------------- |
| easy   | 126 → 124 s, 3 % | 117 → 110 s, 8 % | 114 → 107 s, 13 % | 115 → 105 s, 10 % |
| normal | 89 → 88 s, 4 %   | 77 → 80 s, 11 %  | 98 → 64 s, 11 %   | 95 → 79 s, 13 %   |
| hard   | 41 → 48 s, 2 %   | 50 → 42 s, 6 %   | 66 → 51 s, 10 %   | 57 → 47 s, 7 %    |

Headless tuning with these defaults (30–60 seeds per player count; `tests/engine-balance.test.ts` asserts a smaller
version). The "decent aimer" looks 8 ticks ahead with `futureAngle` + `predictTrajectory`, presses when the shot would
land on or next to an opponent, and its press lands up to ±3 ticks (±50 ms) off:

| Script (all players)                     | 2p    | 3p    | 4p    | 5p   | 6p    | Ended before the fuse (90 s)         |
| ---------------------------------------- | ----- | ----- | ----- | ---- | ----- | ------------------------------------ |
| decent aimer, median round length        | 42 s  | 42 s  | 66 s  | 78 s | 76 s  | 98 % / 85 % / 88 % / 75 % / 78 %     |
| perfect aim (no reaction time, no error) | 38 s  | 29 s  | 39 s  | –    | 42 s  | 100 %                                |
| "fire whenever loaded"                   | 126 s | 129 s | 124 s | –    | 120 s | almost never: sudden death ends them |

One decent aimer against one "fire whenever loaded" player wins 58 of 60 two-player rounds, 51 of them before the fuse
(the spammer collects more crates, so it sometimes out-heals the aimer until the bombs fall). A full 6-player round
simulates in well under 0.1 s; the worst tick seen (~1350 live rockets) took ~4 ms. `createRound` takes 1–50 ms, most of
it the reachability check.

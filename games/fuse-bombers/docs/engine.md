# Engine contract

`src/engine/` is the deterministic simulation of one Fuse Bombers round (plus a tiny match tracker). It has no DOM,
Phaser, npm or `node:` imports; everything else imports it through `src/engine/index.ts`. Design intent is in
[design.md](design.md); this page is the API that render, input/lobby and bot code build on.

## World and time

- Logical world: `WORLD_WIDTH × WORLD_HEIGHT` = **4800 × 2700** pixels (the temple map, see below), **y grows
  downward**. The renderer frames it on screen; never convert units inside the engine.
- Fixed step: `TICK_HZ = 60`, `DT = 1/60`. One `step()` call = one tick. The app accumulates real time and calls `step`
  the right number of times; render interpolation (if any) is the renderer's business.
- Angles are radians in math convention, in [0, 2π): `0` = pointing right, `π/2` = straight up, `π` = pointing left,
  `3π/2` = straight down. A rocket fired at angle `a` with speed `v` starts with velocity `(cos a · v, −sin a · v)`.
- Deterministic: a round is a pure function of `RoundConfig` and the sequence of `held` arrays, bit for bit on
  every JS engine, so an online replay of one input log agrees across browsers (the helper's bits were compared on V8
  and SpiderMonkey; JavaScriptCore has not been run). The RNG (mulberry32) state lives in `state.rng`; there is no
  `Math.random`, `Date` or wall clock. Numbers are plain doubles, combined only with operations IEEE 754 rounds exactly
  (`+ − × ÷`, `Math.sqrt`, `floor`, `round`, …). The `Math` functions the language leaves approximated (`sin`, `cos`,
  `atan2`, `hypot`, `exp`, `log2`, `pow`, `**` and the rest) differ in their last bits between engines and are refused
  in `src/engine/`; the engine uses `src/engine/det-math.ts` for the six it needs: fdlibm's algorithms in plain
  arithmetic, within an ulp or two of `Math`. [tests/architecture.test.ts](../tests/architecture.test.ts) refuses the
  banned forms, and `tests/engine-det-math.test.ts` pins the helper's bits.

### Camera (render only)

`src/render/camera.ts` (defaults in `CAMERA_DEFAULTS`) reads positions and never feeds the simulation, so it may use
`Math` and frame time. `createCamera({ view, world })` once, `snapCamera` at a round's start, then each frame
`updateCamera(camera, { points }, dt)` gives `{ centerX, centerY, zoom }` for
`cameras.main.setZoom(zoom).centerOn(centerX, centerY)`. A shared screen frames `points` (gunships at weight 1; ghosts
or a big explosion lower pull it part of the way) with padding for the aim guide and health bar, fitted to the view,
zoomed between one old arena's area and the whole world, inside the world; no points shows the whole world. A personal
device (`focus`) follows its gunship with a look-ahead and adds the nearest opponents while they fit. The pose eases
exponentially (no overshoot; zoom in log space, out faster than in) with dead zones, and weight-1 points stay
`keepMargin` world px inside the view (world edge allowing) whatever the easing. `offscreenMarkers` gives off-screen ships an edge arrow; the HUD and arrows stay on the UI camera.

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
const events = step(round, held); // held[playerId] = UP | DOWN | LEFT | RIGHT | FIRE bits held this tick
render(round as RoundView, events);
if (round.result) {
  /* round over: keep stepping a second or two for the aftermath, then next round */
}
```

- `createRound(config)` → `RoundState`. Throws `RangeError` for `playerCount` outside 2..6 or a non-finite seed. The
  world is always the temple (`buildTempleGrid()`); the gunships start at rest at `spawnOrder(playerCount, seed)`, a
  spread, symmetric set of the map's spawn anchors (through `placeClear`, which leaves the anchors' open air as it is).
- `step(state, held)` mutates `state` in place and returns the events of **this one tick** (also on `state.events`,
  which is replaced by the next `step`). An app that runs several steps per frame must collect the arrays of every call
  and hand all of them to render and audio, or it drops events. `held[playerId]` is the input bits that player holds
  this tick (`UP 1, DOWN 2, LEFT 4, RIGHT 8, FIRE 16`, exported with `INPUT_MASK` and `isInput`); a missing entry, or
  one that is not an integer of those bits (`isInput`: NaN, fractions, negatives, 32 and up, non-numbers), holds
  nothing, and entries past the last seat are ignored. The directions steer the gunship (see "Flight" under Rules). A
  **fire press is the rising edge of `FIRE`** against the bits of the previous step, kept per seat in
  `state.lastHeld` (plain data, so a clone carries it): holding fire fires once at most, and only a release and a new
  press fires again. A press fires only when the castle `isLoaded`, at the angle it had _before_ this step (the angle
  the player was looking at) and from where it was then: the volley's first rocket leaves before the gunship moves.
  Once a player's castle is destroyed, the same bits fly their ghost bomber (see Rules), whose fire press drops from
  where the blimp was _before_ this step when `isGhostLoaded(ghost, terrain)` (reloaded, and the blimp in the open: a
  press with the blimp inside rock is ignored).
- After `state.result` is set (`phase === "over"`) `step` keeps moving rockets, gunships and ghosts and carving craters
  for the aftermath but never fires, drops ghost bombs, damages (no `hit` or `ghost-bomb-hit`) or changes the result
  again.
- `view(state)` returns the same object typed as `RoundView` (deep read-only, without the RNG state and the spawn
  schedule, which would let a bot see the future). Hand render and bots a `RoundView`; only the app loop holds the
  mutable `RoundState`. Everything is plain data, so `structuredClone(state)` works.

Match helper (first to N wins, default 3): `createMatch({ seed, playerCount, winsToWin? })`,
`nextRoundConfig(match)` (derives a fresh seed per round), `recordRoundResult(match, result)` → match winner or null.
Draws count for nobody.

## The view (`RoundView`)

| Field                   | Meaning                                                                                                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tick`                  | Ticks simulated so far.                                                                                                                                                                                           |
| `phase`                 | `"playing"` → `"sudden-death"` (fuse burnt out) → `"over"`.                                                                                                                                                       |
| `result`                | `null` or `{ winner: id \| null, reason: "last-standing" \| "wipeout" \| "timeout", tick }`.                                                                                                                      |
| `fuseTicks`, `maxTicks` | Fuse length (90 s) and hard stop (180 s). `fuseProgress(view)` gives 0..1 for the fuse bar.                                                                                                                       |
| `terrain`               | The temple's grid (see "Bitmap terrain" below) as the read-only `TerrainView`: 4 px cells of air, rock and indestructible rock; `version` bumps on every carve. The grid queries take it, `carveCircle` does not. |
| `castles[id]`           | See below. `id` = player index (seat).                                                                                                                                                                            |
| `rockets[]`             | `{ id, owner, x, y, vx, vy, power, mega, bomb, ghost, gates, age }`. `owner` −1 = sudden-death bomb; `ghost`: from `owner`'s ghost. `power` > 1 if capped (draw bigger).                                          |
| `gates[]`               | `{ id, multiplier, x, y, width, height, spawnTick, expireTick, … }` axis-aligned rectangle centred on `x, y`.                                                                                                     |
| `crates[]`              | `{ id, card, x, y, radius, spawnTick }`. Cards: `unit`, `shield`, `rapid`, `repair`, `mega`.                                                                                                                      |
| `ghosts[]`              | Ghost bombers of eliminated players: `{ owner, x, y, vx, vy, thrust, reloadTicks, reloadTotalTicks, spawnTick }`, in the order they fell. `ghostOf(view, id)` finds one.                                          |
| `lastHeld[id]`          | The validated input bits each seat held on the latest step (the next fire press is a rising edge against these). A checkpoint codec must refuse a length other than the seat count or an entry failing `isInput`. |
| `tuning`                | The resolved `Tuning` (castle size, shield radius, reload, … everything the renderer needs).                                                                                                                      |

Castle fields: `x, y` (the hull centre: centre of the hit circle and the shield; it moves as the gunship flies),
`vx, vy` (px/s), `thrust` (the direction bits it flew with on the latest step, for thrusters; 0 once destroyed),
`hp / maxHp`, `alive`, `angle` (in [0, 2π), turning counter-clockwise), `reloadTicks / reloadTotalTicks` (reload ring), `units`
(rockets per volley), `shieldHp`, `megaReady`, `volleyLeft` (rockets still to leave the barrel), and `stats` (volleys,
rocketsFired, damageDealt, kills, gateSplits, crates, ghostBombs, ghostDamage) for an end-of-round screen.
`damageDealt` and `kills` include what the player's ghost did. Geometry helpers: `castleCenter(c)` (the hull centre),
`launcherPivot(c, tuning)` (`launcherOffset` above it), `launchState(c, tuning, angle)`.

## Events (`TickEvent`, discriminated on `type`)

Every event carries the `tick` that produced it. `step` returns one tick's events only (see Lifecycle).

| type                            | payload                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `fired`                         | `castleId, angle, units, mega` — a volley started (rockets leave over the next ~0.1–1 s).                                               |
| `gate-split`                    | `gateId, multiplier, owner, x, y, created` (`created` < multiplier−1 when capped).                                                      |
| `hit`                           | `castleId, owner, x, y, damage, shielded, splash`.                                                                                      |
| `shield-popped`                 | `castleId`.                                                                                                                             |
| `crater`                        | `owner, x, y, radius, col0, row0, col1, row1` (changed cells, ends exclusive). Many per tick.                                           |
| `rocket-exploded`               | `owner, x, y, cause` — blew up without a crater (`"ground"` on hard rock, or `"expired"`).                                              |
| `castle-destroyed`              | `castleId, by, x, y` (`by` −1 = bomb). Then `ghost-spawned` for that player.                                                            |
| `ghost-spawned`                 | `owner, x, y` — the blimp appears above the wreck.                                                                                      |
| `ghost-bomb-dropped`            | `owner, rocketId, x, y` — the bomb is the `rockets[]` entry with `id === rocketId` (`ghost: true`), unless it blew up in the same step. |
| `ghost-bomb-hit`                | `owner, rocketId, x, y, castleIds, damage` — it blew up (also a `hit` / `crater`).                                                      |
| `crate-spawned`                 | `crateId, card, x, y`.                                                                                                                  |
| `crate-taken`                   | `crateId, card, castleId, x, y`.                                                                                                        |
| `gate-spawned` / `gate-expired` | `gateId` (+ `multiplier` on spawn).                                                                                                     |
| `sudden-death-started`          | —                                                                                                                                       |
| `round-over`                    | `result`.                                                                                                                               |

## Prediction (aiming guide and bots)

`predictTrajectory(view, castleId, angle = current, { maxTicks = 360, stopAtGate = false })` replays exactly the physics
a rocket fired on the next `step` would get (same integrator and sub-steps, rock along every sub-step's path with
`segmentHit`, gates at their future positions, castles and shields), without the per-rocket random spread. It starts
from where the gunship is now, which is where a press on the next step launches from however it flies (other
gunships are taken where they are now). Rock on the barrel gives a `terrain` impact at tick 0 where the barrel enters
it, the only point of `points` (see "Barrel" under Rules). Returns:

- `points`: launch point then one point per tick until impact. The dotted guide draws a prefix (e.g. the first 20).
- `impact`: `{ kind: "terrain" | "castle" | "shield" | "offscreen" | "gate" | "timeout", x, y, tick, castleId }`.
- `gates`: gates crossed in order, with `multiplier` (so a bot can value a ×10 shot), and `crates` it would collect.

`futureAngle(view, castleId, ticks)` gives the launcher angle `ticks` steps from now (the turn is steady), so a
bot with reaction time R can evaluate `predictTrajectory(view, id, futureAngle(view, id, R))` and press R ticks early.
Bots get no other privileged information. Gate motion is also a pure function: `gatePositionAt(gate, tick)`.

Ghosts fly where their player steers them, so their future is a guess. Prediction assumes **no input from now on**:
`ghostPositionAt(ghost, ticks)` gives the blimp's `{ x, y, vx, vy }` `ticks` steps from now as it coasts on its
momentum and brakes to a stop (in about 1.5 s; exactly what `step` does with no direction held), and
`predictGhostBomb(view, owner, ticks = 0, maxTicks = 300)` returns a `Trajectory` (empty `gates`/`crates`) for a bomb
dropped `ticks` steps from now from there, with the blimp's velocity, or null without a ghost and when the blimp would
be inside rock then (a press there drops nothing, see `isGhostLoaded`). With `ticks = 0` it is exact; the renderer
uses it for the drop guide.

## Bots

`src/engine/bot.ts` plays a castle with the fire button alone, using only the view, `futureAngle` and
`predictTrajectory`: it does not steer yet, so its gunship and ghost stay where they appear (until bots move into the
round state with flight, the next step of the overhaul). The app's `createBotPlayer` holds `FIRE` on the steps it
presses; it presses only when loaded, so each press is a fresh rising edge.

```ts
import { createBot, FIRE, type Bot } from "../engine/index.js";

const bot: Bot = createBot({ difficulty: "normal", playerId: 3, seed }); // "easy" | "normal" | "hard"
held[3] = bot(view(round)) ? FIRE : 0; // call once per tick, before `step`; true = press this tick

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
(timing is never exact), and once loaded the bot presses when a shot is close to the best of the last full turn, relaxing
its standards the longer it waits. The press lands up to `timingError` ticks early or late.

An eliminated bot plays its ghost: when loaded it predicts the drop `reaction` ticks ahead with `predictGhostBomb` and
presses (with the same timing error) when the bomb would hit a castle or land within `ghostSlack` of one (easy 70 px,
normal 40, hard 25). Since it does not steer, its ghost hovers above the wreck and seldom has anything below it.

| Difficulty | Timing error | Thinks every | Other                                                  |
| ---------- | ------------ | ------------ | ------------------------------------------------------ |
| easy       | ±10 ticks    | 4 ticks      | often fires a nervous random shot, barely values gates |
| normal     | ±3 ticks     | 2 ticks      | likes gates and crates, some focus on weak castles     |
| hard       | ±1 tick      | 1 tick       | picky, hunts gates and crates, finishes low-HP castles |

From the temple's spawn anchors aim rarely decides a round while bots do not fly (see the measurements under Rules). Lined
up in range in open air (`lineUp` in `tests/engine-helpers.ts`), hard beats easy in at least 9 of 12 duels
(`tests/engine-bot.test.ts`). Before the sky overhaul the difficulties were measured on the one-screen arena (git
history of this page has the numbers).

## Flight kernel

The flying gunships and ghosts of the sky overhaul ([design.md](design.md)); "Flight" under Rules says how the round
uses it. `index.ts` exports the input bits and `GUNSHIP_FLIGHT` / `GHOST_FLIGHT`.

- `src/engine/input.ts`: held bits `UP 1, DOWN 2, LEFT 4, RIGHT 8, FIRE 16`, `INPUT_MASK`, `isInput(value)` (runtime
  check for input crossing a boundary) and `thrustDirection(bits)` (opposites cancel, diagonals normalised to unit
  length).
- `src/engine/flight.ts`: `flyStep(body, bits, tuning, world)` advances one `{ x, y, vx, vy }` by one `DT` in place:
  thrust, linear drag (stronger `brakeDrag` when nothing is held, a dead stop below `stopSpeed`), a `topSpeed` cap, no
  gravity. `world` is `{ width, height, solidAt(x, y), rockless? }`: `solidAt` is constant over each 4 px cell
  (`CELL_SIZE`), is asked only about points in `[0, width) × [0, height)`, and is never called when `rockless` (what
  `openSky(width, height)` sets, for ghosts with `GHOST_FLIGHT`).
  - **Shape.** The body is a circle (`tuning.shape = flightShape(radius)`, a pure function: the rim probe offsets are
    built once, at module load, with no trigonometry). Rock is tested at rim probes on a ring about a pixel wider than
    the circle, at most 2 px apart, and moves are sub-stepped at `MAX_SUBSTEP` = 2 px, so the circle never overlaps a
    4 px cell and never tunnels through one, at any speed. A ship resting on rock sits within about a pixel of it.
  - **Sliding.** A blocked sub-step goes to the contact point and slides along the surface for the rest of its move.
    The surface normal is read off the rim probes that hit (a world edge gives its axis), the velocity into the
    surface bounces at `bounce` or, below `bounceMinSpeed`, just stops, and the part along it is kept. So a ship
    thrusting into a 15°, 30° or 45° ramp, a stair-stepped gentle rise or a sloped roof rides along it, and a steeper
    or jagged slope slows it without holding it (a slide stopped again within half its length falls back to moving
    along each axis alone). The return value is the fastest hit of at least `bounceMinSpeed` (0 for a ship pressing on
    a wall), for a bump sound or damage.
  - **Placing.** `placeClear(body, shape, world)` is for spawns: it moves a body to a nearby clear spot (within four
    radii, rings 2 px apart, up first), also when rock sits wholly inside its circle where the rim would never meet it.
    `flyStep` itself checks only the rim, so a body that starts clear stays clear, since rock never grows. A body that
    starts a step with its rim in rock and no clear spot in reach flies through rock until it is clear.
  - **`separate(bodies, shape, world)`** parts overlapping gunships (one shape for all of them) in index order, up to 12
    passes, symmetrically along the line between them, each push a sub-stepped move that slides along rock and edges, and
    removes their approach velocity. What one ship cannot move, the other takes. A pair the line cannot part (two ships
    in a shaft as wide as one, or exactly on top of each other with x blocked) is parted sideways. Nobody is pushed into
    rock or out of the world. The result depends on the order of `bodies`: pass them in seat order.
  - **State.** All four numbers of a body must be finite: flight does not repair NaN, so the checkpoint codec has to
    refuse it. Nothing is shared between calls.
- `GUNSHIP_FLIGHT` (thrust 400 px/s², top speed 200 px/s, drag 1.6/s, brake drag 2.4/s): half speed in 0.33 s, top
  speed in 1.07 s, a full reversal at top speed in 1.45 s, coasting to rest in 1.6 s. `GHOST_FLIGHT` is lighter and
  faster (top speed 260 px/s in 0.78 s). The tests assert ranges around these. Cost, measured on a 4800 × 2700 bitset
  terrain with hills and islands (Node 24, `flyStep` for six gunships plus one `separate` per step): about 4 µs at rest,
  7 µs flying with random 20–80 tick holds, 12 µs with all six pressing into the ground; six ghosts in `openSky` about
  3 µs.

## Rules as implemented (defaults in `DEFAULT_TUNING`)

- **World**: the temple (`buildTempleGrid()`, see below), 1200 × 675 cells of 4 px. Every explosion carves a circle
  (`carveCircle`) out of the rock, never out of its hard cells; nothing falls.
- **Castles** (gunships) start at rest at their spawn anchors (`spawnOrder`), each a hit circle of radius 34 round its
  `x, y`. Anchors are spread over the map, so a gunship has to fly to get in range.
- **Flight**: each step, after firing, every living gunship runs `flyStep(castle, held & (UP | DOWN | LEFT | RIGHT),
GUNSHIP_FLIGHT, world)` in seat order, where `world` is the round's grid seen through `solidAt` (one adapter per grid
  object, so no step allocates one, and a clone gets its own), then `separate` parts the living gunships in seat order.
  A gunship is a flight circle of radius 30 inside its hit circle: it slides along rock and the world's edge, bumps the
  others aside and never falls (no gravity; with nothing held it brakes to a stop where it is). Rockets do not inherit
  its velocity. A destroyed gunship stops where it was, and its wreck stays there.
- **Aim**: the launcher turns counter-clockwise at a steady rate, one full circle per `aimPeriod` (3.6 s), from a random
  starting angle, so a castle can fire in any direction, down included. `createRound` throws `RangeError` for an
  `aimPeriod` that is not finite or is under two ticks (`MIN_AIM_PERIOD`).
- **Barrel**: every rocket of a volley tests its barrel, the segment from the pivot (`launcherOffset` 32 px above the
  hull) to the tip (`barrelLength` 20 px past it), with `segmentHit`. Rock on it (a gunship flown up against a wall or a
  ceiling, which can put even the pivot inside rock, since the pivot is 2 px outside the flight circle) blows the rocket
  up where the barrel enters the rock (at the pivot when that is in rock) with its crater and splash, so no rocket
  starts beyond a wall. Nothing between the hull and the pivot can hide rock: the flight circle's rim would have met it.
  Otherwise the rocket's path is tested from the tip.
- **Volleys**: launch speed 900 px/s, gravity 500 px/s². `units` rockets (start 5, max 30) leave every 5 ticks (packed
  tighter for big volleys so a volley lasts ≤ 1 s) with ±1.2° / ±1.5 % spread. Reload 2.6 s (first shot after 1.2 s).
- **Rockets** test the segment each sub-step moved along with `segmentHit` and blow up where it enters rock, so they
  never pass through a wall one cell thick. They are gone 80 px past either side of the world or 60 px below it; above
  the top they fall back (`rocketMaxAge` 12 s is the backstop).
- **Damage**: castle HP depends on the player count: 280 / 220 / 150 / 130 / 120 for 2 / 3 / 4 / 5 / 6 players. Direct
  rocket hit 4; an explosion within reach of a castle (crater radius plus castle radius) deals 50 % splash, with or
  without ground under the castle. Own rockets never hurt their own castle or shield. A dying castle blows a 46 px
  crater where it is (harmless in open air).
- **Gates**: 5 / 5 / 6 / 6 / 7 for 2–6 players, of ×2/×3/×5/×10 (weights 4/3/2/1), drift slowly and bob, live 14–22 s
  and respawn elsewhere. A gate lives in one of the map's `skyZones` (picked with odds by area): the whole box it
  sweeps (drift up to ±170 px, less in a narrow zone, and bob ±14 px) lies inside the zone, holds no rock, keeps
  `gateSpacing` (80 px) from every other gate's box and clear of the crates present, and preferably 60 px clear of
  living castles (16 seeded tries; a gate that finds no room is tried again every 0.5 s; when no try is clear of the
  castles the first free one stands, so a gate or crate can sit over a castle, which is intended: better there than
  nowhere, and a rocket is as likely to reach it as any other). A rocket inside a gate splits
  into `multiplier` rockets fanned over up to 22°; every child remembers the gate so a lineage multiplies once per gate.
- **Rocket cap**: 1500 live rockets. Splits stop creating rockets at 1350 (the remaining 150 are reserved so volleys
  and bombs still appear) and instead multiply the `power` of the rockets that exist, so damage is conserved. Ghost
  bombs bypass the cap (there are only a few), so a loaded ghost's press always drops one.
- **Crates**: 4 / 4 / 5 / 5 / 6 for 2–6 players, first at 3 s, respawn 5–9 s, in the sky zones like the gates: clear of
  rock and of every gate's box, 100 px from other crates (a crate that finds no room is tried again every 0.5 s, not
  after the respawn wait). The first rocket to touch one gives its owner the card:
  `unit` +1 rocket per volley, `shield` +50 shield HP (max 100, radius 60), `rapid` reload ×0.75 (min 1.2 s), `repair`
  +40 HP, `mega` next volley does ×3 damage with ×2.5 craters. Rockets fly on through crates.
- **Fuse**: 90 s. Then sudden death: bombs (6 damage) appear `bombHeight` (600 px) above a random living castle,
  scattered sideways (`bombStartY`: never above the top of the world, and just under the rock when the column above
  the castle has a ceiling), from one per second to ten per second over 40 s, scattering less and less; all damage
  scales by `1 + suddenDeathSeconds / 30`. Bombs can be multiplied by gates too. At 180 s the round is decided on HP
  (tie = draw).
- **Ghost bombers** (`ghosts: true`): a destroyed castle's player gets a blimp at rest `ghostRise` (220 px) above the
  wreck (at least 40 px below the top), in play from the next step. The player flies it with the same bits:
  `flyStep(ghost, directions, GHOST_FLIGHT, GHOST_SKY)`, lighter and faster than a gunship, through rock (`GHOST_SKY`
  is `openSky`: the world's edges only), never colliding with anything. A fire press drops a bomb (first after 2.5 s,
  then every 3.5 s) from where the blimp was before the step, with its velocity plus 60 px/s downward, but only with
  the blimp in the open: a bomb released inside rock would blow up on the spot, so while the blimp is in rock it stays
  unloaded (`isGhostLoaded` false, the press ignored and the reload kept) until it flies out. It deals 7 on a direct hit (splash half,
  times the sudden-death scale), carves an 18 px crater, is never multiplied by gates and never takes crates. Ghosts
  cannot win: the round still ends when ≤ 1 castle stands, and they stop dropping once it is over.

Measured headlessly on the big map before gunships flew (bots, which do not steer yet, still end their rounds in sudden
death; bots only, all castles on one difficulty, 20 seeds per player count, seeds
`s · 7919 + players`): every round reaches sudden death, with a median length of 131–134 s (p90 at most 136 s) for
every difficulty and 2–6 players; none needs the 180 s stop. The same measurement on the old one-screen arena gave hard
40–52 s, normal 42–75 s and easy 99–124 s, mostly before the fuse. From their spawn anchors, a sweep of all 360 whole
degrees finds a direct hit for 0 of the 12 ordered pairs of two-player rounds and 10 of 180 in six-player rounds (6
seeds each): the castles mostly wait for the bombs. In range (`lineUp`, 600–1200 px apart in open air), the "decent
aimer" of `tests/engine-balance.test.ts` (presses 8 ticks ahead, ±3 ticks off) beats "fire whenever loaded" in nearly
every round, but its own duels mostly reach sudden death too: the launcher turns 100° a second, so a 3-tick slip is a 5°
miss, and a near miss in open air splashes nobody. Bots that fly come next.

A step with bots thinking costs, averaged over whole six-player rounds (Node 24): easy 62 µs, normal 114 µs, hard
175 µs (the old arena: 86 / 155 / 259 µs; `predictTrajectory` only works out where a gate or crate is when the rocket
is inside the box it sweeps). The slowest single step seen was 16 ms (warm-up and garbage collection included). `createRound` takes ~2 ms,
nearly all of it painting the temple. Flight adds about 10 µs: six gunships on seeded random holds (a new direction
every 20–80 ticks) that fire whenever loaded average 24.5 µs a step over four whole six-player rounds (seeds 1–4, about
32 000 steps, Node 24, the warm pass), against 15 µs for the same rounds with nobody steering
(`pnpm exec tsx games/fuse-bombers/preview/step-cost.ts`).

## Bitmap terrain and the temple map

The round's world ([design.md](design.md), "The sky overhaul"). Both modules keep to the deterministic-engine rule (no
`Math.sin/cos/…/random`, `**`, `Date`, `performance`; `tests/architecture.test.ts` checks it). `index.ts` exports the
grid queries (`solidAt`, `hardAt`, `cellSolid`, `cellHard`, `segmentHit`, `gridHash`) for render and tests.

**`src/engine/grid.ts`**: destructible terrain as plain data that survives `structuredClone`:
`Grid = { width, height, cell, cols, rows, solid, hard, version }`, world units in logical pixels (y down), square
cells of `cell` px (4 on the temple: 1200 × 675), and two `Uint32Array` bitsets (bit `row * cols + col`) for rock and
for indestructible rock (`hard` ⊆ `solid`). Outside the world is open air. A cell owns its low edges, so the world is
half-open: `solidAt(width, y)` is air, as is everything past it. There is no terrain gravity: carving never makes rock
fall, so the temple's islets, and any piece a bomb cuts loose from the rest, float where they are for the whole round.
`hard` is a second bitset inside the `Grid`, so the round state carries it and every snapshot clones it (about 100 KB
more per clone, which is negligible), rather than sharing one constant mask with the map. The queries take a
`ReadGrid` (the same fields with the bitsets as `ArrayLike<number>` and `version` read-only), so `RoundView.terrain`,
which is one, can be queried but not handed to `carveCircle` or written through; the writable `Grid` is the engine's.

- Queries: `solidAt` / `hardAt` (world px, O(1)), `cellSolid` / `cellHard`, `segmentHit(grid, x0, y0, x1, y1)` →
  `{ x, y, t, col, row } | null` (a grid DDA that visits every cell the segment touches, so it never skips a wall one
  cell thick; the point is where the segment enters the rock, or its start when that is in rock), `circleOverlapsSolid(
grid, x, y, r)` (cells as squares; touching is clear) and `countCells`. `segmentHit` never misses: wherever `solidAt`
  is true on the segment it hits. It can also hit without entering the rock, when the segment ends exactly on the far
  face of a rock cell or crosses exactly through the corner of one (so it is not symmetric between the two
  directions there); nothing else. NaN, infinite and absurdly large inputs are air.
- Authoring: `createGrid(width, height, cell = 4)`, `fillRect` / `fillCircle` / `fillPolygon` (flat x, y pairs,
  even-odd) with a `Paint` of `"rock" | "hard" | "air"`. A cell is painted when its centre is inside; later paint wins.
  An empty or inverted `fillRect` paints nothing.
- `carveCircle(grid, x, y, r)` clears non-hard rock whose cell centres lie within `r`, bumps `version` (wrapping past
  32 bits, which is what `gridHash` reads) and returns the changed cells' `{ col0, row0, col1, row1 }` (ends
  exclusive), or null when nothing changed.
- `gridHash` is a 32-bit FNV-style hash of size, version and cells. `encodeGrid` gives
  `[GRID_FORMAT, width, height, cell, version, ...runs]` with runs `length * 3 + state` (0 air, 1 rock, 2 hard; the
  fresh temple is ~2 700 numbers), neighbouring runs always in different states, so a grid has one encoding.
  `decodeGrid(data, expect?)` returns a new grid or undefined for anything malformed, never a partial one: another
  format or size, a size other than `expect`, a version over 32 bits, a non-integer, negative or empty run, two
  neighbouring runs in one state, or runs that do not cover the grid exactly. It reads one value per cell at most and
  allocates nothing until the run count fits the grid.

Measured on the temple (Node 24, a busy 8-core desktop): 3 000 rockets each testing a step of up to 10 px take
0.35–0.5 ms in all, a 30 px carve ~4 µs (a `structuredClone` of the grid ~60 µs), a gunship-sized `circleOverlapsSolid` ~2 µs,
`encodeGrid` plus `decodeGrid` ~1.5 ms.

**`src/engine/temple-map.ts`**: the authored map `TEMPLE_MAP` (4800 × 2700, polygons painted in order by
`buildMapGrid`; `buildTempleGrid()` for short), drawn in [images/temple-map.png](images/temple-map.png) by
`pnpm exec tsx games/fuse-bombers/preview/map-preview.ts`. After Melee's temple stage: two terraces on columns, each
split by a skylight so every bay beneath opens to the sky; a shrine with a peaked roof and a tunnel straight through
it; a bridge to a gatehouse on the right terrace; the main hall; a cave beneath, open to the left and the lower right;
a stepped ramp down the right; an underbelly tapering to y 2400; six islets; at least 300 px of sky on every side. Rock
is ~24 % of the map; hard cells (~5 % of it: pillars, columns, the shrine's legs and keel) keep a skeleton standing.
`spawnAnchors` (12, in open air ≥ 60 px from rock: five pairs that mirror each other about the shrine's axis, within 300 px
because the terrain is not symmetric, plus the top centre and under the keel on it), `spawnOrder(count, seed)` (a spread,
symmetric set per player count 2–6 chosen and dealt to seats by the seed; it is the temple's, not generic), `skyZones` (open air for gates and crates) and
`TEMPLE_LANDMARKS` (tunnel, cave, bays) come with it. `tests/engine-temple-map.test.ts` checks the margins, the
clearances, that all open air is one region a gunship (`GUNSHIP_FLIGHT`'s radius, 30) can fly through, and that the tunnel and cave are
enclosed yet reachable.

## Online (`src/online/`)

`src/online/game.ts` is the round behind the netcode's `RollbackGame`, shaped like Fuse Choppers' (the room page comes
later). Settings `{ wins: 1–9 (3), difficulty, display }`; six seats, two gunships (bots count) to take off. A round is
a 3 s countdown, play, a 2 s aftermath once decided and a 5 s scoreboard; crowns are kept by member id, so a rider who
joins mid-match flies from the next round, and too few gunships send the room back to its lobby.

- **Entries**, each counting only in the match and round it names: `[seq, tick, PLAY, matchId, round, bits]` holds the
  direction bits from that log tick on (a tap shorter than the tick still counts on its first step), and
  `[seq, tick, PRESS, matchId, round, ordinal, offset]` is one fire press: a gesture id (`EntryRules.ordinal`, rising
  along a stream, so repeats and stale presses never fold) and the step (0–2) of the log tick it came in.
- **Fold**: a log tick of 50 ms runs three `step`s; each step holds the seat's directions plus `FIRE` on exactly the
  step of each press, so a short tap fires on its step and a held button fires once. Bot seats are `RoundConfig.bots`.
- **Hash**: `hashPlain` (`src/online/hash.ts`) walks the whole room as plain data (numbers by their bits, typed arrays,
  sorted keys), so state added later is covered; only the latest step's `events` are left out. About 0.6 ms a call.
- **Checkpoint**: none yet; `decode` refuses every snapshot until the validated codec (the next pull request).
- **This device** (`src/online/runtime.ts`, `BombersRuntime`): `input(bits)` logs the directions on change (and again
  for a new round); `fire()` logs a `PRESS` with the next ordinal and the step its moment falls on in the shared clock's
  current log tick.
- **`RULES`** (`src/engine/index.ts`) and `tests/online-golden.test.ts`, a scripted six-gunship match replayed to
  recorded hashes: a change to how a logged room plays bumps `RULES` and re-records them (`GOLDEN_RECORD=1`) in the same
  commit; a failure without one is a regression ([engine-safety-net.md](../../../docs/design/engine-safety-net.md)).

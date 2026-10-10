# Fuse Bombers — game design

A party artillery game for 2–6 players (any mix of humans and bots). Rounds last 1–3 minutes; a match is first to N
round wins (default 3). Inspired by a "Castle Busters" mobile ad: gunships lob streams of rockets at each other, the
rockets fly through floating multiplier gates (×2, ×5, ×10 …) and turn into huge swarms that chew through rock,
shields and hulls.

## The sky overhaul (in progress)

Playtests said the game is fun but unfair: castles parked on a one-screen landscape win or lose by where they spawn.
The overhaul keeps the rockets, gates, crates, fuse and ghosts, and changes three things:

1. **A much bigger map.** One authored, destructible map several screens large, its outline inspired by the huge
   temple stage of Super Smash Bros. Melee: upper terraces on both sides, a central shrine with a tunnel through it,
   a thick main hall, a cave hollowed out underneath and a stepped ramp down the right side, with open sky all around
   and a few floating islets for cover. Spawn points sit in the open air around it.
2. **Free flight with momentum.** Castles become gunships (a balloon envelope in the player's colour over a gondola
   with the launcher). They fly in eight directions, slowly, with inertia: thrust accelerates, drag slows, and turning
   round takes about a second, so position is a decision rather than a reflex. Gunships do not fall; they bump off rock
   and the world edge and nudge each other apart.
3. **Online rooms.** Like the other Fuse games: online rooms with one device per rider, a shared TV with phones as
   controllers, and solo against bots, on the repo's rollback netcode. Local play on one screen stays.

What stays: the launcher still turns on its own and the fire button picks the moment, now all the way round (a full
circle, so a gunship can fire down at a ship below it). The dotted guide, reload, volleys, gates, crates, shields, the
90 s fuse with sudden-death bombs, the 180 s hard stop and ghost bombers stay, rescaled to the bigger map.

### Rules (targets, tuned in `src/engine/tuning.ts`)

- **World.** About 4800 × 2700 logical pixels (three times the old arena each way), y down. Terrain is a bitmap of
  4 px cells (a bitset, about 100 KB) instead of a height map, so the map can have overhangs, tunnels and caves. Every
  explosion carves a circle; the map may mark some cells indestructible so the temple keeps a skeleton (a constant
  mask that comes with the map, not a second bitset in the round state).
- **Flight.** Input is held bits: up, down, left, right, fire. Thrust about 260 px/s², top speed about 200 px/s,
  linear drag. Diagonals are normalised. A gunship is a circle for collisions; it slides along rock rather than
  sticking.
- **Aim.** The launcher turns counter-clockwise at a steady rate (about 3.6 s a revolution). Fire fires on the press
  (the rising edge of the fire bit, which the engine tracks per gunship in the round state) when loaded, at the angle
  the player saw. Online, a press arrives as its own log entry (see "Online shape" below).
- **Spawns.** The map lists anchor points; a round picks a spread, seeded set for the player count. Because gunships
  move, the old check that every pair of castles can hit each other (`src/engine/reach.ts`) goes; a map test only
  checks that every anchor is open air with room for a gunship.
- **Gates and crates** spread over the open sky of the whole map, more of them than on the old one-screen arena.
- **Sudden death** drops bombs from a fixed height above living gunships.
- **Ghosts** fly freely with the same controls, pass through rock and drop bombs.
- **Camera** (render only): a shared screen frames every living gunship and ghost, zooming between about one old arena
  and the whole map, like a Smash camera. A personal online device frames its own gunship and the nearest opponents.

### Controls

- Keyboard (local): up to four riders, each with a direction cluster and a fire key (WASD + Space, arrows + right
  Shift, IJKL + H, numpad 8456 + numpad 0, adjustable in the PR that lands it).
- Gamepad: left stick or D-pad, any face button fires.
- Touch (local): up to two riders, a D-pad and FIRE on each side of the screen.
- Phone controller (online shared TV): a held D-pad and a FIRE button (each tap is one fire press).

### Technical rules for the overhaul

- **Determinism across browsers.** Online rollback replays the same log on different engines, so the engine must not
  use `Math.sin/cos/tan/atan/atan2/hypot/pow/exp/log*/random`, `**`, `Date`, `performance` or `localeCompare`, nor take
  `Math` apart (`const { sin } = Math`, `Math[name]`) (`deterministicViolations` in `tests/fixtures/source-guards.ts`;
  `Math.sqrt` is exact IEEE and fine). Today's engine uses several of them (`exp`, `log2` and `hypot` in `bot.ts`,
  `sin`/`cos` in `geometry.ts`, `atan2`, `hypot`, `sin` and `cos` in `round.ts`, `exp`/`sin` in `terrain.ts`). Trig goes through a
  deterministic helper written inside `src/engine/`: `tests/engine-boundary.test.ts` refuses npm imports there, so Fuse
  Riders' `@stdlib`-backed `deterministic-math.ts` cannot be reused as is. That test already runs
  `deterministicViolations` over `src/engine/`, but keeps only the clock and `Math.random` (`UNSEEDED`) because of the
  list above; step 1 drops that filter (and updates the test's comment and its "catches every form" case) instead of
  adding a second test file.
- **Bots live in the state.** A bot is a pure function of the round state plus bot memory stored in that state (seeded,
  checkpointed, hashed), and the engine computes bot seats' inputs inside `step`. They emit ordinary input bits and get
  no privileged physics. No closures with memory, so a rollback replays a bot exactly. Bots stay cheap: catch-up and
  rollback re-runs spend up to 8 steps per 10 ms loop pass (`CATCHUP_STEPS`) and start no new log tick once a pass has
  spent 6 ms in steps (`CATCHUP_MS`), so a step with six bots must stay well under a millisecond on average.
- **Snapshot-friendly state.** The round state is plain data and typed arrays (it survives `structuredClone`; the
  netcode clones it every 4th log tick, keeps 12, and clones again for every rollback, so the terrain is one typed array
  and nothing else in the state is large), with a validated checkpoint codec: terrain as runs (decode refuses runs that
  do not total the grid), rockets and gates as bounded arrays, all within the netcode's 2 MB snapshot limit.
- **Online shape** follows Fuse Choppers (`games/fuse-choppers/`): `src/online/game.ts` (the `RollbackGame`: one log
  tick of 50 ms folds the management entries, each seat's held direction bits and the bots' answers, then runs three
  60 Hz steps), `src/online/runtime.ts` (this device's controls), `src/engine/codec.ts`, `src/app/session.ts`,
  `src/app/presenter.ts`, and `src/platform.ts` registered in `service/history.ts`. Choppers' `PLAY` entry carries held
  bits only; Bombers cannot do that for fire, because a press and release inside one log tick would fold to nothing and
  aim timing would round to 50 ms. So the fire press is its own entry: an increasing gesture id (`EntryRules.ordinal`,
  as with Fuse Riders' press) plus its step offset (0 to 2) inside the log tick, and `step` sees the fire bit for
  exactly that step. The `RollbackGame` also brings a `RULES` id (`fuse-bombers-1`) and a golden-hash replay test, as
  Choppers has; after that an engine change bumps `RULES` and refreshes the golden in the same commit.

### Plan (pull requests of 10–1000 lines, each leaving the game playable)

1. Deterministic engine: an in-engine trig helper, the banned operations replaced (`bot.ts`, `geometry.ts`, `round.ts`,
   `terrain.ts`), the full guard in `tests/engine-boundary.test.ts`.
2. Bitmap terrain and the temple map (new modules, a preview image of the map).
3. Flight kernel: momentum, collisions against a solid-field interface (new module).
4. Big map: the round on the bitmap terrain and the temple map, hovering gunships at spawn anchors, the launcher
   turning a full circle; render draws the bitmap terrain with the whole map in view.
5. Free flight: held-bit input, the flight kernel wired in, flying ghosts, bots inside `step` with their memory in the
   state; keyboard clusters. (Until 6 lands, gamepad and touch riders hover and fire but do not steer.)
6. Devices and render, in parallel: gamepad sticks, touch pads and lobby texts; the framing camera and gunship art.
7. Online game: the checkpoint codec, `RULES` with a golden-hash replay, and the `RollbackGame` with tests for rollback,
   checkpoints, bad input, and dropped, duplicated and reordered fire presses.
8. Online app: registration (the game's `package.json` `exports` and workspace dependencies, the root `package.json`,
   `Dockerfile.cloud`, `service/history.ts`, the game list in `tests/dice-service.test.ts`, `.c8rc.json`), runtime,
   session, landing and room lobby, then the shared TV and phone controller, a `preview/smoke.mjs` like Choppers', and
   the docs the change makes stale (the README says "a local game: no rooms"; the `docs/architecture.md` row). Cloud
   Run serves a game beyond Fuse Riders only once the operator adds its id to `EXTRA_GAME_IDS`; that is not part of these
   pull requests.

## Original design (before the overhaul)

- **Arena.** A side-view landscape of rolling hills and tall peaks, wider than tall, fitted to the screen. The terrain
  is destructible: every rocket carves a small crater, so peaks between castles erode over the round.
- **Castles.** Each player owns a castle on treads parked on the terrain, spread left to right, with hit points; at 0
  HP it explodes and is out for the round.
- **One-button aiming.** The castle's launcher sweeps back and forth across its arc like a metronome; a short dotted
  guide in the player's colour shows the first part of the trajectory. Pressing the button launches a volley at the
  current angle with a fixed launch speed, so timing picks range and target. The launcher then reloads. Humans get a
  bolder, longer guide, a pulsing ring on the loaded launcher, brackets around the gates and crates the full path would
  cross, and a `PRESS Q` badge over their castle for the first seconds of a round
  ([screenshot](images/aim-readability.png)).
- **Volleys.** A stream of rockets (one per "unit", start with ~5) released in quick succession with slight spread.
- **Multiplier gates.** A rocket that passes through a gate splits into that many rockets (once per gate per lineage).
- **Crates.** The first volley to hit one gives its owner the card: +UNIT, SHIELD, RAPID reload, REPAIR or MEGA.
- **The fuse.** A burning fuse across the top is the round timer (~90 s). Then sudden death: bombs rain and damage
  escalates; a round never exceeds 3 minutes. Last castle standing wins; a simultaneous wipe-out is a draw.
- **Ghost bombers.** A destroyed player flies a ghost blimp and drops a bomb every few seconds. Ghosts cannot win.
- **Players.** Lobby join by pressing your button; free seats are bots with a selectable difficulty. Bots use the
  same input as humans with difficulty-dependent error and reaction time, and no privileged physics.
- **Technical shape.** TypeScript + Vite + Phaser 4 in `games/fuse-bombers/`. `src/engine/` is a deterministic,
  fixed-step, seeded simulation with no imports from rendering or app code, unit tested with `node:test`.
  `src/render/` draws the engine's view with Phaser; `src/app/` owns menus, input, audio and match flow.

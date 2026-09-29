# Fuse Choppers · multiplayer cave chaos

The helicopter game for two to five friends: **hold to climb, let go to fall**, fly back and forth with A/D, and
stay alive while the cave scrolls right and the **crush zone** closes in from the left. Shots and bumps **nudge**
rivals into the rock rather than killing them; the rock, saw blades, thrown boulders and the crush zone kill. The
last chopper flying wins the round (or the first through the **EXIT** gate at the end of the cave); crowns win the
match. Online rooms, solo against AI pilots, and a shared TV with phones as controllers, on the same netcode as every
Fuse game.

Open it at `/fuse-choppers/` on a running service (see below), or from **MORE GAMES** on the Fuse Riders landing page.

## Controls

| Keys                      | Does                                                                      |
| ------------------------- | ------------------------------------------------------------------------- |
| Space / W / ↑ (hold)      | Climb; let go to fall                                                     |
| A D / ← →                 | Fly back and forward against the scroll                                   |
| F / J / K / Enter / click | Fire: a hit shoves the rival and wobbles its controls; drones take 3 hits |
| S / ↓                     | Dive, in the W/S thrust trial only                                        |

Phones get touch pads over the cave (◀ ▶, FIRE, LIFT); in a shared-screen room a phone is a full controller.

**Developer trial: W/S thrust.** The lobby's CONTROLS setting (or `?lift=thrust` on the URL that creates the room)
swaps the classic mechanic for direct control: W flies up, S flies down, and the chopper hovers when neither is held.
`?combat=bump|shoot|off` likewise starts a room on another nudge mode.

## Rules at a glance

The source is the rulebook; this is the shape of it.

- **The cave** is procedural: a height map from the round's seed (`src/engine/level.ts`), widest at the start and
  narrowing with depth, with stalactite spikes. Every 480 px a segment may place a floating rock (a lit **landing
  pad** on top, deadly from the sides and below), a **saw blade** (sometimes sweeping), a **power-up** and **drones**.
  Each always leaves a corridor open; the tests check that across seeds.
- **The crush zone** starts as a sliver, gains on the camera every step, keeps coming when the camera stops at the
  exit, and throws **molten rocks** into the field. Each rock is announced by a red warning and a dashed line first.
- **Drones** drift in from the right, light their eye, and fire bolts at the nearest chopper: bolts nudge, never kill.
- **Power-ups**: shield (survives one crash), triple shot, turbo, scramble (everyone else's left and right swap) and
  shockwave (blasts nearby rivals away and clears enemy fire).
- **Nudges** (room setting): shots and bumps, either, or neither. A nudged chopper is shoved and wobbles, with weaker
  lift and steering for a moment.

## Design notes

- **Engine** (`src/engine/`): deterministic integer simulation, 256 sub-units a pixel, 60 steps a second, three
  steps per 50 ms log tick. No `Math.random`, trigonometry, `**` or clocks (the architecture test runs the repo's
  determinism guard over it). The cave, platforms and saws are pure functions of the seed and are never stored; only
  moving and collectable things are world state, so rollback snapshots stay small. `step.ts` holds the order of a
  step, which is part of the rules. `RULES` in `src/engine/index.ts` names the rules; `tests/golden.test.ts` replays
  a recorded five-bot round, so a behaviour change must bump `RULES` and re-record it (`GOLDEN_RECORD=1`).
- **Netcode** (`src/online/`): the game behind fuse-netcode's `RollbackGame`. A seat's log entry is its held
  control bits for a match and round; the fold latches a tap shorter than a tick onto the tick's first step. Bots are
  seats whose bits come from `engine/bot.ts`, computed once per log tick from the world like anyone's view of it. The
  room keeps crowns and round results; seats, bots, settings and start/rematch/lobby are the shared management
  entries. The checkpoint validates every field before a world is installed.
- **Rendering** (`src/render/`): Canvas 2D at a 960×540 logical size, redrawn from the runtime's frame timing and
  interpolated between log ticks. Sprites and backdrop tiles are painted once; particles, trails and wrecks are
  cosmetic and keyed by effect id, so a rolled-back frame never draws an effect twice. The renderer imports only the
  engine's `view.ts` and `view-kit.ts`.
- **App** (`src/app/`): landing, lobby, invite and roster from fuse-ui; the HUD (logo, pilot cards, timer, legend)
  is DOM over the canvas. `presenter.ts` decides what shows and is unit-tested; `main.ts` is the glue.
- `src/platform.ts` registers the game with the room service for admission only; it reports no results yet.

## Run, test, preview

```bash
pnpm build
pnpm exec tsx service/dev.ts --port 8787
```

Open `http://localhost:8787/fuse-choppers/?mute` (solo: `?solo=1&mute`). `?autopilot` flies this device's
chopper with the AI, through the ordinary controls: handy for demos and smokes.

```bash
pnpm exec tsx --test games/fuse-choppers/tests/*.test.ts
node games/fuse-choppers/preview/smoke.mjs http://localhost:8787/ path/to/screenshots
```

The smoke plays a solo round, then a real two-browser room (create, join by code, add a bot, take off) and checks
that both pages agree on the round. It needs Chrome for Playwright and writes screenshots only where told.

## Not yet

Match history, ratings and leaderboards (the registration is admission-only), local multiplayer on one keyboard,
authored art assets (every sprite is painted in code), and balance from real playtests: tune it in
`src/engine/tuning.ts` and `level.ts`.

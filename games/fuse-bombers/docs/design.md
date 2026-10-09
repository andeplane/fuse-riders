# Fuse Bombers — game design

A one-screen party artillery game for 2–6 players (any mix of humans and bots). Rounds last 1–3 minutes; a match is
first to N round wins (default 3). Inspired by a "Castle Busters" mobile ad: castles on tank treads parked on a hilly
landscape lob streams of rockets at each other, the rockets fly through floating multiplier gates (×2, ×5, ×10 …) and
turn into huge swarms that chew through mountains, shields and walls.

## Core loop

- **Arena.** A side-view landscape of rolling hills and tall peaks, wider than tall, fitted to the screen. The terrain
  is destructible: every rocket carves a small crater, so peaks between castles erode over the round.
- **Castles.** Each player owns a castle on treads parked on the terrain, spread left to right. A castle has hit points
  (health bar above it) and settles onto the ground as terrain beneath it is destroyed. At 0 HP it explodes and is out
  for the round.
- **One-button aiming.** Every player plays with a single button. The castle's launcher angle sweeps back and forth
  continuously across its arc (like a metronome); a short dotted guide in the player's colour shows the first part of
  the trajectory. Pressing the button launches a volley at the current angle with a fixed launch speed, so timing
  picks range and target. The launcher then reloads (a few seconds, shown on the castle). Humans get a bolder, longer
  guide, a pulsing ring on the loaded launcher, brackets around the gates and crates the full path would cross, and a
  `PRESS Q` badge over their castle for the first seconds of a round
  ([screenshot](images/aim-readability.png)).
- **Volleys.** A volley is a stream of rockets (one per "unit" the castle has; start with ~5) released in quick
  succession with slight spread, so they travel as a ribbon with smoke trails.
- **Multiplier gates.** Coloured gates drift slowly in the sky between castles. A rocket that passes through a gate
  splits into that many rockets (each rocket can be multiplied by a given gate only once). Hitting gates is the key
  skill and the spectacle: 5 rockets through a ×10 gate is 50 rockets.
- **Crates.** Power-up crates float in the sky; the first volley to hit one gives its owner the card:
  - **+UNIT** — one more rocket per volley (permanent for the round).
  - **SHIELD** — a bubble shield that absorbs a fixed amount of damage before popping.
  - More cards are welcome if they are fun (rapid reload, mega-bomb, repair …).
- **The fuse.** A burning fuse across the top of the screen is the round timer (~90 s). When it burns out, sudden
  death starts: bombs rain from the sky and damage escalates until one castle remains, so a round never exceeds 3
  minutes. Last castle standing wins the round; a simultaneous wipe-out is a draw.
- **Ghost bombers.** A player whose castle is destroyed keeps playing: they fly a small ghost blimp that drifts back
  and forth along the top of the arena, and the same button drops a bomb straight down every few seconds. A bomb does
  about a third of a plain volley, ignores gates and crates, and is enough to tip a close fight but not to decide the
  round. Ghosts cannot win; the round still ends when one castle is left.

## Players and controls

- Lobby: each human joins by pressing their button (keyboard keys spread across the keyboard, gamepad buttons, or
  touch zones on a touch screen). Remaining slots up to the chosen player count are filled by bots with a selectable
  difficulty. A bots-only match should also be playable as an attract mode.
- Bots use the same one-button input as humans: they predict where the current angle would land and press when it
  suits them, with difficulty-dependent error and reaction time. No privileged physics.

## Technical shape

- TypeScript + Vite + Phaser 4, one game (`games/fuse-bombers/`) in the Fuse Riders monorepo, on its tooling and
  shared `fuse-ui` styles.
- `src/engine/` is a deterministic, fixed-step, seeded simulation with no imports from rendering or app code; it is
  unit tested with `node:test`. `src/render/` draws the engine's view with Phaser; `src/app/` owns menus, input,
  audio and match flow.
- Local play only (all players share one screen). Online play could later reuse the repo's netcode packages
  (`fuse-netcode`, `fuse-network-fe`).
- Served with the other Fuse games on GitHub Pages at <https://andeplane.github.io/fuse-riders/fuse-bombers/>.

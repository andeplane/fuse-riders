# Killer Fuse

A real-time team game for up to six players: Cyan against Pink, a Queen and two Workers each. A team wins a game one of three ways:

- **Military:** kill the enemy Queen three times.
- **Economic:** fill every hole of your hive with berries.
- **Snail:** a Worker rides the snail into your goal.

Bots play every empty seat, so one person can start a set. The first team to win the set's games (one to three, two by default) takes it.

## Run it

```sh
pnpm install
pnpm build
npx tsx service/dev.ts --port 8890     # serves dist/ and the room service
```

Open `http://localhost:8890/killer-fuse/?mute`. The shared main menu opens with a silent six-bot demo playing behind it:

- **Play** creates a room with a QR invite. Others join by the code or the link. The room lists its six numbered seats — Cyan and Pink, the Queens first — and **Join** takes one; a seated player taps another open seat to move there. Empty seats are played by the engine's bots, so one person can start. **Settings** and **START** sit at the top of the room beside Back. **Settings** holds the bot level, the map and the set length. The host ticks **Shared TV** under the invitation; with it on, **OPEN TV SCREEN** opens `?room=CODE&display=1` and every phone becomes a controller.
- **How to play** and **About** open the guide and the credits; **Settings** holds this device's sound and Hold to flap choices.
- **Join a room · Solo & local play** keeps joining by code, **PLAY SOLO WITH BOTS** (`?solo=1`) and the tutorial lessons (`?solo=1&tutorial=<id>`).

`pnpm dev` does the build and starts the service on port 8787 in one step.

## Controls

Arrows move, Space flaps, X attacks, hold Down to dive.

| Input                    | Action                                                                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ← / → (or A / D)         | Move                                                                                                                                                                                                                              |
| Space                    | Jump as a Worker; flap as a Queen or a Warrior                                                                                                                                                                                    |
| X or Z (also Shift or J) | Attack: a sword dash the way you face, as a Warrior or the Queen                                                                                                                                                                  |
| ↓ (or S), held           | Dive as the Queen; drop through a platform                                                                                                                                                                                        |
| ↑                        | Nothing, by design: flying is only ever the flap button                                                                                                                                                                           |
| Gamepad                  | Stick or D-pad to move and dive, A / Cross to flap; B / Circle, X / Square, either bumper or either trigger to attack. Plug one in at any time: the press that wakes it up already flaps. The first connected pad plays this seat |
| Touch                    | Left thumb slides to move and dive; right thumb FLAP and ATTACK                                                                                                                                                                   |

## Layout

| Path              | What it is                                                                                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine/`     | The deterministic 60 Hz simulation, the maps and the bots ([engine](docs/engine.md), [bots](docs/bots.md))                                                                                                        |
| `src/online/`     | The game behind the rollback netcode: entries, the fold, checkpoints, results ([online](docs/online.md))                                                                                                          |
| `src/render/`     | The Canvas 2D arena view, effects and sound, behind the contract in `api.ts`                                                                                                                                      |
| `src/app/`        | The page: `presenter.ts` (view to screen, pure), `room-model.ts` (the shared layout's slots and rows), `attract-match.ts` (the menu demo), `controls.ts`, `arena.ts`, `reports.ts`, `metrics.ts`, `main.ts` (DOM) |
| `src/platform.ts` | The `GameRegistration` for `fuse-platform`, exported as `killer-fuse/platform`                                                                                                                                    |
| `public/`         | The art, shipped to `dist/killer-fuse/` by the build                                                                                                                                                              |
| `tests/`          | `engine-*`, `bot-*`, `online-*`, `render-*` and `app-*`                                                                                                                                                           |

The page draws every frame from the room's view, never from events: a rollback can change what happened after it was shown, and only the view carries the correction.

## Checks

```sh
npx tsx --test "games/killer-fuse/tests/*.test.ts" tests/dice-service.test.ts
npx tsc --noEmit
npx eslint games/killer-fuse
npx prettier --check games/killer-fuse
```

`tests/online-golden.test.ts` replays a recorded set against recorded hashes. It fails whenever the engine's behaviour changes; record the hashes again when the change is intended.

Production serves every game registered in `GAMES` (`service/history.ts`), so Killer Fuse's rooms open when this change merges and the backend deploys ([GCP deploy](../../docs/online/GCP-DEPLOY.md)). Against a service revision from before that, the page says online rooms are not open and offers solo play.

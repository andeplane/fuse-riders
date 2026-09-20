# Pig, the template game

Pig is a fuseDrivers game for 2–5 players, bots included. On your turn you roll a die as often as you like, each roll adding to the turn's total. A 1 loses the total and passes the turn; **HOLD** banks it. The first to 50 banked points wins the round, and two round wins take the match. An idle turn holds by itself when its timer runs out.

It is the smallest complete game on this repo's packages, and the one to copy when you start a new game. It uses the rollback netcode (`fuse-netcode`), the WebRTC room client (`fuse-network-fe`), the shared backend (`fuse-platform`) and the menus and styles (`fuse-ui`). It has no Phaser, and imports nothing from `service/` or from another game.

## Run it

```sh
npm ci
npm run dev          # builds, then serves every game; open the printed URL plus /fuseDrivers/
```

`npx tsx service/dev.ts --port 8890` serves an existing `dist/` and walks to the next free port if that one is taken. Open `/fuseDrivers/?mute` and pick one of:

- **PLAY SOLO VS BOTS**: one bot, no room service. **LOBBY** on the result screen lets you add more bots.
- **CREATE ROOM**: a room with a QR invite. Others join by the code or the link, the creator adds bots and starts. Tick **Shared TV** first to play on one screen: **OPEN TV SCREEN** opens `?room=CODE&display=1`, and every phone becomes a big ROLL/HOLD controller.

Space or R rolls and H or Enter holds on a keyboard. A refreshed device rejoins the running match from a peer.

## Layout

| Path                     | What it is                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `src/game/rules.ts`      | The rules as one pure fold per log tick: turns, rolls from the room's seeded generator, the timer, bots, rounds and stats |
| `src/game/game.ts`       | `fuseDriversGame`, the `RollbackGame` the netcode runs, and `fuseDriversView`, what the page renders                                    |
| `src/game/checkpoint.ts` | The room as snapshot fields and back, validated whole                                                                     |
| `src/game/result.ts`     | Round receipts and match results for the backend                                                                          |
| `src/game/basics.ts`     | Constants and id rules with no imports, for the service                                                                   |
| `src/platform.ts`        | The `GameRegistration` for `fuse-platform`: per-player stats and account totals (exported as `fuseDrivers/platform`)             |
| `src/app/`               | The page: `presenter.ts` (view to screen, pure), `session.ts`, `reports.ts`, `runtime.ts` (ROLL/HOLD) and `main.ts` (DOM) |
| `index.html`             | The page's entry; Vite builds it to `dist/fuseDrivers/index.html`                                                                |
| `tests/`                 | Rules, checkpoint, rollback over lossy links, the presenter, reports, session and runtime                                 |

The page renders every frame from the view, never from events: a rollback can change a roll after it was shown, and the netcode deduplicates events by position, so only the view carries the correction. FuseDrivers come from a generator in the room state, so every device rolls the same numbers, and any member could compute the next roll. That fits the trust model: every member is trusted with the shared log.

Checks: `npx tsx --test games/fuse-drivers/tests/*.test.ts tests/fuseDrivers-service.test.ts`, and the browser smoke `ONLINE_URL=http://localhost:8890/ npx tsx scripts/fuseDrivers-smoke.ts` (`BROWSER=webkit` for WebKit).

## Start a new game

```sh
npx tsx scripts/new-game.ts snake-eyes
```

This copies this folder to `games/snake-eyes` with every id and name renamed (`"fuse-drivers"` becomes `"snake-eyes"`, `fuseDriversGame` becomes `snakeEyesGame`, `fuseDrivers.css` becomes `snakeEyes.css`). The copy is Pig under the new name, with its tests passing. Then:

1. Run `npm install`. The root workspaces include `games/*`.
2. Add `COPY games/snake-eyes/package.json ./games/snake-eyes/` to `Dockerfile.cloud` beside the fuseDrivers line.
3. Register its backend: add `snakeEyesRegistration` from `snake-eyes/platform` to `GAMES` in `service/history.ts`. The dev service then serves its rooms. In production, add its id to `EXTRA_GAME_IDS` once it may go live ([GCP deploy](../../docs/online/GCP-DEPLOY.md)).
4. Change the rules in `src/game/`, keep `rules` in `game.ts` at `<id>-<n>`, and bump `n` when a change would make two builds disagree.

`npm run build` emits its page at `dist/snake-eyes/index.html` without any configuration, and the dev service serves it at `/snake-eyes/`.

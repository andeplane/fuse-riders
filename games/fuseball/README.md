# Fuseball

Fuseball is a neon arena ball duel for two riders, served at `/fuseball/`. Knock the ball into the goal in **your own colour** to score and zap the other rider. The first to three points wins, and at 2–2 the last point is sudden death.

## How to play

- **Score in your own colour.** Cyan starts on the left and its goal is on the far right; magenta is the mirror image. The ball entering a goal scores for that goal's colour whoever sent it, so knocking it into the other colour's goal is an own goal.
- **Every point** starts with a 3-2-1 countdown with both riders on their marks, and ends with the loser of the point zapped from the goal.
- **Bubbles.** Every jump made in the air leaves a bubble where you were. It is a bumper: the ball is thrown away from its centre and the bubble pops. You have one bubble at a time. The other rider pops your bubble by touching it, and you pass through your own.
- **Hard bubbles.** Keep the button held after placing a bubble and it hardens: the ball and the other rider bounce off it and it stays. While you hold, you cannot jump again. A hard bubble that wedges the ball into a corner with no way out pops.
- **Nothing buries the ball.** Land or stand on the ball and it squirts out along the floor, away from you; squeeze it against a wall and it pops up.
- **Clouds.** While the ball is inside a cloud the whole arena goes into slow motion: it eases down to half speed at the cloud's rim and about a third at its centre, holds for a moment after the ball is out, then eases back. Only the ball counts; a rider or a bubble in a cloud slows nothing.
- **Goals.** A goal freezes everything for a little over a second, then the loser is zapped in slow motion before the next countdown.
- **Wrap.** The arenas have no outer edge on at least one axis: what leaves one side comes back on the other, so a rider or the ball that drops through an open floor falls in again from the top. Riders fly through goals untouched; only the ball scores.

| Arena       | Wraps         | Goals                                                                                                                 |
| ----------- | ------------- | --------------------------------------------------------------------------------------------------------------------- |
| Gridlock    | sideways      | the gaps in the wall across the seam                                                                                  |
| Downlink    | top to bottom | the two shafts through the floor and the roof                                                                         |
| Halo        | both ways     | two round goals floating high on each side                                                                            |
| Overflow    | both ways     | the gaps in the seam wall; the floor has two holes that are nobody's goal, so what falls in comes back from the top   |
| Firewall    | both ways     | the gaps in the seam wall, each behind a short wall; there is no floor, so everything off a pad falls round and round |
| Corner Case | top to bottom | the four corner pockets, floor and roof, each behind a kerb                                                           |
| Core Dump   | top to bottom | two pits side by side in the middle of the floor (and the roof above them), with a post between                       |

## Controls

One stick and one button.

| Move                       | Keyboard                    | Touch             |
| -------------------------- | --------------------------- | ----------------- |
| Run, and steer in the air  | A / D or ← / →              | stick             |
| Jump (lifts a nearby ball) | Space, J or K               | JUMP              |
| Air-jump, leaving a bubble | the button again in the air | JUMP in the air   |
| Harden your bubble         | keep the button held        | keep JUMP held    |
| Quick drop (in the air)    | S or ↓ with the button      | stick down + JUMP |
| Power slide (on the floor) | S or ↓ with the button      | stick down + JUMP |

A slide is the fastest way along the floor; it ends in a small hop when its time runs out, the button comes up or the floor does.

## Ways to play

- **Solo**: `/fuseball/?solo=1` plays one match against the bot on the arena chosen on the landing page (`&map=` with `gridlock`, `downlink`, `halo`, `overflow`, `firewall`, `cornercase` or `coredump` overrides it). No room service is involved.
- **Online room**: CREATE ROOM, share the code, link or QR, pick the arena in the lobby, add a bot if nobody joins, and START MATCH. The host starts rematches and returns the room to the lobby. A third visitor watches.
- **Shared TV**: tick "Shared TV" before creating the room and open `?room=CODE&display=1` on the big screen. It shows the arena only; each rider's phone becomes a controller with a stick and a JUMP button.
- `?mute` on any URL silences the page for that load without storing a choice.

Production serves Fuseball's rooms only when `fuseball` is in the `EXTRA_GAME_IDS` repository variable; until then the page offers solo.

## Run it locally

```sh
pnpm dev:online                       # builds, then serves every game and the room service
# http://localhost:8787/fuseball/?mute
```

To work on the page with hot reload, run the room service and Vite side by side:

```sh
pnpm exec tsx service/dev.ts --port 8787 --allow-origin http://localhost:5173
VITE_API_ORIGIN=http://localhost:8787 pnpm exec vite --port 5173
# http://localhost:5173/fuseball/?mute
```

Both pick the next free port when theirs is taken and print the one they got; pass the printed ports to each other.

## Layout

| Path              | What it is                                                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine/`     | The rules: integer physics at 120 micro-steps a second, the maps as data, the checkpoint codec, the view and the bot (`bot.ts`). It imports nothing from outside the folder                        |
| `src/online/`     | Fuseball behind `fuse-netcode`'s `RollbackGame` (`game.ts`: seats, the map setting, the fold, the checkpoint), the runtime with this device's held controls (`runtime.ts`), and the match result   |
| `src/render/`     | The Canvas 2D scene: arena, riders, bubbles, ball, effects and the HUD, plus the wrap-aware blend between two views. It reads only the engine's view (`view.ts`, `view-kit.ts`)                    |
| `src/app/`        | The page: `main.ts` (composition root), `presenter.ts` (what the page shows, pure), `controls.ts` (keyboard, touch stick and button), `audio.ts` (synthesized sounds), sessions and result reports |
| `src/basics.ts`   | Constants and id rules with no imports, for the service                                                                                                                                            |
| `src/platform.ts` | The `GameRegistration` for `fuse-platform`, exported as `fuseball/platform`                                                                                                                        |
| `tests/`          | Engine, bubble, match, map, codec, golden, bot, room, runtime, render, app and controls tests; run one with `pnpm exec tsx --test games/fuseball/tests/engine.test.ts`                             |

## How it fits together

- **One log, every device simulates.** A device logs only the bits it holds (`runtime.input`), each 50 ms log tick folds every rider's bits and runs the micro-steps the arena's speed allows (six at full speed, fewer in slow motion: the speed and the leftover fraction of a step are checkpointed world state, set once per tick by `paceTick`), and rollback re-folds when a late input arrives. The room service coordinates the room; it does not simulate or relay play.
- **Determinism.** The engine uses integers only: no floats, clocks, `Math.random` or trigonometry. A change to what it does must bump `RULES` in `src/engine/index.ts` and re-record the golden in the same commit (`GOLDEN_RECORD=1 pnpm exec tsx --test games/fuseball/tests/golden.test.ts` rewrites `tests/fixtures/golden.json`).
- **The bot** (`src/engine/bot.ts`) reads the world and answers with ordinary held bits once per log tick, so it has no physics a player lacks. It is part of the rules, since every device folds bot seats with it.
- **Drawing.** The page's one `requestAnimationFrame` loop blends the runtime's two newest views and hands the result to `scene.draw`. Nothing in the app or the renderer simulates; effects and sounds come from counters changing between views.
- **Results.** In an online room every rider still seated at the end reports the match once the deciding tick is confirmed (`app/reports.ts`); solo reports nothing.
- **Analytics.** `fuse.App Opened`, `Seat Taken`, `Match Started` and `Match Ended` come from `fuse-ui/play-metrics`, and `fuse.Goal Scored` (`mapId`, `ownGoal`, `suddenDeath`, `mine`) from `createGoalWatch` in `app/presenter.ts`: once per point, after it can no longer be rolled back, from the device whose rider won it (or lost it to a bot). No names, room codes or invite links are sent. See `docs/ANALYTICS.md`.

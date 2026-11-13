# Fuseball

Fuseball is a neon arena ball duel for two riders. Knock the ball into the goal in **your own colour** to score and zap the other rider; the first to three points wins, and at 2–2 the last point is sudden death.

One stick and one button: run, jump (next to the ball, the jump lifts it), air-jump as often as you like, down and the button in the air to drop fast, down and the button on the ground to power slide. Each air-jump leaves a bubble that bumps the ball away; hold the button to harden it.

The game is under construction. The deterministic engine is in place; the room, the renderer and the controls are not yet, so the page shows a placeholder.

## Layout

| Path              | What it is                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/engine/`     | The rules: integer physics at 120 micro-steps a second, the maps as data, no imports from outside the folder         |
| `src/basics.ts`   | Constants and id rules with no imports, for the service                                                              |
| `src/platform.ts` | The `GameRegistration` for `fuse-platform` (exported as `fuseball/platform`); still the scaffold's placeholder stats |
| `src/app/`        | The page: a placeholder header for now, plus the session and report-sending helpers the room page will use           |
| `tests/`          | Engine, map and layer-boundary tests; run one with `pnpm exec tsx --test games/fuseball/tests/engine.test.ts`        |

The engine never uses floats, clocks, `Math.random` or trigonometry, so a replay folds to the same world on every device. A change to its behaviour must bump `RULES` in `src/engine/index.ts`.

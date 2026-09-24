# Phase 5 — Solo POC review

The current belfry passes the technical solo traversal review. Its art direction is viable on a desktop/shared screen, while movement feel still needs user acceptance. No jump, grapple, collision or map tuning changed during this phase.

## Route and findings

The retained ordinary-input fixture runs 659 physics ticks (about 10.98 simulated seconds): low ledge, central gap, upper-right anchor, release onto the right platform, off-edge recovery, deliberate falls and reset. It never teleports or changes tuning. The test checks terrain penetration every tick, validates checkpoints at landmarks, verifies both landings/recovery without a death, and compares a second replay. The final deliberate-fall section holds movement through automatic respawn and produces two deaths before reset.

A separate real-browser route uses keyboard/mouse controls and visible-state conditions rather than injecting engine state. It reaches the same low/central/right platforms, attaches to the upper-right anchor, and returns from off-edge using a held hook. Browser input boundaries follow the room's 50 ms log ticks, so this is a companion playtest rather than a byte-identical replay of the 60 Hz engine fixture. Existing browser smoke covers fall/reset and lost-focus cancellation.

| Observation                                                                    | Interpretation / next discussion                                                                                                                                                                                  |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The first jump succeeds after stepping clear of the overhead ledge.            | Solid undersides make this opening route less immediately intuitive than a one-way-platform game. Compare one-way ledges, a different starting platform arrangement, or explicit underside behavior later.        |
| Releasing left/right in the air retains velocity; opposite input brakes it.    | This is the implemented momentum rule, not a new regression. It explains why small corrections can feel slippery. Compare ordinary air braking with preserved post-grapple momentum.                              |
| A shallow high hook attaches but may not lift from the ground.                 | Its upward acceleration component can be smaller than gravity. Jumping while attached starts the tested traversal. Decide whether a pull should guarantee lift or communicate this angle dependence more clearly. |
| Holding longer can carry the keeper past the intended landing.                 | Release timing and braking matter. The route releases around the left half of the right ledge, then brakes. Consider a pull-speed curve/cap later.                                                                |
| Off-edge recovery succeeds if the hook is held long enough to arrest the fall. | Immediate release drops the keeper. A tension/vertical-speed cue may help users learn this without changing physics.                                                                                              |

These are design findings to discuss, not proof that the current settings are the most fun. The highest-value next movement experiment would compare ordinary air braking with current momentum, while keeping grapple-release momentum separately tunable.

## Visual review

- At a 1440-pixel viewport the keeper renders roughly 65 pixels tall. The amber hood, silhouette and pale platform tops remain readable against the cool background. [Browser route capture](evidence/poc-route-desktop.png).
- At 960 pixels wide, the keeper is roughly 42 pixels tall. Platform tops and the character remain distinguishable in [color](evidence/poc-960.png) and [grayscale](evidence/poc-grayscale.png), though fine costume and ornamental details naturally disappear. This is a qualitative visual review, not a measured accessibility contrast certification.
- At 390 pixels wide, the full arena reduces the keeper to roughly 17 pixels. [Narrow layout](evidence/poc-390.png) fits without horizontal overflow, but it is not practically playable with the current desktop controls/camera. Phone control and shared-TV presentation remain separate later work.
- The status caption previously overlaid the lowest ledge on narrow screens. It now occupies a row below the canvas; a browser assertion protects that separation. The canvas retains the same aspect ratio and world geometry.
- Idle stays registered at the feet, confirmed by the existing idle smoke. Running/airborne poses still reuse the generated six-pose sheet; it is not a finished frame-by-frame jump/landing animation. Foot-contact polish remains worthwhile after motion rules settle.
- Edge foreground stays outside the traversed platform tops. Decorative braces beneath ledges are visibly separate from the solid slabs in the debug overlay. Background bridges may still invite mistaken expectations of collision; retain this as a first-time-player observation to collect.

## Reproducible measurement

[Benchmark evidence](evidence/phase5-benchmark.json) records the command, revision, exact fixture/harness hashes, CPU, OS and Node version. The engine is unchanged from `cd2667d80dffb5d6b1675d8d2a49e09528516ecc`; the fixture/harness are introduced with this review and identified by their SHA-256 values.

On Windows 10.0.26200, Node 24.14.0 and AMD Ryzen 9 9950X3D: after 100 warmup runs, 1,000 complete traversals measured a median **0.0874 ms** and p95 **0.0945 ms per 659-tick traversal**, with 88.77 ms total measured work. This measures only the headless engine, excluding rendering, networking, audio, checkpoint validation and test assertions. It is not a frame-rate or physical-device guarantee, and no optimization was warranted from this narrow result.

[Browser evidence](evidence/phase5-browser.json) records Chrome 153.0.8010.48, headless desktop viewport 1440×1100, device scale 1 and observed route landmarks. Browser captures use the same Windows host. No physical phone, gamepad, multiplayer impairment or subjective audio assessment is claimed.

From the worktree root, after building and starting the local service:

```sh
node node_modules/tsx/dist/cli.mjs --test games/hook-havok/tests/traversal.test.ts
node node_modules/tsx/dist/cli.mjs games/hook-havok/preview/benchmark.ts
node games/hook-havok/preview/poc-review.mjs http://localhost:PORT/
```

The browser script uses installed Chrome by default; `BROWSER_CHANNEL` can override it. It records real controls and screenshots, never changes the simulation to make a route succeed.

## Verification and acceptance

Typecheck, lint, build, traversal test, new POC browser route and existing showcase smoke pass. Full Windows suite: **1,631 tests; 1,623 passed; eight previously reproduced main failures** in backend-paths, ci-manifest and new-game. Existing large Phaser bundle warning remains. Independent review caught artifact-directory assumptions in the new scripts; both now create the output directory on a fresh checkout.

The branch/PR remains open for user playtesting. Phase 5's technical review is complete; artistic and movement acceptance remains with the user. No merge, deployment or Phase 6 multiplayer/combat experiment is implied.

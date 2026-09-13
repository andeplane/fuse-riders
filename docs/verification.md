# Verification record

## Final release verification

The latest full behavioral run passes **129 tests** with **99.17% lines/statements, 95.01% branches, and 99.33% functions**. Verified with `npm run test:coverage`; machine-readable totals are in `coverage/coverage-summary.json`. It includes all eight pickups, one-second Ink clouds, original synthesized TV audio, pointer-capture recovery, charged bomb release, Triple/Five Shot precedence, Orbit Shield, safe Portal transit, match statistics, session scoring, protocol, server, controller state, and snapshot projection.

Portal coverage includes entry hazards before teleport, failed placement retaining the pickup, safe exit checks against heads/trails/bomb flight/blasts, trail breaks, exact cooldown/grace deadlines, replacement, round resets, compact snapshot omission, and simultaneous riders reserving a shared exit. Circular-blast tests verify diagonal damage, trail clearing and chain reactions. Shrinking-field tests check trail geometry and visual clipping. Seeded Beer Worms tests measure over 2.3 times the original turning.

`npm run build` and TypeScript checking pass. The final combined browser smoke passes in Chrome and WebKit, including all eight pickups, portal-wall transit, audio controls, touch interruption/re-entry, Ink countdown, a Five Shot volley after collecting Triple Shot, authoritative phone launch feedback, and portrait/landscape layouts without overflow.

## Browser and performance evidence

Final Chrome and WebKit smoke runs passed with five independent phone-controller sessions. They exercised host authentication including hash changes, QR display, portrait/landscape controls, pointer steering/release, bomb actions, pickups, leaderboard, theme changes without simulation changes, same-seat refresh recovery, first-to-three, and rematch. They ran on isolated ephemeral servers, not the live match.

The controlled busy renderer fixture measured **60.16 FPS** with **16.7 ms p95 frame time** after performance improvements. The original pre-hotfix fixture measured 7.10 FPS. These are controlled browser measurements, not physical-TV measurements. `scripts/visual-fixture.ts` produces scenes for comparison with the [neon/pixel reference](gameplay-concepts/06-neon-pixel-hybrid.png).

The user has played on physical phones over household Wi-Fi and confirmed the controller zoom fix. Physical end-to-end input latency has not been measured. The display's `P` key or `?perf=1` enables diagnostics; controller diagnostics expose transport timing separately from render FPS.

## Scope and methods

`npm run test:coverage` enforces 95% lines/statements/functions and 85% branches across shared simulation/protocol modules, server behavior, controller state and pointer bindings, audio direction, snapshot streaming, and render-snapshot projection. Canvas and DOM rendering are checked separately by browser smoke and visual fixtures; coverage percentages do not describe the entire UI renderer. HTML coverage is generated in `coverage/`.

Tests use typed injection rather than global patches. `ServerDependencies` supplies monotonic time, token generation, and scheduling; `manualTicks`, `advance`, and `checkConnections` support exact simulation/watchdog assertions. `ControllerInputState` accepts a typed `InputTransport`. Engine tests supply typed input maps, and Portal placement accepts injected randomness and safety callbacks. WebSocket tests cross the real serialized protocol boundary with independent connections.

GitHub Actions passed type checking, coverage, build, Chrome and WebKit on release commit `4870c24` ([run](https://github.com/andeplane/slackgame/actions/runs/34780586957)). The initial private-repository run was blocked by account billing; the public-repository run succeeded. Physical speaker playback has not been independently listened to.

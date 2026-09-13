# Verification record

Verified in the current worktree:

- `npm run build` completes successfully.
- Browser smoke coverage exercised five simultaneous controller sessions against the display.
- 30 unit/integration tests pass across engine, protocol, server, controller state, and snapshot stream behavior.
- `npm run typecheck` passes.
- Coverage gates pass: 98.59% lines/statements, 91.68% branches, 98.48% functions across the measured behavioral modules.
- Browser smoke checks TV host authentication and QR, five separate phone sessions, portrait/landscape layouts, pointer steering/release, bomb taps, theme changes without simulation changes, same-seat refresh recovery, first-to-five and rematch. No browser JavaScript errors were observed.
- The same browser smoke passes in Chrome and WebKit.
- `scripts/visual-fixture.ts` produces controlled renderer scenes for comparison with the chosen neon/pixel reference. These fixtures are art checks, not live gameplay evidence.

The configured coverage command is `npm run test:coverage`, with gates of 95% lines/statements/functions and 85% branches for engine, protocol, server, controller-state, and snapshot-stream modules. Canvas/DOM rendering is checked separately by the browser smoke and visual fixture; the percentages do not cover the entire UI renderer. HTML coverage output is generated in `coverage/`.

Tests use typed injection rather than global patches: `ServerDependencies` supplies monotonic time, token generation and a scheduler; `manualTicks`, `advance` and `checkConnections` permit exact simulation/watchdog assertions. `ControllerInputState` accepts a typed `InputTransport`. Pure engine tests supply typed input maps. WebSocket integration tests cross the real serialized protocol boundary with independent connections.

Real phones on household Wi-Fi and the HDMI-connected TV remain unverified.

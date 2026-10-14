# Local multiplayer integration evidence

Browser runs on October 14, 2026 used the combined integration build at `236c043c`, served by the local development room service at `http://127.0.0.1:4917`. Chromium and WebKit exercised the real landing, local setup, runtime, simulation, dialogs and renderer in fresh muted pages.

```sh
BASE_URL=http://127.0.0.1:4917 pnpm exec tsx scripts/local-gamepads-smoke.ts
BASE_URL=http://127.0.0.1:4917 BROWSER=webkit pnpm exec tsx scripts/local-gamepads-smoke.ts
```

The baseline smoke passed in both browsers: independent steering and charge/release for two simulated gamepads and three keyboard players, disconnected-pad cancellation, and dialog cancellation. Both runs reported zero page errors.

Separate temporary browser checks also passed in both browsers: closing the shortcuts dialog while pad buttons stayed held did not restart charges; neutralizing the pads then pressing and releasing again resumed controls. They captured actual portrait setup and play at 390×844. Their screenshots are retained below; the temporary smoke extension was not kept in the repository.

Later screenshot-refresh attempts timed out during a new charge assertion and the baseline wait for play while host load rose to approximately 438. These incomplete attempts are not recorded as passes. No application changes were made in response to those timeouts.

The harness substitutes only `navigator.getGamepads`, with typed snapshots. These results establish browser integration, not physical-controller or physical-phone qualification. The dialog blocks controls; gameplay continues rather than pausing its clock.

Screenshots are grouped by browser in the adjacent directories. The setup panel scrolls when the roster exceeds the viewport height.

The original PR was separately integrated with main at `01266922`. Its 43 focused controller, local-runtime, setup and dialog tests, typecheck, build and targeted lint passed. The local-gamepad smoke now opens Riders' dedicated `/fuse-riders/` route because `/` serves the game gallery. A fresh Chromium attempt reached local setup but timed out waiting for play with host load above 400; this attempt is incomplete and does not replace the browser passes or screenshots above.

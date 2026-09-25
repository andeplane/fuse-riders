# RTS battlefield UI

The battlefield now spans the screen between a 44px resource bar and a compact bottom command dock. Selection details, a desktop portrait and attack priority sit beside a 3×2 icon command card. Commands show their shortcut keys (N/T/R/X/L/F); Research shows G/E/C. Buttons reflect selection and availability, and shortcuts activate only enabled commands outside text/slider inputs. Research and Log are dismissible popovers; there is no permanent right-hand menu. Commands are 60px square on desktop, 48px on portrait phones and 44px in short landscape.

Decorative slate terrain continues to every viewport edge, including the sawtooth gaps beyond the outer hexes. It follows the camera at every zoom level, exposing no dark outside. The continuation has no selectable cells or pointer targets and adds no buildable area.

Scroll-wheel and trackpad input zoom around the pointer. Touch supports one-finger pan and two-finger pinch zoom, including continuing to pan with the remaining finger. Fit map shows the entire map. There are no +/− zoom buttons. Keyboard selection brings off-screen cells into view. Camera state survives simulation updates and cancelled reset/menu confirmations; no simulation geometry or timing changed.

## Browser evidence

Run `pnpm exec vite --host 127.0.0.1 --port 5174`, then:

```sh
pnpm exec tsx scripts/neural-defence-ui-smoke.ts http://127.0.0.1:5174/games/neural-defence/?mute
```

The real New game → sandbox flow passed in Chromium and WebKit at 1440×900, 390×844, 320×568 and 568×320. Checks cover full-width battlefield geometry, visible command controls and priority slider, no horizontal overflow, wheel zoom, drag without selection, Fit map, camera preservation through a cancelled menu confirmation, Research open/close, phone building, portrait-to-landscape resize and command shortcuts. Chromium's trusted multi-touch input also verifies pinch zoom and one-finger pan without accidental selection. Line-mode wheel input and release-outside-before-drag regressions are exercised through the browser adapter.

These are browser/device-emulation checks, not physical-phone, online-room or real-network evidence. Screenshots come from the actual flow:

- [Desktop battlefield](rts-desktop.png)
- [Phone battlefield](rts-phone.png)
- [Short landscape during construction, after Fit map](rts-landscape.png)

## Review

Independent review found two camera issues: a mouse released outside the viewport before capture could retain a stale drag, and line-mode wheels were interpreted as pixels. Both were fixed and browser regressions added. Follow-up review found no remaining actionable issues and independently reran the camera/UI tests (8 passed). Safari's different button-focus behavior also exposed Escape not reaching the app after opening Research; opening a popover now focuses its close control, and the WebKit flow passes.

Subsequent review of the terrain continuation and icon command-card/hotkey additions found no actionable issues. The suggested 320px phone check passed. A dedicated UI regression verifies research shortcuts, disabled commands, modifier/repeat guards, input focus and confirmation blocking.

The draft PR remains open for visual/playtesting feedback; this change has not been merged or deployed.

# RTS battlefield UI

The battlefield spans the screen between a 44px resource bar and a compact bottom command dock. Selection details, a desktop portrait and attack priority sit beside a 3×2 icon command card. Every grid uses Q/W/E across the top and A/S/D across the bottom. Main commands are Build, Research, Log and cancel selected construction. Build and Research replace the same slots with their entries, A Back and S Cancel; unused slots stay empty. Buttons reflect selection and availability, and shortcuts activate only enabled commands outside text/slider inputs. A or Escape returns from submenus. Commands are 60px square on desktop, 48px on portrait phones and 44px in short landscape.

Build/research rules and structured availability reasons live in the immutable engine catalog, consumed by simulation and command presentation. Grey buttons explain missing requirements on hover/focus and touch; the action guard prevents explanatory taps from dispatching. Legal queued construction explains what must become available before work begins. Clock overlays follow authoritative construction and research progress, on child and parent buttons. Long explanations scroll within the available viewport.

Decorative slate terrain continues to every viewport edge, including the sawtooth gaps beyond the outer hexes. It follows the camera at every zoom level, exposing no dark outside. The continuation has no selectable cells or pointer targets and adds no buildable area.

Scroll-wheel and trackpad input zoom around the pointer. Touch supports one-finger pan and two-finger pinch zoom, including continuing to pan with the remaining finger. There are no Fit map or +/− zoom buttons. Keyboard selection brings off-screen cells into view. Camera state survives simulation updates and cancelled reset/menu confirmations; no simulation geometry or timing changed.

## Browser evidence

Run `pnpm exec vite --host 127.0.0.1 --port 5174`, then:

```sh
pnpm exec tsx scripts/neural-defence-ui-smoke.ts http://127.0.0.1:5174/games/neural-defence/?mute
```

The real New game → sandbox flow is exercised in Chromium and WebKit at 1440×900, 390×844, 320×568 and 568×320. Checks cover full-width battlefield geometry, visible controls, no horizontal overflow, wheel zoom, drag without selection, camera preservation through a cancelled menu confirmation, Build/Research/Log navigation, grey-button explanations by hover and phone tap, building progress, portrait-to-landscape resize and command shortcuts. Chromium's trusted multi-touch input also verifies pinch zoom and one-finger pan without accidental selection. Line-mode wheel input and release-outside-before-drag regressions are exercised through the browser adapter.

These are browser/device-emulation checks, not physical-phone, online-room or real-network evidence. Screenshots come from the actual flow:

Final local verification: 1,660 tests passed (50 Neural Defence tests), typecheck/build and focused ESLint passed. The seeded four-owner replay retains hash `6670eaf7`. Both browser flows passed. Long landscape tooltip geometry is checked in both; actual scrolling without map zoom is checked in Chromium because mobile WebKit automation cannot synthesize wheel/swipe scrolling.

- [Desktop battlefield](rts-desktop.png)
- [Phone battlefield](rts-phone.png)
- [Short landscape during construction](rts-landscape.png)
- [Research requirements](rts-research.png)

## Review

Independent review found two camera issues: a mouse released outside the viewport before capture could retain a stale drag, and line-mode wheels were interpreted as pixels. Both were fixed and browser regressions added. Follow-up review found no remaining actionable issues and independently reran the camera/UI tests (8 passed). Safari's different button-focus behavior also exposed Escape not reaching the app after opening Research; entering a command submenu now focuses its Back control, and the WebKit flow passes.

Subsequent review of the terrain continuation and icon command-card/hotkey additions found no actionable issues. The suggested 320px phone check passed. A dedicated UI regression verifies research shortcuts, disabled commands, modifier/repeat guards, input focus and confirmation blocking.

The draft PR remains open for visual/playtesting feedback; this change has not been merged or deployed.

The shared-catalog review found no current-rule behavioral regression and independently passed 18 engine tests. Its immutability finding was fixed with readonly definitions and runtime freezing. The command review's Build ARIA label and non-scrollable landscape tooltip findings were fixed. Focused app tests cover live deficits, completed research, prerequisite wording, blocked explanatory clicks and authoritative clock progress.

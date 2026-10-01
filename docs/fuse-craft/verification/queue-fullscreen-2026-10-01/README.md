# Queued neurons and full screen — 2026-10-01

Real flow in Chromium at 1280×800 against `pnpm build` and `service/dev.ts` (`/fuse-craft/?mute`), Cortex Crossing skirmish, rules 13.

- [placement-ring2.png](placement-ring2.png): Build → Neuron armed. The six hexes around the brain are outlined (exactly its neighbours: 61, 62, 89, 91, 119, 120), although the brain's artwork covers them. Hovering the hex that looks beside the core (two steps away) shows the amber "Not connected" ghost and hint.
- [queued-line.png](queued-line.png): eight neurons Shift-queued in a line from the brain with the real mouse. They grew one after another, one every six seconds (territory 7 → 21).

Edge scrolling, measured from the SVG viewBox while the mouse rests and does not move: the window's last column (x 1279), last row (y 799, over the command dock), first column and first row (over the top bar) each scroll that way continuously; the dock and top bar away from the outer pixels, and the board's centre, do not. After `mouseleave` on the document element, and after a window `blur`, scrolling stops.

Full screen: the ⛶ button and F put `#app` (the game container) in full screen and the button reports `aria-pressed="true"`; `document.exitFullscreen()` (as Esc does) clears it and the button follows through `fullscreenchange`. Headless Chromium grants the request but cannot show OS full screen or prove the mouse is confined; that needs a desktop browser.

# Screen saver: 3D Pipes

FuseOS has one screen saver, the Windows 95 **3D Pipes**, as remade in three.js by Isaiah Odhner ([1j01/pipes](https://github.com/1j01/pipes), MIT; licence text in [`licenses/PIPES-LICENSE.txt`](licenses/PIPES-LICENSE.txt)). It is ported as typed TypeScript under `packages/fuseos/src/screensaver/pipes/`: the rules (grid, direction and joint choice, camera angles, dissolve order) in `pipesModel.ts`, with no rendering so they run in plain tests, and the three.js scene in `pipes.ts`.

## Settings

Control Panel, Display, **Screen Saver** (`src/controlpanel/ScreenSaverApplet.tsx`, exported as the `SCREEN_SAVER_DISPLAY_TAB` registration for the tabbed Display applet):

- **Screen saver**: `None` or `3D Pipes`; **Wait** 1 to 60 idle minutes (default 3D Pipes after 5 minutes); **Preview** starts it at once.
- **Settings for 3D Pipes**: joint style (Elbows, Balls, Mixed, or Cycle through all, one style per scene), Multiple pipes (two or three per scene), Teapots now and then (the Utah teapot at one turn in two hundred, one in twenty on a candy cane scene, which is one scene in twenty).

The preferences live in `localStorage` under `fuseos.screensaver` (`screenSaverStore.ts`, with a `MemoryScreenSaverStore` for tests). Corrupt or blocked storage falls back to the defaults.

## Behaviour

- `ScreenSaverProvider` (mounted in `Shell.tsx`) owns the idle timer. Any `pointermove`, `pointerdown`, `keydown`, `wheel`, `touchstart` or visibility change re-arms it; the saver never starts while the tab is hidden or the shutdown screen is up.
- A game window keeps its mouse and keyboard to itself (iframe input never reaches the desktop), so when the timer fires while an iframe has focus the provider treats that as activity and re-arms instead of starting. The saver never covers a game being played.
- `ScreenSaverOverlay` covers the viewport (`position: fixed`, above the retro-resolution fit) and `await import()`s `pipes.ts`, and with it `three`, only then: three.js is a lazy chunk that the desktop never loads otherwise (`tests/fuseos-screensaver-lazy.test.ts` walks the static imports from `main.tsx` and fails if `three` or the pipes module becomes reachable).
- Any mouse or key wakes the desktop; the event is swallowed so it does not land on a window. Open windows are untouched.
- Without WebGL the overlay says so and still wakes on input.

## Scenes

Each scene starts one pipe (or two to three with Multiple pipes) at a random cell of a 21×21×21 grid. Every frame a pipe either keeps straight (half the time) or picks one of the six directions; a cell outside the grid or already taken is skipped and the pipe tries again next frame. Where it turns it gets a joint: a ball, the teapot, or the upstream "elball" (a sphere the pipe's own radius). After 16 to 24 seconds the frame freezes and dissolves in random 20-pixel blocks over two seconds; then the camera picks a new angle (head-on half the time, otherwise a quarter turn about a random axis) and the next scene starts.

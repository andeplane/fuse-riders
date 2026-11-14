# FuseOS

FuseOS is the Windows 98 desktop at the root of the Fuse games site
(`packages/fuseos`, mounted by `site/main.ts`). Every game listed in
`games/<id>/portal.json` is an icon on the desktop and opens in a window of its
own; Paint, Winamp, Clippy, a Control Panel and the retro games under
Start > Programs > Games come along for the ride. It is the games' front door,
not a product of its own: no accounts, no server, nothing stored beyond the
browser's `localStorage`.

## Running it

```sh
pnpm exec vite              # the desktop at http://localhost:5173/ (every game page beside it)
pnpm test:os                # the desktop's unit tests (vitest, happy-dom, Testing Library)
pnpm test:os:coverage       # the same with the coverage thresholds
pnpm build                  # typecheck both tsconfigs, then vite build
pnpm fuseos:sync            # refresh js-dos and Clippy under public/fuseos from node_modules
```

Useful URLs: `?open=fuseball` boots straight into a game window
(`?open=fuseball,paint` opens several; also `winamp`, `settings` and the retro
ids), `?mute` carries into every embedded game (what agents preview with), and
the state of the desktop lives under the `fuseos.state` key in `localStorage`.

## What is where

| Path                            | What                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `packages/fuseos/src/main.tsx`  | Mounts the desktop: reads `?open` and `?mute` once, wires the stores and the lazy Webamp loader |
| `src/App.tsx`, `BootScreens*`   | The boot screen (below), held for at least `BOOT_HOLD_MS`, then the `Shell`                     |
| `src/state`                     | The window list reducer, `StateStore` (localStorage and Memory), deep links                     |
| `src/desktop`                   | Desktop, icons, taskbar, Start menu, window host and titles (`windowMeta.ts` holds `OS_NAME`)   |
| `src/windows`                   | Window frames, manager and `IframeGame`                                                         |
| `src/fusegames`                 | The game registry built from `portal.json` and the game window                                  |
| `src/retro`                     | The DOS and web retro games ([docs](retro-games.md))                                            |
| `src/winamp`                    | Webamp on the desktop ([docs](winamp.md))                                                       |
| `src/assistant`, `src/llm`      | Clippy and the in-browser language model behind him ([docs](assistant/README.md))               |
| `src/paint`, `src/controlpanel` | Paint and the Control Panel applets                                                             |
| `src/about`                     | The About sheet: version, copyright and credits                                                 |
| `src/halloffame`                | The Hall of Fame: per-game Elo leaderboards (Start > Programs, Fusteam's News tab)              |
| `src/taskmanager`               | Task Manager: open windows, their frame rates and the heap (Ctrl+Shift+Esc)                     |
| `src/bsod`, `src/y2k`           | The blue screen (Ctrl+Alt+Delete) and the millennium bug at local midnight (`?y2k=now`)         |
| `src/assets`                    | The FuseOS mark, splash and the Winamp icon, drawn in SVG                                       |
| `public/fuseos`                 | js-dos, the retro game bundles, Clippy's sprites and `fuseos.svg`, the favicon                  |
| `docs/fuseos`                   | This folder: the desktop's docs and the licence texts of what it bundles                        |

## Boot screen

`src/BootScreens.tsx` shows `assets/FuseOsSplash.tsx`, the FuseOS splash: the
name spelled from a 5x7 pixel font and a four-pane mark in the games' portal
accents (`assets/fuseOsMark.ts`), over a night sky and a synth floor grid,
drawn as SVG rectangles so it needs no font or bitmap. Along the bottom edge a
neon band scrolls forever, the way the Windows 98 boot screen's did
(`BootScreens.css`; a still band under `prefers-reduced-motion`). `App` keeps
the screen up for `BOOT_HOLD_MS` (1.5 s) so a cached load still boots visibly;
its `<main>` is labelled "Starting FuseOS" for screen readers and tests.

## About

Start > Help > About FuseOS (`src/about/AboutDialog.tsx`) shows the splash,
the version (`src/about/version.ts`, kept equal to
`packages/fuseos/package.json`), the copyright line and the credits in
`src/about/credits.ts`: 98.css, the React95 icons, react-rnd, Webamp, js-dos,
clippyjs, WebLLM, CodeMirror, 1j01's 3D Pipes, the shareware publishers,
skifree.js, micropolisJS, the Vector Playing Cards and the games' soundtracks.
The licence texts of the bundled games are under [licenses](licenses/) and listed in [retro-games.md](retro-games.md).

## Branding

The desktop is FuseOS and nothing else: the names of the desktop it descends
from and of that desktop's surroundings may not appear anywhere under
`packages/fuseos`, `public/fuseos` or `docs/fuseos`.
`tests/fuseos-branding.test.ts` (part of `pnpm test`) lists the words and greps
every text file in those trees for them; it also checks that the About version
matches the package version and that the credits name what the desktop stands
on.

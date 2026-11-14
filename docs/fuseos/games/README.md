# Games

This folder holds the credits and licence texts for Programs > Games; the playable files live under `public/games` (bundles are named `.jsdos.wasm` because App Hosting rejects `.jsdos` and `.zip` uploads but accepts `.wasm`; js-dos ignores the extension). Everything is served from this app's own origin: the Flows content security policy only allows scripts, workers and frames from `'self'`, and third-party emulator pages neither auto-start nor allow framing. Nothing here is written by Cognite except `README.md`, the `.jsdos/dosbox.conf` bundle configs and the js-dos player page under `../jsdos`.

| Game | How it runs | Where it comes from | Terms |
| --- | --- | --- | --- |
| DOOM (shareware episode 1, v1.9) | `doom.jsdos.wasm` in js-dos | [Internet Archive: DoomsharewareEpisode](https://archive.org/details/DoomsharewareEpisode) | Shareware, id Software. `licenses/DOOM-README.TXT` |
| Wolfenstein 3D (shareware episode 1, v1.4) | `wolf3d.jsdos.wasm` in js-dos | [Internet Archive: Wolfenstein3d](https://archive.org/details/Wolfenstein3d) | Shareware, id Software / Apogee. `licenses/WOLF3D-VENDOR.DOC`, `licenses/WOLF3D-FILE_ID.DIZ` |
| Commander Keen 1: Marooned on Mars (shareware) | `keen1.jsdos.wasm` in js-dos | [Internet Archive: msdos_Commander_Keen_1_-_Marooned_on_Mars_1990](https://archive.org/details/msdos_Commander_Keen_1_-_Marooned_on_Mars_1990) | Shareware, id Software / Apogee. `licenses/KEEN1-VENDOR.DOC` |
| Duke Nukem 3D (shareware v1.3d, 1998 repack) | `duke3d.jsdos.wasm` in js-dos | [Internet Archive: 3dduke13SW](https://archive.org/details/3dduke13SW) | Shareware, 3D Realms. `licenses/DUKE3D-LICENSE.TXT` |
| Minesweeper | Native React component (`src/games/minesweeper`) | Written for Industrial OS | Part of this app |
| Solitaire | Native React component (`src/games/solitaire`); card faces from `solitaire/cards.png` | Written for Industrial OS; card faces from [notpeter/Vector-Playing-Cards](https://github.com/notpeter/Vector-Playing-Cards) (Byron Knoll's vector playing cards) | Part of this app; the card faces are public domain, `solitaire/VECTOR-PLAYING-CARDS-README.md` |
| SkiFree | `skifree/index.html` in a same-origin frame | [basicallydan/skifree.js](https://github.com/basicallydan/skifree.js) by Dan Hough | MIT, `skifree/LICENSE.md` |
| Micropolis | `micropolis/index.html` in a same-origin frame | [graememcc/micropolisJS](https://github.com/graememcc/micropolisJS) by Graeme McCutcheon | GPL-3.0 with additional terms (`micropolis/LICENSE`, `micropolis/COPYING`) and the Micropolis Public Name License (`micropolis/MicropolisPublicNameLicense.md`) |

## Shareware terms

The four DOS games are the shareware episodes their publishers released for free distribution. id Software's and Apogee's vendor documents and 3D Realms' licence allow individuals and free online services to pass the unmodified shareware on without charge; the bundles contain each archive's files unmodified, plus a `.jsdos/dosbox.conf` that mounts the folder and starts the game. No registered episodes are included. Read the licence files before redistributing this app commercially: rack, CD-ROM and paid distribution need written permission from the publishers.

## js-dos

The DOS games boot in [js-dos](https://js-dos.com) 8.4.1 by Alexander Guryanov (GPL-2.0, source at [caiiiycuk/js-dos](https://github.com/caiiiycuk/js-dos)). `scripts/copy-jsdos.mjs` copies `js-dos.js`, `js-dos.css` and the DOSBox WebAssembly core (`emulators.js`, `wdosbox.js`, `wdosbox.wasm`, `wlibzip.js`, `wlibzip.wasm`) from the npm package into `../jsdos`. The player runs in `../jsdos/player.html`, a page of its own, because js-dos ships a global stylesheet and keyboard handling that must not leak into the desktop. `manifest.json` adds `'wasm-unsafe-eval'` to `script-src` for the core; nothing is loaded from js-dos.com or dos.zone (`noCloud`).

## SkiFree

skifree.js is vendored as built by its author (`dist/skifree.js`, the sprite sheets and stylesheets). `index.html` is ours: the analytics snippet and the GitHub banners were dropped, inline scripts being blocked by the content security policy anyway.

## Micropolis

micropolisJS is a port of Micropolis, the GPL release of the 1989 city simulator. It is built from source with the repo's own webpack toolchain by `scripts/vendor-web-games.py` and copied here with its `LICENSE`, `COPYING` and `MicropolisPublicNameLicense.md`. Changes from upstream: the build id is `vendored`, the Twitter widget is removed and the inline `data-hasscript` script moved to `hasscript.js`.

Micropolis is a registered trademark of Micropolis Corporation (Micropolis GmbH) and is licensed here as a courtesy of the owner under the [Micropolis Public Name License](https://www.micropolis.com). The game is not affiliated with Electronic Arts; the name SimCity is an Electronic Arts trademark and is not used for it.

## Solitaire

Solitaire is Klondike written for this app in React (`src/games/solitaire`): the Windows 98 rules and scoring, draw one or three, Standard, Vegas or no scoring, a timer, Undo, twelve card backs and the bouncing card cascade. No Microsoft bitmaps are used. The card faces are Byron Knoll's Vector Playing Cards, released into the public domain and mirrored at notpeter/Vector-Playing-Cards; `scripts/vendor-web-games.py --only solitaire` downloads the SVGs and rasterises the 52 faces with `rsvg-convert` (librsvg) into one sprite sheet, `solitaire/cards.png` (13 columns ace to king, 4 rows clubs, diamonds, hearts, spades, 142x192 px per card, twice the 71x96 card size). The card backs are drawn in SVG in `src/games/solitaire/cardBacks.tsx`, in the spirit of the classic designs without copying them.

## Regenerating

```bash
npm run games:bundles   # python3 scripts/build-jsdos-bundles.py, downloads the archives into scripts/.shareware
npm run games:vendor    # python3 scripts/vendor-web-games.py, needs node and npm for the Micropolis build and rsvg-convert for the Solitaire cards
npm run build           # runs scripts/copy-jsdos.mjs first
```

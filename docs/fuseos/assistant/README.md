# Office Assistant

The paperclip on the desktop is the classic Office Assistant "Clippit". The
sprite sheet, the frame table and the sounds come from the
[clippyjs](https://github.com/pi0/clippyjs) npm package (MIT licensed code,
copyright 2012 Fireplace, Inc and 2017 Pooya Parsa); the artwork and sounds
themselves are Microsoft's Office Assistant assets, used here for the
Windows 98 look of this app.

`scripts/copy-clippy.mjs` runs before every build and writes, from
`node_modules/clippyjs/dist/agents/clippy`:

| File                                  | Content                                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `public/assistant/clippy/agent.json`  | The frame table: 43 animations, each a list of frames with duration, sprite offsets, branches and sound ids |
| `public/assistant/clippy/map.png`     | The sprite sheet (124x93 pixel frames)                                                                      |
| `public/assistant/clippy/sounds.json` | The 15 sounds as `data:audio/mpeg` URIs                                                                     |
| `public/assistant/clippy/VERSION.txt` | The clippyjs version copied                                                                                 |

The files are committed so the tree builds offline. The clippyjs runtime is not
used: `src/assistant/spritePlayer.ts` steps through the frame table itself and
`ClippySprite` draws the frames with `background-position`, so nothing is loaded
from a CDN (the Flows CSP only allows our own origin) and tests can drive the
clock.

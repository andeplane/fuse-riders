# Fuse Drivers

Top-down offroad racing for two to five drivers and bots, in the spirit of Ivan "Ironman" Stewart's Super
Off Road: the whole track on one screen, four laps, dirt, mud, water, oil, ramps and moguls, and Mario
Kart style weapons. Served at `/fuse-drivers/` (locally **http://localhost:8787/fuse-drivers/**).

Drive with the arrows or `A`/`D`, brake with `S`, nitro on `Shift`, use an item with `Space`, and hold
`Down` with `Space` to use it the other way: a mine lobbed ahead, a missile fired backwards. The throttle
is always on. On a phone the same controls are the four buttons under the arena.

## How it fits the shared packages

The rules (`src/game/`) fold on `fuse-netcode`'s shared input log: every device simulates the identical
race from the same entries, and nobody is the authority. The page (`src/app/`) is `fuse-ui` for the
landing, lobby, invite and results, with the arena as a lazily imported Phaser renderer that the page's
own frame loop drives. `src/platform.ts` registers the racing stats with the room service.

Two details are specific to a racing game on a 50 ms log:

- **The race runs at 30 Hz against a 20 Hz log**, so the fold runs two simulation steps on an even log
  tick and one on an odd. `steps()` reports the same number before the tick runs. See
  [the design note](../../docs/design/fuse-drivers-port.md).
- **A driver logs only a change of controls.** Thumbs stay put for seconds, so silence in the log means
  still as before, and a race costs a few entries per corner rather than one per tick.

## Tracks

`tracks/*.tmj` are Tiled maps, with mirrored and reversed variants generated beside each. The fold may
not read files, so `node scripts/fuse-drivers-tracks.mjs` bakes them into `src/game/tracks-data.ts`; run it
after editing a map. `npx tsx scripts/fuse-drivers-tick-cost.ts` reports what a log tick costs.

## Checks

```sh
npx tsx --test games/fuse-drivers/tests/*.test.ts
```

`sim-*.test.ts` are the simulation's own suite, carried over from the game's first home, including a
recorded replay hash that pins its physics. The rest cover the fold, the checkpoint, the mesh and the
page.

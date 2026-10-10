# Fuse Axe

A co-op pixel-art beat-em-up for 1–5 heroes in the spirit of Golden Axe II. Work in progress: see
[`docs/design.md`](docs/design.md) for the game and the delivery plan, and
[`docs/concept-art.html`](docs/concept-art.html) (open it in a browser) for the concept art.

## Play it

Open `/fuse-axe/` on a running service, or pick **Fuse Axe** from the app portal (the dot grid at the top left of
every game). **PLAY SOLO** opens the hero picker; **CREATE ROOM** makes a room to share by code, link or QR code,
where everyone picks a hero (duplicates are allowed) and the host presses **START**. So far the heroes walk, jump and swing
through a placeholder scene of boxes; enemy waves, the pixel-art renderer, phone pads and the shared screen follow.

| Keys          | Does                                |
| ------------- | ----------------------------------- |
| Arrows / WASD | Walk the road, up and down in depth |
| J / Z         | Attack                              |
| K / X         | Jump                                |
| L / C         | Magic                               |

```sh
pnpm build && pnpm exec tsx service/dev.ts   # then open http://localhost:8787/fuse-axe/?mute
pnpm exec tsx --test games/fuse-axe/tests/*.test.ts
node games/fuse-axe/preview/smoke.mjs http://localhost:8787/ [screenshot-dir]   # by hand, against the service
```

Production serves Fuse Axe rooms only once `EXTRA_GAME_IDS` names `fuse-axe` ([GCP deploy](../../docs/online/GCP-DEPLOY.md));
until then the page offers solo only.

## Sprites

Sprites are palette-indexed pixel data painted in code (`src/render/pixel/`): a rig paints shapes with surface
normals, lights them from the upper left into each material's three-shade ramp from the master palette
(`palette.ts`), edges overlapping parts and outlines the silhouette. A figure (`src/render/art/brakka.ts`) is a set of
poses, each joint positions on a small canvas plus a feet anchor; a new frame is a new pose, often
`adjust(idle, { near: { hand: [37, 21] } })`; a pose that paints onto its canvas's outermost pixels throws, so
widen `size` for a long reach. The renderer bakes a frame once per swap, flash and flip through
`createSpriteBaker(makeSurface).bake(sprite, { swap, flash, flip })` and draws it at `(x - ax, y - ay)`.

To see every figure's frames at 4× and 1×, with palette swaps, the damage flash and the flip, run `pnpm exec vite`
and open `/games/fuse-axe/lab/sprites.html`. The lab is dev-only: it is not in the build and not on the portal.
[`docs/images/sprite-lab.png`](docs/images/sprite-lab.png) is a screenshot of it.

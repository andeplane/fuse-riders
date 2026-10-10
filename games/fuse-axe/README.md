# Fuse Axe

A co-op pixel-art beat-em-up for 1–5 heroes in the spirit of Golden Axe II. Work in progress: see
[`docs/design.md`](docs/design.md) for the game and the delivery plan, and
[`docs/concept-art.html`](docs/concept-art.html) (open it in a browser) for the concept art.

```sh
pnpm exec tsx --test games/fuse-axe/tests/*.test.ts
```

## Sprites

Sprites are palette-indexed pixel data painted in code (`src/render/pixel/`): a rig paints shapes with surface
normals, lights them from the upper left into each material's three-shade ramp from the master palette
(`palette.ts`), edges overlapping parts and outlines the silhouette. A figure (`src/render/art/brakka.ts`) is a set of
poses, each joint positions on a small canvas plus a feet anchor; a new frame is a new pose, often
`adjust(idle, { near: { hand: [37, 21] } })`. The renderer bakes a frame once per swap, flash and flip through
`createSpriteBaker(makeSurface).bake(sprite, { swap, flash, flip })` and draws it at `(x - ax, y - ay)`.

To see every figure's frames at 4× and 1×, with palette swaps, the damage flash and the flip, run `pnpm exec vite`
and open `/games/fuse-axe/lab/sprites.html`. The lab is dev-only: it is not in the build and not on the portal.
[`docs/images/sprite-lab.png`](docs/images/sprite-lab.png) is a screenshot of it.

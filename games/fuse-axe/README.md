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
`adjust(idle, { near: { hand: [50, 40] } })`; a pose that paints onto its canvas's outermost pixels throws, so
widen `size` for a long reach. The renderer bakes a frame once per swap, flash and flip through
`createSpriteBaker(makeSurface).bake(sprite, { swap, flash, flip })` and draws it at `(x - ax, y - ay)`.

Every hero paints the same frames, `HERO_FRAMES` in `src/render/art/animate.ts`: a two-frame breath, a six-frame
walk, rise, fall and land, a wind-up, strike and follow-through for each of the combo's three swings, then hurt,
knockdown, down and getup; plus a 16 × 16 HUD portrait and palette swaps for up to five of the same hero. The kit's
`stride` lays out a walk's legs, `breath` an exhale and `bend` a knee or elbow, so a new hero only adds its poses.
`heroFrame(kind, anim, animStep)` picks the frame for a hero in the view, timed by view-kit's `SWING_STEPS` and
`JUMP_RISE_STEPS`: the strike exactly in the swing's active steps (a hit's freeze holds it, as the engine stops
counting `animStep`), the walk at a cadence that keeps a planted foot still on a straight walk along the road. It
never throws, so a frame cannot stop the renderer: an odd `animStep` is rounded to a whole step from 0, and a new
engine state fails to compile until it has frames. `tests/animate-engine.test.ts` checks it against the real engine.

To see every figure's frames at 3× and 1×, each hero's swaps, flash, flip and portrait, and a reel per anim at game
speed, run `pnpm exec vite` and open `/games/fuse-axe/lab/sprites.html`. The lab is dev-only: it is not in the build
and not on the portal. [`docs/images/brakka-frames.png`](docs/images/brakka-frames.png) is a screenshot of it.

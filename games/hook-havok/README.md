# Hook Havok

An illustrated 2D grappling-platformer experiment for the Fuse party pack.

## Current milestone

Visual foundation only: compare original art directions and prove a small asset-production workflow before building the playable scene. This directory is not yet a registered game or a playable prototype. No package, entry page, physics, or room service changes are needed for this milestone.

- [Experiment plan](docs/experiment-plan.md)
- [Art direction](docs/art-direction.md)
- [Asset manifest and generation prompts](docs/asset-manifest.md)

The provisional working environment is the Lantern Belfry. Alternative concepts remain available for the user's artistic review; provisional selection is not acceptance of the final appearance.

## Review board

### A — Lantern Belfry

![Lantern Belfry concept: inked stone ledges above blue-violet mist, warm lanterns and a small ochre-hooded keeper](art-source/concepts/01-lantern-belfry.png)

### B — Flooded Observatory

![Flooded Observatory concept: quiet water and distant celestial architecture behind staggered stone ledges](art-source/concepts/02-flooded-observatory.png)

### C — Overgrown Sanctuary

![Overgrown Sanctuary concept: cool foliage frames misty ruined architecture and stone ledges](art-source/concepts/03-overgrown-sanctuary.png)

Compare silhouette readability, atmosphere and foreground clutter. These generated paintings approximate an arena; they do not represent the specified collision map.

Separate trials: [character reference](art-source/character/lantern-keeper-idle-source.png), [background](art-source/backgrounds/belfry-background-source.png), [ledge](art-source/platforms/belfry-ledge-source.png). The character needs a stricter side view and simpler details before animation. No runtime-ready animation is claimed.

## Source assets

Keep original supplied backgrounds in `art-source/backgrounds/background-option-01.png` (then `02`, `03`). Keep reference screenshots in `art-source/references/`. Do not resize or overwrite originals. Generated concepts live in `art-source/concepts/`; production experiments live in `art-source/character/`, `platforms/`, and `backgrounds/`.

These are source assets, not runtime exports. The later scene will use optimized files in the repository's `public/games/hook-havok/`, referenced through the configured base URL. No image is collision geometry.

## Intended first playable

One character, one fixed arena, running, variable-height jumping, a hook that pulls toward static surfaces, quick respawn, simple effects, and the shared radio. No opponents, balls, progression, procedural maps, or physical rope simulation initially.

The eventual route is `/hook-havok/`. Until the browser milestone is implemented, review the source images directly. No production deployment is included.

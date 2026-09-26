# Sprite and terrain generation checkpoint

The current battlefield uses `terrain-battlefield-v3.png` as continuous ground and the illustrated v2 neuron sprites with runtime animation. See [the art correction and exact texture prompt](../../../../docs/neural-defence/art/BATTLEFIELD_V3.md).

Six reused individual candidates are saved here: brain, construction site, Biomass deposit, Insight deposit, slate ground and boulder. Original generation prompts are preserved in `docs/neural-defence/art/phase-0/INDIVIDUAL_PROMPTS-world.md`.

The corrected biological sprite set is now delivered as `brain-{blue,coral,green,gold}-v2.png`, `neuron-{blue,coral,green,gold}-v2.png`, `tower-experimental-v2.png`, `particle-builder-v2.png`, and `particle-attack-v2.png`. Every file is an individual 1254 × 1254 RGBA image with genuine transparency. All four neurons have six main single-tip dendrites. Their colored tissue is baked into the artwork rather than supplied as a white tint mask. Both particle assets face right before runtime rotation.

Eight additional terrain/rock files are delivered: `terrain-slate-a-v2.png`, `terrain-slate-b.png`, `terrain-slate-c.png`, `terrain-soil-a.png`, `terrain-sand-a.png`, `terrain-moss-a.png`, `blocker-rock-cluster-a.png` and `blocker-rock-ridge-a.png`. All are 1254 × 1254. Ground is opaque RGB and clipped to hexes by the renderer; the two rocks have genuine RGBA transparency. Exact texture edge continuity has not been certified. Existing `blocker-water.png` and `blocker-void.png` remain available blocked-surface candidates.

Exact built-in imagegen prompts, revision notes and visual inspection evidence are in `docs/neural-defence/art/phase-0/SPRITE_REVISION_V2.md`, `sprites-v2-review.png` and `TERRAIN_REVISION.md`. Sprite alpha and readability at 50px (structures) / 14px (particles) were inspected on navy. Generated objects are integrated into the actual browser game; final player acceptance is still open.

The UI now uses Fuse Riders' shared neon/pixel presentation. Seven superseded metallic/older unsuffixed neuron, tower and particle candidates are preserved under `docs/neural-defence/art/phase-0/superseded/`, outside the bundled game assets. The original neutral brain and slate slab remain as fallbacks; the renderer prefers available v2 files. No guard assets belong to the current roster. See `docs/neural-defence/ASSET_MANIFEST.md` for the exact delivered inventory and later proposed variations.

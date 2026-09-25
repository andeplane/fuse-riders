# Neural Defence asset inventory

## Current presentation (2026-09-25)

The current renderer uses `brain-v3.png`, three neuron forms (`neuron-v3.png`, `neuron-lobed-v4.png`, `neuron-folded-v4.png`), `tower-pulse-v3.png`, `tower-siege-v3.png`, and `tower-relay-v3.png`. They are individual transparent sculpted sprites, tinted by owner. World buildings, placement ghosts and portraits share these identities; the build catalog uses representative forms. Selection and status remain separate presentation layers. Completed neurons have stable anatomical, size and orientation variation and reduced-motion-aware breathing; links represent actual friendly adjacency. [Neuron form prompts and selection verification](art/NEURON_FORMS.md) document the follow-up.

The continuous open floor is **`terrain-walkable-v5.png`**. It depicts only level moss, earth and small grit. The rejected v4 background suggested large rock ridges on open cells and is not used. All raised obstacles and resource deposits come from `world.map.cells`, using the category-restricted [terrain art catalog](../../games/neural-defence/src/render/terrain-art.ts). Art and contact shadows are clipped to their cell. Unknown or mismatched variant names use the category default; a blocked tile remains visible even if its sprite is unavailable. The tactical minimap draws the same complete terrain footprints. No painted background feature adds collision, elevation or pathfinding rules.

Generated using the built-in image generator. Current asset prompts and terrain constraints: [POLISH_ASSETS.md](art/POLISH_ASSETS.md). Earlier assets below are retained as historical source inventory, not a description of current selection.

## Historical Phase 0 inventory

Status: **individual sprites delivered and integrated; user visual acceptance is open**. This inventory describes files under `games/neural-defence/src/assets/`, not a promised generation count. The current UI reference is Fuse Riders' actual shared neon/pixel UI. World art follows the supplied luminous biological brain/neuron direction with readable sculpted terrain. The earlier teal dashboard and metallic neuron candidates are superseded.

## Common visual contract

- Pointy-top hex board with a top-down camera and shallow sculptural shading. Sprites remain registered to the logical tile center; terrain is clipped to the hex.
- Blue, coral, green and gold are actual colored brain/neuron files. Neurons have six main ports with consistent geometry. Owner rings and numbers remain separate, and cosmetic variants grant no gameplay differences.
- Selection, queued construction, HP, connection state, priority and effects are renderer/UI data. Selection is shared across selectable objects, never baked into a single neuron.
- Builder and attack particles have distinct silhouettes and follow authoritative travel intervals. Cosmetic interpolation, link glow, arrival pulses and resolved attack flashes do not decide combat or move simulation time.

## Delivered current world assets

Every filename below exists individually; braces name the explicit color variants listed in the row. The renderer prefers a `-v2` file over its earlier unsuffixed candidate.

| Files                                                                                    | Count | Role                                            |
| ---------------------------------------------------------------------------------------- | ----: | ----------------------------------------------- |
| `brain-blue-v2.png`, `brain-coral-v2.png`, `brain-green-v2.png`, `brain-gold-v2.png`     |     4 | Team-colored brain bases                        |
| `neuron-blue-v2.png`, `neuron-coral-v2.png`, `neuron-green-v2.png`, `neuron-gold-v2.png` |     4 | Team-colored six-port neurons                   |
| `tower-experimental-v2.png`                                                              |     1 | The single experimental tower type              |
| `particle-builder-v2.png`                                                                |     1 | Construction delivery particle                  |
| `particle-attack-v2.png`                                                                 |     1 | Sole Phase 0 combat particle type               |
| `deposit-biomass.png`, `deposit-insight.png`                                             |     2 | Reused green organic and violet mineral sources |
| `construction-site.png`                                                                  |     1 | Reused paid construction scaffold               |

The eleven v2 objects are individual **1254×1254 RGBA PNGs** with genuine transparency. All four neurons have six main single-tip dendrites. The particles face right in the source artwork and rotate during travel. Exact prompts and inspection notes: [SPRITE_REVISION_V2.md](art/phase-0/SPRITE_REVISION_V2.md). Review sheet: [sprites-v2-review.png](art/phase-0/sprites-v2-review.png).

Biomass and Insight are source deposits, not extra mining buildings. A paid site does not conduct or mine until completed. One experimental tower sprite represents one tower type; the combat lab contains exactly one test tower. Growth, Excitation and Conduction currently use ordinary UI rather than separate research illustrations.

## Delivered map-building assets

| Files                                                                  | Count | Current use                                                    |
| ---------------------------------------------------------------------- | ----: | -------------------------------------------------------------- |
| `terrain-slate-a-v2.png`, `terrain-slate-b.png`, `terrain-slate-c.png` |     3 | Slate ground variants; opaque square textures clipped to hexes |
| `terrain-soil-a.png`, `terrain-sand-a.png`, `terrain-moss-a.png`       |     3 | Additional open-ground appearances                             |
| `blocker-rock-cluster-a.png`, `blocker-rock-ridge-a.png`               |     2 | New transparent rock silhouettes                               |
| `blocker-boulder.png`                                                  |     1 | Reused boulder and fallback for undelivered rock variations    |
| `blocker-water.png`, `blocker-void.png`                                |     2 | Earlier blocked-surface candidates available to map variants   |

The eight new terrain/rock files are **1254×1254**. Ground files are opaque RGB; the new rock cluster and ridge have genuine RGBA transparency. See [TERRAIN_REVISION.md](art/phase-0/TERRAIN_REVISION.md) for exact prompts, bounds and inspection results.

Slate, soil, sand and moss all remain `open` gameplay terrain. Rocks, water and void remain `blocked`. They add no movement, height, destructibility or resource bonuses. The renderer selects available map variants and uses a boulder fallback where a proposed rock filename has no asset.

Ground was prompted for repeatability, but **exact opposite-edge continuity is not certified**. Independent hex-clipped variants do not create a continuous crack network. A future continuous terrain treatment needs a tiled seam preview.

## Live overlays and animation

Shared SVG/CSS rendering supplies selection and focus, tile/queue outlines, team territory, owner markers, links, HP, priority labels, arrival pulses and damage flashes. These are code-generated elements, **not ten delivered SVG files**. Construction order, particle quantities and resource/research progress remain live state. Reduced motion suppresses decorative trails/flashes; debug adds clear hex boundaries.

No separate guard, shield, insulation, refit, broken-link raster or destruction-sheet asset is required by current Phase 0. Future research icons and effect sheets should be added only when their presentation needs them.

## Proposed later variety, not delivered files

- Additional soil, sand and moss variants; alternate rock clusters/ridges and boulders.
- Optional stone biome and tested adjacent-terrain transitions.
- Final sprite packing, download-size optimization and a certified continuous texture set if needed.

These are extensions, not existing files or new gameplay rules. The neutral `brain.png` and older slab `terrain-slate-a.png` remain in the asset directory as fallbacks. Seven superseded unsuffixed neuron/tower/particle candidates were moved to `art/phase-0/superseded/` so comparison artwork is not bundled with the game. Historical guard concepts remain exploration only. None of these override the current roster or establish finished visual acceptance.

# Phase 0 objects, visual states and individual asset manifest

Status: **revised roster for review before further generation**. This replaces the earlier Assault/Guard/tint-only inventory. The first roster is a brain, four cosmetic team neuron variants, builder particles, one attack particle, two resource sources, one experimental tower and varied map terrain. No game implementation is authorized by this art inventory.

Generate each object as its own file, inspect it, then concatenate the saved files into a labelled review sheet. Generated contact sheets do not substitute for individual sprites. Show this revised inventory to the user before further generation.

## Common visual contract

- Regular pointy-top hex board viewed from above. Shallow sculptural surface shading, generous transparent gutters and no baked floor except terrain. Objects must not obscure neighboring cells or shift their logical footprint.
- Lighter slate ground, crisp contours, modest glow. Transparent PNGs contain no captions, panels, checkerboard or selection effects.
- Four neuron files are **real visual variants**, blue, coral, green and gold, with cosmetic surface motifs and independent owner markers. Exact center, scale, six ports and overall silhouette stay consistent. No faction bonuses or simulation differences.
- Every selectable entity uses one reusable independent selection overlay. Hover, placement, queue, active, damaged and disconnected treatments work across all objects and owners.
- Team identity is separate from particle type. Builder and attack particles have different silhouettes; both can receive owner tint/markers. Guard and military mix/refit controls are not part of this revised roster.

## Map-building set: 12 terrain candidates

Variety is visual first. Slate/soil, stone, moss and sand all use the same `open` gameplay terrain. Rock ridge, boulder, water and void all use `blocked` behavior initially. Artwork does not introduce speed bonuses, height rules, mining bonuses, destructibility, bridges or traversal abilities. Any future biome metadata stays separate from canonical terrain rules and must be validated.

| Individual filename stems | Count | Appearance and gameplay |
| --- | ---: | --- |
| `terrain-slate-a`, `terrain-slate-b` | 2 | Light slate/soil; alternate subtle grain/cracks; open |
| `terrain-stone-a`, `terrain-stone-b` | 2 | Pale weathered stone; alternate small pattern; open |
| `terrain-moss-a`, `terrain-moss-b` | 2 | Muted moss accents and readable boundary; open |
| `terrain-sand-a`, `terrain-sand-b` | 2 | Warm sand with alternate restrained ripples; open |
| `blocker-rock-ridge` | 1 | Low connected ridge; blocked isolated object over terrain |
| `blocker-boulder` | 1 | Rounded heavy rock cluster; blocked isolated object |
| `blocker-water` | 1 | Clearly bounded water hex; blocked surface tile |
| `blocker-void` | 1 | Chasm/void hex with readable rim; blocked surface tile |

This bounded first art pass supports visibly different maps without multiplying gameplay mechanics. Transitions and extra variations follow adjacency/seam review; they do not block engine work.

## World structures and resources: 9 candidates

| Individual filename stems | Count | Purpose |
| --- | ---: | --- |
| `brain` | 1 | Healthy brain crown; separate owner accent/marker and state overlays |
| `neuron-blue`, `neuron-coral`, `neuron-green`, `neuron-gold` | 4 | Team-specific cosmetic treatments with shared six-port geometry |
| `deposit-biomass` | 1 | Green organic source; automatic adjacency mining |
| `deposit-insight` | 1 | Violet faceted source; distinct silhouette/material |
| `construction-site` | 1 | Incomplete scaffold; cannot mine or conduct before completion |
| `tower-experimental` | 1 | One experimental attack tower for a controlled lab fixture; no tower family |

“Mines” means these two source deposits, not extra mining buildings or a third resource. Connected neighboring neurons determine mining. Tower art does not settle construction unlocks, costs, range or targeting; these belong in the engine plan before implementation. The experiment contains one tower type only.

## Particles, links, effects and research: 8 candidates

| Individual filename stems | Count | Purpose |
| --- | ---: | --- |
| `particle-builder` | 1 | Compact three-lobed seed/cargo silhouette for construction delivery |
| `particle-attack` | 1 | Sharp directional particle; sole initial combat particle type |
| `axon-link`, `axon-link-broken` | 2 | Healthy/broken segment aligned to exact ports |
| `effect-pulse`, `effect-destruction` | 2 | Shared activity/mining/arrival pulse and fragment burst |
| `research-growth-efficiency`, `research-excitation` | 2 | Construction and attack-property research illustrations |

Builder lifecycle/capacity and attack resolution must be specified before implementation. Guard, Insulation, composition conversion and refit are removed from the current art requirements. Future signal-speed research may reuse research UI until it becomes an approved upgrade; no extra image is needed now.

## Shared vector overlays and UI: 10 files

| Filename stem | Reuse |
| --- | --- |
| `overlay-selection` | Every selected brain, neuron, resource, blocker, site, tower or tile |
| `overlay-hover` | Pointer/keyboard tile focus |
| `overlay-build-valid` | Legal construction preview |
| `overlay-build-invalid` | Illegal preview using shape and color |
| `overlay-queued` | Queued destination; order number remains live text |
| `overlay-priority` | Routing focus; weight/type remains live data |
| `overlay-active` | Shared activity cue, never an authoritative particle count |
| `overlay-damaged` | Damage cue across all team artwork; HP remains live data |
| `overlay-disconnected` | Dormant/severed cue independent of owner |
| `icon-recovery` | Returning/unavailable particles if recovery remains in the rules |

Separate SVGs, never baked into one selected neuron. HP/resources, construction/research progress, locks, loading/error/debug states and text remain ordinary UI components. Deposits use a mining pulse; destroyed structures leave occupancy with a transient effect, not a persistent corpse sprite.

## Quantities and generation sequence

Target: **29 individual raster candidates and 10 shared vector assets**: 12 terrain + 9 structures/resources + 8 particles/links/effects/research. Reuse suitable existing individual candidates after inspection; do not blindly regenerate all 29.

1. Show the revised inventory before more image calls.
2. Generate files in parallel, one output per asset. Derive matching variants from a shared base to preserve scale/ports.
3. Check actual transparency, clipping, port alignment, silhouettes, state clarity and owner readability at play scale.
4. Concatenate saved files into a labelled contact sheet. Show shared selection applied to several different objects in an additional composed example.
5. Review before implementation; packing, seams, animation and final scaling remain production tasks.

## Earlier outputs retained as superseded candidates

Original contact sheets are style exploration only. The interrupted individual world pass produced `terrain-open`, `terrain-blocked`, `deposit-biomass`, `deposit-insight`, `brain`, `brain-active`, `brain-damaged`, `neuron`, `neuron-active` and `construction-site` under `art/phase-0/sprites/`. Their PNGs have alpha channels; the neutral neurons do **not** fulfill the revised four-team requirement. Exact prompts are in [INDIVIDUAL_PROMPTS-world.md](art/phase-0/INDIVIDUAL_PROMPTS-world.md). Guard/refit concepts from the previous pass are superseded too. Preserve reusable art without treating old pictures or filenames as rules authority.

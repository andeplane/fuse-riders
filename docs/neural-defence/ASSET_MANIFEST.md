# Phase 0 objects, visual states and individual asset manifest

Status: **asset plan before generation**. Gameplay remains proposed; no game implementation is authorized. This inventory follows [PHASE_0.md](PHASE_0.md), [CORE_TYPES.md](CORE_TYPES.md) and [ARCHITECTURE.md](ARCHITECTURE.md). Individual files are generated first, inspected, then concatenated into a labelled contact sheet. Existing generated concept sheets are style references only and do not satisfy this inventory.

## Common visual contract

- Pointy-top regular hex board viewed from above. Individual objects have generous transparent gutters and no baked ground tile, except the terrain tile itself. Brains/rocks may have shallow sculptural shading, but cannot cover a neighboring tile or shift the logical footprint.
- Lighter slate ground and readable outlines; modest glow rather than black backgrounds. Tintable owned structures and particles use neutral pearl/silver material. Blue, coral, green and gold ownership is a separate renderer tint/marker, not four incompatible copies of the game object.
- Assault particles have a sharp elongated silhouette; guards have a round shield-like silhouette. Type recognition must survive a faction-colour change. Researched variants add geometry/detail rather than merely changing colour.
- **Selection is an independent overlay applied to every selectable object/tile.** It is never baked into a single selected-neuron image. Hover, legal placement, illegal placement and queue markers use the same tile geometry. Damaged/disconnected/active modes also remain compatible with those overlays.
- Each listed raster file is generated separately. No captions, labels, panels, grids or checkerboard painted into the sprite. Prompts and inspected limitations accompany the files. Transparency and footprint are checked before calling a candidate usable.

## World objects and states

| ID / filename stem          | Object and state                  | Why it exists                                           |
| --------------------------- | --------------------------------- | ------------------------------------------------------- |
| `terrain-open`              | One neutral walkable hex surface  | Board base; ownership tint and overlays are separate    |
| `terrain-blocked`           | Rocky obstacle, no floor baked in | Impassable geometry, distinguishable from resources     |
| `deposit-biomass`           | Green organic resource cluster    | Biomass mining source; not a player-owned structure     |
| `deposit-insight`           | Violet faceted resource cluster   | Insight mining source; distinct material and silhouette |
| `brain`                     | Healthy resting brain base        | Player origin and particle reservoir                    |
| `brain-active`              | Lit/pulsing brain surface state   | Dispatch/research/refit visual feedback; same footprint |
| `brain-damaged`             | Damaged brain                     | HP loss is visible without replacing the owner marker   |
| `neuron`                    | Healthy resting six-port neuron   | Completed network cell                                  |
| `neuron-active`             | Energized neuron                  | Arrival/attack feedback; same six ports and footprint   |
| `neuron-damaged`            | Damaged neuron                    | Structural damage state                                 |
| `neuron-disconnected`       | Dormant/severed neuron            | Owned but currently disconnected, not neutral terrain   |
| `construction-site`         | Incomplete growing neuron         | Paid site; does not conduct or mine                     |
| `construction-site-damaged` | Damaged incomplete site           | Site can be attacked before completion                  |

Empty terrain is not an entity; a queued destination is an overlay, not a construction site. Destroyed structures are removed from ownership/occupancy; a brief shared destruction effect is sufficient, so there is no persistent corpse object in Phase 0. Mining activity uses a pulse over the same deposit, not a different deposit type.

## Particles, connectors and research visuals

| ID / filename stem            | Asset/state                        | Meaning                                                   |
| ----------------------------- | ---------------------------------- | --------------------------------------------------------- |
| `particle-assault`            | Assault A, base profile            | Sharp moving attack-oriented particle                     |
| `particle-assault-researched` | Assault A, Excitation profile      | Same type plus distinct upgraded surface detail           |
| `particle-guard`              | Guard B, base profile              | Rounded protection-oriented particle                      |
| `particle-guard-researched`   | Guard B, Insulation profile        | Same type plus distinct upgraded ring/detail              |
| `axon-link`                   | Neutral healthy connection segment | Rotated/stretched by rendering between exact node ports   |
| `axon-link-broken`            | Interrupted connection segment     | Supply cut; no implication that particles can still cross |
| `research-growth-efficiency`  | Growth Efficiency icon             | Faster subsequently started construction                  |
| `research-excitation`         | Excitation icon                    | Assault property upgrade                                  |
| `research-insulation`         | Insulation icon                    | Guard property upgrade                                    |
| `effect-pulse`                | Soft neutral radial glow           | Arrival, mining and small hit pulse; tinted in rendering  |
| `effect-destruction`          | Small neutral fragment burst       | Shared transient destruction cue                          |

Travel, queues, refit and recovery are engine states, not additional military particle types. Travel uses the correct particle sprite plus a procedural trail. Refitting is shown at the brain with progress; recovering units are unavailable and must not be drawn as functioning frontline particles. Their UI indicators are exact vector geometry/text, with no invented third resource.

## Shared overlays and UI: individual vector assets

| Filename stem           | Reuse                                                                     |
| ----------------------- | ------------------------------------------------------------------------- |
| `overlay-selection`     | Every selected tile, neuron, brain, deposit, blocker or construction site |
| `overlay-hover`         | Every pointer/keyboard-focused tile                                       |
| `overlay-build-valid`   | Legal construction preview                                                |
| `overlay-build-invalid` | Illegal construction preview, shape as well as colour                     |
| `overlay-queued`        | Queued route destination; index is live text                              |
| `overlay-priority`      | A prioritized node; type/weight is live data                              |
| `icon-refit`            | Composition conversion progress indicator                                 |
| `icon-recovery`         | Unavailable returning particle count indicator                            |

These are separate SVG assets with identical hex registration where appropriate. They are not generated inside a character sprite. Health/resource bars, loading spinners, text, job progress, button states and research availability/locks are ordinary UI components, not new world objects. Their appearance must work with every sprite state; the assembled review sheet demonstrates a reusable selection ring over multiple objects.

## Explicitly proposed or deferred

- `builder-proposed`: optional separate candidate sprite, visibly separated in the contact sheet. Builder delivery is under discussion, not part of the accepted military pool or current construction contract. Its lifecycle/capacity must be decided before implementation.
- Towers, additional particle types, powerups, map editor tools and finished menu illustration are not Phase 0 assets. Do not pad the core set with them.
- Four ownership colours are presentation variants of the same registered silhouette. The later engine uses tint/markers; art review should show their compatibility rather than treating faction colour as particle type.

## Generation and review order

1. Freeze this inventory for the generation pass: **24 required individual raster candidates**, eight shared vector assets, plus one clearly optional builder candidate. Any change gets a named manifest update.
2. Generate independent asset/state files in parallel, one output per asset, using the same style brief. Work in `art/phase-0/sprites/`; preserve exact prompts and source output paths.
3. Inspect the actual files: object/state identity, isolated object, alpha, consistent view/scale, clipped edges, neutral tintable ownership and distinct type silhouettes. Mark failures explicitly; a generated file is not automatically accepted.
4. Build the labelled contact sheet by concatenating the saved individual files. Also show examples of common selection overlay on brain, neuron, deposit and construction; do not ask image generation to invent those composites.
5. Review the contact sheet and individual files before implementing rendering. Candidate assets may still need atlas packing, sizing and visual refinement. No production-readiness claim without those checks.

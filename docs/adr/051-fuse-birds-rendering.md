# ADR-051: Fuse Birds rendering, themes and independent cameras

- Status: Architecture implemented in part; V2 visual direction accepted, final visual acceptance outstanding
- Date: 2026-09-22
- Related: [concept spec](../design/fuse-birds.md), [V2 concept gallery](../design/fuse-birds-concepts/README.md), [physics](048-fuse-birds-physics.md), [game engine](049-fuse-birds-game-engine.md), [generation](050-fuse-birds-level-generation.md)

## Context

The five V2 concepts are one game's level themes: Neon burrow, Pixel badlands, Reactor islands, Neon jungle and Volcanic circuit. The user approved the graphics, with much smaller birds relative to the map and no background grid. A full-map view is appropriate on a shared TV; phones need Angry Birds-like zoom and pan to aim accurately.

The repository already uses Phaser for presentation with an external clock and an engine view boundary ([presentation contract](../PHASER.md)). Reuse that architectural pattern and the installed dependency, not another game's renderer or its internal guards.

## Decision

### Current implementation and remaining acceptance

The browser now uses Phaser 4.2.1 with an externally supplied frame and a stopped Phaser loop. The headless package has no renderer dependency. `render/arena.ts` consumes copied engine views and uses content-hashed 128-cell chunks with two texels per cell and eight-cell gutters. Original sky and rock artwork lives in `public/games/fuse-birds/art/v1/`; birds, ammo crates, sling bands and effects are authored in Canvas/code. These choices implement the hybrid composition below, but do not establish final visual acceptance or physical-phone performance.

Terrain composition and upload are limited to four chunks per presentation callback. While a replacement terrain set is incomplete, retain the last complete rendered frame and withhold a new Phaser frame, including body positions. The app shows battlefield preparation and disables local play until a complete view can be presented. Simulation continues independently. Preparing candidate maps are not uploaded. This bounds work by chunk count rather than guaranteeing a particular wall-clock frame time; it avoids the observed burst of 72 uploads during room recovery. Partial textures must never be presented with current bodies over old collision geometry.

Current art includes occupancy-clipped faceted rock, world-anchored mineral bands, cyan bevels, sparse surface grass, layered blue water and tiny detailed birds. Ammo crates carry three pellet symbols. High-density close-up promotion, authored animation atlases, additional themes and the richer scenery described below are not implemented. Only Neon burrow is required for Phase 1; references below to all-five-theme comparisons apply when those themes are added. Required Phase 1 camera, restoration, input and visual acceptance checks remain requirements until evidenced in the implementation report.

The current Chromium renderer harness measures idle animation-frame intervals and exercises a real Pebble impact. The real-room smoke additionally covers movement, hop/landing, Escape cancellation, Scatter ammunition, reload recovery, round completion and rematch with a full-map TV. These are browser-emulation results, not a physical-device or final art-quality sign-off. See [implementation evidence](../reviews/fuse-birds-implementation-progress.md).

[ADR-052](052-fuse-birds-phase-one.md) defines delivery: a finished Neon burrow implementation matching V2, with exactly `Pebble ∞` and `Scatter Bomb ×N` in the weapon tray. Three Scatter Bombs start each round. The four-slot trays in the mockups are superseded for gameplay scope. The other four themes remain approved visual directions, not required asset packs for Phase 1. Their common rendering architecture remains in scope.

Use Phaser for the new game's 2D world presentation, with DOM-based room screens, HUD and touch controls using `fuse-ui`. No Phaser physics, authoritative timers or second simulation loop. The app's presentation owner supplies frames from a host (the online runtime or a local/headless-library harness); the scene renders them and cosmetic interpolation only. The manifest and lockfile pin Phaser 4.2.1. The primary checkout's installed `node_modules/phaser` was still 3.90.0 during this review, so do not use that stale installation as proof of Phaser 4 behavior. Verify from a clean lockfile install when implementing; this documentation review does not change dependencies.

The renderer imports only Fuse Birds' `engine/view.ts` and narrowly scoped `view-kit.ts`. It cannot read or mutate engine state, grant crates, detect authoritative impacts, finish turns or choose random maps. Browser input lives outside the scene and submits legal actions through the app/runtime adapter.

Rendering is an optional consumer of the headless library in ADR-049. Importing the default game package must not load this renderer or any browser dependency. The browser entry point composes the library and presentation; the library never constructs a scene or calls a UI callback. Every match can finish without a rendered frame, and a renderer can attach to an already-running match from its current view. No animation-complete signal advances gameplay.

### View contract and rollback

Publish world/flight bounds, simulation tick, round and turn identity, terrain occupancy references or chunks, terrain revision identities, body transforms, projectile IDs, crate state, phase, health, inventory and presentation hints derived from actual rules. Renderer-owned caches must never write into supplied arrays. Copy data or use explicit immutable ownership at the boundary.

Use stable IDs to interpolate matching bodies between supplied views. Do not interpolate across a new round, checkpoint installation, discontinuous correction, spawn or elimination. Terrain changes apply discretely with their matching authoritative view; never interpolate solid ground between two occupancy states. Reconstruct persistent outcomes from the view, not only impact events.

Terrain cache keys must distinguish rollback branches. A chunk revision number alone is insufficient: revision 12 can describe different terrain after replay. Key textures by world identity, chunk coordinate and content identity, with an adapter-supplied discontinuity epoch to invalidate stale caches. A hash mismatch, rewind or world replacement must not leave a crater from the abandoned future visible.

### Terrain drawing

Start with chunked occupancy masks baked into reusable RGBA terrain textures. Cache fill, strata and edge decoration per dirty chunk; redraw changed chunks plus every neighbor touched by the finite shading radius. A one-cell halo suffices only for binary contour extraction, not for bevels, shadows and bloom. Use an eight-world-cell shading gutter initially and keep each effect's support within it; increase invalidation extent if the radius changes. Collision occupancy is the source of visible solid shape.

Smooth contour rendering is permitted within a bounded fraction of a cell; it must not hide a usable passage, draw a bridge across an empty gap or make a collider look absent. Pixel badlands uses stepped edges over the same grid. Texture scale, lighting and surface ornaments may differ, but the same cell boundary remains legible in all themes.

Layer order: quiet distant sky/scenery, back decorations, solid terrain, readable surface contour, crates and birds, projectiles/aim preview, cosmetic effects, then screen-space HUD. Grounded body contact points must remain visible. Keep tall foreground decoration out of the aim area; foreground depth is decorative, never another collision layer. Use original assets derived from the chosen visual direction, not the generated mock screenshot as a background bitmap for gameplay.

Particles, water ripples, foliage, smoke, neon glow and debris are cosmetic and bounded. Use pools/caps, avoid per-frame terrain texture creation, cap render resolution on dense displays and prefer local lightweight glow to a mandatory full-screen bloom pass. Quality reduction may remove scenery/effects but not birds, projectiles, pickup identity, terrain boundaries or aiming information. No claims about phone performance until real measurements exist.

### How to reproduce the V2 artwork

The visual target is the actual [V2 gallery](../design/fuse-birds-concepts/README.md), not simply "dark shapes with neon outlines." Its depth comes from painted rock facets, restrained interior contrast, atmospheric layers, thin lit edges and detailed water/scenery. A binary polygon with a flat fill and a glow will not meet this target. Use a hybrid: authored raster artwork for material/detail/characters, and procedural composition driven by the actual terrain grid. This is still a 2D game; it does not require a 3D physics or terrain mesh.

| Screenshot feature                            | Production construction                                                                          | Destruction / camera behavior                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Dark faceted cliffs                           | Seamless rock material tiles, broad world-space color/strata fields, sparse painted facet stamps | Clip the complete composite to occupancy; keep texture coordinates anchored to the world after craters              |
| Cyan, amber or magenta terrain rims           | Occupancy-derived contour, thin bright core, darker inner bevel and low-opacity outer halo       | Rebuild along new crater edges, with the same finite gutter and light direction                                     |
| Organic or mechanical surface detail          | Small authored grass, vine, metal and rock fragments attached to surface anchors                 | Remove when their anchor/support is cut; no floating foliage or invisible structural collision                      |
| Distant islands, moon, mist and palms         | Separate translucent raster layers with decreasing contrast and saturation at distance           | Slow/parallax movement from the local camera only; no collision or input targeting                                  |
| Small bird silhouettes and readable close-ups | Original animated RGBA sprite atlas, with simplified overview art and more detailed zoom art     | Both depict the same body size and pivot; zoom changes detail, never collider dimensions                            |
| Water and falls                               | Layered wave/reflection strips and narrow animated waterfall sprites                             | One explicit water hazard line; waterfall art is clipped/reanchored after terrain changes and has no hidden current |
| Slingshot, crates and weapons                 | Original sprite atlas, procedural sling bands, screen-space icon artwork                         | World items scale with the map; HUD icons remain legible and normal-sized                                           |

The five skin recipes share this construction:

- **Neon burrow:** matte near-black/violet layered rock, thin cyan lip, occasional faceted stone and sparse plants; blue distant islands and very restrained surface glow.
- **Pixel badlands:** authored stepped pixel material and amber surface pixels; discrete strata and pixel sprite frames. Use nearest filtering for the pixel material/characters, with a separate soft low-intensity halo if needed. Do not pixelate the entire HUD or mutate occupancy into a different map.
- **Reactor islands:** blue-black faceted stone, clipped metal inset stamps and magenta emissive seams; cyan underside lighting. Panels spanning several cells must be clipped when those cells are destroyed rather than floating over a crater.
- **Neon jungle:** dark teal rock facets, cyan grass tips, small purple leaves/vines and dim palm silhouettes; occasional narrow waterfall accents. Foliage cannot conceal the collision edge when zoomed in.
- **Volcanic circuit:** dark basalt, orange fissure overlays clipped to solid cells and a thin magenta lip; distant volcano silhouettes stay behind the playfield. Bright seams are decorative, while water remains the common clearly marked hazard.

Use asymmetry and several scales of authored material detail to avoid wallpaper repetition. Paint material textures without a baked outer rock silhouette, horizon, cast shadow outside the material or embedded UI. Those features would not survive arbitrary procedural terrain cuts. Macro fields break repetition across the whole map; smaller world-anchored stamps add local variation. Do not generate a finished map image at runtime or stretch an existing screenshot over collision geometry.

### Asset production and ownership

Produce a versioned asset pack before claiming the style is implemented. Suggested root: `public/games/fuse-birds/art/v1/`, with a manifest declaring theme, role, dimensions, pivot, trim bounds, sampling mode, source/provenance and license. The engine reads none of it. Keep editable/source assets separate from optimized runtime atlases.

Initial art pack:

1. Shared original bird body/eye/beak/crest frames for idle, aim, recoil, hurt and eliminated states; color variants or a mask layer preserve player identity across every theme. World sprites and HUD portraits have separate framing. Supply atlas gutters/extrusion to avoid color bleeding when minified.
2. Sling base/pouch, crate categories, parachute, ammo, shield and health sprites; weapon HUD icons in the same rounded shaded style as the screenshots. Draw sling bands and aim dots procedurally so they match the actual aim.
3. Per theme: two or more seamless base-rock variants, a few broad strata/facet overlays, surface-detail sprites and sparse accent stamps. A small well-authored pack plus procedural placement is preferable to hundreds of disconnected random assets.
4. Separate sky gradient, distant/mid-distance scenery strips and sparse moon/cloud/tree elements. Author at sufficient resolution for the target viewport; never place large foreground detail in an aiming lane just to imitate a screenshot.
5. Shared water/foam/reflection strips, waterfall frames and bounded impact/leaf/rock particle atlases. Light and shadow direction must agree with terrain bevels.

AI image generation may create source material studies and individual assets using the V2 images as references; it does not replace seamlessness checks, transparent-edge cleanup, consistent pivots, atlas packing or human visual acceptance. Ask for isolated assets/materials rather than another whole screenshot. Use code/vector drawing for exact HUD text, frames and procedural bands. Keep readable overview silhouettes even if the detailed bird art is reduced to roughly 10–16 screen pixels in full-map framing. A phone close-up should reveal authored detail, not just a blurry enlarged 12-pixel asset.

### Concrete chunk-compositing path in this repository

The existing [arena renderer](../../games/fuse-riders/src/render/phaser/arena.ts) demonstrates Phaser CanvasTextures: `textures.createCanvas`, `texture.context`, `refresh()` and reapplying `setFilter` after refresh. Implement a separate Birds compositor following that API pattern; do not import the Riders renderer. Canvas2D is an offscreen asset/compositing tool here, while Phaser draws the resulting texture sprites on its normal WebGL path.

For each dirty chunk:

1. Read its immutable occupancy plus the shading gutter and derive a high-resolution coverage image. Coverage alpha is the only authority for visible solid material.
2. Paint world-anchored material tiles and macro strata/facet stamps into an offscreen color canvas. Clip them using Canvas2D alpha compositing (`destination-in`) against coverage. Fully clear recycled canvases first; restore compositing state afterward.
3. Derive near-boundary inside/outside distances and normals over the bounded gutter. Shade a darker inner bevel and selected bright upper/side edges with one shared art-light direction. Compose the outer halo separately so transparent air does not become apparently solid rock. This is cosmetic distance shading, not the physics distance field.
4. Bake clipped surface/inset accents into the material or attach independent sprites with validated surface anchors. Neighboring chunks sample the same global material/anchor coordinates so seams cannot change the pattern.
5. Upload the completed chunk via `refresh()` and set the intended LINEAR or NEAREST filter. Treat refresh as a full texture upload; repository evidence does not establish subrectangle uploads. Keep alpha representation and texture-edge gutters consistent to avoid dark seams or doubled bright rims.
6. Draw each chunk's core exactly once. Gutter pixels are sampling/shading context, not overlapping extra terrain strips. Update the corresponding body/terrain view together before presentation; do not retain an old solid bridge beneath a newly falling bird.

The [Phaser 4 migration note](../design/phaser-4-migration.md) records that GeometryMask is not a general WebGL masking path here. Bake alpha into chunk textures instead of assuming `setMask` clips terrain in WebGL. Custom shaders are an optional later optimization: the repo uses `Phaser.GameObjects.Extern` with `drawingContext.beginDraw()` and tracked GL resources in [beveled-trails.ts](../../games/fuse-riders/src/render/phaser/beveled-trails.ts). Do not introduce removed Phaser 3 `SinglePipeline` APIs, copy private renderer hacks, or assume framebuffer/postprocessing compatibility from that example.

Start with 128 × 128 world-cell chunks. At two texture texels per cell and an eight-cell gutter, a texture is 288 × 288 RGBA: 331,776 bytes before driver overhead. A 1536 × 768 grid has 72 chunks, about 22.8 MiB for a single full color set. CPU canvas backing stores, masks, atlases and GPU duplication are additional memory, not included in that number. Budget those explicitly, cap backing pixel count, and evict unseen high-detail variants. Do not keep every theme and every zoom level fully uploaded at once.

Two texels per cell provide a starting full-map texture density. On a close phone view, promote only visible chunks to four texels per cell if the measured memory/frame budget allows; keep geometry identical and use a bounded cache. Reuse the lower-detail set during transitions rather than changing bird scale or collision shape. If asynchronous composition is later added, tag jobs with terrain content identity, theme, world epoch and density; discard stale results after rollback or a theme switch. Never show an out-of-date occupancy mask while waiting for decorative detail.

Background and water animation can run at display rate using presentation time; terrain composition happens only for changed content or a material/density change. Hash surface-anchor placement from `(visual seed, theme, world coordinate)` so chunk redraw order cannot move plants around. Visual RNG never advances game RNG or enters the game hash.

### Visual acceptance before expanding features

For Phase 1, use the two-slot tray and visible Scatter count throughout real-flow screenshots. Show `×3`, a decremented count and `×0` in both phone and TV layouts, plus the count increasing after a supply-crate hit. Zero disables Scatter but leaves its count visible; icon clicks never mutate inventory locally. Do not render Boom Egg, Shield or placeholder future slots. Scatter-refill crate symbols must match the actual ammo reward rather than showing a medical or shield icon from the concept art.

Build a renderer-only browser harness consuming an immutable view from the headless library. Start with Neon burrow as the reference slice, without selecting it as the game's only theme. Reconstruct the broad V2 composition: tiny widely spaced birds, several detailed ridges/arches, a quiet navy sky, atmospheric distance, thin luminous contours, visible water and the same compact neon HUD. Then render a second genuinely generated map; fidelity must survive different geometry.

Capture the real renderer at the reference aspect ratio and at a phone aiming close-up. Compare side by side with V2, including crop comparisons for rock faces, top edges, bird silhouettes and HUD icons. Check composition and bird-to-map ratio, material depth, color/light hierarchy, repeated-texture artifacts, empty-sky treatment and readable controls. Pixel-identical comparison to generated art is not a sensible pass criterion; matching its material richness and visual hierarchy is. Flat prototype geometry alone is not visual acceptance.

Cut a crater through a ridge and a decorated bridge, then capture again. New cut surfaces must look like the same rock, lit along the new contour, with no baked scenery left suspended. Demonstrate camera zoom, a chunk seam, rollback and all five skins on the same state. Only after this vertical slice works should the rest of the art pack and weapon effects expand. This is a concrete implementation/acceptance plan; neither assets nor this harness are built by the ADR review.

### Five themes, one ruleset

Use a presentation registry with stable theme IDs and common asset roles. Preserve navy backgrounds, player colors cyan/magenta/lime/orange, pixel headings, dark player cards and compact luminous weapon icons. No background grid, including behind the HUD. Keep birds tiny in the full-map view, approximately the scale of the V2 screenshots; do not inflate their bodies to improve readability. Use compact player labels instead.

Biome-specific texture and scenery is independent of geometry seed. A future selector may choose a visual theme without restarting a match or changing its hash. If a geometry family is selected in room settings, label it separately from the visual theme. All five themes share the same rules and collider contract; a new gameplay hazard would require its own engine rule, not a theme flag.

At volcanic sites, decorative glowing seams must not resemble unmarked lethal ground. Water/out-of-bounds hazards have a consistent readable treatment. Color is supplemented with player number, silhouette and active-turn marker. HUD portraits remain normal-sized even when world birds are small.

### TV camera

In shared-display mode, fit the complete playable map and allowed projectile flight envelope into the area remaining after HUD/safe-area insets. Preserve aspect ratio and letterbox as required. No auto-follow, player zoom, camera shake or borrowing a phone's camera transform on TV. Tiny player labels and visible projectile trails help track action from the sofa. Keep all actual world bounds visible, not just the current birds' bounding box.

Resize refits the same bounds. It never changes map dimensions, spawn positions, launch vectors or timing. On ultra-wide or narrow displays, scenery may extend into letterbox space cosmetically while the full playable area remains intact.

### Phone and individual-device cameras

Each phone renders the same world with a local camera, including when it acts as a controller for a shared TV. Provide pinch zoom around the gesture midpoint, drag-to-pan, Overview and My Bird buttons, and accessible zoom buttons. Overview fits the full map; My Bird frames the active bird with useful upward flight space. Keep weapon selection, timer and health in fixed-size screen-space UI. A minimap or off-screen indicators show where opponents and crates are.

Camera state is local and not part of the room hash, checkpoint or input log. Inspecting a faraway opponent does not move the TV or another phone. Spectators can pan freely and opt into projectile following. Desktop gets equivalent wheel/keyboard zoom, panning, recenter and keyboard aiming controls.

At the start of a local player's turn, frame their bird. After launch, follow the shot and its impact using view data; a manual pan/pinch stops following. For scatter shots, frame the bounded group of live fragments rather than snapping between them. Return to the relevant bird after resolution unless the user is manually inspecting. Reduced-motion mode uses gentle reframing or explicit follow control; it does not need shake to communicate damage.

### Gesture ownership and aiming

Hit-test the sling with a minimum screen-space touch target independent of its tiny world collider. Starting a drag there captures aiming; starting on empty battlefield captures panning; HUD controls own their own pointers. Two fingers own camera navigation. If a second pointer appears during aiming, cancel the uncommitted shot before entering pinch mode. Releasing either pointer after that transition cannot launch.

Freeze the camera transform while a sling drag is active. Convert screen coordinates through that captured transform into world-space pull direction/power, clamp through the engine's launch helper and display the quantized result. A resize, orientation change, pointer cancellation, lost capture, blur, backgrounding or disconnect cancels the gesture. An aim pad/keyboard option maps directly to the same legal launch set. Touch target enlargement affects picking only, not physics.

Local preview calls a bounded pure projection helper over current view data and the same legal vector table. Show a short partial trajectory, not a guaranteed hit indicator. Preview against the current committed terrain/wind; reset on a corrected view or a turn change. Preview computation cannot mutate authoritative RNG or state. The final launch goes through the engine's validator regardless of what the UI displayed.

### Loading, failure and restoration

The app owns explicit loading/progress/error/retry screens for game assets, world preparation and peer recovery. A texture failure must not silently leave an invisible bird or terrain; use readable simple fallback shapes or block play with retry when the required collision view cannot be shown. Context restoration rebuilds textures from the latest view; it does not restart physics. Leaving the room tears down pointers, frame subscriptions, scene resources and sound.

Do not assume a renderer fallback already works for this new game. Verify the repository's supported Phaser rendering path; provide simple material fallbacks where possible and a clear compatibility message where it cannot render. Avoid adding a second full rendering engine solely for parity with an imagined unsupported platform.

## Alternatives and consequences

- **A separate Three.js/WebGPU world:** not selected; the side-on game does not currently need a new rendering stack.
- **One full-size repainted canvas every frame:** useful as an early reference renderer, but poor as the default design for mostly unchanged large terrain. Use dirty chunks and measure.
- **Camera-controlled simulation bounds:** violates shared outcomes across device aspect ratios; rejected.
- **Independent artwork colliders:** makes craters and edge hits misleading; rejected.
- **Global zoom broadcast:** prevents simultaneous phone aiming and full-map TV viewing; rejected.

Phaser reduces new framework work, but the new chunk renderer, camera/input mapping and teardown must still be verified independently. V2 images are visual targets, not screenshots of a functioning game or evidence of frame rate.

## Validation

Capture real browser flows once implemented: full-map TV plus two phones at different zooms, sling aiming at minimum/maximum zoom, camera pan interrupted by HUD controls, pinch cancelling a drag, resize during aiming, off-screen indicators, scatter follow and returning from background. Assert that the same quantized launch yields the same trajectory at different zooms and that no navigation gesture fires.

Compare terrain masks and visible contours after craters at chunk seams, rollback to a different crater at the same revision, checkpoint replacement and graphics-context restoration. Render the same seeded state under all five themes and assert unchanged engine hashes. Test asset failures and retry without refetch loops. Use muted previews. Record browser/device, seed, viewport, pixel ratio, terrain size, particle count and frame/texture metrics; browser emulation is not physical-phone or TV readability evidence.

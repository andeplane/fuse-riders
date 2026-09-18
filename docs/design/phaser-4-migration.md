# Phaser 4 migration

Status: implemented on `claude/phaser-4-refactor-eval-ae6882`.

## Goal

Move the arena presentation from Phaser 3.90.0 to Phaser 4.2.1 with **no visible change**: the same pixels (within antialiasing noise), frame budget and lifecycle behaviour on both Phaser backends. We are moving to a maintained release line. New Phaser 4 features (Filters, lighting, `SpriteGPULayer`) are out of scope and can follow in separate changes.

Unchanged: `src/shared/`, `src/online/`, the snapshot/frame-clock contract, the single manual `game.step` per caller frame, the RULES version and the golden hashes. Nothing outside `src/client/phaser/` should need to change except docs and possibly browser scripts.

## What breaks

`npm install phaser@4.2.1` followed by `tsc` reports six errors, in two places:

1. `beveled-trails.ts`: Phaser 4 removed the `Pipeline` system (`SinglePipeline`, `renderer.pipelines`), and `Extern#render` has a new signature `(renderer, drawingContext, calcMatrix, displayList, displayListIndex)`.
2. `arena.ts` `cancelPreload`: `LoaderPlugin#inflight` is now a native `Set`, so `.iterate` becomes `for…of`.

One more break is silent at compile time and is the largest behavioural risk:

3. **Masking.** `Components.Mask#setMask` is Canvas-only in Phaser 4. On WebGL it logs a warning and does nothing, and `Layer` cannot take a `Mask` filter because it does not extend `GameObject`. See A: in practice this matches Phaser 3.

Checked and unchanged in 4.2.1 source: `Graphics#generateTexture`, `Textures.CanvasTexture#refresh`, `Text#setResolution`, `ScaleManager#stopListeners`, `File#resetXHR`/`xhrLoader`, the `fps.smoothStep`/`antialiasGL`/`powerPreference` config keys, and the texture `READY` listener pair (`WebGLRenderer#boot`, then `Game#texturesReady`) that `guardDefaultTextures` relies on. We set `roundPixels: false` explicitly, so its new default does not matter. We use no tint fill, `Point`, `Math.TAU`, `Mesh`, FX or `DynamicTexture`.

Known change with nothing to fix: the Canvas renderer is **deprecated but present**. We keep it as the no-WebGL fallback and for `?renderer=phaser-canvas`, and we don't use any Phaser 4-only feature, so both backends stay at parity.

## Design

### A. Playfield clipping: keep today's behaviour

We probed the Phaser 3 baseline in Chrome and WebKit with a rider and trail placed in the closed boundary band. **WebGL has never clipped `world`.** `createPhaserArena` creates the WebGL context itself (`{ alpha: false, antialias: true }`), which has no stencil buffer. Phaser 3's stencil-based `GeometryMask` is therefore a no-op there. The Canvas backend does clip, via `ctx.clip`.

Phaser 4 keeps `GeometryMask` for Canvas, and `LayerCanvasRenderer` still applies it. On WebGL, `setMask` warns and does nothing. That matches what WebGL actually did before, so the parity-preserving port is:

- create the geometry mask and call `setMask` only when the renderer is Canvas;
- leave WebGL unclipped, as it has always been.

Clipping on WebGL would be a visible gameplay-presentation change. It needs its own change and a playtest; the camera-viewport scissor approach reviewed for this plan is recorded in the pull request discussion. It is not part of this migration.

### B. Beveled trails as an `Extern` with raw WebGL

The migration guide's documented escape hatch for custom GL is an `Extern`. Phaser runs `YieldContext` before `Extern#render` and `RebindContext` after it, and resets the state it tracks. It warns against raw `gl` calls anywhere else.

- `BeveledTrails` stays an `Extern`, and `TrailRibbonCache` and `trail-ribbon.ts` are untouched.
- Create GL resources through the renderer's wrappers (`renderer.createProgram`, `createVertexBuffer`, `createVAO` or the current 4.2.1 equivalents) rather than raw `gl.create*`. The renderer tracks them, recreates them and re-uploads buffer data on context restore, so there is no hand-written loss handling. The one exception: Phaser 4.2.1 has no `deleteVAO`, so `destroy` removes our VAO from `renderer.glVAOWrappers` by hand before destroying it. Raw `gl` calls are confined to the draw itself, inside `render`.
- Call `drawingContext.beginDraw()` before drawing. `YieldContext` only resets blend, the VAO and texture units, and it is `beginDraw` that binds the framebuffer, scissor and viewport for the current camera.
- `calcMatrix` from `ExternWebGLRenderer` includes the camera viewport, rotation, zoom and scroll when `drawingContext.useCanvas` is true, in top-left, Y-down backing pixels. The vertex shader maps to clip space as `x' = 2x/W − 1, y' = 1 − 2y/H` using `drawingContext.width/height`. We never put the arena camera in a framebuffer (no camera alpha < 1, filters or `forceComposite`). `render` checks `useCanvas` and skips drawing if it is false, rather than supporting that path untested.
- Vertex layout: `x, y` (already transformed by `calcMatrix` on the CPU, as today), `nx, ny`, and colour as RGBA with alpha `camera.alpha * this.alpha`. The v3 shader read `outTint.bgr` because Phaser 3 packed tints as BGR; the new code packs RGB itself. Output stays premultiplied with blend `ONE, ONE_MINUS_SRC_ALPHA`, as Phaser's NORMAL blend expects. `uFeather` keeps its formula, using `Math.hypot(calcMatrix.a, calcMatrix.b)`.
- Upload vertices when the ribbon set or the camera matrix changes. Positions are in screen space, so crossed maps with four cameras need one upload per camera per frame, which is acceptable at trail scale. Grow the buffer geometrically.
- `destroy` releases the VAO, buffer and program. A shader that fails to compile or link disables the trails once (logged) and releases what was created, instead of throwing on every frame.

Rejected alternative: a custom `BatchHandlerTri` render node registered through `RenderConfig#renderNodes` with shader additions. It would batch with Phaser's own draws, but it ties us to render-node internals that are still moving across the 4.x minors, and trail count is small enough that one draw call per frame is fine.

### C. Small fixes

- `cancelPreload`: iterate `loader.inflight` with `for…of`.
- `guardDefaultTextures` returns silently when Phaser's READY listener layout differs, which would quietly lose the #127 protection. Report whether it is armed in `metrics()`, and assert that in `scripts/phaser-browser.ts`.
- ParticleEmitter `atLimit`/`reserve` are unchanged in 4.2.1 (`ParticleEmitter.js` ~2170/2240), so the limits in PHASER.md still hold.

## Verification

Unit: `npm run typecheck`, `npm test`, `npm run test:coverage`, `npm run build`. The golden hash must not change.

Browser, run in Chrome and WebKit (`BROWSER=webkit`) on this branch and on a Phaser 3 baseline checkout (`origin/main`), comparing the `artifacts/` sheets side by side:

`phaser-browser`, `beveled-trails-browser`, `portrait-arena-browser`, `map-styles-smoke`, `dead-rider-browser`, `trail-debris-browser`, `blast-browser`, `gun-browser`, `bomb-preview-smoke`, `reload-ring-browser`, `power-browser`, `extra-bomb-browser`, `phaser-pages-smoke`, `presentation-lifecycle`, plus one real-room flow (`online-smoke` or `shared-room-smoke`).

Compare sheets with a numeric per-pixel diff and a threshold, not by eye: Phaser 4 rewrote Graphics tessellation (`FillPath`/`StrokePath`), so rims, bricks and grid lines may shift. Report any region whose difference exceeds antialiasing noise.

Performance: include a crossed map if the benchmark fixture allows it (four cameras, so four trail draws, each with a `RebindContext`). `DURATION_MS=30000 npx tsx scripts/phaser-benchmark.ts` on both versions in Chrome and WebKit, plus the mobile variant. Keep the JSON reports and source revisions. A frame p95 regression past the 16.7 ms budget, or a render-CPU p95 more than about 25% worse, blocks the change.

Bundle: compare the lazily loaded Phaser chunk size in `vite build` output.

## Rollback

It is a single dependency plus one directory, so revert the merge commit. No protocol, storage or simulation state is involved.

## Review record

An independent review of the first draft found that:

- WebGL never clipped. We probed this and confirmed it, so the camera-split design was dropped.
- The trails need `beginDraw()`.
- Camera-filter ids are reused when cameras are rebuilt; this became moot once the camera split was dropped.
- The renderer's GL wrappers handle context restore.
- The default-texture guard fails silently.
- Pixel diffs must be numeric.

All of these are addressed above.

# Phaser presentation and renderer evidence

For proposed optimization work and independently assignable experiments, see the [performance exploration brief](performance/EXPLORATION-BRIEF.md). Its hypotheses and suggested selection criteria are separate from the completed measurements below.

Fuse Riders uses **Phaser 3.90.0 for arena presentation**. The shared TypeScript simulation remains the authority; Phaser physics, input and audio systems do not own game rules. DOM menus, pointer controls and the existing audio director remain outside the scene.

The cleaner presentation restoration ([issue #63](https://github.com/andeplane/fuse-riders/issues/63)) takes its visual reference from the pre-Phaser client at `1776ef5`: radial arena shading, a world-anchored grid, slimmer trails, simple three-layer blast silhouettes and restrained rider outlines. Phaser still renders the supplied snapshots. The background texture is cached independently of the shrinking boundary; the existing theme palettes, avatars and gameplay geometry are retained. The later border cleanup removed the decorative block wall, corner ornaments and outer canvas frame in both Phaser and Canvas, leaving one thin boundary line for every theme. That erased the only remaining difference between the two visual styles, so the boundary is themed again from `src/client/arena-wall.ts`, shared by both renderers: a `pixelated` theme (Neon Pixel) draws the brick wall, corner brackets and warning studs and dots its trail cores as studs, while a smooth theme (Clean Neon) keeps the thin rim plus its `wallWidth` outer stroke and hairline trail cores. Outside shading still marks the playable area in both. Online rooms expose the choice again through a `STYLE` control in the room header. `selectedTheme()` resolves `?theme=` first, then the stored choice, then the default; a valid `?theme=` is stored, because entering a room rewrites the URL and would otherwise drop it. Online screens also reuse the earlier squared panels, cyan primary action and player-colored score cards above the desktop board.

The benchmark tables and showcase images below describe their recorded historical revisions, before this styling restoration; they are not performance certification for the new presentation.

The [smooth-trail follow-up](online/SMOOTH-TRAILS-2026-09-14.md) enables antialiasing, disables renderer pixel-art mode, joins continuous trail sections, separates moving tips from cached trail history, and renders at the displayed arena size times device-pixel ratio (bounded to roughly 4K). World coordinates remain independent of screen pixels, including in the Canvas fallback. It records the rendering boundaries, regression checks and new local measurements separately from the historical results below.

`src/client/phaser/presentation.ts` lazily loads Phaser when a board is first rendered, so shared-TV phone controllers do not download or initialize a hidden arena. The caller supplies snapshots and the frame clock. The Phaser automatic loop stops after scene creation and each caller frame manually steps presentation once. An explicit scope string (authority epoch plus match ID) and snapshot round delimit effect history. Callers must provide a coherent visual tick for smoothly sampled bomb flights; the renderer never predicts authoritative collisions.

The [fractional presentation audit](online/FRACTIONAL-PRESENTATION.md) describes the held-bomb preview fix, its per-rider visual time, and remaining opportunities for smoother rendering.

The scene batches sprites, draws simple layered blasts, retains trail graphics between updates, and uses one masked layer for the shrinking playfield. Existing avatar atlas and both theme asset sets are reused. Features include smooth luminous trails, restrained rider outlines, animated charge/fuse/target markers, readable shell/cannon silhouettes, layered radial fire, shock rings, pixel spark bursts and death fragments. Ink preserves the existing clear-space compositing semantics with a Canvas texture uploaded only while ink is active.

Desktop quality reserves 480 particles (mobile-width quality: 160), with matching live-particle limits. Phaser's total-object limit is one higher because its `atLimit` includes reserved dead particles. Sprite and label pools shrink to the current snapshot's needs plus 16 and 8 spare objects. These pools do not cap or omit valid authoritative projectiles. The snapshot validation boundary must still bound world complexity.

A lost GPU context displays recovery status. Successful restoration resets transient effects and redraws current state. If restoration does not happen within two seconds, the adapter replaces the incompatible canvas and uses the original Canvas renderer. `?renderer=canvas` selects that renderer explicitly; `?renderer=phaser-canvas` exercises Phaser's Canvas backend. Destroy is idempotent and flushes Phaser's deferred destruction without leaving an independent animation loop. Assets resolve beneath `import.meta.env.BASE_URL`, including `/fuse-riders/` on GitHub Pages.

## Verified desktop evidence

Measured on Apple M4 Max / 48 GiB RAM, macOS, headless Chrome 153 and Playwright WebKit 26.6. Each renderer ran for 30 seconds with a one-second warmup at 1600×900: five riders, 800 trail segments, 24 projectiles, six pickups and five repeating explosions. Other development processes were active. Raw samples, source SHA-256 hashes and limitations are preserved in [Chrome results](performance/phaser-chrome.json) and [WebKit results](performance/phaser-webkit.json).

| Browser / renderer | Frame p95 / p99 / max | Render CPU p95 | Maximum scene objects / live particles |
| --- | --- | --- | --- |
| Chrome / original Canvas | 16.7 / 16.8 / 16.8 ms | 0.6 ms | Not instrumented |
| Chrome / Phaser WebGL | 16.7 / 16.8 / 16.8 ms | 4.9 ms | 83 / 284 |
| WebKit / original Canvas | 18 / 18 / 21 ms | 1 ms | Not instrumented |
| WebKit / Phaser WebGL | 18 / 19 / 20 ms | 4 ms | 79 / 289 |

Both renderers sustained the desktop frame budget. Phaser's richer scene costs more CPU than the original Canvas renderer; this is **not evidence of a CPU speedup**. An earlier 60-second WebKit run recorded a 112 ms maximum frame despite an 18 ms p95, so occasional long frames remain worth tracking. Object counts and particle caps are not a heap-allocation/GC profile. These are synthetic rendering results, not proof of phone performance, network smoothness, or the complete online 30-minute soak gate.

The dedicated browser check passed in Chrome and WebKit: WebGL plus forced Phaser Canvas, bounded active particles, one automatic-loop invariant, scope/reset behavior, a nonblank pixel after GPU context restoration, automatic visible Canvas fallback after unrecovered context loss, and repeated disposal. The integrated LAN smoke passed in both browsers with five phones, controls, themes, pickups, reconnect and rematch. A production build with `/fuse-riders/` base loaded all 29 avatar/theme resources successfully with no duplicated prefix or browser errors.

## Reproduce

```sh
npm run typecheck
npx tsx --test tests/phaser-effects.test.ts tests/asset-url.test.ts
npx tsx scripts/phaser-browser.ts
BROWSER=webkit npx tsx scripts/phaser-browser.ts
DURATION_MS=30000 npx tsx scripts/phaser-benchmark.ts
BROWSER=webkit DURATION_MS=30000 npx tsx scripts/phaser-benchmark.ts
npx vite build --outDir artifacts/phaser-dist
BUILD_DIRECTORY=artifacts/phaser-dist npm run test:browser
BUILD_DIRECTORY=artifacts/phaser-dist BROWSER=webkit npm run test:browser
npx vite build --base /fuse-riders/ --outDir artifacts/phaser-pages-dist
npx tsx scripts/phaser-pages-smoke.ts
npx tsx scripts/gameplay-showcase.ts
```

The benchmark writes raw reports to `artifacts/`; preserve a reviewed copy with build identity when recording new evidence. `docs/gameplay-phaser.png` is an actual running LAN application screenshot: `scripts/gameplay-showcase.ts` adds 5 AI riders, starts a real race, and advances ticks across the match, screenshotting whenever the bots' own play produces a busier frame (more bombs, a live portal, a fired gun shot, an explosion) — no injected fixture, no image-generated mockup. `scripts/phaser-showcase.ts` still exists for a deterministic, reproducible showcase state used in earlier reviews. Renderer-specific tests do not imply full source coverage; the repository coverage manifest names its included modules.

Design and review context: [ADR 033](adr/033-phaser-renderer.md). Online authority and release acceptance remain governed by the online ADRs and roadmap; this rendering work does not close those gates.

## Mobile-sized viewport evidence

The same synthetic workload was subsequently measured sequentially in Chrome and WebKit at **390×844 viewport, DPR 2**, low quality with a 160-particle cap, for 30 seconds per renderer. The fitted board measured **390×219.375 CSS pixels**, while its actual backing remained **1600×900**, matching the production renderer at that recorded revision. The current display-aware sizing follow-up is measured separately above. Raw reports include actual dimensions, source revisions/hashes and every timing sample: [Chrome](performance/phaser-mobile-chrome.json), [WebKit](performance/phaser-mobile-webkit.json).

| Browser / renderer | Frame p95 / p99 / max | Render CPU p95 | Max scene objects / particles |
| --- | --- | --- | --- |
| Chrome / Canvas | 16.7 / 16.8 / 16.8 ms | 0.6 ms | Not instrumented |
| Chrome / Phaser | 16.7 / 16.8 / 16.8 ms | 4.9 ms | 83 / 159 |
| WebKit / Canvas | 18 / 19 / 20 ms | 1 ms | Not instrumented |
| WebKit / Phaser | 18 / 19 / 22 ms | 5 ms | 79 / 158 |

Each mode retained 1,741 post-warmup frames. Both browser runs had zero page errors, no independent Phaser RAF loop, and active particles below the mobile cap. This is desktop browser viewport/DPR emulation on the same M4 Max machine, **not physical-phone GPU, thermals, touch or battery evidence**. Phaser costs more CPU than Canvas here too.

```sh
VIEWPORT_WIDTH=390 VIEWPORT_HEIGHT=844 DPR=2 QUALITY=low BENCH_TAG=mobile DURATION_MS=30000 npx tsx scripts/phaser-benchmark.ts
BROWSER=webkit VIEWPORT_WIDTH=390 VIEWPORT_HEIGHT=844 DPR=2 QUALITY=low BENCH_TAG=mobile DURATION_MS=30000 npx tsx scripts/phaser-benchmark.ts
```

The default desktop workload remains unchanged. `QUALITY` defaults to low below 701 viewport pixels; explicit low/high values let measurements reproduce the selected budget. Backing size is observed and asserted, not rescaled into a different game world.

# Phaser presentation and renderer evidence

For proposed optimization work and independently assignable experiments, see the [performance exploration brief](performance/EXPLORATION-BRIEF.md). Its hypotheses and suggested selection criteria are separate from the completed measurements below.

Fuse Riders uses **Phaser 3.90.0 for arena presentation**. The shared TypeScript simulation remains the authority; Phaser physics, input and audio systems do not own game rules. DOM menus, pointer controls and the existing audio director remain outside the scene.

The cleaner presentation restoration ([issue #63](https://github.com/andeplane/fuse-riders/issues/63)) takes its visual reference from the pre-Phaser client at `1776ef5`: radial arena shading, a world-anchored grid, slimmer trails, simple three-layer blast silhouettes and restrained rider outlines. Phaser still renders the supplied snapshots. The background texture is cached independently of the shrinking boundary; the existing theme palettes, avatars and gameplay geometry are retained. The later border cleanup removed the decorative block wall, corner ornaments and outer canvas frame in both Phaser and Canvas, leaving one thin boundary line for every theme; see **Themed arena boundary** below. Online screens also reuse the earlier squared panels, cyan primary action and player-colored score cards above the desktop board.

## Map scenery

Desert uses a warm copper floor with sand ripples, stepped pyramids with shaded faces and stairs, and flowering cacti. Forest uses a cool jade floor with grass/moss marks, clustered tree crowns, berry bushes and fallen trunks with growth rings, moss and flowers. City uses a plum floor with inset paving and buildings viewed from above: parapets, roof access hatches, fan housings and service conduits replace facade-style window grids. Small timber crates remain in the city. These low-contrast ground marks are decorative; the existing grid, rider colors and collision silhouettes remain unchanged.

Ground detail is baked into the existing background texture only when map, size or visual style changes. The renderer passes the map to the obstacle painter so the shared rock footprint can look like a desert pyramid or a forest trunk without changing wire kinds or collision geometry. Triangle faces, ellipses and rectangles use the same primitives on both backends. Obstacle details remain in the cached floor pass and disappear with their snapshot obstacles. Both Canvas and WebGL use the same art, with no extra textures, animation timers or simulation state. Classic, wrap-around and crossed maps retain their visual style's original floor. Run `npx tsx scripts/map-styles-smoke.ts` for reproducible contact sheets in both visual styles on Canvas and WebGL (`artifacts/map-styles-*.png`).

## Themed arena boundary

The border cleanup left one thin rim for every theme, which erased the only remaining difference between the two visual styles: `neon-pixel` rendered `clean-neon`'s geometry, and the Phaser arena read neither `wallWidth` nor `pixelated` at all. `src/client/arena-wall.ts` now owns the choice — `arenaWall(width, height, inset, theme)` returns either a `pixel` wall (brick runs, corner brackets, warning studs) or a `smooth` wall (one `wallWidth` stroke outside the rim) — and the Phaser scene paints that geometry on either backend.

`rendering.pixelated` is the discriminator, and it now drives the boundary, the trail core (2×2 studs at `TRAIL_STUD_SPACING` world units instead of a hairline) and square rather than round trail end caps. `rendering.trailGlow` sets the outer glow width, which nothing read before. The rim itself is not theme-specific: both styles draw it at 4px with a glow (a wide translucent stroke under a tight one, since Phaser `Graphics` has no `shadowBlur`), and outside shading still marks the playable area in both. Brick depth is clamped to the boundary inset, so a boundary thinner than a brick run cannot draw off-canvas.

Online rooms expose the choice through the VISUAL STYLE options in the room's SETTINGS dialog, one pressed/unpressed button per `themes` entry, and swaps live — both texture sets are preloaded and palettes are read per frame — and it is hidden on a shared-TV rider's phone, which never draws an arena. `selectedTheme()` resolves `?theme=` first, then the stored choice, then the default; a valid `?theme=` is stored, because entering a room rewrites the query string (`?solo=1`, `?room=CODE`) and would otherwise drop it.

The benchmark tables and showcase images below describe their recorded historical revisions, before this styling restoration; they are not performance certification for the new presentation.

The [smooth-trail follow-up](online/SMOOTH-TRAILS-2026-09-14.md) enables antialiasing, disables renderer pixel-art mode, joins continuous trail sections, separates moving tips from cached trail history, and renders at the displayed arena size times device-pixel ratio (bounded to roughly 4K). World coordinates remain independent of screen pixels, on both Phaser backends. It records the rendering boundaries, regression checks and new local measurements separately from the historical results below.

`src/client/phaser/presentation.ts` lazily loads Phaser when a board is first rendered, so shared-TV phone controllers do not download or initialize a hidden arena. The caller supplies snapshots and the frame clock. The Phaser automatic loop stops after scene creation and each caller frame manually steps presentation once. An explicit scope string (authority epoch plus match ID) and snapshot round delimit effect history. Callers must provide a coherent visual tick for smoothly sampled bomb flights; the renderer never predicts authoritative collisions.

The [fractional presentation audit](online/FRACTIONAL-PRESENTATION.md) describes the held-bomb preview fix, its per-rider visual time, and remaining opportunities for smoother rendering.

The scene batches sprites, retains trail graphics between updates, and uses one masked layer for the shrinking playfield. Existing avatar atlas and both theme asset sets are reused. Features include smooth luminous trails, restrained rider outlines, animated charge/fuse/target markers, readable shell silhouettes and white-hot instant-gun tracers, shock rings, pixel spark bursts and death fragments. Ink preserves the existing clear-space compositing semantics with a Canvas texture uploaded only while ink is active.

Living riders have a thin one-world-pixel portrait outline. After firing, a two-world-pixel player-colored reload arc sits half a world pixel outside that outline, so it reads as an avatar border rather than a separate halo. It drains clockwise from the top over the shared weapon cooldown and disappears when that cooldown ends. Both Phaser backends sample the supplied fractional presentation tick (per rider first, then world, then snapshot), so no timer or effect history can drift through rollback, reconnects or a paused snapshot. The ring is hidden outside active play. Run `npx tsx scripts/reload-ring-browser.ts` (optionally with `BROWSER=webkit`) to check full, partial and completed cooldowns in both themes and all rendering backends.

Bomb fuse rings, blast-radius circles and landing markers use the owning rider’s color on both Phaser backends, with white as the fallback when the owner is absent. Both themes use bomb artwork without a body outline. Fuse progress and damage geometry are unchanged.

`src/client/blast-animation.ts` samples explosion geometry for the Phaser scene: nine irregular orange/amber circles pop outward with staggered starts and a small size overshoot, then shrink and separate as the bright core collapses first. Six small square embers finish the effect. Seeded cosmetic offsets depend on bomb identity, so repeated frames and rollback do not jitter or consume simulation randomness. The faint full-radius footprint and the expanding ring stay within the supplied blast radius, as do every lobe and ember. The animation fits the existing eight-tick (400 ms) lifetime; it does not extend damage or retain expired explosions. Online uses its fractional snapshot tick; LAN supplies bounded fractional `presentationTick` metadata for cosmetics while keeping the authoritative tick intact. Blast sparks are sampled directly rather than emitted as Phaser particles; the bounded particle pool still handles rider deaths.

Explosion-cut trails also leave client-only debris (`src/client/trail-debris.ts`). The renderer compares one retained trail frame with the next snapshot and emits only missing, unexpired segments intersecting a newly observed blast. Normal expiry, endpoint erosion, boundary trimming, partially retained segments and speculative future tips do not emit. Detached pieces ignore their former expiry when detecting a new blast; erosion is accounted for before comparing missing geometry. Each piece keeps its rider color, with locally random outward velocity, spin and a 520–820 ms lifetime; analytic drag samples the caller's frame clock without a physics loop or network messages. Overlapping blasts launch a piece once. Debris is capped at 240 pieces on desktop and 80 on mobile, and history at 2,048 segments per rider; dense removals sample across riders. Scope/round changes, backward time, lobby and renderer resets discard the cosmetic history. A fresh renderer or a client that missed the entire blast has no previous cut to animate. Both Phaser backends clip fragments to the arena and draw them beneath riders and ink.

Dead riders disappear immediately, including their avatar, heading marker, label and status auras, leaving the crash particles unobscured. Detached living-owner pieces and dead trails render at 60% opacity on both Phaser backends. Shared simulation pauses them for 20 ticks, then erodes each end at 37.5 world units/second; the renderer samples the surviving geometry without an independent decay clock or whole-piece age fade. Piece ids prevent joins across cuts, and the history cache refreshes when either endpoint or lifecycle changes. Trails freeze with the final board when active play ends. Run `npx tsx scripts/dead-rider-browser.ts` (also with `BROWSER=webkit`) to check both themes across Phaser WebGL and Canvas, including both shrinking endpoints, detached living trails, death particles and avatar reuse.

Desktop quality reserves 480 particles (mobile-width quality: 160), with matching live-particle limits. Phaser's total-object limit is one higher because its `atLimit` includes reserved dead particles. Sprite and label pools shrink to the current snapshot's needs plus 16 and 8 spare objects. These pools do not cap or omit valid authoritative projectiles. The snapshot validation boundary must still bound world complexity.

A lost GPU context displays recovery status. Successful restoration resets transient effects and redraws current state. After two seconds without restoration, graphics stop and a **RETRY GRAPHICS** button recreates Phaser on a fresh canvas, then draws the latest supplied snapshot. Loading or initializing Phaser has a ten-second deadline and the same retry action on failure. Late completion from a failed or disposed attempt cannot revive it. Retry preserves the caller's room connection, controls and simulation; the game continues while the view is unavailable.

The separate hand-written Canvas renderer and `?renderer=canvas` override have been removed. Phaser still chooses its built-in Canvas backend when WebGL is unavailable; `?renderer=phaser-canvas` exercises it explicitly. Phaser's Canvas textures for background shading and ink compositing remain part of the same scene. Destroy is idempotent and flushes Phaser's deferred destruction without leaving an independent animation loop. Assets resolve beneath `import.meta.env.BASE_URL`, including `/fuse-riders/` on GitHub Pages.

`scripts/phaser-browser.ts` checks both Phaser backends, automatic context restoration, visible retry after unrecovered context loss, repaint and resizing after retry, and disposal. Its deterministic lifecycle checks inject loaders, arenas and deadlines to cover import/init/readiness failures, import and boot timeouts, stale completion/events, render failures and disposal during startup. The benchmark now compares Phaser Canvas with Phaser WebGL; the original Canvas measurements below are historical and require their recorded source revisions to reproduce.

## Verified desktop evidence

Measured on Apple M4 Max / 48 GiB RAM, macOS, headless Chrome 153 and Playwright WebKit 26.6. Each renderer ran for 30 seconds with a one-second warmup at 1600×900: five riders, 800 trail segments, 24 projectiles, six pickups and five repeating explosions. Other development processes were active. Raw samples, source SHA-256 hashes and limitations are preserved in [Chrome results](performance/phaser-chrome.json) and [WebKit results](performance/phaser-webkit.json).

| Browser / renderer       | Frame p95 / p99 / max | Render CPU p95 | Maximum scene objects / live particles |
| ------------------------ | --------------------- | -------------- | -------------------------------------- |
| Chrome / original Canvas | 16.7 / 16.8 / 16.8 ms | 0.6 ms         | Not instrumented                       |
| Chrome / Phaser WebGL    | 16.7 / 16.8 / 16.8 ms | 4.9 ms         | 83 / 284                               |
| WebKit / original Canvas | 18 / 18 / 21 ms       | 1 ms           | Not instrumented                       |
| WebKit / Phaser WebGL    | 18 / 19 / 20 ms       | 4 ms           | 79 / 289                               |

Both renderers sustained the desktop frame budget. Phaser's richer scene costs more CPU than the original Canvas renderer; this is **not evidence of a CPU speedup**. An earlier 60-second WebKit run recorded a 112 ms maximum frame despite an 18 ms p95, so occasional long frames remain worth tracking. Object counts and particle caps are not a heap-allocation/GC profile. These are synthetic rendering results, not proof of phone performance, network smoothness, or the complete online 30-minute soak gate.

At the historical measured revision, the dedicated browser check passed in Chrome and WebKit: WebGL plus forced Phaser Canvas, bounded active particles, one automatic-loop invariant, scope/reset behavior, a nonblank pixel after GPU context restoration, automatic visible Canvas fallback after unrecovered context loss, and repeated disposal. The integrated LAN smoke passed in both browsers with five phones, controls, themes, pickups, reconnect and rematch. A production build with `/fuse-riders/` base loaded all 29 avatar/theme resources successfully with no duplicated prefix or browser errors.

## Reproduce

```sh
npm run typecheck
npx tsx --test tests/phaser-effects.test.ts tests/asset-url.test.ts
npx tsx scripts/blast-browser.ts
BROWSER=webkit npx tsx scripts/blast-browser.ts
npx tsx scripts/trail-debris-browser.ts
BROWSER=webkit npx tsx scripts/trail-debris-browser.ts
npx tsx scripts/phaser-browser.ts
BROWSER=webkit npx tsx scripts/phaser-browser.ts
DURATION_MS=30000 npx tsx scripts/phaser-benchmark.ts
BROWSER=webkit DURATION_MS=30000 npx tsx scripts/phaser-benchmark.ts
npx vite build --outDir artifacts/phaser-dist
npx vite build --base /fuse-riders/ --outDir artifacts/phaser-pages-dist
npx tsx scripts/phaser-pages-smoke.ts
```

The benchmark writes raw reports to `artifacts/`; preserve a reviewed copy with build identity when recording new evidence. Renderer-specific tests do not imply full source coverage; the repository coverage manifest names its included modules.

Design and review context: [ADR 033](adr/033-phaser-renderer.md). Online authority and release acceptance remain governed by the online ADRs and roadmap; this rendering work does not close those gates.

## Mobile-sized viewport evidence

The same synthetic workload was subsequently measured sequentially in Chrome and WebKit at **390×844 viewport, DPR 2**, low quality with a 160-particle cap, for 30 seconds per renderer. The fitted board measured **390×219.375 CSS pixels**, while its actual backing remained **1600×900**, matching the production renderer at that recorded revision. The current display-aware sizing follow-up is measured separately above. Raw reports include actual dimensions, source revisions/hashes and every timing sample: [Chrome](performance/phaser-mobile-chrome.json), [WebKit](performance/phaser-mobile-webkit.json).

| Browser / renderer | Frame p95 / p99 / max | Render CPU p95 | Max scene objects / particles |
| ------------------ | --------------------- | -------------- | ----------------------------- |
| Chrome / Canvas    | 16.7 / 16.8 / 16.8 ms | 0.6 ms         | Not instrumented              |
| Chrome / Phaser    | 16.7 / 16.8 / 16.8 ms | 4.9 ms         | 83 / 159                      |
| WebKit / Canvas    | 18 / 19 / 20 ms       | 1 ms           | Not instrumented              |
| WebKit / Phaser    | 18 / 19 / 22 ms       | 5 ms           | 79 / 158                      |

Each mode retained 1,741 post-warmup frames. Both browser runs had zero page errors, no independent Phaser RAF loop, and active particles below the mobile cap. This is desktop browser viewport/DPR emulation on the same M4 Max machine, **not physical-phone GPU, thermals, touch or battery evidence**. Phaser costs more CPU than Canvas here too.

```sh
VIEWPORT_WIDTH=390 VIEWPORT_HEIGHT=844 DPR=2 QUALITY=low BENCH_TAG=mobile DURATION_MS=30000 npx tsx scripts/phaser-benchmark.ts
BROWSER=webkit VIEWPORT_WIDTH=390 VIEWPORT_HEIGHT=844 DPR=2 QUALITY=low BENCH_TAG=mobile DURATION_MS=30000 npx tsx scripts/phaser-benchmark.ts
```

The default desktop workload remains unchanged. `QUALITY` defaults to low below 701 viewport pixels; explicit low/high values let measurements reproduce the selected budget. Backing size is observed and asserted, not rescaled into a different game world.

## Gun presentation

Gun shots retain instant authoritative resolution and their three-tick tracer lifetime. `src/client/gun-animation.ts` samples supplied presentation time: a 50 ms directional pixel muzzle flash, a decorative recoil collar, and a white core over shooter-colored glow that collapses ahead of the thin afterimage. Original rays are distinguished from their portal/wrap continuation segments so those do not create extra muzzle flashes. Armed living riders display a small barrel chevron; the same symbol marks the fire button and phone HUD until the Gun is spent.

`src/client/gun-impacts.ts` compares one previous snapshot with new resolved endpoints. Newly cut trail ends brighten and throw colored fragments; wall/scenery endpoints throw a tight spark fan; an observed death next to the endpoint adds a sharper burst. These are cosmetic observations, not additional damage decisions or kill attribution. Ambiguous endpoints stay quiet. Impact history is capped at 64 bursts lasting eight ticks (400 ms), cleared on scope/round changes, rollback, lobby and renderer reset. A fresh connection does not replay old impacts. Missed snapshots may omit a cut effect; the renderer never invents damage to recover one.

Portal pairs pulse together only when matching incoming and outgoing authoritative tracer segments exist. Tiny flashes mark the two transit points and the beam remains segmented across the actual path. All Gun-specific motion follows snapshot time, with no physics, hit stop, camera shake or independent timer.

The audio director gives each trigger pull a short layered crack, midrange thump and quiet electrical tail with stable pitch variation. Volley rays share one firing cue; different riders firing together remain audible. Observed impacts have separate trail, solid and lethal cues. A newly armed Gun adds a two-part mechanical rack after the pickup melody. Mute, hidden-tab suppression and silent reconnect baselines also apply to these cues. Audio remains synthesized; phone-speaker balance still requires listening on physical hardware.

Focused verification: `node --import tsx --test tests/gun-animation.test.ts tests/gun-impacts.test.ts tests/audio-director.test.ts`. `node --import tsx scripts/gun-browser.ts` (also with `BROWSER=webkit`) checks both themes on WebGL and Canvas, fractional fades, expiration/reset, trail fragments, armed styling and paired portal pulses; it writes contact sheets to `artifacts/gun-*.png`.

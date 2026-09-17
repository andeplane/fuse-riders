# Smooth trail presentation — local validation

Follow-up to [issue #63](https://github.com/andeplane/fuse-riders/issues/63), within the snapshot presentation boundary accepted by [ADR033](../adr/033-phaser-renderer.md). This work is local and has not been published.

## Rendering changes

The WebGL context requests antialiasing, Phaser uses `antialias: true`, `antialiasGL: true`, `pixelArt: false`, and the LAN canvas uses normal CSS image scaling. The selected neon colors and authored assets remain. The world remains 1600×900 logical units. The backing now follows the displayed arena size multiplied by the screen’s device-pixel ratio, preserving its aspect ratio. A 1600×900 CSS-pixel board at DPR 2 uses a 3200×1800 backing. Backing allocation is bounded to 3840×2160 pixels in area and 4096 pixels per dimension; larger displays therefore render below native density. This is a fixed safety cap, not an FPS-driven quality controller.

ResizeObserver tracks layout changes without a layout read on every frame; the current device-pixel ratio is read on each render, including after moving between displays. The Phaser camera maps the unchanged world coordinates onto the backing. Labels increase raster resolution with camera scale. The original Canvas renderer and recovery fallback use the same sizing policy with a 2D transform. The landing backdrop’s `object-fit: cover` uses the covering scale. Observers are disconnected on disposal. Existing bitmap assets retain their source resolution; vector trails are drawn at the selected backing resolution.

Each consecutive, touching trail section is a joined stroke with rounded ends. Missing simulation ticks and non-touching endpoints start a separate path, preserving blast holes, expiry and portals. No Bézier fitting is applied: the antialiased polylines looked smooth in the inspected screenshots and retain the recorded vertices.

The last segment is drawn separately. Existing local prediction already supplies a moving final segment. Remote/LAN presentation may extend a fresh segment to the supplied interpolated head by at most one normal simulation step (7.5 world units), only during play, while alive and outside portal cooldown. Stale or missing ends are not bridged. All trail rendering remains clipped by the supplied arena boundary; presentation never writes simulation state.

Established drawing commands are rebuilt only when geometry, continuity, color, alive state, player membership or authority/match/round scope changes. Fractional presentation ticks and changing final segments do not invalidate them. This caches Phaser Graphics commands, not a persistent GPU mesh; Phaser still submits the visible paths on each rendered frame. Cache storage is bounded by the current players and their retained trails.

## Verification

Six new pure regression tests cover exact joined vertices, holes, portals, clipping, cache invalidation/reuse, expiry, state immutability, and safe head extensions. The browser renderer test checks actual WebGL antialiasing, unchanged history build count across twelve fractional frames with moving tips and cloned history, then a rebuild after expiry. It also retains the existing effects, disposal, context-loss/restoration and visible Canvas recovery checks.

Two additional pure tests cover DPR 1/2/3, letterboxing, cover scaling, fractional sizes, hidden layout and the backing caps. Browser checks exercise three CSS arena sizes, sample two widely separated trail landmarks to check camera mapping, and verify Canvas fallback sizing after recovery and resize.

The renderer modules remain outside the configured enforced coverage list. Their unit and browser tests complement that gate; physical-phone performance and public acceptance are not inferred from desktop browser emulation.

## Timing method

The initial same-harness Chrome comparison used 15 seconds per renderer with one second of warmup, five riders, 800 trail segments, 24 projectiles and five repeating bursts. Phaser frame p95 was 16.7 ms both before and after; render-call CPU p95 was 4.1 ms before and 4.4 ms after. These are single exploratory runs, not a statistically established speedup. Both used the earlier harness, which also left the landing animation running, and the baseline was the uncommitted cleaner-style worktree. Raw initial runs remain operator-local under `artifacts/phaser-benchmark-{before,after}-smooth-chrome.json`.

The corrected harness starts on a static invalid-room page, excludes the landing simulation, bounds the run, records SHA-256 fingerprints of the actual source, and takes its screenshot after `page.evaluate` returns. The earlier WebKit harness completed frame collection but stalled while awaiting its screenshot through an exposed callback; those attempts are not passing timing runs. Initial timeout and diagnostic logs remain operator-local.

These first isolated results predate display-aware sizing and use a fixed 1600×900 backing. With the current harness, add `RESOLUTION=world` to reproduce that pixel workload. Commands used for the recorded isolated batch (sequential, avoiding competing test browsers):

```sh
BROWSER=webkit DURATION_MS=15000 BENCH_TAG=smooth-final-desktop npx tsx scripts/phaser-benchmark.ts
DURATION_MS=15000 BENCH_TAG=smooth-final-desktop npx tsx scripts/phaser-benchmark.ts
VIEWPORT_WIDTH=844 VIEWPORT_HEIGHT=390 DPR=2 QUALITY=low DURATION_MS=10000 BENCH_TAG=smooth-final-phone npx tsx scripts/phaser-benchmark.ts
BROWSER=webkit VIEWPORT_WIDTH=844 VIEWPORT_HEIGHT=390 DPR=2 QUALITY=low DURATION_MS=10000 BENCH_TAG=smooth-final-phone npx tsx scripts/phaser-benchmark.ts
```

The phone profile fits a 693⅓×390 CSS-pixel board into an 844×390 viewport, at DPR 2, retaining the same 1600×900 backing. Timing samples measure requestAnimationFrame intervals and synchronous render-call CPU time; the latter does not measure asynchronous GPU work. No simulation, network or physical-phone certification is claimed by this short synthetic batch.

## Isolated results before display-aware sizing

| Browser / profile | Samples | Frame p95 / p99 / max (ms) | Render CPU p95 (ms) | Max objects / particles |
| ----------------- | ------: | -------------------------: | ------------------: | ----------------------: |
| Chrome / desktop  |     841 |         16.7 / 16.8 / 16.8 |                 2.5 |                60 / 132 |
| Webkit / desktop  |     839 |         18.0 / 18.0 / 28.0 |                 3.0 |                56 / 134 |
| Chrome / phone    |     541 |         16.7 / 16.8 / 16.8 |                 2.8 |                60 / 133 |
| Webkit / phone    |     541 |         17.0 / 18.0 / 19.0 |                 3.0 |                56 / 132 |

Raw distributions and the tested source fingerprints: [Chrome desktop](../performance/smooth-trails/desktop-chrome.json), [WebKit desktop](../performance/smooth-trails/desktop-webkit.json), [Chrome phone viewport](../performance/smooth-trails/phone-chrome.json), [WebKit phone viewport](../performance/smooth-trails/phone-webkit.json). The recorded Git revision is the base commit; the source fingerprints identify the uncommitted implementation measured here. These isolated runs used a corrected harness, so their CPU timings should not be interpreted as a direct speedup against the initial comparison.

## Display-aware sizing validation

Measured locally on an Apple M3 Max with 64 GiB RAM. Historical hardware claims above refer to their original reports. The new harness defaults to `RESOLUTION=display`; `RESOLUTION=world` explicitly selects the historical fixed backing. The direct legacy Canvas comparison in the benchmark remains fixed at 1600×900, whereas the production Canvas presentation adapter uses display sizing. Read each result’s backing dimensions before comparing rendering costs.

The following runs used 10 seconds per renderer with one second of warmup and the same synthetic fixture, sequentially:

```sh
DPR=2 DURATION_MS=10000 BENCH_TAG=hidpi-desktop npx tsx scripts/phaser-benchmark.ts
BROWSER=webkit DPR=2 DURATION_MS=10000 BENCH_TAG=hidpi-desktop npx tsx scripts/phaser-benchmark.ts
VIEWPORT_WIDTH=844 VIEWPORT_HEIGHT=390 DPR=3 QUALITY=low DURATION_MS=10000 BENCH_TAG=hidpi-phone npx tsx scripts/phaser-benchmark.ts
BROWSER=webkit VIEWPORT_WIDTH=844 VIEWPORT_HEIGHT=390 DPR=3 QUALITY=low DURATION_MS=10000 BENCH_TAG=hidpi-phone npx tsx scripts/phaser-benchmark.ts
```

| Browser / profile | Backing   | Samples | Frame p95 / p99 / max (ms) | Render CPU p95 (ms) |
| ----------------- | --------- | ------: | -------------------------: | ------------------: |
| Chrome / desktop  | 3200×1800 |     541 |         16.8 / 16.8 / 16.8 |                 5.4 |
| Webkit / desktop  | 3200×1800 |     540 |         18.0 / 18.0 / 19.0 |                 5.0 |
| Chrome / phone    | 2080×1170 |     541 |         16.8 / 16.8 / 16.8 |                 5.1 |
| Webkit / phone    | 2080×1170 |     541 |         17.0 / 18.0 / 20.0 |                 4.0 |

All four runs reported no page errors and bounded active particle counts. Raw reports: [Chrome desktop](../performance/smooth-trails/hidpi-desktop-chrome.json), [WebKit desktop](../performance/smooth-trails/hidpi-desktop-webkit.json), [Chrome phone viewport](../performance/smooth-trails/hidpi-phone-chrome.json), [WebKit phone viewport](../performance/smooth-trails/hidpi-phone-webkit.json). These contain base revision, actual source hashes, dimensions and every sample. Desktop Phaser renders four times the pixels of the old fixed backing; phone DPR 3 renders 2080×1170. These short measurements do not establish sustained physical-device performance.

Chrome renderer regression checks passed at DPR 1, 2 and 3; WebKit passed at DPR 2. Both WebGL and Phaser Canvas backends passed resize landmark checks, and forced context loss recovered to the display-aware legacy Canvas fallback. The high-DPI desktop Chrome and phone-sized WebKit screenshots were visually inspected.

Final local typecheck/build and all 445 unit tests passed. The mobile home/menu suite passed Chrome and WebKit at 320×568, 390×844 and 844×390, including rapid navigation during preload. The landscape suite's first Chrome run timed out on the portrait Main Menu button after closing the avatar dialog; the same step had an intermittent timeout before DPI work. The unchanged retry passed both browsers. Both failure logs remain operator-local; the timeout has not been diagnosed or fixed by this rendering change.

The first two LAN Chrome runs timed out waiting for Final Round. A diagnostic run found authority at match-over (tick 384, pause ending at 443) while the display still showed round-three countdown, with no page errors. The test had advanced multiple rounds synchronously without yielding for socket delivery; the server intentionally discards snapshots above its bounded send queue. The harness now observes actual host WebSocket snapshot frames and waits for delivery between two-tick batches during round completion. It retains every gameplay, Final Round and recap assertion, adding an explicit delivery assertion instead of extending timeouts. The corrected full LAN smoke passed Chrome and WebKit. Original failures and the diagnostic remain in `artifacts/hidpi-lan-{chrome,chrome-retry,diagnostic}.log`; successful runs are `artifacts/hidpi-lan-delivered-{chrome,webkit}.log`. No LAN server, protocol or simulation behavior changed.

## Subsequent border cleanup

At the user's request, the decorative purple block wall, corner ornaments, wide rim glow and outer CSS frame were removed after the measurements above. Phaser and the original Canvas renderer now use a thin, subdued boundary line and outside shading. Collision boundaries and clipping are unchanged. The recorded benchmark hashes identify the earlier border styling; this cosmetic follow-up was checked with the build and Chrome/WebKit renderer checks, not re-benchmarked.

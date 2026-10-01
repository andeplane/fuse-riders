# Adaptive building raster verification

Game source `a63e84f2`; world rules 9 and AI policy 5 are unchanged. The renderer
keeps original art and caches at most four smaller variants for each of nine
building images. Projected SVG scale and device pixel ratio select the tier;
close views fall back to the original. Loading/failure keeps the existing art.
Alpha, team hue filters, cast shadows and simulation geometry are preserved.

`pnpm exec tsx scripts/fuse-craft-frame-profile.ts /tmp/fuse-raster-profile`
ran the ordinary menu → Watch → Close Quarters, Pressure versus Balanced →
Find battle flow, sequentially in headless Chromium and WebKit. Both new samples
cover game clock 0:51–1:11 and finish with 12 structures. Source guards passed.
Raw callback intervals and real-flow screenshots accompany this report.

| Browser  | Baseline median / p95 | Adaptive median / p95 | Adaptive >50 ms |
| -------- | --------------------- | --------------------- | --------------- |
| Chromium | 16.7 / 16.7 ms        | 16.7 / 16.7 ms        | 0               |
| WebKit   | 100 / 152 ms          | 17 / 27 ms            | 0               |

Baseline: [prior retained profile](../frame-profile-2026-09-27/README.md).
Both new runs report zero page errors. Chromium has 1,201 callbacks in 20.016
seconds; WebKit has 1,224 in 20.015 seconds. These are browser callback timestamps,
not a physical display FPS measurement. The host is not an isolated performance
lab; a small tooling check ran during the WebKit session. This is strong evidence
of improvement in this workload, not a universal timing guarantee.

All 1,806 repository tests, typecheck, focused lint and build passed. Cache tests
cover DPR/zoom tiers, immutable inputs, request deduplication, fallback and bounded
failure behavior. Independent review found no blocking issue. Its minor edge is
retained explicitly: once a world stops publishing after match completion,
camera-only zoom could retain a previous raster tier until another UI render.
That edge is now fixed on `180251c2`; see the [frozen-world regression](../raster-refresh-2026-09-27/README.md).

`pnpm exec tsx scripts/fuse-craft-raster-smoke.ts /tmp/fuse-raster-smoke`
also passes the ordinary WebKit Watch flow at DPR 2: normal scale uses a cached
raster, wheel zoom to scale 8 restores the original, and zooming out reuses the
cache. The real browser canvas/decode path produces no page errors. Retained
normal/close screenshots were visually inspected. The initial smoke selected a
depth-sorted terrain image instead of building art; narrowing its selector to
`.building-art image` corrected that test harness error.

The game still needs human visual/play-feel acceptance. This renderer remains
sprite/SVG based. No physical-phone, production deployment or AAA-quality claim
is implied by this improvement.

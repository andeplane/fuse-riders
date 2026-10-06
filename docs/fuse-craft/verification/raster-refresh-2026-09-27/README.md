# Raster refresh without new world frames

Source `180251c2`. The renderer now resolves camera scale/DPR and asynchronously
ready art on its existing animation callback. Stable cache-map identities avoid
DOM scans between changes. Updating image sources preserves animated groups,
their phase and the authoritative world. Four tiers × nine sources remain the
maximum cache population.

The diagnostic regression runs in real Chromium and WebKit at DPR 2. It renders
one frozen attract-scene world exactly once, then changes viewBox and invokes
only the returned animation handle on browser frame callbacks. Both engines
confirm all of the following:

- Async raster readiness becomes visible without another world render.
- Close zoom selects original artwork.
- A newly requested resolution becomes visible after decoding.
- Zooming back restores the already cached tier.
- The world JSON is unchanged and original group/image elements are retained.
- No page errors occur.

This isolates the stopped-world condition behind the completed-match bug. It is
a renderer fixture, not a second human victory playtest. Earlier ordinary live
Watch/DPR-2 zoom evidence remains in [adaptive raster verification](../adaptive-raster-2026-09-27/README.md).

```sh
pnpm exec tsx scripts/fuse-craft-raster-refresh-smoke.ts /tmp/fuse-raster-refresh
```

All 1,807 repository tests, typecheck, focused lint and build pass. Independent
review found no blocking issue. Static menu artwork still renders once and does
not animate its lazy raster completion; it retains original artwork until the
next menu render, with no missing image. The live/result battlefield owns the
existing animation callback and is covered by this fix.

The live battle profiler was rerun on this source, sequentially with no other
browser run. Its DPR-1 sample still spans game clock 0:51–1:11 and finishes with
12 structures. Chromium median/p95 is 16.7/16.8 ms; WebKit is 17/27 ms. Neither
has a callback interval over 50 ms or a page error. Raw intervals are retained
as `live-chromium.json` and `live-webkit.json`. These remain headless callback
measurements, not physical-display FPS claims.

## Remaining high-density performance issue

The additional DPR-2 desktop profile on the same game source and battle window
is substantially slower: median 71 ms, p95 79 ms, 282 intervals over 50 ms in
20.042 seconds. Zero page errors; final state again has 12 structures.
`live-webkit-dpr2.json` retains every interval. Thus normal-density improvement
does **not** establish smooth high-density animation. Remaining filter/raster
cost needs investigation; the goal stays open on this concrete issue.

```sh
pnpm exec tsx scripts/fuse-craft-frame-profile.ts /tmp/fuse-raster-retina-profile 2 webkit
```

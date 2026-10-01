# Cached team tints and cast shadows

Source `ae19b481`; engine rules and AI are unchanged. The browser adapter renders
the existing native SVG sRGB hue/shadow matrix into cached PNGs. The board removes
its live filter only when the corresponding painted image is ready. Pending or
failed paints keep the native filter, and close zoom restores original artwork
and its filter. Construction and wreck art share this path.

The cache has four size tiers, nine original sources, and at most six variants
per source/tier (base, four teams, shadow). Only teams requested by the current
world are painted. Base rasters and original image loads are shared. The placement
preview can retain its native filter; it is a single-image exception.

## Evidence

The new DPR-2 live battle profile spans 0:51–1:11 on the same workload: median
21 ms, p95 47 ms, 898 callbacks in 20.032 seconds (44.83/s), and 15 intervals
over 50 ms. The preceding source measured 71/79 ms and 14.47 callbacks/s.
Zero page errors. This is substantial improvement but retains occasional long
frames; it is not a claim of locked 60 FPS. The battle screenshot and every raw
interval are retained as `battle-webkit-dpr2.png` and `live-webkit-dpr2.json`.

The preceding DPR-2 diagnostic on source `180251c2` measured median/p95 76/80 ms
in its baseline window, 20/37 ms with only building filters temporarily disabled,
18/39 ms with all board filters disabled, and 78/85 ms after restoration. These
eight-second live windows have different game times/structure counts; they
isolate the bottleneck rather than establish an exact same-state ratio. The
diagnostic does not alter world state or clocks. Raw intervals are retained.

The new tint smoke runs ordinary Watch entry in Chromium and WebKit at DPR 2,
then checks actual browser-decoded raster pixels. Both preserve alpha exactly,
produce changed team colors, and produce black shadow RGB. No page errors occur.
This does not prove pixel-identical hue output to an independently captured native
reference; the implementation uses the same hue values and native SVG operation,
and real-flow screenshots were inspected.

The existing normal/close/zoom-out smoke and the frozen-world refresh regression
also pass with the new adapter. All 1,808 repository tests, typecheck, focused
lint and build pass. Independent review found no blocking issue; its exact-hue
evidence limitation and placement-preview exception are recorded above.

```sh
pnpm exec tsx scripts/fuse-craft-tint-smoke.ts /tmp/fuse-tint-smoke
pnpm exec tsx scripts/fuse-craft-raster-smoke.ts /tmp/fuse-tint-zoom
pnpm exec tsx scripts/fuse-craft-raster-refresh-smoke.ts /tmp/fuse-tint-frozen
```

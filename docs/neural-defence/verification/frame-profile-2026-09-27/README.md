# Animation cadence investigation

Game source `722c9782`, Apple M4 Max, Node 22.20.0, headless Playwright browsers,
1280×800. Ordinary Close Quarters Watch AI vs AI, Pressure versus Balanced,
normal clock. Browsers ran sequentially. The 20-second samples began after live
combat appeared and ended at game time 1:11. No page errors occurred.

| Browser                | Callbacks/s | Median interval |     p95 | Intervals over 25 ms |
| ---------------------- | ----------: | --------------: | ------: | -------------------: |
| Chromium 153.0.8010.12 |        60.0 |         16.7 ms | 16.7 ms |             0 / 1201 |
| WebKit 26.6            |        10.5 |          100 ms |  152 ms |            210 / 210 |

A separate static-page WebKit control produced 300 callbacks in five seconds,
median 17 ms, p95 18 ms, with none over 25 ms. This shows that the game scene,
rather than a blanket headless callback throttle, needs investigation.

These measure **rAF callback cadence**, not physical display FPS. The sample is
an early battle with roughly 12 structures, not a maximum-size battle or a
physical phone. Other host activity is not controlled. Screenshots and earlier
browser-flow checks do not establish animation smoothness.

## Diagnostic isolation

Each diagnostic runs a normal live battle, changes only temporary presentation
in that test browser, then restores it. World state and clocks are untouched.
Eight-second windows observe different live game times, so this is causal
triage rather than an exact same-state performance ratio. Raw intervals, clocks
and structure counts are retained in the accompanying JSON files.

- All filters disabled: median falls from 82 to 62 ms; restored, 109 ms.
- HUD blur disabled: 98 ms; ground layer hidden: 111 ms. Neither explains the
  main cost. All SVG images hidden: 16 ms; restored, 122 ms.
- Particle images hidden: 77 ms versus baseline 79 ms. Building/shadow images
  hidden: 17 ms; restored, 135 ms.
- Building/shadow images temporarily resampled through Canvas to a maximum
  256-pixel side, retaining alpha and colors: median 27 ms versus baseline
  96 ms; restored, 212 ms. The resized screenshot was visually inspected.

The last experiment remains diagnostic, not a shipped optimization. Original
building images are roughly 1,000–1,500 pixels per side despite much smaller
normal display sizes. The next implementation must choose an appropriate cached
raster size for zoom and device pixel ratio, preserve sharp close inspection,
and recheck both team colors and shadows. Resampling alone has not yet shown
60-callback cadence in WebKit.

The retained initial JSON captures predate the profiler's new automatic
start/end revision guard and start-clock field. Git state was checked before and
after these probes and the game source remained `722c9782`; no game files changed.
The checked-in profiler now records headless mode, the start clock, and refuses
revision or tracked game-source drift during measurement.

Reproduce the normal-flow measurement:

```sh
pnpm exec tsx scripts/fuse-craft-frame-profile.ts /tmp/fuse-frame-profile
```

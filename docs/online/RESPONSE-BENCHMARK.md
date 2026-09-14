# Actual heading response benchmark

Design reviewed and approved independently by root before implementation, 2026-09-14. Run only against an isolated authorized fixture with a build containing `responseBenchmark=1` diagnostics:

```sh
ONLINE_URL=http://localhost:8787/ BENCH_SECONDS=60 npx tsx scripts/benchmark-response.ts
```

The script creates a room with all powerups disabled, a hidden host renderer, a visible phone-sized guest (390×844) and visible TV (1280×720). Real trusted pointer events press alternating turn buttons. Every attempted press is retained, including dead-player/round-transition attempts and timeouts. A valid sample requires at least 150 ms of stable pre-press heading in each view, an alive unaffected actor, identical render scope, and heading departure in the commanded direction. Hook data is emitted only after a ready Phaser renderer receives and draws the snapshot. No physics, networking rate or interpolation settings change.

The primary timestamp is the first submitted heading departure of at least 0.0001 radians, not merely the next animation frame. A secondary distribution measures at least one degree; that is not an alternative passing threshold or proof of human perception. Cross-context timestamps use performance.timeOrigin plus event/frame time in Chromium on the same computer. These are CPU render-submission measurements, not physical touch-to-photon or phone hardware evidence.

The raw artifact `artifacts/response-benchmark.json` includes all attempted pointers, baseline/response frame windows, rejected reasons/timeouts, source revision and served entry asset hashes. At least ten valid samples per view are needed, and any eligible timeout fails the run even if the successful samples are fast. Insufficient valid observations are harness insufficiency, not a product pass. Proposed nearby candidate thresholds are p95 ≤33 ms local and ≤100 ms TV. Failure or insufficient observations remain failure, without deleting rejected attempts or changing thresholds. The current 10 Hz publication and two-tick remote buffer may fail the TV target; this benchmark intentionally does not alter those mechanisms.

Browser runs must be serialized with existing soak/GPU benchmarks. Implementation unit tests/typecheck are distinct from an actual completed response run.

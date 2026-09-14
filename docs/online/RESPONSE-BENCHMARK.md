# Actual heading response benchmark

Design reviewed and approved independently by root before implementation, 2026-09-14. Run only against an isolated authorized fixture with a build containing `responseBenchmark=1` diagnostics:

```sh
ONLINE_URL=http://localhost:8787/ BENCH_SECONDS=60 npx tsx scripts/benchmark-response.ts
```

The script creates a room with all powerups disabled, a hidden host renderer, a visible phone-sized guest (390×844) and visible TV (1280×720). Real trusted pointer events press alternating turn buttons. Every attempted press is retained, including dead-player/round-transition attempts and timeouts. A valid sample requires at least 150 ms of stable pre-press heading in each view, an alive unaffected actor, identical render scope, and heading departure in the commanded direction. Hook data is emitted only after a ready Phaser renderer receives and draws the snapshot. No physics, networking rate or interpolation settings change.

The primary timestamp is the first submitted heading departure of at least 0.0001 radians, not merely the next animation frame. A secondary distribution measures at least one degree; that is not an alternative passing threshold or proof of human perception. Cross-context timestamps use performance.timeOrigin plus event/frame time in Chromium on the same computer. These are CPU render-submission measurements, not physical touch-to-photon or phone hardware evidence.

The raw artifact `artifacts/response-benchmark.json` includes all attempted pointers, baseline/response frame windows, rejected reasons/timeouts, source revision and served entry asset hashes. At least ten valid samples per view are needed, and any eligible timeout fails the run even if the successful samples are fast. Insufficient valid observations are harness insufficiency, not a product pass. Proposed nearby candidate thresholds are p95 ≤33 ms local and ≤100 ms TV. Failure or insufficient observations remain failure, without deleting rejected attempts or changing thresholds. The current 10 Hz publication and two-tick remote buffer may fail the TV target; this benchmark intentionally does not alter those mechanisms.

Browser runs must be serialized with existing soak/GPU benchmarks. Implementation unit tests/typecheck are distinct from an actual completed response run.

## First actual run: TV target failed

Completed 2026-09-14 01:03:48 UTC against local fixture8794, source `d715642ebd4d0cc63c5e5639a0adee6c3f4ab05d`, 60seconds. [Raw frames and all attempts](evidence/response-d715642.json) preserve the failure. Served entrySHA256 `7db7166bbe989711bfdecd8cc23b7ce1e5305be66cabbad1f633574d6dd1b781`; both visible renderers were PhaserWebGL, hostcanvas hidden/uninitialized. No browser errors or truncated frame captures.

| View | Eligible samples | Rejected attempts | Timeouts | First departure p50 / p95 | One degree p95 | Candidate result |
| --- | ---: | ---: | ---: | --- | ---: | --- |
| Local controller |17|21|0|24.9 /28.0ms|28.0ms|PASS ≤33ms |
| TV |17|21|0|115.3 /162.5ms|174.6ms|FAIL ≤100ms |

All38attempts remain in the artifact. Rejections were confounded or already-turning baselines, principally normal round/death lifecycle. The TV result is a real measured response gap under the candidate nearby threshold, not a physical-phone measurement. Current10Hz publication plus the two-tick remote interpolation buffer is a plausible mechanism; a rate/buffer adjustment needs an independent review and new response/bandwidth evidence. This run changed no networking or simulation behavior.

## Reviewed20Hz / qualified-buffer trial: target still failed

The first ADR037 implementation `e1dcc6f` was measured with the same60second workload and every startup/round trial retained. [Complete raw evidence](evidence/response-e1dcc6f.json) contains38attempts,18validperview,20confounded/rejectedperview,0timeouts and0browsererrors. Local first-departure p95was29.9ms; TVp50was117.5ms andp95was159.1ms, still above100ms. Secondaryone-degreep95was54.4mslocal and159.1msTV. This is insufficient improvement; the target remains failed. The response artifact does not record the qualifying clock samples, so it cannot establish whether the nearby-delay policy activated for individual attempts. Further diagnostics must resolve that before further tuning.

The follow-up diagnostic capture adds the exact selected delay to every submitted response frame, plus read-only validated clock RTT, sample age, control scope and nearby qualification count. Bounded raw clock observations also retain whether observation was accepted. Reading these fields cannot qualify/refresh the clock. This instrumentation changes no buffer threshold or simulation/network timing policy.

## Diagnostic result: nearby policy never qualified

The60second `e473a10` diagnostic run (2026-09-14 01:20:47UTC) retained38attempts:18validperview,20confounded,0timeouts,0browsererrors. [Complete raw frames and clock observations](evidence/response-e473a10.json) show localp95=29.5ms andTVp95=161.8ms, stillFAIL. Every eligible TVbaseline and changed frame useddelay2 withnearbycount0. The57accepted TVclockprobes measuredRTT23.3–33.2ms; guest60accepted probes measured23.4–48.2ms. No guest/TVprobe met20ms. HostRTT0qualified normally. This establishes why the faster nearby buffer did not activate on the same-machine fixture; it does not justify changing the gate without a reviewed amendment and fresh stability/response evidence. The diagnostic rawJSON is compacted without deleting samples.

##40ms qualification trial: improved, still above target

The02a982f run completed01:27:11UTC with38attempts,18valid,20confounded,0timeouts/errors. [Full evidence](evidence/response-02a982f.json) shows localp95=25.8ms andTVp50=87.8ms/p95=136.6ms. FourTVtrials remaineddelay2 duringqualification (112.9–136.6ms);13alreadyqualifieddelay1trials ranged60.5–114.7ms, including two above100ms; one2→1transition measured90.2ms. Those two qualified tails show continuously advancing rendered ticks, not a frozen buffer. Startup qualification explains the worst cases, but reducing startup alone cannot meet the unchanged target. No trial was excluded to improve the result.

# Actual heading response benchmark

> **Status (2026-09-15): historical.** `scripts/benchmark-response.ts` and the `responseBenchmark=1` diagnostics were removed with the host-star runtime; `scripts/p2p-measure.ts` now reports input-to-state latencies for the peer-to-peer runtime.

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

| View             | Eligible samples | Rejected attempts | Timeouts | First departure p50 / p95 | One degree p95 | Candidate result |
| ---------------- | ---------------: | ----------------: | -------: | ------------------------- | -------------: | ---------------- |
| Local controller |               17 |                21 |        0 | 24.9 /28.0ms              |         28.0ms | PASS ≤33ms       |
| TV               |               17 |                21 |        0 | 115.3 /162.5ms            |        174.6ms | FAIL ≤100ms      |

All38attempts remain in the artifact. Rejections were confounded or already-turning baselines, principally normal round/death lifecycle. The TV result is a real measured response gap under the candidate nearby threshold, not a physical-phone measurement. Current10Hz publication plus the two-tick remote interpolation buffer is a plausible mechanism; a rate/buffer adjustment needs an independent review and new response/bandwidth evidence. This run changed no networking or simulation behavior.

## Reviewed20Hz / qualified-buffer trial: target still failed

The first ADR037 implementation `e1dcc6f` was measured with the same60second workload and every startup/round trial retained. [Complete raw evidence](evidence/response-e1dcc6f.json) contains38attempts,18validperview,20confounded/rejectedperview,0timeouts and0browsererrors. Local first-departure p95was29.9ms; TVp50was117.5ms andp95was159.1ms, still above100ms. Secondaryone-degreep95was54.4mslocal and159.1msTV. This is insufficient improvement; the target remains failed. The response artifact does not record the qualifying clock samples, so it cannot establish whether the nearby-delay policy activated for individual attempts. Further diagnostics must resolve that before further tuning.

The follow-up diagnostic capture adds the exact selected delay to every submitted response frame, plus read-only validated clock RTT, sample age, control scope and nearby qualification count. Bounded raw clock observations also retain whether observation was accepted. Reading these fields cannot qualify/refresh the clock. This instrumentation changes no buffer threshold or simulation/network timing policy.

## Diagnostic result: nearby policy never qualified

The60second `e473a10` diagnostic run (2026-09-14 01:20:47UTC) retained38attempts:18validperview,20confounded,0timeouts,0browsererrors. [Complete raw frames and clock observations](evidence/response-e473a10.json) show localp95=29.5ms andTVp95=161.8ms, stillFAIL. Every eligible TVbaseline and changed frame useddelay2 withnearbycount0. The57accepted TVclockprobes measuredRTT23.3–33.2ms; guest60accepted probes measured23.4–48.2ms. No guest/TVprobe met20ms. HostRTT0qualified normally. This establishes why the faster nearby buffer did not activate on the same-machine fixture; it does not justify changing the gate without a reviewed amendment and fresh stability/response evidence. The diagnostic rawJSON is compacted without deleting samples.

##40ms qualification trial: improved, still above target

The02a982f run completed01:27:11UTC with38attempts,18valid,20confounded,0timeouts/errors. [Full evidence](evidence/response-02a982f.json) shows localp95=25.8ms andTVp50=87.8ms/p95=136.6ms. FourTVtrials remaineddelay2 duringqualification (112.9–136.6ms);13alreadyqualifieddelay1trials ranged60.5–114.7ms, including two above100ms; one2→1transition measured90.2ms. Those two qualified tails show continuously advancing rendered ticks, not a frozen buffer. Startup qualification explains the worst cases, but reducing startup alone cannot meet the unchanged target. No trial was excluded to improve the result.

## 25 ms presentation experiment: TV passed; overall run still failed

The f2e6d4e experiment completed at 2026-09-14 01:36:42 UTC. [All frames, clock observations and attempts](evidence/response-f2e6d4e.json) are retained. There were 38 attempts, 18 valid per view, 20 confounded per view, zero timeouts, zero browser errors and no truncated captures.

TV first-departure and one-degree p95 were **91.6 ms**, below the unchanged 100 ms candidate; median was 63.5 ms. Local first-departure p95 was **34.1 ms**, narrowly above the unchanged 33 ms candidate, so the overall artifact correctly remains **FAIL**. Local one-degree p95 was 52.3 ms.

The full TV render stream had 1,203 eligible intervals: 2.99% repeated the previous presented tick, observed hold-span p95 was 48.3 ms and maximum 49.3 ms. Frame interval p95 was 27.5 ms; no eligible gap exceeded 100 ms. These are presentation continuity proxies, not physical scanout or a guarantee of perceived smoothness.

The fair historical comparison uses fixed 200 ms pre-pointer windows, because the earlier artifact did not retain full-run frames. Both versions had zero repeated ticks in those limited windows; TV frame interval p95 was 28.8 ms before and 27.6 ms after. This comparison cannot establish that full-run hold frequency is unchanged. The new full-stream hold results and narrower latency improvement need an explicit product tradeoff review; a TV percentile pass alone is not an overall acceptance pass.

The sole local sample above33ms was independently inspected: pointer epoch1789349799801.9, preceding submitted frame at1789349799801.5999, and the very first following frame at1789349799836.0 already showed a changed heading (2.72159→2.78263 radians). The34.4ms frame interval yielded34.1ms input-to-heading latency; there was no unchanged post-input frame or extra prediction tick. This rules out delayed prediction in that sample, while preserving the measured candidate failure. With18validsamples, nearest-rankp95 equals the maximum, so a predeclared larger repeatability sample can estimate tail frequency without changing code or discarding the failed trial.

A single unchanged180second follow-up was predeclared and independently approved after inspection of the34.4ms scheduling gap. It requires at least50eligible samples per view, keeps33/100ms limits and every timeout, and must also report the combined eligible samples from the original60seconds plus180seconds. The original failure remains. This is a fixed tail-estimation step, not repeat-until-pass. The bounded clock-observation capacity is8000 for the longer run; captured render frames remain capped at12000 per view with truncation treated as failure.

## Fixed repeatability batch: response candidates passed

The single predeclared 180-second follow-up completed at **2026-09-14 01:42:13 UTC**. The served game bundle was identical to the earlier 60-second experiment: `/assets/index-BGM4abos.js`, SHA256 `96ce4dbc70c4d2baf1257ef57f2f1773489e07d87348c6caec2a0719b6538809`. The script/document revision was `c3bb4cb`; no game behavior changed between runs. [Complete 180-second raw capture](evidence/response-c3bb4cb-180s.json) and [fixed-batch summary](evidence/response-fixed-batch-summary.json) retain all observations.

| Dataset                                          | Valid / rejected / timeouts per view | Local p50 / p95 / p99 | TV p50 / p95 / p99    | Unchanged candidate result |
| ------------------------------------------------ | ------------------------------------ | --------------------- | --------------------- | -------------------------- |
| Predeclared 180 seconds                          | 51 / 62 / 0                          | 24.7 / 27.6 / 28.3 ms | 62.8 / 88.2 / 94.7 ms | PASS                       |
| Combined 240 seconds, including original failure | 69 / 82 / 0                          | 24.9 / 27.6 / 34.1 ms | 63.5 / 88.2 / 94.7 ms | PASS                       |

The local 34.1 ms maximum remains in the combined data; it was not discarded. Both views exceed the predeclared 50-valid-sample minimum. There were zero browser errors, eligible timeouts or truncated captures. The secondary one-degree p95 across the combined batch was 51.8 ms local and 88.2 ms TV; the primary criterion remains first numerical departure, with that distinction explicit.

Full TV continuity over the 180-second capture included 3,431 eligible frame intervals. Repeated presented ticks accounted for 3.41% of intervals (3.35% of observed time). Observed hold spans had p95 34.0 ms and maximum 51.2 ms. Frame interval p95 was 28.2 ms and maximum 45.4 ms; no eligible gap exceeded 100 ms. These establish the measured presentation tradeoff on this desktop fixture, not physical phone/scanout performance. The earlier 60-second failure and all unsuccessful tuning trials remain above. No further repeat-until-pass trials were performed.

# ADR 037 independent design review

2026-09-14. Reviewer: network/security subagent, independent of the implementation author. Scope: [ADR 037](../adr/037-nearby-render-response.md), current `PredictionClock`, `RemoteWorldBuffer`, UI clock wiring and runtime publication schedule. No browser tests were run for this review.

**Design approved for implementation; implementation and performance acceptance remain pending.**

The proposed two-level delay uses the correct clock boundary: accepted, scoped host tick probes rather than signalling-service RTT or replication arrival timing. Three consecutive low-RTT samples qualify the shorter delay; high RTT, scope changes, pause, discontinuity and freshness expiry restore the conservative setting. This bounds stale nearby classification without changing physics or authorizing predicted outcomes.

The buffer retains available-snapshot clamping and monotonic presentation. Switching back to the deeper buffer may briefly hold presentation, but cannot rewind or invent motion. Unknown-clock behavior remains newest-available fallback, explicitly not a measured 100 ms delay. Existing portal, death and discrete-state interpolation boundaries must remain covered by tests.

Publishing every completed 50 ms authoritative tick removes the additional alternating-tick wait while retaining fixed 20 Hz simulation, keyframe receipt/retry behavior and one-second checkpoint cadence. It increases envelope/encoding traffic, so existing low traffic measurements cannot stand in for the new artifact. The ADR's traffic wording should explicitly apply the proposed 0.5 Mbps average / 1 Mbps p95 budget to each full-view downlink and report host aggregate separately.

Before release, inspect the typed clock/scope/freshness and monotonic-buffer regressions plus publication scheduling/checkpoint cadence tests. Then preserve exact-artifact response and regional results with all rejected/confounded attempts, per-view delivered payload windows and host aggregate. The previous TV response failure remains evidence; no target or sample-count reduction is authorized by this review. Physical touch-to-photon, wire overhead and real packet-loss evidence remain outside this design approval.

## Implementation follow-up

The implementation diff was independently approved after a concrete clock-discontinuity regression was fixed. `observe()` previously could overwrite its last-read timestamp before noticing a backwards clock jump; it now resets qualification first while retaining the previous sample timestamp for duplicate rejection. Excessive finite RTT also exits nearby qualification even when too large for a usable clock sample. Eighteen focused prediction/buffer tests passed in the reviewer's completed run.

The remaining reviewed changes are scoped: every authoritative tick publishes, the buffer accepts a bounded one/two-tick delay and preserves monotonic newest-available clamping, and UI uses the clock's qualified delay. No physics, authority or collision changes were introduced. Initial nearby qualification still requires three samples and therefore may leave early actions on the conservative delay. Actual response trials must retain those eligible initial actions rather than filter them into a passing result. Full validation and exact-artifact response/regional traffic measurements remain required; this approval is not a measured latency pass.

## Measured 40 ms eligibility correction

The diagnostic artifact `response-e473a10.json` preserves a failed TV p95 of 161.8 ms while local p95 was 29.5 ms. The author's probe analysis found the TV's accepted RTTs between 23.3 and 33.2 ms, so the initial 20 ms eligibility threshold never selected the shorter delay. Calibrating eligibility to 40 ms is approved; the unchanged 100 ms TV benchmark remains the acceptance target.

Independent implementation review confirmed exactly two production threshold changes, with all scope, three-sample qualification, freshness, discontinuity, conservative exit and no-extrapolation rules retained. Eight focused tests passed, including exactly 40 ms qualifying, 40.001 ms exiting and 60 ms regional samples remaining conservative. Asymmetric or jittery paths can still hold at the newest available snapshot; this parameter is measured host-probe RTT, not geographic distance or a guarantee of smoothness.

This presentation-only adjustment does not reduce the already measured 20 Hz traffic or poor-profile correction tails. Those findings remain open limitations. Actual response and regional validation on the changed artifact must be recorded before claiming the TV latency target passed.

## Half-tick presentation experiment review

Root and the independent reviewer approved a bounded experiment using one fresh validated nearby sample and a 25 ms (half-tick) presentation delay. This is an experimental response/smoothness tradeoff, not release qualification: with 20 Hz authoritative updates, shorter buffering may clamp at the newest state and create visible holds even when first response improves. Scope, freshness, high-RTT exit, monotonic presentation and no-extrapolation constraints remain unchanged. The 100 ms TV target is not relaxed.

Review caught a measurement bias before the run: successful heading-response windows end at the first change, so comparing continuity from those windows would shorten the observed window as response improved. The corrected primary metric uses full captured render frames. Historical comparison uses the same fixed 200 ms pre-pointer windows in both artifacts, with coverage limitations explicit. Gaps above 100 ms are counted separately with distributions rather than silently discarded as gaps between attempts. Full raw frames are retained. Fifteen focused tests passed independently, including the reported-gap regression.

Implementation is approved for the bounded experiment. Interpret repeated rendered ticks as a TV presentation-continuity proxy, not physical scanout or necessarily local predicted-pose continuity. Evaluate actual response and hold distributions together before deciding whether the parameter is a product improvement.

## Experimental result interpretation

The reviewer inspected the completed `f2e6d4e` artifact: 18 eligible observations per view, 20 confounded attempts, no eligible timeouts. TV p95 was **91.6 ms**, meeting the unchanged target; local p95 was **34.1 ms**, failing 33 ms. The overall report remains failed.

TV continuity is encouraging but not definitive: full-stream repeated-tick ratio was 2.99%, hold-span p95 48.3 ms and maximum 49.3 ms, with no excluded gaps above 100 ms. Identically sampled pre-input windows had no repeated ticks in either version. The prior artifact lacks full-stream frames, so this does not prove unchanged overall smoothness. The frame p95 of 27.5 ms also describes this two-renderer headless workload, not 60 Hz physical-device qualification.

The worst local observation was a next-frame wait: pointer epoch 1789349799801.9 ms followed a submitted render at 1789349799801.6 ms; the next render at 1789349799836.0 ms already showed the changed heading. The 34.4 ms render interval accounts for the 34.1 ms response; no additional input/authority-tick stall is demonstrated by that sample. Arbitrarily retuning prediction is therefore not supported. With only 18 eligible samples, nearest-rank p95 is the maximum. One predeclared longer unchanged run, retaining at least 50 eligible observations and all rejected/failed attempts, is a reasonable statistical follow-up; repeated retries until a passing number is obtained are not. Preserve this failed artifact regardless of the follow-up outcome.

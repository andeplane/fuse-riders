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

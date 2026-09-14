# ADR 037 independent design review

2026-09-14. Reviewer: network/security subagent, independent of the implementation author. Scope: [ADR 037](../adr/037-nearby-render-response.md), current `PredictionClock`, `RemoteWorldBuffer`, UI clock wiring and runtime publication schedule. No browser tests were run for this review.

**Design approved for implementation; implementation and performance acceptance remain pending.**

The proposed two-level delay uses the correct clock boundary: accepted, scoped host tick probes rather than signalling-service RTT or replication arrival timing. Three consecutive low-RTT samples qualify the shorter delay; high RTT, scope changes, pause, discontinuity and freshness expiry restore the conservative setting. This bounds stale nearby classification without changing physics or authorizing predicted outcomes.

The buffer retains available-snapshot clamping and monotonic presentation. Switching back to the deeper buffer may briefly hold presentation, but cannot rewind or invent motion. Unknown-clock behavior remains newest-available fallback, explicitly not a measured 100 ms delay. Existing portal, death and discrete-state interpolation boundaries must remain covered by tests.

Publishing every completed 50 ms authoritative tick removes the additional alternating-tick wait while retaining fixed 20 Hz simulation, keyframe receipt/retry behavior and one-second checkpoint cadence. It increases envelope/encoding traffic, so existing low traffic measurements cannot stand in for the new artifact. The ADR's traffic wording should explicitly apply the proposed 0.5 Mbps average / 1 Mbps p95 budget to each full-view downlink and report host aggregate separately.

Before release, inspect the typed clock/scope/freshness and monotonic-buffer regressions plus publication scheduling/checkpoint cadence tests. Then preserve exact-artifact response and regional results with all rejected/confounded attempts, per-view delivered payload windows and host aggregate. The previous TV response failure remains evidence; no target or sample-count reduction is authorized by this review. Physical touch-to-photon, wire overhead and real packet-loss evidence remain outside this design approval.

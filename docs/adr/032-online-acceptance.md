# ADR 032: Network and release acceptance

> **Superseded (2026-09-15).** The host-star snapshot protocol this decision describes was replaced by the peer-to-peer input log; see [docs/online/P2P-INPUT-LOG-BRIEF.md](../online/P2P-INPUT-LOG-BRIEF.md).

Date: 2026-09-14. Status: **proposed measurable gates, only partially evidenced; not blanket release acceptance**.

Read [ADR 035](035-direct-gameplay-only.md) for the accepted direct-only policy and its reviewed recovery amendments, and [ADR 034](034-gcp-pages-deployment.md) for the current GCP/Pages deployment. These supersede the historical fallback/relay requirements below: game traffic has no WSS/Pub/Sub fallback, so direct unavailability must fail visibly and recover on a working direct path. The post-outage two-second world-recovery check remains in the browser harness. This supersession does not waive responsiveness, consistency, bounded resources or poor-network measurement.

The numeric budgets below remain proposals; neither this status note nor deployment promotes them all to accepted/passed gates. Consult the [completion audit](../reviews/online-completion-audit.md) and [recorded network evidence](../online/NETWORK-EVIDENCE-2026-09-14.md) for completed checks, failures and unverified physical-device/real-network requirements. Historical alternatives remain below for traceability.

## Decision

Separate deterministic protocol correctness, browser performance, real network impairment, and physical phone/WAN evidence. Store seeds, revision, environment, raw samples and summaries. A successful next animation frame is not proof of changed movement; attempted JSON bytes are not wire bandwidth. Existing short two-player send-delay runs are exploratory baselines only.

| Gate | Required evidence |
| --- | --- |
| Local response | Actual control change to first changed predicted pose p95 <=33 ms at 60 Hz; omit heartbeat-only samples |
| Rendering | Five active riders plus TV; p95 frame duration <=20 ms on declared iPhone/Android targets; report p99, long frames and resolution |
| Prediction | Same-world fixed-tick replay within 1e-6 units; correction p95 <=one rider radius at 80 ms RTT; report p99/max/frequency and unknown-obstacle cases separately |
| Traffic | Aim <=0.25 Mbps average per full view, hard release gate <=0.5 Mbps average /1 Mbps p95 one-second windows in sustained stress; include wire overhead separately from payload and host total |
| Direct recovery | Direct blackhole to working fallback <=750 ms; after three-second outage recovery <=2 seconds after connectivity returns; no queued fire burst |
| Correctness | Zero duplicate shots, stale-epoch state acceptance, contradictory confirmed deaths/scores, cross-room leaks or unbounded queues |
| TV response | Phone gesture to changed shared-TV pose p95 <=100 ms on nearby-network profile; not inferred from phone-local prediction |
| Soak | 30 minutes, five players plus TV, increasing trails/shells, round transitions, target aim, gun impacts and shrinking field; bounded CPU/memory/queues |

Test RTT 0/40/80/150/300 ms, jitter 0/20/50/100 ms, loss 0/1/3/5%, bandwidth 0.5/2/10 Mbps with asymmetric uplink, outages 1/3/10 seconds and mixed-latency peers. Use representative combinations plus explicit worst cases rather than claiming every Cartesian combination from a short run. High impairment is a correctness/degradation gate: freeze/reconnect visibly when outside prediction bounds; do not claim competitive smoothness at 300 ms RTT.

Application injection verifies reorder/expiry/duplicate logic. Real packet loss and congestion require an actual network impairment layer (e.g. Linux netem) with verified counters and traffic path; do not label delayed DataChannel.send as packet loss. Exercise direct and relay, each direction, with real browser SCTP/TCP stacks. Measure distributions for authoritative application latency, snapshot age, corrections and recovery. Failures retain replay traces.

Physical iOS Safari and Android Chrome tests cover touch, foreground/background, lock/unlock, Wi-Fi/mobile switch and bfcache. If device access is unavailable, mark this gate unverified; browser emulation cannot substitute. Permanent deployment ownership, CI on the actual release revision, independent follow-up reviews and public smoke are mandatory. Benchmark results must not be silently regenerated into passing thresholds.

## Review and implementation sequence

ADRs 028–032 are proposals until reviewers resolve contradictions. Implement separate commits for authority fencing, atomic checkpoint validation, input/action semantics, ordered generations, shared movement replay, interpolation, liveness/resource bounds, then product flows and measured release. Regression tests first for reproduced blockers. Review again against the final code; passing unit tests alone cannot close architectural findings.

Concrete proposed protocol amendment: [v2 contract](../online/PROTOCOL.md).

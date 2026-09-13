# Online release roadmap

Updated 2026-09-14. Online implementation is a prototype; LAN remains available. This roadmap replaces the implementation sequence in historical PLAN.md. No production readiness claim is made.

## Architecture gate (in progress)

Read ADRs [028](../adr/028-online-authority-and-lifecycle.md), [029](../adr/029-online-simulation-time.md), [030](../adr/030-online-delivery-and-replication.md), [031](../adr/031-online-rooms-and-operations.md), [032](../adr/032-online-acceptance.md). They select a browser authority conditionally on measured responsiveness/recovery, define its limits, and retain on-demand authority as an alternative if gates fail. Independent initial reviews: [netcode](../reviews/online-netcode-review.md), [security/operations](../reviews/online-security-operations-review.md). Obtain review of these proposals before protocol implementation.

## Work and evidence required

1. Single-host authority epoch/lease, revocation, host lifecycle. Prove duplicate-tab/old-frame fencing and refresh/background behavior.
2. Atomic validated checkpoint schema. Reproduce malformed-sequence mutation and reject corrupt nested state without changes.
3. Typed protocol with applied input tick, action IDs/expiry/acknowledgements and bounded queues. Test lane reorder, missing press, delayed release, round reset and reconnect.
4. Monotonic world generations, explicit decoder outcomes, validated baselines and coalesced resync. Add delayed unseen old-keyframe regression.
5. Shared movement kernel and fixed-tick replay; tick-buffered remote rendering. Quantify corrections and discontinuities at multiple frame rates.
6. Liveness-driven RTC/WSS recovery, ICE restart, Worker/direct-path admission/rate/memory limits. Test one-way blackholes and full supported fanout.
7. Complete room product acceptance: phone host controls, shared TV/device views, join next round, avatars, settings persistence/disable/weights and end/reset screens. Preserve LAN behavior.
8. Sustained deterministic/browser/real-network benchmarks; physical phone/WAN evidence separately. Follow ADR 032; do not reuse exploratory reports as certification.
9. README/AGENTS/service inventory, preview/production separation, protocol compatibility, reproducible release artifact, current CI and independent final reviews. Verify permanent account/URL and public deployment before completion.

## Evidence status

Initial review reproduced stale world rollback and non-atomic restore; other P1s have source-level evidence requiring regression tests. Existing browser smoke and compact snapshot benchmarks are useful baselines but insufficient for poor-network release acceptance. Temporary preview ownership/expiry and physical device tests remain unverified. No server restart or public deployment is part of this planning checkpoint.

# Online release roadmap

Updated 2026-09-14. LAN remains available while the online release is qualified. This roadmap replaces historical PLAN.md. Implementation, successful local checks and verified public deployment are distinct milestones.

## Implemented foundations

The reviewed direction uses a browser authority, direct WebRTC gameplay and a signalling/coordination backend. [ADR 035](../adr/035-direct-gameplay-only.md) explicitly supersedes earlier WSS gameplay-relay fallback requirements. The selected deployment is GitHub Pages plus GCP Cloud Run, Firestore and Pub/Sub; the Cloudflare adapter remains useful for local development.

| Area | Implemented behavior | Remaining acceptance |
| --- | --- | --- |
| Authority | Renewable leases, authority/connection generations, stale-host fencing and pause/reconnect handling | Sustained duplicate-tab, lifecycle and network partitions on the deployed service |
| Restore | Bounded versioned checkpoint validation before atomic replacement; human reconnect and explicit bot registry | Physical-browser refresh/background behavior and measured recovery downtime; no cross-person host migration |
| Input and replication | Intended/applied tick ledger, exact result acknowledgement, held-input expiry, bounded scheduling; generation-aware world deltas and resync | Action/reconnect impairment assertions and measured queue/recovery distributions |
| Prediction | Shared turn-then-move kernel, exact fixed-tick replay including drunk motion, conservative clock bounds, death/portal/epoch reset | Poor-network correction distributions and physical touch-to-photon measurements |
| Remote presentation | Tick-indexed coherent world buffer and fractional projectile time; fixed 100 ms delay, no speculative extrapolation | Measure/tune latency and jitter tradeoff against ADR 032; current delay is not a gate waiver |
| Graphics | Phaser snapshot renderer, bounded particles/object pools, theme/avatar assets, context restore and operational Canvas fallback | Physical low-end/mobile acceptance; desktop renderer benchmarks are not a phone guarantee |
| Rooms and AI | Shared-screen/device modes, phone host controls, settings/local storage, join next round, avatars, reset/statistics and ordinary-input AI riders | Final deployed cross-browser/product smoke and occupied-session-safe release procedure |
| Backend | Cloud Run API/WebSocket gateway, Firestore room transactions, Pub/Sub cross-instance signalling, guarded release scripts | Exact deployed revision, public frontend/backend compatibility and provider operation evidence |

Initial [netcode](../reviews/online-netcode-review.md), [security/operations](../reviews/online-security-operations-review.md), [architecture](../reviews/online-architecture-review.md) and [GCP architecture](../reviews/online-gcp-architecture-review.md) reports preserve the original findings. Their historical blockers are not automatically current defects or automatically closed by this table: consult the relevant regressions, later ADR amendments and current implementation review.

## Release work still required

1. Run the complete current-revision suite: type checks, tests, enforced coverage, build, Chrome/WebKit LAN and online smoke, AI and Phaser lifecycle/base-path checks. Record exact commit and completed CI result.
2. Run sustained five-player plus TV scenarios with seeded latency, jitter, application loss/reordering, constrained queues and direct-link blackholes. Assert accepted application state and input results, not only packets seen by the harness. Preserve seeds, raw samples, percentiles/maxima and build identity.
3. Measure ADR 032 latency/correction/frame/recovery budgets. Separate payload bytes from wire bytes; keep real packet impairment, phone lifecycle, physical-device and WAN evidence separate. If a gate fails, fix it or obtain an explicit reviewed scope decision rather than silently changing the target.
4. Verify the preview artifact, service resources, IAM and operational limits, then the actual GCP and Pages destinations. Publish the Play link only after the frontend connects to the verified backend. Record service/image/frontend identity and rollback compatibility.
5. Complete independent implementation/release review and align README, ADR statuses, deployment inventory and evidence with the resulting qualified scope. A trusted foreground host and direct-connect NAT limitations remain product constraints.

## Reproducible evidence

- [Protocol and application invariants](PROTOCOL.md), ADRs [028](../adr/028-online-authority-and-lifecycle.md), [029](../adr/029-online-simulation-time.md), [030](../adr/030-online-delivery-and-replication.md), [031](../adr/031-online-rooms-and-operations.md), [032](../adr/032-online-acceptance.md).
- [Phaser architecture, browser lifecycle checks and desktop frame benchmarks](../PHASER.md).
- [AI behavior, browser checks and bounded controller benchmark](AI-RIDERS.md).
- [Network harness method and limitations](NETWORK-HARNESS.md). Inspect generated report revision and assertions; historical exploratory JSON does not certify the final release.
- [GCP inventory](GCP-INVENTORY.md), [deployment procedure](GCP-DEPLOY.md), and [provider evidence](GCP-PROVIDER-EVIDENCE.md). These records, not an ephemeral LAN address or old preview URL, establish deployment status.

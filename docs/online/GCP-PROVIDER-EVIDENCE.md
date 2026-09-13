# Real GCP provider integration evidence

On 2026-09-13 at 23:30 UTC, `GCP_SMOKE_GCLOUD_AUTH=1 npx tsx scripts/gcp-service-smoke.ts` passed against project `andershaf-87`, named Native Firestore database `fuse-riders` in `europe-west1`, and topic `fuse-riders-signalling`. The completed report is [gcp-service-smoke.json](gcp-service-smoke.json), including source SHA-256 identities and revision `84aff0bd680c5130050f2126b86564cb0edeeff0`. Concurrent unrelated work existed in the checkout; the report records that explicitly.

Two separate local Node gateway processes used the actual Google SDKs. This was not an in-memory provider fake. The checks verified room creation and Origin validation, cross-process membership watches, v2 welcome messages, addressed SDP delivery in both directions, explicit rejection of gameplay relay, identity-only authority renewal through Firestore transactions, creator replacement fencing, guest replacement and stale-close compare-and-set protection. The run deleted its own test documents and subscriptions. No production rooms or unrelated database resources were changed.

Authentication used the explicitly authorized active gcloud user's short-lived access token, captured in memory and passed to child processes through anonymous stdin pipes. No token was logged, committed, or stored. Local application-default credentials failed with `invalid_grant`; runtime service-account impersonation was denied. This successful run therefore **does not certify runtime-service-account IAM**. An attached-service-account Cloud Run smoke remains a deployment gate.

## Timing and limits

These are elapsed times between single-run check markers, not latency distributions or gameplay benchmarks:

| Check | Elapsed |
| --- | ---: |
| Process startup | 569 ms |
| Firestore create and Origin boundary | 822 ms |
| Membership and initial welcome | 13,122 ms |
| Forward cross-process SDP | 6,678 ms |
| Reverse SDP | 406 ms |
| Identity renewal | 382 ms |
| Creator replacement | 339 ms |
| Guest replacement | 7,534 ms |
| Test resource cleanup | 5,195 ms |

Cold subscription setup and signalling can take seconds. The room UI must remain in a clear connecting state and support retry; this evidence does not establish fast room entry. Subscription creation has a bounded 15-second RPC timeout and signalling frames expire after 10 seconds. These control-plane limits do not change direct gameplay latency budgets. Actual testing exposed and fixed the regional Pub/Sub SDK endpoint requiring an explicit `:443` port.

The SDP payloads were synthetic and the clients were Node WebSocket clients. This test does not prove WebRTC negotiation, physical-phone operation, Cloud Run revision routing, runtime IAM, impairment recovery, or sustained gameplay performance. Gameplay remains direct WebRTC only; Pub/Sub carries signalling only. Local typecheck and all 12 service DI regression tests also passed for these changes.

## Cleanup configuration

Firestore documents include a Timestamp `cleanupAt` field. Production TTL policies must target only `fuse-production-rooms` and `fuse-production-creation-limits` collection groups in the named `fuse-riders` database. TTL is eventual resource cleanup; room and connection expiry checks remain enforced in application transactions. The smoke uses a unique run-specific prefix and explicitly deletes its own resources, rather than relying on TTL.

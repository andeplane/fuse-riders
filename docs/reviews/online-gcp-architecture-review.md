# Independent review: ADR 034 GCP/Pages deployment

> Scope amendment: the user subsequently explicitly chose direct WebRTC gameplay only. Historical fallback/world-lane recommendations below are superseded. Pub/Sub carries only SDP/ICE signalling; failed WebRTC must show failure/retry. See the final implementation review at the end.

Date: 2026-09-14. Reviewed `docs/adr/034-gcp-pages-deployment.md`, current Worker v2 wire and approved online protocol. **Approve the provider direction and isolated adapter implementation, subject to the concrete amendments below. This is not public-release approval.** No deployment or cloud resource changes were performed by this review.

Firestore transactional room metadata plus addressed Pub/Sub routing is a reasonable minimum GCP design preserving WSS fallback without an always-on VM. A process-local room map or best-effort affinity cannot replace it. Google confirms that Cloud Run reconnects can land on different instances and that WebSockets have request timeouts. [Cloud Run WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets)

## Amendments before claiming v2 equivalence

### 1. Make bus ordering explicit for the current world lane

The approved application protocol eventually tolerates stale/reordered frames safely, but the existing chained-delta world stream still needs timely ordered delivery to avoid repeated resync. Pub/Sub defaults to at-least-once delivery without ordering, whereas a single WSS hop preserves order. Simply carrying the same JSON over Pub/Sub therefore changes a material transport property. [Subscription semantics](https://docs.cloud.google.com/pubsub/docs/subscription-overview)

For the first adapter, enable subscription message ordering and publish with a stable per-direction/per-connection ordering key, scoped by room incarnation, source connection and destination connection. Configure one regional publishing endpoint consistently and serialize publishing per edge. Do not use one room-wide key that blocks every rider behind one receiver. Still deduplicate by logical envelope ID, enforce expiry and reject obsolete epochs; ordered delivery is not exactly-once execution. Concurrent handlers must preserve ordered socket writes. If unordered bus delivery is deliberately retained, demonstrate that chained baseline recovery and fire ordering satisfy the existing budgets before calling fallback complete. [Ordering requirements](https://docs.cloud.google.com/pubsub/docs/ordering)

Add a two-gateway trace with delta 2 before baseline 1, duplicate release, an expired head-of-line envelope, and a receiver replacement. Safe recovery is necessary; repeated resync under ordinary traffic is a failed performance gate.

### 2. Distinguish metadata observation from authoritative cutover

A Firestore watcher is not a synchronous fencing check. After connection replacement commits, gateway A may still have the previous cached membership while gateway B has the new one. A bus envelope carrying the previous connection can pass equality checks on stale cache. Do not claim immediate global old-connection rejection merely because a watch is installed.

Define the acceptance barrier explicitly: the authoritative browser adopts a new control/receiver connection only through the neutral handshake and baseline, then rejects all older source scopes. New-source game input must not be admitted before that barrier. Gateway caches are routing hints; committed metadata governs admission/reservation and conditional close, while lease expiry limits stale authority acceptance. If the requirement is rejection immediately at the Firestore commit itself, that needs authoritative revalidation or a non-overlapping connection lease, rather than eventual watches. Avoid adding a Firestore read for every movement packet by accident; that would undermine the intended low-frequency metadata model.

Test delayed watcher delivery against fast bus delivery, old and replacement host sockets across instances, stale close, and new-client input before handshake. State the linearization point tested; do not replace this test with eventual roster convergence.

### 3. Treat per-instance bus lifecycle as a state machine

Use a random process incarnation for gateway identity. The states should include starting/subscribing, ready, draining/idle and failed. Do not admit or advertise any socket until subscription creation and receive setup have completed; repeat that gate after idle teardown. A new join racing the last socket's close must not inherit a subscription being deleted. Stop/delete only after closing admission for that generation and resolving bounded in-flight work; a new generation may restart admission afterward.

A bus failure while WSS remains open must be visible and trigger bounded reconnect/resync. Cloud Run will not wake a particular terminated pull subscriber to deliver an old route. Orphan subscriptions are expected after crashes: configure minimum supported retention/expiration, bounded application expiry and a separately documented cleanup mechanism; termination cleanup alone is insufficient. Each addressed subscription must filter before delivery and local routes must not also publish duplicate messages unnecessarily. Basic Pub/Sub semantics require separate subscriptions for fanout; multiple consumers on one shared subscription are competing consumers, not a broadcast bus. [Pub/Sub basics](https://docs.cloud.google.com/pubsub/docs/pubsub-basics)

### 4. Keep Firestore retries and clock bounds honest

Generate operation IDs outside retry callbacks and perform no publish/send/listener side effects inside them. Capture one logical request identity while refreshing current service time as needed for lease validation on a retry; a stale pre-transaction timestamp must not renew a grant that expired while waiting. Broadcast only committed grants. A transaction failure produces an explicit failed operation, never a locally assumed grant. Preserve bounded grant intervals across processes and the conservative client clock checks; clock/watch uncertainty pauses authority. [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)

Cloud Run/Firestore location, budget and account inventory remain deployment choices for root to verify. They do not block writing typed adapters and emulator tests. Exact cost claims require the actual configured services and observed workload.

## Smallest practical implementation sequence

1. Typed room repository with transaction-based create/admit/reserve/renew/conditional-close and injected clock/IDs. Reuse the Worker test scenarios through the repository boundary, including creator capacity.
2. Typed bus with scoped expiring envelopes, ordered edge delivery, dedup/flow bounds and an in-memory deterministic two-gateway test implementation.
3. Node gateway integrating only the existing v2 messages: welcome, authority, peer, time, signal and relay. Keep game state/ticks out of it. A new adapter does not require rewriting prediction or simulation.
4. Actual Firestore/Pub/Sub adapters and a two-process integration run. Include real Pub/Sub latency in forced-relay benchmarks rather than estimating from one local process.
5. Pages path/CORS configuration and release artifacts. Keep deployment dry-run/build work independent from provisioning until root verifies project resources and authorization.

Preserve current wire fields: protocol version, stable peer ID, fresh connection ID, peers with connection IDs, service-owned grant; time request ID/sentAt echo plus serviceTime; source connection ID on relays; optional target connection fencing. Any additional metadata revisions or handshake barrier must be versioned explicitly, not silently inferred by a gateway.

## Release disposition

Proceed with isolated implementation after recording these amendments; no further broad redesign is needed. Public readiness remains gated by two instances/two revisions, killed gateway and timeout recovery, five-player-plus-TV WSS stress, real network/phone evidence, current CI, ownership and rollback checks. A healthy local adapter or a successful deploy is not proof of those gates.

## Final implementation review — direct-only scope

Reviewed `src/service/{room-store,firestore-store,gateway,room-bus,pubsub-bus,index}.ts` after the bounded lifecycle/GrantIdentity fixes in 98efe33. The 12 DI service tests pass on this review run. **No additional implementation blocker found for controlled provider acceptance testing. This is not certification of deployed provider behavior or public-release readiness.**

The gateway rejects `relay`, accepts only bounded SDP/ICE signal shapes from browsers, and permits host-to-peer edges only. Gameplay snapshots/inputs are absent from its publication path. Firestore transactions allocate operation IDs outside retries, refresh time within retries, reserve authority on host replacement, and condition membership renewal/removal on the exact connection. Local and cross-instance source/target scopes are checked; metadata watchers remain eventual routing hints, with browser authority grants/handshakes providing the acceptance barrier. Do not describe watcher cache checks as instantaneous global revocation.

Subscription creation precedes membership advertisement. Idle teardown and new admission share a serialized lifecycle; generation guards and bounded publish/stop work prevent old publish queues from crossing restart. Frame size, outstanding bytes, dedup count, socket buffering, connection leases and per-socket request rates are bounded. Room metadata/creation limits have TTL timestamps; deployment must enable the corresponding Firestore TTL policies. Orphan subscriptions use provider expiration rather than depending solely on process shutdown.

Remaining deployment acceptance: real isolated named Firestore database and regional Pub/Sub permissions; two simultaneously active gateways with host/guest split; host replacement with delayed metadata delivery; gateway termination and cold restart; browser failure/retry on blocked RTC; Pages base path and exact CORS origin. Measure signalling convergence and resource cleanup under the real provider. Forced WSS gameplay benchmarks are no longer applicable under the user's explicit direct-only choice.

Nonblocking operational caveats: a metadata transaction stalled by the provider can delay the serialized admission/leave queue; authority still expires safely, but UI reconnect may take longer than the normal path. `/readyz` reports gateway lifecycle, not an eager Firestore/Pub/Sub dependency probe while idle. Clock safety assumes the configured conservative inter-service skew allowance; database transactional ordering does not itself synchronize wall clocks. These limits should remain visible in operations documentation and fault tests.

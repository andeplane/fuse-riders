# ADR 034: GitHub Pages and GCP signalling; gameplay requires WebRTC

Date: 2026-09-14. Status: **design reviewed and amended by explicit user direction; implementation/release acceptance pending**.

## Decision and user scope

Use GitHub Pages for static assets, Cloud Run with minimum instances zero for room/signalling connections, Firestore for transactional room metadata and authority leases, and Pub/Sub solely for RTC signalling between Cloud Run instances. **Game messages never use Pub/Sub or a WSS application relay.** The user explicitly preferred visible connection failure over adding a gameplay relay. A network on which RTC cannot connect must show a clear failure/retry path; it is not an accepted fallback mode. No TURN service is provisioned by this change.

```text
GitHub Pages frontend
    | HTTPS room creation / WSS membership, service time, lease and RTC signalling
    v
Cloud Run gateways (scale to zero when unused)
    | Firestore: room membership + transactional authority grants
    | Pub/Sub: SDP/ICE only, addressed to the destination gateway

Phones / TV <-------- direct WebRTC gameplay --------> creator's browser
```

This supersedes the initial draft of this ADR that proposed a WSS gameplay fallback and the fallback clauses of ADR 031 for the GCP deployment. The existing LAN Node server remains supported. Cloudflare code remains a separate historical/prototype service; deploying GCP does not silently migrate existing rooms or credentials.

Root verified `andershaf@gmail.com` as the active operator and `andershaf-87` ACTIVE. A dedicated Firestore Native database `fuse-riders` in `europe-west1` was created, avoiding the unrelated default Datastore-mode database. Pages is configured at https://andeplane.github.io/fuse-riders/. Cloud Run, Cloud Build, Artifact Registry and Pub/Sub APIs are enabled; root owns actual resource inventory/deployment. Planned runtime service account: `fuse-riders-runtime@andershaf-87.iam.gserviceaccount.com`. Record deployed backend URL/revision separately after verification; this document is not evidence of deployment.

## Cloud Run constraints and costs

Cloud Run open WebSockets keep an instance active and billable. Connections have a maximum 60-minute request lifetime, so clients reconnect; session affinity is only best effort. Multiple room members can reach different instances/revisions. `maxInstances=1` is not an authority or routing guarantee. [Cloud Run WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets)

Minimum instances remains zero; cold starts are accepted. Maximum instances bounds spending/concurrency, not correctness. There is no always-running game simulation server or VM, but open lobby/signalling sockets still consume active service time. Idle rooms need an explicit timeout policy. [Minimum instances](https://docs.cloud.google.com/run/docs/configuring/min-instances), [Maximum instances](https://docs.cloud.google.com/run/docs/configuring/max-instances)

Cost model: active gateway instance-seconds during WSS connections + request/network charges + Firestore metadata operations/listeners + Pub/Sub signalling bytes + artifact/build costs. Direct RTC gameplay creates no Pub/Sub gameplay traffic. Firestore charges reads/writes, including listeners, so room time/lease cadence must be measured. Pub/Sub basic throughput currently includes 10 GiB/month per billing account and then $40/TiB for published/delivered throughput; these are provider rates, not a promised game bill. Minimum billing units, storage and network pricing apply. [Firestore pricing](https://cloud.google.com/firestore/pricing), [Pub/Sub pricing](https://cloud.google.com/pubsub/pricing)

## Authority, membership and storage

Firestore stores bounded room records with incarnation, host capability hash/peer ID, grant, revision and up to six connection records `{peerId,connectionId,gatewayId,expiresAt}`. Five player seats plus one TV are supported; reserve room capacity for the creator even when guests connect first. Browser checkpoints stay local; this database is not a simulation-state failover system.

Create/admit/replace/renew/conditional-close use Firestore transactions. IDs are fixed outside retry callbacks; current service time is read inside them. There are no socket sends, publish operations or listeners inside transaction callbacks. Only committed state is announced. Transactions provide serializable isolation; pure existing lease functions retain non-overlapping ownership across revisions. [Firestore isolation](https://firebase.google.com/docs/firestore/transaction-data-contention)

A stale close compares the exact connection ID before deleting membership. Crashed connection records expire and admission prunes them. Room expiry is enforced on use; cleanup is not needed to make an expired room inaccessible. Firestore TTL is storage housekeeping, not an exact authority timer or a replacement for Durable Object alarms. Metadata watchers run only for rooms with local sockets; watch failure closes those connections for recovery. Capability-bearing queries and raw frames must never be logged.

## Cross-instance signalling only

Each active gateway creates an addressed Pub/Sub pull subscription before advertising membership. It has a random process identity; subscription filtering names that destination. No shared competing-consumer subscription is used. SDP offers/answers and bounded ICE candidate schemas are the only routed payload classes. A `relay` gameplay request is explicitly rejected, and game-shaped data disguised as a `signal` frame is rejected by the signal schema.

Enable subscription ordering with per-direction/per-connection ordering keys, a regional publisher endpoint, and serialized edge publication. Default Pub/Sub delivery is at least once without ordering guarantees; ordered delivery still needs logical IDs, expiry and deduplication. Local gateway recipients use local sockets; remote recipients use the addressed bus. [Subscription semantics](https://docs.cloud.google.com/pubsub/docs/subscription-overview), [Ordering requirements](https://docs.cloud.google.com/pubsub/docs/ordering)

Firestore watchers are eventual, so cached membership is a routing hint, not proof of instantaneous global cutover. A changed source/destination connection triggers authoritative metadata refresh; the destination emits new peer identity before that source's SDP. Browser neutral handshake/baseline establishes the gameplay cutover; older receiver/source connection scopes cannot act afterward. No Firestore read is introduced per game movement because gameplay never traverses this service.

Gateway lifecycle is idle, starting, ready, draining or failed. Admission and idle teardown serialize, so a join cannot reuse a deleting subscription. Bus/watch failure visibly interrupts connections for retry. Publishing, receive queues, payload sizes, dedup history and socket buffers are bounded. Pull work is supported by active WSS requests; it must not depend on CPU after every request ends. Clients wake the service by reconnecting, not by publishing to an old gateway.

Delete subscriptions on orderly idle/shutdown and configure expiry for crashes. Pub/Sub inactivity expiry has a one-day minimum; short message retention, strict signal expiry and orphan-subscription checks are therefore required. Termination cleanup alone is insufficient. [Subscription properties](https://docs.cloud.google.com/pubsub/docs/subscription-properties)

## Pages and API configuration

Frontend API/WSS URLs use public `VITE_API_ORIGIN`; Pages assets/invites preserve `/fuse-riders/`. Backend allows exact Origin `https://andeplane.github.io` (no repository path), plus explicitly configured development origins. Handle CORS preflight and WebSocket Origin independently of bearer-capability authorization. Public configuration carries no service account or TURN secrets.

Backend entrypoint: `src/service/index.ts`, executed with `tsx`. Required deployment env: `GOOGLE_CLOUD_PROJECT=andershaf-87`, `GCP_REGION=europe-west1`, `FIRESTORE_DATABASE_ID=fuse-riders`, `PUBSUB_TOPIC=fuse-riders-signalling`, `ROOM_COLLECTION_PREFIX=fuse-production`, `ALLOWED_ORIGINS=https://andeplane.github.io`, and Cloud Run `PORT`.

Routes preserve v2: `POST /api/rooms`, `/api/rooms/:code/ws`, `/api/rooms/:code/ice`; plus `/healthz` and `/readyz`. ICE reports STUN configuration and no configured relay. GitHub Pages and Cloud Run release independently, so protocol mismatch, browser cache and mixed-revision compatibility must be tested. No claim that all users update simultaneously.

## Alternatives rejected or deferred

- Process-local Cloud Run rooms with maximum one instance: fails revision/connection routing safety.
- Firestore gameplay mailboxes: user explicitly rejected backend gameplay transport; additionally creates write/read amplification and latency.
- Pub/Sub WSS gameplay relay: removed at the user's direction; neither schema nor gateway supports it.
- Always-on Redis/VM or authoritative simulation server: unnecessary for selected friend-room scope.
- Provisioned TURN: deferred. If direct RTC fails on a restrictive network, fail clearly; do not claim universal connectivity.
- Automatic host migration: outside this change. Browser-host availability and trusted-host limitations remain visible.

## Implementation and review gates

The [independent GCP review](../reviews/online-gcp-architecture-review.md) approved isolated adapters with ordering, transaction retry, metadata cutover and bus lifecycle amendments. Its original gameplay-fallback discussion is superseded by the explicit direct-only scope above.

Owned modules: `room-store.ts` pure typed transaction operations; `firestore-store.ts` provider adapter; `room-bus.ts` narrow signalling envelope; `pubsub-bus.ts` addressed ordered adapter; `gateway.ts` local sockets and lifecycle; `index.ts` Node HTTP/WSS and env wiring. Deterministic DI tests exercise two gateways, retry-safe grants, delayed watchers, duplicate/expired signals, replacement close, bounded admission and explicit gameplay-relay rejection.

Before release, independently review implementation and run actual two-process/two-revision signalling, gateway termination, reconnect/timeout and mixed-client tests. Show direct RTC succeeds through Pages/GCP; force RTC unavailable and show explicit failure without Pub/Sub gameplay traffic. Capture live provider latency/cost counters and physical phone/WAN evidence separately. Preserve LAN release tests. Verify operator resources, IAM, exact image/revision/URLs and rollback. A successful preview deploy alone does not qualify the broader online release.

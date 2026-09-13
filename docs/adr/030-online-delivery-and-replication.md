# ADR 030: Delivery, replication and recovery

Date: 2026-09-14. Status: proposed; protocol review before implementation.

## Decision

Treat RTC and WSS as interchangeable carriers beneath one versioned application protocol, not independent delivery guarantees. Every envelope has authority epoch, peer/control epoch, message class and bounded payload. Prefer direct WebRTC; use WSS application relay when direct liveness fails. Optional TURN is distinct from WSS and requires configured quotas. Signalling remains necessary even for direct gameplay.

Use separate semantic lanes:

- Movement/aim: latest state, sequence and bounded intended tick; supersede queued state. RTC unordered with no retransmission is suitable only after expiry and scheduling are implemented.
- Fire/management: ordered logical action IDs, scope, expiry, explicit applied/cancelled acknowledgement and bounded retry. A fire gesture has a single ID and ordered press/update/release/cancel transitions. Release contains enough final charge/aim metadata to recover a missing press under validated charge limits. Replay/deduplication lives above transports. Never replay expired shots after recovery.
- World: bounded disposable transform updates plus baseline-dependent geometry/state. Initially retain one reliable world stream for correctness, coalescing unsent updates and forcing a new baseline after overflow. Do not move existing chained deltas to unordered delivery unchanged. A future independent acknowledged-baseline delta scheme needs measured benefit and separate tests.
- Events: authority-scoped event IDs and acknowledgement/replay bounds; cosmetic deduplication must not erase confirmed game state.

A per-peer state machine owns direct probing, healthy direct, fallback, reconnecting and terminal states. Ping/ack age, not merely channel.readyState, drives path selection. Initial targets: fallback within 750 ms of direct blackhole; probe/restart ICE with bounded exponential backoff and jitter; retain WSS until bidirectional direct probes and a current baseline are acknowledged. Healthy RTC can survive a signalling outage only within ADR 028 lease semantics. Room-expired and identity-revoked errors are terminal. Cap queues by bytes AND age, including pre-description ICE candidates.

Replication ordering is (authority epoch, encoder generation, sequence), not random stream UUID arrival order. Encoder generations monotonically increase per peer within an authority epoch. Keyframes cannot roll back a newer generation; deltas require the exact base. Decoder returns accepted/stale/needs-baseline/invalid, so stale duplicates do not trigger resync. Coalesce/rate-limit resync with request IDs; a delayed response cannot replace a later baseline. Validate schema/bounds before mutating decoded state. Settings have an explicit revision, frozen per round; format changes apply next match.

## Alternatives and limits

A single reliable RTC channel is simpler but creates head-of-line blocking between actions, motion and world data; current per-send switching loses logical ordering. All-unreliable traffic is rejected until its recovery protocol exists. WSS cannot avoid TCP head-of-line blocking, so bounded queues and visible degradation remain necessary. No transport makes a disconnected network playable.

## Acceptance

Deterministic carriers inject duplication, reordering, delayed first keyframe, missing delta, old epoch, asymmetric loss and cross-lane press/release permutations. Exactly one shot or explicit cancellation; zero stale action execution; monotonic accepted world generation; bounded retained memory. Browser tests blackhole established direct links without closing channels, restore UDP, drop signalling alone, lose both paths, refresh host/guest and resume without page reload. Measure actual fallback/recovery duration and preserve traces for failures.

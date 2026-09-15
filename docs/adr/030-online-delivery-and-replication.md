# ADR 030: Delivery, replication and recovery

Date: 2026-09-14. Status: accepted direct-only amendment below; historical multi-carrier proposal superseded.

## Historical proposal (superseded where amended below)

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

Concrete proposed protocol amendment: [v2 contract](../online/PROTOCOL.md).

## Reviewed direct-only action amendment (2026-09-14)

The user explicitly selected direct WebRTC gameplay with failure/retry when a direct connection is unavailable. WSS/Pub/Sub is signalling only. The root and independent netcode reviewer therefore accept one ordered, reliable RTC game channel for the first release. The old multi-carrier fallback and terminal gesture replay design above is not required for this narrower scope. Head-of-line delay still exists and must satisfy the measured direct-network acceptance budgets; choosing reliable RTC is not a latency guarantee.

Fire follows the same bounded scheduled input scope as steering: current authority/connection fences, per-player control epoch, sequence and intended tick in the host's ±4-tick admission window. Same-step bomb edges are processed in sequence order separately from latest-wins movement. Duplicate/older processed sequences do not execute twice. A press begins charge only at its actual host application tick; a missing press never creates synthetic charge. Release uses host-observed charge and current shared-game cooldown/powerup rules. Invalid or expired current-scope release/cancel safely cancels charge; foreign scopes cannot cancel a newer gesture.

**Superseded by [ADR040](040-state-based-input-gestures.md):** packets now restate full gesture state and a lost press or release is recovered by later packets. The paragraph below records the earlier decision. There is **no automatic fire-edge resend across channel restart**, and no claim of per-gesture applied/cancelled receipts. `ControllerInputState.resend()` sends current held state with a fresh sequence, not the old press/release edge. A missing final release cancels through a subsequent bomb=false state update, or after ten ticks without fresh applied input. Scope reset/disconnect/authority invalidation clears pending edges and held charge; reconnect requires a new physical gesture. This favors safe shot loss over delayed shots firing after recovery. Movement application results acknowledge movement only, even when a superseded steering packet contained an accepted fire edge.

A known local scheduling/send failure or host rejection of press/release must display a separate three-second **Shot not accepted — check the connection and tap FIRE again** notice. Frequent snapshots/connection status updates must not erase it. Neutral/held-state/cancel packets do not spam shot notices. A successful channel enqueue is not execution proof; authority world state and projectile events remain the confirmation. Network failure after enqueue can still cancel a gesture without an individual outcome receipt, accompanied by the connection's explicit recovery status. Guaranteed per-gesture delivery would require revisiting the deferred terminal-gesture protocol.

Management is narrower too: only the creator performs start/reset/settings/bot operations, applied locally by the host runtime. One recent intention may wait up to five seconds for the same authority's clock confirmation; replacement authority discards it. Guest join has its own idempotent retry helper. There is no promise of migrating management actions between hosts or delivering actions while the host is unavailable.

### Evidence and release disposition

Four controller-to-HostSession boundary regressions cover lost press with held resends, lost final release, lost release while steering continues, and ordered delivery after the age window. They prove no invented charge, no delayed shot, bounded cancellation and usability of a subsequent physical gesture. Existing scheduler tests cover duplicate release, reordered same-step press/release, disconnect/restore scopes and exact movement acknowledgement. A typed notice helper tests fire-only classification and the three-second deadline with an injected clock.

Review finding: the previous silent false return from scheduling/send was a concrete usability defect, not evidence of unsafe duplicate/stale shooting. The approved minimum correction is the persistent notice described above; no second action protocol is needed for the stated safe-failure scope. Direct-only packet delay/loss/recovery and browser interaction acceptance remain mandatory. Do not label these unit tests as physical-phone or network-smoothness certification.

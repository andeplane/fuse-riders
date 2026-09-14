# Design brief: deterministic action-log replication

Date: 2026-09-14. Status: the isolated implementation branch now uses this direct-action runtime by default; qualification remains in progress. See [current implementation and measured traffic](DIRECT-ACTIONS-IMPLEMENTATION.md). Tracking: [issue #82](https://github.com/andeplane/fuse-riders/issues/82). ADR040 implements an incremental host-coordinated replay prototype; the target below replaces that dependency.

## Idea

Make a replayable simulation the foundation of online synchronization. Given the same initial state, rules version, random seed and accepted actions at specified simulation ticks, every device rendering the world should reconstruct the same game.

```text
Initial state + versioned rules + seed + committed action log
    → identical world at any committed tick
```

Transmit the causes of gameplay: steering changes, charge/release actions, joins and settings changes. Viewing devices derive movement, trails, projectiles, explosions, pickups and scores. Routine network traffic then scales with actions rather than the amount of accumulated world geometry. Binary encoding makes those actions compact; determinism removes the need to transmit most state in the first place.

## Event-driven sends

Simulation ticks do not schedule network packets. Send real input changes immediately, repair unacknowledged actions briefly, then combine clock, liveness, receipts and stream completeness into approximately one heartbeat request/reply per peer pair each second. Outcomes and endangered rollback headroom demand prompt confirmation rather than waiting for the next heartbeat. [ADR042](../adr/042-event-driven-coordination.md) specifies the exact bounds. The reviewed runtime integration now implements this schedule. Quiet six-world tests and a local mixed-browser full match pass; sustained impairment and physical-device qualification remain. Bootstrap and paused transitions temporarily use faster connection checks.

## Responsiveness, redundancy and proposed presentation buffer

Optimize for responsive, reliable play on mobile connections, rather than minimum possible bytes. Extra bounded action redundancy and useful coordination traffic are desirable when they reduce missed releases, rollback or recovery delay. The one-second quiet heartbeat is an initial operating profile, not a universal packet ceiling or a reason to sacrifice playability.

Proposed presentation follow-up, pending design review and measurement: retain immediate local-rider response while rendering a coherent remote world from a short history of locally reconstructed states. Start by evaluating 50–100 ms behind the shared simulation clock. Adapt from a recent high percentile of action-arrival lateness plus clock/interpolation margin, increasing promptly and reducing gradually; neither an average nor an all-time maximum is a suitable sole signal. This requires no snapshot stream on the network and does not change deterministic collision ticks. Exceptions still need correction when actions arrive outside the buffer.

Evaluate trail/collision clarity before adopting split presentation times: a rider shown at the current tick can collide with a remote trail section absent from an older rendered world. Related remote geometry, projectiles and effects need a consistent presentation time, and the visible result must not imply a different collision rule. The present renderer projects fractional motion but does not implement this adaptive history buffer. Preserve the existing simulation, rollback and committed-effect invariants while measuring smoothness, correction tails, local response, and collision presentation together.

## Device roles and direct delivery

| Role | Work and network subscription |
| --- | --- |
| Individual-screen player | Continuously simulates the whole world, applies local actions immediately, and sends its own action stream directly to every other full-view peer. |
| Separate TV or spectator | Continuously simulates from the same action streams, with an optional presentation delay. Cannot submit player actions. |
| Controller-only phone | Generates its own timestamped actions and sends them directly to the full-view peers that need them. Receives compact feedback, without retaining a full simulated world. |
| Coordinator | A responsibility assigned to a suitable full-view peer for session setup, lifecycle decisions, finality and checkpoint recovery. It is not a mandatory relay or pre-approval hop for ordinary player actions. |

Thus every viewing device runs a simulation regardless of which device created the room. In shared-TV mode the TV can simulate and coordinate while controller phones remain lightweight. Creating a room must not force a controller phone to run authority physics. Role changes into a full view require a checkpoint and missing action suffix. The connection graph follows subscriptions: five individual players need ten peer links; adding one TV yields fifteen if every pair connects. Controller-only phones need links to simulators, not necessarily to each other. “Broadcast” means sending the same small record over the required peer connections, not IP multicast.

## Simulation, time and agreement

Each origin owns its scoped, sequenced input stream and assigns absolute ticks using the shared match clock. Local actions enter the local simulation immediately and are transmitted directly to the other relevant peers. All full-view peers keep stepping at fixed simulation ticks even when no gameplay messages arrive. Missing new input predicts continuation of the last held controls. Late actions inside the rollback window restore an earlier checkpoint and replay to the current predicted tick. Never use arrival order or independent per-client wall-clock timeout decisions as simulation rules.

A coordinator establishes the initial state, rules version, seed, tick origin and roster; it settles lifecycle changes, disputed/invalid streams and checkpoint recovery. It does not retime every input on arrival or distribute the only usable gameplay stream. Keep tentative simulation separate from finalized results: peers can advance without waiting for the coordinator, while finality requires evidence of complete input prefixes from the relevant players. Coordinator loss and partial connectivity need an explicit bounded continuation/pause policy; this design does not claim arbitrary partition tolerance or cheat-proof consensus.

Shared ticks mean that tick 120 names the same simulation step since match start on every device. Each player generates their own action sequence locally, without knowing other players' actions or the order of a combined stream. Prefer an absolute simulation tick on each independently transmitted action, encoded as a MessagePack integer. Tick deltas are an optional later compression, not a requirement. Initial configuration fixes the tick rate/origin and round/reset semantics; local clock estimation determines when the client reaches a tick. Packets do not need to arrive or be stored in the same order across clients. What must agree is the accepted action set, per-player sequence and deterministic within-tick execution rules.

ADR040's host-applied action log remains useful as a tested reducer/replay foundation and comparison baseline. Its host-star transport, host-retimed input scheduler and wait-for-committed-batches guest runtime are transitional. The implementation branch should evolve toward one direct-action online architecture; indefinitely maintaining an opt-in host-replication mode is not the product goal. Preserve the separate LAN path. Plan an explicit versioned replacement for online peers/checkpoints instead of silently mixing architectures.

For example, four records can describe an extended maneuver:

```text
120  player 2  steering = left
127  player 2  steering = neutral
130  player 2  charge = start
146  player 2  charge = release
```

Record steering state changes, preserving the existing left/right combination semantics. Charge press/release/cancel transitions carry a gesture ID and per-gesture order; charge duration is derived from the stream's press tick under shared validity rules. A missing press cannot silently create charge. Communicate rejected/cancelled gestures and any canonical corrections explicitly, and deduplicate retries by scoped action ID. Separate a transport receipt from application acceptance.

Replace the current 50 ms held-input resends with action delivery plus a bounded control-freshness mechanism. Link probes alone do not prove a held control is fresh: controller heartbeats should identify current control state/revision, with repair rules for disagreement. A canonical lifecycle decision logs neutralization/cancellation at an exact tick when freshness expires. Peers replay that decision rather than making different timeout decisions from their own packet arrival times. Reconnect starts a fresh control scope; old gestures never fire after recovery. The heartbeat interval and expiry budget require review and measurement.

Aim needs an explicit rule too: commit aim updates if they affect simulation before release; otherwise keep local targeting cosmetic and include the final target in the release. Do not assume all actions occur only at button edges. Assign each bot one input-stream owner; publish its ordinary actions through the same interface, allowing replay without rerunning AI decisions on every peer. AI can change controls every tick, so include that workload in bandwidth estimates.

Disconnects, membership/settings changes and match transitions must be deterministic consequences or explicit log entries. Random gameplay follows a specified seeded generator with stable consumption order. Authentication and transport state stay outside the simulation; their gameplay consequences enter through this action boundary.

All simulation uses integer ticks and a defined within-tick order. Preserve 20 Hz initially. At each tick, apply accepted actions, execute the shared game step and derive events. Define order-sensitive ties and same-player transitions explicitly; simultaneous movement/collisions use the shared rules, never packet arrival order. Rendering remains separate.

Individual-screen clients retain confirmed state plus a bounded speculative future. They restore/replay that future when confirmation differs; confirmed deaths and scores remain final. Deduplicate derived sounds/effects during replay and do not repeat external side effects. All full-view peers advance tentatively without waiting for every participant. Finality may lag; a missing peer can require a canonical exclusion/cancellation or explicit pause once recovery bounds expire.

## Synchronization and packet loss

Per-player sequences establish each player's action order; ticks combine actions across players. A global action-by-action ordering is unnecessary. Each input origin periodically publishes a completeness watermark: its last issued action sequence and the tick through which it will issue no further actions. Receipt ranges prove possession of that prefix. A coordinator may publish a finalized-through tick bound to the required stream prefixes; a receiver accepts finality only after obtaining them. This distinguishes no input from lost input without a host message every simulation step. Never let a newer watermark conceal a gap. Normal action traffic is event-driven, with small independent clock/progress/freshness and pending-repair messages.

WebRTC unordered delivery with bounded redundancy is a candidate fast path: repeat recent unacknowledged records, deduplicate them, acknowledge received ranges and repair gaps. A packet may be lost; a committed action must eventually arrive or be incorporated in a replacement checkpoint. Clients may buffer or predict only within defined bounds while records are missing. Beyond those bounds, show a pause/recovery state.

Use reliable delivery for bootstrap/checkpoint transfer and, if measurements favor it, log repair. Cross-channel messages carry dependencies explicitly; arrival order never establishes authority. Bound message size, retained history, retries and queues by bytes and age. Direct WebRTC failure continues to produce an explicit retry state.

Each packet should be independently timestamp-decodable. The refined preference is absolute ticks rather than per-player tick deltas: there is no preceding-action tick dependency to repair. Keep per-player sequences for deduplication, gap detection and multiple actions on the same tick. A contiguous player batch may carry one starting sequence; a group of actions on the same tick may share one absolute tick. Missing actions still need repair for simulation correctness even when later timestamps can be decoded. ADR040 now uses absolute per-action ticks under replay rules `fuse-actions-3`; direct independent input streams remain the next architectural change.

Version the format explicitly and validate before applying records. Preserve authority, connection, match and round fencing. Never drop an already committed action to coalesce traffic; use a replacement checkpoint if its repair history has expired. Chunk and throttle large checkpoint transfers so they do not monopolize the same WebRTC association used for live actions.

### Proposed redundant action bundles (follow-up, not implemented)

Send a new action immediately together with up to three recent unacknowledged action records. Repeat records, not recursively nested copies of prior packets. For example, `[A]`, `[B,A]`, `[C,B,A]`, `[D,C,B,A]` gives A up to four transmission opportunities. Packet arrival order is irrelevant to decoding; scoped action sequences determine deduplication and replay order. A duplicate bomb release must never fire another bomb.

This trades a little extra payload for repair without waiting for a retransmission round trip. It is particularly attractive while records are 10–20 bytes. At an illustrative independent 10% packet-loss probability, missing all four transmissions has probability `0.1^4 = 0.01%`; real loss is often bursty, so this is intuition, not a reliability guarantee. Three preceding records is a starting experiment, not a fixed acceptance threshold.

The implementation must specify:

- **Repair while idle:** the final release/cancel may be the last new action for seconds. While unacknowledged actions remain, send paced repair/progress messages even without new input; initially evaluate 25–50 ms repair intervals with strict byte/rate budgets. Do not delay first transmission to collect a batch or send all redundant copies back-to-back. Separately retain the reviewed control-freshness heartbeat and canonical timeout cancellation.
- **Acknowledgements and retention:** piggyback per-stream contiguous acknowledgements plus a bounded selective-receipt bitmap. Distinguish receipt from finalized application and canonical rejection/cancellation. Recent redundancy does not evict older unacknowledged history: retain it within explicit byte/count/age limits and request missing ranges or a checkpoint when the fast window cannot repair a gap. Never advance committed-through progress across a hole. Expired unaccepted gestures follow the shared stale-input/cancellation rules; repairs cannot revive a stale shot.
- **Independent decoding:** each included action carries an absolute tick, or belongs to a batch explicitly sharing that tick. Retain per-player sequences or a starting sequence for a contiguous player batch. Receiving the redundant bundle must not depend on an earlier lost packet just to decode timestamps. Preserve authority/connection/match/round/control scope and stable gesture IDs.
- **Size and pacing:** cap the entire encoded application message, including envelope, aliases, acknowledgements and all copies. Evaluate a conservative 512-byte application budget initially, separately from record-count and repair-age limits. This is a proposed budget, not a guaranteed path MTU. Leave room for SCTP/DTLS/network/relay headers, measure fragmentation and total bidirectional wire traffic, and respect congestion/backpressure. Increasing a tiny payload from 10 to 30 bytes often changes serialization delay negligibly, but still consumes bandwidth; application messages are not guaranteed to map one-to-one to network datagrams.
- **Delivery and finality:** evaluate a separate data channel configured with `{ ordered: false, maxRetransmits: 0 }`; keep checkpoint/control recovery reliable and throttled. Unordered delivery and retransmission policy are separate settings. Removing transport retransmission/order waiting does not remove propagation latency, congestion or host authority. The existing receiver expects contiguous accepted transactions; redundancy alone does not add speculative world rollback. Gaps must be repaired, buffered or predicted only within explicitly reviewed bounds.

Before enabling this path, review the transport ADR and compare reliable delivery against several bounded redundancy windows under isolated and burst loss, reordering, sparse actions, the last release being lost, lost acknowledgements, simultaneous fire transitions, reconnect/epoch changes, constrained bandwidth and checkpoint competition. Measure p95/p99/max acceptance and recovery latency, false timeout cancellations, duplicate effects, total bytes and queue sizes. This refines the follow-up design; ADR040's implemented reliable prototype remains unchanged.

Standards: [WebRTC data-channel configuration](https://www.w3.org/TR/webrtc/#dom-rtcdatachannelinit) and [RFC8831 transport, congestion and path-MTU behavior](https://www.rfc-editor.org/rfc/rfc8831.html).

## Preferred encoding: MessagePack tuples

Use MessagePack arrays/tuples with numeric opcodes as the preferred encoding, per the user's choice. This avoids repeated field names and a bespoke primitive byte codec. The [MessagePack specification](https://github.com/msgpack/msgpack/blob/master/spec.md) defines compact integer and array encodings; [@msgpack/msgpack](https://github.com/msgpack/msgpack-javascript) is the candidate JavaScript/TypeScript implementation to evaluate. No dependency or runtime protocol is changed by this brief.

An illustrative per-player batch inside a versioned packet envelope is:

```text
[playerSlot, firstActionSequence, actions]
action = [absoluteTick, opcode, value]  // other opcodes define their own tuple shape

[2, 41, [[120, 1, 1], [127, 1, 0]]]
// Player 2: action 41 at tick 120 sets left; action 42 at tick 127 sets neutral.
// Opcode 1 and values 0/1 are illustrative, not assigned protocol constants.
```

Sequences increment implicitly inside a contiguous batch; equal absolute ticks allow multiple same-tick actions whose per-player order is retained. Other players' batches can arrive in any order. Decode and deduplicate by scoped player/sequence, resolve ticks, then feed the accepted tick batches to the simulation.

With compact integer encoding, `[120, 1, 0]` occupies four MessagePack bytes: one array marker and three small integers. At 20 Hz, ticks 12,000 (10 minutes) and 36,000 (30 minutes) each occupy three MessagePack bytes; tick 72,000 (one hour) occupies five. Compared with a one-byte delta, this costs only two to four extra bytes per action. Prefer the simpler loss-independent representation before optimizing these few bytes. Larger numbers, aim coordinates and gesture IDs increase the size; 10–20 bytes remains a rough action allowance rather than a fixed layout or total packet size. Packet envelopes additionally carry version/session scope, message class, batch progress and acknowledgements. Compact aliases may replace long identifiers only after a validated handshake binds them to the full authority/connection/match/control scope.

The application still specifies tuple arity, opcode meaning, integer ranges/overflow, alias lifetime and rules for optional fields. Pin the codec version, bound input bytes and decoder allocations/collection lengths, reject invalid values and unknown protocol versions, and test encoded fixtures through the real decoder. MessagePack decoding does not validate game semantics. Define canonical state serialization separately for hashing: equivalent MessagePack values need not imply identical serialized bytes. Freeze final tuple schemas and measure their actual encoded sizes in the ADR/prototype.

## Expected traffic

The current code sends world changes at 20 Hz: rider poses, trail additions/removals, changed object collections, status fields and accompanying settings/prediction metadata. Guest held controls also resend at 20 Hz. This proposal removes the routine world updates and repeated gameplay records for unchanged controls.

| Illustrative comparison, per full-view recipient | Payload |
| --- | --- |
| Recorded older JSON codec benchmark at 10 Hz | About 23,600 bytes/second |
| Five players × 2–5 action changes/second × 10–20 bytes | 100–500 bytes/second of action records |
| Two-second held turn | Two records, roughly 20–40 bytes, plus protocol traffic |

The [older benchmark](delta-benchmark.json) includes periodic keyframes, excludes outer envelopes/wire overhead, and is not a measurement of today's 20 Hz runtime. The action estimate excludes acknowledgements, progress announcements, heartbeats, redundancy, headers, encryption and checkpoints. It suggests roughly 50–240 times less core replication payload under those assumptions, not a promised total-wire reduction. Measure recipient and host aggregate traffic, controller-only mode, frequent target aiming and bots separately. Batch tiny records to amortize overhead without exceeding latency budgets.

## Checkpoints and determinism

Periodically capture complete simulation checkpoints, including RNG state, entity counters, held controls/active gestures, pending deterministic work, settings and the matching committed batch position. Capture after a defined tick boundary. The current display snapshot is insufficient to resume the simulation. Separate replica checkpoints from host-only credentials and admission queues; no bearer capabilities belong in a replay or guest checkpoint.

A joining or recovering full view installs a validated checkpoint atomically and replays the suffix while buffering newer batches within bounds. If it cannot catch up within budget, request a newer checkpoint. Compare canonical hashes at the same committed tick, excluding presentation and transport state. Bounded resynchronization repairs divergence; repeated failure gives an explicit incompatible/desynchronized state. Hashes diagnose disagreement, not establish trust in a client.

Keep a bounded live log. Retain the initial state and complete log separately when a full-match replay is wanted. Checkpoints alone do not provide durable host failover.

Existing fixed-step simulation, seeded randomness and replay tests provide a starting point. Cross-browser exactness still needs a numerical contract: specified rounding, geometry, iteration order and deterministic transcendental functions. Native JavaScript trigonometry is implementation-approximated, so existing same-process tests cannot establish identical outcomes across browsers. Evaluate fixed-point arithmetic and specified lookup tables or deterministic math routines without silently changing gameplay. See the [ECMAScript definition](https://tc39.es/ecma262/2025/multipage/numbers-and-dates.html#sec-math.cos).

## Features enabled by the same foundation

Instant replay and killcams can restore a recent checkpoint and replay accepted actions in a separate view while the live replica continues receiving updates. Indexed checkpoints allow scrubbing, slow motion and alternate camera views. Full-match exports support shareable replays, reproducible bug reports and offline analysis; checkpoint-plus-log bootstrap supports spectators joining mid-match.

These are follow-on product capabilities, not automatic deliverables of the protocol rewrite. Define replay storage/retention and UI separately. Export the rules/math version, initial configuration and complete action history; retain a compatible simulator or reject unsupported versions rather than replaying old matches under changed physics. An input recording alone is insufficient if initial conditions or external decisions are missing.

## Tradeoffs and delivery

Expected benefits are smaller steady-state traffic, reproducible bug reports and natural replay/spectator support. Costs are full simulation on viewing devices, replay CPU/memory, numerical engineering and more involved loss recovery. Bandwidth savings and mobile performance must be measured. Browser suspension, direct-connect limits and the existing signalling-only backend remain product constraints. Coordinator availability can limit finality/recovery; it must not gate each ordinary input hop. No new paid infrastructure is proposed.

Suggested implementation boundaries are the shared deterministic reducer/checkpoint/replay layer in `src/shared/`; per-origin input streams, mesh subscriptions, lifecycle coordination, binary delivery, rollback, recovery and tick synchronization in `src/online/`; and presentation/controls in `src/client/`. The replica supplies the renderer's existing snapshot interface. Preserve the separate `src/server/` LAN authority and `/display`/`/controller` flows; no Phaser physics or backend gameplay simulation is introduced.

1. Reuse the proven deterministic reducer, full-state checkpoint validation, absolute action ticks and cross-browser replay tests from ADR040. Separate them from the host-retimed input scheduler.
2. Establish direct links for action subscriptions with one input-stream owner per player/bot, immutable scoped action IDs and shared tick-clock alignment. Local input applies immediately; receiving normal input does not require a coordinator hop.
3. Add continuous full-world simulation and bounded checkpoint rollback/replay for late actions. Keep simulation scheduling independent from network sends and render frames; deduplicate replayed effects and retain lightweight controllers.
4. Add the redundant unreliable action path, bounded receipts/repair, progress watermarks and canonical lifecycle/finality decisions. Prove sparse-action behavior, lost final release, burst loss and partial connectivity without turning every tick into a full metadata message.
5. Measure the complete architecture, qualify mobile performance and define an explicit online protocol replacement/reload path. The branch is a development vehicle, not a requirement to preserve a permanent old/new online-mode toggle. Preserve LAN play throughout.

Acceptance requires identical canonical state at every committed tick across supported browser engines and at checkpoint seek points; no missing, duplicate or stale committed actions under loss/reordering; bounded recovery and memory; and measured bandwidth, simulation/replay CPU, frame time and correction distributions for five riders plus a display. Include lost final release, missing press, simultaneous collisions, delayed empty-tick confirmation, stale scopes, malformed checkpoints and a controller switching to a full view. Check p95/p99/max, not averages alone. Compare against the current implementation under the same workloads, retain existing acceptance budgets, and include real phones and networks before claiming mobile readiness.

Before implementation, write and independently review an ADR comparing this approach with current snapshot deltas, binary snapshot deltas and input-delayed lockstep. Freeze the numerical representation, canonical tick phases, late-action policy, control freshness, speculative horizon, packet/queue limits, checkpoint cadence and measurable budgets there. Existing [acceptance criteria](../adr/032-online-acceptance.md) retain their documented proposed/accepted/evidenced status; this brief does not promote them to passed gates. This proposal would revisit the bounded prediction and reliable world-stream choices in [ADR029](../adr/029-online-simulation-time.md) and [ADR030](../adr/030-online-delivery-and-replication.md); it does not supersede them.

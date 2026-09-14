# Design brief: deterministic action-log replication

Date: 2026-09-14. Status: proposed direction; not an accepted ADR or implemented protocol. Tracking: [issue #67](https://github.com/andeplane/fuse-riders/issues/67).

## Idea

Make a replayable simulation the foundation of online synchronization. Given the same initial state, rules version, random seed and accepted actions at specified simulation ticks, every device rendering the world should reconstruct the same game.

```text
Initial state + versioned rules + seed + committed action log
    → identical world at any committed tick
```

Transmit the causes of gameplay: steering changes, charge/release actions, joins and settings changes. Viewing devices derive movement, trails, projectiles, explosions, pickups and scores. Routine network traffic then scales with actions rather than the amount of accumulated world geometry. Binary encoding makes those actions compact; determinism removes the need to transmit most state in the first place.

## Device roles

| Role | Work and network subscription |
| --- | --- |
| Browser host | Always runs authority, even when its UI is only a phone controller. Produces committed actions, checkpoints and controller feedback. |
| Individual-screen guest | Runs a full simulation replica, receives the committed log and predicts its own input for responsiveness. |
| Separate TV or spectator | Runs a full replica for display; can render behind confirmed progress without predicting player intentions. |
| Controller-only guest phone | Sends intentions and receives small status updates: input outcomes, alive/round state, charge/cooldown, relevant powerups and targeting feedback. No full-world simulation, geometry or replay history. |

Thus shared-TV mode needs simulation on the host and a separate TV, not on every controller phone. A role change into a full view requires a checkpoint and log catch-up. Keep role permissions explicit: a TV or spectator cannot submit player actions.

## Simulation and authority

Keep the browser host as the single authority. Players submit intentions with scoped per-player sequence numbers and intended ticks on the shared match clock. The host validates them, assigns actual application ticks, and publishes immutable committed tick batches. Late intentions receive a future application tick or an explicit rejection/expiry under a bounded policy; they never rewrite committed history. Host-local controls go through the same acceptance boundary, without a network hop.

Shared ticks mean that tick 120 names the same simulation step since match start on every device. Each player generates their own action sequence locally, without knowing other players' actions or the order of a combined stream. A tick delta refers to the previous action by that same player. Initial configuration fixes the tick rate/origin and round/reset semantics; local clock estimation determines when the client reaches a tick. Packets do not need to arrive or be stored in the same order across clients. What must agree is the accepted action set, per-player sequence and deterministic within-tick execution rules.

This brief's host coordinator is a proposed coordination choice, not a requirement imposed by deterministic replay or the tuple format. A full mesh with peer rollback is an alternative for ADR review. It still needs agreement on input completeness, membership, conflicting records and when history becomes final. Keep local input recording independent of that transport/topology choice. In the coordinator variant, distinguish locally recorded intended ticks from committed applied ticks; if an action is retimed, reconstruct its absolute intended tick first and encode accepted records against their own applied-tick anchors. Rejection must not break decoding of later local actions.

For example, four records can describe an extended maneuver:

```text
120  player 2  steering = left
127  player 2  steering = neutral
130  player 2  charge = start
146  player 2  charge = release
```

Record steering state changes, preserving the existing left/right combination semantics. Charge press/release/cancel transitions carry a gesture ID and per-gesture order; charge duration starts at the accepted press tick. A missing press cannot silently create charge. Return explicit applied/rejected/cancelled results, including actual ticks, and deduplicate retries by scoped action ID. Separate a transport receipt from application acceptance.

Replace the current 50 ms held-input resends with action delivery plus a bounded control-freshness mechanism. Link probes alone do not prove a held control is fresh: controller heartbeats should identify current control state/revision, with repair rules for disagreement. The host logs neutralization/cancellation at an exact tick when freshness expires. Replicas replay that action rather than consulting their own network timers. Reconnect starts a fresh control scope; old gestures never fire after recovery. The heartbeat interval and expiry budget require review and measurement.

Aim needs an explicit rule too: commit aim updates if they affect simulation before release; otherwise keep local targeting cosmetic and include the final target in the release. Do not assume all actions occur only at button edges. Record host-generated bot control changes through the same action interface, allowing replay without rerunning AI decisions. AI can change controls every tick, so include that workload in bandwidth estimates.

Disconnects, membership/settings changes and match transitions must be deterministic consequences or explicit log entries. Random gameplay follows a specified seeded generator with stable consumption order. Authentication and transport state stay outside the simulation; their gameplay consequences enter through this action boundary.

All simulation uses integer ticks and a defined within-tick order. Preserve 20 Hz initially. At each tick, apply accepted actions, execute the shared game step and derive events. Define order-sensitive ties and same-player transitions explicitly; simultaneous movement/collisions use the shared rules, never packet arrival order. Rendering remains separate.

Individual-screen clients retain confirmed state plus a bounded speculative future. They restore/replay that future when confirmation differs; confirmed deaths and scores remain final. Deduplicate derived sounds/effects during replay and do not repeat external side effects. The host advances without waiting for every participant, so one slow peer cannot freeze the room.

## Synchronization and packet loss

Per-player sequences establish each player's action order; ticks combine actions across players. A global action-by-action ordering is unnecessary. Use sequenced committed batches containing a tick range and actions grouped by player, plus a committed-through tick bound to the batch sequence. This identifies the complete accepted action set, including ticks with no actions. A receiver confirms progress only after obtaining all batches required by that announcement; a newer announcement cannot conceal a gap.

WebRTC unordered delivery with bounded redundancy is a candidate fast path: repeat recent unacknowledged records, deduplicate them, acknowledge received ranges and repair gaps. A packet may be lost; a committed action must eventually arrive or be incorporated in a replacement checkpoint. Clients may buffer or predict only within defined bounds while records are missing. Beyond those bounds, show a pause/recovery state.

Use reliable delivery for bootstrap/checkpoint transfer and, if measurements favor it, log repair. Cross-channel messages carry dependencies explicitly; arrival order never establishes authority. Bound message size, retained history, retries and queues by bytes and age. Direct WebRTC failure continues to produce an explicit retry state.

Each packet should be independently timestamp-decodable: include an absolute tick anchor and starting sequence for each included player, then carry contiguous delta-encoded actions from that player's local stream. This preserves deltas from the previous action by the same player while avoiding a dependency on delivery of the preceding packet. Missing actions still need repair for simulation correctness, even when later timestamps can be decoded. Repeated repair batches carry their own anchors. A stream starting at match tick zero uses zero as its initial preceding-action tick.

Version the format explicitly and validate before applying records. Preserve authority, connection, match and round fencing. Never drop an already committed action to coalesce traffic; use a replacement checkpoint if its repair history has expired. Chunk and throttle large checkpoint transfers so they do not monopolize the same WebRTC association used for live actions.

## Preferred encoding: MessagePack tuples

Use MessagePack arrays/tuples with numeric opcodes as the preferred encoding, per the user's choice. This avoids repeated field names and a bespoke primitive byte codec. The [MessagePack specification](https://github.com/msgpack/msgpack/blob/master/spec.md) defines compact integer and array encodings; [@msgpack/msgpack](https://github.com/msgpack/msgpack-javascript) is the candidate JavaScript/TypeScript implementation to evaluate. No dependency or runtime protocol is changed by this brief.

An illustrative per-player batch inside a versioned packet envelope is:

```text
[playerSlot, firstActionSequence, precedingActionTick, actions]
action = [deltaTick, opcode, value]  // other opcodes define their own tuple shape

[2, 41, 100, [[20, 1, 1], [7, 1, 0]]]
// Player 2: action 41 at tick 120 sets left; action 42 at tick 127 sets neutral.
// Opcode 1 and values 0/1 are illustrative, not assigned protocol constants.
```

Sequences increment implicitly inside a contiguous batch; zero tick deltas allow multiple same-tick actions whose per-player order is retained. Other players' batches can arrive in any order. Decode and deduplicate by scoped player/sequence, resolve ticks, then feed the accepted tick batches to the simulation.

With compact integer encoding, `[7, 1, 0]` occupies four MessagePack bytes: one array marker and three small integers. Larger numbers, aim coordinates and gesture IDs increase the size; 10–20 bytes remains a rough action allowance rather than a fixed layout or total packet size. Packet envelopes additionally carry version/session scope, message class, batch progress and acknowledgements. Compact aliases may replace long identifiers only after a validated handshake binds them to the full authority/connection/match/control scope.

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

Expected benefits are smaller steady-state traffic, reproducible bug reports and natural replay/spectator support. Costs are full simulation on viewing devices, replay CPU/memory, numerical engineering and more involved loss recovery. Bandwidth savings and mobile performance must be measured. The trusted foreground host, direct-connect limits and existing signalling-only backend remain product constraints; no new paid infrastructure is proposed.

Suggested implementation boundaries are the shared deterministic reducer/checkpoint/replay layer in `src/shared/`; host scheduling and action acceptance in `src/online/host-session.ts`; replication, binary codec, recovery and tick synchronization in `src/online/`; and presentation/controls in `src/client/`. The replica supplies the renderer's existing snapshot interface. Preserve the separate `src/server/` LAN authority and `/display`/`/controller` flows; no Phaser physics or backend gameplay simulation is introduced.

1. Audit every simulation mutation and make accepted actions plus initial conditions sufficient for replay. Capture at the actual application boundary, not raw network receipt. Prove full-match replay and checkpoint seeking offline in Chrome and Safari/WebKit.
2. Add tick batches, acknowledgements and recovery with typed injected clocks/transports. Shadow the existing world replication and compare canonical committed states without changing the visible game.
3. Add full-view prediction/replay and compact controller feedback. Check effect deduplication, targeting, cancellation and device-role transitions.
4. Implement the MessagePack tuple codec and measure reliable delivery before deciding whether the unordered/redundant path earns its extra complexity. Test loss, reordering and reconnect at both application and actual network layers.
5. Qualify mobile performance and release compatibility, then switch replication through an explicit protocol version. Define a coordinated rollback/reload path; never mix incompatible histories. Preserve LAN play throughout.

Acceptance requires identical canonical state at every committed tick across supported browser engines and at checkpoint seek points; no missing, duplicate or stale committed actions under loss/reordering; bounded recovery and memory; and measured bandwidth, simulation/replay CPU, frame time and correction distributions for five riders plus a display. Include lost final release, missing press, simultaneous collisions, delayed empty-tick confirmation, stale scopes, malformed checkpoints and a controller switching to a full view. Check p95/p99/max, not averages alone. Compare against the current implementation under the same workloads, retain existing acceptance budgets, and include real phones and networks before claiming mobile readiness.

Before implementation, write and independently review an ADR comparing this approach with current snapshot deltas, binary snapshot deltas and input-delayed lockstep. Freeze the numerical representation, canonical tick phases, late-action policy, control freshness, speculative horizon, packet/queue limits, checkpoint cadence and measurable budgets there. Existing [acceptance criteria](../adr/032-online-acceptance.md) retain their documented proposed/accepted/evidenced status; this brief does not promote them to passed gates. This proposal would revisit the bounded prediction and reliable world-stream choices in [ADR029](../adr/029-online-simulation-time.md) and [ADR030](../adr/030-online-delivery-and-replication.md); it does not supersede them.

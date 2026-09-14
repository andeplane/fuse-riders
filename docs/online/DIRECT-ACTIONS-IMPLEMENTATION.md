# Direct actions: implementation status

Tracking [#82](https://github.com/andeplane/fuse-riders/issues/82), branch `codex/deterministic-action-log`, worktree `/private/tmp/fuse-riders-action-log`. Contract: [ADR041](../adr/041-direct-actions-and-world-rollback.md). Independent [design](../reviews/direct-actions-design-review.md) and [component reviews](../reviews/direct-actions-core-review.md).

The target is a complete replacement of the online host-star path: input origins send absolute-tick MessagePack actions directly to subscribed simulators; every full view advances independently and rolls back late input. A coordinator handles setup, finality and lifecycle barriers, outside ordinary input delivery. Controller-only phones remain lightweight. No public deployment has occurred.

## Runtime cutover checkpoint

The branch now replaces the old online snapshot/accepted-action selection with `DirectSegment` in `RoomRuntime`; replication query flags are removed from the UI. Full views render their local world with immediate fractional cosmetic motion, while solo and LAN retain their existing paths. Shared mode delegates simulation to the TV and keeps the creator's room-management lease. The controller creator retains only an ordered lobby catalog/status; it cannot silently initialize a lost active TV simulation.

Lifecycle preparation transfers the actual finalized base plus deterministic management operations. Views validate both that base and every derived header field before activation. A future-start applied barrier gates the coordinator clock. Prepared UI/cache state is published only at activation. Lobby catalogs preserve tick, seed, raw player/leaderboard ordering and selected settings; returning to lobby explicitly applies pending settings. Ownership validation compares slot mappings independently of roster presentation order. New connections reset management deduplication. Recovery retries/deadlines, untimestampable releases, unavailable TV bases and late activation after timeout have runtime regressions using injected clocks, scheduling, storage and serialized transport.

An initial complete Chromium room smoke passed five joins, start, settings/reset, guest/creator refresh and shared TV. Earlier failing runs found real startup validation, ownership-order and lobby-settings reconstruction defects; an intermittent native RTC channel startup failure remains unexplained. Strengthened browser checks, full measurements and soak are still acceptance work. No public deployment has occurred.

## Implemented components

- `direct-input.ts`, `direct-stream.ts`: stable per-player sequence/gesture semantics, exact completeness cuts, bounded reorder/repair, immediate small packets with redundant records, receipts and idle retry. A missing final release is repaired even without subsequent input. Whole local change groups can be prepared for every subscriber before publishing any bytes.
- `rollback-world.ts`: validated full-state bootstrap, five-tick snapshots, whole-world replay, a 40-tick speculation bound, bounded encoded storage, exact-prefix/hash finality and finalized effects delivered once.
- `direct-origin.ts`, `direct-clock.ts`: control-edge filtering, full tick numbers, local gesture ownership, jitter-aware scoped clock probes, monotonic bounded slew, pre-start/freshness gates and latched clock faults. Untimestamped failed releases cannot revive in the old scope. Calling runtime must enforce readiness and candidate transactions.
- `direct-segment.ts`: composed optional simulation, owned input origins, direct subscriber queues, independent clocks and rate-limited finality. It publishes exact current-tick cuts even during continuous input, stages multiple future certificates to avoid starving lagging replicas, rotates repair records when receipts lag, and exposes provisional geometry with finalized outcomes. Controller segments retain no full world.
- `direct-control.ts`, `direct-ingress.ts`: exact compact reliable clock/finality schemas and authenticated per-slot action/receipt budgets, with separate liveness capacity and an association-wide cap. Duplicate binding does not refill budgets.
- `peer-transport.ts`: same-room peer mesh, one offer initiator per pair, separate reliable and unordered `maxRetransmits:0` channels, validated connection/segment aliases, compact liveness probes, bounded send gates and restart behavior. Initial membership is published before ICE fetching; concurrent initial offers reuse an existing negotiation. GCP gateway and local Worker permit same-room guest signalling while retaining stale/foreign connection rejection.

## Verification and limitations

The direct core's tests cover actual MessagePack boundaries, complete-world rollback, held inputs, same-tick permutations, lost final releases/receipts, exact cuts, pending finality, corrupt checkpoints, queue/memory limits and six-replica convergence. Clock/origin tests cover asymmetric RTT, bounded slew, stale/reordered/unsolicited replies, suspension, absolute-tick boundaries and prepared delivery groups. The composed segment tests additionally cover six independently advancing views with 100 Hz changing input, deterministic packet loss/reordering, five controller-only origins feeding a TV, coordinator-message interruption, opposite asymmetric clock errors, startup/silence deadlines and finalized outcome presentation. Clock uncertainty has a uniform five-tick readiness cap; the resulting 14-tick remote staging allowance leaves execution/finality bounded to 40 ticks. These are deterministic orchestration tests, not a live-room certification.

`scripts/direct-replay-browser.ts` runs three 600-tick five-bot traces in both Chromium and WebKit, advancing speculatively before delayed actions arrive and comparing full-state hashes to Node every ten ticks. The initial run matched all 1,800 ticks per engine, with roughly 3–4 ms rollback p95 on this desktop. It uses synthetic invulnerability to keep five riders active; it does not measure phone performance or integrated gameplay.

`scripts/direct-mesh-browser.ts` uses a local Worker and six actual browser transport instances, alternating Chromium/WebKit. It verifies fifteen direct links, thirty action-delivery directions, twenty guest directions with coordinator application callbacks blocked, a three-second action-send blackhole, stale alias rejection, required-channel closure/rebuild and peer remove/replace while ICE is held. The clean `afc5196` run completed four cycles of both membership cases, including its teardown error gate, and recovered from its blackhole in 328 ms. This is browser-level send impairment, not IP packet loss; coordinator lease/liveness traffic remains active. It does not yet prove gameplay advances independently of coordinator traffic.

Failures are retained rather than erased by successful reruns. One early compact-probe run deadlocked on asymmetric alias binding; dual reliable/fast probes until remote alias readiness address that dependency. One later run completed all transport scenarios but failed its final gate on a WebKit native binary-send page error. Another timed out on incomplete membership after held ICE. Synchronous roster publication and idempotent negotiation improve startup; subsequent repeated runs passed, but neither is claimed to explain the untraced prior failures. The native send investigation remains open, with bounded send/closing and membership traces added to the harness. The existing [WebKit queue race report](../reviews/webkit-datachannel-send-race.md) documents a related residual window; similarity alone is not a diagnosis.

Both existing online room browser smokes passed after the transport change, using the explicit Canvas fixture in Chromium and WebKit; no page errors were logged. This preserves the previous product flow and does not certify the new gameplay architecture. Unit coverage includes the new pure modules at unchanged thresholds; that historical checkpoint excluded browser transport and runtime from unit coverage. The current branch now tests and includes `RoomRuntime` in coverage; the native transport/UI still require browser acceptance.

## Remaining implementation

Complete checkpoint backpressure gating, strengthened Chromium/WebKit lifecycle checks, mixed-engine active gameplay, bot and automatic-round transitions, reconnect/partial-mesh behavior and LAN regressions. Source review closes the currently tested runtime defects; it does not qualify the complete replacement.

Then measure real five-rider-plus-TV gameplay: every payload class in both directions, input-to-render/finality latency, corrections, replay/frame time and memory across declared impairment profiles and a sustained soak. Preserve LAN regressions. Wire overhead, WAN routing and physical-phone behavior remain separately unverified. Do not reuse the prototype's 29→12.7 KB/s measurement as the expected or measured direct-mesh result.

## Local component commands

```sh
npm run typecheck
npm run typecheck:worker
node node_modules/c8/bin/c8.js node --import tsx --test tests/*.test.ts
npm run build
node --import tsx scripts/direct-replay-browser.ts
```

With a separate local Worker running via `node node_modules/wrangler/bin/wrangler.js dev --port 8812`:

```sh
ONLINE_URL=http://localhost:8812/ MESH_CYCLES=4 node --import tsx scripts/direct-mesh-browser.ts
ONLINE_URL=http://localhost:8812/ ROOM_RENDERER=canvas node --import tsx scripts/online-smoke.ts
BROWSER=webkit ONLINE_URL=http://localhost:8812/ ROOM_RENDERER=canvas node --import tsx scripts/online-smoke.ts
```

Generated reports/logs live in ignored `artifacts/`; selected redacted evidence and source hashes are retained in the [evidence manifest](direct-actions-evidence/manifest.json). The full component suite passed 506 tests with 99.55% lines, 94.61% branches and 99.59% functions. Build and dedicated browser reports identify clean source `afc5196`; the manifest explains the unit/default-smoke source equivalence and keeps historical failures distinct. Never point browser impairment tests at an occupied match.


## Segment orchestration checkpoint

Clean source `f80f6de` adds reviewed segment composition and regressions for continuous-input progress, delayed receipts, pending finality starvation, opposite clock errors, uncertainty expiry, startup/silence deadlines and finalized death/placement presentation. Per-flow ingress supports the declared 100 Hz input workload with separate liveness capacity; tests exercise all five authorized flows with additional repair/cut traffic. The reliable bound control lane avoids repeated identity envelopes for clock/finality messages.

The full suite and coverage passed 530 tests (99.60% lines/statements, 94.50% branches, 99.06% functions); both typechecks and build passed. Exact replay again matched 1,800 ticks per browser engine. The clean mixed-browser transport run passed 30 action and 30 compact-control directions, stale/unknown alias checks, channel rebuild and one cycle each of held-ICE peer replacement/removal; it recovered from a three-second synthetic fast-send blackhole in 414 ms and recorded no browser/teardown errors. Those timings are fixture observations, not a gameplay latency or reliability guarantee. See the [new evidence manifest](direct-actions-evidence/segment-orchestration/manifest.json). Earlier failed runs and their unresolved diagnoses remain retained above.

This is historical component evidence. The runtime cutover described above is newer and requires its own acceptance; the component approval does not release the branch.

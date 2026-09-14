# Direct actions: implementation status

Tracking [#82](https://github.com/andeplane/fuse-riders/issues/82), branch `codex/deterministic-action-log`, worktree `/private/tmp/fuse-riders-action-log`. Contract: [ADR041](../adr/041-direct-actions-and-world-rollback.md). Independent [design](../reviews/direct-actions-design-review.md) and [component reviews](../reviews/direct-actions-core-review.md).

The target is a complete replacement of the online host-star path: input origins send absolute-tick MessagePack actions directly to subscribed simulators; every full view advances independently and rolls back late input. A coordinator handles setup, finality and lifecycle barriers, outside ordinary input delivery. Controller-only phones remain lightweight. No public deployment has occurred.

## Runtime cutover checkpoint

The branch now replaces the old online snapshot/accepted-action selection with `DirectSegment` in `RoomRuntime`; replication query flags are removed from the UI. Full views render their local world with immediate fractional cosmetic motion, while solo and LAN retain their existing paths. Shared mode delegates simulation to the TV and keeps the creator's room-management lease. The controller creator retains only an ordered lobby catalog/status; it cannot silently initialize a lost active TV simulation.

Lifecycle preparation transfers the actual finalized base plus deterministic management operations. Views validate both that base and every derived header field before activation. A future-start applied barrier gates the coordinator clock. Prepared UI/cache state is published only at activation. Lobby catalogs preserve tick, seed, raw player/leaderboard ordering and selected settings; returning to lobby explicitly applies pending settings. Ownership validation compares slot mappings independently of roster presentation order. New connections reset management deduplication. Recovery retries/deadlines, untimestampable releases, unavailable TV bases and late activation after timeout have runtime regressions using injected clocks, scheduling, storage and serialized transport.

An initial complete Chromium room smoke passed five joins, start, settings/reset, guest/creator refresh and shared TV. Earlier failing runs found real startup validation, ownership-order and lobby-settings reconstruction defects; an intermittent native RTC channel startup failure remains unexplained. The strengthened separate Chromium and WebKit room flows subsequently passed, asserting simulator/controller roles and zero page errors. Mixed-engine impairment, full measurements and soak are still acceptance work. No public deployment has occurred.

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

Qualify the integrated [ADR042](../adr/042-event-driven-coordination.md) runtime under sustained impairment and measure input, rollback and rendering behavior. Local cutover evidence is recorded below; adaptive remote presentation remains proposed.

Complete mixed-engine impairment, bot gameplay, reconnect/partial-mesh behavior and LAN regressions. The scripted mixed-engine full-match run below covers ordinary automatic round transitions. Checkpoint backpressure and bounded setup episodes now have the reviewed regressions described below. Source review closes the currently tested runtime defects; it does not qualify the complete replacement.

Extend the five-rider-plus-TV application-byte measurement below to matched historical workloads, declared impairment profiles and a sustained soak, including input-to-render/finality latency, corrections, replay/frame time and memory. Preserve LAN regressions. Wire overhead, WAN routing and physical-phone behavior remain separately unverified. Do not reuse the prototype's 29→12.7 KB/s measurement as the expected or measured direct-mesh result.

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

## Runtime source 850b057 evidence

Committed runtime source `850b057` passed both typechecks, build and 552 tests with unchanged coverage thresholds (99.14% lines/statements, 93.89% branches, 98.78% functions). `RoomRuntime` is now included: 92.77% lines and 86.58% branches. Separate Chromium and WebKit room smokes passed five full simulators, start/settings/reset, guest/creator refresh, lightweight controllers and TV simulation; both enforce zero page errors. Build assets matched the post-commit rebuild. The [runtime manifest](direct-actions-evidence/runtime-cutover/manifest.json) retains source/build hashes, raw failures and current checks. This closes the initial room-flow checkpoint, not mixed-engine impairment, latency/bandwidth, checkpoint backpressure or sustained acceptance.


## Checkpoint backpressure and setup episodes

Checkpoint sends now wait for an open, undrained action channel with zero buffered bytes, while retaining the reliable lane's authority, membership, health and buffer gates. Alias binding is deliberately not required before bootstrap. A refused send retains its chunk offset; pacing and transfer bounds are unchanged.

Independent review found that remotely replaced preparations could avoid starting a guest's overall unsuccessful recovery episode, and a missing preparation header had no local setup deadline. Setup deadlines now start at plan adoption; replacing a never-settled plan retains/starts the episode. Success is associated with the exact adopted plan only after applied activation, clock qualification and the existing finality condition. This closes repeated-plan and missing-header waits without treating previously healthy scopes frozen for management as unsuccessful.

The full suite passed 558 tests with unchanged coverage thresholds (99.14% lines, 93.97% branches, 98.78% functions). All 22 focused gate/runtime tests also passed independent review. The local six-context Chromium/WebKit transport harness passed synthetic fast-buffer refusal/drain checks and the existing delivery, link rebuild and membership cases with zero browser/teardown errors. Synthetic bufferedAmount instrumentation verifies adapter behavior, not real network congestion. Full-match measurements and sustained runtime acceptance remain separate.


## Full-match traffic and acknowledged metadata

The actual runtime measurement found that guests' 250 ms setup hellos caused unchanged full room plans to be resent during play. Hello now stops when the current connection/role is confirmed by a validated plan. The creator retries only unacknowledged current plans at most every 250 ms; duplicate hellos and delegated requests share that pacing. A separate delivery acknowledgement never substitutes for ready/applied activation. Lost sends/ACKs, stale/conflicting duplicates and delegated TV setup have independently reviewed regressions.

The final local run used five scripted human input origins and a display, with six simulators alternating Chromium/WebKit. All completed a three-round match and agreed on placements, leaderboard and match statistics. The 37.295-second measurement window included start, countdowns, ordinary play, automatic transitions and match completion; it excluded room-join bootstrap, HTTP, rendering and wire headers. It recorded no reconnect/recovery or browser/teardown errors. Values below are decimal KB and count actual accepted RTC sends/delivered messages, including per-recipient copies.

| Participant | RTC upload | RTC download | Signalling download |
| --- | ---: | ---: | ---: |
| Creator/coordinator player | 17.98 KB/s total across peers | 1.53 KB/s | 0.41 KB/s |
| Other four players | 1.14–1.16 KB/s each | 4.33–4.41 KB/s each | 0.39–0.41 KB/s each |
| Additional display | 0.69 KB/s | 4.27 KB/s | 0.40 KB/s |

For one WebKit guest, download classes averaged 2.40 KB/s checkpoint chunks, 0.41 KB/s preparation headers, 0.38 KB/s finality, 0.35 KB/s stream progress, 0.26 KB/s compact liveness, 0.23 KB/s receipts, 0.09 KB/s room plans, 0.09 KB/s pre-binding liveness, 0.05 KB/s actions and 0.044 KB/s clock replies. Its room plans were exactly three packets, one per round; it sent no setup hello during the window. Checkpoints at ordinary transitions are now the largest measured opportunity for further reduction. Reusing a retained base must preserve validation and fallback recovery, not assume every peer already has it.

Before the metadata optimization, a separate clean 40.666-second run measured 8.40–8.50 KB/s guest downloads, including 4.33 KB/s of repeated plans. The historical pre-branch serializer benchmark measured 28.7–29.1 KB/s host-to-view traffic, and the old incremental prototype measured 12.7 KB/s. These workloads/scopes differ, so none establishes a matched before/after reduction percentage. The historical benchmark omits several traffic classes now counted. Wire overhead and real-network latency remain unmeasured.

The final source passed both typechecks, build and all 564 tests with unchanged coverage thresholds (99.14% lines, 93.95% branches, 98.78% functions); 25 runtime tests passed independent review. The [traffic manifest](direct-actions-evidence/gameplay-traffic/manifest.json) retains raw results, the final bundle/input hashes, before-fix regression failures and the initial traffic run invalidated by an unintended local Worker restart. The later source-specific run supersedes earlier exploratory totals.

Reproduce against a fresh local Worker with no concurrent build/restart:

```sh
ONLINE_URL=http://localhost:8812/ TRAFFIC_RUN=local node --import tsx scripts/direct-traffic-browser.ts
```


The first post-optimization WebKit UI flow failed during creator-refresh/shared-TV setup. A focused regression reproduced an inherited simulation recovery deadline expiring while the room intentionally waited without a display. Adopting a validated coordinator-null lobby now cancels that obsolete episode and pending delegated request, preserving corrupt-state history. The 20-second idle → TV join regression and all existing coordinator-bearing deadline cases pass independent review. The repeated WebKit room flow passed five personal views, start/settings/reset, guest/creator refresh, controller-only phones and shared-TV start/reset. This closes the reproduced idle-boundary defect; historical native RTC startup/send failures remain separately unqualified.


## Event-driven coordination foundation

[ADR042](../adr/042-event-driven-coordination.md) now specifies immediate action edges and acknowledgement-bounded repair, followed by one combined heartbeat exchange per pair per second during healthy quiet play. Outcomes and endangered rollback headroom request prompt confirmation. This replaces the current intended implementation's separate progress, receipt, clock and link-probe loops; a 20 Hz simulation does not require a 20 Hz network schedule.

The reviewed standalone heartbeat component has exact bounded MessagePack tuples, pair election, fresh retry IDs, two-way acknowledgement evidence, nonce/role checks and callback-stop fences. Its real-clock integration test runs ten seconds with 22 messages total (11 request/reply exchanges) and no separate clock probes. This is deterministic component evidence, not measured runtime traffic. Clock samples now retain 2.5-second freshness with conservative 500 ppm drift uncertainty across both RTT and sample age; the five-tick uncertainty and 40-tick world cap remain. The full suite passed 581 tests at the final production source, and the final heartbeat test file passed 15 tests after one additional integration case. Both typechecks and build passed. See the [foundation manifest](direct-actions-evidence/heartbeat-foundation/manifest.json) and independent review.

At that historical foundation checkpoint, runtime heartbeat adoption and gameplay cadence cutover remained pending. The integration below supersedes that status.


## Event-driven heartbeat runtime

At this heartbeat checkpoint the branch used `fuse-direct-2`: combined heartbeat bodies install authorized cuts, receipts, clock samples and finality atomically. Quiet empty action queues have no send timer. Real actions retain immediate delivery and bounded 50 ms unacknowledged repair; outcomes, phase changes and endangered rollback headroom request prompt confirmation. Reliable finality is retained until reliable enqueue succeeds, even if an unreliable pulse carrying the same certificate was queued. Old piggyback receipts cannot invalidate fresh clock/cut evidence.

A ten-second deterministic quiet fixture with five origins and six worlds records exactly 300 heartbeat packets (15 pairs × request/reply × ten seconds), 50 reliable certificates, and no separate action, cut, receipt or clock packets. Application upload is 611 B/s for the coordinator, 101 B/s per other player and 79 B/s for the display. This fixture establishes cadence, not native network performance.

The native `heartbeat-01` match failed at its first automatic round transition. The coordinator had installed the new alias while a guest still needed link health to acknowledge its checkpoint header; the guest's old-alias probes were ignored, preventing checkpoint delivery. Paused endpoints now also exchange the existing authenticated association-scoped bootstrap probes, independent of prior alias confirmation. The review and regressions preserve health, authority, pacing and episode bounds. Deferred health replies also recheck page visibility and both channel lifecycles. A shared-screen lobby waiting for its TV can retain bootstrap checks indefinitely; active healthy segments use the quiet heartbeat schedule.

The fixed `heartbeat-02` native run completed all three rounds in a 37.188-second measurement window. Five scripted human origins plus display, alternating Chromium/WebKit, agreed on finalized outcomes with no reconnect, recovery or browser/teardown errors. Actual RTC application traffic including setup and round transitions was 18.96 KB/s coordinator upload, 0.745–0.766 KB/s upload and 4.23–4.35 KB/s download per other player, and 0.617 KB/s upload / 4.24 KB/s download for the display. Checkpoint and preparation traffic still dominates total match bytes. These randomized matches and the historical serializer benchmark are not a matched reduction experiment. Wire cost, rendering and real mobile networks are excluded.

Both typechecks, build and 597 tests passed, with unchanged coverage thresholds: 99.19% lines/statements, 94.07% branches and 98.88% functions. Focused transport boundaries passed independent review. See the [cutover manifest](direct-actions-evidence/heartbeat-runtime/manifest.json) for exact source/bundle hashes, failures and completed browser checks. Sustained impairment, latency/resource distributions, adaptive presentation and release qualification remain open.


## Network qualification and checkpoint corrections

This historical checkpoint used `fuse-direct-3`. The direct reducer clears executable charge/target state outside playing while preserving input-stream gesture identity. Regional testing exposed a survivor charging on the round-ending tick, then releasing after completion: the shared game ignored that release outside play, leaving an orphaned charge and an unreadable finalized checkpoint. Eight regression combinations cover round/match completion, release/cancel and late rollback. Finality now validates the encoded checkpoint roundtrip and certified hash before mutating the finalized state or publishing effects. LAN rules are unchanged.

Preparation headers stop repeating after their exact current-member header acknowledgement, independently of checkpoint readiness. Failed header/ACK sends retry. Management and compact reliable control use a prospective 12 KB aggregate browser-buffer admission budget across all RTC links/lanes; checkpoint chunks use 6 KB, 2 KB payloads, and fair recipient rotation. Existing per-recipient pacing, authority/visibility checks, ready/applied barriers and five-second setup/15-second episode deadlines remain. Synchronous stop, authority and lifecycle replacement cannot continue a retired transfer.

The new mixed-engine fixture handles MessagePack, seeded action-message loss/reordering, delay/jitter and shared sender bandwidth. It preserves reliable FIFO, separates unsent serialization backlog from propagation-delayed retention, records bounded packet/action/finality observations, and fails on hidden recovery or console/page errors. Exact esbuild input bytes and bundle identity are retained. This is application impairment on local native RTC, not physical packet/SCTP congestion emulation or rendered latency evidence.

The current local full-match run passes all six engines and three rounds in 36.464 seconds with no recovery/reconnect or browser errors. RTC application traffic including lifecycle transfers was 15.31 KB/s coordinator upload and 3.89–3.93 KB/s download per other player. The randomized run is not a matched before/after bandwidth experiment.

**Regional qualification failed at this checkpoint.** Under 40±20 ms one-way application delay, 2% fast-message loss and 512 kbps shared sender shaping, ordinary round checkpoint transfers still exceed the unchanged preparation deadline. The final failed run has no browser errors or queue overflow; maximum observed coordinator queue residence was 235.2 ms. Earlier runs include a missing-backpressure fixture, an overly conservative propagation-as-buffered model, duplicate-header congestion, and the independently reproduced charge/checkpoint crash. All are retained with their scopes, rather than being described as passes. [ADR043](../adr/043-reuse-validated-lifecycle-bases.md) is independently approved for exact validated local-base reuse with selective checkpoint fallback; the implementation checkpoint below supersedes that pending status.

Both typechecks, build and all 608 tests pass at this production source, with unchanged coverage thresholds (99.19% lines/statements, 94.13% branches, 98.88% functions). Independent focused review passes 40 tests. See the [qualification manifest](direct-actions-evidence/network-qualification/manifest.json) for raw compressed runs and exact source identity. Broader impairment, sustained play, presentation delay, latency/resource distributions and physical devices remain open; no deployment.


## Validated state reuse candidate

Current rules are `fuse-direct-4`. Preparations offer an absolute base alias/tick/hash plus the small management-operation sequence. A simulator with the exact finalized state and original local/source authority scope derives the candidate locally and acknowledges that no payload is needed. Other simulators receive the existing validated checkpoint. Both paths share neutralization, operation application, output validation and the original finalized fence. Controllers require no full-world payload. Duplicate headers retain the same immutable per-peer transfer choice, and conflicting ACKs fail explicitly.

All 615 tests and the build pass (coverage: 99.20% lines/statements, 94.04% branches, 98.89% functions; thresholds unchanged). New runtime checks prove zero checkpoint chunks when all peers can reuse their base, and selective transfer when one peer cannot. Existing backpressure/deadline checks exercise authority-invalidated cache misses.

The unchanged regional profile now passes: `regional-07`, 47.207 seconds, five scripted player origins plus display, six alternating Chromium/WebKit simulators, three rounds with matching finalized outcomes and no recovery/reconnect/browser errors. It injects 40±20 ms one-way application delay, 2% fast-message loss and a 512 kbps aggregate sender budget. RTC application upload is 4.74 KB/s for the coordinator; other players upload 0.75–1.00 KB/s and download 1.27–1.58 KB/s, including start and round transitions. Different game seeds and durations mean these are not matched before/after percentages. Wire overhead and rendering are excluded.

The same source also passes the unshaped local mixed-browser match (`reuse-local-01`, 36.136 seconds), with matching outcomes and no recovery/browser errors.

See the [candidate evidence](direct-actions-evidence/lifecycle-reuse/manifest.json). Adaptive remote presentation remains unfinished. Implementation review, sustained impairment and physical-device qualification remain; this candidate is not deployed.

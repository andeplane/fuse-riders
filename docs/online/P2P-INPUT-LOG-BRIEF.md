# Brief: peer-to-peer input-log networking for online rooms

> **Status (2026-09-17): historical.** This was the design brief for the peer-to-peer cutover of 2026-09-15. The model as implemented is recorded in [ADR 047](../adr/047-p2p-input-log-lockstep-rollback.md), which is read from the source and whose constants are checked by `tests/p2p-adr-constants.test.ts`. Where this file and the ADR or the code disagree, the code wins. The design sections (§3–§13) were removed on 2026-09-17 because they had drifted from the code (#258 T6); the table in "Where the design went" maps each to the ADR and lists what was wrong. What remains here is what the ADR leaves out: the original goals and principles, the deviations from the first design, the measurements and the review history.

Date: 2026-09-15. Superseded the online design in ADRs 028–032 and 035 and the discarded `codex/deterministic-action-log` branch. The brief was written when a LAN server (`/display`, `/controller`) still existed and had to keep working; that server was removed in #271 and every game is now an online room.

## 1. Goal

Replace the host-star snapshot protocol with a peer-to-peer design where every device that renders the world simulates it locally from a shared, deterministic input log. Targets, in priority order:

1. **Latency.** A player's own input applies on the next simulation tick with no network round trip. Other players' inputs apply one network hop later. Nothing waits for a host, a certificate, or an acknowledgement.
2. **Simplicity.** One log, one packet type on the fast lane, one runtime shared by solo and online play, and fewer than ten failure states. The target was a networking layer of roughly 1,500 lines of source; it was about 1,050 at the cutover (§15) and the same six modules are about 2,700 lines today, after the review fixes, game-speed pacing and Prettier formatting (#260).
3. **Bandwidth.** Per-player traffic scales with input edges plus a small fixed cadence, not with world geometry. Under 15 KB/s each way per peer at 20 Hz is acceptable; an idle throttle can bring it under 5 KB/s later.
4. **Office play.** With all players on one LAN and the room service anywhere, gameplay packets never leave the LAN. The service remains signalling only. (ADR 035 notes that the ICE candidate path decides this; the application cannot guarantee it.)

Non-goals: cheat resistance, a TURN relay, lossless failover, physical-phone certification, and a change of tick rate. The design must make a later move to 40 or 60 Hz cheap, but this brief keeps `TICK_HZ = 20`.

## 2. Principles, and what not to build

These come directly from the discarded branch. Each one cost hours there.

- **The log is the truth.** State at tick T is a pure fold of the seed and every entry with tick ≤ T. Do not add coordinator finality, certificates, hashes-as-proof, watermarks, exact-prefix cuts, or demand/confirm cycles. Divergence detection is a diagnostic hash, not a protocol.
- **Everything is a log entry.** Start, rematch, return to lobby, settings, join, leave, avatar, bot add/remove, and presence changes are entries in the creator's stream. There are no segments, aliases, barriers, plans, prepare/ready/activate/applied handshakes, or round-transition checkpoint transfers.
- **One steady packet stream carries everything.** Every member sends a small packet to every other member every tick, and immediately on any new own entry. Liveness, completeness, loss, jitter, and RTT are all derived from that stream. No separate heartbeat, probe, pong, receipt, or clock protocols. (As built, this holds for the runtime. The transport kept its own `linkProbe`/`linkPong` path-health probes and the `linkBye` farewell on the reliable channel, and the room socket kept its `time` heartbeat to the service; see ADR 047 §13 and §9.)
- **Render the speculative world.** Deaths, pickups, and scores render from the local simulation as they happen. Rollback corrects them if a late input changes history. There is no provisional-versus-finalized split.
- **Design for real networks.** LAN, home WiFi, and 4G. Do not qualify against 256 kbps sender caps.
- **Process.** One agent, one branch, one design doc, tests, and one browser harness. No per-fix ADR, independent review, or evidence manifest. Raw logs and traffic dumps go under the ignored `artifacts/` directory, never into git. (`AGENTS.md` is the current workflow contract.)

## Where the design went

Sections 3–13 described the design before it was built. They are in git history (`git log -- docs/online/P2P-INPUT-LOG-BRIEF.md`). Each row names the ADR 047 section that now describes the behaviour and what the removed text got wrong.

| Removed section                    | Now in ADR 047        | What the removed text had wrong                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §3 Architecture and roles          | §1, §4, §9, §13       | Controller-only phones do simulate; there is no thin status packet and no role table. The time authority is the creator while the service lists it as a member, not "the lowest full view".                                                                                                                                                                                                                                                |
| §4 Log and reducer                 | §1, §2, §9, §10       | `JOIN` carries the joiner's generation. Bots are simulated on every replica, not logged as streams. Management entries are filtered by `permitted` in the reducer, not accepted from the creator's stream only. `RULES` is no longer `fuse-p2p-1`.                                                                                                                                                                                         |
| §5 The per-tick packet             | §3, §8                | The packet has twelve fields, not eleven: it carries the sender's member id (not a roster index) and `clockTick`. Every member attaches hashes, not only full views, and the hashed tick is the clock tick − 40, not `through − 40`.                                                                                                                                                                                                       |
| §6 Delivery, repair and bounds     | §3, §6, §7, Constants | Future bound was "local tick + 14"; the code has `FUTURE_TICKS` = 400. Packet cap was "512 bytes" in the bounds list; the code has `MAX_PACKET_BYTES` = 1100. The NACK is `[2, room, from, firstMissingSeq]`, not `[1, roomHash, "nack", fromIndex, firstMissingSeq]`. Nothing discards entries at or before a "disconnect tick"; a disconnected rider folds neutral controls. "~600 ms" full resend is not something the code guarantees. |
| §7 Clock, time and disconnects     | §4, §5, §9, §11       | The clock is `base + (now − t0) · rate / 50` with rate 1 or 3, started when the world is created, not at the start action; packets carry `clockTick`, not `base`. Catch-up is `CATCHUP_TICKS` per pass, not unbounded. A generation is the page load time, not `gen + 1`. `inputDelayTicks` was never built. 3× pacing was not described at all.                                                                                           |
| §8 Snapshots                       | §7, §8                | Any linked peer serves, not only the time authority. The chunk field is `data` (base64 text), and the payload is `[RULES, room, tick, game, settings, folds, bots, streams, hash]`. No thin status at 10 Hz; no `localStorage` checkpoint.                                                                                                                                                                                                 |
| §9 Presentation and events         | §5                    | Presentation is one tick behind the clock with the local rider led, not at the clock tick. Event keys are `(matchId, round, tick, index)`.                                                                                                                                                                                                                                                                                                 |
| §10 Transport changes, §11 Files   | §13                   | Paths: the gateway is `packages/fuse-network-be/src/gateway.ts` and the transport `packages/fuse-network-fe/src/peer-transport.ts`. `src/server/` no longer exists.                                                                                                                                                                                                                                                                        |
| §12 Phases, §13 Definition of done | "Phase gates" below   | A plan, completed; the results are below.                                                                                                                                                                                                                                                                                                                                                                                                  |

Hidden-tab behaviour was never in this brief; it is ADR 047 §12.

## 14. Follow-ups this design enables

None of these is built. Idle cadence throttle (20 Hz active, 5 Hz idle). Adaptive input delay from measured RTT. Simulation at 40 or 60 Hz, which needs the per-tick constants in `game.ts` re-derived from per-second values. Replay export, since the log plus seed is the replay.

## 15. Results (2026-09-15)

These are dated results. Paths are as they were then: the transport and the gateway have since moved to `packages/fuse-network-fe` and `packages/fuse-network-be`, and the LAN tests and server named below were removed in #271.

Implemented in `src/shared/input-log.ts`, `apply-tick.ts`, `deterministic-math.ts` and `src/online/stream.ts`, `rollback.ts`, `clock.ts`, `packet.ts`, `snapshot.ts`, `room-runtime.ts`, with `peer-transport.ts`, `ui.ts`, `attract.ts`, `src/service/gateway.ts` changed and the host-star modules deleted. The networking layer (`stream`, `rollback`, `clock`, `packet`, `snapshot`, `room-runtime`) was about 1,050 lines; with the shared log and reducer about 1,300.

### Deviations from the first design, and why

- **Bots are simulated on every replica, not logged.** `BotController` is a pure function of the state with its own seeded random stream, and the shared math is pinned. Running it inside `applyTick` removes bot streams, bot packets and the bot-input latency entirely; the determinism replay and the divergence hash cover it.
- **Every member simulates, including controller-only phones.** The world costs a few hundred microseconds per tick, so there is no thin status packet and no separate role table. Shared-mode phones simply do not render the arena. This removes one packet type and the "waiting for a display" simulation gate; the phone shows that notice while no full view is live.
- **The time authority is the creator** for as long as the room service lists it as a member; after that it is the lowest id among the members heard within the last five seconds (`RoomRuntime.authority`). Snapshots are served by any linked peer (the returning creator needs one from a guest), rotating on retry.
- **Packets carry the sender's member id instead of a roster index**, since the roster is not a log entry and indices would not agree during joins. Cost is about 25 bytes per packet.
- **Management entries are accepted from any stream at the receiver and filtered in the reducer** (`permitted`): the creator always; the delegate (lowest connected human other than the creator) only while the creator is marked absent; and any connected human may log `presence(x,false)` for anyone ahead of it in the succession order (creator, then connected humans by id), so a creator and a delegate that drop together are both marked absent by the next rider. A silent creator opens the succession: the lowest rider still heard marks absent everyone ahead of it that has been silent for five seconds, and while it is the acting creator it carries the creator's log duties (presence, leave, joins, which joiners send to it). Room commands — settings, start, rematch, lobby, bots — stay with the creator (`RoomRuntime.command`). This keeps delegation a pure function of the log.
- **`join` carries the member's generation** and there are no roster indices in `presence`; `hello` on the reliable channel announces `generation`, `full`, `RULES` and whether the sender holds a world.
- **Snapshot requests and hellos are retried from the tick loop** rather than only on the link-open event, because the transport admits sends only after its own probes confirm the path.
- **A snapshot re-install (divergence, or falling more than `BEHIND_TICKS` = 400 ticks behind) keeps the member's own stream numbering** and re-applies its own entries after the snapshot tick, so peers keep folding the same log.
- **Divergence hashes are exchanged and compared only for ticks that are complete on both sides** (every connected rider's stream past the tick); a speculative hash would flag every late packet as divergence.
- **The local checkpoint in `localStorage` was not kept.** A refreshed creator recovers the running match from a peer.

### Phase gates

- **Phase 0** `scripts/determinism-replay.ts`: one seeded 3,000-tick log with two scripted riders and three AI riders folds to identical state hashes on every tick in Node, Chromium and WebKit. Existing `game.test.ts` and LAN tests pass unchanged.
- **Phase 1** `tests/input-log.test.ts`, `stream.test.ts`, `clock.test.ts`, `rollback.test.ts`: every entry kind, gesture replacement, mismatched release, arrival-order convergence, a late entry rolling back, the 40-tick stall, rejected management entries, and six replicas on a 5% loss reordering fake network agreeing on every retained tick. Solo is `RoomRuntime` with no transport.
- **Phase 2** `tests/packet.test.ts`, `snapshot.test.ts`, `room-runtime.test.ts`: five riders and a TV through 5% loss, 100 ms jitter and reordering with no gap open longer than 600 ms and one hash at the end; malformed, foreign and oversized packets change nothing; the follower clock stays within one tick of the authority under 90/10 ms asymmetric delay.
- **Phase 3** `scripts/p2p-mesh-browser.ts`: six contexts alternating Chromium and WebKit, fifteen links, thirty send directions, recovery about 1.1 s after a three-second send blackhole, a closed input channel rebuilt by the initiator, zero page errors.
- **Phase 4** `scripts/online-smoke.ts` in Chromium and WebKit: create, five joins, start, three rounds, guest refresh mid-round, creator refresh mid-round, settings change, an AI rider round, shared TV with two controller phones. Typecheck, worker typecheck, tests, coverage thresholds and build pass.
- **Phase 5** `scripts/p2p-measure.ts`: see the summary below; raw output in `artifacts/p2p-measure.json`.

### Phase 5 summary

`ONLINE_URL=http://localhost:8811/ npx tsx scripts/p2p-measure.ts` at revision `f7e6ca9`: five scripted Chromium players plus a TV, 45 s each, 5 rounds locally and 5 rounds impaired. Latencies are input event to the first simulated state showing the changed heading, stamped with page clocks on one machine; wire bytes are data-channel payloads. The impaired run injects 40 ms delay, 20 ms jitter and 2% loss at the sender's input-channel send. Raw output: `artifacts/p2p-measure.json` (ignored).

| Metric (per peer, 5 links)                     | Local                     | 40 ms + 20 ms jitter + 2% loss |
| ---------------------------------------------- | ------------------------- | ------------------------------ |
| Wire bytes per link, sent / received           | 2897–3649 / 3321–3571 B/s | 2851–3534 / 3212–3499 B/s      |
| Measured RTT                                   | 0–5 ms                    | 94–121 ms                      |
| Rollbacks per minute / ticks per rollback      | 0–6 / 2–4                 | 387–500 / 2–3                  |
| Input to own simulated state, p50 / p95        | 8–40 / 40–48 ms           | 11–40 / 43–60 ms               |
| Input to remote simulated state, p50 / p95     | 9–42 / 44–50 ms           | 16–44 / 56–62 ms               |
| Crash to death shown on other peers, p50 / p95 | 2.8 / 7.5 ms              | 4.3 / 14.8 ms                  |

Per-link traffic is a quarter of the 15 KB/s budget with no idle throttle yet. Locally, rollbacks are rare and short; under the impairment nearly every remote entry arrives after its tick, so the world rolls back about seven times a second by two to three ticks, which is the designed no-delay behaviour and the case for the adaptive input delay in §14. Own-input latency is bounded by the 10 ms loop and the tick boundary; remote latency adds one hop. These are desktop measurements on one machine, not physical-device or real-network figures.

### Rebase onto `main` (2026-09-15)

`main` had meanwhile landed its own rollback stack (ADR 041/042: a host-authored input log with host-star delivery and a thin status for controller phones) plus unrelated gameplay and UI work. The `p2p` branch was rebased onto it with this design as the surviving netcode:

- Removed from `main`: `src/online/runtime.ts`, `host-session.ts`, `local-runtime.ts`, `wire.ts`, `controller-status.ts`, `input-edges.ts`, `interpolate.ts`, `authority-status.ts`, `response-measurement.ts`, `src/shared/action-log.ts`, their tests, and the scripts `benchmark-actions.ts`, `benchmark-response.ts`, `input-drop-probe.ts`, `online-network-benchmark.ts`. ADR 041, ADR 042, `ROLLBACK-PLAN.md`, `PROTOCOL.md`, `NETWORK-HARNESS.md` and `RESPONSE-BENCHMARK.md` carry superseded notes.
- Kept from `main`: the gameplay changes in `src/shared/` (several live portal pairs, the room's bomb aim time, four-character room codes only, the `uuid` helper that works on a plain-HTTP LAN address); `checkpoint.ts` validates `portalPairs` as `main` does. The join card, phone lobby, radio, power-up guide and the rest of the UI; the in-memory room service (`src/service/dev.ts`) that replaced the Cloudflare Worker, so the guest↔guest signalling change lives in `gateway.ts` only; the CI split into `verify` and `e2e`; `smoke-timeout.ts` scaling in the online smoke.
- Reworked: `net-stats.ts` now summarises the runtime's own `metrics()` (per-link RTT, rollbacks, gaps, snapshot requests, hash mismatches, the stall rule) for every device rather than a phone's view of its host; `telemetry.ts` and `scripts/telemetry-report.ts` post and summarise those metrics, status changes, inputs and events instead of the host-star event kinds. The online smoke is `main`'s flow (join card, stale host key, phone lobby, lobby reload confirming the seat, `SMOKE_RIDERS`) extended with this brief's stages (three rounds, guest and creator refresh mid-round, AI rider, shared TV with controller phones).
- Rebased again on 2026-09-16 over the gravity bomb, speed boost, chain-reaction and aim-bounce settings, analytics, keyboard shortcuts and the theme switch. `checkpoint.ts` validates `gravityFields` and the new player fields as `main` does; `RULES` is `fuse-p2p-2` because the simulation changed; the transport says goodbye on its links when a page leaves on purpose (#143), as `main`'s did.

### Review fixes (2026-09-16)

An adversarial review of the pull request found six defects, all reproduced in the fake-room fixture and now covered by regression tests:

- A SETTINGS entry (an object) could not be decoded from the unreliable channel, and packets over the cap were silently dropped, so every save made the creator silent until a snapshot: the packet decoder accepts maps, the cap is 1,100 bytes and a packet is trimmed from its oldest entries.
- Gesture ids restarted after a rider was marked absent, so the next press threw: ids stay monotone across a reset.
- A lobby reset kept folds for riders it no longer seated, which made every snapshot undecodable, and a failed decode re-requested at once: orphans are pruned with the reset, and a failed snapshot waits for the retry timer.
- Delegation only covered the creator's own absence: the acting creator now carries every duty, and succession skips riders that dropped with the creator (rule above).
- A snapshot was served at the speculative tick, so a requester's own entries still in flight were lost from the replay: a peer serves the newest retained state no later than its complete tick, unless it is itself stalled on a gap nobody can repair.
- Snapshot requests are answered at most once per peer per half second.

A second review reproduced five more, all fixed with regression tests:

- A rider's replaced stream (new generation after a reload) discarded its old entries while retained snapshots still needed them, so a rollback across the replacement replayed without them: the world keeps retired streams until nothing they hold can be replayed, and a replay uses the stream whose generation the fold holds at that tick.
- A snapshot base carried the newest appended gesture even when that press was after the snapshot tick, so the joiner refused the replayed press as reused: the base counts only presses at or before its tick, plus pruned ones.
- A creator and a joiner connecting together both asked each other for a world; a `noWorld` answer left the request pending, so the creator never opened a fresh world: `noWorld` completes the request, a peer that answered it is not asked again for two seconds, and the empty-room decision runs.
- Completeness was claimed up to the first entry waiting behind a gap although the missing entry could sit anywhere before it: hashes, snapshot serving and the divergence check use the confirmed contiguous history (`confirmedThrough`), and a snapshot served past a gap the peer is stalled on folds the waiting entries by absence so the joiner does not inherit an unrepairable gap.
- Page generations were whole seconds, so two reloads within a second shared one and peers rejected the restarted stream: generations are 100 ms units since 2020-09-13.

A third round, reproduced as public-API tests (`tests/generation-replay.test.ts`), fixed the remaining generation and completeness gaps:

- After a generation change the reducer only read the fold's generation, so a returning creator's new stream could never log its own presence, and input logged on the presence tick was lost: the reducer now reads management entries from every generation of a member's stream and picks player entries by the fold's generation after management applied; snapshots carry retired streams (oldest first) that still have entries to replay.
- Confirmed completeness fell to zero when a gap opened after gap-free heartbeats, and a missing entry could share the last contiguous entry's tick: the confirmed tick is monotone (the highest `through` declared without a gap) and a gap caps it one tick before the last contiguous entry.
- Several members connecting at once never opened a world: any replica without one keeps asking peers that have not said `noWorld`, and a creator announces a fresh world in its hello.

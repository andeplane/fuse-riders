# Brief: peer-to-peer input-log networking for online rooms

Date: 2026-09-15. Status: implementation brief for `main`. Supersedes the online design in ADRs 028–032 and 035 and the discarded `codex/deterministic-action-log` branch. LAN `/display` and `/controller` are out of scope and must keep working unchanged.

## 1. Goal

Replace the host-star snapshot protocol with a peer-to-peer design where every device that renders the world simulates it locally from a shared, deterministic input log. Targets, in priority order:

1. **Latency.** A player's own input applies on the next simulation tick with no network round trip. Other players' inputs apply one network hop later. Nothing waits for a host, a certificate, or an acknowledgement.
2. **Simplicity.** One log, one packet type on the fast lane, one runtime shared by solo and online play, and fewer than ten failure states. The whole networking layer should fit in roughly 1,500 lines of source.
3. **Bandwidth.** Per-player traffic scales with input edges plus a small fixed cadence, not with world geometry. Under 15 KB/s each way per peer at 20 Hz is acceptable; an idle throttle can bring it under 5 KB/s later.
4. **Office play.** With all players on one LAN and the room service anywhere, gameplay packets never leave the LAN. The service remains signalling only.

Non-goals: cheat resistance, a TURN relay, lossless failover, physical-phone certification, and a change of tick rate. The design must make a later move to 40 or 60 Hz cheap, but this brief keeps `TICK_HZ = 20`.

## 2. Principles, and what not to build

These come directly from the discarded branch. Each one cost hours there.

- **The log is the truth.** State at tick T is a pure fold of the seed and every entry with tick ≤ T. Do not add coordinator finality, certificates, hashes-as-proof, watermarks, exact-prefix cuts, or demand/confirm cycles. Divergence detection is a diagnostic hash, not a protocol.
- **Everything is a log entry.** Start, rematch, return to lobby, settings, join, leave, avatar, bot add/remove, and presence changes are entries in the creator's stream. There are no segments, aliases, barriers, plans, prepare/ready/activate/applied handshakes, or round-transition checkpoint transfers.
- **One steady packet stream carries everything.** Every member sends a small packet to every other member every tick, and immediately on any new own entry. Liveness, completeness, loss, jitter, and RTT are all derived from that stream. No separate heartbeat, probe, pong, receipt, or clock protocols.
- **Render the speculative world.** Deaths, pickups, and scores render from the local simulation as they happen. Rollback corrects them if a late input changes history. There is no provisional-versus-finalized split.
- **Design for real networks.** LAN, home WiFi, and 4G. Do not qualify against 256 kbps sender caps.
- **Process.** One agent, one branch, one design doc (this file, updated with results), tests, and one browser harness. No per-fix ADR, independent review, or evidence manifest. Raw logs and traffic dumps go under the ignored `artifacts/` directory, never into git.

## 3. Architecture

```text
service (Cloud Run / Worker): room codes, member identity, creator token, signalling   [unchanged, plus guest↔guest signalling]

members (full mesh over WebRTC, one link per pair):
  reliable ordered channel "game"   hello, snapshot, repair-large, controller status
  unordered unreliable "input"      the per-tick packet (§5)

every member owns one input stream; the creator additionally owns the management entries
full views (personal devices, TV, creator in devices mode) simulate + roll back + render
controller-only phones (shared mode) send their stream and render a thin status
```

Roles:

| Role | Simulates | Sends | Receives |
| --- | --- | --- | --- |
| Full view | yes | per-tick packet to all | packets from all, snapshots on join |
| Controller-only | no | per-tick packet to all | packets from all (for clock and liveness), thin status from the time authority |
| Creator | as its role above | management entries in its own stream | hello messages from joiners |
| Time authority | yes | its clock is the reference; also sends thin status to controllers | – |

The creator is the member holding the room's host token, as the service already reports in `welcome`. The time authority is the creator's device when it is a full view, otherwise the full view with the lowest member id (the TV in shared mode). If the time authority disappears, the next lowest full view takes over; followers slew to it.

## 4. Log and reducer

Each member has one stream identified by `(memberId, generation)`. Entries are MessagePack arrays:

```text
[seq, tick, kind, ...args]        seq starts at 1 and increases by 1; tick is absolute and non-decreasing

player kinds (any member, own stream only):
 0 steer    [seq, tick, 0, flags]                 left=1, right=2
 1 aim      [seq, tick, 1, x, y]                  0..65535 each, meaning 0..1 of arena width/height
 2 press    [seq, tick, 2, gestureId]             gestureId increases by 1 per press
 3 release  [seq, tick, 3, gestureId, x?, y?]     fires the active gesture with this final aim
 4 cancel   [seq, tick, 4, gestureId]
 5 avatar   [seq, tick, 5, avatarId]

management kinds (creator stream only):
10 join     [seq, tick, 10, memberId, name, slot, avatarId]
11 leave    [seq, tick, 11, memberId]
12 presence [seq, tick, 12, memberId, connected, generation]
13 settings [seq, tick, 13, settings]
14 action   [seq, tick, 14, "start" | "rematch" | "lobby", newMatchId]
15 bot      [seq, tick, 15, "add" | "remove", botId, name?, slot?]
```

Reducer `applyTick(state, T, entriesByStream)` in `src/shared/`:

1. Apply the creator's management entries stamped T in seq order. They call the existing `addPlayer`, `removePlayer`, `setPlayerConnected`, `startMatch`, `resetMatch`, `returnToLobby`, and settings assignment from `game.ts`.
2. For each player, fold its entries stamped T in seq order into held controls and an ordered bomb command list, reproducing `BombInputBuffer` semantics: a press allocates a gesture and enqueues `press`; a press while one is active enqueues `cancel` then `press`; release or cancel with a matching gesture id enqueues the command; a mismatched id is a no-op; aim updates the held aim.
3. Build the `InputIntent` map exactly as `HostSession.advance` does today, using held controls for players with no entries, and call `step(game, inputs)`.
4. Run the automatic round progression from `HostSession.advance`: when `roundOver` expires, prune players with `connected === false`, apply pending powerup settings, and `startNextRound` if at least two connected players remain.
5. Outside `playing`, clear every player's `bombChargeStartedTick` and `bombTarget`.

Bots are ordinary streams. The creator's device runs `BotController` each tick and logs the resulting edges into a stream per bot. Bot decision code therefore needs no determinism.

Determinism requirements for `src/shared/`: replace every `Math.sin`, `Math.cos`, `Math.atan2` with pinned `@stdlib/math-base-special-*` JavaScript entry points, and every `Math.hypot` with `Math.sqrt(x*x+y*y)`. There are about 30 call sites across `game.ts`, `rider-motion.ts`, `gun.ts`, `shell.ts`, `drunk.ts`, `bomb-launch.ts`, `launch-modifiers.ts`, and `bot-controller.ts`. The seeded `randomState` already lives in `GameState`; keep `Date.now` and `performance` out of `src/shared/`. Add one string constant `RULES = 'fuse-p2p-1'` in `src/shared/` and bump it on any simulation change.

## 5. The per-tick packet

Sent on the `input` channel from every member to every other member once per tick, and additionally the moment a new own entry exists. Built per recipient because the echo fields differ.

```text
[ 1,                    protocol version
  roomHash,             uint32 FNV of the room incarnation
  fromIndex,            sender's index in the roster
  generation,           sender stream generation
  through,              "no further entries of mine will carry tick ≤ through"  (= floor(local clock tick))
  lastSeq,              highest seq the sender has issued
  entries,              newest ≤ 6 entries, plus rotation through the retained window (§6)
  sentAt,               sender monotonic ms, uint32 wrap
  echoSentAt, echoHeld, the recipient's most recent sentAt seen by the sender, and ms it was held
  hash | null           every 20 ticks from full views: hash of state at tick (through − 40)
]
```

Limits: encoded ≤ 512 bytes, entries ≤ 6, decoded before any allocation beyond that. Aim is quantized to uint16 so a packet with six entries stays under 120 bytes of payload.

What each receiver derives from the stream, per sender:

- **Completeness**: `through`. Simulation beyond a stream's `through` predicts held controls.
- **Liveness**: time since the last packet. Over 250 ms shows a link indicator. Over 1,000 ms is the creator's disconnect threshold (§7).
- **RTT and clock**: from `sentAt` and the echo fields, every packet is a sample. Only the time authority's samples move the clock; others feed per-link diagnostics.
- **Loss and jitter**: gaps in `lastSeq` and lateness of entries relative to their tick.

## 6. Delivery, repair, and bounds

Each member retains its own last 64 entries or 2 seconds, whichever is smaller. Each packet includes the newest entries and rotates older retained entries into the spare slots, so every retained entry is resent at least every ~600 ms with no acknowledgements at all. A receiver that sees a seq gap sends `[1, roomHash, "nack", fromIndex, firstMissingSeq]` on the fast lane; the owner replies with a packet containing those entries. A gap older than the retained window cannot be repaired and triggers a snapshot request (§8).

Receiver validation: version, room hash, sender index matches the link, generation is current, seq ≤ lastSeq, tick non-decreasing within the stream, tick ≥ 1 and ≤ local tick + 14, gesture ids strictly increasing on press, management kinds only from the creator's stream, entries with tick ≤ the stream's disconnect tick discarded. Reject the whole packet on any invalid entry; never partially apply.

Bounds, all fixed: rollback window 40 ticks; snapshots every 4 ticks, 12 retained; 64 retained entries per stream per member; 256 buffered out-of-order entries per stream; packet 512 bytes; snapshot 2 MB; `bufferedAmount` above 16 KB skips cadence sends on that link.

## 7. Clock, time, and disconnects

Local clock in `src/online/clock.ts`, injected monotonic `now()`: `tick = base + (now − t0) / 50`. The time authority sets `t0` when it applies the `start` action and includes `base` and its own `sentAt` in every packet; followers estimate the offset from the lowest-RTT sample in the last 2 seconds and slew at most one tick per second. Never step backwards. A follower with no sample for 2 seconds free-runs; it does not pause.

Own input timing: `tick = max(floor(clock) + 1, lastOwnTick)`. Steering, aim, and bomb changes are edge-filtered so an unchanged frame produces no entry. Optional `inputDelayTicks` defaults to 0.

Advance rule for full views: simulate to `floor(clock)`. If any stream whose player is `connected` has `through` more than 40 ticks behind, stop advancing and show "Waiting for <name>". Resume when the gap closes or the creator logs `presence(false)`.

Disconnects: when the creator has received no packet from member X for 1,000 ms, it logs `presence(X, false, gen)` at its current tick + 1. Every simulation then treats X as neutral input from that tick and the game's existing disconnected-player rules apply. When X returns it sends `hello`, the creator logs `presence(X, true, gen + 1)`, X requests a snapshot, and X's stream restarts at seq 1 in the new generation. Entries from an older generation are ignored.

If the creator itself is silent for 5 seconds, the connected member with the lowest id becomes acting creator, logs `presence(creator, false)`, and owns management entries until the creator returns with a `hello`. The service still identifies the real creator, so this is a temporary delegation, not a takeover.

## 8. Snapshots: join, reconnect, and divergence

A member that needs the world (a new full view, a reconnect, a repair gap beyond the window, or a divergence) sends `snapshotRequest` on the reliable channel to the time authority. The reply is `snapshot` in ≤ 16 KB chunks:

```text
{ type: "snapshot", tick, rules, roomHash, chunk, total, bytes }
bytes = msgpack([ encodedGameState, streams: [[index, generation, seq, heldFlags, heldAim, activeGesture, latestGesture], ...], recentEntries ])
```

`encodedGameState` reuses the existing `checkpoint.ts` encoder. `recentEntries` is the sender's retained window for every stream, so the requester can replay from `tick` to the present without further requests. The requester validates the hash, installs the state atomically, replays, and only then renders. One request in flight per member, retried every 2 seconds, three consecutive failures show a reload notice.

Divergence: full views compare the time authority's periodic `hash` with their own for the same tick. A mismatch logs a diagnostic with both hashes, requests a snapshot, and shows a transient notice. Three mismatches in a minute show a persistent "Simulation out of sync, reload" notice. This is the only use of hashing.

Shared mode with no display present shows "Waiting for a display" and runs no simulation. Controller-only phones receive a thin status from the time authority on the fast lane at 10 Hz: phase, round, per-player alive and round wins, and the recipient's own bomb ready tick, charge start, armed pickups, and target. No trails or geometry.

Optional, after cutover: the creator may keep saving a snapshot to `localStorage` every 20 ticks and offer it as a fresh room's starting state when no other full view remains. This is a convenience, not failover.

## 9. Presentation and events

Full views render the local world at the fractional clock tick using `interpolateWorld` between the two most recent simulated ticks. The local rider gets the existing cosmetic immediate steering. No remote presentation delay by default; add an adaptive delay only if measured on-screen corrections are visible on WAN. Deaths, explosions, and pickups render as the local simulation produces them.

Events: keep a set of emitted `(tick, index)` keys. During re-simulation after a rollback, emit only events not yet emitted. An event that was emitted and no longer occurs is left alone. Round and match outcome UI reads the local state directly.

## 10. Transport changes

- `worker/index.ts` and `src/service/gateway.ts`: allow signalling between any two current members of the same room. Keep incarnation, connection, target, SDP and ICE validation, and quotas. Add tests for a permitted guest pair and a rejected stale target.
- `src/online/peer-transport.ts`: the member with the lexicographically smaller id initiates the offer and any ICE restart for that pair. Create two data channels, `game` (existing, reliable ordered) and `input` (`ordered: false, maxRetransmits: 0`). Keep link health, restart budget, send gate, closing-state protection, and diagnostics. Gameplay no longer consults `authorityPermitted()`; the lease remains only to resolve duplicate creator tabs.
- Fast packets carry the room hash and sender index instead of the JSON envelope. Reliable messages keep the existing envelope.

## 11. Files

New:

```text
src/shared/deterministic-math.ts   sin, cos, atan2, hypot2
src/shared/input-log.ts            entry types, validation, fold to controls        ~150 lines
src/shared/apply-tick.ts           reducer over management + player entries        ~120 lines
src/online/packet.ts               encode/decode with bounds                        ~120 lines
src/online/stream.ts               per-stream receive buffer, repair, retention     ~150 lines
src/online/rollback.ts             snapshots, re-simulate, advance, stall rule      ~200 lines
src/online/clock.ts                echo-based offset estimate and slew              ~80 lines
src/online/snapshot.ts             request/reply chunking and validation            ~120 lines
src/online/room-runtime.ts         composition, roles, cadence, thin status         ~400 lines
```

Changed: `peer-transport.ts`, `worker/index.ts`, `gateway.ts`, `ui.ts` (callbacks lose `clock` and `motion`; `state`, `event`, `status`, `ready`, `ended` stay), the shared math call sites, `package.json` (add pinned `@msgpack/msgpack` and three `@stdlib/math-base-special-*` packages), `.c8rc.json` (add the new modules).

Deleted after cutover: `host-session.ts`, `local-runtime.ts` (solo becomes a room with no peers), `world-codec.ts`, `keyframe-delivery.ts`, `recipient-ack.ts`, `deferred-command.ts`, `join-request.ts`, `tick-probes.ts`, `prediction-contract.ts`, `prediction-validation.ts`, `authority-grace.ts`, `authority-status.ts`, `shot-failure.ts`, the `LocalPrediction` ledger in `prediction.ts` (keep `interpolateWorld`), and their tests. `src/server/` is untouched.

The discarded branch is a read-only quarry, not a base: its `deterministic-math.ts`, the gesture fold in `direct-input.ts`, the replay loop in `rollback-world.ts`, the mesh and channel changes in `peer-transport.ts`, and the `direct-replay-browser.ts` and `direct-mesh-browser.ts` harness designs are worth copying. Nothing else is.

## 12. Phases and acceptance

Commit at the end of each phase. Each phase's checks are the only gate for the next.

**Phase 0, determinism.** Shared math swap and `RULES`. Acceptance: a script builds the simulation with esbuild and replays one seeded 3,000-tick five-rider recording in Node, Chromium, and WebKit, comparing the state hash every tick; all three match. Existing `game.test.ts` and LAN tests pass.

**Phase 1, log and rollback, pure.** `input-log`, `apply-tick`, `stream`, `rollback`, `clock` with injected time and no transport. Acceptance: tests cover every entry kind, gesture replacement, mismatched release, all arrival orders of the same entries converging to one hash, a late entry rolling back N ticks, the 40-tick stall, management entries from a non-creator rejected, and six replicas fed by a deterministic lossy fake network agreeing at every tick. Solo play runs on this core with zero peers.

**Phase 2, packets and delivery.** `packet`, retention and rotation, nack repair, per-sender liveness and RTT. Acceptance: a fake network with 5 percent loss, 100 ms jitter, and reordering never leaves a gap unrepaired within 600 ms; malformed and oversized packets are rejected without state change; the clock stays within one tick of the authority under asymmetric delay.

**Phase 3, transport.** Guest-to-guest signalling, mesh initiator, second channel. Acceptance: a Playwright harness with six contexts alternating Chromium and WebKit establishes all fifteen links, exchanges packets in all thirty directions, recovers from a 3-second send blackhole, and rebuilds a closed channel, with zero page errors.

**Phase 4, runtime cutover.** `room-runtime` replaces `RoomRuntime`; roles, thin status, snapshots, disconnect and reconnect, creator succession; UI rewired; old modules deleted. Acceptance: `online-smoke.ts` in Chromium and WebKit passes create, five joins, start, three rounds with bots, settings change, guest refresh mid-round, creator refresh mid-round, and shared-TV mode with two controller phones. Typecheck, worker typecheck, tests, coverage thresholds unchanged, and build all pass.

**Phase 5, measure.** Five scripted players plus a TV, one local run and one with 40 ms delay, 20 ms jitter, and 2 percent loss. Report per peer: bytes per second each way on the wire, rollbacks per minute and ticks per rollback, input to own render, input to remote render, and crash to death shown, as p50 and p95. Put raw output under `artifacts/` and a ten-line summary in this document.

## 13. Definition of done

All phases accepted; the public deployment still runs the old protocol until the user decides to switch; this document updated with the Phase 5 numbers; README's online paragraph and the architecture diagram updated; ADRs 028–032 and 035 marked superseded with a one-line pointer here. Nothing else in `docs/` needs to change.

## 14. Follow-ups this design enables

Idle cadence throttle (20 Hz active, 5 Hz idle). Adaptive input delay from measured RTT. Simulation at 40 or 60 Hz, which needs the per-tick constants in `game.ts` re-derived from per-second values. Replay export, since the log plus seed is the replay.

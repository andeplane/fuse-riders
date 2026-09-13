# Independent online netcode review

Date: 2026-09-14. Scope: `src/online`, authoritative movement/input code, online tests and benchmarks. Read-only review of implementation; no fixes included. This is a release-blocking review, not approval of smooth Internet play. Severity P1 means resolve before claiming robust public multiplayer; P2 means material quality/recovery gap.

## Findings

### P1 — Newer world streams can be permanently rejected after a delayed old keyframe

`src/online/world-codec.ts:58–60` accepts any previously unseen stream with `base=0`, retiring the current stream. Stream IDs are random UUIDs with no generation ordering. If stream B's keyframe arrives before an older, never-seen stream A keyframe (possible across RTC/WSS lanes or multiple resyncs), A rolls the decoder back and retires B. All subsequent B updates are rejected. `runtime.ts:48` requests another encoder, potentially multiplying resets under reordering.

Reproduced locally with two encoders: accept B keyframe tick 62; accept delayed A keyframe tick 60 => **accepted**; accept B delta tick 64 => **rejected**. Existing `online-core.test.ts` covers already-seen retired streams, not this case.

Acceptance: delay the first A keyframe, deliver B keyframe, then A, then B delta; B must remain authoritative. Add connection/host epochs with monotonic generations and scoped resync request IDs; reject obsolete keyframes. Differentiate stale frames from missing-base frames so stale duplicates do not cause resync storms. Rate-limit/coalesce resync requests.

### P1 — Prediction is not replay on an authoritative simulation timebase

`prediction.ts:24–38` starts replay at the first unacknowledged input's local send timestamp, while the base pose belongs to an unspecified host simulation instant. Input acknowledgements (`host-session.ts:56,78`) are received sequence numbers, not a ledger of commands applied at simulation ticks. Commands lack duration/tick metadata. A held direction across several host ticks cannot be reconstructed from these acknowledgements. With no pending input, each snapshot simply replaces prediction with a delayed pose; rendering advances again from receipt time. This is visual extrapolation with corrections, not the deterministic reconciliation contract needed for local movement to feel consistent.

`prediction.ts:49–51` additionally integrates in approximately 16 ms steps, versus host 50 ms turn-then-move steps (`shared/game.ts:417–419`). It omits drunk offsets, bounds/ricochets, predicted trail geometry and other motion rules. Even an ideal link diverges during turns. `scope` omits match/host epoch; correction smoothing uses a per-frame constant (different at 30/60/120 Hz). Local head prediction overlays authoritative trails, so the head can visibly separate from its own tail.

Acceptance: injected-clock replay tests compare local predicted pose/heading with exact authoritative results for constant turn, press/release inside a tick, delayed acknowledgements, zero pending commands, 30/60/120 Hz render, drunk mode, portal, boundary contact and reset. Define tolerances and report correction p95/p99/max, not only that a direction changes on the next frame. Share a pure movement kernel and define command tick/duration and acknowledgement semantics in an ADR before refining smoothing.

### P1 — Old controls become fresh on arrival; fire edges are not robust across transports

`host-session.ts:9,53–58` validates sequence order but not command age, round, match or connection generation. `seat.tick` becomes the current host tick on delivery; the 500 ms timeout (`:63`) therefore measures time since receipt, not age of an in-flight command. `clear()` does not invalidate already queued commands. A late press/release can execute after a pause or round boundary. Reproduced locally: after advancing beyond the watchdog, a higher-sequence delayed steering command is accepted and changes heading.

`peer-transport.ts:93–99` chooses RTC or WSS per message based on current buffering, and `:87–91` only deduplicates envelope IDs. Example: press seq 10 queues on RTC, release seq 11 arrives first by WSS; HostSession accepts 11 and then discards 10, losing the shot. Conversely, a successful `channel.send` followed by connection failure gives no application acknowledgement/retry of the fire edge; RTC success only means queued locally. A reliable channel does not guarantee delivery across replacement/fallback.

Acceptance: delayed input from the prior round/host epoch must have no effect; delayed movement must expire under a defined bounded clock policy; press/release/cancel permutations across both lanes must produce exactly one intended shot or an explicit cancellation. Give reliable actions independent IDs/acknowledgements and bounded retries, distinct from latest-wins movement state. Fresh handshake must establish input epoch and neutral controls. Do not merely make all messages unordered without first changing action/delta semantics.

### P1 — Fallback/recovery status is stronger than the implementation

`peer-transport.ts:58–60` says direct links are recovering on `failed`/`disconnected`, but does not restart ICE or renegotiate there. Offers occur on signalling membership/welcome events; an ICE-only failure may never recover direct service. `send(:96)` checks channel openness, not connection liveness, so traffic can stay queued on a disconnected link until its 64 KB threshold forces WSS. On this application's small upstream, that can be a long delay.

`createDataChannel('game')` (`:73`) defaults to reliable ordered delivery. Snapshots and inputs share a lane with keyframes and events; loss can block newer state behind old data. WSS fallback has the same ordered backlog concern. Buffered thresholds alone do not bound message age.

Acceptance: force an established direct link down without closing signalling, verify input resumes over fallback within an explicit budget, then restore connectivity and verify direct recovery without page reload. Test SCTP stall, signalling-only loss with healthy RTC, both lost, and host/guest reconnect. Use explicit transport state machine, liveness/ack timers, one active generation, ICE restart policy, and bounded action vs disposable-state queues. ADR should compare reliable single-lane simplicity with unordered latest-state plus reliable control traffic.

### P2 — Remote interpolation is arrival-driven and mixes world times

`ui.ts:57–58,104` retains two frames, resets interpolation fraction on each receipt and divides arrival elapsed time by a fixed 100 ms. `prediction.ts:55–66` only interpolates rider/shell coordinates while retaining latest trails/blasts/pickups. If a second update arrives 40 ms after the first, displayed rider interpolation immediately jumps from 40% of the old interval to its endpoint. After a 200 ms gap it freezes then starts a fixed-duration catch-up. Shells follow a straight chord through a wall or trail across a bounce. Portal/death guards are useful but do not establish a coherent render timestamp.

Acceptance: replay irregular timestamped arrivals and assert monotonic render time, bounded velocity/position discontinuity, no interpolation through a known ricochet, and time-consistent trails/collision feedback. Use a small tick-indexed interpolation buffer with adaptive delay and bounded extrapolation; separate authoritative confirmation from local cosmetic prediction.

### P2 — Browser host lifecycle is an architectural limitation, not network immunity

`runtime.ts:62–64` intentionally discards elapsed time beyond 100 ms and pauses when the host document is hidden. Phone lock, OS suspension, call or background tab pauses everyone; there is no elected replacement host. Checkpoint restore is a local best-effort snapshot, not failover or durable authoritative state. The browser host can also modify scores/collisions in its own process; no trusted server can adjudicate this topology. Host input reaches authority immediately while guests pay upstream transit and tick scheduling; the current prediction hides local response latency but does not remove hit/collision authority disadvantage.

Acceptance/decision: explicitly choose trusted-friends listen-server behavior, host suspension pause, reconnect/resume limits and room expiry. Verify phone-host foreground/background/resume on actual Safari and Chrome devices. If continuation without the creator or competitive fairness is required, an optional authoritative on-demand service is a different design. Document the compromise rather than promising seamless play through arbitrary network failure.

### P1 — Benchmarks do not yet validate the claimed network quality

`scripts/online-network-benchmark.ts:15–18` injects delay before `RTCDataChannel.send`; it cannot exercise SCTP congestion/backpressure, actual packet retransmission, loss, bandwidth caps, NAT or ICE failure. Forced WSS mode is undelayed despite the profile's delay labels (the output method correctly discloses this). It runs two browser contexts for a few seconds (`:22–34`), one held turn, no meaningful multi-player collision/ricochet/round recovery load. `ui.ts:102–104` reports latest ack/correction rather than distributions. Input-to-frame measures send callback to next rAF, including periodic heartbeats; it does not assert an actual changed pixel/pose from a user action. `sentBytes` counts attempted serialized application sends, excluding WSS wrapping, retransmits and transport overhead. These are useful diagnostics, not proof of low-loss latency or a wire bandwidth requirement.

Acceptance: deterministic application impairment suite for reorder/duplicate/drop/delay/epoch transitions, plus real browser transport impairment (latency/loss/bandwidth/queue limits) on direct and relay paths. Run five active players plus a TV for sustained rounds, increasing trails/shells, target aiming and gun impacts. Collect distributions for input-to-first-local-pose, input-to-authoritative-application, correction magnitude, remote snapshot age, resync downtime, frame time and total per-peer/host bytes. Assert budgets in CI with raw samples and seeds; keep external NAT/mobile/WAN tests distinct from local automated evidence. Do not infer Counter-Strike-like smoothness from a next-rAF metric.

## ADRs required before calling this architecture settled

1. **Authority and host lifecycle:** trusted browser listen-server; what the host can cheat; suspension policy; reconnect/checkpoint limits; optional dedicated/on-demand authority as alternative.
2. **Simulation/prediction time:** shared deterministic movement, tick schedule, input durations/sequences, applied-input acknowledgements, drift correction, render time and discontinuity handling; compare state extrapolation with replay and full rollback.
3. **Transport delivery contract:** reliable actions versus disposable motion/state; SCTP ordering; WSS fallback state machine; explicit epochs, retries, expiry and ICE recovery; throughput/backlog budgets.
4. **World replication:** tick/generation ordering, keyframe baselines, snapshot schema validation, resync coalescing, precision/compression and event confirmation. A room-setting change is also a versioned simulation rule change.
5. **Network acceptance and fairness:** target mobile frame budgets, RTT/loss envelopes, correction/downtime limits, host advantage accepted for friends, what the product says when links exceed its supported envelope.

## Suggested review gate sequence

Agree on those contracts first. Add failing deterministic regressions for stream rollback and cross-lane action ordering; implement the protocol/timebase with injected clocks/transports; rerun independent code review; run all-browser impairment tests and then actual mobile/WAN acceptance. Keep the existing LAN build available while this online prototype is hardened. Existing typed helpers, host-side collision authority, trail deltas and keyframe recovery are useful foundations, but the current tests do not yet prove this gate.

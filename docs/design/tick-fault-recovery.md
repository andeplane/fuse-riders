# Recovering from a tick that throws (issue #253, C8)

Stacked on the [engine pipeline](engine-pipeline.md). That change made a throw diagnosable — `step` names the tick and the phase in a `TickFault` — and left its consequences as they are on `main`. This one decides the consequences.

## What a throw is

The fold is deterministic: same state, same log, same code, same result. A throw is a result. So a tick that throws at a **confirmed** tick — one simulated from a complete log — throws on every honest replica running the same rules. That is the common case, and no replica "got past it". The other cases are the ones in which replicas differ:

- **Speculation.** A replica simulates ahead of the confirmed log with predicted inputs. A throw under a prediction may not exist under the real inputs.
- **The odd one out.** This replica's state has diverged from the room's, or its engine failed in a way the others' did not (memory, stack, an engine bug). A peer did get past the tick.

A design that treats every throw as "ask a peer for its state" is wrong for the common case: nobody has a state past the tick, every answer is a stand-in from before it, and installing one leads straight back to the throw. The first version of this work did exactly that, and review measured it: three replicas, one failing tick, 130 s — 99 reported faults per replica, 447 snapshot requests, still going. After this change the same run gives 2 faults per replica, no snapshot request, no packet after the stop.

## What `main` does, honestly

On `main` (and on the pipeline branch) nothing catches the throw. It escapes the interval callback; that loop iteration sends no packets and publishes no frame; the state is left part-way through the tick with `state.tick` already advanced, so the next iteration carries on from the next tick.

- For a **one-off deterministic throw** `main` is kinder than any recovery: every replica holds the same half-applied tick, hashes agree, and play continues with one glitched tick.
- For a **persistent throw** (a state that throws every tick) `main` degrades into a room that keeps "running" on a state no phase has finished writing, with an error per tick in the console and nothing telling the player.
- A half-applied state is what `main` hashes, serves to a joiner and draws. Nothing validates it.

This change is better for persistent throws, for diagnosability, and for never showing or shipping a half-applied state. For the one-off deterministic throw it is worse for the players: the match stops for everyone, where `main` would have glitched and gone on. That is accepted deliberately. A tick that threw did not compute the rules; carrying on from it means every later outcome of the match rests on a state nobody can vouch for, in a game whose whole netcode is built on replicas being able to vouch for their state. It has to be bounded and honest, and it is.

## Decision

`step` and `applyTick` stay non-transactional: a `structuredClone(RoomState)` per tick measured 182 µs against about 215 µs for the tick. The `World` already retains snapshots for rollback, so it can always stand on a whole state from before any tick at no cost to the ticks that succeed.

**The world.** `World.simulate` catches a throw from `applyTick`, drops the part-simulated state, stands on the newest retained snapshot from before the tick, and sets `world.fault`. While faulted it simulates nothing, and it vouches for nothing: `hashAt` returns `undefined`, because entries that arrive after it stood down are logged but not applied, so a retained snapshot may no longer be the fold of its log — and because a hash is how peers learn that a replica got past a tick. The fault clears in three ways: `install`; `retry()`; and `receive` accepting an entry stamped at or before the faulted tick, which means the tick threw under inputs that have since changed.

**The runtime** (`RoomRuntime.noteFault`, `watchFault`, `weighFaultEvidence`, `stopSimulation`):

1. **Speculative fault** (`fault.tick > completeTick()`): wait. Nothing is asked of anyone and no strike is spent. The correcting entry clears the fault by itself and the ordinary rollback or the next `advance` re-simulates from the whole snapshot. This is the misprediction case, and it now costs what it costs on `main`: nothing. Measured with 300 ms one-way latency: the two predicting replicas were past the tick 300 ms after it, the moment the release arrived, with no snapshot request and no strike (the first version spent a strike and a snapshot transfer on each).
2. **Inputs complete**: simulate the tick once more. It costs a few ticks of local re-simulation, touches no network, and settles a failure that was not deterministic after all.
3. **Threw again: confirmed.** A confirmed-tick fault is **not** followed by a snapshot round. It is followed by a wait of `FAULT_EVIDENCE_MS` for one specific piece of evidence: any peer's packet carrying a desync hash for a tick at or past the faulted one. A replica only hashes ticks it has simulated from a complete log (§8 of ADR 047), and a faulted replica sends no hashes, so such a hash proves that peer got past the tick and that this replica is the odd one out. Only then is a snapshot requested, from that peer. It counts as a divergence, because it is one: a strike in the same `mismatches` window, and at `DIVERGENCE_LIMIT` strikes the page stops instead.
4. **No evidence in time, nobody to hear from (solo), or the recovery deadline expires: stop.** Terminal for the page: status "Simulation stopped — reload this page" (`StatusNotices.terminal`, so no connection status papers over it). A stopped page does not simulate, ask for, accept or serve snapshots, log what it is sent, take input, or send packets. To its peers it is a closed tab, and presence and authority move on through the paths a closed tab already takes (`DISCONNECT_MS`, `CREATOR_SILENCE_MS`). Nothing on it grows or repeats.

Why wait for evidence instead of stopping at once on a confirmed fault: the odd-one-out case is real and cheap to recognise, and the wait is bounded and silent on the network. Why not ask first and see: that is the loop above. `FAULT_EVIDENCE_MS` is 6 s, twice the 3 s (`HASH_LAG` + `HASH_INTERVAL` ticks) a peer's hash for a tick takes to appear.

The whole attempt also has a `FAULT_RECOVERY_MS` deadline (14 s from the first fault): the evidence allowance plus four snapshot retry intervals. It includes waiting for speculative inputs and snapshot delivery after evidence. A departing input owner cannot strand the frozen world, and a hash followed by lost snapshots cannot cause endless retries. Evidence and snapshot installation do not restart this deadline; only advancing past the failed tick clears it.

**A faulted replica as a peer.** It does not answer `snapshotRequest` at all — not even `noWorld`, which a returning creator counts towards opening a fresh room over a live match; the requester's retry timer rotates to another peer. It sends no hashes. Until it stops it keeps sending its own entries, so the others do not stall on it.

**Reporting.** Every fault occurrence goes to `RuntimeOptions.simulationError`, else `console.error`, and to `faults` / `lastFault` / `stopped` in `RuntimeMetrics`, which the page's telemetry already posts. Occurrences are bounded: one per speculative attempt (each needs a new correcting entry), one for the retry, and then at most `DIVERGENCE_LIMIT` replacements.

**The silent tolerance.** The statistics recorders drop what they cannot attribute rather than throw mid-tick. The runtime now says so once per match (`simulationWarning`, else `console.warn`) when a rider of the round has no statistics entry. The snapshot validator rejects a state with a living rider or a bomb owner lacking statistics (`codec/checkpoint.ts`), so damage of that kind cannot arrive from a peer — and a room whose replicas all carry it cannot be joined. A distance that is not a number is still dropped silently; nothing outside the engine can see it.

## What is bounded, and by what

| Thing                                          | Bound                                                                                                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Faults reported for one failing confirmed tick | 2 per replica (when it happened, and the retry), plus one per correcting entry that arrives while it is still speculative                                        |
| Snapshot requests caused by a fault            | 0 without evidence; with evidence, one tracked request (the existing retry and rotation), at most `DIVERGENCE_LIMIT` − 1 replacements per `DIVERGENCE_WINDOW_MS` |
| Time a faulted replica stays undecided         | `FAULT_RECOVERY_MS` total; confirmed faults without evidence stop sooner at `FAULT_EVIDENCE_MS`                                                                  |
| Traffic, logs and snapshots on a stopped page  | none; it receives nothing, sends nothing, and its world never simulates or retains                                                                               |

## Tests

`tests/tick-fault-recovery.test.ts`, all through the `phases` seam (`step` → `applyTick` → `World` → `RuntimeOptions.phases`), patching nothing: the world stands down, vouches for nothing and is replaced; a rollback that throws; a mispredicted fault heals on the correcting entry with every event once; solo stops after one retry and logs no more input; a one-off throw costs one local retry and nothing else; a replica that keeps failing a tick its peer passed is replaced once, on evidence, and the hashes converge; **every replica failing the same tick stops once and the room is silent for two more minutes**; the 300 ms misprediction scenario; a failing authority stops after its strikes, is seen as gone, and a late joiner is served by the healthy peer at the head of the room; the dropped-statistics warning fires once; evidence followed by lost snapshot delivery terminates without further requests; a speculative fault terminates when the missing input owner departs.

## Not done

- The terminal state is per page. There is no room-level "this match cannot continue" message to a rider whose own replica is healthy but whose peers all stopped; they see riders disconnect.
- A stopped page keeps its transport open. Closing it would be tidier but changes what the service sees; left for the owner.
- `outOfSync` is still never cleared, as ADR 047 §8 records for divergences.

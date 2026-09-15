# ADR 042: Replicate committed actions instead of world state

Date: 2026-09-15. Status: implemented for user testing; third step of the deterministic action-log plan. Supersedes the world delta stream and keyframe receipt handling of [ADR030](030-online-delivery-and-replication.md) and [ADR035](035-direct-gameplay-only.md); keeps their authority, fencing and direct-only decisions.

## Problem

The host encoded a JSON world delta per peer at 20 Hz. Any break in the chain needed a keyframe of tens of kilobytes plus a receipt round trip, and every delta to that peer waited behind it. Traffic scaled with trail geometry rather than with what players did.

## Decision

Full views run the shared simulation. The host sends each peer one baseline (exact game state, held controls, journal sequence, hash and settings) and then, every tick, the journal operations committed since the last sequence that peer has. A view replays them with the shared reducer from [ADR041](041-shared-action-journal.md) and renders `toSnapshot` of its own game, so the renderer, remote interpolation and local prediction are unchanged.

Delivery stays on the ordered reliable channel in this step. A refused send is retried from the same sequence at the next publish; a peer further behind than the journal remembers gets a new baseline; there are no receipts. The host includes a replica hash every 20 ticks. A gap, hash mismatch, malformed batch or wrong protocol makes the view request `resync`, rate limited to twice per second, and it keeps showing its last good state until the baseline arrives. Settings ride in the baseline and then only when they change. Events are still sent by the host so audio and effects have a single source.

Deleted: the world codec, keyframe delivery, recipient acknowledgement filtering and the delta benchmark; `scripts/benchmark-actions.ts` measures the new stream.

## Consequences

`scripts/benchmark-actions.ts` measures about 2.7 KB/s of application bytes per view with four AI riders in JSON, against 23.6 KB/s recorded for the old codec at 10 Hz (roughly 47 KB/s at today's 20 Hz); a lost delta no longer costs a keyframe. The JSON envelope is now most of each batch, which the compact codec of the next step addresses. Every full view now runs the simulation, which costs CPU on phones; controller-only phones are the next step. Cross-engine determinism rests on ADR041's math binding and is checked live by the hash. The unreliable path with redundancy and repair is the step after this.

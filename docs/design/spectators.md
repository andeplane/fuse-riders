# Spectators

> Phase G of the lobby roster and spectators plan, under fold rules `fuse-p2p-41`. What the room agrees on, why it
> agrees on it there, and what it costs. The optional follow-ups it names (O4, O5, O8) are that plan's.

## What a spectator is

A named, listed member of the room with no seat. It sees the arena, the standings and the results; it steers nothing,
scores nothing and is in no match report. The join card offers it under `JOIN AS PLAYER` as a quieter
`JOIN AS SPECTATOR`, and the lobby lists it under the riders in a `WATCHING` block.

It is not a TV display. `?room=CODE&display=1` stays what it always was: an unlisted viewer that takes a socket, shows
the arena for a shared screen and appears in nobody's roster. A spectator is a person the room can see is there.

## Why the list is in the log, not in the connections

Everything the room must agree on goes into the shared input log, because every device folds the same log
([ADR 047](../adr/047-p2p-input-log-lockstep-rollback.md)). The voice roster is connection-scoped and that is right for
it: a device that missed a voice event has a worse call, not a different room. The watching list is not like that. It is
capped, so two devices that disagree about who is watching disagree about whether the next one fits. It ranks in the
succession order, so they would disagree about who runs the room. It has to survive a reload, and a reloading page
recovers state from a peer's snapshot and nothing else. So `RoomState.spectators` is folded, hashed and carried in the
snapshot, exactly like the seats.

## The model

- `RoomState.spectators: Map<id, { name, connected, generation }>`, at most `MAX_SPECTATORS` = 5
  (`games/fuse-riders/src/engine/apply-tick.ts`).
- One new management entry, `SPECTATOR` (kind 16), in two shapes: `join` with a member id, name and generation, and
  `leave` with a member id. `isManagementKind` spans 10–16, so it is a manager's to write and refused from anyone else.
- `PRESENCE` and `LEAVE` look a member up in the watching list as well as in the seats.
- A member is a rider or a watcher, never both: `JOIN` is a no-op for a listed spectator and `SPECTATOR join` for a
  seated rider. Switching sides is deliberately not in this pass (plan §10 O4); it would be leave-then-join.
- A spectator never reaches `step`, the leaderboard, the match report or `toView`. It travels to the screen beside the
  world view, on the runtime's `Frame`, because it is the room's state and not the game's.

## Presence, and why nothing waits on a watcher

A spectator's presence is logged by the same two rules as a rider's: the manager logs `PRESENCE false` after
`DISCONNECT_MS` of silence it could have heard, and `PRESENCE true` when a packet arrives again. What differs is what
its absence frees. A rider mid-match keeps its seat until the round boundary, because the seat is simulation state; a
watcher holds nothing, so in the lobby its place is freed outright (`SPECTATOR leave`) and during a match it is simply
listed as away until the next `start`, `rematch` or `lobby` drops it.

`completeTick()` and `stallBound()` iterate the seated riders, so they never wait on a spectator's stream. That falls
out of the model rather than being a special case, and it is the property that makes spectators cheap to be wrong
about: a watcher whose link dies cannot stall a round, and a late management entry from a watching manager rolls the
world back the same way a late entry from an unseated creator always has.

## Succession, and the host who watches

`successionOrder` is now the creator, then the connected human riders by id, then the connected spectators by id.
Watchers rank last because a room with a seat left in it should be managed from that seat — but they do rank, so a room
whose riders have all dropped is still run by whoever is left watching.

`actingCreator` reads presence through `memberConnected`, which looks in both places. A creator that watches its own
room is therefore present and keeps the crown alone. Before this, a creator with no seat had no record at all, so
`actingCreator` named a rider and two members ran `creatorDuties` at once; a tournament host who wants to commentate
now says so by joining the watching list, and the room has one manager again. A creator with no record of either kind —
a TV host on an unjoined page — still gets the old two-manager behaviour, unchanged.

## Capacity and mesh cost

`ROOM_LIMITS.maxGuests` moves from 5 to 10, so a room admits eleven sockets: the creator, four more riders, five
spectators and a TV display. That is the game's setting, passed into the signalling package, whose own
`DEFAULT_MAX_GUESTS` stays 5; it is a capacity change and not a wire-protocol version change, so every service instance
takes it without a protocol bump. `games/fuse-riders/tests/spectators.test.ts` pins the arithmetic against `MAX_PLAYERS` and
`MAX_SPECTATORS` so the three numbers cannot drift apart.

The cost is the mesh. Eleven members is 55 links, against 15 for six. A phone sends one packet per tick to every other
member, so a full room roughly doubles a rider's upload against today's six-member worst case. Spectators carry no
inputs, so their packets are almost empty and they are the cheapest members to add — but they are not free, and they
are received by everyone. Cheaper spectators (a quarter-cadence tick packet, and riders skipping speculative packets to
them) is plan §10 O5, and should be measured with `scripts/p2p-measure.ts` at ten members before it is built.
This change has not been measured at eleven members; the mesh numbers on record are still the five-riders-plus-TV run
in the [measurement report](../online/P2P-INPUT-LOG-BRIEF.md).

The raised capacity also doubles `L`, the links one member negotiates through the room service, which the signalling
abuse budget was sized against: see the note in
[signalling abuse isolation](signalling-abuse-isolation.md#what-eleven-members-cost). Nothing there is a correctness
bound — a refused signalling frame costs a late link, not a torn mesh — but the room-level publish allowance and the
flood tolerance no longer have the margin they were sized for, and that should be revisited before rooms routinely
run full.

## What is deliberately not here

- **No kick for spectators.** The manager cannot remove a watcher yet, because the kick command itself is phase D of
  the plan and has not landed. `LEAVE` already frees a watcher in the fold, so kick will reach them for free.
- **No host crown in the list.** A watcher's row says `HOST · WATCHING` only on the host's own device, because that is
  the only device that knows today. The crown that every device can draw is phase B.
- **No ready check.** The footer counts `N riders ready · N watching`; readiness itself is phase E.
- **No voice.** `voice.setRoster` is still the seated riders.
- **No switching sides mid-room**, no spectator camera, no cheaper spectator packets: plan §10 O4, O8 and O5.

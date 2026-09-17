# Rooms survive their creator leaving

Implements the room-lifetime part of #258 N5. An admitted member's service heartbeat
keeps the room alive even after its creator disconnects. Admission and each valid
heartbeat extend the room deadline by `ROOM_RECONNECT_GRACE_MS` (90 seconds).
A current member's explicit departure also starts that grace, giving the final
member time to reconnect. Expired or replaced connections cannot heartbeat;
delayed departures cannot revive an ended or expired room. The creator's explicit end is
absolute: it writes the deadline `ROOM_ENDED_AT` (0) rather than the ending instance's
"now", so a heartbeat or departure handled by another instance whose clock runs behind
still reads the room as ended and the code is reusable at once. A departure restarts the
grace only while that member's own connection lease is live; a member whose lease already
lapsed had stopped renewing the room, so its late socket close removes it without moving
the deadline. Since #256 S4 a heartbeat only _writes_ the extension once the member's lease is
within its renewal margin ([heartbeat write cost](heartbeat-write-cost.md)); under a steady
two-second heartbeat the deadline of an occupied room stays 80 to 90 seconds away.

The creator's identity, reserved seat and explicit end capability remain unchanged.
Room lifetime is separate from the creator authority grant: guests renew room
membership, never the creator's grant. Game management still uses the existing
input-log succession rules; this change does not resolve partition elections or
partial-mesh failures. Service metadata contains no game state. A returning device
must recover the world from a peer; an empty room retained during reconnect grace
has no durable world to recover.

This removes the previous 90-second limit on play after the creator leaves without
adding a simulation server, gameplay relay or additional heartbeat frequency. An
occupied room can retain service metadata indefinitely, with existing per-member
connection leases and request controls. Hidden devices still need service
heartbeats; browser suspension is a separate policy from creator ownership.

Verification combines the real in-memory room store and gateway with the existing
deterministic peer-network fixture: a guest keeps its socket and world advancing
for 140 seconds without the creator, signalling still routes, and the creator
rejoins and receives the retained peer match. The fixture coordinates service and
peer lifecycle explicitly; it is not WebRTC or physical-phone evidence. Additional
store tests cover guest reconnect, stale/expired connections, exact expiry and
creator-only explicit end.

Wire envelopes and simulation rules are unchanged. Deployment must update all
service instances: older instances retain creator-only renewal behavior. Rolling
back restores that behavior, so rooms without their creator stop extending their
room deadline and eventually expire despite guest heartbeats. This change is not
published by merging its source alone.

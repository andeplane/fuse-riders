# Signalling abuse stays within its room

Issue #256 S1/S2 is reproducible in the extracted networking service: all local
and bus deliveries shared a 4096-ID dedupe window whose overflow restarted every
room, while database admission and departure shared one gateway-wide queue.

Each live room now owns a 512-ID bus-only dedupe window. Overflow drops the new
frame, preserves already accepted IDs, and never restarts the gateway. Entries
expire within ten seconds; removing or replacing the room releases its window.
Local delivery has no retry window. Per-member signalling permits a 32-message
ICE burst and refills at five messages per second; exceeding it closes that
sender. Existing frame, byte, pending-message and slow-socket limits remain.
The burst accommodates candidate gathering across the mesh; it is not a claim
that every network's negotiation workload is identical.

Admission and departure serialize per room. Only bus start/stop transitions
remain globally serialized; active room operations keep the shared bus alive.
A bus failure fences admissions already awaiting the database, so they cannot
publish a welcome against a restarted subscription. Shutdown waits for pending
room work before removing its sockets.

WebSocket admission checks a shared, separately namespaced budget of 30 failures
per IP per hour. Successful admissions and operational failures do not spend it.
The database allowance supports non-consuming checks. Each gateway also bounds
pending admissions to four per IP and 128 total, before database access; it caches
blocked IPs for that hour in a bounded map. Parallel requests already admitted
past the budget check can exceed the hourly failure limit by the bounded local
in-flight count on each active gateway. This is an abuse limit, not authentication:
room codes and the trusted-member mesh model are unchanged.

The protocol envelopes and database room records do not change. Existing room
creation limits retain their keys and accounting. The Firestore allowance
collection retains its existing name; admission uses distinct hashed keys.
No game simulation, relay, new hosted service or persistence is added.

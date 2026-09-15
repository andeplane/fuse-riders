# ADR 039: short codes and host-session room lifetime

Status: accepted after independent root review; implementation and deployment verification in progress.

## User intent and default semantics

New room codes look like `AB42`: two uppercase letters followed by two digits, giving 67,600 public rendezvous codes. A room represents one hosted play session, including its lobby, rounds, results and rematches. It does not disappear between rounds or immediately at a match recap. It closes when the host explicitly leaves/ends it, or after 90 seconds without the host's signalling heartbeat. Refreshes, brief network problems and BFCache restoration can reconnect during that grace period. Guests alone cannot keep an abandoned room alive.

This replaces the current 24-hour sliding lifetime, which every guest heartbeat extends. The 90-second deadline is enforced synchronously by API admission/heartbeat/routing checks; Firestore TTL cleanup is eventual and is not the access-control mechanism.

## Code allocation and authentication

- Codes are deliberately enumerable and are not passwords. Existing 64-hex capability tokens, host hashing, authority incarnation/epoch fencing, six-socket cap and 30-creations/hour per-address limit remain unchanged. Knowing a room code still permits requesting a guest seat, as the current product intends; it never grants host authority.
- Generate new codes uniformly with cryptographic random integers and rejection sampling, with injected randomness for deterministic tests. No Math.random or biased modulo mapping.
- Creation retries at most 12 collision candidates. Each candidate is reserved by the existing authoritative transaction; a live room is never overwritten. Retry only the explicit room-exists conflict. Exhaustion returns a retryable 503. Creation-rate accounting happens once per user request, not once per collision.
- Accept the new format and existing 10-character uppercase alphanumeric codes during transition (the transition ended with #71: only the short format is accepted now). All newly generated codes use the short format. Shared validation is used by service, Worker and client; error copy uses `AB42`, not a ten-character requirement.

## Session lifetime and explicit end

- Newly created rooms have an initial 90-second deadline to connect the host. Only successful host admission/heartbeat extends it to now + 90 seconds. Guest admission/heartbeat updates its member lease but never room lifetime.
- A current host socket's clean disconnect grants 90 seconds to reconnect. A replaced/stale host socket's delayed close cannot change the new connection's deadline. Crashed gateways are covered by the last host heartbeat deadline without relying on socket-close delivery.
- `POST /api/rooms/:code/end`, with the existing host capability in `Authorization: Bearer <token>`, atomically expires that room immediately. Guests receive 403. The host UI calls this only for explicit host leave/end; normal pagehide/refresh does not call it. POST is idempotent for the same host capability while the expired metadata remains, and can never end a subsequently reused room with a different capability.
- The service writes an expired tombstone for immediate rejection and watcher notification; existing Firestore TTL eventually deletes it. The Worker schedules its alarm at the same deadline and rejects expired requests even before the alarm executes. Local Worker storage is reset on eligible code reuse, including old authority metadata.
- Cached gateway signalling paths check room expiry as well as membership/incarnation. A bounded gateway expiry timer rechecks metadata once at its deadline before closing silent sockets; delayed metadata updates cannot falsely expire a renewed room. A failed recheck closes transiently for retry. Expired/ended rooms close connected signalling sockets with terminal code 4004; stale cached messages must not keep routing simply because Firestore TTL has not run. Clients stop retry, probes, peer links and pending runtime actions on 4004, preventing stale tabs from joining a later reuse of the public code. Existing direct gameplay authority leases bound any old peer's remaining authority; ending the host UI stops its runtime immediately.
- Reusing an expired code always creates a fresh capability and incarnation; membership and prior grant are cleared. Stale closes, signals and renewals cannot mutate the new session. Awaited admission/time/read results are fenced against their originating incarnation; cancelled metadata-watch callbacks cannot mutate a new View. Transaction retry callbacks remain side-effect-free; random tokens are generated outside retry callbacks.

## Scope and ownership

This is metadata/signalling lifecycle work only; there is no gameplay service or Firestore gameplay mailbox. Root owns landing/room UI changes and must wire explicit host leave to the end endpoint. This subtask owns shared code generation/validation, service and Worker adapters, HTTP/backend tests, and smoke format expectations. No deployment or browser run occurs without root coordination.

## Acceptance

1. New codes exactly match `[A-Z]{2}[0-9]{2}`; deterministic boundaries and random rejection tested. Legacy input remained accepted until #71 removed it; malformed codes rejected.
2. Inject colliding candidates: existing live room/capability/authority is unchanged, the next candidate succeeds, and bounded exhaustion returns 503 without unbounded retries.
3. Host heartbeat extends lifetime; guest heartbeat never does. At the exact deadline, get/admit/time/signal reject even if metadata remains. A valid host reconnect before the deadline resumes under existing fencing; after it fails.
4. Explicit end requires the host capability, is idempotent without affecting a reused incarnation, closes routing, and does not run on round/match completion or ordinary refresh.
5. Old socket close/renewal after replacement or code reuse cannot shorten, renew or delete the new session. Worker alarm and API guards agree.
6. Full typechecks/coverage, updated public smoke and an isolated create/join/host-end browser check before deployment. No claim that the Firestore document vanishes synchronously; logical room lifetime is the user-visible guarantee.

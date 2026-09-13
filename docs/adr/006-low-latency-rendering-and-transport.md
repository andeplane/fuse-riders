# ADR-006: Low-latency rendering and role-specific transport

- Status: Accepted (reviewed before implementation)
- Date: 2026-09-13

## Context

The full trail fixture measured a 7.10 FPS median with 133.4 ms p95 frame time. Per-segment glow work is the dominant renderer cost. A measured full snapshot containing 800 trail segments was 92,050 bytes; six such clients at 10 Hz would require about 5.52 MB/s. The TV display needs complete world state, while controllers need responsive feedback and roster/cooldown state rather than private geometry.

## Decision

Keep the authoritative simulation and gameplay rules unchanged. The host-authenticated display receives a complete snapshot at 20 Hz, serialized once per tick and reused for that broadcast. Joined controllers and unauthenticated spectators receive compact snapshots at 10 Hz: omit trails, bombs, and blasts while retaining player positions/angles/alive metadata, phase/timers, roster, scores, and cooldowns. Role-specific payloads are selected server-side and are validated by the shared protocol.

Remove the display's fixed 100 ms buffer. Render the newest authoritative world state immediately, with bounded visual extrapolation of alive position and angle for at most 50 ms. Freeze the visual state when snapshots are stale. Extrapolation must never predict collisions, deaths, bombs, scores, phase transitions, or any other outcome.

Phone edge actions remain immediate. Controllers send changed input state immediately and resend held state at 10 Hz. Add typed `ping`/`pong` messages and an optional input-sequence acknowledgement so the display/controller can measure transport latency and input delivery. RTT is diagnostic only and must not be interpreted as finger-to-TV latency.

Batch trail drawing by player and lifetime bucket, cache the generated paths, and apply glow at the batch level rather than once per segment. An optional host performance overlay may display FPS and draw time for diagnosis.

## Consequences

The display gets the fidelity and update rate it needs while phone bandwidth drops substantially. Compact controller payloads cannot independently render the arena, so their UI remains intentionally limited to player/session feedback. Extrapolation improves perceived smoothness under ordinary jitter but freezes safely when the stream is stale. Cached path batches require invalidation on trail expiry, blast clearing, and snapshot scope changes.

## Verification

Performance tests should cover the full-trail fixture, batched-path rendering, serialization-once reuse, role-specific payload omission, 20 Hz display cadence, 10 Hz controller cadence, ping/pong and input acknowledgement typing, 50 ms extrapolation cap, and stale-snapshot freeze. Tests must prove that controller payloads contain no private game trails or equivalent hidden geometry and that this refactor preserves simulation outcomes.

# ADR 042: Controller-only phones in shared-TV mode

Date: 2026-09-15. Status: implemented for user testing. Extends [ADR041](041-input-log-and-rollback-core.md).

## Problem

A joined phone in shared-TV mode hides the arena and shows only phase, roster, its own cooldown and powerup flags and the match recap, yet it received every stream and ran the whole simulation, with rollback, to produce that.

## Decision

While the pending room mode is `shared`, the host sends a joined peer a `status` instead of its stream packets. The status is the snapshot with trails, projectiles, blasts, pickups and the portal removed, on the reliable channel, only when something the phone shows changes: phase, roster, connection, round wins, cooldown, armed powerups, recap statistics or the room settings. Positions and the arena inset change every tick and are excluded from that comparison. Every five ticks a `heartbeat` on the fast channel carries the same clock fields as a stream packet (host tick, send time, echo) plus the phone's own rounded position and heading, which the aim trackpad needs as its origin.

The phone keeps its stream sender and tick clock: input entries are numbered, stamped from the clock and sent exactly as a full view sends them, only without a local fold. A status drops the phone's simulation; a baseline, which the host sends the moment a peer stops being a controller, restarts it. The status is validated in full before any of it replaces the previous view, and a heartbeat older than the view is ignored. The separate TV never joins, so it keeps a full replica.

## Consequences

A controller phone receives well under 100 bytes per second while nothing changes, plus a full status of a few hundred bytes when it does, and runs no simulation. Its button feedback (charge, cooldown) waits for the next status, one round trip; a local echo of its own press and aim is a possible follow-up. It cannot show trails or projectiles, which shared-TV phones never did. LAN controllers are unaffected.

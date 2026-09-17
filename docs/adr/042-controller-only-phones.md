# ADR 042: Controller-only phones in shared-TV mode

Date: 2026-09-15. Status: **Superseded by [ADR 047](047-p2p-input-log-lockstep-rollback.md)**, which records the peer-to-peer cutover (history in [docs/online/P2P-INPUT-LOG-BRIEF.md](../online/P2P-INPUT-LOG-BRIEF.md)): there is no host to send a status, so a controller phone in shared-TV mode simulates the world like every other member and only hides the arena. The text below is the original decision. Extends [ADR041](041-input-log-and-rollback-core.md).

## Problem

A joined phone in shared-TV mode hides the arena and shows only phase, roster, its own cooldown and powerup flags and the match recap, yet it received every stream and ran the whole simulation, with rollback, to produce that.

## Decision

While the pending room mode is `shared`, the host sends a joined peer a `status` instead of its stream packets. The status is the snapshot with trails, projectiles, blasts, pickups and the portal removed, on the reliable channel, only when something the phone shows changes: phase, roster, connection, round wins, cooldown, armed powerups, recap statistics or the room settings. Positions and the arena inset change every tick and are excluded from that comparison. Every publish — paused ones included, where the tick does not move at all — a `heartbeat` on the fast channel carries the same clock fields as a stream packet (host tick, send time, echo) plus the phone's own rounded position and heading, which the aim trackpad needs as its origin. Every tick, not every fifth: a phone treats a second of silence as a lost host and stops sending input, so at five ticks apart three dropped datagrams were enough to do it. At 49 bytes and 20 Hz the heartbeat costs about a kilobyte a second, a fraction of the streams it replaces, and the position it carries is range-checked exactly as the snapshot guard checks a status.

The phone keeps its stream sender and tick clock: input entries are numbered, stamped from the clock and sent exactly as a full view sends them, only without a local fold. A status drops the phone's simulation; a baseline restarts it, and because a send can be refused by a hidden tab or a draining buffer, a peer stays a controller — still fed a status and a heartbeat — until that baseline has actually left the transport. A peer that is sent a baseline for any reason has its status sender retired with it, so the fresh fold is always followed by a fresh status if it turns out to still be a controller; and a phone sent stream packets it has no fold for asks for one. The status is validated in full before any of it replaces the previous view, and a heartbeat older than the view is ignored. The separate TV never joins, so it keeps a full replica.

## Consequences

A controller phone receives about a kilobyte a second of heartbeat while nothing changes, plus a full status — measured at 3.2 KB in a five-rider lobby, 3.6 KB in play and 6.9 KB once a match recap is in it — when something it shows does, and runs no simulation. Its button feedback (charge, cooldown) waits for the next status, one round trip; a local echo of its own press and aim is a possible follow-up. It cannot show trails or projectiles, which shared-TV phones never did. LAN controllers are unaffected.

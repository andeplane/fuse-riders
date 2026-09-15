# ADR 044: Controller-only phones in shared-TV mode

Date: 2026-09-15. Status: implemented for user testing; fifth and last step of the deterministic action-log plan. Extends [ADR042](042-action-replication.md) and [ADR043](043-compact-unreliable-delivery.md).

## Problem

A joined phone in shared-TV mode hides the arena and shows only phase, roster, its own cooldown and powerup flags and the match recap, yet it received the full committed stream and ran the whole simulation to produce that.

## Decision

When the room mode is `shared`, the host sends a joined peer a `status` message instead of the committed stream. The status is the snapshot with trails, projectiles, blasts, pickups and the portal removed, sent on the reliable channel only when something the phone shows changes: phase, roster, connection, round wins, cooldown, armed powerups, recap statistics, the phone's movement ledger or the room settings. Positions and the arena inset change every tick and are not part of that comparison. In between, every five ticks, a heartbeat tuple on the fast channel carries the tick, the input acknowledgement, the pause flag and the phone's own rounded position, which the aim trackpad needs as its origin. The phone rebuilds a view snapshot from the last full status plus the heartbeat and carries its movement ledger forward, so the existing UI code, prediction scheduling and audio cues are unchanged. The separate TV keeps a full replica.

The host chooses the sender per peer on every publish, so switching the room mode replaces a status sender with an action sender and the phone receives a baseline, or the reverse. A phone renders nothing before its first full status, and a heartbeat older than what it has is ignored.

## Consequences

A controller phone receives well under 100 bytes per second while nothing changes, plus a full status of a few hundred bytes when it does, and runs no simulation. It cannot show trails or projectiles, which shared-TV phones never did. LAN controllers are unaffected.

# ADR-027: Live avatar selection

Status: Accepted, 2026-09-13

A joined phone may send a validated setAvatar message in any phase. The server derives the player from the authenticated seat; the message cannot name another player. Only avatarId changes, and snapshots immediately publish the new head. Reconnection and Main Menu preserve the latest choice.

The phone's AVATAR button opens a modal picker and cancels held controls before opening. Selecting a head sends the update and closes the picker. Snapshots synchronize the selected option without invoking another change. Gameplay continues normally while choosing; appearance never changes hitboxes, movement, scores or powerups.

Amended 2026-09-17: the online room UI keeps avatar choice out of the round. Before a seat the join form carries the picker; once joined, the AVATAR button is offered in the lobby only. It is hidden from countdown through match results, and a picker left open closes when the round starts, so the mid-play flow described above no longer applies to the online UI. The log still accepts the entry in any phase; the restriction is a UI decision, not a protocol one.

Amended 2026-09-20 (rules `fuse-p2p-48`): heads are unique in a room. The `AVATAR` entry is a no-op when another rider
already wears that head, and a join repairs a taken head to the next free one in `AVATARS` order, so a table of five
friends never has two foxes on it — the earlier "duplicates are allowed, the picker only marks them" rule is reversed.
Ten heads and five seats leave room for everyone. The AI riders are the one exemption: they all wear `robot`, which is
how an AI rider is read at a glance, and `robot` shows as taken to the humans in the room while one of them sits. A
human that deliberately picked it before the host added an AI keeps it; nothing in the fold takes a head back once it is worn, and its own picker still offers it to that rider. A browser that has never chosen starts on `HUMAN_DEFAULT_AVATAR` (the fox) rather than the robot, so the ordinary solo room is one fox and four robots rather than five robots.

The picker now disables a taken head rather than merely marking it, because the fold would refuse the pick. A taken
head wears a ring in its owner's colour, and the colour picker's twin badge puts that owner's head on their colour, so
the two grids point at each other. Colour follows the same rule and is the rider's own as of the same bump: see
`RIDER_COLORS` in `games/fuse-riders/src/engine/tuning.ts` and the `COLOR` entry (kind 7).

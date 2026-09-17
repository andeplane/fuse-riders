# ADR-027: Live avatar selection

Status: Accepted, 2026-09-13

A joined phone may send a validated setAvatar message in any phase. The server derives the player from the authenticated seat; the message cannot name another player. Only avatarId changes, and snapshots immediately publish the new head. Reconnection and Main Menu preserve the latest choice.

The phone's AVATAR button opens a modal picker and cancels held controls before opening. Selecting a head sends the update and closes the picker. Snapshots synchronize the selected option without invoking another change. Gameplay continues normally while choosing; appearance never changes hitboxes, movement, scores or powerups.

Amended 2026-09-17: the online room UI keeps avatar choice out of the round. Before a seat the join form carries the picker; once joined, the AVATAR button is offered in the lobby only. It is hidden from countdown through match results, and a picker left open closes when the round starts, so the mid-play flow described above no longer applies to the online UI. The log still accepts the entry in any phase; the restriction is a UI decision, not a protocol one.

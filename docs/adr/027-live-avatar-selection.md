# ADR-027: Live avatar selection

Status: Accepted, 2026-09-13

A joined phone may send a validated setAvatar message in any phase. The server derives the player from the authenticated seat; the message cannot name another player. Only avatarId changes, and snapshots immediately publish the new head. Reconnection and Main Menu preserve the latest choice.

The phone's AVATAR button opens a modal picker and cancels held controls before opening. Selecting a head sends the update and closes the picker. Snapshots synchronize the selected option without invoking another change. Gameplay continues normally while choosing; appearance never changes hitboxes, movement, scores or powerups.

Amended 2026-09-17: the online room UI only offers the AVATAR button before joining and in the lobby. It is hidden from countdown through results, and a picker left open closes when the round starts. The log still accepts the entry in any phase; the restriction is a UI decision, not a protocol one.

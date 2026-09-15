# ADR-027: Live avatar selection

Status: Accepted, 2026-09-13

A joined phone may send a validated setAvatar message in any phase. The server derives the player from the authenticated seat; the message cannot name another player. Only avatarId changes, and snapshots immediately publish the new head. Reconnection and Main Menu preserve the latest choice.

The phone's AVATAR button opens a modal picker and cancels held controls before opening. Selecting a head sends the update and closes the picker. Snapshots synchronize the selected option without invoking another change. Gameplay continues normally while choosing; appearance never changes hitboxes, movement, scores or powerups.

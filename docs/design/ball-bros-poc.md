# Ball Bros: phases 0–1

An unranked solo POC: one human and four bots, one core per base, 24 one-hit blocks, an orbital paddle and one launchable ball per player. A/D rotate, W/Space launch. Bots emit the same steering/launch controls. Last core standing wins; a 120-second limit draws. Rematch creates a fresh match through the shared room log.

The engine is independent of app/net/render code. Base-local blocks and paddle angles leave a seam for future base movement, but bases are stationary in this version. Balls sweep against walls, rounded block corners, cores and rotating curved paddles. Five 10 ms substeps run in each fixed 50 ms log tick. Contacts break ties by collider order, balls resolve by stable id, and core eliminations commit together at the end of each substep so simultaneous final losses draw. At the contact iteration limit the ball stops for the remaining substep rather than tunnelling. Ball ownership changes on paddle contact and grants no immunity. Eliminated bases clear and their balls become neutral.

Use the existing RoomRuntime even for solo. All controls and geometry are checkpointed and hashed; only trails, particles and sound are cosmetic. Phaser owns presentation only, with its loop disabled and one app-owned presentation frame. The engine uses pinned JS trigonometry. A new game-specific rules version/golden records behavioral changes without changing Fuse Riders' rules.

Phase 1 includes service registration and a visible game link, but no online admission UI, ranked reporting, power-ups, shared music extraction or moving bases. Production remains gated by EXTRA_GAME_IDS. Phase 2 qualifies multiplayer controls/recovery and shared screens. Phase 3 adds shared avatars/music and power-ups.

Playtest first: can a beginner track the ball, reach an interception and influence the return? Initial tuning is 70° paddle coverage, ~2 s per orbit and 340 units/s balls. Five independent balls and the block ring gaps provide pressure; tuning follows playtests, not a promise of balanced rounds.

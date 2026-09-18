# ADR 023: Target Bomb

Status: Removed in fold rules `fuse-p2p-39`. Target Bomb, the `aim` input, the AIM log entry (kind 1), `targetBombArmed` and `bombTarget` no longer exist; see [PROTOCOL.md](../online/PROTOCOL.md). Kept as a record of the design.

A rare Target Bomb pickup (weight 1, ordinary weight 3) arms one targeted bomb. While Fire is held, normalized absolute aim coordinates in input packets map to the current arena dimensions and clamp to the playable rider-safe bounds. Initial preview defaults 100 units forward. Releasing creates one immediately landed bomb at that target with the ordinary fuse, cooldown and blast upgrades. Triple/Five remain armed for the following ordinary launch. Only an accepted release consumes Target Bomb.

Protocol adds optional aim {x,y}, both finite in [0,1], player targetBombArmed and optional world-space bombTarget preview. Typed buffered action records preserve the aim attached to each press/release; later packets cannot change a previously queued release. The legacy string `bombActions` intent shape, originally kept for simulation test compatibility, was removed in #75; the engine accepts only `bombCommands`. Held aim updates do not add action queue entries. Cancellation, neutral/disconnect, death and reset clear preview; cancellation preserves the pickup, round reset clears it. Server remains authoritative for target clamping, rate limits and launch acceptance.

Tests cover strict runtime validation, per-release aim ownership across between-tick input bursts, range clamping during shrink, single normal-strength bomb creation, modifiers preserved, rejected/cancelled release retention, snapshot cloning and round cleanup.

# ADR 041: Shared action journal and deterministic math

Date: 2026-09-15. Status: implemented; second step of the deterministic action-log plan (issue #82 brief). Ported from the host-coordinated stage of the stalled `codex/deterministic-action-log` branch.

## Decision

Every gameplay mutation on the online host goes through one shared reducer in `src/shared/action-log.ts`. Operations are small tuples: a simulation step with the per-slot control changes applied at that absolute tick, and lifecycle records for join, remove, connection, settings, avatar and start/next-round/lobby/rematch. `applyOperation` is the only way a replica changes state, so `initial state + ordered operations` reproduces the host's game exactly, and `replayHash` over a canonical serialization compares two replicas at the same tick. `ActionJournal` records operations on the host with a bounded history (400 records, 2 MB) so a replica can be repaired from a known sequence.

Unchanged held controls are not recorded; only changes and one-shot bomb transitions are. Bot inputs are recorded like any other player's, so replay never reruns AI decisions.

Trigonometry and hypotenuse in the simulation use `src/shared/deterministic-math.ts`, which binds the `@stdlib` pure-JavaScript `sin`, `cos` and `atan2` and an exact `sqrt(x*x+y*y)`. Native `Math.sin` and friends are implementation-approximated and differ across engines, which would make a Safari replica diverge from a Chrome host. Results agree with native math within a few ulp; gameplay is unchanged in practice, and the existing replay and geometry tests pass unchanged.

The checkpoint module gains `encodeGameState`/`decodeGameState` for exact replica state, separate from host recovery checkpoints, which still sanitize connection and charge state.

## Consequences

Nothing on the wire changes yet. The LAN server still calls the game functions directly; it has no replicas. The next step replaces the world stream with these operations.

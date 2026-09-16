# ADR 041: Shared input log, deterministic math and the rollback core

Date: 2026-09-15. Status: **superseded** by the peer-to-peer cutover in [docs/online/P2P-INPUT-LOG-BRIEF.md](../online/P2P-INPUT-LOG-BRIEF.md). The ideas stand (input as a log entry, deterministic math, snapshots and rollback, one MessagePack packet per tick) but the modules named here were replaced: `src/shared/action-log.ts` by `input-log.ts` and `apply-tick.ts`, `src/online/wire.ts` by `packet.ts`, and the host-authored bot streams by bots every replica simulates. The text below is the original decision.

## Decision

**Input is a log entry.** Every member owns one stream of `[seq, tick, kind, ...args]` entries in `src/shared/action-log.ts`: steer flags, aim, press, release and cancel with a gesture id, and avatar; the creator's stream also carries join, leave, presence, settings and start/rematch/lobby. `applyTick` folds one tick: management entries first, guarded by preconditions that are pure functions of the folded state so a failing one is a no-op and nothing throws; then each member's player entries into held controls and ordered bomb commands through one `BombInputBuffer` per stream, now in `src/shared/` so LAN and online share the implementation; then the shared `step`, the automatic round progression, and charge clearing outside play. Bots are ordinary streams the creator authors once per tick with `edgesFrom`, so replay never reruns the AI. `replayHash` compares replicas.

**Every full view simulates and rolls back.** `src/online/rollback.ts` holds the logs, a snapshot ring (every 4 ticks, 12 kept, covering the 40-tick window) and the fold made incremental: `insert` places an entry, `advanceTo` rewinds once to the newest snapshot before the oldest late entry and replays, emitting each event once by content key. Only contiguous entries of a stream apply; a gap is reported for repair and nothing past it is guessed. An entry older than the ring is refused so the caller fetches a baseline, or clamped forward when the caller is the authority, so the host never loses input. `TickClock` sets once from the first host sample, then slews at most a tick per second, steps forward when far behind, and re-locks after host silence.

**Wire and delivery.** `src/online/wire.ts` carries one MessagePack packet per tick per sender inside the four-field fast envelope: the sender's tick and send time, the recipient's echoed send time, an optional hash, and per stream its member hash, last seq and entries; plus a repair request. `src/online/stream.ts` numbers and retains a stream's window and rotates retained entries into packets so each repeats within a few packets with no acknowledgements.

Deterministic math binds `@stdlib` `sin`, `cos`, `atan2` and an exact hypotenuse at the simulation's trig call sites so a WebKit replica cannot drift from a Chrome host.

## Consequences

The next PR replaces the host admission window, the applied-input ledger, local prediction and tick probes with this core, and runs the browser smokes against it. LAN is unchanged apart from the moved bomb buffer import.

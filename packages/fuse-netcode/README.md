# fuse-netcode

Game-agnostic lockstep and rollback netcode for a room of 2–5 browsers on a `fuse-network-fe` mesh. Every member
simulates the same deterministic game from one shared input log: each member owns a stream of entries stamped with
a 50 ms log tick, sends one packet per tick to every other member, and rolls back when a late entry changes history.
A joiner or a refreshed page installs a validated snapshot from any peer. The model, bounds and constants are
[ADR 047](../../docs/adr/047-p2p-input-log-lockstep-rollback.md); the contract is in
[the multi-game design note](../../docs/design/multi-game.md).

A game implements `RollbackGame<Room, Entry, View, Event, Settings>` (`src/game.ts`): its entry parser, a stateful
`createTicker` fold (one log tick: it applies the entries, advances `room.tick` by one and the clock by `steps(room)`), its room's hash, checkpoint fields, view and seats. The package owns everything else:

| Module            | Owns                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `stream.ts`       | One member's stream: contiguous prefix, gaps and nack repair, completeness promises, ordinals                                                                                                    |
| `rollback.ts`     | `World`: every stream folded to the current tick, snapshot ring, rollback, event dedupe, stall rule                                                                                              |
| `snapshot.ts`     | Chunked snapshot transfer, validated and installed only whole                                                                                                                                    |
| `packet.ts`       | Bounded MessagePack packet and nack codec                                                                                                                                                        |
| `clock.ts`        | The slewed 50 ms log clock                                                                                                                                                                       |
| `management.ts`   | Join, leave, presence, settings, start/rematch/lobby, bots and spectators: one wire format, succession, permission, and `applyManagementTick` for a game that keeps its seats in a `ManagedRoom` |
| `room-runtime.ts` | `RoomRuntime`: solo and online rooms, succession duties, snapshot recovery, the desync hash                                                                                                      |

```ts
import { RoomRuntime } from "fuse-netcode";

class DiceRuntime extends RoomRuntime<
  DiceRoom,
  DiceEntry,
  DiceView,
  DiceEvent,
  DiceSettings
> {
  roll(): boolean {
    if (!this.world || !this.player()?.connected) return false;
    this.append(ROLL);
    return true;
  }
}
const runtime = new DiceRuntime(diceGame, code, settings, callbacks, {
  transport,
});
runtime.start();
runtime.command({ type: "join", name: "Ada" });
```

`tests/fixtures/counter-game.ts` is a complete small game on the contract; the package tests drive it through
rollback, lossy and reordering links, snapshot recovery and succession. The package must not import `games/` or `service/`.

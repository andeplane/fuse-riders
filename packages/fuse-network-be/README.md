# fuse-network-be

The room service for [`fuse-network-fe`](../fuse-network-fe): short room codes, membership, the creator's authority
lease and WebRTC signalling over one WebSocket per member. It never simulates or relays gameplay.

```ts
import { createDevRoomService } from "fuse-network-be"; // in-memory, single process
createDevRoomService({ staticDirectory: "dist" }).server.listen(8787);

import { startGcpRoomService } from "fuse-network-be/gcp"; // Cloud Run: Firestore + Pub/Sub
startGcpRoomService({
  serviceName: "my-game-gateway",
  defaultPrefix: "my-game",
});
```

| Route                             |                                                                         |
| --------------------------------- | ----------------------------------------------------------------------- |
| `POST /api/rooms`                 | new room → `{ code, token }`; the token is the creator's identity       |
| `GET /api/rooms/:code/ws?token=`  | admission, roster, `signal` forwarding, `time` probes and lease renewal |
| `GET /api/rooms/:code/ice?token=` | STUN servers, members only                                              |
| `POST /api/rooms/:code/end`       | creator ends the room (`Authorization: Bearer <token>`)                 |
| `GET /healthz`                    | gateway state                                                           |

Pieces, for other hosts: `RoomStore` (rules, over a `RoomDatabase`), `RoomGateway` (sockets, over a `RoomBus`),
`createRoomServer` (HTTP + upgrade). `MemoryRoomDatabase`/`LocalRoomBus` and `FirestoreRoomDatabase`/`PubSubRoomBus`
are the two provided pairs. `RoomStoreDependencies.maxGuests` and `fullMessage` set capacity (default: the creator
plus five). When constructing `FirestoreRoomDatabase` directly, pass the same `maxGuests` as its third argument
so stored metadata validation uses the admission limit; `startGcpRoomService` does this automatically. Limits must
be non-negative safe integers below `Number.MAX_SAFE_INTEGER`. The Google client libraries are optional peers, needed only for `fuse-network-be/gcp`.

Origin checks are not authentication; tokens are. Requests, query strings and frames are never logged.

Room lifetime follows active membership: admission and valid member heartbeats
extend the 90-second reconnect grace, including when the creator has left. A
current member leaving starts that grace too. The creator retains the reserved
seat and exclusive explicit-end capability; guests cannot renew its authority
grant. No game state is stored: returning devices recover it from another peer.
See [the lifetime design](../../docs/design/member-kept-room-lifetime.md) for
expiry, verification and rollout boundaries.

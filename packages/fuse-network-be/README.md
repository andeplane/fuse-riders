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

| Route                       |                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/rooms`           | new room → `{ code, token }`; the token is the creator's identity; `?gameId=` names the game (see below)                                |
| `GET /api/rooms/:code/ws`   | first frame `{"type":"auth","token","gameId"?,"resume"?}`, then admission, roster, `signal` forwarding, `time` probes and lease renewal |
| `GET /api/rooms/:code/ice`  | STUN servers, members only (`Authorization: Bearer <token>`)                                                                            |
| `POST /api/rooms/:code/end` | creator ends the room (`Authorization: Bearer <token>`)                                                                                 |
| `GET /healthz`              | gateway state                                                                                                                           |

Pieces, for other hosts: `RoomStore` (rules, over a `RoomDatabase`), `RoomGateway` (sockets, over a `RoomBus`),
`createRoomServer` (HTTP + upgrade). `MemoryRoomDatabase`/`LocalRoomBus` and `FirestoreRoomDatabase`/`PubSubRoomBus`
are the two provided pairs. `RoomStoreDependencies.maxGuests` sets capacity (default: the creator plus five),
`gameMaxGuests` sets it per game id where a game needs another size, and `fullMessage` is what a refused member is
told (default `Room full`). When constructing `FirestoreRoomDatabase` directly, pass the same limits as its third
argument (a number, or `roomGuestLimits(maxGuests, gameMaxGuests)`) so stored metadata validation uses the admission
limit; `startGcpRoomService` does this automatically. Limits must be non-negative safe integers below
`Number.MAX_SAFE_INTEGER`. The Google client libraries are optional peers, needed only for `fuse-network-be/gcp`.

A room serves one game. `RoomStoreDependencies.gameIds` (and the same option on both services) lists the games the
service hosts, default `LEGACY_GAME_ID` (`fuse-riders`) alone. A room is created for the `gameId` in the creation
query and stores it; a socket whose `auth` frame names another game is refused as not found (`CLOSE_ROOM_ENDED`), and
an unhosted game cannot create a room. An absent `gameId` means `LEGACY_GAME_ID` on both sides, so clients and
services from before rooms carried a game keep working with each other.

A dropped socket does not cost a member its seat. A socket that ends without a close frame, and every socket of
an instance that is stopping, leaves its seat held for `RESUME_GRACE_MS` (8 s); a page that reconnects naming its
connection id (`resume` in the first frame) is welcomed back under it and no other member is told, so the WebRTC
links that page has stay up. A seat nobody resumed lapses with its lease and is pruned by any instance serving the
room, which is when the others hear of it. See "Resuming a connection" in
[PROTOCOL.md](../../docs/online/PROTOCOL.md).

Origin checks are not authentication; tokens are. Requests, query strings and frames are never logged. `/ice` and
`/end` read the room for any caller, so each address may make 30 of each at once and one more every two seconds
(`AddressBudget`, kept per instance with no database call); past that they answer `429`. A page refused `/ice`
uses the same STUN servers it would have been given.

Room lifetime follows active membership: admission and valid member heartbeats
extend the 90-second reconnect grace, including when the creator has left. A
current member leaving starts that grace too. The creator retains the reserved
seat and exclusive explicit-end capability; guests cannot renew its authority
grant. No live world is stored by the room service: returning devices recover it from another peer.
See [the lifetime design](../../docs/design/member-kept-room-lifetime.md) for
expiry, verification and rollout boundaries.

Signalling abuse is isolated per room. Each connection may send 80 signal frames
per target member, refilled at 10 a second; a frame over any limit is dropped and
the sender told, and only a flood closes the socket. Paid work is metered
separately: each room may publish 512 kB to another gateway, refilled at 51.2 kB a
second, matching the bounded room-local window for bus retry IDs.
Admission uses a separate 30-failures/hour/IP budget plus bounded pending work;
successful joins do not consume it. See [abuse isolation](../../docs/design/signalling-abuse-isolation.md)
for ordering, limits and multi-instance concurrency boundaries.

Games can mount account/history or other application routes without making the networking package depend on the game.
Pass `httpExtension: store => ({ methods, headers, async handle(req, res, clientAddress) { ... } })` to the
in-memory service, or `httpExtension: ({ store, firestore, prefix, projectId }) => ...` to the GCP service.
For a custom host, pass the resulting `HttpExtension` as `createRoomServer`'s `extension` option. The handler
runs after core routes and Origin validation, before static fallback; return `true` after ending the response
or `false` to leave the request unhandled. Exceptions use the service's standard error response. Optional
methods/headers extend CORS preflight; handlers remain responsible for authenticating their own routes.

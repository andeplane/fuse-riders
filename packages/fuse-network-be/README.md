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

| Route                       |                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `POST /api/rooms`           | new room → `{ code, token }`; the token is the creator's identity                                                   |
| `GET /api/rooms/:code/ws`   | first frame `{"type":"auth","token"}`, then admission, roster, `signal` forwarding, `time` probes and lease renewal |
| `GET /api/rooms/:code/ice`  | STUN servers, members only (`Authorization: Bearer <token>`)                                                        |
| `POST /api/rooms/:code/end` | creator ends the room (`Authorization: Bearer <token>`)                                                             |
| `GET /healthz`              | gateway state                                                                                                       |

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
grant. No live world is stored by the room service: returning devices recover it from another peer.
See [the lifetime design](../../docs/design/member-kept-room-lifetime.md) for
expiry, verification and rollout boundaries.

Signalling abuse is isolated per room: a 32-frame ICE burst refills at five frames
per second per member, and bus retry IDs use a bounded room-local window.
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

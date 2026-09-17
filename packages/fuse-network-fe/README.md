# fuse-network-fe

Browser side of Fuse rooms: a full WebRTC mesh between the members of a room, negotiated through a
[`fuse-network-be`](../fuse-network-be) room service. The service only signals; every byte of gameplay travels
peer to peer. There is no TURN relay: a pair that cannot link directly gets an explicit, explained retry state.

```ts
import {
  PeerTransport,
  createEndpoints,
  createRoom,
  memberToken,
} from "fuse-network-fe";

const { apiUrl } = createEndpoints(
  { basePath: "/", apiOrigin: "https://rooms.example.com" },
  location.origin,
);
const { code, token } = await createRoom(apiUrl); // creator; a joiner uses memberToken() and a shared code

const transport = new PeerTransport(
  code,
  token,
  {
    welcome: (id, hostId) => {}, // admitted: my id, the creator's id
    peer: (id, online) => {}, // membership, as the service sees it
    link: (id, open) => {}, // direct link up or down (a hint; linked(id) is the fact)
    message: (id, data) => {}, // reliable, ordered JSON
    fast: (id, bytes) => {}, // unordered, unreliable datagrams (≤ maxFastBytes)
    status: (text) => {},
    revoked: () => {},
    ended: () => {},
    terminated: (text) => {},
  },
  { apiUrl },
);
transport.connect();
transport.send(peerId, { type: "hello" }); // reliable channel
transport.sendFast(peerId, bytes); // per-tick channel; skipped, never queued, when backed up
```

What it handles: admission and reconnects to the room socket, ICE config, offer/answer by id order (the smaller
id offers), trickle candidates buffered per ICE generation, probe-based link health (an open channel is not proof
of delivery), bounded ICE restarts and link rebuilds, WebKit's lagging `readyState` (`LinkSendGate`, `linkBye`),
the creator's authority lease against duplicate tabs (`AuthorityClock`), and redacted link diagnostics
(`explain`, `diagnostics`, `formatLinkDiagnostics`).

`RoomTransport` / `TransportEvents` are the seam a runtime codes against, so tests can swap in a fake mesh.
`PeerTransportOptions.copy` replaces the few player-facing strings the transport emits.

What it does not do: simulate, order or repair application messages. Fuse Riders' rollback runtime lives in the
game (`src/online/`) on top of this transport.

# Room tokens travel in headers and frames, never in URLs

Design note for issue #256, finding S3 (first flagged in
[online-security-operations-review.md](../reviews/online-security-operations-review.md), P2). Status: implemented.

## Problem

A room token is a bearer capability. A member token names a seat; the creator's token also authorizes
`POST /api/rooms/{code}/end`. Two requests carried it in the query string: `GET /api/rooms/{code}/ice?token=` and the
room WebSocket, `GET /api/rooms/{code}/ws?token=`. Cloud Run's request log records the full request URL, as do most
proxies, so every admission wrote a live capability into the project's logs, readable by anyone with log access and
kept for the log retention period rather than the room's lifetime.

## Decision

| Request                      | Token travels as                                                   |
| ---------------------------- | ------------------------------------------------------------------ |
| `GET /api/rooms/{code}/ice`  | `Authorization: Bearer <token>`                                    |
| `POST /api/rooms/{code}/end` | `Authorization: Bearer <token>` (unchanged)                        |
| `GET /api/rooms/{code}/ws`   | the socket's **first frame**, `{"type":"auth","token":"<64 hex>"}` |
| `POST …/results`, `/api/me…` | `Authorization` / `X-Fuse-Identity` (unchanged)                    |

No room service URL has a query string any more, and the service never reads one for a credential.

### HTTP: `Authorization`

The CORS policy already allowed it: the preflight answers `Access-Control-Allow-Headers: Content-Type, Authorization`
and echoes the exact allowed Origin with `Vary: Origin`; a foreign Origin gets `403` on the preflight too. A
cross-origin `GET /ice` now preflights where the query form did not, so the preflight also answers
`Access-Control-Max-Age: 600`. The ICE fetch keeps its 3-second bound and its fallback to the default STUN list.

### WebSocket: first frame, not `Sec-WebSocket-Protocol`

A browser cannot set headers on `new WebSocket`. The two options were the token as a subprotocol value, or an
authenticating first frame.

- **Subprotocol.** Authenticates before the upgrade, so no unauthenticated socket ever exists and the admission path is
  untouched. But the token stays in request metadata: `Sec-WebSocket-Protocol` is a header that proxies, load balancers
  and debugging middleware routinely record, which is the same class of leak one hop along. It also abuses a
  negotiation field: the server has to be offered a real protocol name beside the token and echo only that one, because
  a browser fails the handshake when the echo is missing or wrong — a failure the page cannot tell from a network drop.
- **First frame.** The token is only ever inside the (TLS-protected) message stream, like every other frame, and is
  absent from everything a request log, access log or handshake trace can see. The cost is that the service accepts an
  upgrade from a caller it has not authenticated yet, which has to be bounded.

We chose the first frame, and bound the unauthenticated socket with the S2 admission limits merged in #265 rather than
a second mechanism. What those limits do and do not bound is spelled out under [Slot holding](#slot-holding).

- The upgrade still requires an allowed Origin and a well-formed room code, and is refused with `429` before the
  upgrade when the address's hourly failure budget is spent.
- The whole handshake — upgrade, waiting for the `auth` frame, and `RoomGateway.connect` — runs inside one
  `AdmissionGate` slot. Unauthenticated sockets are therefore bounded exactly like pending admissions: 4 per address and
  128 per gateway instance; the next one gets `429` before the upgrade. The slot is released when the socket
  authenticates and is admitted, is refused, or leaves.
- The first frame must arrive within `AUTH_DEADLINE_MS` (2 s; an injected scheduler in tests). It must be a text frame
  of at most `AUTH_FRAME_MAX_BYTES` (256; the real frame is under 100) that parses to `{type:"auth", token}` with a
  64-hex token. The socket's 32 kB `maxPayload` still bounds what is buffered before that check.
- Nothing else is read first. Whatever arrives first _is_ the authentication attempt: a `time` or `signal` frame is
  never handed to the gateway, and a valid `auth` frame arriving second does not rescue the socket. After a refusal no
  further frame is read.
- Missing (deadline), late, garbage, binary, oversized or malformed auth — including a first frame `ws` itself refuses
  to parse, such as one past `maxPayload` — are all a `401` inside the gate, so each spends the address's hourly
  failure budget (30) exactly as a wrong room code does. The socket closes with `4401` (`CLOSE_UNAUTHENTICATED`).
- Leaving before authenticating frees the slot and is **not** charged and not logged. Charging it would stop nobody
  (see Slot holding) and would land on honest pages: one closed or navigated away within a round trip of the upgrade,
  a mobile tab frozen mid-connect, a network drop right after the 101.
- A refused socket is given `REFUSED_CLOSE_GRACE_MS` (3 s) to answer the close frame and is then terminated. `ws` would
  otherwise keep it for 30 s: outside the gate's count by then, but still one of Cloud Run's concurrent requests. Only
  refused sockets are cut off; an admitted socket's close handshake runs to its end, so its close code is never lost.
- A well-formed token then goes through `RoomGateway.connect` unchanged: per-room admission serialization,
  incarnation/revision fencing, membership and capacity are as before. `validSignal`, exact-origin CORS and the
  DNS-rebinding guard are untouched. Gateways stay stateless: the handshake is local to one socket.

### The deadline: 2 seconds

The client sends `auth` synchronously from the socket's `open` handler (`openRoomSocket`), so an honest frame is one
round trip behind the 101 plus however long the page's main thread takes to run that handler. 2 s covers a 1.5 s round
trip — worse than an EDGE link — with half a second of main-thread stall to spare, and a link slower than that cannot
play a 20 Hz peer-to-peer game anyway. Missing the deadline is cheap for an honest page: one charged failure and a
backed-off retry, not a lockout. The first version of this change used 5 s; every extra second is a second a slot can
be held for free, and nothing honest needs it.

### Slot holding

**The hourly failure budget does not bound how long handshake slots can be held.** Any well-formed 64-hex token is
admitted to a live room as a guest, and a successful admission is never charged. So a caller can create a room, open
its 4 sockets, stay silent until just under the deadline, send a valid `auth`, be welcomed, and repeat — indefinitely
and for free. (`socket-auth.test.ts` pins this: 32 rounds of 4 held-then-authenticated sockets, nothing charged.)
Charging sockets that leave early would not change that, which is why they are not charged.

What does bound it:

- **4 pending admissions per address, 128 per gateway instance**, `429` before the upgrade beyond that. An "address"
  is an IPv4 address or an IPv6 **/64** (`rateLimitAddress`): one IPv6 host owns a whole /64, so a per-address limit
  on full IPv6 addresses would be no limit. A v4-mapped IPv6 address counts as the IPv4 address it wraps, and input
  that is not an address shares one key. So filling one instance's 128 slots takes about 32 IPv4 addresses or 32
  IPv6 /64s (one /56), held continuously — at which point every admission on that instance gets `429` until they
  stop. That is a small number, and the design does not claim otherwise.
- **In production the platform binds first.** Cloud Run runs this service with `--concurrency=80 --max-instances=2`
  (`scripts/deploy-cloud.sh`), and every open WebSocket — players in rooms included — is one concurrent request. 160
  sockets across both instances is the real ceiling, reached before 128 pending admissions on either.
- The failure budget still bounds what it always did: wrong room codes (`404`) and bad first frames (`401`), 30 an
  hour per address, shared across instances.

**What this change adds over `main`.** `main` authenticated before the upgrade, so a slot was held only for the room
store transaction (milliseconds). A slot is now held for up to the 2 s deadline as well. The per-address and
per-instance counts are the same as on `main`; the time each can be held is what grew, and the deadline is kept as
short as an honest client allows for that reason. Pending-slot exhaustion is a denial of new admissions on one
instance, not of rooms already running: admitted sockets hold no slot, and gameplay is peer to peer.

### What is charged

| Outcome inside the gate                                    | Close  | Charged |
| ---------------------------------------------------------- | ------ | ------- |
| Deadline passed; garbage, binary, oversized, malformed     | `4401` | yes     |
| Wrong or ended room code                                   | `4004` | yes     |
| Left before authenticating                                 | —      | no      |
| Room full (`RoomFullError`)                                | `4029` | no      |
| Operational failure (store or bus unavailable, restarting) | `4000` | no      |
| Admitted                                                   | —      | no      |

A full room is not charged. The S2 budget (#265) prices _wrong guesses_: enumeration costs a charged `404` per miss.
A full room is a _right_ guess, and right guesses were never charged — an admission that succeeds confirms that a
code is live just as well, for free — so charging the full case alone protected nothing and only punished a sixth
player behind a shared address. It gets its own close code, `4029` (`CLOSE_ROOM_FULL`), which is terminal for the
page (below).

## Client behaviour

- `4401` and every other non-terminal close is retried with **exponential backoff and jitter**
  (`ReconnectBackoff`): 1.5 s doubling to a 30 s cap, each wait shortened by up to a quarter at random so pages a
  restart dropped together do not return together. A `welcome` resets it. A `429` before the upgrade is
  indistinguishable from a network drop in a browser and backs off the same way. `main` retried every 1.5 s forever.
- While the service keeps answering `4401` — the one retried close that is charged — the ladder continues to a
  5 min cap instead. A page behind a middlebox that passes the 101 but eats frames then makes about 21 attempts in
  its first hour (at most 24 with the unluckiest jitter) and about 14 an hour after, so it cannot spend its
  address's 30 failures by itself and lock out everyone else behind that NAT. With a flat 1.5 s retry and a 5 s deadline that took about three minutes.
- `4029` (room full) is **terminal**: the transport stops, reports the service's wording ("Room full (five players
  and TV)") through `terminated`, and the header shows RETRY. Retrying cannot free a seat.
- The player's RETRY is a page reload — a new transport with a fresh ladder — so a manual retry never waits out a
  backoff.
- A refused `/ice` request (any non-2xx) is reported in LINK DIAGNOSTICS as
  `default (service refused: status N)`, distinct from `default (service list invalid)` and
  `default (ice fetch failed)`; the fallback to the default STUN list is unchanged.

`welcome.protocol` stays `2`: every frame after `auth` is unchanged, and bumping it would make the pages the rollout
window exists for tell their players to reload.

## Logging

The service logs `{kind, errorType, code}` for failures and nothing else: no request URL, no query string, no frame and
no token. A refused `auth` frame is not echoed in the close reason or the log. The client's error paths embed no
request URL. Invite links are built by `appUrl("?room=…")` and carry no capability, as before.

## Rollout

The page (GitHub Pages) and the service (Cloud Run) deploy independently, and a page already open keeps its old script.

- **New page, old service.** The old service refuses an upgrade without `?token=` with `403` before the admission gate,
  so nothing is charged; the page shows "Signalling disconnected · retrying" and retries, backing off to every 30 s,
  until the service is updated. `/ice` answers `401` and the page falls back to the same default STUN list. Rooms cannot be joined in that
  state, so **the service should be live first**. The reverse order is not a safety problem — it is uncharged and
  heals by itself — only a few minutes in which newly loaded pages cannot connect.
- **Old page, new service.** Without help, an old page upgrades, never sends `auth`, is closed `4401` on its first
  heartbeat (within 2 s), retries every 1.5 s and spends its address's failure budget in about two minutes — after which the _reloaded_
  page is locked out for the rest of the hour too. A match in progress at deploy time would lose its room service
  connection for good. That is not a safe rollout, so there is a window.

**Deprecated acceptance window.** `RoomHttpOptions.legacyQueryToken` (off by default; the dev service and tests run
strict) makes the upgrade handler also accept `?token=` and admit without an `auth` frame. Only the Cloud Run entry
(`packages/fuse-network-be/src/gcp/index.ts`) turns it on. Each use is counted and reported at most once a minute as
`{"kind":"deprecated-query-token","severity":"WARNING","uses":n}` — never the token, the URL or the room. There is no
window for `/ice`: an old page's `401` there already degrades to the default STUN list.

While the window is open, old pages still put their token in the URL; the leak closes for a player when their page
reloads, and for everyone when the window is removed.

**Deploy order.** Service first (window on), then the page, is preferred. The reverse order is safe: `main`'s handler
answers a missing `?token=` with `403` before the admission gate, so nothing is charged and new pages connect by
themselves once the service is live; the only cost is that pages loaded in that gap cannot connect until then.

1. Deploy the service (accepts both forms). Both workflows trigger from the same CI run on `main`, and Pages usually
   finishes first; until the backend deploy completes, new pages retry as described above and then connect on their
   own. To avoid even that, disable the Pages workflow before merging and dispatch it for the merged revision once
   `Deploy backend` has finished.
2. Deploy the page (sends only the new form).
3. When `deprecated-query-token` has not appeared in the service log for a week, delete the window. Every site
   carries the comment tag **`LEGACY-QUERY-TOKEN`**; `grep -rn LEGACY-QUERY-TOKEN packages` must come back empty
   afterwards. The sites:
   - `http.ts`: the `legacyQueryToken` option; `deprecatedQueryToken` and its two counters; the `queryToken` block in
     the upgrade handler; the phase initializer (`queryToken === undefined ? "auth" : "admitted"` becomes `"auth"`);
     the legacy admit call (`if (queryToken !== undefined) admit(queryToken)`).
   - `gcp/index.ts`: the `legacyQueryToken: true` line.
   - `dev.ts`: the `legacyQueryToken` option of `DevRoomServiceOptions` and its passthrough to `createRoomServer`.
   - `socket-auth.test.ts`: the window's test and the fixture's `legacyQueryToken` option.
   - This section, and the window's sentence in `PROTOCOL.md` and the security review's status line.

**Rollback.** Rolling the page back while the window is open is safe. Rolling the service back past this change breaks
new pages until they are rolled back as well.

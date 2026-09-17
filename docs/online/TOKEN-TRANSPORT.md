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
a second mechanism:

- The upgrade still requires an allowed Origin and a well-formed room code, and is refused with `429` before the
  upgrade when the address's hourly failure budget is spent.
- The whole handshake — upgrade, waiting for the `auth` frame, and `RoomGateway.connect` — runs inside one
  `AdmissionGate` slot. Unauthenticated sockets are therefore bounded exactly like pending admissions: 4 per address and
  128 per gateway instance; the next one gets `429` before the upgrade. The slot is released when the socket
  authenticates and is admitted, is refused, or leaves.
- The first frame must arrive within `AUTH_DEADLINE_MS` (5 s; an injected scheduler in tests). It must be a text frame
  of at most `AUTH_FRAME_MAX_BYTES` (256; the real frame is under 100) that parses to `{type:"auth", token}` with a
  64-hex token. The socket's 32 kB `maxPayload` still bounds what is buffered before that check.
- Nothing else is read first. Whatever arrives first _is_ the authentication attempt: a `time` or `signal` frame is
  never handed to the gateway, and a valid `auth` frame arriving second does not rescue the socket. After a refusal no
  further frame is read.
- Missing (deadline), late, garbage, binary, oversized or malformed auth, and leaving before authenticating, are all a
  `401` inside the gate, so each spends the address's hourly failure budget (30) exactly as a wrong room code does. The
  socket closes with `4401` (`CLOSE_UNAUTHENTICATED`). Leaving early is charged because otherwise a slot could be held
  just under the deadline, for free, forever.
- A well-formed token then goes through `RoomGateway.connect` unchanged: per-room admission serialization,
  incarnation/revision fencing, membership and capacity are as before. `validSignal`, exact-origin CORS and the
  DNS-rebinding guard are untouched. Gateways stay stateless: the handshake is local to one socket.

Worst case, one address can hold 4 slots for 5 s per failure and has 30 failures an hour, so saturating one
instance's 128 slots for an hour takes on the order of three thousand addresses.

`welcome.protocol` stays `2`: every frame after `auth` is unchanged, and bumping it would make the pages the rollout
window exists for tell their players to reload.

## Logging

The service logs `{kind, errorType, code}` for failures and nothing else: no request URL, no query string, no frame and
no token. A refused `auth` frame is not echoed in the close reason or the log. The client's error paths embed no
request URL. Invite links are built by `appUrl("?room=…")` and carry no capability, as before.

## Rollout

The page (GitHub Pages) and the service (Cloud Run) deploy independently, and a page already open keeps its old script.

- **New page, old service.** The old service refuses an upgrade without `?token=` with `403` before the admission gate,
  so nothing is charged; the page shows "Signalling disconnected · retrying" and retries every 1.5 s until the service is
  updated. `/ice` answers `401` and the page falls back to the same default STUN list. Rooms cannot be joined in that
  state, so **the service must be live first**.
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

**Deploy order.**

1. Deploy the service (accepts both forms). Both workflows trigger from the same CI run on `main`, and Pages usually
   finishes first; until the backend deploy completes, new pages retry as described above and then connect on their
   own. To avoid even that, disable the Pages workflow before merging and dispatch it for the merged revision once
   `Deploy backend` has finished.
2. Deploy the page (sends only the new form).
3. When `deprecated-query-token` has not appeared in the service log for a week, delete the window: the
   `legacyQueryToken` option and its block in `http.ts`, the line in `gcp/index.ts`, `deprecatedQueryToken`, the
   window's test in `socket-auth.test.ts`, and this section.

**Rollback.** Rolling the page back while the window is open is safe. Rolling the service back past this change breaks
new pages until they are rolled back as well.

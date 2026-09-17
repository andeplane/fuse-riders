# Full codebase bug review

Reviewed every file under `src/`, `worker/`, `scripts/`, `tests/`, `.github/`, and the root configs at commit `68bea0d`. Typecheck and the 360-test suite pass on that commit. Each finding below was verified by re-reading the cited code and, where noted, by a small reproduction against the real modules. Each section is written as a self-contained GitHub issue so it can be filed as-is.

Severity: **high** = crashes or breaks play for everyone; **medium** = wrong behaviour a player will hit in normal use; **low** = latent, cosmetic, or needs unusual conditions.

---

## 1. Fixed-rounds matches throw on the final round when the standings leader did not win that round

**Severity:** high · **Files:** `src/shared/game.ts` (`resolveRound`, ~1109–1115), `src/shared/leaderboard.ts` (`applyRoundScores`, ~98)

With room settings `match: 'rounds'`, `resolveRound` derives `matchWinnerId` from the standings (`ranking[0]`) while `winnerId` is the survivor of the current round, then calls `scoreRoundOnce(state, winnerId, matchWinnerId)`. `applyRoundScores` unconditionally throws `'Match winner must also be the round winner'` when the two differ. Any fixed-rounds match whose last round is won by someone other than the overall leader crashes the simulation. A drawn final round with a standings leader throws the same way.

**Impact.** The throw happens after `winner.roundWins += 1` and `state.roundWinnerId` are mutated but before `phase` changes, so the state stays in `playing` and every subsequent `step()` re-enters `resolveRound` and throws again. The LAN server tick (`src/server/index.ts` ~231) and the online host loop (`src/online/host-session.ts` ~130) call `step()` without try/catch, so this is an uncaught exception inside `setInterval`: the Node process dies, or the browser host loop stops and the room freezes.

**Reproduction.**

```ts
import {
  createGame,
  addPlayer,
  startMatch,
  startNextRound,
  step,
  eliminatePlayer,
  COUNTDOWN_TICKS,
  ROUND_OVER_TICKS,
} from "./src/shared/game.ts";
import { defaultRoomSettings } from "./src/shared/room-settings.ts";
const inputs = new Map();
const state = createGame("m1");
state.settings = { ...defaultRoomSettings(), match: "rounds", length: 3 };
addPlayer(state, { id: "a", name: "A", slot: 0, color: "#f00" });
addPlayer(state, { id: "b", name: "B", slot: 1, color: "#0f0" });
startMatch(state);
for (const loser of ["b", "b", "a"]) {
  // A wins rounds 1-2, B wins round 3
  for (let i = 0; i < COUNTDOWN_TICKS; i++) step(state, inputs);
  eliminatePlayer(state, loser);
  step(state, inputs); // round 3 throws; state.phase stays 'playing'
  if (state.phase === "roundOver") {
    for (let i = 0; i < ROUND_OVER_TICKS; i++) step(state, inputs);
    startNextRound(state);
  }
}
```

**Suggested fix.** In `rounds` mode, do not pass the standings-derived winner through the `matchWinnerId` argument of `applyRoundScores` (whose invariant means "this round's win also clinched the match"). For example call `applyRoundScores(leaderboard, placements, winnerId, matchWinnerId === winnerId ? matchWinnerId : undefined)` and credit `matchWins` for the standings winner separately, or relax the invariant for fixed-round ends. Add regression tests for `match: 'rounds'` where the final round is won by the trailing player and where it is a draw with a leader.

---

## 2. Online: inputs rejected by the transport stay in `LocalPrediction.pending` until the 128 cap blocks all steering for the round

**Severity:** high · **Files:** `src/online/prediction.ts` (~24–31), `src/online/ui.ts` (~154), `src/online/runtime.ts` (~100–110)

`LocalPrediction.input()` pushes the scheduled input into `pending` before the caller has tried to send it. `ui.ts` then calls `runtime.command(...)`, which returns `false` whenever `PeerTransport.send` cannot deliver (data channel not `open`, `LinkHealth.direct()` false for more than 600 ms, `bufferedAmount` at the 64000 limit). Nothing removes the entry on a failed send, and the host never sees that seq, so no result ever retires it.

`ControllerInputState` resends every 50 ms with a fresh seq while a control is held, and the clock estimate stays valid for about 4 s after the last probe, so a few seconds of link impairment while steering leaks dozens of entries. Once `pending.length >= 128`, `input()` sets `blocked = true` and returns `undefined` on every later call; `ui.ts` then stops sending inputs entirely and shows "Shot not accepted" on fire. `blocked` is only cleared by `accept()` on a scope change (round/phase change) or by `resetExternalScope()`, so the player has dead controls for the rest of the round even after the link recovers.

**Reproduction.** Drive `LocalPrediction` with a valid base and clock, call `input()` 128 times with no results acknowledged, then feed 50 further accepted frames in the same scope: `input()` returns `undefined` for every call after the cap.

**Suggested fix.** Commit to `pending` only after the transport accepted the message (split `input()` into schedule + `commit(seq)` / `discard(seq)`, or have `ui.ts` call `prediction.discard(seq)` when `runtime.command` returns `false`). Also drop pending entries whose `intendedTick` is far behind the accepted base instead of letting them count toward the cap, and clear `blocked` once the backlog drains.

---

## 3. Players who vanish in the lobby keep their seat forever; room reports "full" and host cannot start (LAN server and online host)

**Severity:** medium · **Files:** `src/server/index.ts` (~122–126, ~190), `src/online/host-session.ts` (~133, ~157), `src/online/ui.ts` (~139), `src/client/main.ts` (~751, ~851)

Both authorities keep a disconnected player's seat indefinitely unless a round boundary or an explicit return-to-lobby prunes it. In the lobby and at `matchOver` nothing the host can do from the UI clears them.

- **LAN.** `hostAction('start')` checks `connectedCount() < 2` and errors with `not_enough_players` _before_ `pruneDisconnected()` runs. `join` counts ghost players toward the 5-seat cap and answers `full`. The display client only sends `hostAction('lobby')` when `phase !== 'lobby'` and disables the menu button in the lobby. Reproduced: 5 phones join, 4 close their tab without `leave`; a newcomer gets `full`, the host's start gets `not_enough_players`, and `game.players.size` stays 5.
- **Online.** `HostSession.disconnect()` only calls `setPlayerConnected(..., false)`; players are removed only at the end of `roundOver` or by `returnToLobby`. The host UI disables MAIN MENU in the lobby (`reset.disabled = state.phase === 'lobby'`). Reproduced: 5 join, 3 disconnect in the lobby, a later `join` returns `'Room is full (5 players)'`.

**Suggested fix.** LAN: run `pruneDisconnected()` before the `connectedCount() < 2` check in `hostAction`, and let `join` reclaim a disconnected lobby seat when the arena is full. Online: in `disconnect()`, when `game.phase` is `lobby`, `roundOver` or `matchOver`, `removePlayer` and drop the seat (mirroring the LAN server's explicit `leave` path), or prune disconnected players in the slot search used by `join`/`addBot` and on `start`/`rematch`.

---

## 4. Online: "peer offline" is dropped while the data channel still reads `open`, leaving a permanent ghost player

**Severity:** medium · **File:** `src/online/peer-transport.ts` (~84–86, ~107–122)

The offline branch of the `peer` message is guarded by `links.get(id)?.channel?.readyState !== 'open'`. The service sends `peer offline` exactly once per member (on socket close, or after the 30 s connection TTL). If at that moment the host's `RTCDataChannel` still reports `open` (a phone that lost network keeps `readyState === 'open'` through the `disconnected` state), the event is discarded.

No later path marks the player disconnected: there is no `channel.onclose` handler, and `pc.onconnectionstatechange` for `failed`/`disconnected` only calls `link.health.fail(...)` and updates status text. `callbacks.peer(id, false)` is never invoked, so `HostSession.disconnect` never runs. The player stays `connected: true`, counts toward the minimum-players check, is never pruned at round end, and rides on as a neutral-input ghost every round. The host keeps re-offering to the dead `connectionId` every 8 s and cycles keyframe generations for it forever.

**Suggested fix.** When the offline branch is skipped because the channel is open, remember the pending offline for that peer. On `pc.connectionState === 'failed'`, on `channel.onclose`, or when `LinkHealth.shouldRestart` fires with no signalling identity for the peer, emit `callbacks.peer(id, false)` and drop the link and connection entry.

---

## 5. Online: host error replies and terminal notices are overwritten within one frame by recurring status text

**Severity:** medium · **Files:** `src/online/runtime.ts` (~46, ~89, ~91, ~107), `src/online/authority-status.ts`

`RoomRuntime` emits status on a timer rather than on transitions: every accepted world frame (20 Hz) calls `callbacks.status('Connected · direct game link')`, and every 10 ms tick calls `authorityTransitionStatus(...)`, which returns `'Paused — confirming room authority'` on every tick while authority is not permitted.

An `error` reply from the host (`Room is full (5 players)`, `Choose a name`, `Only the host can…`) is therefore visible for at most 50 ms. `JoinRequest` retries the join every 500 ms, so a sixth player sees the join form flicker and never learns why. Terminal messages are hidden the same way: after `Game protocol changed — reload this page` the transport is closed but the runtime interval keeps running and rewrites the status to `Paused — confirming room authority`; the host's `Saved game is incompatible or damaged` is immediately replaced by `Room authority confirmed`. This contradicts the comment in `authority-status.ts`: "healthy ticks must preserve command errors and other notices."

**Suggested fix.** Emit connection and pause status only on transitions (dedupe against the last emitted connection status). Route host `error` replies to a sticky notice like `ShotFailureNotice`, or suppress recurring status for a few seconds after an error. Stop the runtime interval when the transport reports a protocol mismatch.

---

## 6. LAN server: malformed frames bypass the per-connection rate limit

**Severity:** medium · **File:** `src/server/index.ts` (~141–147)

The early return for an unparseable frame happens before the window/count bookkeeping:

```ts
const message = binary ? null : parseClientMessage(data.toString());
if (!message) { error(ws, 'invalid_message'); return; }   // not counted
const now = dependencies.now(); c.lastSeen = now;
if (now - c.window >= 1000) { c.window = now; c.count = 0; }
if (++c.count > 100) { ...; ws.close(1008, 'Rate limit'); return; }
```

A client can send an unbounded stream of malformed or binary frames; each costs a `JSON.parse` plus a serialized `error` reply, and the socket is never closed. `lastSeen` is not updated on invalid frames so the 6 s idle watchdog would eventually close the socket, but one valid heartbeat every few seconds keeps the flood alive. Verified against a running server: 1000 garbage frames produce 1000 `invalid_message` replies with the socket still open; 1000 valid heartbeats close it at the 101st.

**Suggested fix.** Move the window/count bookkeeping above the parse check so every frame (binary and invalid included) is counted, and keep updating `lastSeen` only on valid frames.

---

## 7. Music tempo runs about 7% slow because per-step scheduling latency accumulates

**Severity:** medium · **File:** `src/client/audio-director.ts` (`update`, ~73)

`update()` is driven by `requestAnimationFrame` and schedules the next step as `this.nextBeat = now + musicStepDuration(track, this.beat)`. `now` is the frame timestamp at which the deadline was noticed, not the deadline itself, so every step inherits up to one frame of lateness and the error never cancels. Notes are also started at `context.currentTime` rather than a scheduled time, so each note carries the same jitter.

**Reproduction.** A model of the loop at 60 Hz with the 125 ms step of track 1 yields 481 beats in 64 s instead of 512. Driving the real `AudioDirector` at 60 Hz and 30 Hz gives the same result: a 64 000 ms arrangement takes about 68 300 ms (+6.7%), and the 125 ms step effectively becomes 133 ms.

**Suggested fix.** Advance from the previous deadline with a bounded reset, for example `this.nextBeat = Math.max(this.nextBeat + duration, now - duration)`, or schedule notes with an AudioContext-time lookahead and only clamp when `now - nextBeat` exceeds one step.

---

## 8. Gun projectile that detonates on a rider produces a blast that never clears trails

**Severity:** low · **File:** `src/shared/game.ts` (~469–475 vs ~517)

The trail-clearing pass runs once using `newBlasts` from the first `resolveExplosions` call. The rider-hit path in the shell/gun sweep calls `detonateGun` and pushes `resolveExplosions(...)` into `newBlasts` _after_ that pass, and nothing later filters trails against these blasts (the `instantBlasts` pass only uses its own list). Verified: the same 32-radius blast at (900, 450) removes a trail segment at (905, 470–480) when produced by a landed bomb but leaves it intact when produced by a gun projectile hitting a rider. The visual blast shows trail-burning that does not happen.

**Suggested fix.** After the shell/gun sweep loop, run the trail-clearing filter for blasts appended during it, or move the clearing pass after the sweep loop.

---

## 9. Online: peer connections created before the `/ice` fetch resolves negotiate without STUN servers

**Severity:** low · **File:** `src/online/peer-transport.ts` (~63–68, ~71–79, ~141–152)

`ws.onmessage` is `async` and each message is handled independently. On `welcome` the transport populates `connections` synchronously and then awaits `fetch(/api/rooms/:code/ice)` to fill `this.servers`. A host `signal` (offer) or a `peer online` that arrives during that round trip passes the `connections` check, and `link()` builds `new RTCPeerConnection({ iceServers: this.servers })` with the initial `[]`. The host offers as soon as the gateway reports the member, typically around the time the client receives its welcome, so the joiner frequently negotiates its first connection without STUN. Peer-reflexive discovery usually rescues LAN cases, but this degrades WAN connectivity and only heals after the 8 s link-health restart.

**Suggested fix.** Fetch ICE servers before opening the WebSocket, or queue `signal`/`peer` handling behind the welcome promise, and pass the resolved servers to `link()`.

---

## 10. Match recap `durationText` renders "1m 60s" and "60s"

**Severity:** low · **File:** `src/client/main.ts` (~45–48)

`Math.round(seconds % 60)` rounds 59.95 up to 60, and the under-60 branch does `59.95.toFixed(0)` which also yields `60`. Verified: `durationText(2399)` returns `1m 60s` and `durationText(1199)` returns `60s`. These show in the end-of-match recap (UNTOUCHABLE award, SURVIVED/BEST/STAR columns).

**Suggested fix.** Round to whole seconds first (`const s = Math.round(ticks / 20)`), then split into minutes and seconds.

---

## 11. Display page start crashes on prototype-key theme values and unguarded `localStorage` access

**Severity:** low · **Files:** `src/client/main.ts` (~563, ~586–590, ~929, ~932, ~978–979), `src/client/avatar-heads.ts` (~31)

- `savedTheme in themes` accepts prototype keys: `themes` is a plain object literal, so `'constructor' in themes === true` (verified). A stored value such as `constructor` makes `activeTheme = Object.prototype.constructor`, and `applyThemeProperties(activeTheme)` throws on `theme.palette.rim`, leaving the display blank until storage is cleared. Fix with `Object.hasOwn(themes, savedTheme)` or `themes[savedTheme as ThemeId]?.id === savedTheme`.
- Every `localStorage`/`sessionStorage` `getItem`/`setItem` at these sites is un-wrapped. In Safari with "Block all cookies" and some embedded webviews, merely evaluating `localStorage` throws `SecurityError`. `startController()` and `startDisplay()` both touch storage synchronously before rendering, so the phone controller shows a blank page instead of the join form. The online code wraps its storage reads; the LAN client should do the same via a small `safeStorage` wrapper with an in-memory fallback, passed to `createAvatarPicker`.

---

## 12. Display legend images bypass `assetUrl()` and overwrite the base-path-aware sources

**Severity:** low · **File:** `src/client/main.ts` (~507–515 vs ~591–599, ~606–611)

The nine pickup legend `<img>` sources are first set through `assetUrl()` and then immediately overwritten with raw root paths (`` `/themes/${activeTheme.id}/pickup-blast.svg` `` and eight more); the theme `change` handler does the same. Every other asset reference in the client goes through `assetUrl()` so it works under the `/fuse-riders/` GitHub Pages base. Today the display page is only reachable at a root-hosted path, so nothing breaks yet, but the first time the display is served under a base path the whole pickup legend 404s while sprites keep working.

**Suggested fix.** Route those assignments through `assetUrl()` (or a `legendSrc(theme, name)` helper) and delete the duplicated block.

---

## 13. LAN controller: `SocketClient.connect()` while the previous socket is still CONNECTING orphans that socket

**Severity:** low · **File:** `src/client/main.ts` (`SocketClient.connect`, ~84–88; caller ~1133)

When `socket.send()` returns `false` because the socket is not yet `OPEN`, the join form submit calls `socket.connect()`, which creates a second `WebSocket` without closing the first. If the first socket later opens, its handlers early-return (`socket !== this.socket`), so it stays open with no auth or heartbeat. The LAN server's 6 s idle prune eventually terminates it, so this self-heals, but it briefly doubles connections per phone on flaky Wi-Fi.

**Suggested fix.** In `connect()`, close the existing socket first (guarded so its `close` handler is ignored) before creating the new one.

---

## Robustness notes not filed as bugs

- **`src/service/pubsub-bus.ts` (~43–53):** the bus is constructed with `messageOrdering: true` and `gaxOpts: { retry: null }`. In `@google-cloud/pubsub@6.0.1` a failed publish latches an error on that ordering key and rejects every later `add()` until `resumePublishing(key)` is called, which the bus never does. Because the key includes both connection ids and a publish failure already closes the socket (4000) and forces a reconnect with a fresh id, the latched key is not re-used, so the only effect is that a single transient publish blip tears down one signalling socket instead of retrying. Consistent with the project's fail-fast stance; worth knowing if retries are ever added.
- **`src/service/pubsub-bus.ts` (~52):** `pendingBytes` is decremented in `finally` only when the generation is unchanged. A `start()` during an in-flight publish without an intervening `stop()` would leak that budget permanently. Not reachable in the current gateway flow.

## Areas checked and found sound

- **Cloud Run service (`src/service/`):** liveness vs readiness split, allow-listed CORS with `Vary: Origin`, per-connection count/byte/pending limits with balanced accounting, 32 000 byte payload cap, binary frames rejected, `expiresAt <= now` used consistently, idempotent Firestore transaction callbacks, serialised connect/disconnect/stop, TTL-pruned dedupe, signal payload allow-lists, guest-to-guest routing denied, correct HTTP status codes.
- **Scripts and CI:** `deploy-cloud.sh` gates on clean tree, pushed `main` and CI success, deploys the committed tree by image digest and re-checks `main` before deploying; `pages.yml` refuses superseded or forked revisions; every smoke and benchmark script sets a non-zero exit code on failure; remote benchmarks require an explicit opt-in.
- **Tests:** no duplicate names, no `.skip`/`.only`, no vacuous assertions, servers and child processes closed with bounded timeouts; README and AGENTS.md links, paths and scripts all resolve.

- **Determinism:** no `Math.random`/`Date.now` in `src/shared`; seeded mulberry32 RNG, separate bot hash stream, slot-sorted player iteration.
- **Leaderboard math, shell/gun/blast geometry, trail clipping, portal placement and transit, volley/launch bounds, drunk steering integration, shield and grace interactions, pickup pacing, match-stats accounting.**
- **Protocol parsing:** key allowlists, size caps, `__proto__` rejected, token regexes, aim range.
- **LAN server:** static path-traversal guard, timing-safe host auth, capability checks, reconnect socket replacement, watchdog and timer cleanup.
- **Online:** world codec encode/decode symmetry and bounds, keyframe delivery and receipt lifecycle, checkpoint shape guards and atomic restore, host-session seq/tick windows and pending caps, authority grant epoch fencing, bounded dedupe buffers, interval and listener cleanup on close, all user strings rendered via `textContent`, storage reads wrapped.
- **Client:** no `innerHTML` with user data; pointer id recycling, `pointercancel`, capture fallback; keyboard stuck-key clearing on blur/hide; snapshot ordering guards; bounded caches; Phaser lifecycle (context lost/restored, deferred destruction, pools).
- **Worker/Durable Object:** internal routes unreachable from the public router, host bearer required for `/end`, expiry comparisons consistent, alarm reschedule/deleteAll, stale-connection fencing, host-only deadline extension, host↔guest signal routing, per-second count/byte limits.
- **Config:** `wrangler.jsonc` routing, worker tsconfig, Vite base from `pages.yml`, `asset-url` idempotence, theme manifest matches sprites loaded in `arena.ts`.

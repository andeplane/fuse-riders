# WebKit RTCDataChannel send race (issue #7)

## Symptom

Final public WebKit acceptance on release 68bea0db completed every product assertion but failed the `pageerror` gate of `scripts/public-release-smoke.mjs` with:

```
Error sending string through RTCDataChannel.
    at sendDirectProbe (.../assets/ui-*.js)
    at receive (.../assets/ui-*.js)
```

Chrome passed. In the failing run the guest browser context had already been closed before the TV peer joined, so the host was answering a link probe on a channel whose remote side no longer existed.

## WebKit mechanism

`RTCDataChannel::send` in WebKit does not deliver synchronously. It enqueues the string into a `NetworkSendQueue`; the queue's callback later calls `RTCDataChannelHandler::sendStringData`, and when libwebrtc returns `false` it reports the failure as a console message (`Source/WebCore/Modules/mediastream/RTCDataChannel.cpp`, `RTCDataChannel::createMessageQueue`):

```cpp
if (!channel.m_handler->sendStringData(utf8))
    protect(channel.scriptExecutionContext())->addConsoleMessage(MessageSource::JS, MessageLevel::Error, "Error sending string through RTCDataChannel."_s);
```

libwebrtc returns `false` when the SCTP/DTLS transport is already closed. The DOM `readyState` is updated from the signalling thread through a later main-thread task, so for a window of at least one task the channel still reports `"open"` while its transport is gone. Playwright's WebKit driver maps console messages with level `error` and source `javascript` to `pageerror`, which is why the smoke's page-error gate tripped without any JavaScript exception.

## Why try/catch cannot catch it

Our `send` and `sendDirectProbe` already wrapped `channel.send` in `try/catch`. The call succeeds from JavaScript's point of view: the message is queued and the failure is reported later from the queue callback as a console error rather than an exception. A `readyState === "open"` check immediately before `send` is also insufficient because the state flips only after the failing send has been queued.

## Fix

Two parts, because the failing send in the issue's stack is the `linkPong` answered from `receive`, and no early signal can reach that send.

**1. Defer the probe answer by one macrotask.** libwebrtc posts `OnMessage` for the last probe before it posts `OnStateChange(closing)` for the transport that just died, so WebKit runs our `onmessage` while the closing task is already queued behind it. A pong sent inside that `onmessage` task is therefore inside the window by construction: the channel reads `"open"`, no `onclosing`/`onclose`/connection-state handler has run yet, and the service's `peer offline` (guest socket to gateway to host socket) cannot beat a direct DTLS close over UDP. `receive` now answers a `linkProbe` from a deferred macrotask, fenced by `isCurrentLinkCallback` so a replaced link never answers. The queued state-change task runs first, after which both `readyState` and the gate refuse the send. The deferral uses a `MessageChannel` port (`PeerTransport.defer`), not `setTimeout(0)`: browsers throttle timers in background tabs (Chrome clamps a hidden tab to one second, then once a minute after five minutes), so a screen-off phone would answer probes a second late, its host-side `LinkHealth` would fail, and `checkLinks` would force-re-offer a healthy channel every 8 s. `postMessage` tasks are not throttled and keep the same ordering guarantee behind the already-queued state-change task. The deferral is well inside `LinkHealth`'s 600 ms acknowledgement window and does not change probe or gameplay ordering; `close()` discards pending deferred tasks.

**2. Gate every send on recorded closure.** `src/online/link-send-gate.ts` adds a small pure `LinkSendGate` per link: a monotonic `draining` flag, and `permits(channel, bufferLimit)` which requires not draining, `readyState === "open"` and `bufferedAmount` under the existing thresholds (64000 for gameplay envelopes, 4096 for probes; probe permission is now `bufferedAmount < 4096` instead of `<= 4096`, a one-byte boundary with no behavioural significance). `src/online/peer-transport.ts` drains the gate from:

- data channel `onclosing`, `onclose` and `onerror`;
- `RTCPeerConnection` `connectionstatechange` and `iceconnectionstatechange` when the state is `failed` or `closed`;
- the service/Worker `peer … online:false` notification for the connection ID the link was created for.

**Peer offline now tears the link down (issue #22).** The offline branch previously ignored the message when the channel still read `"open"`, and nothing afterwards ever marked the player disconnected: `callbacks.peer(id, false)` never fired, `HostSession.disconnect` never ran, the rider stayed as a neutral-input ghost, and the host re-offered to the retired connection ID every 8 s. The service is the membership authority under ADR035 and sends the notification once per retired connection, so the branch now always drains the gate, deletes the connection entry, emits `peer(id, false)`, closes the peer connection and drops the link. A returning member gets a new connection ID, a `peer online` notification and a fresh link, exactly as before. With immediate teardown there is no remaining state in which a link exists without a service identity, so no additional teardown from `onclose` or `failed` is needed.

One door remained: if the host's own socket dies, a guest leaves during the outage, and the host reconnects, the `welcome` roster no longer lists that guest but no `peer offline` message is ever sent for it. The `welcome` handler now compares the previous connection map against `message.peers` before rebuilding it and emits `peer(id, false)` for every peer missing from the roster, so `HostSession.disconnect` runs for guests that vanished during the outage. This lives in `PeerTransport` next to the socket handling and is documented rather than unit-tested for the same harness reason as the other transport wiring.

`connectionState === "disconnected"` deliberately does not drain the gate. ADR035 requires a link that suffers a brief impairment to recover through two fresh probe acknowledgements, and a permanent drain would suppress the probes that make that recovery possible; the existing `LinkHealth.fail` path already stops gameplay sends there until the acknowledgements return.

The drain flag is monotonic and owned by the `Link` instance. A replacement link, created by a new offer, a new peer connection ID or a restart, gets a fresh gate, so an old link's flag cannot poison the new one. All handlers stay fenced by `isCurrentLinkCallback` as before.

Invariants kept: a permitted send still means queued in the browser, never applied by the peer; no relay or TURN path was added; delivery ordering and the health/restart logic are unchanged; no test or coverage threshold was weakened. The gate is added to `.c8rc.json` at the existing 95/95/95/85 thresholds.

## Tests

`tests/link-send-gate.test.ts` (typed, fake channel facts, no sleeps):

- healthy open channel under the buffer limits is permitted; over-limit, undefined and non-open states are refused;
- the readyState-transition regression: the channel still reports `"open"` but a closing signal has been recorded, so neither the gameplay nor the probe send is permitted, and further signals keep it drained.

The deferred pong and the offline teardown live in `PeerTransport`, which has no unit harness (it depends on `WebSocket`, `RTCPeerConnection`, `document` and `location`); they are covered by the Chrome and WebKit online and shared-room browser smokes. On `main`, the WebKit shared-room smoke reproduced the exact `sendDirectProbe` page error once during END ROOM; the PR records five consecutive clean WebKit shared-room runs as the regression evidence.

## What remains unverified

The public deployment has not been re-run against this change. After deployment, run the post-deploy check (it drives Chrome and WebKit in one invocation) and confirm `errors` is empty in `artifacts/public-acceptance.json`:

```
node scripts/public-release-smoke.mjs
```

A message queued before the close, the pong-on-probe path in the issue's stack, is inside the window by construction: the probe arrives in the same libwebrtc callback batch as the closing state change, so no channel, connection or service signal can have drained the gate yet. The one-macrotask deferral, not the gate, is what closes that window. The gate covers every other send that happens after any early signal. A remote peer that vanishes with no signal at all reaching us before our next gameplay send (no closing task queued yet, no service notification yet) can still hit WebKit's queue error once; JavaScript has no earlier signal to act on, so that residual window is documented rather than claimed closed.

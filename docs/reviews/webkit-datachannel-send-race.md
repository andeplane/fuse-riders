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

`src/online/link-send-gate.ts` adds a small pure `LinkSendGate` per link. It records the first closing signal the browser or service gives us before the DOM state changes, and `permits(channel, bufferLimit)` refuses a send once one is recorded, in addition to the existing `readyState === "open"` and `bufferedAmount` thresholds (64000 for gameplay envelopes, 4096 for probes; probe permission is now `bufferedAmount < 4096` instead of `<= 4096`, a one-byte boundary with no behavioural significance).

`src/online/peer-transport.ts` drains the gate from:

- data channel `onclosing`, `onclose` and `onerror`;
- `RTCPeerConnection` `connectionstatechange` and `iceconnectionstatechange` when the state is `failed` or `closed`;
- the service/Worker `peer … online:false` notification for the connection ID the link was created for. That branch previously kept an "open" channel alive; it now stops sending first and still defers link teardown and the offline callback until the channel is no longer open.

`connectionState === "disconnected"` deliberately does not drain the gate. ADR035 requires a link that suffers a brief impairment to recover through two fresh probe acknowledgements, and a permanent drain would suppress the probes that make that recovery possible; the existing `LinkHealth.fail` path already stops gameplay sends there until the acknowledgements return.

The drain state is monotonic and owned by the `Link` instance. A replacement link, created by a new offer, a new peer connection ID or a restart, gets a fresh gate, so an old link's flags cannot poison the new one. All handlers stay fenced by `isCurrentLinkCallback` as before.

Invariants kept: a permitted send still means queued in the browser, never applied by the peer; no relay or TURN path was added; delivery ordering and the health/restart logic are unchanged; no test or coverage threshold was weakened. The gate is added to `.c8rc.json` at the existing 95/95/95/85 thresholds.

## Tests

`tests/link-send-gate.test.ts` (typed, fake channel facts, no sleeps):

- healthy open channel under the buffer limits is permitted; over-limit, undefined and non-open states are refused;
- the readyState-transition regression: the channel still reports `"open"` but a `closing`, `closed`, `error`, `failed` or `offline` signal has been recorded, so neither the gameplay nor the probe send is permitted;
- draining is monotonic, the first reason and timestamp are kept;
- a replacement link starts with a fresh gate while the retired link stays drained.

The transport wiring itself has no unit harness (it depends on browser globals); it is exercised by the Chrome and WebKit online, shared-room and Phaser browser smokes in CI.

## What remains unverified

The public deployment has not been re-run against this change. After deployment, run the post-deploy check (it drives Chrome and WebKit in one invocation) and confirm `errors` is empty in `artifacts/public-acceptance.json`:

```
node scripts/public-release-smoke.mjs
```

The gate closes the window between an early closing signal and the DOM state change. A remote peer that vanishes without any signal reaching us before our next send (no service notification yet, no ICE or channel event yet) can still hit WebKit's queue error once; only fewer, earlier signals are available from JavaScript, so that residual window is documented rather than claimed closed.

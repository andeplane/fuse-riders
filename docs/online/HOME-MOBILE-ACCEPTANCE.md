# Landing, solo and mobile dialog acceptance

Verified against isolated local preview `http://127.0.0.1:4188/`, with the source/served asset hashes in [identity](home-evidence/identity.json). This is browser emulation, not physical-phone or public deployment acceptance. Chrome and WebKit ran sequentially at 320×568, 390×844 and 844×390; [all eight cases passed](home-evidence/passing-matrix.json), comprising six viewport cases and two cold rapid-navigation cases.

The viewport cases assert no horizontal landing overflow, advancing rendered AI background, pause/resume and static reduced-motion behavior. PLAY SOLO admits You plus four AI, displays controls after refresh, and keeps controls/arena visible even with `?solo=1&display=1`. Request/constructor instrumentation records zero room API calls, WebSockets and RTCPeerConnections across the viewport flow. Settings, audio, HEAD and MENU dialogs fit the viewport; body scrolling leaves Close reachable and clickable. Audio opens its panel, and both sliders remain reachable within the viewport. [320px WebKit audio](home-evidence/audio-320-webkit.png) was visually inspected; [390px Chrome landing](home-evidence/landing-390-chrome.png) preserves the actual UI.

## Rapid-navigation defect and regression

The first viewport run exposed WebKit page errors when navigation cancelled pending Phaser requests. The initial [failure](home-evidence/initial-navigation-failure.json) and separate [phase-labelled rapid trace](home-evidence/rapid-navigation-before-fix.json) are preserved. The stack was Phaser `File.onError → File.load → XHRLoader.send`: cancelled requests retried during document navigation and WebKit rejected those new requests as access-control errors. This was not ignored by adding renderer-ready waits to stable layout checks.

A first pagehide-only cancellation attempt still failed; [that report](home-evidence/pagehide-only-failure.json) remains separate. The successful fix cancels the current renderer's inflight loads before unload as well as on ordinary destroy: detach Phaser XHR callbacks, clear its timeout callback, abort, then reset loader queues. The per-instance beforeunload handler neither prompts nor prevents navigation and is removed on destroy. Normal asset retries are unchanged. Phaser 3.90 LoaderPlugin.reset clears its sets but does not itself detach/abort each XHR, which is why explicit cancellation is needed.

The permanent rapid regression delays only theme XHR delivery by 300 ms, waits until a preload is pending, clicks Solo immediately and reloads before its renderer is ready. Both browsers finish with zero page errors. The [targeted fixed WebKit trace](home-evidence/rapid-navigation-fixed.json) records 29 normally cancelled requests and no errors. Tests retain the clean-error assertion; cancellation itself is expected during navigation.

Typecheck and the existing Chrome/WebKit Phaser lifecycle tests also passed after the fix, including WebGL, forced Canvas, bounded effects, GPU restoration and visible fallback. No occupied LAN server was used or restarted.

```sh
HOME_URL=http://127.0.0.1:4188/ npx tsx scripts/home-mobile-smoke.ts
npx tsx scripts/phaser-browser.ts
BROWSER=webkit npx tsx scripts/phaser-browser.ts
```

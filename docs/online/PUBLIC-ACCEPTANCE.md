# Initial public acceptance — 2026-09-14

This is positive-path public deployment evidence, not poor-network or physical-phone qualification. Two fresh disposable rooms were created through the actual Pages UI; no occupied LAN game was used. Chrome and WebKit ran sequentially with a desktop host and mobile-sized guest in separate browser contexts.

- Frontend: `https://andeplane.github.io/fuse-riders/`
- Served release: `2ff884388cfd0930088bade0bc849bc936d46bb7`
- Served CI identity: `34791214391`
- Configured backend: `https://fuse-riders-gateway-oaaqztec5a-ew.a.run.app`
- Raw results: [public-initial-acceptance.json](public-initial-acceptance.json).
- Reproduction: `node scripts/public-release-smoke.mjs` (creates fresh public test rooms).

Both browsers completed UI room creation, host join, ADD AI, guest join over direct WebRTC, received countdown, Phaser WebGL rendering and a normally scored round. Both reported one direct peer and zero relayed peers. No failed HTTP asset responses were recorded. Chrome recorded no page errors. WebKit recorded **one `Error sending string through RTCDataChannel.` page error**, despite completing those functional assertions. The original harness recorded the message only, so its stack and exact originating send path remain unknown; the checked-in runner captures stacks in future runs. Do not call this a clean WebKit release until the deployed fix is rerun.

The raw `pass` fields refer to the completed functional assertions; they do not override the separately recorded WebKit error. Snapshot metrics are individual samples, not latency distributions. Both environments were automated desktop browsers; mobile viewport emulation does not establish physical-phone compatibility.

[Actual public Phaser screenshot](../public-phaser-chrome.png) shows the countdown with the host, AI and guest visible. It is not an image-generated mockup or a screenshot of the later scored round. The hosted release predates later keyframe-recovery and shot-failure changes and cannot certify those changes.

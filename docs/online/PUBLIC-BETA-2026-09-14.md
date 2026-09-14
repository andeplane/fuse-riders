# Public online beta — 2026-09-14

[Play Fuse Riders](https://andeplane.github.io/fuse-riders/). The public Pages frontend and Cloud Run room service have connected successfully in real browser tests. This is an online beta: the creator's browser runs the game and must remain in the foreground. Gameplay requires direct WebRTC; no TURN or backend gameplay relay is configured. Network problems can pause/cancel actions or require retry. Physical phones have not yet completed online qualification.

## Exact evidence

| Check | Verified version and result |
| --- | --- |
| Initial public frontend | Pages source `2ff884388cfd0930088bade0bc849bc936d46bb7`; verified CI `34791214391`; base `/fuse-riders/`; build timestamp `2026-09-14T00:16:45.777Z` |
| Subsequent published frontend | Public `release.json` fetched after Pages run `34792756008` reports source `81939f3426a7a64e3ecb8421cba5a62aa65442f6`, CI `34792494691`, built `2026-09-14T00:27:54.927Z`; distinct from the initial browser test |
| Initial public Chromium | Created room, added AI, joined guest, received countdown and scoring; Phaser WebGL; one direct peer link, zero relayed; no recorded page errors or failed requests |
| Initial public WebKit | Same room/AI/guest/countdown/scoring flow completed, but recorded `Error sending string through RTCDataChannel.`; **not clean acceptance** despite the original harness's flow-level `pass: true` |
| Current recorded backend | Source `81939f3426a7a64e3ecb8421cba5a62aa65442f6`; ready revision `fuse-riders-gateway-00002-x2q`; 100% traffic at subsequent service inspection |
| Backend runtime identity | `fuse-riders-runtime@andershaf-87.iam.gserviceaccount.com`, inspected from the service configuration |
| Public provider smoke | Passed at `2026-09-14T00:29:31.766Z`; HTTP/WSS public endpoints, no CLI/ADC credentials |

The backend origin is `https://fuse-riders-gateway-oaaqztec5a-ew.a.run.app`. Cloud Build `f3266f39-2b28-42e4-aa02-1037e9972983` produced image `europe-west1-docker.pkg.dev/andershaf-87/fuse-riders/fuse-riders@sha256:467dab03074ff4666aa5a06ebdc2084000c83eb05807b914f8b02c5f693a90b0`. Provider resources, account scopes and operating limits are in [GCP inventory](GCP-INVENTORY.md) and [deployment instructions](GCP-DEPLOY.md).

Raw evidence is preserved separately:

- [Subsequent public Pages release metadata](evidence/pages-release-81939f3-2026-09-14.json), independently fetched without opening a browser.
- [Initial public browser results](evidence/public-browser-initial-2ff8843-2026-09-14.json), including the WebKit error.
- [Backend release manifest](evidence/cloud-release-81939f3-2026-09-14.json), recorded before smoke and therefore retaining its original `NOT YET VERIFIED` field.
- [Passing public provider smoke](evidence/cloud-public-smoke-81939f3-2026-09-14.json), recorded afterward.
- [Ready revision, traffic and attached account](evidence/cloud-service-81939f3-2026-09-14.json), from a subsequent read-only provider inspection.

## What the checks establish

The public browser result establishes that the actual Pages bundle can create a room through the deployed API, join two browser identities, establish a direct game link, render Phaser gameplay and reach scoring. These are browser-automation results, not physical-phone or five-player sustained-network measurements. The recorded frame/input metrics are a short diagnostic snapshot, not a comprehensive latency benchmark.

The provider smoke establishes safe health routes, allowed/denied Origin behavior, room creation, host/guest WSS admission, ICE metadata, synthetic SDP in both directions, rejection of gameplay relay, identity-only lease renewal and fenced host replacement. Because it uses public endpoints without operator credentials, it exercises the deployed service's provider permissions. The service-account email is established by the separate configuration inspection. The smoke cannot force two Cloud Run instances and does not itself establish real WebRTC; that comes from the separate browser check.

Test sockets were closed. No public delete/namespace override endpoint exists, so the one random smoke room and creation-limit record are left to the active Firestore TTL policies. No occupied user room was used.

## Preserved failure and pending acceptance

The initial backend `00001-5mm` public smoke failed at `/healthz`, intercepted by Google's reserved URL behavior. The next backend added `/api/health` and `/api/ready`; the later passing smoke is a separate run on `00002-x2q`. The initial failure remains part of [deployment history](GCP-INVENTORY.md#initial-deployment).

The initial WebKit RTC-send error has not been conclusively attributed. Later callback-ownership/liveness/keyframe fixes and green unit tests do not prove that this deployed-browser error is resolved. A clean test of the final published WebKit bundle remains required. The old raw flow-level `pass: true` must not hide its error list.

Poor-direct-network freshness/recovery and sustained play remain qualification work. Existing failed runs and their thresholds are retained in [network evidence](NETWORK-EVIDENCE-2026-09-14.md). New source commits, running CI and an in-progress soak are not substituted for completed public acceptance. Refresh all preview clients when deploying the keyframe-receipt protocol changes; old bundles may otherwise stall waiting for a compatible stream.

# Public online beta — 2026-09-14

[Play Fuse Riders](https://andeplane.github.io/fuse-riders/). The Pages frontend and Cloud Run room service are deployed. The host can create a room on a phone, add AI opponents, invite friends, choose shared TV or individual screens, and save game preferences locally.

The creator's browser runs the game and must remain in the foreground. Gameplay requires direct WebRTC; no TURN or backend gameplay relay is configured. Failed direct connections produce retry states. These are deliberate product limits, not guarantees that every network can connect.

## Verified releases

| Check | Exact evidence |
| --- | --- |
| Deployed backend | Source `66f67bd0fb1f751f0d2a8a9f2ec8b0a9bc4d32d5`, revision `fuse-riders-gateway-00003-qf7`, 100% traffic; [inventory](GCP-INVENTORY.md) |
| Public provider smoke | [Passed against the deployed service](evidence/cloud-public-smoke-66f67bd-2026-09-14.json), using public HTTP/WSS endpoints without operator credentials |
| Expanded public browser check | Chrome and WebKit passed at frontend `d715642ebd4d0cc63c5e5639a0adee6c3f4ab05d`, CI `34794220106`, with zero page errors or failed HTTP responses; [raw results and scope](PUBLIC-ACCEPTANCE.md#final-expanded-public-check) |
| Subsequent frontend publication | Source `e1dcc6f0f35f518d86c066a5f6c11ad622dd9330`, CI `34795238231` and Pages `34795480877` succeeded. This publication is distinct from the completed public browser check above. |

Backend origin: `https://fuse-riders-gateway-oaaqztec5a-ew.a.run.app`. Runtime identity: `fuse-riders-runtime@andershaf-87.iam.gserviceaccount.com`. Exact image, provider resources, account scopes, operating limits and rollback instructions are in [GCP inventory](GCP-INVENTORY.md) and [deployment instructions](GCP-DEPLOY.md). Later frontend-only commits do not imply a new backend image.

The expanded public check exercised a phone-sized host creating and joining a room, adding AI, accepting a guest over WebRTC, starting a scored round and resetting. It also verified shared-screen mode, saved length/powerup preferences across refresh, and a separate TV started/reset from the phone. These are automated desktop Chrome/WebKit checks, not physical-phone measurements.

## Performance evidence and remaining work

- [AI riders](AI-RIDERS.md): ordinary input/physics, five combined human/AI slots, mid-race additions join next round; deterministic tests and browser scoring checks passed.
- [Phaser benchmarks](../PHASER.md): desktop and mobile-sized views measured with production backing resolution. Mobile-sized frame p95 was 16.7 ms in Chrome and 18 ms in WebKit; physical hardware remains unverified.
- [Network evidence](NETWORK-EVIDENCE-2026-09-14.md): a 30-minute soak passed its documented scope at source `66f67bd`. Later 20 Hz regional and poor profiles passed recovery/freshness checks, but poor-network correction tails remain large. Application-message impairment is not OS-level packet loss.
- [Actual response benchmark](RESPONSE-BENCHMARK.md): local heading response p95 is about 30 ms. TV response remains around 160 ms, above the proposed 100 ms target; the measured qualification failure is under correction in ADR037. This known gap is not waived by calling the release a beta.

Physical touch-to-photon, background/lock and network-transition behavior are not established by phone-sized browser tests. Each linked report identifies its tested artifact; newer commits and running CI are not evidence of a completed test.

## Preserved deployment history

The initial backend `00001-5mm` smoke failed at Google's reserved `/healthz` route. Revision `00002-x2q` introduced `/api/health` and `/api/ready`; revision `00003-qf7` has the matching-source public proof above. Earlier manifests and failures remain in [deployment history](GCP-INVENTORY.md#initial-deployment).

Initial public frontend `2ff8843` completed the game flow in WebKit but logged an RTC send error. The [initial raw report](evidence/public-browser-initial-2ff8843-2026-09-14.json) retains that failure; the separate clean `d715642` retest resolves the observed symptom for the tested sequence without claiming that all possible RTC failures are impossible.

The public provider smoke verifies health, CORS, room creation, host/guest signalling, ICE metadata, rejection of gameplay relay, lease renewal and fenced host replacement. It does not force two Cloud Run instances or establish real WebRTC by itself; the browser checks establish the latter. Temporary test sockets were closed and disposable records are left to Firestore TTL. No occupied user room was used. Refresh all clients together when releasing protocol changes.

# GCP resource inventory

Verified 2026-09-14. The initial backend and Pages artifact are deployed; final public gameplay and impairment acceptance are tracked separately.

- Project: `andershaf-87`; operator: `andershaf@gmail.com` (active gcloud account verified).
- Region: `europe-west1`.
- Firestore: named native database `fuse-riders`, created and verified in `europe-west1`. Existing `(default)` Datastore database in `nam5` is untouched. The new database reports `freeTier: false`; database operations are billable, not promised free.
- Firestore TTL: `cleanupAt` is ACTIVE on collection groups `fuse-production-rooms` and `fuse-production-creation-limits`; application expiry checks remain immediate and independent.
- Pub/Sub: `fuse-riders-signalling`, created with 10-minute topic retention. Only SDP/ICE signalling is allowed. The earlier unused `fuse-riders-relay` topic was deleted after the direct-only decision.
- Runtime service account: `fuse-riders-runtime@andershaf-87.iam.gserviceaccount.com`.
- Runtime database IAM: `roles/datastore.user`, condition limited to `projects/andershaf-87/databases/fuse-riders`.
- Runtime Pub/Sub IAM: project custom role `fuseRidersSignalling` with subscription create/get/delete/consume; topic-bound `fuseRidersTopic` with topic get/publish/attachSubscription. No topic creation/deletion or IAM administration.
- GitHub Pages: `https://andeplane.github.io/fuse-riders/`. Initial Actions deployment `34791501787` served source `2ff8843`; the completed update `34792756008` serves source `81939f3426a7a64e3ecb8421cba5a62aa65442f6`, verified CI `34792494691`. The public `release.json` was fetched and preserved below. Browser gameplay evidence currently refers to the initial `2ff8843` bundle, not the later update.
- Enabled deployment APIs include Cloud Run, Cloud Build, Artifact Registry, Firestore, Pub/Sub and IAM. No service-account keys were created.

Image registry `europe-west1-docker.pkg.dev/andershaf-87/fuse-riders` is created. Build account `fuse-riders-build@andershaf-87.iam.gserviceaccount.com` has writer access to that repository, log-writer permission, and object-viewer access only to the dedicated `gs://andershaf-87-fuse-riders-build` source bucket. Deployment scripts stage source in that bucket.

## Initial deployment

- Service: `fuse-riders-gateway`, revision `fuse-riders-gateway-00001-5mm`.
- URL: `https://fuse-riders-gateway-oaaqztec5a-ew.a.run.app`.
- Source: `2ff884388cfd0930088bade0bc849bc936d46bb7`; Cloud Build `d826c1f5-34c1-41d2-aa74-f79c02ff42b8` succeeded.
- Image: `europe-west1-docker.pkg.dev/andershaf-87/fuse-riders/fuse-riders@sha256:e4b51a457e1f07fc06fe686f41a548272daa78f189218ea9c8b2c6cf19a256cd`.
- Limits: minimum zero / maximum two instances, 1 CPU, 512 MiB, concurrency 80, 3600-second request timeout, CPU throttling, no session affinity.
- Actual public room creation returned HTTP 201 and host WSS admission returned protocol 2 plus authority using the attached runtime service account. This establishes those provider operations, not the complete public smoke or RTC acceptance.
- The first complete public smoke stopped at `/healthz`, which Google reserves before requests reach the service. Safe `/api/health` and `/api/ready` aliases were deployed in the subsequent revision below; do not treat the initial failed smoke as passed.

 Active WebSockets incur Cloud Run work; minimum instances zero is not a claim that active play costs nothing.

## Verified beta backend update and public play

At 2026-09-14 00:29 UTC, source `81939f3426a7a64e3ecb8421cba5a62aa65442f6` deployed as `fuse-riders-gateway-00002-x2q`. A subsequent read-only service inspection confirmed this ready revision receives 100% of traffic and uses `fuse-riders-runtime@andershaf-87.iam.gserviceaccount.com`. Cloud Build `f3266f39-2b28-42e4-aa02-1037e9972983` produced immutable image digest `sha256:467dab03074ff4666aa5a06ebdc2084000c83eb05807b914f8b02c5f693a90b0`. The service URL is unchanged.

The public provider smoke **passed** at `2026-09-14T00:29:31.766Z`: safe health paths, Pages CORS, Firestore room creation, WSS host/guest admission, SDP exchange, gameplay rejection, lease renewal and host replacement. The attached runtime identity was verified separately from smoke. [Release manifest](evidence/cloud-release-81939f3-2026-09-14.json), [service configuration](evidence/cloud-service-81939f3-2026-09-14.json), [smoke result](evidence/cloud-public-smoke-81939f3-2026-09-14.json). The original manifest's `NOT YET VERIFIED` field is preserved because it was recorded before the separate passing smoke.

Initial public Chromium testing of Pages source `2ff8843` reached room creation, AI addition, guest join, countdown and scoring over direct RTC with no page errors. WebKit completed those flows but recorded one RTC send page error: this is not clean WebKit acceptance. Subsequent source/CI work does not retroactively certify that deployed bundle. [Public beta evidence and limits](PUBLIC-BETA-2026-09-14.md).

## Matching source update: 00:38 UTC

Source `66f67bd0fb1f751f0d2a8a9f2ec8b0a9bc4d32d5` passed CI `34792860482` and Pages deployment `34793174901`. The public Pages manifest reports that exact source and the same API origin. Cloud Build `4b8336b1-8776-4e79-8950-2720a5ffff56` deployed it as `fuse-riders-gateway-00003-qf7`, receiving 100% of traffic with the same runtime service account. Image digest: `sha256:5e99c930f2f256c8f79bc7d658d58d1aedfb49e425fbe6bb664243c36c68ba89`.

The complete public provider smoke passed again at `2026-09-14T00:38:32.952Z`. This revision includes the reviewed keyframe receipt/retry and retired-channel callback fixes in the frontend. Final public browser retesting and the sustained local soak remain separate pending evidence. [Release manifest](evidence/cloud-release-66f67bd-2026-09-14.json), [runtime identity and traffic](evidence/cloud-service-66f67bd-2026-09-14.json), [public smoke](evidence/cloud-public-smoke-66f67bd-2026-09-14.json), [Pages manifest](evidence/pages-release-66f67bd-2026-09-14.json).

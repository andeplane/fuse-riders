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
- GitHub Pages: `https://andeplane.github.io/fuse-riders/`, deployed by successful Actions run `34791501787`. Its public `release.json` reports source `2ff884388cfd0930088bade0bc849bc936d46bb7`, verified CI `34791214391`, and the Cloud Run API origin below. Browser gameplay verification is separate.
- Enabled deployment APIs include Cloud Run, Cloud Build, Artifact Registry, Firestore, Pub/Sub and IAM. No service-account keys were created.

Image registry `europe-west1-docker.pkg.dev/andershaf-87/fuse-riders` is created. Build account `fuse-riders-build@andershaf-87.iam.gserviceaccount.com` has writer access to that repository, log-writer permission, and object-viewer access only to the dedicated `gs://andershaf-87-fuse-riders-build` source bucket. Deployment scripts stage source in that bucket.

## Initial deployment

- Service: `fuse-riders-gateway`, revision `fuse-riders-gateway-00001-5mm`.
- URL: `https://fuse-riders-gateway-oaaqztec5a-ew.a.run.app`.
- Source: `2ff884388cfd0930088bade0bc849bc936d46bb7`; Cloud Build `d826c1f5-34c1-41d2-aa74-f79c02ff42b8` succeeded.
- Image: `europe-west1-docker.pkg.dev/andershaf-87/fuse-riders/fuse-riders@sha256:e4b51a457e1f07fc06fe686f41a548272daa78f189218ea9c8b2c6cf19a256cd`.
- Limits: minimum zero / maximum two instances, 1 CPU, 512 MiB, concurrency 80, 3600-second request timeout, CPU throttling, no session affinity.
- Actual public room creation returned HTTP 201 and host WSS admission returned protocol 2 plus authority using the attached runtime service account. This establishes those provider operations, not the complete public smoke or RTC acceptance.
- The first complete public smoke stopped at `/healthz`, which Google reserves before requests reach the service. Safe `/api/health` and `/api/ready` aliases are committed for the next deployment; do not treat that failed smoke as passed.

 Active WebSockets incur Cloud Run work; minimum instances zero is not a claim that active play costs nothing.

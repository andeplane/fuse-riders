# GCP resource inventory

Verified 2026-09-14 during deployment preparation. This inventory is not evidence of a live game endpoint.

- Project: `andershaf-87`; operator: `andershaf@gmail.com` (active gcloud account verified).
- Region: `europe-west1`.
- Firestore: named native database `fuse-riders`, created and verified in `europe-west1`. Existing `(default)` Datastore database in `nam5` is untouched. The new database reports `freeTier: false`; database operations are billable, not promised free.
- Firestore TTL: `cleanupAt` is ACTIVE on collection groups `fuse-production-rooms` and `fuse-production-creation-limits`; application expiry checks remain immediate and independent.
- Pub/Sub: `fuse-riders-signalling`, created with 10-minute topic retention. Only SDP/ICE signalling is allowed. The earlier unused `fuse-riders-relay` topic was deleted after the direct-only decision.
- Runtime service account: `fuse-riders-runtime@andershaf-87.iam.gserviceaccount.com`.
- Runtime database IAM: `roles/datastore.user`, condition limited to `projects/andershaf-87/databases/fuse-riders`.
- Runtime Pub/Sub IAM: project custom role `fuseRidersSignalling` with subscription create/get/delete/consume; topic-bound `fuseRidersTopic` with topic get/publish/attachSubscription. No topic creation/deletion or IAM administration.
- GitHub Pages: workflow source configured; expected application URL `https://andeplane.github.io/fuse-riders/`. Reachable application/backend integration not yet verified.

Image registry `europe-west1-docker.pkg.dev/andershaf-87/fuse-riders` is created. Build account `fuse-riders-build@andershaf-87.iam.gserviceaccount.com` has writer access to that repository, log-writer permission, and object-viewer access only to the dedicated `gs://andershaf-87-fuse-riders-build` source bucket. Deployment scripts stage source in that bucket.

Deployed Cloud Run revision/digest/URL, Pages artifact and release checks remain to be recorded after verified deployment. No service-account keys are created. Active WebSockets incur Cloud Run work; minimum instances zero is not a claim that active play costs nothing.

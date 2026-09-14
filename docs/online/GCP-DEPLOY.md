# GCP gateway and GitHub Pages deployment

This is deployment scaffolding, not a deployment record. The user explicitly narrowed transport scope: Pub/Sub carries coordination/signalling only; **gameplay uses direct WebRTC, and a failed direct connection shows failure/retry instead of relaying game data**. This supersedes earlier WSS-gameplay-fallback requirements. Root verified the isolated native Firestore database `fuse-riders` in `europe-west1` in project `andershaf-87`; the pre-existing default Datastore database serves other applications and must remain untouched. Record the actual service URL, image digest, revision and smoke result after deployment. Architectural limits and mandatory release gates remain in ADRs 028–034 and `ROADMAP.md`.

## Resources and runtime

| Component | Configuration |
| --- | --- |
| Static frontend | GitHub Pages, `https://andeplane.github.io/fuse-riders/` (verify actual Pages configuration) |
| Gateway | Cloud Run service, configurable `CLOUD_RUN_SERVICE` (script default `fuse-riders-gateway`) |
| Region/project | `europe-west1`, `andershaf-87` |
| Simulation | Creator browser; the gateway does not run game ticks |
| Room metadata | Native Firestore database `fuse-riders`, collection prefix `fuse-production` |
| Inter-instance signalling/coordination only | Existing Pub/Sub topic `fuse-riders-signalling`; process-addressed short-lived pull subscriptions |
| Public origins | Exact `https://andeplane.github.io`; HTTPS Origin is checked but is not authentication |
| Cloud Run limits | Minimum 0, maximum 2; 1 CPU, 512 MiB, concurrency 80, timeout 3600 seconds, request-based CPU |

Zero minimum instances removes the requested idle compute floor. Open WebSockets are active requests and keep their gateways billable. Firestore, Pub/Sub, artifact storage/builds and egress have separate usage charges. Instance caps are cost controls, not authority fencing. Cloud Run may disconnect a socket at the request timeout; clients must reconnect safely. [Cloud Run WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets)

The container entrypoint is `node --import tsx src/service/index.ts`. It binds `PORT` on all interfaces. Required production environment:

```text
NODE_ENV=production
PORT=8080
GOOGLE_CLOUD_PROJECT=andershaf-87
GCP_REGION=europe-west1
FIRESTORE_DATABASE_ID=fuse-riders
ROOM_COLLECTION_PREFIX=fuse-production
PUBSUB_TOPIC=fuse-riders-signalling
ALLOWED_ORIGINS=https://andeplane.github.io
```

Application Default Credentials come from the attached Cloud Run service account; do not copy credential JSON into the container or frontend. `/api/health` and `/api/ready` are operational checks, not proof of gameplay/network correctness. Cloud Run reserves certain paths ending in `z`; `/healthz` was intercepted by Google's frontend on the first deployed revision. Use the `/api` endpoints publicly. Legacy `/healthz` and `/readyz` aliases remain available in local Node tests. [Cloud Run reserved paths](https://docs.cloud.google.com/run/docs/known-issues#reserved-url-paths)

## Build and deploy a verified commit

Root must first provision/verify the database, topic, Artifact Registry repository, build/runtime service accounts, required APIs, IAM, budgets and backend acceptance. The script deliberately does not enable APIs, create databases/topics/repositories, grant roles or modify other applications. Invoking it **does build and deploy** a public Cloud Run service; do not run it as a read-only check.

Only a clean tracked checkout matching current pushed `main` with a successful latest `CI` push run for that exact commit is accepted. Source is exported with `git archive`, so local untracked files and credentials cannot leak into the Cloud Build source. The Docker context additionally uses an allowlist. Build uses the committed lockfile, records the commit label, resolves the pushed Artifact Registry digest and deploys that immutable digest. A failed build or superseded main revision stops publication.

```sh
export GCP_REGION=europe-west1
export FIRESTORE_DATABASE_ID=fuse-riders
export ROOM_COLLECTION_PREFIX=fuse-production
export PUBSUB_TOPIC=fuse-riders-signalling
export ALLOWED_ORIGINS=https://andeplane.github.io
export CLOUD_RUN_SERVICE=fuse-riders-gateway
export ARTIFACT_REPOSITORY=YOUR_VERIFIED_DOCKER_REPOSITORY
export RUNTIME_SERVICE_ACCOUNT=YOUR_RUNTIME_ACCOUNT@andershaf-87.iam.gserviceaccount.com
export BUILD_SERVICE_ACCOUNT=YOUR_BUILD_ACCOUNT@andershaf-87.iam.gserviceaccount.com
./scripts/deploy-cloud.sh
```

`ARTIFACT_LOCATION` defaults to the chosen GCP region; override it only to match the actual registry repository. No secrets appear in these variables. `gh` must access this repository's Actions metadata and `gcloud` must already be authenticated to the authorized project; the script never changes the active account automatically.

The command writes `artifacts/cloud-release-<commit>.json` with source commit, Cloud Build ID, image digest, service URL, ready revision, prior revision and **smoke NOT YET VERIFIED**. Keep a reviewed, redacted release record after testing; generated artifacts are ignored by git. A successful `gcloud run deploy` does not close the network, phone, cross-instance or ownership gates.

For a local container check without cloud credentials/resources, build the image and provide emulator endpoints with isolated namespaces. Otherwise an ADC-enabled local container can mutate the configured real backend:

```sh
docker build -f Dockerfile.cloud --build-arg BUILD_REVISION="$(git rev-parse HEAD)" -t fuse-riders-gateway:test .
# Supply a local env file with emulator configuration. Never commit that file.
docker run --rm -p 8080:8080 --env-file /absolute/path/to/local-emulators.env fuse-riders-gateway:test
```

The image deliberately retains the lockfile's dev dependencies because `tsx` is currently declared there and executes the TypeScript entrypoint. It runs as the unprivileged Node user. A compiled/pruned runtime is a later image-size optimization, not an excuse to change runtime dependencies without testing.

## Pages pipeline

Set repository variable **`VITE_API_ORIGIN`** to the verified Cloud Run HTTPS origin, without a path or trailing slash. It is public configuration, not a secret. Choose GitHub Actions as the Pages source. The `github-pages` environment should permit only `main`.

`.github/workflows/pages.yml` runs only after a successful `CI` push run on this repository's `main`, checks out that exact SHA and verifies it is still current before building and again before publishing. Pull requests and unchecked branches cannot deploy. It uses `npm run build -- --base=/fuse-riders/`, injects `VITE_API_ORIGIN`, uploads one Pages artifact, and deploys that same artifact without a rebuild. The application must use the injected API origin and preserve the Pages base path; gateway deployment alone cannot repair hardcoded `/api` URLs.

`release.json` in the static artifact identifies the source commit, verified CI run and backend origin. The workflow separately archives SHA-256 hashes of every built file plus a manifest digest in `pages-release-evidence-<commit>`. The hosted release metadata and workflow evidence let an operator identify the exact frontend being served. The deploy job alone has `pages:write` and `id-token:write`; repository checkout credentials are not persisted. [GitHub Pages workflow requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## IAM separation

Use dedicated runtime and build accounts. Neither needs project Owner, Editor, Firebase Admin, Cloud Run Admin or a downloadable service-account key.

- **Runtime Firestore:** `roles/datastore.user` limited to the isolated database where supported; otherwise use supported IAM conditions/custom permissions and verify isolation. The service needs document reads/writes/transactions, not database creation. Do not grant access to the existing default Datastore application accidentally.
- **Runtime Pub/Sub signalling publishing:** `roles/pubsub.publisher` on the dedicated signalling topic. Per-instance subscription creation also needs `pubsub.topics.attachSubscription` on that topic.
- **Runtime subscription lifecycle:** a custom role with `pubsub.subscriptions.create`, `get`, `delete`, `consume` (and `update` only if the adapter updates subscriptions). Creation requires a project-level grant; constrain subsequent operations to the application's subscription prefix where IAM supports it. Do not substitute project-wide Pub/Sub Admin. The adapter must enforce its own naming/retention bounds. Verify the final SDK calls against these permissions. [Pub/Sub access control](https://docs.cloud.google.com/pubsub/docs/access-control)
- **Build account:** Artifact Registry Writer on the designated Docker repository, Logs Writer for Cloud Build logs, and read access to the selected source staging bucket. No runtime database or signalling permissions.
- **Deployer:** Cloud Build build submission/read permissions; Artifact Registry image/repository read permissions; Cloud Run service create/update/read; Service Account User on the specific build/runtime accounts. Making the service public additionally requires service IAM policy permission; let a reviewed bootstrap principal grant public invocation if regular deployers should not have that permission. Read-only prerequisite checks need database/topic metadata access.
- **Cloud Run service agent:** retain the provider-managed artifact-pull/service-agent role; do not use it as the application runtime account.
- **GitHub Actions:** this workflow deploys Pages only. It requires no GCP key or GCP IAM role. A future automatic backend workflow should use workload identity federation, not committed credentials.

Role bindings/resource creation are deliberately not embedded in the deploy script. Record actual custom role definitions and scopes in the release inventory after review.

## Verification and rollback

Verify `/api/health`, `/api/ready`, CORS/preflight and the actual Pages path, then create a disposable room. Exercise creator/guest/TV on separate gateways, host replacement, stale sockets, direct WebRTC establishment, explicit direct-failure/retry and recovery, mixed frontend versions and required network/phone profiles. Record results at the exact source/image revision. Do not use a live occupied room for destructive tests.

For rollback, use the previously recorded ready revision or a previously verified immutable image. First verify protocol/storage compatibility and test an isolated room; rolling backward does not make newer packets/checkpoints compatible automatically:

```sh
gcloud run services update-traffic VERIFIED_SERVICE \
  --project=andershaf-87 --region=europe-west1 \
  --to-revisions=VERIFIED_PREVIOUS_REVISION=100
```

That command changes live traffic. Existing WebSockets can remain on old revisions until reconnect, which is why revision coexistence and lease fencing are mandatory. Pages rollback must also select a compatible previously verified artifact; do not rebuild an old source against new dependencies and call it the same artifact. The current Pages workflow intentionally publishes only current green `main`, so a normal source rollback is a reviewed revert commit followed by CI.

## Verified resource inventory (2026-09-14, before first service deployment)

Read-only provider inspection confirmed the following application-owned resources. The Cloud Run service did not yet exist at this inspection; this is provisioning evidence, not deployed acceptance.

| Resource | Verified binding/configuration |
| --- | --- |
| `projects/andershaf-87/databases/fuse-riders` | Native Firestore, `europe-west1`; default database untouched |
| `fuse-production-rooms.cleanupAt`, `fuse-production-creation-limits.cleanupAt` | Both TTL policies `ACTIVE` |
| Runtime account | `fuse-riders-runtime@andershaf-87.iam.gserviceaccount.com` |
| Runtime database grant | `roles/datastore.user`, condition `resource.name=="projects/andershaf-87/databases/fuse-riders"` |
| `fuse-riders-signalling` topic | Runtime custom `fuseRidersTopic`: `pubsub.topics.attachSubscription`, `get`, `publish`, bound only to this topic |
| Runtime subscriptions | Project custom `fuseRidersSignalling`: `pubsub.subscriptions.create`, `consume`, `get`, `delete` |
| Build account | `fuse-riders-build@andershaf-87.iam.gserviceaccount.com` |
| `europe-west1/fuse-riders` Artifact Registry | Build account `roles/artifactregistry.writer` on this repository |
| `gs://andershaf-87-fuse-riders-build` | Build account `roles/storage.objectViewer` on source bucket |
| Build logging | Build account `roles/logging.logWriter` at project level |

**Subscription IAM residual scope:** the runtime's four subscription permissions currently apply project-wide. Topic attachment and publishing remain restricted to the game's topic, and the adapter creates names beginning `fuse-production-`, but code naming is not an IAM boundary for consuming/deleting other subscriptions. The official supported `resource.name` attribute table lists Pub/Sub Lite, not standard Pub/Sub; a speculative prefix condition was therefore not installed. See [supported resource attributes](https://docs.cloud.google.com/iam/docs/conditions-resource-attributes) and [Pub/Sub permission requirements](https://docs.cloud.google.com/pubsub/docs/access-control). Stronger isolation would use a separate GCP project, or separately provisioned subscription resource policies with a redesigned lifecycle. Record this remaining permission scope when assessing production risk; do not call the current role fully prefix-scoped. No unrelated project bindings were changed by this review.

Use the verified values `ARTIFACT_REPOSITORY=fuse-riders`, `BUILD_SOURCE_BUCKET=andershaf-87-fuse-riders-build` and the dedicated accounts above with the deploy command. Runtime identity/database conditions still require the deployed smoke; the earlier local provider harness used user credentials and cannot verify them.

## Public deployed gateway smoke

After deploying the checked image, run:

```sh
CLOUD_RUN_ORIGIN=https://VERIFIED_SERVICE_ORIGIN npx tsx scripts/cloud-public-smoke.ts
```

The script uses public HTTP/WSS endpoints with `Origin: https://andeplane.github.io`. It creates exactly one fresh random room, checks health/readiness and CORS, creates host/guest connections, checks provider-backed admission, ICE metadata, bidirectional synthetic SDP, gameplay rejection, transactional lease renewal and host replacement. It closes every test socket and writes `artifacts/cloud-public-smoke.json`. Room tokens, raw URLs containing tokens and raw exception messages are never included in the report. It uses no CLI/ADC credentials, so real admission exercises the identity attached to the deployed service. Verify that identity's email separately from the Cloud Run revision configuration.

There is no public room-delete or namespace-override endpoint. This test leaves its random room and rate-limit record for the already enabled TTL policies; it does not delete anything in a shared production namespace. A service URL cannot force two requests onto different instances, so this test does not prove inter-instance Pub/Sub delivery, real WebRTC negotiation, Pages paths or phone play. Run the separate two-process provider harness and real-browser Pages/network acceptance for those boundaries. Local regression command: `npx tsx --test tests/cloud-public-smoke.test.ts`.

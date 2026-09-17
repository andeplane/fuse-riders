# GCP gateway and GitHub Pages deployment

The online beta is deployed; exact source/image versions and public acceptance are recorded in [GCP inventory](GCP-INVENTORY.md) and [dated public beta evidence](PUBLIC-BETA-2026-09-14.md). The instructions below describe reproducible deployment and its verification boundaries. The user explicitly narrowed transport scope: Pub/Sub carries coordination/signalling only; **gameplay uses direct WebRTC, and a failed direct connection shows failure/retry instead of relaying game data**. This supersedes earlier WSS-gameplay-fallback requirements. Root verified the isolated native Firestore database `fuse-riders` in `europe-west1` in project `andershaf-87`; the pre-existing default Datastore database serves other applications and must remain untouched. Record the actual service URL, image digest, revision and smoke result after deployment. Architectural limits and mandatory release gates remain in ADRs 028–034 and `ROADMAP.md`.

## Resources and runtime

| Component                                   | Configuration                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Static frontend                             | GitHub Pages, `https://andeplane.github.io/fuse-riders/` (verify actual Pages configuration)      |
| Gateway                                     | Cloud Run service, configurable `CLOUD_RUN_SERVICE` (script default `fuse-riders-gateway`)        |
| Region/project                              | `europe-west1`, `andershaf-87`                                                                    |
| Simulation                                  | Creator browser; the gateway does not run game ticks                                              |
| Room metadata                               | Native Firestore database `fuse-riders`, collection prefix `fuse-production`                      |
| Inter-instance signalling/coordination only | Existing Pub/Sub topic `fuse-riders-signalling`; process-addressed short-lived pull subscriptions |
| Public origins                              | Exact `https://andeplane.github.io`; HTTPS Origin is checked but is not authentication            |
| Cloud Run limits                            | Minimum 0, maximum 2; 1 CPU, 512 MiB, concurrency 80, timeout 3600 seconds, request-based CPU     |

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

For a new environment, first provision/verify the database, topic, Artifact Registry repository, build/runtime service accounts, required APIs, IAM, budgets and backend acceptance. The existing beta resources are listed in the dated inventory. The script deliberately does not enable APIs, create databases/topics/repositories, grant roles or modify other applications. Invoking it **does build and deploy** a public Cloud Run service; do not run it as a read-only check.

Only a clean tracked checkout whose `HEAD` equals current pushed `main` is accepted. By default the latest `CI` push run for that exact commit must have completed with `success`; the explicit local-verification override below is the only alternative. Source is exported with `git archive`, so local untracked files and credentials cannot leak into the Cloud Build source. The Docker context additionally uses an allowlist. Build uses the committed lockfile, records the commit label, resolves the pushed Artifact Registry digest and deploys that immutable digest. A failed build or superseded main revision stops publication.

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

The command writes `artifacts/cloud-release-<commit>.json` with a `sourceVerification` block (`mode` `ci` or `local`, the observed CI result and, for local mode, the note), source commit, Cloud Build ID, image digest, service URL, ready revision, prior revision and **smoke NOT YET VERIFIED**. Keep a reviewed, redacted release record after testing; generated artifacts are ignored by git. A successful `gcloud run deploy` does not close the network, phone, cross-instance or ownership gates.

### Explicit locally verified deployment

When the user has explicitly accepted deploying before CI completes, set both override variables in addition to the environment above:

```sh
export LOCAL_VERIFIED_REVISION="$(git rev-parse HEAD)"   # must equal the current pushed main SHA
export LOCAL_VERIFICATION_NOTE="360 tests, both typechecks, build, coverage; Chrome/WebKit menu, landscape, keyboard, shared QR and room flows inspected"
./scripts/deploy-cloud.sh
```

The script rejects the override unless `LOCAL_VERIFIED_REVISION` is exactly the current pushed `main` SHA and `LOCAL_VERIFICATION_NOTE` is non-blank. It then permits only a CI run that is pending, absent, or already successful for that commit; a CI run that completed with failure, cancellation or any other conclusion still stops the deployment. The manifest records `sourceVerification.mode=local` with the note and the CI result observed at deploy time. The note is copied verbatim into the manifest, so it must not contain secrets. This path records the operator's local verification; it does not certify the revision, and the automatic successful-CI path remains the default. Record the later CI result against the same commit in the release inventory.

For a local container check without cloud credentials/resources, build the image and provide emulator endpoints with isolated namespaces. Otherwise an ADC-enabled local container can mutate the configured real backend:

```sh
docker build -f Dockerfile.cloud --build-arg BUILD_REVISION="$(git rev-parse HEAD)" -t fuse-riders-gateway:test .
# Supply a local env file with emulator configuration. Never commit that file.
docker run --rm -p 8080:8080 --env-file /absolute/path/to/local-emulators.env fuse-riders-gateway:test
```

The image installs production dependencies only (`npm ci --omit=dev`). `tsx` executes the TypeScript entrypoint, so it is a production dependency; packages that only the browser bundle, the tests or the tooling use (Phaser, Firebase web SDK, Mixpanel, Vite, Playwright, TypeScript) are devDependencies and are not in the image. `tests/service-image-dependencies.test.ts` fails if the entrypoint comes to import a dev-only package. The image runs as the unprivileged Node user. Bundling the entrypoint to drop `tsx` from the runtime is a possible later optimization, not an excuse to change runtime dependencies without testing.

## Backend pipeline

`.github/workflows/backend.yml` runs the same `scripts/deploy-cloud.sh` after a successful `CI` push run on this repository's `main`, so an automatic deployment obeys the same clean-checkout, current-main and green-CI gates as a manual one. It authenticates with workload identity federation and uploads `artifacts/cloud-release-<commit>.json` as run evidence. Deploying is not acceptance: the smoke field still reads **NOT YET VERIFIED**, and the documented public smoke and network gates remain manual.

One-time provisioning (owner-level, deliberately outside the deploy script). The pool, provider and deployer account already exist; the bindings below are what federation needs:

```sh
P=andershaf-87
DEP=fuse-riders-deployer@$P.iam.gserviceaccount.com
POOL=$(gcloud iam workload-identity-pools describe github --project=$P --location=global --format='value(name)')

gcloud iam workload-identity-pools providers create-oidc fuse-riders \
  --project=$P --location=global --workload-identity-pool=github \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref' \
  --attribute-condition="assertion.repository=='andeplane/fuse-riders' && assertion.ref=='refs/heads/main'"

gcloud iam service-accounts add-iam-policy-binding "$DEP" --project=$P \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/$POOL/attribute.repository/andeplane/fuse-riders"

gcloud projects add-iam-policy-binding $P --member="serviceAccount:$DEP" --condition=None \
  --role=roles/cloudbuild.builds.editor
gcloud artifacts repositories add-iam-policy-binding fuse-riders --location=europe-west1 --project=$P \
  --member="serviceAccount:$DEP" --role=roles/artifactregistry.reader
# objectAdmin alone is not enough: `gcloud builds submit` does a create-bucket-if-not-exists
# check first, so the deployer also needs storage.buckets.get or every build fails with
# "The user is forbidden from accessing the bucket".
for ROLE in roles/storage.objectAdmin roles/storage.legacyBucketReader; do
  gcloud storage buckets add-iam-policy-binding gs://andershaf-87-fuse-riders-build \
    --member="serviceAccount:$DEP" --role=$ROLE
done
for SA in fuse-riders-build fuse-riders-runtime; do
  gcloud iam service-accounts add-iam-policy-binding "$SA@$P.iam.gserviceaccount.com" --project=$P \
    --member="serviceAccount:$DEP" --role=roles/iam.serviceAccountUser
done
gcloud run services add-iam-policy-binding fuse-riders-gateway --project=$P --region=europe-west1 \
  --member="serviceAccount:$DEP" --role=roles/run.admin

# Metadata only, for the script's read-only prerequisite checks.
gcloud pubsub topics add-iam-policy-binding fuse-riders-signalling --project=$P \
  --member="serviceAccount:$DEP" --role=roles/pubsub.viewer
gcloud projects add-iam-policy-binding $P --member="serviceAccount:$DEP" --role=roles/datastore.viewer \
  --condition='title=fuse-riders-database-only,expression=resource.name=="projects/andershaf-87/databases/fuse-riders"'
```

The attribute condition is the authorization boundary: only tokens issued to `andeplane/fuse-riders` on `refs/heads/main` can impersonate the deployer, so forks and pull-request branches cannot deploy. `roles/run.admin` is scoped to the one service rather than the project because redeploying a public service reads and rewrites that service's IAM policy.

## Pages pipeline

Set repository variable **`VITE_API_ORIGIN`** to the verified Cloud Run HTTPS origin, without a path or trailing slash. It is public configuration, not a secret. Choose GitHub Actions as the Pages source. The `github-pages` environment should permit only `main`.

`.github/workflows/pages.yml` runs automatically only after a successful `CI` push run on this repository's `main`, resolves the newest CI-verified `main` revision (not necessarily the triggering run's, because CI runs for different commits overlap and a waiting deploy run can be replaced), checks out that exact SHA and verifies it is still on `main` before building and again before publishing. `backend.yml` resolves its target the same way and skips a target that is already live or older than the live revision, so no merge is left undeployed. Pull requests and unchecked branches cannot deploy. It can also be dispatched manually from `main` with two required inputs: `revision`, the exact 40-character SHA that was verified locally, and `local_verification`, a non-blank description of the completed local checks (no secrets). The build job refuses a dispatch whose `revision` is not the current `main` head, and the deploy job re-checks that `main` has not moved before publishing. A manual dispatch does not wait for or consult the CI run for that commit. It uses `npm run build -- --base=/fuse-riders/`, injects `VITE_API_ORIGIN`, uploads one Pages artifact, and deploys that same artifact without a rebuild. The application must use the injected API origin and preserve the Pages base path; gateway deployment alone cannot repair hardcoded `/api` URLs.

`release.json` in the static artifact identifies the source commit, backend origin and `sourceVerification.mode`. For automatic deployments the mode is `ci` and `verifiedCiRun` names the successful CI run; for manual dispatches the mode is `local`, `sourceVerification.note` carries the `local_verification` input verbatim and `verifiedCiRun` is `null`. Treat a `local` manifest as a locally verified deployment, not a CI-certified release. The workflow separately archives SHA-256 hashes of every built file plus a manifest digest in `pages-release-evidence-<commit>`. The hosted release metadata and workflow evidence let an operator identify the exact frontend being served. The deploy job alone has `pages:write` and `id-token:write`; repository checkout credentials are not persisted. [GitHub Pages workflow requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## IAM separation

Use dedicated runtime and build accounts. Neither needs project Owner, Editor, Firebase Admin, Cloud Run Admin or a downloadable service-account key.

- **Runtime Firestore:** `roles/datastore.user` limited to the isolated database where supported; otherwise use supported IAM conditions/custom permissions and verify isolation. The service needs document reads/writes/transactions, not database creation. Do not grant access to the existing default Datastore application accidentally.
- **Runtime Pub/Sub signalling publishing:** `roles/pubsub.publisher` on the dedicated signalling topic. Per-instance subscription creation also needs `pubsub.topics.attachSubscription` on that topic.
- **Runtime subscription lifecycle:** a custom role with `pubsub.subscriptions.create`, `get`, `delete`, `consume` (and `update` only if the adapter updates subscriptions). Creation requires a project-level grant; constrain subsequent operations to the application's subscription prefix where IAM supports it. Do not substitute project-wide Pub/Sub Admin. The adapter must enforce its own naming/retention bounds. Verify the final SDK calls against these permissions. [Pub/Sub access control](https://docs.cloud.google.com/pubsub/docs/access-control)
- **Build account:** Artifact Registry Writer on the designated Docker repository, Logs Writer for Cloud Build logs, and read access to the selected source staging bucket. No runtime database or signalling permissions.
- **Deployer:** Cloud Build build submission/read permissions; Artifact Registry image/repository read permissions; Cloud Run service create/update/read; Service Account User on the specific build/runtime accounts. Making the service public additionally requires service IAM policy permission; let a reviewed bootstrap principal grant public invocation if regular deployers should not have that permission. Read-only prerequisite checks need database/topic metadata access.
- **Cloud Run service agent:** retain the provider-managed artifact-pull/service-agent role; do not use it as the application runtime account.
- **GitHub Actions:** `pages.yml` deploys Pages only and needs no GCP access. `backend.yml` impersonates `fuse-riders-deployer@andershaf-87.iam.gserviceaccount.com` through workload identity federation; no service-account key exists in the repository. The deployer holds build submission, Artifact Registry read, source-bucket object access plus bucket metadata read (`roles/storage.legacyBucketReader`, which `gcloud builds submit` needs for its bucket existence check), Service Account User on the build/runtime accounts, `roles/run.admin` on the single `fuse-riders-gateway` service, and metadata-only read on the signalling topic and the `fuse-riders` database for the script's prerequisite checks. It can write no room data.

The backend workflow also applies and verifies versioned Firestore, Auth and web-key configuration before the gateway build. See [configuration CD](CONFIGURATION-CD.md) for the committed configuration, existing-identity IAM bootstrap and failure recovery. This does not run document migrations or provision new services.

Role bindings/resource creation are deliberately not embedded in the deploy script. Record actual custom role definitions and scopes in the release inventory after review.

## Verification and rollback

Verify `/api/health`, `/api/ready`, CORS/preflight and the actual Pages path, then create a disposable room. Exercise creator/guest/TV on separate gateways, host replacement, stale sockets, direct WebRTC establishment, explicit direct-failure/retry and recovery, mixed frontend versions and required network/phone profiles. Record results at the exact source/image revision. Do not use a live occupied room for destructive tests.

For rollback, use the previously recorded ready revision or a previously verified immutable image. First verify protocol/storage compatibility and test an isolated room; rolling backward does not make newer packets/checkpoints compatible automatically:

```sh
gcloud run services update-traffic VERIFIED_SERVICE \
  --project=andershaf-87 --region=europe-west1 \
  --to-revisions=VERIFIED_PREVIOUS_REVISION=100
```

That command changes live traffic. Existing WebSockets can remain on old revisions until reconnect, which is why revision coexistence and lease fencing are mandatory. Pages rollback must also select a compatible previously verified artifact; do not rebuild an old source against new dependencies and call it the same artifact. The current Pages workflow intentionally publishes only the current `main` head, either after green CI or through an explicit locally verified dispatch, so a normal source rollback is a reviewed revert commit followed by CI or a documented local verification.

## Verified resource inventory (2026-09-14, before first service deployment)

Read-only provider inspection confirmed the following application-owned resources. The Cloud Run service did not yet exist at this inspection; this is provisioning evidence, not deployed acceptance.

| Resource                                                                       | Verified binding/configuration                                                                                   |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `projects/andershaf-87/databases/fuse-riders`                                  | Native Firestore, `europe-west1`; default database untouched                                                     |
| `fuse-production-rooms.cleanupAt`, `fuse-production-creation-limits.cleanupAt` | Both TTL policies `ACTIVE`                                                                                       |
| Runtime account                                                                | `fuse-riders-runtime@andershaf-87.iam.gserviceaccount.com`                                                       |
| Runtime database grant                                                         | `roles/datastore.user`, condition `resource.name=="projects/andershaf-87/databases/fuse-riders"`                 |
| `fuse-riders-signalling` topic                                                 | Runtime custom `fuseRidersTopic`: `pubsub.topics.attachSubscription`, `get`, `publish`, bound only to this topic |
| Runtime subscriptions                                                          | Project custom `fuseRidersSignalling`: `pubsub.subscriptions.create`, `consume`, `get`, `delete`                 |
| Build account                                                                  | `fuse-riders-build@andershaf-87.iam.gserviceaccount.com`                                                         |
| `europe-west1/fuse-riders` Artifact Registry                                   | Build account `roles/artifactregistry.writer` on this repository                                                 |
| `gs://andershaf-87-fuse-riders-build`                                          | Build account `roles/storage.objectViewer` on source bucket                                                      |
| Build logging                                                                  | Build account `roles/logging.logWriter` at project level                                                         |

**Subscription IAM residual scope:** the runtime's four subscription permissions currently apply project-wide. Topic attachment and publishing remain restricted to the game's topic, and the adapter creates names beginning `fuse-production-`, but code naming is not an IAM boundary for consuming/deleting other subscriptions. The official supported `resource.name` attribute table lists Pub/Sub Lite, not standard Pub/Sub; a speculative prefix condition was therefore not installed. See [supported resource attributes](https://docs.cloud.google.com/iam/docs/conditions-resource-attributes) and [Pub/Sub permission requirements](https://docs.cloud.google.com/pubsub/docs/access-control). Stronger isolation would use a separate GCP project, or separately provisioned subscription resource policies with a redesigned lifecycle. Record this remaining permission scope when assessing production risk; do not call the current role fully prefix-scoped. No unrelated project bindings were changed by this review.

Use the verified values `ARTIFACT_REPOSITORY=fuse-riders`, `BUILD_SOURCE_BUCKET=andershaf-87-fuse-riders-build` and the dedicated accounts above with the deploy command. The later public smoke on backend `81939f3` passed using the deployed identity, with the attached runtime account verified separately; the earlier local provider harness used user credentials and remains insufficient on its own.

## Public deployed gateway smoke

After deploying the checked image, run:

```sh
CLOUD_RUN_ORIGIN=https://VERIFIED_SERVICE_ORIGIN npx tsx scripts/cloud-public-smoke.ts
```

The script uses public HTTP/WSS endpoints with `Origin: https://andeplane.github.io`. It creates exactly one fresh random room, checks health/readiness and CORS, creates host/guest connections, checks provider-backed admission, ICE metadata, bidirectional synthetic SDP, gameplay rejection, transactional lease renewal and host replacement. It closes every test socket and writes `artifacts/cloud-public-smoke.json`. Room tokens, raw URLs containing tokens and raw exception messages are never included in the report. It uses no CLI/ADC credentials, so real admission exercises the identity attached to the deployed service. Verify that identity's email separately from the Cloud Run revision configuration.

The current smoke explicitly ends its own random room through the host-authorized end endpoint. Expired metadata and the rate-limit record remain for the enabled TTL housekeeping policies; it does not delete unrelated documents or override the production namespace. Rooms use a90-second host-only reconnect deadline, enforced before eventual TTL deletion (ADR039). A service URL cannot force two requests onto different instances, so this test does not prove inter-instance Pub/Sub delivery, real WebRTC negotiation, Pages paths or phone play. Run the separate two-process provider harness and real-browser Pages/network acceptance for those boundaries. Local regression command: `npx tsx --test tests/cloud-public-smoke.test.ts`.

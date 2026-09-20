#!/usr/bin/env bash
# Verifies application configuration, then builds and deploys an immutable checked commit. IAM/bootstrap is separate.
set -euo pipefail

readonly PROJECT_ID=andershaf-87
GCP_REGION="${GCP_REGION:-europe-west1}" # Verified location of the isolated fuse-riders database.
: "${FIRESTORE_DATABASE_ID:?Set the verified named Firestore database}"
: "${PUBSUB_TOPIC:?Set the existing Pub/Sub topic name}"
: "${ROOM_COLLECTION_PREFIX:?Set an isolated preview or production namespace}"
: "${ARTIFACT_REPOSITORY:?Set an existing Docker Artifact Registry repository}"
: "${RUNTIME_SERVICE_ACCOUNT:?Set the least-privilege Cloud Run service account email}"
: "${BUILD_SERVICE_ACCOUNT:?Set the least-privilege Cloud Build service account email}"
: "${ALLOWED_ORIGINS:?Set exact allowed browser origins, comma-separated}"
CLOUD_RUN_SERVICE="${CLOUD_RUN_SERVICE:-fuse-riders-gateway}"
ARTIFACT_LOCATION="${ARTIFACT_LOCATION:-$GCP_REGION}"
BUILD_SOURCE_BUCKET="${BUILD_SOURCE_BUCKET:-andershaf-87-fuse-riders-build}"
export GCP_REGION FIRESTORE_DATABASE_ID PUBSUB_TOPIC ROOM_COLLECTION_PREFIX ALLOWED_ORIGINS

for command in git gh gcloud node tar; do command -v "$command" >/dev/null || { echo "Missing $command" >&2; exit 1; }; done
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo 'Commit tracked changes before deploying.' >&2; exit 1
fi
revision="$(git rev-parse HEAD)"
repository="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
# Still on main, not necessarily its head: CI takes longer than the gap between merges, so demanding the
# head refused almost every verified revision and nothing deployed at all. A newer commit's own deployment
# supersedes this one, and the cloud-run-gateway concurrency group serialises them.
ancestry="$(gh api "repos/$repository/compare/$revision...main" --jq .status)"
[[ "$ancestry" == identical || "$ancestry" == ahead ]] || { echo "Revision $revision is not on main ($ancestry); refusing to deploy it." >&2; exit 1; }
ci_result="$(gh api "repos/$repository/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=$revision&per_page=20" --jq '.workflow_runs | sort_by(.run_number) | last | if .status == "completed" then .conclusion else "pending" end')"
LOCAL_VERIFICATION_NOTE="${LOCAL_VERIFICATION_NOTE:-}"
source_verification=ci
if [[ -n "${LOCAL_VERIFIED_REVISION:-}" ]]; then
  [[ "$LOCAL_VERIFIED_REVISION" == "$revision" ]] || { echo 'LOCAL_VERIFIED_REVISION must equal the current pushed main SHA.' >&2; exit 1; }
  [[ -n "${LOCAL_VERIFICATION_NOTE//[[:space:]]/}" ]] || { echo 'Set LOCAL_VERIFICATION_NOTE to the completed local checks and visual evidence (no secrets).' >&2; exit 1; }
  [[ "$ci_result" == success || "$ci_result" == pending || "$ci_result" == null ]] || { echo "CI completed with $ci_result; this local override only permits pending CI." >&2; exit 1; }
  source_verification=local
else
  [[ "$ci_result" == success ]] || { echo "CI for $revision is $ci_result; refusing unchecked deployment." >&2; exit 1; }
fi
export source_verification ci_result LOCAL_VERIFICATION_NOTE="${LOCAL_VERIFICATION_NOTE:-}"

# Validate configurable identifiers before passing them as gcloud paths/substitutions.
node --input-type=module <<'NODE'
for (const key of ['GCP_REGION','PUBSUB_TOPIC','ROOM_COLLECTION_PREFIX']) {
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(process.env[key] ?? '')) throw new Error(`Invalid ${key}`);
}
if (!/^(\(default\)|[a-z][a-z0-9-]{1,62})$/.test(process.env.FIRESTORE_DATABASE_ID ?? '')) throw new Error('Invalid FIRESTORE_DATABASE_ID');
if (!/^([a-z][a-z0-9-]{0,31}(,[a-z][a-z0-9-]{0,31})*)?$/.test(process.env.EXTRA_GAME_IDS ?? '')) throw new Error('Invalid EXTRA_GAME_IDS');
for (const origin of (process.env.ALLOWED_ORIGINS ?? '').split(',')) {
  const parsed=new URL(origin);
  if (parsed.protocol!=='https:' || parsed.origin!==origin) throw new Error('Production ALLOWED_ORIGINS must contain exact HTTPS origins');
}
NODE
# The shape check above cannot tell a typo from a game: ask the service's own registry, before a ten-minute image build
# produces a revision that refuses to start.
pnpm exec tsx --eval 'import { extraGameIds } from "./service/history.ts"; extraGameIds(process.env.EXTRA_GAME_IDS);'
[[ "$CLOUD_RUN_SERVICE" =~ ^[a-z][a-z0-9-]{1,48}$ ]] || { echo 'Invalid service name' >&2; exit 1; }
[[ "$ARTIFACT_REPOSITORY" =~ ^[a-z][a-z0-9-]{1,62}$ ]] || { echo 'Invalid artifact repository' >&2; exit 1; }
[[ "$ARTIFACT_LOCATION" =~ ^[a-z][a-z0-9-]{1,62}$ ]] || { echo 'Invalid artifact location' >&2; exit 1; }
for account in "$RUNTIME_SERVICE_ACCOUNT" "$BUILD_SERVICE_ACCOUNT"; do
  [[ "$account" =~ ^[a-z][a-z0-9-]+@andershaf-87\.iam\.gserviceaccount\.com$ ]] || { echo 'Service accounts must belong to andershaf-87.' >&2; exit 1; }
done

# Read-only prerequisite checks. This script never enables APIs or creates IAM/database/topic/repository resources.
gcloud firestore databases describe --project="$PROJECT_ID" --database="$FIRESTORE_DATABASE_ID" --format='value(locationId)'
gcloud pubsub topics describe "$PUBSUB_TOPIC" --project="$PROJECT_ID" --format='value(name)'
gcloud artifacts repositories describe "$ARTIFACT_REPOSITORY" --location="$ARTIFACT_LOCATION" --project="$PROJECT_ID" --format='value(name)'

# Apply the versioned named-database/Auth/key configuration only after the source gate passed.
# This waits for required indexes/TTLs and refuses an unregistered OAuth redirect before any gateway rollout.
pnpm exec tsx scripts/deploy-configuration.ts --apply --revision "$revision"

build_dir="$(mktemp -d "${TMPDIR:-/tmp}/fuse-cloud.XXXXXX")"
trap 'rm -rf "$build_dir"' EXIT
git archive "$revision" | tar -x -C "$build_dir"
image_name="$ARTIFACT_LOCATION-docker.pkg.dev/$PROJECT_ID/$ARTIFACT_REPOSITORY/fuse-riders"
image_tag="$image_name:$revision"
build_id="$(gcloud builds submit "$build_dir" --project="$PROJECT_ID" --region="$GCP_REGION" \
  --config="$build_dir/scripts/cloudbuild.yaml" \
  --gcs-source-staging-dir="gs://$BUILD_SOURCE_BUCKET/source" \
  --service-account="projects/$PROJECT_ID/serviceAccounts/$BUILD_SERVICE_ACCOUNT" \
  --substitutions="_IMAGE=$image_tag,_REVISION=$revision" --async --format='value(id)')"
gcloud builds log "$build_id" --project="$PROJECT_ID" --region="$GCP_REGION" --stream
build_status="$(gcloud builds describe "$build_id" --project="$PROJECT_ID" --region="$GCP_REGION" --format='value(status)')"
[[ "$build_status" == SUCCESS ]] || { echo "Build $build_id failed: $build_status" >&2; exit 1; }
# The digest this build pushed, from the build itself. `artifacts docker images describe` also lists Container
# Analysis occurrences once the deployer can see that API is enabled, which the configuration role allows but
# the deployer has no permission for.
image_digest="$(gcloud builds describe "$build_id" --project="$PROJECT_ID" --region="$GCP_REGION" --format='value(results.images[0].digest)')"
[[ "$image_digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'Build did not produce a valid image digest.' >&2; exit 1; }
image="$image_name@$image_digest"
previous_revision="$(gcloud run services describe "$CLOUD_RUN_SERVICE" --project="$PROJECT_ID" --region="$GCP_REGION" --format='value(status.latestReadyRevisionName)' 2>/dev/null || true)"

env_file="$build_dir/runtime-env.json"
node --input-type=module - "$env_file" <<'NODE'
import {writeFileSync} from 'node:fs';
const values={NODE_ENV:'production',GOOGLE_CLOUD_PROJECT:'andershaf-87'};
for(const key of ['GCP_REGION','FIRESTORE_DATABASE_ID','PUBSUB_TOPIC','ROOM_COLLECTION_PREFIX','ALLOWED_ORIGINS'])values[key]=process.env[key];
// Games beside Fuse Riders; absent serves Fuse Riders alone (docs/online/GCP-DEPLOY.md).
if(process.env.EXTRA_GAME_IDS)values.EXTRA_GAME_IDS=process.env.EXTRA_GAME_IDS;
writeFileSync(process.argv[2],JSON.stringify(values,null,2));
NODE

# Same rule as the gate above: the revision must still be on main, not still be its head.
[[ "$(gh api "repos/$repository/compare/$revision...main" --jq .status)" =~ ^(identical|ahead)$ ]] || { echo "Revision $revision left main during the build; refusing to deploy it." >&2; exit 1; }
gcloud run deploy "$CLOUD_RUN_SERVICE" --project="$PROJECT_ID" --region="$GCP_REGION" \
  --image="$image" --service-account="$RUNTIME_SERVICE_ACCOUNT" --port=8080 \
  --min=0 --max=2 --min-instances=0 --max-instances=2 \
  --cpu=1 --memory=512Mi --concurrency=80 --timeout=3600 \
  --cpu-throttling --no-session-affinity --allow-unauthenticated \
  --env-vars-file="$env_file" --labels="application=fuse-riders,commit=$revision"

mkdir -p artifacts
manifest="artifacts/cloud-release-$revision.json"
gcloud run services describe "$CLOUD_RUN_SERVICE" --project="$PROJECT_ID" --region="$GCP_REGION" --format=json > "$build_dir/service.json"
node --input-type=module - "$build_dir/service.json" "$manifest" "$revision" "$image" "$build_id" "$previous_revision" <<'NODE'
import {readFileSync,writeFileSync} from 'node:fs';
const [servicePath,manifestPath,revision,image,buildId,previousRevision]=process.argv.slice(2);
const service=JSON.parse(readFileSync(servicePath,'utf8'));
const sourceVerification={mode:process.env.source_verification,observedCiResult:process.env.ci_result,...(process.env.source_verification==='local'?{note:process.env.LOCAL_VERIFICATION_NOTE}:{})};
const configuration=JSON.parse(readFileSync(`artifacts/config-release-${revision}.json`,'utf8'));
if(configuration.verified!==true||configuration.revision!==revision)throw new Error('Missing configuration verification for this revision');
const evidence={configuration:{digest:configuration.configDigest,verifiedAt:configuration.verifiedAt},sourceVerification,recordedAt:new Date().toISOString(),project:'andershaf-87',region:process.env.GCP_REGION,gitRevision:revision,image,buildId,service:service.metadata?.name,readyRevision:service.status?.latestReadyRevisionName,url:service.status?.url,previousRevision,smoke:'NOT YET VERIFIED'};
writeFileSync(manifestPath,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
NODE
printf 'Recorded %s. Deployment is not public-release acceptance; run the documented smoke/recovery gates.\n' "$manifest"

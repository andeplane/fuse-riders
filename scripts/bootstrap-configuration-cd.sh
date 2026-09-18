#!/usr/bin/env bash
# One-time IAM bootstrap. Any authorized project IAM administrator can run it; CD never changes its own permissions.
set -euo pipefail
: "${BOOTSTRAP_ACCOUNT:?Set the explicitly authorized gcloud account; the machine default may be another project}"
readonly project=andershaf-87
readonly role=fuseRidersConfigurationDeployer
readonly member=serviceAccount:fuse-riders-deployer@andershaf-87.iam.gserviceaccount.com
cd "$(git rev-parse --show-toplevel)"
# CD calls bill the deployer's own project, so the API Keys API must be enabled here. A personal gcloud token bills
# gcloud's project instead, which is why a local `config:plan --account` passes without it.
gcloud services enable apikeys.googleapis.com --project="$project" --account="$BOOTSTRAP_ACCOUNT"
if gcloud iam roles describe "$role" --project="$project" --account="$BOOTSTRAP_ACCOUNT" --format='value(name)' >/dev/null 2>&1; then
  gcloud iam roles update "$role" --project="$project" --account="$BOOTSTRAP_ACCOUNT" --file=deploy/configuration-role.yaml
else
  gcloud iam roles create "$role" --project="$project" --account="$BOOTSTRAP_ACCOUNT" --file=deploy/configuration-role.yaml
fi
gcloud projects add-iam-policy-binding "$project" --account="$BOOTSTRAP_ACCOUNT" \
  --member="$member" --role="projects/$project/roles/$role" --condition=None --format=none
printf 'Configuration CD permissions installed for the existing keyless deployer. No runtime roles or credential keys were added.\n'

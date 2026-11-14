#!/usr/bin/env bash
# Explicit, post-CD-gate telemetry bootstrap. stdout contains references only, never credentials.
# Existing enabled versions are reused; rotation is a separate operator action.
set +x
set -euo pipefail

fail() { printf '%s\n' "$1" >&2; exit 1; }
[[ "${TELEMETRY_ENABLED:-0}" == 1 ]] || fail 'Insights secret bootstrap requires TELEMETRY_ENABLED=1.'
project="${INSIGHTS_SECRET_PROJECT_ID:-andershaf-87}"
[[ "$project" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || fail 'Invalid insights secret project.'
[[ "${RUNTIME_SERVICE_ACCOUNT:-}" =~ ^[a-z][a-z0-9-]+@${project}\.iam\.gserviceaccount\.com$ ]] || fail 'Runtime service account must belong to the insights secret project.'
for reference in "${OPENAI_API_KEY_SECRET:-}" "${TELEMETRY_RATE_LIMIT_KEY_SECRET:-}"; do
  [[ -z "$reference" || "$reference" =~ ^[A-Za-z0-9_-]+:[1-9][0-9]*$ ]] || fail 'Insights secrets require name:numeric-version references.'
done
for executable in gcloud node openssl; do
  command -v "$executable" >/dev/null || fail "Missing $executable."
done

resolve() {
  local supplied="$1" name="$2" kind="$3" found versions version state created random_key
  if [[ -n "$supplied" ]]; then
    [[ "$supplied" =~ ^[A-Za-z0-9_-]+:[1-9][0-9]*$ ]] || fail 'Insights secrets require name:numeric-version references.'
    name="${supplied%:*}"
    version="${supplied##*:}"
    state="$(gcloud secrets versions describe "$version" --secret="$name" --project="$project" --format='value(state)' 2>/dev/null)" || fail 'Cannot verify pinned insights secret version.'
    [[ "$state" == ENABLED ]] || fail 'Pinned insights secret version is not enabled.'
    printf '%s' "$supplied"
    return
  fi

  # Listing fails closed on permission/API failures. A failed describe is not proof of absence.
  found="$(gcloud secrets list --project="$project" --filter="name~'/secrets/$name$'" --format='value(name)' 2>/dev/null)" || fail 'Cannot discover managed insights secrets.'
  if [[ -z "$found" ]]; then
    [[ "$kind" != openai || -n "${OPENAI_API_KEY:-}" ]] || fail 'Missing repository OPENAI_API_KEY for initial insights bootstrap.'
    gcloud secrets create "$name" --project="$project" --replication-policy=automatic --quiet >/dev/null 2>&1 || fail 'Cannot create managed insights secret.'
  fi
  versions="$(gcloud secrets versions list "$name" --project="$project" --format=json 2>/dev/null)" || fail 'Cannot list managed insights secret versions.'
  version="$(printf '%s' "$versions" | node --input-type=module -e '
    let input=""; for await (const chunk of process.stdin) input+=chunk;
    const versions=JSON.parse(input);
    if(!Array.isArray(versions)) process.exit(1);
    const enabled=versions.filter(v=>v.state==="ENABLED").map(v=>v.name?.split("/").at(-1));
    if(enabled.some(v=>!(/^[1-9][0-9]*$/).test(v??""))) process.exit(1);
    if(versions.length && !enabled.length) process.exit(1);
    enabled.sort((a,b)=>BigInt(a)>BigInt(b)?-1:BigInt(a)<BigInt(b)?1:0);
    process.stdout.write(enabled[0]??"");
  ' 2>/dev/null)" || fail 'Managed insights secret has invalid versions or no enabled version; explicit rotation required.'
  if [[ -z "$version" ]]; then
    if [[ "$kind" == openai ]]; then
      [[ -n "${OPENAI_API_KEY:-}" ]] || fail 'Missing repository OPENAI_API_KEY for initial insights bootstrap.'
      created="$(printf '%s' "$OPENAI_API_KEY" | gcloud secrets versions add "$name" --project="$project" --data-file=- --format='value(name)' 2>/dev/null)" || fail 'Cannot initialize OpenAI secret version.'
    else
      random_key="$(openssl rand -hex 32 2>/dev/null)" || fail 'Cannot generate insights HMAC key.'
      [[ "$random_key" =~ ^[a-f0-9]{64}$ ]] || fail 'Invalid generated insights HMAC key.'
      created="$(printf '%s' "$random_key" | gcloud secrets versions add "$name" --project="$project" --data-file=- --format='value(name)' 2>/dev/null)" || fail 'Cannot initialize insights HMAC secret version.'
    fi
    version="${created##*/}"
    [[ "$version" =~ ^[1-9][0-9]*$ ]] || fail 'Secret Manager returned an invalid version reference.'
  fi
  # Restricted to the two code-owned default names. Custom pins require preconfigured accessor IAM.
  gcloud secrets add-iam-policy-binding "$name" --project="$project" --member="serviceAccount:$RUNTIME_SERVICE_ACCOUNT" --role=roles/secretmanager.secretAccessor --condition=None --quiet >/dev/null 2>&1 || fail 'Cannot grant runtime access to managed insights secret.'
  printf '%s:%s' "$name" "$version"
}

openai_ref="$(resolve "${OPENAI_API_KEY_SECRET:-}" fuse-openai-api-key openai)"
hmac_ref="$(resolve "${TELEMETRY_RATE_LIMIT_KEY_SECRET:-}" fuse-telemetry-rate-limit-key hmac)"
printf '{"OPENAI_API_KEY_SECRET":"%s","TELEMETRY_RATE_LIMIT_KEY_SECRET":"%s"}\n' "$openai_ref" "$hmac_ref"

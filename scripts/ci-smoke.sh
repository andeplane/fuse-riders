#!/usr/bin/env bash
# Runs one CI browser smoke and retries it once, reporting every retry loudly instead of hiding it.
#
# A smoke that fails twice fails the job, so a real regression still blocks deployment. A smoke that fails once and
# then passes is a flaky test: the job stays green, but the first failure's output, a warning annotation, a job
# summary entry and (on main) a comment on the open `flaky-test` issue record it so it gets fixed rather than
# silently retried forever.
#
# Usage: scripts/ci-smoke.sh "<label>" <command> [args...]
set -uo pipefail
label="$1"; shift
mkdir -p artifacts/flaky
log="artifacts/flaky/$(printf '%s' "$label" | tr -c 'A-Za-z0-9' '-').log"

"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -eq 0 ]; then rm -f "$log"; exit 0; fi

echo "::notice title=Retrying smoke::$label failed (exit $status); retrying once"
"$@"
retry=$?
if [ "$retry" -ne 0 ]; then
  echo "::error title=Smoke failed twice::$label failed on both attempts"
  exit "$retry"
fi

# Passed on retry: the first attempt's failure is the evidence. Its last lines say which assertion flaked.
failure=$(grep -m1 -E 'AssertionError|Error:|Timeout' "$log" | cut -c1-200)
echo "::warning title=Flaky smoke::$label failed once, then passed on retry: ${failure:-see artifacts/flaky}"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### ⚠️ Flaky smoke: $label"
    echo "Failed once, passed on retry. First failure:"
    echo '```'
    tail -n 25 "$log"
    echo '```'
  } >> "$GITHUB_STEP_SUMMARY"
fi
# Keep a history across runs on main, where flakes block deployment. Best effort: reporting never fails the job.
if [ "${GITHUB_EVENT_NAME:-}" = "push" ] && [ -n "${GH_TOKEN:-}" ]; then
  run_url="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
  body=$(printf '**%s** failed once, then passed on retry at `%s` ([run](%s)).\n\n```\n%s\n```\n' \
    "$label" "${GITHUB_SHA:0:7}" "$run_url" "$(tail -n 25 "$log")")
  issue=$(gh issue list --label flaky-test --state open --limit 1 --json number -q '.[0].number' 2>/dev/null)
  if [ -z "$issue" ]; then
    gh label create flaky-test --color d93f0b --description 'A CI smoke that passed only on retry' 2>/dev/null || true
    gh issue create --title 'Flaky CI browser smokes' --label flaky-test \
      --body "scripts/ci-smoke.sh comments here whenever a browser smoke on main passes only on retry. Fix the race, then close this issue." 2>/dev/null >/dev/null || true
    issue=$(gh issue list --label flaky-test --state open --limit 1 --json number -q '.[0].number' 2>/dev/null)
  fi
  [ -n "$issue" ] && gh issue comment "$issue" --body "$body" >/dev/null 2>&1 || true
fi
exit 0

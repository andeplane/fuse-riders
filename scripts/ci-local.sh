#!/usr/bin/env bash
# Local mirror of .github/workflows/ci.yml: same steps, same order, same env, because both read
# scripts/ci-manifest.json through scripts/ci-run.ts. To add or change a step, edit the manifest, not this file.
# PORT=8801 scripts/ci-local.sh            the room service starts its port search there (default: a free port)
# ONLY=core,keyboard scripts/ci-local.sh   core = every verify step; `npx tsx scripts/ci-run.ts --list` names the rest
set -euo pipefail
cd "$(dirname "$0")/.."
exec npx tsx scripts/ci-run.ts "$@"

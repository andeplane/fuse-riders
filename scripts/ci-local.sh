#!/usr/bin/env bash
# Local mirror of .github/workflows/ci.yml: same steps, same order, same env.
# PORT=8801 scripts/ci-local.sh            (default port 8787)
# ONLY=core,keyboard scripts/ci-local.sh   core = typecheck,worker,coverage,build
# Steps: typecheck worker coverage build lan avatar keyboard online phaser home landscape shared deltas
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8787}"
URL="http://localhost:$PORT/"
ONLY="${ONLY:-}"; ONLY="${ONLY//core/typecheck,worker,coverage,build}"
WRANGLER_PID=""
START=$SECONDS

needs() { [[ -z "$ONLY" || ",$ONLY," == *",$1,"* ]]; }

step() {  # step <name>[:variant] cmd...
  local label=$1 name=${1%%:*}; shift
  needs "$name" || return 0
  local begin=$SECONDS
  echo "=== $label: $*"
  if "$@"; then
    echo "PASS $label ($((SECONDS-begin))s)"
  else
    echo "FAIL $label ($((SECONDS-begin))s)"; exit 1
  fi
}

start_wrangler() {
  mkdir -p artifacts
  # set -m gives wrangler its own process group so the trap also kills workerd.
  set -m; npx wrangler dev --port "$PORT" > artifacts/worker.log 2>&1 & WRANGLER_PID=$!; set +m
  for _ in $(seq 1 30); do curl -fsS "$URL" > /dev/null 2>&1 && return 0; sleep 1; done
  cat artifacts/worker.log; echo "FAIL wrangler did not answer on $URL"; exit 1
}

stop_wrangler() {
  local code=$?
  if [[ -n "$WRANGLER_PID" ]]; then kill -- -"$WRANGLER_PID" 2>/dev/null || true; wait "$WRANGLER_PID" 2>/dev/null || true; fi
  echo "=== total $((SECONDS-START))s, exit $code"
}
trap stop_wrangler EXIT

step typecheck npm run typecheck
step worker npm run typecheck:worker
step coverage npm run test:coverage
step build npm run build
step lan:chrome npm run test:browser
step lan:webkit env BROWSER=webkit npm run test:browser
step avatar npx tsx scripts/avatar-layout.ts

for s in keyboard online home landscape shared; do needs "$s" && { start_wrangler; break; }; done

step keyboard env HOME_URL="$URL" npx tsx scripts/keyboard-smoke.ts
step online:chrome env ROOM_RENDERER=canvas ONLINE_URL="$URL" npx tsx scripts/online-smoke.ts
step online:webkit env BROWSER=webkit ROOM_RENDERER=canvas ONLINE_URL="$URL" npx tsx scripts/online-smoke.ts
step phaser:chrome npx tsx scripts/phaser-browser.ts
step phaser:webkit env BROWSER=webkit npx tsx scripts/phaser-browser.ts
step home env HOME_URL="$URL" npx tsx scripts/home-mobile-smoke.ts
step landscape env HOME_URL="$URL" npx tsx scripts/mobile-landscape-smoke.ts
step shared env ONLINE_URL="$URL" npx tsx scripts/shared-room-smoke.ts
step deltas npx tsx scripts/benchmark-deltas.ts

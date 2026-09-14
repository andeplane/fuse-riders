#!/usr/bin/env bash
# Local mirror of .github/workflows/ci.yml: same steps, same order, same env.
# PORT=8801 scripts/ci-local.sh            (default port 8787)
# ONLY=core,keyboard scripts/ci-local.sh   core = typecheck,worker,coverage,build
# Steps: typecheck worker coverage build lan avatar keyboard online phaser home landscape recap shared deltas
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8787}"
URL="http://localhost:$PORT/"
STEPS="typecheck,worker,coverage,build,lan,avatar,keyboard,online,phaser,home,landscape,recap,shared,deltas"
ONLY="${ONLY:-}"; ONLY="${ONLY//core/typecheck,worker,coverage,build}"
for t in ${ONLY//,/ }; do [[ ",$STEPS," == *",$t,"* ]] || { echo "Unknown ONLY step '$t' (steps: $STEPS, core)"; exit 1; }; done
WRANGLER_PID=""
START=$SECONDS
RAN=0

needs() { [[ -z "$ONLY" || ",$ONLY," == *",$1,"* ]]; }

step() {  # step <name>[:variant] cmd...
  local label=$1 name=${1%%:*}; shift
  needs "$name" || return 0
  local begin=$SECONDS rc=0
  echo "=== $label: $*"; RAN=$((RAN+1))
  "$@" || rc=$?
  if [[ $rc -eq 0 ]]; then
    echo "PASS $label ($((SECONDS-begin))s)"
  else
    echo "FAIL $label ($((SECONDS-begin))s)"; exit "$rc"
  fi
}

start_wrangler() {
  mkdir -p artifacts
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN > /dev/null 2>&1; then echo "FAIL port $PORT already in use; pick another with PORT=<port>"; exit 1; fi
  # set -m gives wrangler its own process group so the trap also kills workerd.
  set -m; npx wrangler dev --port "$PORT" > artifacts/worker.log 2>&1 & WRANGLER_PID=$!; set +m
  for _ in $(seq 1 30); do
    kill -0 "$WRANGLER_PID" 2>/dev/null || { cat artifacts/worker.log; echo "FAIL wrangler exited early"; exit 1; }
    curl -fsS "$URL" > /dev/null 2>&1 && return 0; sleep 1
  done
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

for s in keyboard online home landscape recap shared; do needs "$s" && { start_wrangler; break; }; done

step keyboard env HOME_URL="$URL" npx tsx scripts/keyboard-smoke.ts
step online:chrome env ROOM_RENDERER=canvas ONLINE_URL="$URL" npx tsx scripts/online-smoke.ts
step online:webkit env BROWSER=webkit ROOM_RENDERER=canvas ONLINE_URL="$URL" npx tsx scripts/online-smoke.ts
step phaser:chrome npx tsx scripts/phaser-browser.ts
step phaser:webkit env BROWSER=webkit npx tsx scripts/phaser-browser.ts
step home env HOME_URL="$URL" npx tsx scripts/home-mobile-smoke.ts
step landscape env HOME_URL="$URL" npx tsx scripts/mobile-landscape-smoke.ts
step recap:chrome env HOME_URL="$URL" npx tsx scripts/match-recap-smoke.ts
step recap:webkit env BROWSER=webkit HOME_URL="$URL" npx tsx scripts/match-recap-smoke.ts
step shared env ONLINE_URL="$URL" npx tsx scripts/shared-room-smoke.ts
step deltas npx tsx scripts/benchmark-deltas.ts
[[ $RAN -gt 0 ]] || { echo "FAIL no steps ran"; exit 1; }

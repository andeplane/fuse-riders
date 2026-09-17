#!/usr/bin/env bash
# Local mirror of .github/workflows/ci.yml: same steps, same order, same env.
# PORT=8801 scripts/ci-local.sh            (default port 8787)
# ONLY=core,keyboard scripts/ci-local.sh   core = format,typecheck,coverage,build
# Steps: format typecheck coverage build keyboard online preview phaser home landscape recap shared determinism mesh
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8787}"
URL="http://localhost:$PORT/"
STEPS="format,typecheck,coverage,build,keyboard,online,preview,phaser,home,landscape,recap,shared,determinism,mesh"
ONLY="${ONLY:-}"; ONLY="${ONLY//core/format,typecheck,coverage,build}"
for t in ${ONLY//,/ }; do [[ ",$STEPS," == *",$t,"* ]] || { echo "Unknown ONLY step '$t' (steps: $STEPS, core)"; exit 1; }; done
ROOM_SERVICE_PID=""
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

# The production room protocol (packages/fuse-network-be) over in-memory metadata, serving dist/.
start_room_service() {
  mkdir -p artifacts
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN > /dev/null 2>&1; then echo "FAIL port $PORT already in use; pick another with PORT=<port>"; exit 1; fi
  # set -m gives the service its own process group so the trap also stops the tsx child.
  set -m; npx tsx src/service/dev.ts --port "$PORT" > artifacts/room-service.log 2>&1 & ROOM_SERVICE_PID=$!; set +m
  for _ in $(seq 1 30); do
    kill -0 "$ROOM_SERVICE_PID" 2>/dev/null || { cat artifacts/room-service.log; echo "FAIL room service exited early"; exit 1; }
    curl -fsS "$URL" > /dev/null 2>&1 && return 0; sleep 1
  done
  cat artifacts/room-service.log; echo "FAIL room service did not answer on $URL"; exit 1
}

stop_room_service() {
  local code=$?
  if [[ -n "$ROOM_SERVICE_PID" ]]; then kill -- -"$ROOM_SERVICE_PID" 2>/dev/null || true; wait "$ROOM_SERVICE_PID" 2>/dev/null || true; fi
  echo "=== total $((SECONDS-START))s, exit $code"
}
trap stop_room_service EXIT

step format npm run format:check
step typecheck npm run typecheck
step coverage npm run test:coverage
step build npm run build
for s in keyboard online home landscape recap shared mesh; do needs "$s" && { start_room_service; break; }; done

step keyboard env HOME_URL="$URL" npx tsx scripts/keyboard-smoke.ts
step online:chrome env ROOM_RENDERER=phaser-canvas ONLINE_URL="$URL" npx tsx scripts/online-smoke.ts
step online:webkit env BROWSER=webkit ROOM_RENDERER=phaser-canvas ONLINE_URL="$URL" npx tsx scripts/online-smoke.ts
step preview:chrome npx tsx scripts/bomb-preview-smoke.ts
step preview:webkit env BROWSER=webkit npx tsx scripts/bomb-preview-smoke.ts
step phaser:chrome npx tsx scripts/phaser-browser.ts
step phaser:webkit env BROWSER=webkit npx tsx scripts/phaser-browser.ts
step home env HOME_URL="$URL" npx tsx scripts/home-mobile-smoke.ts
step landscape env HOME_URL="$URL" npx tsx scripts/mobile-landscape-smoke.ts
step recap:chrome env HOME_URL="$URL" npx tsx scripts/match-recap-smoke.ts
step recap:webkit env BROWSER=webkit HOME_URL="$URL" npx tsx scripts/match-recap-smoke.ts
step shared env ONLINE_URL="$URL" npx tsx scripts/shared-room-smoke.ts
step determinism npx tsx scripts/determinism-replay.ts
step mesh env ONLINE_URL="$URL" npx tsx scripts/p2p-mesh-browser.ts
[[ $RAN -gt 0 ]] || { echo "FAIL no steps ran"; exit 1; }

# Fuse Birds

Phase 1 is a 2–5-player turn-based slingshot game: unlimited Pebble, three starting Scatter Bombs, shootable refill crates, destructible seeded terrain and rising-water sudden death. The complete rules live in the UI-free `fuse-birds-game` workspace package. Browser rendering and online rooms are adapters around that same library.

The slingshot-only correction is playable in [PR #407](https://github.com/andeplane/fuse-riders/pull/407). See [ADR-052](../../docs/adr/052-fuse-birds-phase-one.md) for the completion contract and the [current evidence note](../../docs/reviews/fuse-birds-stationary-correction.md) for verification and unresolved post-destruction reachability samples. No merge or deployment is implied.

## Play locally

From the repository root, run `pnpm dev`. Open the URL printed by the server with `/fuse-birds/?mute` appended. The server chooses a free port when necessary. Create a room and join its code on a second device/tab. Start with 2–5 players. Select shared TV when creating a room to get a full-map display link; each phone retains its own map view.

Drag back from your bird and release to shoot. Drag elsewhere to pan; pinch or use the zoom controls to inspect the map. Adding a second finger cancels an uncommitted shot. Birds cannot walk or hop. Aim from their current position, shoot, or pass; explosions and falling can displace them. Scatter splits at its apex and costs one bomb; shooting a crate refills one, capped at five. The weapon count belongs to the game state, so recovery and rematch cannot leave a stale local count.

Keyboard: focus the battlefield, then use **I/K** to aim up/down and **J/L** to aim left/right. Hold **Shift** for larger adjustments, **Enter** to fire, or **Escape** to cancel. **+/−** zoom. Off-screen bird and ammo labels show their direction while zoomed; the TV always retains the full map.

## Public headless API

```ts
import {
  createMatch,
  advance,
  getView,
  encodeState,
  decodeState,
  hashState,
} from "fuse-birds-game";

const match = createMatch("example", 123, [
  { id: "a", name: "Skye" },
  { id: "b", name: "Ember" },
]);
while (match.phase === "preparing") advance(match);
const player = match.players[match.active]!;
advance(match, [
  {
    actor: player.id,
    round: match.round,
    turn: match.turn,
    ordinal: player.ordinal + 1,
    type: "launch",
    weapon: "pebble",
    vx: 2400,
    vy: -1600,
  },
]);
const checkpoint = decodeState(encodeState(match));
if (!checkpoint || hashState(checkpoint) !== hashState(match))
  throw new Error("Invalid checkpoint");
console.log(getView(match));
```

Each `advance` call is one 50 ms logical tick with three physics steps. The caller owns scheduling; there are no intervals, DOM shims or networking dependencies. Inputs carry round/turn/ordinal scope. Checkpoints contain modified terrain, projectile state and resumable searches, not just the initial seed. Rules versions must match.

## Headless CLI and replay

Run from the repository root. Output is one JSON object containing the summary, final hash and final state. Terrain is Base64 in CLI files; the library uses a packed `Uint8Array`. Output files use exclusive creation to protect existing logs/checkpoints.

```sh
# Complete a match using ordinary aimed actions and record every accepted input attempt.
pnpm exec tsx scripts/fuse-birds-headless.ts --seed 123 --players 3 --mode aimed --record /tmp/birds-actions.json --save /tmp/birds-final.json > /tmp/birds-result.json

# Replay 60 ticks, save, then resume using the same absolute-tick action log.
pnpm exec tsx scripts/fuse-birds-headless.ts --seed 123 --players 3 --log /tmp/birds-actions.json --ticks 60 --save /tmp/birds-partial.json > /tmp/birds-partial-result.json
pnpm exec tsx scripts/fuse-birds-headless.ts --load /tmp/birds-partial.json --log /tmp/birds-actions.json --save /tmp/birds-resumed.json > /tmp/birds-resumed-result.json
```

`--mode pass` is the default fast termination driver; `--mode idle` exercises deadlines; `--mode aimed` exercises both weapons and duplicate releases. A supplied `--log` disables the driver; missing ticks mean no input. `--ticks` limits additional ticks and may intentionally stop mid-match. `--trace PATH` writes per-tick hashes, actions and facts as NDJSON. These drivers are verification infrastructure, not an in-game bot mode.

Action logs have `{ "rules": "<current RULES>", "entries": [{ "tick": 10, "actions": [...] }] }`. Ticks are absolute, strictly increasing positive integers. Entries contain at most 32 runtime-validated actions; limits are 100,000 entries/ticks and 16 MB input files. A checkpoint includes an independent hash and must pass the full library validator. Corrupt, incompatible or unordered input fails explicitly.

## Focused verification

```sh
pnpm exec tsx --test games/fuse-birds/tests/*.test.ts
pnpm typecheck
pnpm exec tsx scripts/fuse-birds-online-smoke.ts
pnpm exec tsx scripts/fuse-birds-phone-smoke.ts
pnpm exec tsx scripts/fuse-birds-inventory-smoke.ts
pnpm exec tsx scripts/fuse-birds-recovery-smoke.ts
pnpm exec tsx scripts/fuse-birds-continuing-check.ts
# With Vite running at the supplied URL, compare every tick of complete matches:
pnpm exec tsx scripts/fuse-birds-replay-check.ts http://localhost:5181
```

The online smoke uses the built local room service; its default URL is port 8893. Browser emulation does not establish physical-phone/TV performance. The development render and replay HTML harnesses are verification tools, not alternate shipping game implementations.

`pnpm test:coverage` combines the complete Node suite with actual Chromium execution of the render harness and the two-player/TV room flow, including keyboard launch, cancellation, reload, result and rematch. Install Chromium first (`pnpm exec playwright install chromium`; CI also installs its system dependencies). The command starts and closes its own Vite and in-memory room servers on free ports and retains the existing coverage thresholds and exclusions. A failed Node test, browser flow or final coverage report makes the command fail.

Browser entries use Vite's captured inline source maps, verify the embedded TypeScript against the current files and retain unique generated-source identities before remapping into the same c8 report. This avoids merging incompatible Vite/tsx offsets. Unexecuted browser branches remain uncovered. Chromium coverage does not replace cross-browser gameplay checks or physical-device testing. For an individual diagnostic run against an existing Vite server, set `FUSE_BIRDS_COVERAGE_DIR=coverage/tmp` when invoking `scripts/fuse-birds-render-smoke.ts`, then run `pnpm exec c8 report --temp-directory coverage/tmp --exclude-after-remap`; use the clean full command for final evidence.

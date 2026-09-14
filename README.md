# Fuse Riders

## [Play it now →](https://andeplane.github.io/fuse-riders/)

**Online beta.** Create a room, share its invite, and add friends or AI riders. Keep the host tab in the foreground. Gameplay requires a direct WebRTC connection; unsupported networks show a retry state. Physical-phone qualification is still pending.

A TypeScript party game for 2–5 players: steer neon riders, dodge their trails, and launch bombs and other projectiles. Play together around a TV with phones as controllers, or create an online room with an arena on each device. Add AI riders when fewer friends are available. The default match is first to three round wins.

![Fuse Riders Phaser gameplay showcase](docs/gameplay-phaser.png)

*Rendered in the real game client using a reproducible gameplay showcase.*

**The public frontend and backend are connected and playable; poor-network/mobile qualification remains in progress.** Initial public Chromium testing created a room, joined a guest, added AI and reached scoring with no page errors. Initial WebKit reached scoring but logged one RTC send error, so clean WebKit acceptance is still pending. See the [dated public deployment evidence](docs/online/PUBLIC-BETA-2026-09-14.md). The implementation now includes host leases, validated checkpoints, fixed-tick prediction, direct WebRTC recovery and Phaser rendering. Passing unit tests does not certify uninterrupted Internet play. See the [online roadmap](docs/online/ROADMAP.md), [ADRs](docs/adr/), and [review reports](docs/reviews/). The LAN path remains available.

## Run a LAN game

Requires Node.js **22.12 or newer** and npm. From a fresh checkout:

```sh
npm ci
npm run build
PORT=3030 npm start
```

Connect the laptop to the TV and put phones on the same Wi-Fi. Open the **host display URL printed by the server**, then scan its QR code from each phone. The host URL contains a capability needed to start/reset matches; an ordinary `/display` URL does not grant those controls. Phones use `/controller`. Use the printed LAN IP on phones, not `localhost`. Set `HOST_IP` if automatic interface discovery selects the wrong network.

`PORT=3030 npm run dev` runs the development server with Vite browser updates. Production uses the built `dist/` assets and does not automatically refresh. Rebuild and restart between matches, open the new printed host link, and refresh/rejoin phones. Restarting the Node process clears its in-memory game and session scores. The default port is 3000 when `PORT` is omitted.

The room-creation home page requires a room service API. Use `/display` and `/controller` for LAN play; use the following command for online rooms.

## Try online rooms locally

```sh
npm run dev:online
```

Open **http://localhost:8787/**. Create a room, choose shared-screen or individual-device play, and share the invite link or QR code. The creator can join as a player on the same phone and use **START RACE**, **MAIN MENU**, and **ROOM SETTINGS**. **INVITE / TV** opens a separate display role for a shared screen. Use HTTPS for remote-device testing; local HTTP testing does not prove Internet connectivity.

Room settings select first-to-N wins or a fixed number of rounds and adjust each powerup's relative weight. A weight of zero disables that drop; all zero means no random drops. Defaults and preferences are stored in the creator's browser under `fuse-riders-room-settings-v1`. Match format changes apply to the next match, and pickup-weight changes apply to the next round. Clearing browser storage loses saved preferences and room credentials.

The creator's browser owns the simulation. Keep its tab in the foreground: a phone lock or background tab can pause everyone. Host authority is fenced by renewable leases and connection epochs; validated local checkpoints support creator refresh recovery. Corrupt or incompatible checkpoints are rejected before replacing healthy state. These mechanisms have regression tests, while sustained recovery and physical-device behavior still need qualification. There is no automatic host migration, ranked anti-cheat authority, or guarantee of uninterrupted play through arbitrary network failure.

## How to play

Hold or slide a finger into left/right to steer. Hold **Fire** to charge a forward launch, then release. Target Bomb changes Fire into a thumb trackpad with a public aiming marker. Tap **HEAD** to change avatar, including during a round. Phone colors match riders. Joiners can enter during play when a seat is available and wait for the next round.

Drops include blast upgrades, Beer, Ink, Triple/Five Shot, Target Bomb, Orbit Shield, portals, shells, gun projectiles, and shorter fuses. Star is excluded from default drops. Balance changes frequently: use [pickup weights](src/shared/pickup-weights.ts), [game rules](src/shared/game.ts), and [room settings](src/shared/room-settings.ts) as the source of truth rather than copying constants into documentation.

Use **ADD AI** in the host controls to fill empty seats. AI uses normal steering and weapons under the same rules as people; see [AI riders](docs/online/AI-RIDERS.md).

The LAN TV provides audio controls, fullscreen, a main-menu reset, session scores, and end-of-match statistics. Music and effects need a browser user gesture. The online UI reuses the renderer, controller bindings, avatars and audio, but its full mobile parity is still part of release acceptance.

## Architecture

| Path | Simulation authority | Communication | Lifetime |
| --- | --- | --- | --- |
| LAN | Local Node process | WebSocket intents, snapshots and events | Process must run during play; restart resets state |
| Online | Creator's browser | Host-to-peer WebRTC star; backend WebSocket signalling only | Host must remain available; leases fence stale authority, local checkpoints support refresh |

```text
LAN:     phones ── WebSocket ── Node simulation ── WebSocket ── TV

Online:  player/display ── WebRTC ── host browser simulation
                └── Cloud Run gateway ────────────┘
                    Firestore: room metadata / leases
                    Pub/Sub: signalling / coordination
```

The shared deterministic simulation advances at 20 Hz. Online replication currently publishes at 10 Hz using field changes and trail deltas with periodic keyframes. Local presentation replays applied-tick movement using the same pure kernel as authority, including drunk steering. A bounded synchronized tick estimate supplies fractional render time; acknowledgements report actual application, not mere receipt. Remote snapshots use a tick-indexed buffer, currently 100 ms with no speculative extrapolation. This delay is a measured candidate, not a latency guarantee. Gameplay never uses the backend as a relay. Failed WebRTC connections show a retry state; direct-link recovery is tested separately.

| Location | Responsibility |
| --- | --- |
| `src/shared/` | Deterministic rules, pure rider-motion kernel, bounded AI controller, geometry, protocol types, scores, settings and drops |
| `src/server/` | LAN HTTP/WebSocket server, authority, seats, input buffering and injected scheduling |
| `src/client/` | Phaser presentation, Canvas fallback, themes, audio, avatars and phone pointer controls |
| `src/online/host-session.ts` | Browser authority, tick-scheduled input/results, held-control expiry and AI seats |
| `src/online/world-codec.ts` | Keyframes, field/trail deltas and reconstruction |
| `src/online/peer-transport.ts` | Direct WebRTC negotiation, generation fencing, signalling and link recovery |
| `src/online/runtime.ts`, `authority.ts`, `checkpoint.ts` | Fixed-step scheduling, authority lease checks and atomic validated restore |
| `src/online/prediction*.ts`, `tick-probes.ts`, `ui.ts` | Applied-tick replay, conservative tick clock, buffered presentation and room UI |
| `src/service/` | GCP room API/WebSocket gateway, Firestore transactions and Pub/Sub signalling |
| `worker/index.ts` | Local/legacy Cloudflare room API and coordination adapter; not the production target |
| `wrangler.jsonc` | Local/legacy Worker assets and room Durable Object binding |
| `Dockerfile.cloud`, `scripts/deploy-cloud.sh`, `.github/workflows/pages.yml` | GCP image/release and GitHub Pages frontend pipelines |
| `tests/`, `scripts/` | Deterministic tests, browser checks and benchmark runners |

Phaser is presentation only: the caller supplies snapshots to one render loop, pooled effects are bounded, and Phaser physics/timers never advance game authority. Themes and avatars respect the Pages base path. See [renderer architecture and benchmarks](docs/PHASER.md).

[AGENTS.md](AGENTS.md) defines engineering expectations. [Existing architecture notes](docs/architecture.md) describe the LAN implementation but contain historical balance details; source and later ADRs take precedence. Themes stay separate from gameplay and hitboxes; see [theme assets](docs/theme-assets.md) and the [chosen graphics reference](docs/gameplay-concepts/06-neon-pixel-hybrid.png).

## Tests and evidence

```sh
npm run typecheck
npm run typecheck:worker
npm test
npm run test:coverage
npm run build
npx playwright install chrome chromium webkit
npm run test:browser
BROWSER=webkit npm run test:browser
```

LAN browser smoke starts its own isolated server. It uses installed Chrome by default and WebKit with `BROWSER=webkit`. Online smoke uses bundled Chromium by default and needs Wrangler running in another terminal:

```sh
mkdir -p artifacts
npx tsx scripts/online-smoke.ts
BROWSER=webkit npx tsx scripts/online-smoke.ts
npx tsx scripts/benchmark-deltas.ts
npx tsx scripts/online-network-benchmark.ts
```

`ONLINE_URL=https://your-preview.example npx tsx scripts/online-smoke.ts` targets a preview and creates test rooms there. Never point tests at an occupied game. Benchmark scripts write reports under `docs/online/`; review regenerated evidence before committing it.

Coverage thresholds in [.c8rc.json](.c8rc.json) are 95% lines/statements/functions and 85% branches across its listed modules. Those thresholds do **not** mean every browser/Worker path is covered. [CI](.github/workflows/ci.yml) runs type checks, coverage, builds and browser checks; inspect the actual revision's result rather than treating this checklist as proof of passing CI.

The delta benchmark asserts exact reconstruction for every measured update. The [browser network harness](docs/online/NETWORK-HARNESS.md) uses five players plus a TV and seeded application-level delay, jitter, loss/reordering, bandwidth queues and a one-way blackhole. Opt-in `?benchmark=1` events expose accepted snapshots and predicted poses without capabilities. Application-message injection is not real IP packet loss, and desktop animation timing is not physical touch-to-photon latency. Reports must identify their tested revision and remaining unmeasured assertions; sustained active-rider, physical-device and WAN acceptance remain roadmap gates.

Tests should use typed injected clocks, schedulers, transports and seeded randomness. Keep simulation time independent of wall-clock time; exercise serialization and lifecycle boundaries with deterministic failures, not only happy paths. Review reports explain the missing invariants and required regressions.

## Hosting and deployment status

The online beta is deployed on **GitHub Pages, Cloud Run, Firestore room metadata and Pub/Sub signalling only**. See the [verified GCP inventory](docs/online/GCP-INVENTORY.md). The older local Cloudflare adapter remains available through `dev:online`. It requires no provisioned always-running game simulation server. Gameplay requires WebRTC; the service does not relay gameplay traffic. Failed direct connections show a retry state. The GCP target does not provision TURN. Some networks cannot establish a direct connection; the UI must report that failure instead of silently relaying the game.

A temporary experimental preview was reported at **https://fuse-riders.vagabond-walk.workers.dev**. This is not a declared production endpoint: current reachability, account ownership, claim status and expiry must be verified before relying on it. The supported beta uses the GitHub Pages and Cloud Run endpoints in the verified inventory; the old Cloudflare preview is not its backend. Local server processes and LAN addresses are ephemeral; read startup output rather than reusing a recorded PID or IP.

See [GCP deployment instructions](docs/online/GCP-DEPLOY.md) and [the direct-only decision](docs/adr/035-direct-gameplay-only.md). The public [Play link](https://andeplane.github.io/fuse-riders/) connects to `https://fuse-riders-gateway-oaaqztec5a-ew.a.run.app`. Backend revision `fuse-riders-gateway-00002-x2q` (source `81939f3`) passed the public provider smoke on 2026-09-14; see the dated evidence for exact frontend/backend versions and remaining limits.

For the older Cloudflare prototype, `npm run deploy` builds and invokes Wrangler. **That command does not run the release gates.** Complete the roadmap's review and verification requirements first, deploy a preview of the tested artifact, and verify it before promoting to production. See [deployment details and cost assumptions](docs/online/DEPLOYMENT.md). Verify current provider quotas/pricing before enabling paid services. Keep claim URLs, room/host capabilities, `.dev.vars`, Wrangler credentials and raw secret-bearing logs out of git, copied invites and public diagnostics.

Repository: [andeplane/fuse-riders](https://github.com/andeplane/fuse-riders). Contributions should use coherent atomic commits with relevant checks, documented evidence, and explicit limitations.

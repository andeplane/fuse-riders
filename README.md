# Fuse Riders

A TypeScript party game for 2–5 players: steer neon riders, dodge their trails, and launch bombs and other projectiles. Play together around a TV with phones as controllers, or try the online room prototype with an arena on each device. The default match is first to three round wins.

![Fuse Riders Phaser gameplay showcase](docs/gameplay-phaser.png)

*Rendered in the real game client using a reproducible gameplay showcase.*

**Online play is being hardened and is not yet a qualified Internet release.** Independent reviews identified blocking problems in prediction, stale-message handling, duplicate host tabs, transport recovery, and checkpoint validation. See the [online roadmap](docs/online/ROADMAP.md), [ADRs](docs/adr/), and [review reports](docs/reviews/). The existing LAN path remains available while these are addressed.

## Run a LAN game

Requires Node.js **22.12 or newer** and npm. From a fresh checkout:

```sh
npm ci
npm run build
PORT=3030 npm start
```

Connect the laptop to the TV and put phones on the same Wi-Fi. Open the **host display URL printed by the server**, then scan its QR code from each phone. The host URL contains a capability needed to start/reset matches; an ordinary `/display` URL does not grant those controls. Phones use `/controller`. Use the printed LAN IP on phones, not `localhost`. Set `HOST_IP` if automatic interface discovery selects the wrong network.

`PORT=3030 npm run dev` runs the development server with Vite browser updates. Production uses the built `dist/` assets and does not automatically refresh. Rebuild and restart between matches, open the new printed host link, and refresh/rejoin phones. Restarting the Node process clears its in-memory game and session scores. The default port is 3000 when `PORT` is omitted.

The new room-creation home page requires the Worker API. Use `/display` and `/controller` for LAN play; use the following command for online rooms.

## Try online rooms locally

```sh
npm run dev:online
```

Open **http://localhost:8787/**. Create a room, choose shared-screen or individual-device play, and share the invite link or QR code. The creator can join as a player on the same phone and use **START RACE**, **MAIN MENU**, and **ROOM SETTINGS**. **INVITE / TV** opens a separate display role for a shared screen. Use HTTPS for remote-device testing; local HTTP testing does not prove Internet connectivity.

Room settings select first-to-N wins or a fixed number of rounds and adjust each powerup's relative weight. A weight of zero disables that drop; all zero means no random drops. Defaults and preferences are stored in the creator's browser under `fuse-riders-room-settings-v1`. Match format changes apply to the next match, and pickup-weight changes apply to the next round. Clearing browser storage loses saved preferences and room credentials.

The creator's browser currently owns the simulation. Keep its tab in the foreground: a phone lock or background tab can pause everyone. Local checkpoints attempt refresh recovery, but safe restore, takeover, and bounded recovery are still review blockers. There is no automatic host migration, ranked anti-cheat authority, or guarantee of uninterrupted play through arbitrary network failure.

## How to play

Hold or slide a finger into left/right to steer. Hold **Fire** to charge a forward launch, then release. Target Bomb changes Fire into a thumb trackpad with a public aiming marker. Tap **HEAD** to change avatar, including during a round. Phone colors match riders. Joiners can enter during play when a seat is available and wait for the next round.

Drops include blast upgrades, Beer, Ink, Triple/Five Shot, Target Bomb, Orbit Shield, portals, shells, gun projectiles, and shorter fuses. Star is excluded from default drops. Balance changes frequently: use [pickup weights](src/shared/pickup-weights.ts), [game rules](src/shared/game.ts), and [room settings](src/shared/room-settings.ts) as the source of truth rather than copying constants into documentation.

The LAN TV provides audio controls, fullscreen, a main-menu reset, session scores, and end-of-match statistics. Music and effects need a browser user gesture. The online UI reuses the renderer, controller bindings, avatars and audio, but its full mobile parity is still part of release acceptance.

## Architecture

| Path | Simulation authority | Communication | Lifetime |
| --- | --- | --- | --- |
| LAN | Local Node process | WebSocket intents, snapshots and events | Process must run during play; restart resets state |
| Online prototype | Creator's browser | Host-to-peer WebRTC star; backend WebSocket signalling only | Host must remain available; recovery is under review |

```text
LAN:     phones ── WebSocket ── Node simulation ── WebSocket ── TV

Online:  player/display ── WebRTC ── host browser simulation
                └── Worker + room Durable Object ──┘
                    signalling / room coordination
```

The shared deterministic simulation advances at 20 Hz. Online replication currently publishes at 10 Hz using field changes and trail deltas with periodic keyframes. Clients have a prediction/interpolation prototype; it is not yet deterministic replay on a fully specified authoritative timebase. WebRTC is transport, not a substitute for that protocol work. Gameplay never uses the backend as a relay. Failed WebRTC connections show a retry state; direct-link recovery is tested separately.

| Location | Responsibility |
| --- | --- |
| `src/shared/` | Deterministic rules, geometry, protocol types, scores, settings and weighted drops |
| `src/server/` | LAN HTTP/WebSocket server, authority, seats, input buffering and injected scheduling |
| `src/client/` | Arena rendering, themes, audio, avatars and phone pointer controls |
| `src/online/host-session.ts` | Browser-hosted room commands and simulation wrapper |
| `src/online/world-codec.ts` | Keyframes, field/trail deltas and reconstruction |
| `src/online/peer-transport.ts` | WebRTC negotiation, signalling and relay selection |
| `src/online/runtime.ts`, `prediction.ts`, `ui.ts` | Scheduling, client presentation and room UI |
| `worker/index.ts` | Room creation, capabilities, signalling/relay and optional TURN credentials |
| `wrangler.jsonc` | Worker assets and `ROOMS` SQLite Durable Object binding/migration |
| `tests/`, `scripts/` | Deterministic tests, browser checks and benchmark runners |

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

The delta benchmark asserts exact reconstruction for every measured update. The current browser network benchmark is exploratory: two desktop browser contexts with application-level RTC delay/jitter/stall injection. Its WSS profile is not delayed, it does not impose real IP packet loss or bandwidth caps, and next-rAF timing is not physical touch-to-photon latency. Five-player sustained impairment, recovery, mobile-device and WAN acceptance remain release gates in the roadmap.

Tests should use typed injected clocks, schedulers, transports and seeded randomness. Keep simulation time independent of wall-clock time; exercise serialization and lifecycle boundaries with deterministic failures, not only happy paths. Review reports explain the missing invariants and required regressions.

## Hosting and deployment status

The current deployment target uses **GitHub Pages, Cloud Run, Firestore room metadata and Pub/Sub signalling only**. See the [verified GCP inventory](docs/online/GCP-INVENTORY.md). The older local Cloudflare adapter remains available through `dev:online`. It requires no provisioned always-running game simulation server. Gameplay requires WebRTC; the service does not relay gameplay traffic. Failed direct connections show a retry state. The GCP target does not provision TURN. Some networks cannot establish a direct connection; the UI must report that failure instead of silently relaying the game.

A temporary experimental preview was reported at **https://fuse-riders.vagabond-walk.workers.dev**. This is not a declared production endpoint: current reachability, account ownership, claim status and expiry must be verified before relying on it. No permanent production deployment, operating account, custom domain, or billing arrangement is certified by this README. Local server processes and LAN addresses are ephemeral; read startup output rather than reusing a recorded PID or IP.

The production target is GitHub Pages plus GCP Cloud Run, with Firestore room metadata and Pub/Sub **signalling only**. See [GCP deployment instructions](docs/online/GCP-DEPLOY.md) and [the direct-only decision](docs/adr/035-direct-gameplay-only.md). The Pages Play link will be published after frontend/backend verification.

For the older Cloudflare prototype, `npm run deploy` builds and invokes Wrangler. **That command does not run the release gates.** Complete the roadmap's review and verification requirements first, deploy a preview of the tested artifact, and verify it before promoting to production. See [deployment details and cost assumptions](docs/online/DEPLOYMENT.md). Verify current provider quotas/pricing before enabling paid services. Keep claim URLs, room/host capabilities, `.dev.vars`, Wrangler credentials and raw secret-bearing logs out of git, copied invites and public diagnostics.

Repository: [andeplane/fuse-riders](https://github.com/andeplane/fuse-riders). Contributions should use coherent atomic commits with relevant checks, documented evidence, and explicit limitations.

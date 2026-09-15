# Fuse Riders

## [Play it now →](https://andeplane.github.io/fuse-riders/)

**Play solo or with friends.** Choose **PLAY SOLO** for an immediate local game against four AI riders, or create a room and share its invite. Solo uses no room service or WebRTC; refreshing starts a fresh run. Keep the host tab in the foreground. Gameplay requires a direct WebRTC connection; unsupported networks show a retry state. Physical-phone qualification is still pending.

A TypeScript party game for 2–5 players: steer neon riders, dodge their trails, and launch bombs and other projectiles. Play together around a TV with phones as controllers, or create an online room with an arena on each device. Add AI riders when fewer friends are available. The default match is first to three round wins.

![Restored neon room lobby with QR invite and rider cards](docs/online/ui-evidence/lobby-desktop-1a25594.png)

*Actual desktop browser screenshot (1280×800) of the restored room lobby from the [controller and lobby acceptance](docs/online/ui-evidence/README.md), captured at source `1a25594` against an isolated local Worker during PR #2. Every runtime deployed since `68bea0d` (currently `a4bee00`) ships this UI; the image is not a screenshot of the public deployment.*

![Fuse Riders Phaser gameplay showcase](docs/gameplay-phaser.png)

*Rendered in the real game client using a reproducible gameplay showcase.*

Public Chrome and WebKit checks covered phone hosting, AI, guest connections, saved settings, shared-TV play and reset at runtime `6c1673b`; the [public acceptance report](docs/online/PUBLIC-ACCEPTANCE.md) records that tested release. The restored UI (`68bea0d`: neon lobby, landscape touch controls, keyboard controls, short room codes) was first published after local Chrome/WebKit verification; its CI run failed at the desktop keyboard browser check, PRs #9 and #11 fixed that check, and the currently deployed `a4bee00` runtime passed CI 34822503284. No clean public acceptance run for the restored UI is recorded in this repository; see the [release status](docs/online/PUBLIC-BETA-2026-09-14.md#restored-ui-release-68bea0d). Renderer and network benchmarks are documented separately; physical-device performance and arbitrary network reliability are not guaranteed. See the [online roadmap](docs/online/ROADMAP.md), [ADRs](docs/adr/), and [review reports](docs/reviews/). The LAN path remains available.

## Run a LAN game

Requires Node.js **22.12 or newer** and npm. From a fresh checkout:

```sh
npm ci
PORT=3030 npm start
```

Connect the laptop to the TV and put phones on the same Wi-Fi. Open the **host display URL printed by the server**, then scan its QR code from each phone. The host URL contains a capability needed to start/reset matches; an ordinary `/display` URL does not grant those controls. Phones use `/controller`. Use the printed LAN IP on phones, not `localhost`. Set `HOST_IP` if automatic interface discovery selects the wrong network.

`npm start` builds the latest browser assets before starting the server. For development, use `PORT=3030 npm run dev`: Vite serves current browser code and updates it as you edit, with no separate build needed. Changes to server code or its shared dependencies automatically restart the Node process. Each restart clears the in-memory game and session scores; open the new printed host link and refresh/rejoin phones. Production does not watch files or automatically refresh; stop and run `npm start` again between matches to pick up changes. The default port is 3000 when `PORT` is omitted; if that port is taken the server walks upward (3001, 3002, …) and prints the links for the port it actually got, so parallel worktrees and stale processes never collide. Vite's HMR shares the same port instead of its fixed 24678.

`npm run dev` also starts the local room service (`wrangler dev` on 127.0.0.1:8787) and proxies `/api` to it, so the home page's CREATE ROOM and JOIN ROOM work on the same LAN address as `/display` and `/controller`; set `ROOM_API=http://host:port` to use another room service instead. To run only the built app on the Worker, use the following command.

## Try online rooms locally

```sh
npm run dev:online
```

Open **http://localhost:8787/**. Create a room, choose shared-screen or individual-device play, and share its short code (for example **AB42**), invite link or QR code. A shared-TV lobby keeps its QR code visible until the race starts. The creator can join as a player on the same phone and use **START RACE**, **MAIN MENU**, and **ROOM SETTINGS**. **INVITE / TV** opens a separate display role for a shared screen. Use HTTPS for remote-device testing; local HTTP testing does not prove Internet connectivity.

A room lasts for its hosted session, including rematches. **MENU → END ROOM** closes it immediately. If the host disconnects, it expires after a 90-second reconnect window; guests cannot keep it alive.

Room settings select first-to-N wins or a fixed number of rounds. Open **CONFIGURE POWERUPS** to adjust drop weights, use **BACK TO ROOM SETTINGS** to return, and **SAVE SETTINGS** to apply the draft. A weight of zero disables that drop; all zero means no random drops. Defaults and preferences are stored in the creator's browser under `fuse-riders-room-settings-v1`. Match format changes apply to the next match, and pickup-weight changes apply to the next round. Clearing browser storage loses saved preferences and room credentials.

**ROOM SETTINGS → Bomb aim time (seconds)** adjusts how quickly a held bomb reaches maximum distance in solo and online rooms: 0.1–2 seconds in 0.05-second steps, default 0.4 seconds. Try 1.2 seconds for the original pace. Save to apply it next round; the room shares one active aim time for players, AI and previews.

The creator's browser owns the simulation. Keep its tab in the foreground: a phone lock or background tab can pause everyone. Host authority is fenced by renewable leases and connection epochs; validated local checkpoints support creator refresh recovery. Corrupt or incompatible checkpoints are rejected before replacing healthy state. These mechanisms have regression tests, while sustained recovery and physical-device behavior still need qualification. There is no automatic host migration, ranked anti-cheat authority, or guarantee of uninterrupted play through arbitrary network failure.

## How to play

On desktop, use **← / →** to steer and hold/release **Space** to charge and fire in online rooms or solo mode. Opening a menu or leaving the tab cancels held controls. On phones, rotate to landscape. A joined phone shows the same controller in every phase (lobby, countdown, play, between rounds, match complete): the left, middle and right thirds of the screen steer left, charge/fire, and steer right, and the phase notice floats at the top. Introductory hints fade over the arena; shared-TV phones retain visible colored controls. **☰ MENU** opens the roster, game actions (START RACE / REMATCH / MAIN MENU) and settings. Fullscreen is requested where the browser supports it. Hold **Fire** to charge a forward launch, then release. Target Bomb changes Fire into a thumb trackpad with a public aiming marker. Tap **HEAD** to change avatar, including during a round. Phone colors match riders. Joiners can enter during play when a seat is available and wait for the next round.

On a computer, hold **← / →** or **A / D** to steer and hold/release **Space** for the Fire action in solo, online rooms or the LAN controller. Opening a dialog or switching away cancels held controls. Use the on-screen Fire pad to slide the Target Bomb aim. Desktop arena views use compact controls to give the board more space; touch devices keep large pads.

Drops include blast upgrades, Beer, Ink, Triple/Five Shot, Target Bomb, Orbit Shield, portals, shells, gun projectiles, and shorter fuses. Star is excluded from default drops. Balance changes frequently: use [pickup weights](src/shared/pickup-weights.ts), [game rules](src/shared/game.ts), and [room settings](src/shared/room-settings.ts) as the source of truth rather than copying constants into documentation.

Use **ADD AI** in the host controls to fill empty seats. AI uses normal steering and weapons under the same rules as people; see [AI riders](docs/online/AI-RIDERS.md).

The LAN TV provides audio controls, fullscreen, a main-menu reset, session scores, and end-of-match statistics. Music and effects need a browser user gesture. The online UI reuses the renderer, controller bindings, avatars and audio. Phone-sized Chrome/WebKit product checks pass; physical device and background/lock behavior remain separately unverified.

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

The shared deterministic simulation advances at 20 Hz. Online replication publishes at 20 Hz using field changes and trail deltas with periodic keyframes. Local presentation replays applied-tick movement using the same pure kernel as authority, including drunk steering. A bounded synchronized tick estimate supplies fractional render time; acknowledgements report actual application, not mere receipt. Remote snapshots use a tick-indexed buffer: 25 ms after a fresh validated nearby probe (RTT ≤40 ms), otherwise 100 ms, with no speculative extrapolation. A fixed response benchmark batch measured local p95 27.6 ms and TV p95 88.2 ms; see [method, failed trials and continuity measurements](docs/online/RESPONSE-BENCHMARK.md). These are desktop browser measurements, not physical-device latency guarantees. Gameplay never uses the backend as a relay. Failed WebRTC connections show why (STUN, signalling or ICE) in the header and under **MENU → LINK DIAGNOSTICS**; there is no TURN server, so a guest behind symmetric or carrier-grade NAT (common on cellular) may be unable to connect directly and should join the host's Wi-Fi. See [protocol notes](docs/online/PROTOCOL.md#direct-link-establishment-diagnostics-and-nat-limits-issues-12-27).

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
ONLINE_URL=http://localhost:8787/ npx tsx scripts/desktop-controls-smoke.ts
BROWSER=webkit ONLINE_URL=http://localhost:8787/ npx tsx scripts/desktop-controls-smoke.ts
npx tsx scripts/benchmark-deltas.ts
npx tsx scripts/online-network-benchmark.ts
```

The soundtrack is **Fuse Riders Radio**: it plays for as long as the page is open, starting on the landing page itself, and nothing in the game state restarts a track — rounds, matches and alt-tabbing all leave it playing, and only a finished track or the listener changes the song. **♫ RADIO** (landing top bar, room header, TV toolbar) is a car-radio panel with previous / play-pause / next, the track list, a personal playlist (add with **+**), loop song and loop playlist. The playlist, loop settings, current track and position persist between visits, so moving from the landing page into a room resumes the same song where it was. Shortcuts: **Ctrl+A** radio, **Ctrl+M** mute all, **Ctrl+Alt+M** music, **Ctrl+Alt+E** effects (text fields keep Ctrl+A). Music plays through a media element so a phone's silent switch and volume keys reach it; effects stay synthesized. Mute and volume for both channels persist in `localStorage`, so the music toggle in the landing page top bar keeps music off through the page load into a room. `LANDING_URL=http://127.0.0.1:5173/ npx tsx scripts/landing-music-smoke.ts` drives that flow in a real browser against `npx vite` and writes `artifacts/landing-music.png`; set `CHROMIUM_PATH` to use a specific Chromium build.

Desktop arena play uses one compact bar for scores and room actions, with keyboard instructions under **?**. The arena fits the remaining viewport without changing its aspect ratio; phone touch thirds and the LAN display/controller layout are preserved. The desktop-controls smoke checks fit at standard and ultrawide sizes, toolbar placement, resize recovery, keyboard help and phone controls.

The end-of-match report (podium, totals, awards and rider comparison) is built by the pure [`src/shared/match-recap.ts`](src/shared/match-recap.ts) module from the authoritative `matchStats`; the LAN `/display` overlay and the online `MATCH RESULTS` dialog both render it, so ties, empty rosters and formatting are covered once by `tests/match-recap.test.ts`. The online dialog opens only after the final-round pause and can be reopened with the header `RESULTS` button until a rematch starts. `HOME_URL=http://localhost:8787/ npx tsx scripts/match-recap-smoke.ts` (and `BROWSER=webkit`) plays a one-round solo match to completion on a desktop and a phone-landscape viewport, checks the pause gate, layout bounds and reopen flow, and writes screenshots to `artifacts/match-recap-*.png`; reviewed copies live under [docs/online/ui-evidence/](docs/online/ui-evidence/).

`ONLINE_URL=https://your-preview.example npx tsx scripts/online-smoke.ts` targets a preview and creates test rooms there. Never point tests at an occupied game. Benchmark scripts write reports under `docs/online/`; review regenerated evidence before committing it.

[CI](.github/workflows/ci.yml) splits into two jobs. `verify` runs on every pull request: type checks, unit coverage and the build, about a minute. `e2e` runs the browser matrix and runs on a push to main, on a manual dispatch, or on a pull request labelled `full-ci`; a push to main deploys only once both pass. Label a pull request `full-ci`, or run `scripts/ci-local.sh`, before merging a change to the renderer, the online runtime, the controller or any other browser-facing path, because otherwise a browser regression first shows up on main.

To run the whole CI suite locally in the same order and with the same env, use `scripts/ci-local.sh`. It stops at the first failing step, prints a `PASS`/`FAIL` line with wall time per step, starts Wrangler itself (log in `artifacts/worker.log`) and always stops it on exit. `PORT` chooses the Wrangler port so parallel worktrees do not collide. `ONLY` runs a comma-separated subset of steps (`typecheck`, `worker`, `coverage`, `build`, `lan`, `avatar`, `keyboard`, `online`, `phaser`, `home`, `landscape`, `recap`, `shared`, `deltas`; `core` expands to the first four) and starts Wrangler only when a selected step needs it. Steps CI runs in both Chrome and WebKit still run both. The script assumes `npm ci` and `npx playwright install chrome chromium webkit` have run; the Wrangler-backed steps serve `dist/`, so run `build` (or `core`) first:

```sh
PORT=8801 scripts/ci-local.sh
ONLY=core,keyboard PORT=8801 scripts/ci-local.sh
```

Coverage thresholds in [.c8rc.json](.c8rc.json) are 95% lines/statements/functions and 85% branches across its listed modules. Those thresholds do **not** mean every browser/Worker path is covered. [CI](.github/workflows/ci.yml) runs type checks, coverage and builds on every pull request, and the browser checks on the way to main; inspect the actual revision's result, and whether `e2e` ran on it at all, rather than treating this checklist as proof of passing CI.

The delta benchmark asserts exact reconstruction for every measured update. The [browser network harness](docs/online/NETWORK-HARNESS.md) uses five players plus a TV and seeded application-level delay, jitter, loss/reordering, bandwidth queues and a one-way blackhole. Opt-in `?benchmark=1` events expose accepted snapshots and predicted poses without capabilities. Application-message injection is not real IP packet loss, and desktop animation timing is not physical touch-to-photon latency. Reports must identify their tested revision and remaining unmeasured assertions; sustained active-rider, physical-device and WAN acceptance remain roadmap gates.

Tests should use typed injected clocks, schedulers, transports and seeded randomness. Keep simulation time independent of wall-clock time; exercise serialization and lifecycle boundaries with deterministic failures, not only happy paths. Review reports explain the missing invariants and required regressions.

## Hosting and deployment status

The online beta is deployed on **GitHub Pages, Cloud Run, Firestore room metadata and Pub/Sub signalling only**. See the [verified GCP inventory](docs/online/GCP-INVENTORY.md). The older local Cloudflare adapter remains available through `dev:online`. It requires no provisioned always-running game simulation server. Gameplay requires WebRTC; the service does not relay gameplay traffic. Failed direct connections show a retry state. The GCP target does not provision TURN. Some networks cannot establish a direct connection; the UI must report that failure instead of silently relaying the game.

A temporary experimental preview was reported at **https://fuse-riders.vagabond-walk.workers.dev**. This is not a declared production endpoint: current reachability, account ownership, claim status and expiry must be verified before relying on it. The supported beta uses the GitHub Pages and Cloud Run endpoints in the verified inventory; the old Cloudflare preview is not its backend. Local server processes and LAN addresses are ephemeral; read startup output rather than reusing a recorded PID or IP.

See [GCP deployment instructions](docs/online/GCP-DEPLOY.md) and [the direct-only decision](docs/adr/035-direct-gameplay-only.md). The public [Play link](https://andeplane.github.io/fuse-riders/) connects to `https://fuse-riders-gateway-oaaqztec5a-ew.a.run.app`. The [deployment inventory](docs/online/GCP-INVENTORY.md) records the exact frontend/backend source, immutable image, runtime identity and completed public service checks.

`npm run deploy` builds and invokes Wrangler against the older local Cloudflare adapter. **It is not the production path and runs no release gates**; release through the GCP/Pages flow above. Complete the roadmap's review and verification requirements first, deploy a preview of the tested artifact, and verify it before promoting anything to production. See [the browser-hosted topology and the local stack](docs/online/DEPLOYMENT.md). Verify current provider quotas/pricing before enabling paid services. Keep claim URLs, room/host capabilities, `.dev.vars`, Wrangler credentials and raw secret-bearing logs out of git, copied invites and public diagnostics.

Repository: [andeplane/fuse-riders](https://github.com/andeplane/fuse-riders). Contributions should use coherent atomic commits with relevant checks, documented evidence, and explicit limitations.

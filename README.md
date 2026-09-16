# Fuse Riders

## [Play it now →](https://andeplane.github.io/fuse-riders/)

**Play solo or with friends.** Choose **PLAY SOLO** for an immediate local game against four AI riders, or create a room and share its invite. Solo uses no room service or WebRTC; refreshing starts a fresh run. In a room every device simulates the game, so any rider can refresh or drop and rejoin while the others keep playing. Gameplay requires a direct WebRTC connection; unsupported networks show a retry state. Physical-phone qualification is still pending.

A TypeScript party game for 2–5 players: steer neon riders, dodge their trails, and launch bombs and other projectiles. Play together around a TV with phones as controllers, or create an online room with an arena on each device. Add AI riders when fewer friends are available. The default match is first to three round wins.

![Restored neon room lobby with QR invite and rider cards](docs/online/ui-evidence/lobby-desktop-1a25594.png)

*Actual desktop browser screenshot (1280×800) of the restored room lobby from the [controller and lobby acceptance](docs/online/ui-evidence/README.md), captured at source `1a25594` against an isolated local Worker during PR #2. Every runtime deployed since `68bea0d` (currently `a4bee00`) ships this UI; the image is not a screenshot of the public deployment.*

![Fuse Riders Phaser gameplay showcase](docs/gameplay-phaser.png)

*Five AI riders playing an actual match in the real game client — not a staged fixture.*

Public Chrome and WebKit checks covered phone hosting, AI, guest connections, saved settings, shared-TV play and reset at runtime `6c1673b`; the [public acceptance report](docs/online/PUBLIC-ACCEPTANCE.md) records that tested release. The restored UI (`68bea0d`: neon lobby, landscape touch controls, keyboard controls, short room codes) was first published after local Chrome/WebKit verification; its CI run failed at the desktop keyboard browser check, PRs #9 and #11 fixed that check, and the currently deployed `a4bee00` runtime passed CI 34822503284. No clean public acceptance run for the restored UI is recorded in this repository; see the [release status](docs/online/PUBLIC-BETA-2026-09-14.md#restored-ui-release-68bea0d). Renderer and network benchmarks are documented separately; physical-device performance and arbitrary network reliability are not guaranteed. See the [online roadmap](docs/online/ROADMAP.md), [ADRs](docs/adr/), and [review reports](docs/reviews/). The LAN path remains available.

## Run a LAN game

Requires Node.js **22.12 or newer** and npm. From a fresh checkout:

```sh
npm ci
PORT=3030 npm start
```

Connect the laptop to the TV and put phones on the same Wi-Fi. Open the **host display URL printed by the server**, then scan its QR code from each phone. The host URL contains a capability needed to start/reset matches; an ordinary `/display` URL does not grant those controls. Phones use `/controller`. Use the printed LAN IP on phones, not `localhost`. Set `HOST_IP` if automatic interface discovery selects the wrong network.

`npm start` builds the latest browser assets before starting the server. For development, use `PORT=3030 npm run dev`: Vite serves current browser code and updates it as you edit, with no separate build needed. Changes to server code or its shared dependencies automatically restart the Node process. Each restart clears the in-memory game and session scores; open the new printed host link and refresh/rejoin phones. Production does not watch files or automatically refresh; stop and run `npm start` again between matches to pick up changes. The default port is 3000 when `PORT` is omitted; if that port is taken the server walks upward (3001, 3002, …) and prints the links for the port it actually got, so parallel worktrees and stale processes never collide. Vite's HMR shares the same port instead of its fixed 24678.

`npm run dev` also starts the local room service in the same process (the production `src/service` protocol over in-memory rooms, on 127.0.0.1:8787 or the next free port) and proxies `/api` to it, so the home page's CREATE ROOM and JOIN ROOM work on the same LAN address as `/display` and `/controller`; set `ROOM_API=http://host:port` to use another room service instead. To run only the built app with that room service, use the following command.

## Try online rooms locally

```sh
npm run dev:online
```

Open **http://localhost:8787/**. Create a room, choose shared-screen or individual-device play, and share its short code (for example **AB42**), invite link or QR code. A shared-TV lobby keeps its QR code visible until the race starts, with the join link printed under it and a **COPY LINK** button for anyone who cannot scan. The creator can join as a player on the same phone and use **START RACE**, **BACK TO LOBBY**, and **ROOM SETTINGS**. **TV VIEW** opens a separate display role for a shared screen in a new tab. Use HTTPS for remote-device testing; local HTTP testing does not prove Internet connectivity.

A room lasts for its hosted session, including rematches. **ROOM → END ROOM** closes it immediately. If the host disconnects, it expires after a 90-second reconnect window; guests cannot keep it alive.

Room settings select first-to-N wins or a fixed number of rounds. Open **CONFIGURE POWERUPS** to adjust drop weights, use **BACK TO ROOM SETTINGS** to return, and **SAVE SETTINGS** to apply the draft. A weight of zero disables that drop; all zero means no random drops. Defaults and preferences are stored in the creator's browser under `fuse-riders-room-settings-v1`. Match format changes apply to the next match, and pickup-weight changes apply to the next round. Clearing browser storage loses saved preferences and room credentials.

**ROOM SETTINGS → Bomb aim time (seconds)** adjusts how quickly a held bomb reaches maximum distance in solo and online rooms: 0.1–2 seconds in 0.05-second steps, default 0.4 seconds. Try 1.2 seconds for the original pace. Save to apply it next round; the room shares one active aim time for players, AI and previews.

Every device in a room simulates the game from one shared input log, so no browser owns the world: the creator's stream carries the room management entries (seats, settings, start, AI riders), and if the creator goes quiet for five seconds the lowest connected rider marks it absent so play continues. A refreshed creator or guest rejoins the running match with a validated snapshot from any peer; nothing is persisted locally. A background tab stops sending input and is marked absent after a second, which neutralises its rider. These mechanisms have regression tests (`tests/room-runtime.test.ts`), while sustained recovery on real phones and networks remains unqualified.

## How to play

When a rider dies, its remaining trail stays in the arena as an obstacle until the next round, without shrinking from the tail. Explosions, bullets and closing walls can still cut it.

On desktop, use **← / →** to steer and hold/release **Space** to charge and fire in online rooms or solo mode. Opening a menu or leaving the tab cancels held controls. On phones the lobby is a plain screen in either orientation: the room code with the join link and QR, the riders, and for the host START RACE, ADD AI, ROOM SETTINGS and TV VIEW. Once the race starts, rotate to landscape: from countdown through the match report the phone is the controller — the left, middle and right thirds of the screen steer left, charge/fire, and steer right, and the phase notice floats at the top. Introductory hints fade over the arena; shared-TV phones retain visible colored controls. **☰ MENU** opens the roster, game actions (START RACE / REMATCH / BACK TO LOBBY) and settings. Fullscreen is requested where the browser supports it. Hold **Fire** to charge a forward launch, then release. Target Bomb changes Fire into a thumb trackpad with a public aiming marker. Tap **HEAD** to change avatar, including during a round. Phone colors match riders. Joiners can enter during play when a seat is available and wait for the next round.

On a computer, hold **← / →** or **A / D** to steer and hold/release **Space** for the Fire action in solo, online rooms or the LAN controller. Opening a dialog or switching away cancels held controls. Use the on-screen Fire pad to slide the Target Bomb aim. Desktop arena views use compact controls to give the board more space; touch devices keep large pads.

Common **Power** pickups improve your main weapon for the rest of the round. Each pickup contributes immediately to larger blasts and faster reload, with diminishing returns and a fixed fuse. The count resets to zero each round. Beside every rider’s name, a gold diamond and number show the total collected; your controller shows the same count. The player-colored ring around the avatar shows reload only. Special drops include Beer, Ink, Triple/Five Shot, Target Bomb, Orbit Shield, portals, shells, gun projectiles, speed boost, Grip and Singularity. Star is excluded from default drops.

**GRIP** increases steering rate by 75% at unchanged speed for the rest of the round, reducing the turning radius by about 43% (54 → 31 world units at normal speed). With enough starting clearance, you can take the inside of another rider’s 180° turn. Each rider can collect it only once per round: later drops stay on the board for other riders, even when you drive over them. The HUD shows **GRIP** while active; the next round resets both steering and eligibility. It is enabled in default drops; existing custom weights stay unchanged (select CLASSIC to use the updated defaults).

Rare **Extra Bomb** pickups (about 1% of default drops) add one bomb to every ordinary shot for the remainder of the round, up to nine bombs. The bomb icon carries a **+1** badge; **B×N** beside the rider’s Power count and on the controller shows the permanent bombs-per-shot count. New rounds reset it to one. Triple and Five remain one-shot bonuses (+2/+4, with Five taking priority) and stack with the permanent upgrade, allowing at most thirteen bombs. Volleys are symmetric around the aim direction, including even counts, and never widen beyond the existing Five fan. Target, Shell and Cannon still fire a single special shot and preserve the upgrade. Singularity adds only one gravity field per volley; Power, reload, fuse and chain-reaction rules are unchanged. Existing saved drop weights remain as configured; select CLASSIC in powerup settings to pick up the new default weight.

**Shorter Fuse** is back as an occasional stopwatch pickup. It stacks twice for the round: ordinary bomb fuses shorten from **2s → 1.5s → 1s**, including Extra Bomb/Triple/Five volleys and Singularity bombs. Already launched bombs keep their fuse; Target still detonates instantly, and Shell/Cannon lifetimes and Power reloads are unchanged. New rounds reset the fuse. Select CLASSIC in powerup settings to include it in an existing saved drop configuration.

For balance experiments, edit [POWER_TUNING](src/shared/power-progression.ts): `halfStrengthPickups` sets the count needed for half the available weapon improvement (currently 30); `spawnTicksPerRider`, `activePickupsPerRider` and `maxActivePickups` control abundance; `defaultDropWeight` sets Power's default share relative to the [special pickup weights](src/shared/pickup-weights.ts). Blast/reload limits and the diminishing-return curve live there too. Intervals use 20 Hz simulation ticks. Drops appear one at a time, about once every two seconds per living rider (bots included), with four board slots per living rider and a global ceiling of twenty. There is no time-based spawn ramp. When a rider dies, the next scheduled attempt uses the smaller population; existing drops stay until collected or expired, and new drops pause while at or above the reduced cap. Existing reloads and launched bombs retain their original values; upgrades apply to subsequent launches, including multishot/Target blasts and Singularity field size. Reload also applies to gun/shell launches, whose projectile behavior is unchanged. Reload is rounded to whole simulation ticks, so some individual pickups improve blast size without shortening reload another tick; reload eventually plateaus at its floor. Saved settings containing the removed Blast type are invalidated and fall back to defaults; configure and save a new draft after updating.

Use **ADD AI** in the host controls to fill empty seats. AI uses normal steering and weapons under the same rules as people; see [AI riders](docs/online/AI-RIDERS.md).

The LAN TV provides audio controls, fullscreen, a main-menu reset, session scores, and end-of-match statistics. Music and effects need a browser user gesture. The online UI reuses the renderer, controller bindings, avatars and audio. Phone-sized Chrome/WebKit product checks pass; physical device and background/lock behavior remain separately unverified.

## Architecture

| Path | Simulation authority | Communication | Lifetime |
| --- | --- | --- | --- |
| LAN | Local Node process | WebSocket intents, snapshots and events | Process must run during play; restart resets state |
| Online | Every device, from one shared input log | Full WebRTC mesh; backend WebSocket signalling only | Any member can serve the world to a joiner; a refreshed creator or guest rejoins the running match |

```text
LAN:     phones ── WebSocket ── Node simulation ── WebSocket ── TV

Online:  every member ── WebRTC mesh (one link per pair) ── every member
           each device folds the same input log and simulates locally
                └── Cloud Run gateway: room codes, membership, signalling ──┘
                    Firestore: room metadata / leases
                    Pub/Sub: signalling / coordination
```

The shared deterministic simulation advances at 20 Hz and uses pinned JavaScript trigonometry so every engine folds the same state. Online rooms are peer-to-peer: every device that renders the world simulates it locally from one shared input log. Each member owns one stream of edge-filtered entries (steer, aim, press, release, cancel, avatar); the creator's stream also carries the management entries (join, leave, presence, settings, start, rematch, lobby, AI riders). Every member sends one small MessagePack packet to every other member per tick and immediately on a new entry; completeness, liveness, loss and RTT are derived from that stream, and a missing entry is repaired by nack or by rotation through the retained window. A player's own input applies on the next simulation tick; other players' inputs apply one network hop later, and a late entry rolls the world back up to 40 ticks and re-simulates. Joiners and refreshed pages install a validated snapshot from any peer. See the [P2P design brief and measurements](docs/online/P2P-INPUT-LOG-BRIEF.md); `?stats=1` (or **ROOM → SHOW NETWORK STATS**) shows each device's own link quality. Gameplay never uses the backend as a relay. Failed WebRTC connections show why (STUN, signalling or ICE) in the header and under **MENU → LINK DIAGNOSTICS**; there is no TURN server, so a guest behind symmetric or carrier-grade NAT (common on cellular) may be unable to connect directly and should join the host's Wi-Fi. See [protocol notes](docs/online/PROTOCOL.md#direct-link-establishment-diagnostics-and-nat-limits-issues-12-27).

| Location | Responsibility |
| --- | --- |
| `src/shared/` | Deterministic rules, pure rider-motion kernel, bounded AI controller, geometry, protocol types, scores, settings and drops |
| `src/server/` | LAN HTTP/WebSocket server, authority, seats, input buffering and injected scheduling |
| `src/client/` | Phaser presentation, Canvas fallback, themes, audio, avatars and phone pointer controls |
| `src/shared/input-log.ts`, `apply-tick.ts` | Log entry types and validation, the gesture fold, and the deterministic per-tick reducer over management and player entries |
| `src/online/stream.ts`, `rollback.ts`, `clock.ts` | Per-stream receive buffers with repair and retention, the speculative world with snapshots and rollback, and the slewed tick clock |
| `src/online/packet.ts`, `snapshot.ts`, `checkpoint.ts` | Bounded MessagePack packet and nack codec, chunked validated world snapshots, and replica state validation |
| `src/online/room-runtime.ts`, `peer-transport.ts` | One runtime for solo and online rooms (roles, cadence, creator duties, presentation) and the full WebRTC mesh with reliable and unreliable channels |
| `src/online/prediction.ts`, `net-stats.ts`, `ui.ts` | Fractional presentation with immediate local steering, the per-device link quality overlay, and the room UI |
| `src/service/` | Room API/WebSocket gateway (`http.ts`, `gateway.ts`, `room-store.ts`) with Firestore transactions and Pub/Sub signalling in production (`index.ts`) and in-memory metadata for local development and CI (`dev.ts`) |
| `Dockerfile.cloud`, `scripts/deploy-cloud.sh`, `.github/workflows/pages.yml` | GCP image/release and GitHub Pages frontend pipelines |
| `tests/`, `scripts/` | Deterministic tests, browser checks and benchmark runners |

Phaser is presentation only: the caller supplies snapshots to one render loop, pooled effects are bounded, and Phaser physics/timers never advance game authority. Themes and avatars respect the Pages base path. See [renderer architecture and benchmarks](docs/PHASER.md).

[AGENTS.md](AGENTS.md) defines engineering expectations. [Existing architecture notes](docs/architecture.md) describe the LAN implementation but contain historical balance details; source and later ADRs take precedence. Themes stay separate from gameplay and hitboxes; see [theme assets](docs/theme-assets.md) and the [chosen graphics reference](docs/gameplay-concepts/06-neon-pixel-hybrid.png).

## Tests and evidence

```sh
npm run typecheck
npm test
npm run test:coverage
npm run build
npx playwright install chrome chromium webkit
npm run test:browser
BROWSER=webkit npm run test:browser
```

LAN browser smoke starts its own isolated server. It uses installed Chrome by default and WebKit with `BROWSER=webkit`. Online smoke uses bundled Chromium by default and needs `npm run dev:online` running in another terminal:

```sh
mkdir -p artifacts
npx tsx scripts/online-smoke.ts
BROWSER=webkit npx tsx scripts/online-smoke.ts
ONLINE_URL=http://localhost:8787/ npx tsx scripts/desktop-controls-smoke.ts
BROWSER=webkit ONLINE_URL=http://localhost:8787/ npx tsx scripts/desktop-controls-smoke.ts
npx tsx scripts/determinism-replay.ts
ONLINE_URL=http://localhost:8787/ npx tsx scripts/p2p-mesh-browser.ts
ONLINE_URL=http://localhost:8787/ npx tsx scripts/p2p-measure.ts
```

The soundtrack is **Fuse Riders Radio**: it plays for as long as the page is open, starting on the landing page itself, and nothing in the game state restarts a track — rounds, matches and alt-tabbing all leave it playing, and only a finished track or the listener changes the song. **♫ RADIO** (landing top bar, room header, TV toolbar) is a car-radio panel with previous / play-pause / next, the track list, a personal playlist (add with **+**), loop song and loop playlist. CREATE ROOM, JOIN ROOM and PLAY SOLO swap the landing view for the room in place rather than reloading, so the song simply plays on; the playlist, loop settings, current track and position also persist between visits, so a real page load resumes the same song where it was. Shortcuts: **Ctrl+A** radio, **Ctrl+M** mute all, **Ctrl+Alt+M** music, **Ctrl+Alt+E** effects (text fields keep Ctrl+A). The radio also appears on the iOS lock screen, CarPlay and car browsers with the track title and artwork; their play/pause and previous/next buttons follow the radio's own queue. The **♫ MUSIC ON / OFF** toggle sits next to **♫ RADIO** on every page and says whether music is on, not whether the speaker is making a sound: a page the browser has not let play yet still reads ON, because the first gesture anywhere starts it (every page load on a phone needs one tap first). Tapping ON turns music off; tapping OFF unmutes, unpauses and plays. On phones and tablets music starts off on the first visit; the choice is stored. Music plays through a media element so a phone's volume keys reach it, and the page asks iOS for an ambient audio session so the silent switch mutes it too (the cost is that ambient audio stops when the screen locks, so the lock-screen radio only plays while the phone is awake); effects stay synthesized. Mute and volume for both channels persist in `localStorage`, so the toggle keeps music off through the page load into a room. `LANDING_URL=http://127.0.0.1:5173/ npx tsx scripts/landing-music-smoke.ts` drives that flow in a real browser against `npx vite` and writes `artifacts/landing-music.png`; set `CHROMIUM_PATH` to use a specific Chromium build.

The game ships two visual styles. **Neon Pixel** (the default) draws a chunky brick boundary wall with corner brackets and warning studs, a 30px grid and dotted trail cores; **Clean Neon** draws a thin glowing rim with a smooth outer stroke, a 50px grid and hairline trails. The style is a per-device choice stored in `localStorage` and never sent to other players: switch it from the room header's style button (next to **♫ MUSIC**), the LAN `/display` **Visual style** selector, or a `?theme=neon-pixel` / `?theme=clean-neon` URL. Switching applies immediately, mid-round included, and only changes graphics — never hitboxes or timing.

Desktop arena play uses one compact bar for scores and room actions, with keyboard instructions under **?**. The arena fits the remaining viewport without changing its aspect ratio; phone touch thirds and the LAN display/controller layout are preserved. The desktop-controls smoke checks fit at standard and ultrawide sizes, toolbar placement, resize recovery, keyboard help and phone controls.

The end-of-match report (podium, totals, highlight reel, awards and rider comparison) is built by the pure [`src/shared/match-recap.ts`](src/shared/match-recap.ts) module from the authoritative `matchStats` and `moments`; the LAN `/display` overlay and the online `MATCH RESULTS` dialog both render it, so ties, empty rosters and formatting are covered once by `tests/match-recap.test.ts`. The highlight reel lists the plays worth replaying — a bomb on a head, a banked shell, a rider cut off or boxed in, a double kill, a last-moment escape from a blast zone — detected inside the shared simulation by [`src/shared/moments.ts`](src/shared/moments.ts) so every device agrees on them ([ADR 043](docs/adr/043-highlight-moments.md)). A round that ends on one pauses a few seconds longer and every screen replays it broadcast-style: letterbox bars, a chyron naming the play, slow motion and a push-in through the impact, a LIVE flag when play returns; reel cards offer WATCH to see a clip again ([ADR 044](docs/adr/044-instant-replay.md)). Clips are local footage each screen recorded itself, so a screen that joined late shows none. The online dialog opens only after the final-round pause and can be reopened with the header `RESULTS` button until a rematch starts. `HOME_URL=http://localhost:8787/ npx tsx scripts/match-recap-smoke.ts` (and `BROWSER=webkit`) plays a one-round solo match to completion on a desktop and a phone-landscape viewport, checks the pause gate, layout bounds and reopen flow, and writes screenshots to `artifacts/match-recap-*.png`; reviewed copies live under [docs/online/ui-evidence/](docs/online/ui-evidence/).

`ONLINE_URL=https://your-preview.example npx tsx scripts/online-smoke.ts` targets a preview and creates test rooms there. Never point tests at an occupied game. Benchmark scripts write reports under `docs/online/`; review regenerated evidence before committing it.

[CI](.github/workflows/ci.yml) splits into two jobs. `verify` runs on every pull request: type checks, unit coverage and the build, about a minute. `e2e` runs the browser matrix and runs on a push to main, on a manual dispatch, or on a pull request labelled `full-ci`; a push to main deploys only once both pass. Label a pull request `full-ci`, or run `scripts/ci-local.sh`, before merging a change to the renderer, the online runtime, the controller or any other browser-facing path, because otherwise a browser regression first shows up on main.

To run the whole CI suite locally in the same order and with the same env, use `scripts/ci-local.sh`. It stops at the first failing step, prints a `PASS`/`FAIL` line with wall time per step, starts the local room service itself (log in `artifacts/room-service.log`) and always stops it on exit. `PORT` chooses the room service port so parallel worktrees do not collide. `ONLY` runs a comma-separated subset of steps (`typecheck`, `coverage`, `build`, `lan`, `avatar`, `keyboard`, `online`, `phaser`, `home`, `landscape`, `recap`, `shared`, `determinism`, `mesh`; `core` expands to the first three) and starts the room service only when a selected step needs it. Steps CI runs in both Chrome and WebKit still run both. The script assumes `npm ci` and `npx playwright install chrome chromium webkit` have run; the room-service steps serve `dist/`, so run `build` (or `core`) first:

```sh
PORT=8801 scripts/ci-local.sh
ONLY=core,keyboard PORT=8801 scripts/ci-local.sh
```

Coverage thresholds in [.c8rc.json](.c8rc.json) are 95% lines/statements/functions and 85% branches across its listed modules. Those thresholds do **not** mean every browser path is covered. [CI](.github/workflows/ci.yml) runs type checks, coverage and builds on every pull request, and the browser checks on the way to main; inspect the actual revision's result, and whether `e2e` ran on it at all, rather than treating this checklist as proof of passing CI.

The determinism replay folds one seeded 3,000-tick five-rider log in Node, Chromium and WebKit and compares the state hash on every tick. The mesh harness runs six contexts alternating Chromium and WebKit through fifteen links, thirty send directions, a three-second send blackhole and a closed channel. The measurement script runs five scripted players plus a TV, once locally and once with injected 40 ms delay, 20 ms jitter and 2% loss, and reports wire bytes, rollbacks and input-to-state latencies as p50/p95 into `artifacts/p2p-measure.json`. Opt-in `?benchmark=1` events expose simulated states, inputs and events without capabilities. While `npm run dev` serves a room, every device also posts its runtime metrics and status changes to `artifacts/telemetry/<ROOM>.ndjson`; `npx tsx scripts/telemetry-report.ts <file>` summarises them. Application-message injection is not real IP packet loss, and desktop timing is not physical touch-to-photon latency. Reports must identify their tested revision and remaining unmeasured assertions; sustained active-rider, physical-device and WAN acceptance remain roadmap gates.

Tests should use typed injected clocks, schedulers, transports and seeded randomness. Keep simulation time independent of wall-clock time; exercise serialization and lifecycle boundaries with deterministic failures, not only happy paths. Review reports explain the missing invariants and required regressions.

## Product analytics

The deployed site reports nine `FlowRiders.`-prefixed product events to Mixpanel. LAN play and local dev are off
by default, `?analytics=1` forces them on and `?analytics=0` forces them off; either choice sticks for the
browser, so it survives the navigation into a room. See [product analytics](docs/ANALYTICS.md)
for the event list and what is deliberately not tracked.

`HOME_URL=http://127.0.0.1:8899/ npx tsx scripts/analytics-smoke.ts` (and `BROWSER=webkit`) plays a one-round
solo match with Mixpanel intercepted — never delivered — and asserts what each event carried, writing
`artifacts/analytics-<browser>.json`. It exists because the failure mode is silent: Mixpanel answers `200` to a
request whose properties it dropped, so a bad payload looks exactly like a good one from inside the game.

## Hosting and deployment status

The online beta is deployed on **GitHub Pages, Cloud Run, Firestore room metadata and Pub/Sub signalling only**; the deployed client additionally reports [product analytics](docs/ANALYTICS.md) to Mixpanel, which carries no gameplay and no room credentials. See the [verified GCP inventory](docs/online/GCP-INVENTORY.md). `dev:online` and CI run the same room service code locally with in-memory rooms. It requires no provisioned always-running game simulation server. Gameplay requires WebRTC; the service does not relay gameplay traffic. Failed direct connections show a retry state. The GCP target does not provision TURN. Some networks cannot establish a direct connection; the UI must report that failure instead of silently relaying the game.

A temporary experimental preview was reported at **https://fuse-riders.vagabond-walk.workers.dev**. This is not a declared production endpoint: current reachability, account ownership, claim status and expiry must be verified before relying on it. The supported beta uses the GitHub Pages and Cloud Run endpoints in the verified inventory; the old Cloudflare preview is not its backend. Local server processes and LAN addresses are ephemeral; read startup output rather than reusing a recorded PID or IP.

See [GCP deployment instructions](docs/online/GCP-DEPLOY.md) and [the direct-only decision](docs/adr/035-direct-gameplay-only.md). The public [Play link](https://andeplane.github.io/fuse-riders/) connects to `https://fuse-riders-gateway-oaaqztec5a-ew.a.run.app`. The [deployment inventory](docs/online/GCP-INVENTORY.md) records the exact frontend/backend source, immutable image, runtime identity and completed public service checks.

Release only through the GCP/Pages flow above. Complete the roadmap's review and verification requirements first, deploy a preview of the tested artifact, and verify it before promoting anything to production. See [the browser-hosted topology and the local stack](docs/online/DEPLOYMENT.md). Verify current provider quotas/pricing before enabling paid services. Keep claim URLs, room/host capabilities, cloud credentials and raw secret-bearing logs out of git, copied invites and public diagnostics.

Repository: [andeplane/fuse-riders](https://github.com/andeplane/fuse-riders). Contributions should use coherent atomic commits with relevant checks, documented evidence, and explicit limitations.

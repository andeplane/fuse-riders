# Fuse Riders

## [Play it now →](https://andeplane.github.io/fuse-riders/)

**Play solo or with friends.** Choose **PLAY SOLO** for an immediate local game against four AI riders, or create a room and share its invite. Solo uses no room service or WebRTC; refreshing starts a fresh run. In a room every device simulates the game, so any rider can refresh or drop and rejoin while the others keep playing. Gameplay requires a direct WebRTC connection; unsupported networks show a retry state. Physical-phone qualification is still pending.

A TypeScript party game for 2–5 players: steer neon riders, dodge their trails, and launch bombs and other projectiles. Play together around a TV with phones as controllers, or create an online room with an arena on each device. Add AI riders when fewer friends are available. The default match is five rounds: most points wins. Earn one point per opponent eliminated before you and one bonus point for being the sole survivor (five riders award 0, 1, 2, 3, 5). Same-tick deaths score equally; draws and timeouts give no win bonus. Match ties break on round wins, then share victory. Session totals carry across matches; match points reset on rematch.

![Restored neon room lobby with QR invite and rider cards](docs/online/ui-evidence/lobby-desktop-1a25594.png)

_Historical desktop browser screenshot (1280×800) from [controller and lobby acceptance](docs/online/ui-evidence/README.md), captured against an isolated local environment at source `1a25594`. It is not evidence of the current public deployment._

![Fuse Riders Phaser gameplay showcase](docs/gameplay-phaser.png)

_Five AI riders playing an actual match in the real game client — not a staged fixture._

Public Chrome and WebKit checks covered phone hosting, AI, guest connections, saved settings, shared-TV play and reset at runtime `6c1673b`; the [public acceptance report](docs/online/PUBLIC-ACCEPTANCE.md) records that tested release. The restored UI (`68bea0d`: neon lobby, landscape touch controls, keyboard controls, short room codes) was first published after local Chrome/WebKit verification; its CI run failed at the desktop keyboard browser check, PRs #9 and #11 fixed that check, and the currently deployed `a4bee00` runtime passed CI 34822503284. No clean public acceptance run for the restored UI is recorded in this repository; see the [release status](docs/online/PUBLIC-BETA-2026-09-14.md#restored-ui-release-68bea0d). Renderer and network benchmarks are documented separately; physical-device performance and arbitrary network reliability are not guaranteed. See the [online roadmap](docs/online/ROADMAP.md), [ADRs](docs/adr/), and [review reports](docs/reviews/). The LAN path remains available.

## Run a LAN game

Requires Node.js **22.12 or newer** and npm. From a fresh checkout:

```sh
npm ci
PORT=3030 npm start
```

Connect the laptop to the TV and put phones on the same Wi-Fi. Open the **host display URL printed by the server**, then scan its QR code from each phone. The host URL contains a capability needed to start/reset matches; an ordinary `/display` URL does not grant those controls. Phones use `/controller`. Use the printed LAN IP on phones, not `localhost`. Set `HOST_IP` if automatic interface discovery selects the wrong network.

`npm start` builds the latest browser assets before starting the server. For development, use `PORT=3030 npm run dev`: Vite serves current browser code and updates it as you edit, with no separate build needed. Changes to server code or its shared dependencies automatically restart the Node process. Each restart clears the in-memory game and session scores; open the new printed host link and refresh/rejoin phones. Production does not watch files or automatically refresh; stop and run `npm start` again between matches to pick up changes. The default port is 3000 when `PORT` is omitted; if that port is taken the server walks upward (3001, 3002, …) and prints the links for the port it actually got, so parallel worktrees and stale processes never collide. Vite's HMR shares the same port instead of its fixed 24678.

`npm run dev` also starts the local room service in the same process (the production `fuse-network-be` protocol over in-memory rooms, on 127.0.0.1:8787 or the next free port) and proxies `/api` to it, so the home page's CREATE ROOM and JOIN ROOM work on the same LAN address as `/display` and `/controller`; set `ROOM_API=http://host:port` to use another room service instead. To run only the built app with that room service, use the following command.

## Try online rooms locally

```sh
npm run dev:online
```

Open the URL it prints — **http://localhost:8787/** unless that port is taken, in which case it walks upward (8788, …) and says which one it got, like `npm run dev`. Create a room, choose shared-screen or individual-device play, and share its short code (for example **AB42**), invite link or QR code. A shared-TV lobby keeps its QR code visible until the race starts, with the join link printed under it and a **COPY LINK** button for anyone who cannot scan. The creator can join as a player on the same phone and use **START RACE**, **BACK TO LOBBY**, and **ROOM SETTINGS**. **TV VIEW** opens a separate display role for a shared screen in a new tab. Use HTTPS for remote-device testing; local HTTP testing does not prove Internet connectivity.

A room lasts for its hosted session, including rematches. **ROOM → END ROOM** closes it immediately. If the host disconnects, it expires after a 90-second reconnect window; guests cannot keep it alive.

Room settings offer **3 ROUNDS · QUICK** and **5 ROUNDS · STANDARD**, plus a custom length of 1–20 rounds. Open **CONFIGURE POWERUPS** to adjust drop weights, use **BACK TO ROOM SETTINGS** to return, and **SAVE SETTINGS** to apply the draft. A weight of zero disables that drop; all zero means no random drops. Defaults and preferences are stored in the creator's browser under `fuse-riders-room-settings-v1`. Match length changes apply to the next match, and pickup-weight changes apply to the next round. Clearing browser storage loses saved preferences and room credentials.

**ROOM SETTINGS → Bomb aim time (seconds)** adjusts how quickly a held bomb reaches maximum distance in solo and online rooms: 0.1–2 seconds in 0.05-second steps, default 0.4 seconds. Try 1.2 seconds for the original pace. Save to apply it next round; the room shares one active aim time for players, AI and previews.

Every device in a room simulates the game from one shared input log, so no browser owns the world: the creator's stream carries the room management entries (seats, settings, start, AI riders), and if the creator goes quiet for five seconds the lowest connected rider marks it absent so play continues. A refreshed creator or guest rejoins the running match with a validated snapshot from any peer; nothing is persisted locally. A background tab stops sending input and is marked absent after a second, which neutralises its rider. These mechanisms have regression tests (`tests/room-runtime.test.ts`), while sustained recovery on real phones and networks remains unqualified.

## How to play

Riders speed up as each round goes on: from normal pace at the start to 1.5× after 60 seconds, when overtime starts closing the walls, and they stay at that speed until the round ends. Steering speeds up too, so turning circles stay the same size; you just have less time to react. Every round starts at normal speed again, and the speed pickups multiply on top ([`riderMotionStep`](src/shared/game.ts)).

When a rider dies, its remaining trail stays in the arena as an obstacle until the next round, without shrinking from the tail. Explosions, bullets and closing walls can still cut it.

On desktop, use **← / →** to steer and hold/release **Space** to charge and fire in online rooms or solo mode. Opening a menu or leaving the tab cancels held controls. On phones the lobby is a plain screen in either orientation: the room code with the join link and QR, the riders, and for the host START RACE, ADD AI, ROOM SETTINGS and TV VIEW. Once the race starts, rotate to landscape: from countdown through the match report the phone is the controller — the left, middle and right thirds of the screen steer left, charge/fire, and steer right, and the phase notice floats at the top. Introductory hints fade over the arena; shared-TV phones retain visible colored controls. **☰ MENU** opens the roster, game actions (START RACE / REMATCH / BACK TO LOBBY) and settings. Fullscreen is requested where the browser supports it. Hold **Fire** to charge a forward launch, then release. Target Bomb changes Fire into a thumb trackpad with a public aiming marker. Tap **HEAD** to change avatar, including during a round. Phone colors match riders. Joiners can enter during play when a seat is available and wait for the next round.

On a computer, hold **← / →** or **A / D** to steer and hold/release **Space** for the Fire action in solo, online rooms or the LAN controller. Opening a dialog or switching away cancels held controls. Use the on-screen Fire pad to slide the Target Bomb aim. Desktop arena views use compact controls to give the board more space; touch devices keep large pads.

Common **Power** pickups improve your main weapon and increase your maximum trail length for the rest of the round. Riders start with 8 seconds of trail (1,200 units at normal speed); each diamond adds a flat 2 seconds (300 units), reaching 16 seconds after 4 diamonds and 24 seconds after 8 diamonds. Existing active trail lasts longer immediately, so the rider grows into the extra capacity without restoring expired or destroyed segments. Trail lifetime has a defensive ceiling of 1,024 ticks (51.2 seconds) to stay within the checkpoint budget. Detached pieces and eliminated riders’ remaining trails pause for one second, then shrink from both ends at 37.5 units per second per end, remaining collidable until gone. Each pickup contributes immediately to larger blasts and faster reload, with diminishing returns and a fixed fuse. The count resets to zero each round. Beside every rider’s name, a gold diamond and number show the total collected; your controller shows the same count. The player-colored ring around the avatar shows reload only. Special drops include Beer, Ink, Triple/Five Shot, Target Bomb, Orbit Shield, portals, shells, gun projectiles, Nitro, Snail, Grip and Gravity. A portal pair carries shells and gun shots as well as riders; a shell gets its own re-entry cooldown, and a gun shot crosses each pair at most once, so neither can be held in a loop. Thrown bombs are unaffected, since they resolve against the point they were aimed at ([ADR 045](docs/adr/045-projectiles-through-portals.md)). Star is excluded from default drops.

**NITRO** doubles your speed for five seconds and **SNAIL** halves every living rival's for five seconds. Every pickup is its own timer, so they stack with themselves and with each other: two Nitros are four times speed until the first runs out, and a Snail cancels a Nitro one for one. Only distance changes: a Nitro rider turns wide and a slowed rider turns tight. Your phone shows **NITRO · ×4 · 1.2s** and **SLOWED · ×0.5 · 2.0s** while they last: each chip is that effect's own factor and the time until it next weakens; a new round clears both. Both are in default drops; existing custom weights stay unchanged (select CLASSIC to use the updated defaults).

Default reload is **2 seconds**, matching an ordinary bomb's fuse: you can launch again on the tick your previous volley explodes. Power pickups reduce reload toward **1 second**, but an active ordinary volley still blocks another launch. Shorter Fuse and chain reactions can detonate bombs before reload finishes; those shots still wait for their reload deadline.

**GRIP** increases steering rate by 75% at unchanged speed for the rest of the round, reducing the turning radius by about 43% (54 → 31 world units at normal speed). With enough starting clearance, you can take the inside of another rider’s 180° turn. Each rider can collect it only once per round: later drops stay on the board for other riders, even when you drive over them. The HUD shows **GRIP** while active; the next round resets both steering and eligibility. It is enabled in default drops; existing custom weights stay unchanged (select CLASSIC to use the updated defaults).

Rare **Extra Bomb** pickups (about 1% of default drops) add one bomb to every ordinary shot for the remainder of the round, up to nine bombs. The bomb icon carries a **+1** badge; **B×N** beside the rider’s Power count and on the controller shows the permanent bombs-per-shot count. New rounds reset it to one. Triple and Five remain one-shot bonuses (+2/+4, with Five taking priority) and stack with the permanent upgrade, allowing at most thirteen bombs. Volleys are symmetric around the aim direction, including even counts, and never widen beyond the existing Five fan. Target, Shell and Cannon still fire a single special shot and preserve the upgrade. Power, reload, fuse and chain-reaction rules are unchanged. Existing saved drop weights remain as configured; select CLASSIC in powerup settings to pick up the new default weight.

**GRAVITY** opens one to three black holes of random size for eight seconds; the largest spans almost the whole short side of the arena. Space curves inside one: every rider's heading bends toward its centre, hardest near the core and not at all at the rim, so nobody rides a straight line there. The bend is always weaker than your own steering, so you can ride out of an orbit, and crossing the core head-on is not bent at all. The black core at the centre kills any rider who falls into it (a Star rides through); the rest of the hole only bends. A hole never opens with its core under a rider. Holes stack up to six at once and clear with the round. It replaces the earlier Singularity bomb, and the old quarter-speed Boost is gone: Nitro covers it.

**Shorter Fuse** is back as an occasional stopwatch pickup. It stacks twice for the round: ordinary bomb fuses shorten from **2s → 1.5s → 1s**, including Extra Bomb/Triple/Five volleys. Already launched bombs keep their fuse; Target still detonates instantly, and Shell/Cannon lifetimes and Power reloads are unchanged. New rounds reset the fuse. Select CLASSIC in powerup settings to include it in an existing saved drop configuration.

For balance experiments, edit [POWER_TUNING](src/shared/power-progression.ts): `halfStrengthPickups` sets the count needed for half the available weapon improvement (currently 30); `spawnTicksPerRider`, `activePickupsPerRider` and `maxActivePickups` control abundance; `defaultDropWeight` sets Power's default share relative to the [special pickup weights](src/shared/pickup-weights.ts). Blast/reload limits and the diminishing-return curve live there too, alongside `baseTrailLifetimeTicks`, `trailTicksPerPickup` and the defensive `maxTrailLifetimeTicks` ceiling for linear trail growth. Intervals use 20 Hz simulation ticks. Drops appear one at a time, about once every two seconds per living rider (bots included), with four board slots per living rider and a global ceiling of twenty. There is no time-based spawn ramp. When a rider dies, the next scheduled attempt uses the smaller population; existing drops stay for the rest of the round until collected or destroyed by a bomb blast (their center must be strictly inside the inner 60% of its radius), and new drops pause while at or above the reduced cap. Existing reloads and launched bombs retain their original values; upgrades apply to subsequent launches, including multishot/Target blasts. Reload also applies to gun/shell launches. Triple/Five Shot and Extra Bomb fan gun and shell projectiles out into the same 3/5/extra spread as bombs; Gun fires on press in the rider’s current facing direction and resolves instantly against the nearest rival head, living/dead trail or wall. Its 4-unit bullet leaves a thin 150 ms tracer; body hits cut a 28-unit hole without an explosion. Hits within 18 units of the struck rider’s head kill immediately, respecting shields and temporary immunity. The shooter’s own body is ignored. Reload is rounded to whole simulation ticks, so some individual pickups improve blast size without shortening reload another tick; reload eventually plateaus at its floor. Saved browser settings that still weigh a removed pickup (Blast, Boost) keep their other values and simply drop it; configure and save a new draft after updating.

Use **ADD AI** in the host controls to fill empty seats. AI uses normal steering and weapons under the same rules as people; see [AI riders](docs/online/AI-RIDERS.md).

The LAN TV provides audio controls, fullscreen, a main-menu reset, session scores, and end-of-match statistics. Music and effects need a browser user gesture. The online UI reuses the renderer, controller bindings, avatars and audio. Phone-sized Chrome/WebKit product checks pass; physical device and background/lock behavior remain separately unverified.

## Architecture

See the [current system map](docs/architecture.md) for module ownership, recovery boundaries and the distinction between shipped behavior and the architecture refactor.

| Path   | Simulation authority                    | Communication                                       | Lifetime                                                                                           |
| ------ | --------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| LAN    | Local Node process                      | WebSocket intents, snapshots and events             | Process must run during play; restart resets state                                                 |
| Online | Every device, from one shared input log | Full WebRTC mesh; backend WebSocket signalling only | Any member can serve the world to a joiner; a refreshed creator or guest rejoins the running match |

```text
LAN:     phones ── WebSocket ── Node simulation ── WebSocket ── TV

Online:  every member ── WebRTC mesh (one link per pair) ── every member
           each device folds the same input log and simulates locally
                └── Cloud Run gateway: room codes, membership, signalling ──┘
                    Firestore: room metadata / leases
                    Pub/Sub: signalling / coordination
```

The shared deterministic simulation advances at 20 Hz and uses pinned JavaScript trigonometry so every engine folds the same state. Once every human rider is out of a round and only AI riders survive, the tick clock runs three times faster until the round ends (`simulationTimeScale` in [game.ts](src/shared/game.ts)); the tick rules themselves do not change. Online rooms are peer-to-peer: every device that renders the world simulates it locally from one shared input log. Each member owns one stream of edge-filtered entries (steer, aim, press, release, cancel, avatar); the creator's stream also carries the management entries (join, leave, presence, settings, start, rematch, lobby, AI riders). Every member sends one small MessagePack packet to every other member per tick and immediately on a new entry; completeness, liveness, loss and RTT are derived from that stream, and a missing entry is repaired by nack or by rotation through the retained window. A player's own input applies on the next simulation tick; other players' inputs apply one network hop later, and a late entry rolls the world back up to 40 ticks and re-simulates. Joiners and refreshed pages install a validated snapshot from any peer. See the [P2P design brief and measurements](docs/online/P2P-INPUT-LOG-BRIEF.md); `?stats=1` (or **ROOM → SHOW NETWORK STATS**) shows each device's own link quality. Gameplay never uses the backend as a relay. Failed WebRTC connections show why (STUN, signalling or ICE) in the header and under **MENU → LINK DIAGNOSTICS**; there is no TURN server, so a guest behind symmetric or carrier-grade NAT (common on cellular) may be unable to connect directly and should join the host's Wi-Fi. See [protocol notes](docs/online/PROTOCOL.md#direct-link-establishment-diagnostics-and-nat-limits-issues-12-27).

| Location                                                                     | Responsibility                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/`                                                                | Deterministic rules, pure rider-motion kernel, bounded AI controller, geometry, protocol types, scores, settings and drops                                                                                                             |
| `src/server/`                                                                | LAN HTTP/WebSocket server, authority, seats, input buffering and injected scheduling                                                                                                                                                   |
| `src/client/`                                                                | Phaser presentation (WebGL/Canvas), themes, audio, avatars and phone pointer controls                                                                                                                                                  |
| `src/shared/input-log.ts`, `apply-tick.ts`                                   | Log entry types and validation, the gesture fold, and the deterministic per-tick reducer over management and player entries                                                                                                            |
| `src/online/stream.ts`, `rollback.ts`, `clock.ts`                            | Per-stream receive buffers with repair and retention, the speculative world with snapshots and rollback, and the slewed tick clock                                                                                                     |
| `src/online/packet.ts`, `snapshot.ts`, `checkpoint.ts`                       | Bounded MessagePack packet and nack codec, chunked validated world snapshots, and replica state validation                                                                                                                             |
| `src/online/room-runtime.ts`                                                 | One runtime for solo and online rooms (roles, cadence, creator duties, presentation), over the `fuse-network-fe` transport                                                                                                             |
| `src/online/prediction.ts`, `net-stats.ts`, `ui.ts`                          | Fractional presentation with immediate local steering, the per-device link quality overlay, and the room UI                                                                                                                            |
| `packages/fuse-network-fe/`                                                  | Game-agnostic browser library: the full WebRTC mesh with reliable and unreliable channels (`peer-transport.ts`), link health, ICE restarts, diagnostics and the room API client ([README](packages/fuse-network-fe/README.md))         |
| `packages/fuse-network-be/`                                                  | Game-agnostic room service: API/WebSocket gateway (`http.ts`, `gateway.ts`, `room-store.ts`), in-memory metadata (`dev.ts`) and Firestore transactions with Pub/Sub signalling (`gcp/`) ([README](packages/fuse-network-be/README.md)) |
| `packages/fuse-network-protocol/`                                            | The wire contract both libraries share: room codes, authority lease, STUN defaults, protocol version                                                                                                                                   |
| `src/service/`                                                               | The game's entry points into `fuse-network-be`: production (`index.ts`), local development and CI (`dev.ts`), and the room capacity                                                                                                    |
| `Dockerfile.cloud`, `scripts/deploy-cloud.sh`, `.github/workflows/pages.yml` | GCP image/release and GitHub Pages frontend pipelines                                                                                                                                                                                  |
| `tests/`, `scripts/`                                                         | Deterministic tests, browser checks and benchmark runners                                                                                                                                                                              |

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

The soundtrack is **Fuse Riders Radio**: it plays for as long as the page is open, starting on the landing page itself, and nothing in the game state restarts a track — rounds, matches and alt-tabbing all leave it playing, and only a finished track or the listener changes the song. **♫ RADIO** (room **SETTINGS**, TV toolbar) is a car-radio panel with previous / play-pause / next, the track list, a personal playlist (add with **+**), loop song and loop playlist. CREATE ROOM, JOIN ROOM and PLAY SOLO swap the landing view for the room in place rather than reloading, so the song simply plays on; the playlist, loop settings, current track and position also persist between visits, so a real page load resumes the same song where it was. Shortcuts: **Ctrl+A** radio, **Ctrl+M** mute all, **Ctrl+Alt+M** music, **Ctrl+Alt+E** effects (text fields keep Ctrl+A). The radio also appears on the iOS lock screen, CarPlay and car browsers with the track title and artwork; their play/pause and previous/next buttons follow the radio's own queue. The **♫ MUSIC ON / OFF** toggle (landing top bar, room **SETTINGS** with an **EFFECTS ON / OFF** twin, TV toolbar) says whether music is on, not whether the speaker is making a sound: a page the browser has not let play yet still reads ON, because the first gesture anywhere starts it (every page load on a phone needs one tap first). Tapping ON turns music off; tapping OFF unmutes, unpauses and plays. Next to it, **🔊 SOUND ON / 🔇 SOUND OFF** mutes and unmutes music and effects together, the same as Ctrl+M. On phones and tablets music starts off on the first visit; the choice is stored. Music plays through a media element so a phone's volume keys reach it, and the page asks iOS for an ambient audio session so the silent switch mutes it too (the cost is that ambient audio stops when the screen locks, so the lock-screen radio only plays while the phone is awake); effects stay synthesized. Mute and volume for both channels persist in `localStorage`, so the toggle keeps music off through the page load into a room. `LANDING_URL=http://127.0.0.1:5173/ npx tsx scripts/landing-music-smoke.ts` drives that flow in a real browser against `npx vite` and writes `artifacts/landing-music.png`; set `CHROMIUM_PATH` to use a specific Chromium build.

The game ships two visual styles. **Neon Pixel** (the default) draws a chunky brick boundary wall with corner brackets and warning studs, a 30px grid and dotted trail cores; **Clean Neon** draws a thin glowing rim with a smooth outer stroke, a 50px grid and hairline trails. The style is a per-device choice stored in `localStorage` and never sent to other players: switch it under the room's **SETTINGS** button, the LAN `/display` **Visual style** selector, or a `?theme=neon-pixel` / `?theme=clean-neon` URL. Switching applies immediately, mid-round included, and only changes graphics — never hitboxes or timing.

Desktop arena play uses one compact bar for scores and room actions, with keyboard instructions under **?** and device preferences (music, effects, radio, visual style, fullscreen) under **SETTINGS**. The arena fits the remaining viewport without changing its aspect ratio; phone touch thirds and the LAN display/controller layout are preserved. The desktop-controls smoke checks fit at standard and ultrawide sizes, toolbar placement, resize recovery, keyboard help and phone controls.

The end-of-match report (podium, totals, highlight reel, awards and rider comparison) is built by the pure [`src/shared/match-recap.ts`](src/shared/match-recap.ts) module from the authoritative `matchStats` and `moments`; the LAN `/display` overlay and the online `MATCH RESULTS` dialog both render it, so ties, empty rosters and formatting are covered once by `tests/match-recap.test.ts`. The highlight reel lists the plays worth replaying — a bomb on a head, a banked shell, a rider cut off or boxed in, a double kill, a last-moment escape from a blast zone — detected inside the shared simulation by [`src/shared/moments.ts`](src/shared/moments.ts) so every device agrees on them ([ADR 043](docs/adr/043-highlight-moments.md)). A round that ends on one pauses a few seconds longer and every screen replays it broadcast-style: letterbox bars, a chyron naming the play, slow motion and a push-in through the impact, a LIVE flag when play returns; reel cards offer WATCH to see a clip again ([ADR 044](docs/adr/044-instant-replay.md)). Clips are local footage each screen recorded itself, so a screen that joined late shows none. The online dialog opens only after the final-round pause and can be reopened with the header `RESULTS` button until a rematch starts. `HOME_URL=http://localhost:8787/ npx tsx scripts/match-recap-smoke.ts` (and `BROWSER=webkit`) plays a one-round solo match to completion on a desktop and a phone-landscape viewport, checks the pause gate, layout bounds and reopen flow, and writes screenshots to `artifacts/match-recap-*.png`; reviewed copies live under [docs/online/ui-evidence/](docs/online/ui-evidence/).

`ONLINE_URL=https://your-preview.example npx tsx scripts/online-smoke.ts` targets a preview and creates test rooms there. Never point tests at an occupied game. Benchmark scripts write reports under `docs/online/`; review regenerated evidence before committing it.

[CI](.github/workflows/ci.yml) splits into two jobs. `verify` runs on every pull request: formatting, type checks, unit coverage and the build. `e2e` runs the browser matrix and runs on a push to main, on a manual dispatch, or on a pull request labelled `full-ci`; a push to main deploys only once both pass. Run the affected local smoke when practical and report any untested browser flow. Reserve `full-ci` for explicit requests or changes whose failure would be expensive to unwind; routine PRs do not wait on the full browser matrix.

To run the whole CI suite locally in the same order and with the same env, use `scripts/ci-local.sh`. It stops at the first failing step, prints a `PASS`/`FAIL` line with wall time per step, starts the local room service itself (log in `artifacts/room-service.log`) and always stops it on exit. `PORT` chooses the room service port so parallel worktrees do not collide. `ONLY` runs a comma-separated subset of steps (`format`, `typecheck`, `coverage`, `build`, `lan`, `avatar`, `keyboard`, `online`, `preview`, `phaser`, `home`, `landscape`, `recap`, `shared`, `determinism`, `mesh`; `core` expands to formatting, typecheck, coverage and build) and starts the room service only when a selected step needs it. Steps CI runs in both Chrome and WebKit still run both. The script assumes `npm ci` and `npx playwright install chrome chromium webkit` have run; the room-service steps serve `dist/`, so run `build` (or `core`) first:

```sh
PORT=8801 scripts/ci-local.sh
ONLY=core,keyboard PORT=8801 scripts/ci-local.sh
```

Coverage thresholds in [.c8rc.json](.c8rc.json) are 95% lines/statements/functions and 85% branches across its listed modules. Those thresholds do **not** mean every browser path is covered. [CI](.github/workflows/ci.yml) runs type checks, coverage and builds on every pull request, and the browser checks on the way to main; inspect the actual revision's result, and whether `e2e` ran on it at all, rather than treating this checklist as proof of passing CI.

The determinism replay folds one seeded 3,000-tick five-rider log in Node, Chromium and WebKit and compares the state hash on every tick. The mesh harness runs six contexts alternating Chromium and WebKit through fifteen links, thirty send directions, a three-second send blackhole and a closed channel. The measurement script runs five scripted players plus a TV, once locally and once with injected 40 ms delay, 20 ms jitter and 2% loss, and reports wire bytes, rollbacks and input-to-state latencies as p50/p95 into `artifacts/p2p-measure.json`. Opt-in `?benchmark=1` events expose simulated states, inputs and events without capabilities. While `npm run dev` serves a room, every device also posts its runtime metrics and status changes to `artifacts/telemetry/<ROOM>.ndjson`; `npx tsx scripts/telemetry-report.ts <file>` summarises them. Application-message injection is not real IP packet loss, and desktop timing is not physical touch-to-photon latency. Reports must identify their tested revision and remaining unmeasured assertions; sustained active-rider, physical-device and WAN acceptance remain roadmap gates.

Tests should use typed injected clocks, schedulers, transports and seeded randomness. Keep simulation time independent of wall-clock time; exercise serialization and lifecycle boundaries with deterministic failures, not only happy paths. Review reports explain the missing invariants and required regressions.

## Product analytics

The deployed site reports eleven `FlowRiders.`-prefixed product events to Mixpanel, including one `Kill` per kill
and one `Miss` per shot that killed nobody, sent by the shooter's own device once each round is decided and confirmed. LAN play and local dev are off
by default, `?analytics=1` forces them on and `?analytics=0` forces them off; either choice sticks for the
browser, so it survives the navigation into a room. See [product analytics](docs/ANALYTICS.md)
for the event list and what is deliberately not tracked.

`HOME_URL=http://127.0.0.1:8899/ npx tsx scripts/analytics-smoke.ts` (and `BROWSER=webkit`) plays a one-round
solo match with Mixpanel intercepted — never delivered — and asserts what each event carried, writing
`artifacts/analytics-<browser>.json`. It exists because the failure mode is silent: Mixpanel answers `200` to a
request whose properties it dropped, so a bad payload looks exactly like a good one from inside the game.

## Hosting and deployment status

The online beta is deployed on **GitHub Pages, Cloud Run, Firestore (room metadata and [match history](#login-and-match-history)), Pub/Sub signalling and Firebase Authentication only**; the deployed client additionally reports [product analytics](docs/ANALYTICS.md) to Mixpanel, which carries no gameplay and no room credentials. See the [verified GCP inventory](docs/online/GCP-INVENTORY.md). `dev:online` and CI run the same room service code locally with in-memory rooms. It requires no provisioned always-running game simulation server. Gameplay requires WebRTC; the service does not relay gameplay traffic. Failed direct connections show a retry state. The GCP target does not provision TURN. Some networks cannot establish a direct connection; the UI must report that failure instead of silently relaying the game.

The supported hosting model is GitHub Pages plus the Cloud Run room service; consult the deployment inventory for recorded endpoints and verify current external state before claiming publication. Local server processes and LAN addresses are ephemeral; read startup output rather than reusing a recorded PID or IP.

See [GCP deployment instructions](docs/online/GCP-DEPLOY.md) and [the direct-only decision](docs/adr/035-direct-gameplay-only.md). The public [Play link](https://andeplane.github.io/fuse-riders/) connects to `https://fuse-riders-gateway-oaaqztec5a-ew.a.run.app`. The [deployment inventory](docs/online/GCP-INVENTORY.md) records the exact frontend/backend source, immutable image, runtime identity and completed public service checks.

Release only through the GCP/Pages flow above. Complete the roadmap's review and verification requirements first, deploy a preview of the tested artifact, and verify it before promoting anything to production. See [the browser-hosted topology and the local stack](docs/online/DEPLOYMENT.md). Verify current provider quotas/pricing before enabling paid services. Keep claim URLs, room/host capabilities, cloud credentials and raw secret-bearing logs out of git, copied invites and public diagnostics.

## Login and match history

Players can **sign in with Google** and get a **permanent history of every match they finish** plus career totals, on
any device. It is optional: a guest plays exactly as before, never downloads the sign-in SDK, and their friends who are
signed in still get the match recorded. It runs on what the game already had — the Cloud Run gateway and its Firestore
database in `andershaf-87` — plus **Firebase Authentication**. There is no Postgres, no Functions, Storage or Realtime
Database, Firebase Hosting serves nothing but the sign-in handler, and nothing here costs money at this game's scale.

On the landing page the top bar has **SIGN IN**; once signed in it reads **MY GAMES** and opens the account's
username, totals and past matches. Sign in before entering a room: the room screen has no sign-in of its own, and a match can only be linked to
an account by a device that was in the room when it ended.

### Usernames

An account has one **username**, and a signed-in rider rides under it in every room and on every device: the join form
shows it and is not editable there. It is changed under MY GAMES. The rule is the rider-name rule everywhere
([`rider-name.ts`](src/shared/rider-name.ts)): 1–18 characters, trimmed, no control characters.

- The first time an account opens MY GAMES without a username, it takes the rider name that browser already used, or
  failing that the first word of the Google display name, and the field is right there to change it.
- The browser caches the username so a room can seat the rider without waiting for anything. A browser that is signed
  in but has never seen it (an invite link opened on a new phone) fetches it while the join form is up.
- Signing out forgets it, and the form goes back to the guest name that browser had before.
- **Usernames are not unique and not reserved.** Two friends may both be "Ace"; the account is the identity, the name
  is what friends call you. Nothing stops a guest typing someone's username either — a room is a table of friends.
- It is a client-side convention: joining a room is peer-to-peer and the gateway never sees the join, so it cannot
  force a signed-in rider's in-game name to match. Each stored match keeps the name it was actually played under.

### How a match gets recorded

The result preserves fractional movement distances and up to 128 historical participants, including riders whose
seats were reused between rounds. Connected participants are frozen at the match-ending tick and carried in
checkpoints; only human finishers count toward confirmation. Recap joins, departures and reconnects cannot
change that roster. Reports over 60 kB use a normal fetch because browsers cap keepalive request bodies.

Gameplay is peer-to-peer, so the gateway never sees a match. Every device computes the same final stats, so:

1. When the recap opens, each rider's device sends the result it computed to
   `POST /api/rooms/<CODE>/results`, with its **room token** as the bearer credential and, if signed in, its Firebase ID
   token in `X-Fuse-Identity` ([`match-report.ts`](src/online/match-report.ts)).
2. A rider's in-game id _is_ the digest of their room token, so the token proves which seat is speaking. The gateway
   binds the verified account to that seat and to no other. Nothing in the request body can name an account.
3. A result is stored under a key derived from its own content (and the room's incarnation). It becomes **confirmed**
   once a **majority of the human riders who stayed to the end** have reported exactly that result
   ([`history.ts`](src/service/history.ts)). Bots do not vote, and neither does a rider the stats say quit mid-match —
   they are gone before the recap and would otherwise leave the match pending forever. A rider alone with bots
   confirms alone.
4. On confirmation, each signed-in rider's totals are incremented in the same transaction. A rider who reports after
   confirmation is linked and credited then — once.

Because a result is keyed by its content, two devices that disagree create two records instead of fighting over one.
A forged result cannot displace or block the honest one; without a majority of its own riders it stays pending and
expires. The `result` holds only what every device computes identically **and the match froze when it began** — the
match id, its length, the winner and the final stats. Devices open the recap at different moments (a backgrounded phone
is late), so anything that can still change while it is up stays out: the room's live settings are not reported at all,
and a rider's avatar travels beside the result, self-reported. The client retries a report that lost the write race
(every rider reports in the same instant) or went in before its sign-in could be verified.

| Record                                  | Kept for |
| --------------------------------------- | -------- |
| Pending (no majority yet)               | 24 hours |
| Confirmed, no signed-in rider           | 30 days  |
| Confirmed, at least one signed-in rider | forever  |

What this does **not** cover: LAN `/display` games and PLAY SOLO (neither has a room on the gateway), and a rider who
signs in only after leaving the room.

### API

| Route                                    | Credential                                                                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/rooms/<CODE>/results`         | `Authorization: Bearer <room token>`, optional `X-Fuse-Identity: <ID token>` | Body `{ result, avatarId? }`, at most 256 kB, unknown fields refused. The sender must be a live member of the room and a rider in the result; that is checked from the room token before the body is read or a sign-in verified. 40 reports per rider and 240 per address per hour, and an account can be linked to 30 matches per hour — past that a report still counts, as a guest's. An identity that fails verification is a guest's report, never a refusal |
| `GET /api/me`                            | `Authorization: Bearer <ID token>`                                           | `{ profile }` — username, avatar, totals — or `{ profile: null }` for an account nothing is stored about yet                                                                                                                                                                                                                                                                                                                                                      |
| `PUT /api/me`                            | `Authorization: Bearer <ID token>`                                           | Body `{ username }` and nothing else. 20 changes per account per hour                                                                                                                                                                                                                                                                                                                                                                                             |
| `GET /api/me/matches[?before=<endedAt>]` | `Authorization: Bearer <ID token>`                                           | The caller's profile totals and 20 confirmed matches, newest first; `before` pages back. Shows every rider's stats and which seat was the caller's — never another rider's account id. 300 requests per account per hour                                                                                                                                                                                                                                          |

Both routes sit behind the gateway's existing `ALLOWED_ORIGINS` check, and both answer 404 on a service started without
history (none is, today).

### Data (Firestore database `fuse-riders`)

| Collection                | Document                          | Contents                                                                                                                                                                       |
| ------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fuse-production-matches` | hash of room incarnation + result | `status`, `result` (per-rider stats), `attesters`, `uidByPlayer`, `avatars`, `participantUids`, `createdAt`, `endedAt`, and `expiresAt`/`cleanupAt` while it can still expire  |
| `fuse-production-users`   | Firebase `uid`                    | `username`, the rider `name` of the last credited match, `avatarId`, `updatedAt`, `totals` (matches, wins, round wins, eliminations, bombs, pickups, survival ticks, distance) |

The personal data stored is the Firebase `uid`, the username, the rider names matches were played under and the
avatar. **No email address or profile photo reaches the gateway or the database.** The Google display name is shown in
the player's own browser only, with one exception the player can see and undo: an account with no username and no
earlier rider name starts with the _first word_ of it as its username. To erase a player, delete their Authentication user, their `fuse-production-users` document, and
remove their `uid` from `uidByPlayer`/`participantUids` of their matches; there is no self-service delete yet.

[`firestore.indexes.json`](firestore.indexes.json) holds the history query's composite index
(`participantUids` array-contains + `endedAt` desc), the `cleanupAt` TTL policies for rooms, creation limits and
matches, and an index exemption for the bulky `result` map. It lists the pre-existing TTL policies on purpose: the file
is the whole truth for the database, so leaving one out invites the next deploy to remove it.

### Running it locally

`npm run dev:online` serves the same routes over in-memory storage, so history lasts until the process exits. Sign-in
works from `localhost` against the real Firebase project (it is an authorized domain and an allowed key referrer), and
the local service verifies real ID tokens. Tests never touch Google: they inject a verifier, or sign tokens with a
throwaway key ([`tests/match-history.test.ts`](tests/match-history.test.ts)).
[`tests/match-report.test.ts`](tests/match-report.test.ts) feeds stats produced by the real simulation through the
gateway's parser — the parser refuses unknown fields, so a stat added to `MatchPlayerStats` without being added to
`COUNTERS` in `history.ts` fails that test instead of silently costing every player their history.

### Firebase

### The shape of it

```
browser ──Google popup──▶ Firebase Auth ──ID token (JWT, 1 h)──▶ browser
browser ──Authorization: Bearer <ID token>──▶ Cloud Run gateway ──IAM──▶ Firestore (fuse-riders)
```

- **Browsers never talk to Firestore.** Accounts and match history are read and written only by the gateway, which
  authenticates with IAM and bypasses security rules. [`firestore.rules`](firestore.rules) is therefore deny-all and
  must stay that way: the web API key is public, so anything the rules allow is allowed to the whole internet.
- **The gateway needs no Firebase credentials.** [`identity.ts`](src/service/identity.ts) verifies ID tokens with
  `jose` against Google's public keys
  (`https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`), so the runtime service
  account keeps exactly its current roles (`roles/datastore.user` conditioned on the `fuse-riders` database, plus the
  signalling role). Do not add `firebase-admin` or grant it `firebaseauth.*`. The project id it checks tokens against
  is `GOOGLE_CLOUD_PROJECT`, overridable with `FIREBASE_PROJECT_ID`; no new deploy configuration was needed.
- **Guests never load Firebase.** [`account.ts`](src/online/account.ts) imports the SDK on the first tap of SIGN IN,
  and afterwards only in a browser that remembers having signed in. It is a separate ~47 kB (gzipped) chunk.
- Postgres was considered and rejected: Cloud SQL's smallest instance is roughly $10/month and never scales to zero,
  while match history (a handful of writes per match) fits inside Firestore's free tier in the database the gateway
  already uses.

### What is configured

| Thing                        | Value                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Firebase project             | `andershaf-87` (number `867594018708`), see [`.firebaserc`](.firebaserc)                                                                                           |
| Web app                      | "Fuse Riders", app ID `1:867594018708:web:4444ada96e29685f063981`                                                                                                  |
| Sign-in providers            | **Google only**, enabled 2026-09-17. Email/password, anonymous and phone are disabled                                                                              |
| Authorized domains           | `localhost`, `andeplane.github.io`, and the two popup-handler hosts `andershaf-87.firebaseapp.com` and `fuse-riders.web.app`                                       |
| Hosting site                 | `fuse-riders` → `https://fuse-riders.web.app`. Nothing is deployed to it; it exists so the sign-in handler has a name players recognise (below)                    |
| Email enumeration protection | on                                                                                                                                                                 |
| Web API key                  | "Fuse Riders web (Firebase Auth only)", key ID `06d6ec38-6348-4b7b-865d-1ea58a9b7d91`                                                                              |
| Key: API restriction         | `identitytoolkit.googleapis.com` and `securetoken.googleapis.com` only                                                                                             |
| Key: referrer restriction    | `https://andeplane.github.io/*`, `https://fuse-riders.web.app/*`, `https://andershaf-87.firebaseapp.com/*`, `localhost`, `localhost:*`, `127.0.0.1`, `127.0.0.1:*` |
| Firestore rules              | deny-all, released to the `fuse-riders` database ([`firebase.json`](firebase.json))                                                                                |
| Firestore indexes and TTL    | [`firestore.indexes.json`](firestore.indexes.json), deployed with the rules                                                                                        |
| Firestore delete protection  | enabled on `fuse-riders`, because it will hold history that no TTL cleans up                                                                                       |

The `(default)` database in this project is Datastore-mode and unrelated; security rules do not apply to it.

The client config lives in [`src/shared/firebase-config.ts`](src/shared/firebase-config.ts). **None of it is secret** —
a Firebase web API key only identifies the project, and the restrictions above are what protect it. Reprint it with
`firebase apps:sdkconfig WEB 1:867594018708:web:4444ada96e29685f063981`.

```ts
const firebaseConfig = {
  apiKey: "AIzaSyDmK4ZmjGHZl4ImAoEAFLbQ5Vp1wkc0Wyk",
  authDomain: "andershaf-87.firebaseapp.com",
  projectId: "andershaf-87",
  appId: "1:867594018708:web:4444ada96e29685f063981",
};
```

### The Google provider

Enabled by hand in the console, because it needs an OAuth client that the console creates in one click and no CLI
can: [Authentication → Sign-in method](https://console.firebase.google.com/project/andershaf-87/authentication/providers)
→ **Google**. Leave every other provider off. The
[OAuth client](https://console.cloud.google.com/apis/credentials?project=andershaf-87) it created should list only
the authorized domains above as JavaScript origins.

### The name on Google's sign-in screen

Google's screen says "to continue to _&lt;authDomain&gt;_" — the host serving Firebase's `/__/auth/handler`. The default,
`andershaf-87.firebaseapp.com`, names the owner's project rather than the game. Every Hosting site in the project
serves that handler with nothing deployed, so the `fuse-riders` site gives it a better name for free:
`fuse-riders.web.app`. It is already an authorized domain and an allowed key referrer.

Switching is two steps, **in this order** — the second breaks sign-in with `redirect_uri_mismatch` without the first:

1. In the [OAuth client](https://console.cloud.google.com/apis/credentials?project=andershaf-87) ("Web client (auto
   created by Google Service)"), add `https://fuse-riders.web.app/__/auth/handler` to **Authorized redirect URIs** and
   `https://fuse-riders.web.app` to **Authorized JavaScript origins**. Console only; there is no API for it.
2. Set `authDomain: 'fuse-riders.web.app'` in [`firebase-config.ts`](src/shared/firebase-config.ts).

Whether step 1 has taken can be checked without signing in. Google redirects a registered URI to
`…/signin/identifier` and an unregistered one to `…/signin/oauth/error`:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&scope=openid&client_id=$(curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: andershaf-87" https://identitytoolkit.googleapis.com/admin/v2/projects/andershaf-87/defaultSupportedIdpConfigs/google.com | python3 -c 'import json,sys;print(json.load(sys.stdin)["clientId"])')&redirect_uri=https://fuse-riders.web.app/__/auth/handler"
```

To show "Fuse Riders" instead of any domain, the OAuth consent screen's app has to go through Google's brand
verification, which needs a domain the owner can prove they control. A custom domain would also replace both this and
the shared `andeplane.github.io` origin noted in the review.

### Changing the configuration

```bash
firebase deploy --only firestore --project andershaf-87
```

deploys the rules, indexes and TTL policies. **`--only firestore:rules` is a silent no-op** with a named-database `firebase.json`: it prints
"Deploy complete" and releases nothing. Confirm a release with:

```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: andershaf-87" https://firebaserules.googleapis.com/v1/projects/andershaf-87/releases
```

Rules are not deployed by CI; the deployer service account has no Firebase roles, deliberately. Auth settings live at
`https://identitytoolkit.googleapis.com/admin/v2/projects/andershaf-87/config` (PATCH with an `updateMask`), and the key
is managed with `gcloud services api-keys update 06d6ec38-6348-4b7b-865d-1ea58a9b7d91 --project andershaf-87`. Always
pass the project explicitly; a developer machine's default gcloud project is usually something else. Two things about
that key bite:

- **A referrer pattern with a scheme does not match a port.** `http://localhost:*/*` is accepted and then blocks
  `http://localhost:8787/`; the forms that work are `localhost` and `localhost:*`. An update replaces the whole
  restriction, so pass every referrer and both `--api-target`s each time. Changes take a minute or so to apply.
- **Probing a restricted API makes the next update fail** with `APIKEYS_RESTRICTION_INCOMPATIBLE_WITH_USAGE`: the
  refused Firestore probe in the review below counts as "usage" for seven days. `--no-check-existing-usage` overrides
  it, which is safe when the only such usage is a probe you made.

To check what a browser on a given page may do with the key, without signing in:

```bash
curl -s -X POST -H 'Referer: http://localhost:8787/' -H 'Content-Type: application/json' -d '{"providerId":"google.com","continueUri":"http://localhost:8787/"}' "https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=$(grep -o "AIza[A-Za-z0-9_-]*" src/shared/firebase-config.ts)"
```

An `authUri` on `accounts.google.com` means a sign-in can start from that page; `Requests from referer … are blocked`
means the key refuses it.

### Security review (2026-09-17)

The Firebase configuration, verified from outside with the public web key:

| Probe                                                                                                                    | Result                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Auth API with a foreign or missing `Referer`, including look-alikes (`localhost.evil.example`, `evil.example/localhost`) | `403` — referrer restriction holds                                                     |
| Starting a Google sign-in from `andeplane.github.io`, the `firebaseapp.com` handler, `localhost:8787`, `127.0.0.1:3030`  | allowed                                                                                |
| Anonymous sign-up from an allowed referrer                                                                               | `400 ADMIN_ONLY_OPERATION`                                                             |
| Email/password sign-up from an allowed referrer                                                                          | `400 OPERATION_NOT_ALLOWED`                                                            |
| Firestore REST read of the rooms collection with the web key                                                             | `403` — the key cannot reach Firestore at all, and the rules would deny it if it could |

Findings and accepted risks:

- **Referrer restrictions are not authentication.** `Referer` is trivially forged outside a browser, so the restriction
  stops other sites from borrowing the key, not a script. What a forged request can reach is Google sign-in only, which
  still requires a real Google account. That is the intended exposure.
- **Anyone with a Google account can create a user.** That is what public login means. Accounts carry no privileges;
  everything a user can do is decided by the gateway. If abuse appears, add App Check or a blocking function rather
  than loosening anything here.
- **`andeplane.github.io` is a shared origin** for every Pages site under that GitHub account. Any of them could start a
  sign-in against this project and receive that user's ID token. Acceptable while the account is single-owner; moving
  the game to a custom domain removes it.
- **Three older API keys in the project are completely unrestricted** ("API key 3", and the 2018 auto-created "Server
  key" and "Browser key"). They predate this work and nothing in this repository uses them, but an unrestricted key in a
  project with Auth enabled can call the Auth API with no referrer check. They were left alone because something
  outside this repository may depend on them: check their usage under APIs & Services → Credentials, then restrict or
  delete them.
- **No point-in-time recovery or scheduled backups** on `fuse-riders` (both cost money). Delete protection stops the
  database being dropped, not a bad write. Revisit once history is worth more than the backup bill.
- **MFA is off**, which is right for a game whose only factor is a Google account that carries its own.

How the implementation holds the line:

- **Tokens.** [`identity.ts`](src/service/identity.ts) pins `RS256` and requires
  `iss == https://securetoken.google.com/andershaf-87`, `aud == andershaf-87`, an unexpired `exp`, a past `auth_time`,
  a `sub` that is a safe document id, and `firebase.sign_in_provider == 'google.com'`. Every failure — including Google's
  keys being unreachable — yields a guest, never an error that blocks play and never an accepted token. Revocation is
  not checked, so a token stays good for its hour; nothing here is worth more than that.
- **Accounts come only from the verified header.** The body schema refuses unknown fields, so no request can name a
  `uid`. An account binds to the seat the sender's own room token proves, one account per seat and one seat per
  account per match. History responses show which seat was the caller's and never anyone else's account id.
- **Credentials stay in headers**, to the gateway origin only: never a URL, an invite, a WebRTC message, a log line or
  a Mixpanel property. The gateway logs an error's name and code, nothing from the request. Authenticated responses
  are `no-store`.
- **Stored data is re-validated on the way out** as well as on the way in, and the account dialog writes everything
  with `textContent`; a colour is applied only if it is `#rrggbb`.
- **Minimum data.** `uid`, rider name, avatar, stats, room code. No email, Google name or photo leaves the browser.

An independent review of the implementation (2026-09-17) found no way to credit another account, read another
player's history, or have a failed verification accepted. What it did find, and what was done:

| Finding                                                                                                                                                                              | Resolution                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **High.** Room tokens are free to mint, so the per-rider limit could not stop one signed-in attacker creating unlimited permanent records, each adding up to 10⁹ to their own totals | Linking is limited per account (30/hour) and reporting per address (240/hour); past the account limit a report is a guest's and its record expires. Stats are bounded to what a match could plausibly produce (per-round counts by the match length, placement by the rider count, the rest by generous ceilings) |
| **Medium.** The report included the room's _live_ `mode`, which the host can change while the recap is up, so a late device could hash a different result                            | Room settings are no longer part of the result                                                                                                                                                                                                                                                                    |
| **Medium.** Riders who quit mid-match counted towards the majority but can never report                                                                                              | The majority is of human finishers frozen at the match-ending simulation tick, independently of elimination stats                                                                                                                                                                                                 |
| **Medium.** One attempt, while every rider writes the same record at once                                                                                                            | Jittered retries on 5xx/408/429/network, and when a signed-in report went in unlinked                                                                                                                                                                                                                             |
| **Low.** A sign-in was verified and the body read before the room token was checked; no body timeout                                                                                 | Room token, membership and limits first; 10-second body timeout                                                                                                                                                                                                                                                   |
| **Low.** A tap on SIGN IN WITH GOOGLE while the SDK was still downloading could be popup-blocked (Safari)                                                                            | The button is disabled until the SDK is ready                                                                                                                                                                                                                                                                     |
| **Low.** Names with a lone surrogate or untrimmed; a `uid` shaped like Firestore's reserved `__x__`; paging that differed between the two storage backends                           | All refused or aligned, with tests                                                                                                                                                                                                                                                                                |

Accepted, not fixed:

- **A lone rider's report is believed.** One human with bots confirms alone, so a modified client can forge its own
  match and inflate its _own_ totals within the bounds above. It cannot touch anyone else's. Do not build a public
  leaderboard on `totals` without first requiring, say, two attesting humans; `attesters` is stored for that.
- **A whole room colluding can forge a result** for themselves. Re-simulating the input log server-side is the fix and
  is out of proportion for a game among friends.
- **The index and TTL policies name the `fuse-production` prefix.** A gateway run with another `ROOM_COLLECTION_PREFIX`
  needs its own entries in `firestore.indexes.json`, or `/api/me/matches` fails and its pending records never expire.
- **A browser that remembers a sign-in downloads the SDK when its first recap opens** (to fetch a token). Guarded, so
  it cannot disturb the recap; it costs a signed-in player ~47 kB once per page load.
- **A request with no `Origin` header skips the origin check**, as on every other route. Origin checks stop other
  websites, not scripts; the credentials are what authenticate.

Repository: [andeplane/fuse-riders](https://github.com/andeplane/fuse-riders). Contributions should use coherent atomic commits with relevant checks, documented evidence, and explicit limitations.

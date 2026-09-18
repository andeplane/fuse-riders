# Online Fuse Riders

> Historical plan, not the current decision: see [ROADMAP.md](ROADMAP.md), proposed ADRs 028–032 and the independent reviews. The browser-hosted implementation remains a prototype with release blockers. This document preserves the original server-based proposal and baseline measurements; its implementation sequence and promises of host-independent continuation do not describe the selected proposal.

Plan dated 2026-09-14. Public deployment is not implemented by this document. Keep the existing LAN game usable while implementing in separate atomic changes.

## Recommendation

Keep the existing authoritative TypeScript/Node server and WebSockets for the first online version. Add a room registry, combined play/controller UI, local input prediction, and incremental world updates. Start with one always-on instance in a region near the players, HTTPS/WSS, no database and no Redis. A single service can serve the built assets and WebSockets.

A 1 vCPU / 1 GB instance is a starting benchmark candidate, not a proven capacity claim. Use Render for straightforward managed deployment or Fly.io if regional placement is the priority. Avoid sleeping services for active rooms. Set conservative room limits after testing the actual instance. Do not horizontally scale the in-memory registry behind random routing: every socket for a room must reach its owner process. Later introduce room-to-instance routing before adding replicas.

WebRTC is not a backend-free replacement: it requires signalling and frequently TURN relays. Phone hosting also introduces background suspension, battery, migration and host advantage. Do not rewrite transport first. Consider an optional unordered, time-limited WebRTC input lane only if measured WebSocket head-of-line blocking remains unacceptable after bandwidth/prediction changes. Retain WSS for reliable commands, joining and reconnecting. A separate WebRTC transport prototype must prove benefits on Safari, Android, TURN-only and blocked-UDP connections before adoption.

Sources: https://render.com/docs/websocket ; https://render.com/docs/web-services ; https://webrtc.org/getting-started/peer-connections ; https://webrtc.org/getting-started/turn-server ; https://fly.io/docs/about/pricing/ . Provider prices and instance capacity must be checked at deployment time.

## Product flow

1. Home: Create room or Join room. No account required initially.
2. Creator chooses “Shared screen” or “Everyone on their device”. Ask explicitly; do not infer physical proximity from IP addresses.
3. Choose name/avatar, configure rules, create room. Creator has a player seat plus host permissions, including on a phone.
4. Show a short room code, share link and QR. Host can start, reset, change rules and invite a separate display without leaving their player screen.
5. Shared screen: TV renders the arena; phones show colored controls. Pair a TV by a short-lived display code/link. The display role does not grant game-management rights.
6. Individual devices: each phone renders the full board plus controls, preferably landscape; keep the whole arena visible and highlight the player's head/trail. Tablet/desktop work too. Offer full view to any player even in a shared-screen room.
7. Late arrivals join as spectators/waiting players and enter next round. Preserve existing five-player capacity initially; display-only viewers do not consume seats, but have a separate cap.
8. End of final round: show frozen arena and winner for three seconds before the recap. The earlier quick fix implements this independently.

Mode affects presentation, not simulation. A host is an administrator, not the simulation server. Host phone disconnection must not stop everyone else's game.

## Rooms and settings

Extract current single-game state into RoomSession: game, seats, tokens, input buffers, connections, settings revision, clock, expiry, and metrics. RoomRegistry maps unguessable room IDs to sessions; a human code maps to a room but grants no host privilege. Inject clock, scheduler, randomness, token generator and transport for deterministic tests.

Roles: player, display/spectator, host capability. A connection may be both host and player. Validate every command against room membership and capability, not the current screen URL. Test cross-room token use, stale commands and display privilege escalation. Limit room creation, joins, sockets, packet size and action rates. Never broadcast host/resume secrets.

Versioned RoomPreferences include:

- presentation mode;
- match format: first to N wins OR fixed N rounds, named separately so “number of games” is unambiguous;
- enabled powerups and nonnegative relative spawn weights;
- drop interval/pacing preset; optional advanced arena settings later.

Render normalized percentages live; enabled weights sum to 100%. Zero total means no random pickups, not a broken sampler. Star was first off by default; since rules `fuse-p2p-39` it ships enabled at weight 160 like the other specials. Validate finite numbers and bounds server-side. Freeze a rules revision for a running round; pending changes apply next round, while match-format changes apply next match.

Store defaults under a versioned localStorage key in the host's browser. On create, send these preferences to the server; server validates and broadcasts the accepted revision. Host reconnect retrieves active settings from the server rather than overwriting them with stale local defaults. Handle corrupt/missing storage and schema migrations. localStorage is device/browser-specific; cloud synchronization is outside initial scope.

Store scoped player/host reconnect capabilities separately from preferences. Joining links contain only the room code; private host capability is never in a share link. Expire empty rooms after a documented grace period (initial proposal: 10 minutes). Keep host recovery for 60 seconds, then permit an explicit transfer to an existing player. Database-free first version loses live rooms on process failure. Graceful deployments drain active rooms; crash continuity requires a later checkpoint store.

## Movement and poor networks

Goal: the local player's movement reacts immediately, without a network round trip. Do not accept arbitrary client coordinates as truth: clients can disagree about crossing trails, simultaneous deaths, shields and explosions.

Use shared pure movement code on client and server. Client runs a fixed simulation step and renders at display refresh rate. Inputs carry a monotonic sequence, intended simulation tick and connection epoch. Keep recent unacknowledged inputs. On authoritative state for an acknowledged tick, restore that state and replay later inputs. Blend small visual corrections; explicitly snap on death, portal transit or large divergence. Predict steering, charging and target reticle locally. Server confirms collisions, pickups and scoring. A confirmed death cannot be undone by later cosmetic interpolation.

This provides immediate response but cannot promise that local prediction is always correct. During serious delay, other players' new trails and actions are unknown. Favor bounded prediction and explicit reconnection over silently granting invulnerability or allowing divergent rounds. Initially avoid retrospective changes to already confirmed deaths. Evaluate a small bounded input grace window only with crossing-trail fairness tests; document the fairness/latency tradeoff.

Remote players use a short adaptive interpolation buffer based on jitter. Extrapolate only briefly, then freeze/show connection degradation. Track snapshot age and input acknowledgement age separately. On recovery, discard stale movement states, fetch a fresh baseline, replay only valid unacknowledged commands and deduplicate fire/release by action ID. Expired fire actions must not execute as a burst after reconnect.

For a shared TV, local prediction on a controller does not remove phone-to-TV network delay. The TV can predict from inputs it has received, but cloud routing still costs travel time. Measure phone gesture-to-TV-frame independently. If regional WSS cannot meet the shared-TV target, evaluate a direct LAN/WebRTC control lane to the display, reconciled with the same server authority. Keep the current LAN server option for local parties until this is proven.

Disconnection policy: neutralize stale held controls, show reconnect status, reserve the seat briefly, resume with the same token; do not automatically pause every room because one client is flaky. Test exact timeout behavior and make it visible. Guaranteed uninterrupted play through a disconnected network is impossible.

## Bandwidth first

Current server serializes full arena state at 20 Hz for a display; compact phone controllers get 10 Hz and omit trails/projectiles. Individual-device play cannot simply give five phones the existing TV feed.

Introduce a protocol version, snapshot/baseline IDs and incremental updates:

- stable IDs for trail segments; append, trim, remove and split operations;
- head/projectile transforms at an independently tunable rate;
- reliable spawn/despawn, pickup, explosion and phase events;
- periodic keyframes and explicit resync when a baseline is missing;
- bounded outgoing queues: replace stale unsent state, never silently discard mandatory events;
- benchmark compact/binary representation after delta updates; compression alone is not the plan.

Do not send private controller or host data to spectators. Scope every event by room, match and round. Check clipping, gun holes, portals and explosion removals against reconstructed client trail state.

## Benchmarks already run

Reproduce: `npx tsx scripts/benchmark-online.ts`. Results: `baseline.json`.

Local Apple Silicon / Node 22, five invulnerable circling riders; 600 sampled ticks after warmup. Step plus full snapshot serialization p95 was 0.60 ms with no shells, 0.68 ms with five shells and 0.97 ms with twenty shells. This excludes network fanout and browser rendering; it is not a cloud capacity test.

Full snapshot averaged 108–114 KB, implying 17.3–18.2 Mbps per full view at 20 Hz before wire overhead. Five remote full views would be roughly 87–91 Mbps. Delta updates are a launch prerequisite.

Five real loopback WebSocket clients with ordered injected delays; approximately 495 inputs/profile over five seconds:

| Profile          | One-way delay and jitter | Added HOL stalls                      | Input-to-ack p50 / p95 |
| ---------------- | ------------------------ | ------------------------------------- | ---------------------- |
| LAN              | 5 ± 2 ms                 | none                                  | 37 / 58 ms             |
| Regional         | 40 ± 10 ms               | none                                  | 116 / 134 ms           |
| Poor Wi-Fi model | 75 ± 30 ms               | 3% of scheduled deliveries add 200 ms | 178 / 304 ms           |
| Very poor model  | 150 ± 75 ms              | 5% add 200 ms                         | 339 / 507 ms           |

This is application-level latency/HOL injection, not real packet-loss, throughput shaping, visual latency or mobile measurements. Acknowledgements are cumulative/latest-sequence and may coalesce inputs; fewer ACK samples are not evidence of packet loss. Short-run p99 figures are exploratory. No claims yet that poor-network gameplay passes.

## Acceptance benchmarks during implementation

Commit reproducible harnesses and machine-readable reports. Use injected clocks/transports for correctness; use browser/device tests and a Linux network proxy/netem for actual TCP retransmission and bandwidth shaping. Never drop arbitrary WebSocket messages and call that TCP packet loss.

Matrix: 0/40/80/150/300 ms RTT; jitter 0/20/50/100 ms; real packet loss 0/1/3/5%; 0.5/2/10 Mbps downlinks; asymmetric uplinks; 1/3/10-second outages; background/resume; reconnect after server restart. Run seeded crossing trails, simultaneous shots, shell swarms, target release, shrinking arena and portal transits. Include two clients with sharply different latency.

Provisional gates, to be validated on selected devices and cloud hardware:

- local gesture to predicted frame p95 <= 33 ms at 60 Hz, independent of RTT;
- full-view bandwidth <= 0.5 Mbps average and <= 1 Mbps p95 over 1-second windows in five-player stress rounds;
- visible local corrections p95 <= one rider radius at 80 ms RTT; track count, magnitude and collision disagreements, not just averages;
- 60 FPS target on chosen iPhone/Android devices, p95 frame time <= 20 ms; identify any supported 30 FPS fallback explicitly;
- shared-TV gesture-to-frame p95 <= 100 ms on a nearby region; measure separately from ACK timing;
- server loop p99 < 25 ms under declared capacity, no skipped simulation time or unbounded queues;
- zero duplicate shots, cross-room state leaks, invalid scores or divergent confirmed deaths;
- reconnect within two seconds after connectivity returns for a three-second outage, no stuck controls or delayed fire burst;
- 10/25/50 room load ramps on the actual host, plus a 30-minute soak at the selected safe capacity; report memory, CPU, event-loop delay, tick time and egress.

Severe-network profiles are correctness/degradation gates, not a promise of competitive smoothness. Save trace/replay artifacts for every divergence. Browser timing measures input dispatch to frame; physical touch/display latency still requires device measurement.

## Implementation sequence

1. Baseline (this plan): instrument existing game, measure latency/bandwidth, retain three-second final-round pause fix.
2. RoomSession/registry plus role/capability protocol; preserve one-room LAN behavior; room isolation and reconnect tests.
3. Versioned host preferences, normalized probability editor, lobby and room codes/QR, next-round rule revisions.
4. Unified phone play screen and host controls; display pairing; device layout/performance checks.
5. Incremental trail/state protocol with resync; prove bandwidth reduction and reconstruction correctness.
6. Local prediction/reconciliation, remote interpolation, stale-input handling, action deduplication; fairness and adverse-network suite.
7. Container, HTTPS/WSS deployment configuration, health/readiness, metrics and room drain; stage on a small always-on server, run capacity/soak benchmarks there.
8. Online playtest on independent Wi-Fi/mobile networks; only then publish the production URL and capacity limit. Evaluate WebRTC fast lane only if measured goals still fail.

Each step gets atomic commits and CI. CI keeps unit/type/build/browser checks and deterministic networking tests; cloud/device performance results are separate evidence. No database until live-room crash recovery, accounts or persistent history justify one.

# Fuse Riders architecture

This is the system map for the source tree. Module definitions and tests are authoritative for rules, limits and wire fields; release records describe what was deployed. The [architecture epic #259](https://github.com/andeplane/fuse-riders/issues/259) and [refactor plan #252](https://github.com/andeplane/fuse-riders/pull/252) describe proposed changes, not completed features.

## Two play paths, one simulation core

```text
LAN:     phone /controller -> WebSocket -> Node simulation -> TV /display

Online:  browser replica <------ WebRTC mesh ------> browser replica
                  \                                 /
                   room service: membership + signalling
                        Firestore metadata / Pub/Sub routing
```

LAN authority lives in `src/server/`: one process accepts validated controller intents, advances the game and publishes snapshots and events. Online authority is the shared input log: every device simulates the same deterministic rules locally, and late inputs trigger rollback. The creator supplies initial clock and management authority; the runtime also supports delegated management and peer snapshot recovery. The service never simulates or relays gameplay.

LAN remains supported. It currently shares the simulation with online, but not the complete tick driver: LAN calls `step` directly, while online calls `applyTick`. Optional `GameState.settings` and their fallbacks still produce differences between modes. Unifying these drivers and defaults is work in [#253](https://github.com/andeplane/fuse-riders/issues/253), not an existing guarantee.

## Source ownership

| Location                                                                              | Owns                                                                                           |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/shared/game.ts`                                                                  | Plain game state, lifecycle commands, seeded rules, tick execution and snapshot projection     |
| `src/shared/rider-motion.ts`, geometry and weapon helpers                             | Pure turn-then-move motion, swept contacts, launch and hazard calculations                     |
| `src/shared/input-log.ts`, `apply-tick.ts`                                            | Validated log entries, management ordering, held controls, bots and deterministic tick folding |
| `src/shared/match-stats.ts`, `shot-log.ts`, `moments.ts`, `leaderboard.ts`            | Match facts, shot outcomes, highlights and session scoring                                     |
| `src/server/`                                                                         | LAN HTTP/WebSocket authority, input buffering, seats and scheduling                            |
| `src/online/room-runtime.ts`                                                          | Online membership coordination, world lifecycle, clocks, input delivery and frame publication  |
| `src/online/stream.ts`, `rollback.ts`                                                 | Bounded stream history, completeness, repair and rollback                                      |
| `src/online/packet.ts`, `snapshot.ts`, `checkpoint.ts`                                | Packet decoding, chunked world transfer and runtime validation before installation             |
| `src/client/`                                                                         | Phaser rendering, themes, audio, display/controller UI and controls                            |
| `src/online/ui.ts` and adjacent UI modules                                            | Online and solo app composition, menus, replay, layouts and diagnostics                        |
| `packages/fuse-network-fe/`                                                           | Game-agnostic WebRTC mesh, room API/socket client, link health, ICE recovery and diagnostics   |
| `packages/fuse-network-be/`                                                           | Game-agnostic room admission, metadata, signalling gateway and backend adapters                |
| `packages/fuse-network-protocol/`                                                     | Shared networking wire contract and authority validation                                       |
| `src/service/`                                                                        | Game entry points and optional account/history routes composed with the networking service     |
| `src/service/history*.ts`, `firestore-history.ts`, `memory-history.ts`, `identity.ts` | Completed-match history, storage adapters and account identity verification                    |

Networking packages must not import `src/`. The game composes them through `RoomTransport` and related interfaces. The renderer currently still imports game rules and the view type still lives in `src/client/snapshot-stream.ts`; the desired `engine/view` boundary is not yet enforced. See [#254](https://github.com/andeplane/fuse-riders/issues/254).

The target is `engine` (pure rules), `net` (simulation coordination), `render` (engine view contract only), and `app` (composition). Renaming folders alone does not establish this boundary. The engine pipeline, registries, view projection and shared UI are staged work in #253–#255; these directories and a `PHASES` contract should only be documented as current once implemented.

## Online data flow and recovery

1. The browser creates or joins a short-code room through the room service. A member token identifies its seat; the creator capability authorizes room termination. Public room codes are rendezvous identifiers, not secrets.
2. The service admits members, publishes roster changes and forwards validated SDP/ICE signalling. WebRTC carries reliable control/snapshot messages and unreliable per-tick input packets directly between peers. There is no gameplay relay or TURN fallback.
3. Each member records its own ordered input stream. `applyTick` applies permitted management entries, folds player inputs and bot inputs, then executes the simulation and round progression. Generation and sequence identify reconnects and ordering; a successful send does not prove application by another replica.
4. `StreamLog` tracks retained entries, gaps and completeness. The runtime requests missing entries or rotates retained data. `World` retains rollback state and replays late inputs within its bounded history.
5. A joiner or refreshed device obtains a world snapshot from a peer. Packet, snapshot and checkpoint boundaries validate runtime data; installation rejects invalid state before replacing a healthy world. Live simulation checkpoints are not persisted locally or in Firestore; optional completed-match history is separate from peer world recovery.
6. Presentation consumes snapshots, predicted/interpolated positions and scoped events. It never supplies authoritative collisions, pickups, scores or results.

Direct-link failure must surface an explicit retry state. A partial mesh and browser timer throttling remain tracked risks in [#258](https://github.com/andeplane/fuse-riders/issues/258); general mesh tests are not proof of every phone or network condition. Protocol details and security boundaries are in [PROTOCOL.md](online/PROTOCOL.md).

The service renews room lifetime on any member's admission or valid heartbeat, so a remaining connected rider keeps the room alive after creator departure. A current member's departure starts a 90-second reconnect grace. The creator retains its identity and explicit-end capability; guest renewal does not renew the creator authority grant. Returning devices recover the live world from a peer. Room incarnation and connection fencing reject old callbacks for reused codes or replacement sockets. See the [lifetime design](design/member-kept-room-lifetime.md); partition elections and browser suspension remain separate #258 risks.

## Simulation and time

Simulation state uses ticks; clocks schedule work and rendering samples presentation time. The current online clock changes pace when only bots survive, using `simulationTimeScale` and runtime pacing logic. Moving this acceleration into deterministic shared tick execution is proposed in #258. Do not describe the clock as fixed-rate across every current mode.

`src/shared/rider-motion.ts` applies steering before movement at a fixed simulation step. Bots emit ordinary inputs through `BotController`; they do not receive special collision or movement rules. Seeded RNG and pinned deterministic trigonometry live in shared modules. Room settings, pickup definitions and game constants are the sources for balance; this guide intentionally does not duplicate numeric balance tables.

The current `step` in [game.ts](../src/shared/game.ts) performs these broad stages:

1. Advance the tick, expire transient fields/blasts and transition countdown. Return early outside play.
2. Age and clip trails, fit portals to the shrinking field, and attempt scheduled pickup spawning.
3. Compute candidate rider motion, collect pickups, advance projectiles and resolve due explosions.
4. Determine swept hazards, resolve defences and portal transit, then commit deaths, positions and trail segments.
5. Apply weapon inputs using committed positions; resolve instant gun effects in a second pass, including a second death path.
6. Record moment observations, resolve the round and project a snapshot.

This is a summary of the current function, not a new phase API. #253 will introduce an explicit `TickContext` and ordered `PHASES`, consolidate death/fact handling and remove snapshots discarded by rollback. Until then, inspect `step` and its focused tests before changing ordering. Simultaneity, deterministic tie-breaking and the agreement between applied ticks and snapshots must survive the refactor.

`RULES` in [apply-tick.ts](../src/shared/apply-tick.ts) identifies compatible simulation rules. A rules change requires a version change; a source refactor should preserve behavior. Existing cross-engine replay is useful evidence but is not yet a complete golden regression covering every pickup and defence.

## Rendering and controls

Phaser is externally stepped by the presentation owner. It renders supplied state and cosmetic fractional time; it must not own authoritative physics, timers or a second render loop. LAN uses bounded extrapolation and online uses interpolation/prediction. Both freeze or reset cosmetic history across appropriate scope, phase and discontinuity boundaries. See [PHASER.md](PHASER.md) for lifecycle, timing and recovery contracts.

Input state, pointer ownership and transport delivery are separate. Press, release and cancel edges must survive buffering and ordering; blur, hidden-page transitions, disconnect and teardown must neutralize controls without accidentally firing. The LAN server authenticates host controls and controller seats; snapshots and public invites must not expose those capabilities. Online input streams use room, member generation, tick and sequence ordering; snapshots and emitted events also carry match/round context. Changes must preserve lifecycle boundaries so stale inputs or outcomes cannot affect a new game.

Themes and UI geometry are cosmetic. Keep `/display`, `/controller`, the neon/pixel aesthetic and simulation identity intact while sharing app components. Presentation exceptions must not silently become parser failures or corrupt the simulation loop; the existing callback seams are tracked in #255/#258.

## Service and deployment boundaries

Production runs the room service on Cloud Run with Firestore room metadata and Pub/Sub cross-instance signalling. `src/service/dev.ts` uses in-memory adapters locally and in CI. LAN runs its own Node authority. See the [backend package](../packages/fuse-network-be/README.md), [deployment guide](online/GCP-DEPLOY.md), and [release inventory](online/DEPLOYMENT.md).

Validate admission, signalling and stored records at runtime; bound queues, dedupe maps and recovery. Preserve exact-origin checks, capability authentication, stateless gateways and incarnation fencing. Origin checks are not authentication. The abuse and hosting-cost changes in [#256](https://github.com/andeplane/fuse-riders/issues/256) are pending work, not guarantees made by this map.

## Verification boundaries

[Verification guidance](verification.md) maps unit, browser and release checks to their scope. Tests use typed injected clocks, schedulers, transports and randomness; browser checks exercise the actual presentation and transport seams. Coverage applies only to `.c8rc.json`'s included modules. Neither a passing PR verify job nor desktop browser emulation proves physical-phone or WAN acceptance. Claims about releases require the exact source revision and live external evidence.

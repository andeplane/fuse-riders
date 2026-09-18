# Fuse Riders architecture

This is the system map for the source tree. Module definitions and tests are authoritative for rules, limits and wire fields; release records describe what was deployed. The [architecture epic #259](https://github.com/andeplane/fuse-riders/issues/259) and [refactor plan #252](https://github.com/andeplane/fuse-riders/pull/252) describe proposed changes, not completed features.

## One play path: online rooms

```text
browser replica <------ WebRTC mesh ------> browser replica
         \                                 /
          room service: membership + signalling
               Firestore metadata / Pub/Sub routing
```

Every game is an online room, including solo play (a room with no peers) and a shared screen (a room in shared mode: the TV opens `?room=CODE&display=1` as a display-only member and phones join the same room as controllers). Authority is the shared input log: every device simulates the same deterministic rules locally, and late inputs trigger rollback. The creator supplies initial clock and management authority; the runtime also supports delegated management and peer snapshot recovery. The service never simulates or relays gameplay. `npm run dev` runs the same room protocol over in-memory metadata (`src/service/dev.ts`).

The separate LAN server (`src/server/`, a Node process that simulated the game for a TV at `/display` and phones at `/controller`) was removed in [#271](https://github.com/andeplane/fuse-riders/pull/271); those routes no longer exist.

There is one tick driver. `driveGameTick` (`src/engine/tick-driver.ts`) is a tick of a game: `step`, automatic round progression, the room's settings taken over at the round boundary, charges cleared outside play. `applyTick` is a tick of a room: it applies the tick's management entries, folds every rider's log entries and the bots into inputs, and calls the driver. `GameState.settings` is required, so no rule has a fallback that could differ by who built the state, and the checkpoint boundary refuses a state without them ([engine tick driver](design/engine-tick-driver.md)). The second driver this paragraph used to describe, the LAN server's direct calls to `step`, went with `src/server/` in #271.

## Source ownership

| Location                                                                   | Owns                                                                                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/engine/game.ts`, `state.ts`                                           | Lifecycle commands and `step` (a loop over `PHASES`); plain game state and its ordered readers                      |
| `src/engine/view.ts`, `view-kit.ts`                                        | `WorldView` and `toView`: the contract rendering sees, rule values included as data; the few kernels it may run     |
| `src/engine/sim/`                                                          | `TickContext`, the ordered `PHASES` list and one file per phase: the tick, and the only place rules run during play |
| `src/engine/tuning.ts`, `geometry.ts`, `rng.ts`                            | Balance constants and pure functions of them, plane geometry, the seeded random stream                              |
| `src/engine/rider-motion.ts`, geometry and weapon helpers                  | Pure turn-then-move motion, swept contacts, launch and hazard calculations                                          |
| `src/engine/input-log.ts`, `apply-tick.ts`, `tick-driver.ts`               | Validated log entries, management ordering, held controls, bots; the room's tick and the game's tick it drives      |
| `src/engine/bomb-gesture.ts`, `rider-name.ts`                              | The one bomb-input core the log fold uses; the one rider-name guard, seat normaliser and log bound                  |
| `src/engine/match-stats.ts`, `shot-log.ts`, `moments.ts`, `leaderboard.ts` | Match facts, shot outcomes, highlights and session scoring                                                          |
| `src/online/room-runtime.ts`                                               | Online membership coordination, world lifecycle, clocks, input delivery and frame publication                       |
| `src/online/stream.ts`, `rollback.ts`                                      | Bounded stream history, completeness, repair and rollback                                                           |
| `src/online/packet.ts`, `snapshot.ts`                                      | Packet decoding and chunked world transfer                                                                          |
| `src/engine/codec/checkpoint.ts`                                           | Runtime validation of a game state before installation                                                              |
| `src/render/`                                                              | Phaser scene, presentation time (`time/`), themes and the pure drawing helpers; imports only the engine's view      |
| `src/client/`                                                              | Audio, avatars, controls, replay, announcer and the stored style choice                                             |
| `src/online/ui.ts` and adjacent UI modules                                 | Online and solo app composition, menus, replay, layouts and diagnostics                                             |
| `packages/fuse-network-fe/`                                                | Game-agnostic WebRTC mesh, room API/socket client, link health, ICE recovery and diagnostics                        |
| `packages/fuse-network-be/`                                                | Game-agnostic room admission (one game per room), metadata, signalling gateway and backend adapters                 |
| `packages/fuse-network-protocol/`                                          | Shared networking wire contract, game ids and authority validation                                                  |
| `packages/fuse-platform/`                                                  | Every game's backend: accounts, identity, match history and settlement, Elo, ratings, leaderboards, storage         |
| `src/service/`                                                             | The one deployed service: composes the room service and `fuse-platform` with every registered game                  |
| `src/service/history.ts`                                                   | Fuse Riders' game registration (stats, totals, career, rivals) and the service's `Platform`                         |

Packages (`packages/*`) must not import `src/`. The game composes them through `RoomTransport` and related interfaces. Rendering lives in `src/render/` and imports only `src/engine/view.ts` (types) and `src/engine/view-kit.ts`; the rule values it needs travel as data in the `WorldView`, and netcode no longer imports presentation code. See the [render boundary](design/render-boundary.md).

The target is `engine` (pure rules), `net` (simulation coordination), `render` (engine view contract only), and `app` (composition). Renaming folders alone does not establish this boundary. The engine half of that is in place: the simulation lives in `src/engine/`, imports nothing outside it except wire type names from `src/shared/protocol.ts`, and runs each tick as the ordered `PHASES` list ([engine pipeline](design/engine-pipeline.md)). A layer-boundary test pins every remaining cross-layer import exactly. The render half is too ([render boundary](design/render-boundary.md)). The single tick driver and the effect/pickup/weapon registries (#253 A3, A4) and the app layer with its shared UI (#255) are still staged work.

## Online data flow and recovery

1. The browser creates or joins a short-code room through the room service. A member token identifies its seat; the creator capability authorizes room termination. Public room codes are rendezvous identifiers, not secrets.
2. The service admits members, publishes roster changes and forwards validated SDP/ICE signalling. WebRTC carries reliable control/snapshot messages and unreliable per-tick input packets directly between peers. There is no gameplay relay or TURN fallback.
3. Each member records its own ordered input stream. `applyTick` applies permitted management entries, folds player inputs and bot inputs, then calls `driveGameTick`, which executes the simulation and round progression. Generation and sequence identify reconnects and ordering; a successful send does not prove application by another replica.
4. `StreamLog` tracks retained entries, gaps and completeness. The runtime requests missing entries or rotates retained data. `World` retains rollback state and replays late inputs within its bounded history.
5. A joiner or refreshed device obtains a world snapshot from a peer. Packet, snapshot and checkpoint boundaries validate runtime data; installation rejects invalid state before replacing a healthy world. Live simulation checkpoints are not persisted locally or in Firestore; optional completed-match history is separate from peer world recovery.
6. Presentation consumes snapshots, predicted/interpolated positions and scoped events. It never supplies authoritative collisions, pickups, scores or results.

[ADR 047](adr/047-p2p-input-log-lockstep-rollback.md) records this model in full: packet contents, completeness and the stall rule, rollback bounds, resync triggers, the desync hash, succession, hidden-tab behaviour, the trust model, and a constants table that a test checks against the source.

Direct-link failure must surface an explicit retry state. A partial mesh and browser timer throttling remain tracked risks in [#258](https://github.com/andeplane/fuse-riders/issues/258); general mesh tests are not proof of every phone or network condition. Service protocol details and security boundaries are in [PROTOCOL.md](online/PROTOCOL.md).

The service renews room lifetime on any member's admission or valid heartbeat, so a remaining connected rider keeps the room alive after creator departure. A current member's departure starts a 90-second reconnect grace. The creator retains its identity and explicit-end capability; guest renewal does not renew the creator authority grant. Returning devices recover the live world from a peer. Room incarnation and connection fencing reject old callbacks for reused codes or replacement sockets. See the [lifetime design](design/member-kept-room-lifetime.md); partition elections and browser suspension remain separate #258 risks.

## Simulation and time

Simulation state uses ticks; clocks schedule work and rendering samples presentation time. The online clock has one rate, `TICK_MS` per log tick, in every phase. When only bots survive, the tick driver runs `BOTS_ONLY_STEPS_PER_TICK` simulation steps per log tick, decided by `stepsPerTick` from folded state, so the game runs faster while the clock, the log and the network cadence do not ([ADR 047 §11](adr/047-p2p-input-log-lockstep-rollback.md#11-game-speed-when-only-ai-survive), [design note](design/fixed-clock-game-speed.md)). `RoomState.tick` counts log ticks; `GameState.tick` counts simulation steps.

`src/engine/rider-motion.ts` applies steering before movement at a fixed simulation step. Bots emit ordinary inputs through `BotController`; they do not receive special collision or movement rules. Seeded RNG and pinned deterministic trigonometry live in shared modules. Room settings, pickup definitions and game constants are the sources for balance; this guide intentionally does not duplicate numeric balance tables.

`step` in [game.ts](../src/engine/game.ts) holds no rules. It builds one `TickContext` and walks `PHASES` in [pipeline.ts](../src/engine/sim/pipeline.ts), the single statement of tick order; with no round in play the tick ends after the clock, the expiries and the countdown. In broad strokes:

1. Advance the clock, expire transient fields and blasts, start play when the countdown ends.
2. Age and clip trails, fit the field to the closing walls, attempt a scheduled pickup spawn.
3. Compute every rider's step, collect pickups, fly shells, explode due fuses and their chains.
4. Sweep the steps against projectiles, blasts, walls, scenery, trails and each other; resolve shields and portal transits. Nothing has been committed yet.
5. Commit positions and trails, then the sweep's deaths.
6. Apply weapon inputs against the committed board; resolve guns in the same tick; commit those deaths.
7. `recordFacts` writes match statistics, the shot log and highlight moments from the facts the phases stated; `resolveRound` decides the round.

Every death goes through one `commitDeaths` over `DeathFact`s, and no phase before `recordFacts` reads statistics, so they cannot steer an outcome. `step` returns events only; callers that need the public snapshot call `toView`. The order of `PHASES` is part of the rules: the [engine pipeline note](design/engine-pipeline.md) has the full contract, the orderings it preserves, and the behaviour kept behind a named flag for stage A4. A phase that throws surfaces as a `TickFault` naming the tick and the phase; the state is still left part-way through the tick, as it always was, and recovering from that is tracked separately (#253 C8).

`RULES` in [apply-tick.ts](../src/engine/apply-tick.ts) identifies compatible simulation rules. A rules change requires a version change; a source refactor must preserve behavior, and `tests/golden-hash.test.ts` holds it to that on every tick of a recording that exercises every mechanic ([engine safety net](design/engine-safety-net.md)).

## Rendering and controls

Phaser is externally stepped by the presentation owner. It renders supplied state and cosmetic fractional time; it must not own authoritative physics, timers or a second render loop. The online runtime supplies interpolated and predicted state. Presentation must freeze or reset cosmetic history across appropriate scope, phase and discontinuity boundaries. See [PHASER.md](PHASER.md) for lifecycle, timing and recovery contracts.

Input state, pointer ownership and transport delivery are separate. Press, release and cancel edges must survive buffering and ordering; blur, hidden-page transitions, disconnect and teardown must neutralize controls without accidentally firing. Host capabilities are authenticated by the room service; snapshots and public invites must not expose them. Input streams use room, member generation, tick and sequence ordering; snapshots and emitted events also carry match/round context. Changes must preserve lifecycle boundaries so stale inputs or outcomes cannot affect a new game.

Themes and UI geometry are cosmetic. Keep the shared-screen display and phone controller modes, the neon/pixel aesthetic and simulation identity intact while sharing app components. Presentation exceptions must not silently become parser failures or corrupt the simulation loop; the existing callback seams are tracked in #255/#258.

## Service and deployment boundaries

Production runs the room service on Cloud Run with Firestore room metadata and Pub/Sub cross-instance signalling. `src/service/dev.ts` uses in-memory adapters locally and in CI. See the [backend package](../packages/fuse-network-be/README.md), [deployment guide](online/GCP-DEPLOY.md), and [release inventory](online/DEPLOYMENT.md).

One service and one Firestore database serve every game, keyed by `gameId`. A room serves one game; match records, ratings, leaderboards and the history routes (`/api/games/:gameId/…`) carry the game, and an unknown game is refused. The account is shared across games. Fuse Riders is the legacy game: an absent `gameId` means it, its routes keep their unprefixed URLs, and its rating and totals stay on the user document; other games keep theirs in `${prefix}-ratings`. See [`fuse-platform`](../packages/fuse-platform/README.md) and the [multi-game design](design/multi-game.md).

Validate admission, signalling and stored records at runtime; bound queues, dedupe maps and recovery. Preserve exact-origin checks, capability authentication, stateless gateways and incarnation fencing. Origin checks are not authentication. The abuse and hosting-cost changes in [#256](https://github.com/andeplane/fuse-riders/issues/256) are pending work, not guarantees made by this map.

## Verification boundaries

[Verification guidance](verification.md) maps unit, browser and release checks to their scope. Tests use typed injected clocks, schedulers, transports and randomness; browser checks exercise the actual presentation and transport seams. Coverage applies only to `.c8rc.json`'s included modules. Neither a passing PR verify job nor desktop browser emulation proves physical-phone or WAN acceptance. Claims about releases require the exact source revision and live external evidence.

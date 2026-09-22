# ADR-049: Headless Fuse Birds library and room adapters

- Status: Implemented and independently reviewed in PR #407
- Date: 2026-09-22
- Related: [Phase 1 contract](052-fuse-birds-phase-one.md), [physics](048-fuse-birds-physics.md), [levels](050-fuse-birds-level-generation.md), [rendering](051-fuse-birds-rendering.md)

## Decision

The complete game is a caller-driven TypeScript library. `fuse-birds-game` exports only `games/fuse-birds/src/engine/index.ts` by default. It imports no DOM, Phaser, room code, service, storage, timers or other packages. A Node caller can run multiple independent matches, record actions and resume validated checkpoints without initializing a browser. The game remains turn based while projectiles and bodies advance at a fixed physics cadence.

| Location                            | Ownership                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/engine/`                       | Rules, state, seeded randomness, generation, collision, turns, inventory, outcomes, serialization and hashes |
| `src/engine/view.ts`, `view-kit.ts` | Copied presentation data, bounded pure trajectory projection and shared launch quantization                  |
| `src/online/`                       | `RollbackGame` adapter, management fold, authorization, room checkpoints and runtime                         |
| `src/render/`                       | Phaser scene and material composition; imports only engine view contracts                                    |
| `src/app/`                          | Menus, HUD, camera gestures, sound and browser lifecycle                                                     |
| `src/platform.ts`                   | Game-specific registration, exported as `fuse-birds-game/platform`                                           |

Reuse the existing netcode, WebRTC rooms, shared UI and platform. There is no simulation server or new relay. Packages cannot import a game; this game cannot import another game or `service/`. The service composes registrations. Production serving remains controlled by `EXTRA_GAME_IDS`; this work does not authorize deployment.

## Public API

| Operation                                         | Contract                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createMatch(id, seed, players, round = 1)`       | Validate configuration and initialize deterministic preparation. Roster order controls turn order; optional stable slots control identity/color. |
| `advance(state, orderedActions = [])`             | Mutate this caller-owned match by one 50 ms log tick and three physics steps; return transient facts. No internal scheduler.                     |
| `getView(state)`                                  | Copy presentation state without sharing mutable terrain/entities.                                                                                |
| `encodeState(state)`                              | Detached plain checkpoint with packed `Uint8Array` terrain.                                                                                      |
| `decodeState(raw)`                                | Validate/rebuild a fresh checkpoint or return `undefined`, without changing healthy state.                                                       |
| `hashState(state)`                                | Canonical hash of all future-affecting state, including generation/crate searches.                                                               |
| `projectShot(view, vector, budget)`               | Pure partial projection through the same kernel, capped at 90 steps.                                                                             |
| `generateTerrain`, `candidateVector`, `traceShot` | Pure terrain/candidate/shot helpers. Live preparation resumes through `advance`, preserving admission checks.                                    |

The exact rules version lives in `engine/types.ts`; checkpoint/replay readers reject incompatible versions. Unlimited Pebble is a rule, while `Player.ammo` stores the finite Scatter count. Views drive HUD counts and results; transient facts only drive bounded effects and sounds. Randomness comes from explicit state; no hidden singleton state, ambient time or renderer acknowledgment affects outcomes.

The [headless CLI](../../scripts/fuse-birds-headless.ts) accepts seed/player count, absolute-tick action logs, checkpoint input/output, a tick limit and optional trace/record output. Its pass/aimed drivers issue ordinary public actions; they are verification tools, not shipped bots. A supplied log suppresses the driver. Checkpoint JSON uses a versioned Base64 storage envelope and verifies its hash before resuming. The engine knows nothing about files/Base64. See the [game README](../../games/fuse-birds/README.md).

## Turn lifecycle and ownership

```text
preparing -> aiming -> flight -> settling -> next aiming turn
                |                  |
                +-- pass/expiry ---+-- sole survivor/draw -> over
preparation failure -> fault
```

Resolution is atomic within `advance`, not a persisted resolving phase or animation callback. Generation and crate-site searches have checkpointed cursors and fixed work quotas. Asset loading cannot decide a turn boundary. Room stage and engine phase are separate. Phase 1 is a single-round match; rematch constructs a fresh match, resets ammo and rotates the first seat using the round number. Best-of-three and bots remain later scope.

The adapter folds management first, authorizes entries against member identity/generation and advances once. The engine checks deadline expiry before actions; an action at the deadline is too late. Actions carry actor, round, turn and increasing ordinal; room entries additionally carry match ID, sequence and tick. Claimed actor IDs never authorize a peer. Retired-generation actions cannot control a new incarnation.

Only the active living bird may launch or pass. Walking and hopping are not legal actions and must be rejected at the engine and network boundaries. Launch requires grounded posture, legal vector, current scope and ammo. A committed Scatter shot decrements once; fragments, duplicate releases and cancelled gestures do not. Selection and cameras stay local. One accepted launch/pass closes input for that turn.

Flight/settling reject new play. Passing airborne still waits for landing/fall damage. Projectiles share a bounded shot expiry. Resolution waits for living birds and all fragments; parachuting crates do not delay it. Zero survivors is a draw, one survivor wins. Deadlines and rising water bound idle games, but do not replace ADR-050's range/escape requirements.

## Damage, destruction and crates

For each physics step:

1. Find contacts against the same pre-destruction terrain/entities. Sort equal-time contacts by stable IDs and aggregate damage/knockback.
2. Apply damage/eliminations, then bounded impulses to survivors.
3. Consume each hit crate once. A living shot owner receives one Scatter refill capped at five; eliminated owners receive nothing. Full inventory still consumes the crate and never suppresses its explosion.
4. Remove crater cells, move bodies/crates, then apply landing/water damage.
5. Decide the result only after remaining projectiles and bird motion resolve.

Crates are public Scatter supplies. Direct or exposed blast contact collects remotely, including during descent; walking over one does not. Fragments cannot collect a crate twice, and a refill cannot alter flying fragments or grant an extra shot. At most three crates exist. Each completed living-player cycle offers a bounded current-terrain site search; failure skips delivery.

Terrain generation uses its own local seeded stream; live wind/supply draws are explicitly ordered in checkpointed `rng` state. Rejected terrain candidates do not consume that live stream. Independent wind/supply streams can be introduced with a rules revision if separately tunable schedules become necessary. No health/shield schema, effects or placeholder weapons ship in Phase 1.

## Recovery and transport

Reuse authority succession, stream repair and peer checkpoints. A disconnected bird's turn still expires through logged ticks; no hidden server runs an empty room. Direct-link failure needs visible retry. Reconnect restores terrain and ammo, never a seed-only fresh world.

The library checks dimensions, finite integer bounds, unique identities/slots, clocks, phase/projectile relationships, ammo, owner references, cursors and terminal result consistency. The adapter validates seats and room/match clocks. Install only a fully validated candidate after transport hash checks; corrupt input leaves healthy state untouched. Render caches and camera preferences never enter checkpoints.

At 1536×768, terrain occupies 147,456 packed bytes. Twelve retained rollback snapshots therefore contain about 1.69 MiB of terrain before other state/clone/codec overhead. Shared MessagePack preflight rejects binary values, so the **online adapter** uses a versioned Base64 envelope. `r1:` encodes byte runs as a 16-bit positive count and byte value; `b1:` contains the raw bitset when runs would be larger. Decoding caps the encoded input and expanded size, rejects zero/overflow/short runs, then invokes the full engine validator. The library keeps its bitset.

The original raw-only online encoding produced roughly 198 KB checkpoints and browser recovery repeatedly retried under load, even though captured packets decoded correctly. The compressed adapter produced roughly 28 KB in the investigated browser room. This reduces transfer/codec work without modifying shared netcode. The room rules ID appends `-snapshot2`, so peers with incompatible envelopes cannot enter one simulation; the headless rules ID is unchanged. Tests cover incompressible fallback, malformed runs and the actual snapshot encoder/assembler/decoder. Transport limits remain 2,000,000 bytes per snapshot and 16,000 per chunk. These observations are not physical-phone latency measurements or proof of all recovery behavior.

Platform registration recognizes this game. Phase 1 adds no career/leaderboard UI or separate account system. Any result submission must use confirmed outcomes, never speculative events.

## Alternatives and verification

A separate turn service duplicates ordering/recovery and hosting; rejected. Importing Riders' engine brings unrelated mechanics; rejected. Authoritative pointer streaming couples camera/UI to simulation; rejected. A separate headless/hot-seat rules path undermines replay guarantees; rejected.

ADR-052 remains the completion contract: public-package complete matches, independent instances, checkpoint continuation, identical per-tick hashes across supported runtimes, action authorization/deduplication, bounded generation, transport recovery and real join/play/result/rematch flows. Focused tests prove only their covered cases. The [evidence note](../reviews/fuse-birds-implementation-progress.md) records remaining work; implementation status here does not declare delivery complete.

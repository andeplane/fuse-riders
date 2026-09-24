# Phase 0: build, connect, mine, research

Status: **implementation proposal for user review; nothing below is implemented**. This is the bounded first milestone of [ENGINE_PLAN.md](ENGINE_PLAN.md), not permission to begin implementation. The wider game remains in [GAMEPLAY.md](GAMEPLAY.md).

## What the player can do

Open Neural Defence from the game menu, choose a small JSON map and start an offline, one-player sandbox with no AI. Construct neurons to extend a connected base, reach Biomass and Insight deposits, watch income accrue, and purchase one useful research upgrade. Time advances continuously during visible play; there are no turns and no automatic solo victory. Normal construction takes time; `?debug` makes construction and research instant while retaining their costs and rules.

This slice proves that the same headless rules can support a readable web game and reproducible tests. It does not yet prove multiplayer balance or that electrical combat is fun. Defer combat, particles, towers, repairs, AI policies, automatic expansion, fog, powerups, map editing, online rooms, career settlement and production deployment. Tower-site metadata may be validated and displayed as a future objective, but cannot construct a tower yet.

## Engine and dependency boundaries

Create `games/neural-defence/` with a public headless engine entrypoint. Keep map validation/geometry, state, commands, economy, jobs, research, observation and state codec/hash in `src/engine/`; app, rendering and the thin room adapter remain outside it. The engine imports no DOM, networking, file system, other game, timer or application module. Do not introduce an ECS, plugin framework or DI container for this slice.

- `loadMap(raw: unknown)` returns a validated canonical definition or structured errors with field paths. `createMatch(map, settings, roster)` returns validated initial state with explicit player/slot assignments. `step(state, commands)` advances exactly one simulation tick. `observe(state)` returns read-only presentation data; encode/decode/hash cover all authority.
- The engine receives explicit immutable map/rules/settings and validated commands. State holds every mutable gameplay decision: tick, scope, ownership, balances, accrual remainders, bounded queues, active jobs, research and command cursors. Helpers may mutate an exclusively owned working state, but stepping cannot mutate caller-owned maps, commands or retained checkpoints.
- Inject side effects at composition boundaries. Reuse `RuntimeDependencies` in [`room-runtime.ts`](../../packages/fuse-netcode/src/room-runtime.ts): `now`, `hidden`, `token`, `generation`, `schedule`, `onVisibilityChange`. Inject the existing transport dependency separately; solo must never construct a transport. Add only a narrow typed `MapRepository` port for async catalog/map loading, with browser-fetch and in-memory fake implementations. No generic service locator.
- Tests use interface-conforming fakes with controllable time, scheduled callbacks, visibility and map-loader outcomes. No `as any`, private-field mutation, global timer/fetch monkeypatches or sleeps. Do not mock the rules being tested. Test pure engine steps directly; use boundary fakes for app/runtime integration.
- No RNG is needed for the authored Phase 0 map. Later randomized rules use explicit seeded state stored in checkpoints; an injected mutable RNG closure must never hide authoritative state from replay.

Reuse the existing `RoomRuntime` solo path and `TickClock` at 50 ms per tick (20 Hz), through a minimal `RollbackGame` adapter in Phase 0. Set `steps = 1`, `maxSteps = 1`; the adapter folds commands into the same engine used headlessly. Rendering consumes views and interpolation only. Do not introduce a second application simulation interval or a temporary local-only rules implementation.

The existing runtime requires two participants when starting/rematching. Add a narrowly scoped optional per-game/settings minimum-participant capability, defaulting to two, and permit zero configured solo bots. Neural Defence offline sandbox selects one; both runtime guards and its authoritative management fold enforce that choice. Existing games retain their defaults. Completing the local adapter now does not include opening online rooms or claiming network qualification.

The current runtime pauses solo time while the page is hidden. Retain this explicit sandbox convenience, show paused/resumed status where appropriate, and test it; visible play never waits for input. Headless runs always advance exactly the requested ticks without sleeping. Online continuous-time and reconnect behavior remain later work.

## Four-player foundations from the first state model

The Phase 0 UI launches one player, but the headless world, commands, codec and economy must already handle four independent players. `createMatch` takes an explicit roster and slot assignments; core fixtures may contain 1–4 players while the sandbox app/adapter enforces exactly one human. Four is the first supported capacity, not a pair of hard-coded sides. Keep capacity in a named validated rules/configuration limit, so extending it later does not require replacing ownership representations.

| Data                  | Required ownership and scope                                                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static map cell       | Terrain/resource/tower-site metadata only; no local-player ownership baked into the JSON                                                                                                                    |
| Runtime cell occupant | A discriminated empty, construction-site or completed-structure value; every occupied variant carries a stable `ownerId` referencing the roster and an entity identity/generation                           |
| Player state          | Keyed by stable player ID: assigned spawn/slot, brain reference, currency balances, construction queue/job, research job/completions and command cursor; no singleton player balance or global upgrade flag |
| Connectivity          | Resolve each player's graph through their own completed structures; adjacent foreign structures never supply connectivity, construction eligibility or mining                                               |
| Deposit economy       | Deposits stay neutral; calculate connected neighboring contributions and fractional remainders separately for every owner, including three or four owners sharing one deposit                               |
| Commands/views        | Actor identity and explicit target ownership checks in the engine; selected/local player belongs to app/view context, never defines world ownership                                                         |

Player ID, spawn slot and display colour are distinct concepts. Do not encode cells as `isMine`/`isEnemy`, and do not assume there is exactly one opponent. Keep player iteration canonical and serialized ownership references validated. Render ownership using a palette keyed by slot plus an independent shape/pattern; changing the viewed player cannot alter simulation state. Future elimination may mark a roster member inactive, but must not renumber surviving IDs or reassign historical statistics.

Four-player headless fixtures are a Phase 0 requirement even though multiplayer UI, networking and combat are deferred. Verify isolated balances/research/queues, foreign-ownership rejection, mining shared by four owners, valid checkpoint round-trips, and simultaneous attempts at the same empty tile. These establish the data model and rule boundaries without pretending the multiplayer game is playable yet.

## Authored map contract

Ship `games/neural-defence/maps/sandbox-12.json`, with a small explicit catalog describing its id, title and filename. The catalog is presentation data; the map file is authoritative input. The app loads the selected file through `MapRepository`, validates before launch, and retains its canonical content/hash for checkpoints. Use Vite-emitted map assets (for example `?url` imports), so built previews fetch real emitted files rather than development-only source paths. The repository adapter owns URLs; the engine sees only parsed input. File paths are never gameplay identity.

The first schema is the existing proposed shape, made concrete:

```ts
type MapFileV1 = {
  schemaVersion: 1;
  id: string;
  width: number;
  height: number;
  layout: "odd-r";
  cells: Array<
    | { terrain: "open"; towerSite?: boolean }
    | { terrain: "blocked" }
    | { terrain: "deposit"; resourceKind: "biomass" | "insight" }
  >;
  spawns: Array<{ slot: number; cellIndex: number }>;
};
```

`cells` is exactly `width * height` entries, ordered by row then column; no sparse holes. Tile index is `row * width + column`. Axial coordinates are `q = column - floor(row / 2)`, `r = row`; six neighbors follow fixed engine directions, never visual proximity. Deposit cells and blockers cannot be occupied. Resource rates belong to versioned rules, not duplicated per deposit. A future editor imports/exports this format and calls the same public validator; no editor-specific second schema.

Initial bounds: each dimension 1–64, at most 4,096 cells, map JSON at most 256 KiB before parsing, id 1–64 lowercase letters/digits/hyphens, and 1–4 unique spawn slots in 0–3 on distinct open non-tower cells. Reject unsupported versions, unknown keys, non-integers, out-of-range references, malformed field combinations and oversized data. Every spawn needs an expansion neighbor and a traversable route to a neighboring cell of each resource kind; every deposit and tower site needs six open neighboring cells. All open cells must belong to one traversable component for this initial map format. Report structural validity separately from map fairness.

The shipped map is 12 × 12, sparse blockers, both resource kinds, four spawn slots, and at least one route of at most three new neurons from each spawn to each resource kind. Solo chooses one spawn; unused spawn cells behave as ordinary open cells. The engine supports four-player headless fixtures from Phase 0; the playable launch accepts exactly one human. Multiplayer play and map fairness assessment are deferred.

Keep `schemaVersion`, Neural Defence `rulesVersion` and checkpoint format version distinct. Canonical map hashing includes all validated gameplay content and ignores JSON whitespace/object-key order. Snapshots include canonical map content, settings and rules identity; decoding must validate everything into a fresh state before installation. A same-id map edit changes its content hash and cannot silently resume an incompatible snapshot. Unsupported versions fail visibly; no speculative migration framework is needed.

## Concrete first economy and research

These are testable starting values, not balanced commitments. Store resources in integer milli-units (1,000 = one displayed unit), with a bank cap of 1,000,000 displayed units per currency and validated safe-integer intermediates.

| Item                       | Phase 0 proposal                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------ |
| Initial state              | One completed brain; 60 Biomass, 0 Insight; no other owned cells                     |
| Brain income               | 1 Biomass/second and 0.5 Insight/second                                              |
| Neuron construction        | 20 Biomass; 120 ticks (6 seconds); one active job per player                         |
| Biomass deposit            | 6 Biomass/second at six connected owned neighbors                                    |
| Insight deposit            | 3 Insight/second at six connected owned neighbors                                    |
| Growth Efficiency research | One tier; 10 Insight; 400 ticks (20 seconds); one research job per player            |
| Research effect            | Neurons started after activation take 80 ticks (4 seconds), still costing 20 Biomass |

Three neurons can reach a deposit using starting Biomass; baseline income prevents a permanent economic dead end after cancellation or poor routing. Insight trickle funds research after 20 seconds without a deposit, while reaching an Insight deposit accelerates it. Deposits never deplete. After the one research completes, Insight may accumulate without a further sink; this deliberate sandbox limit is not a finished economy.

Growth Efficiency makes research observable before combat exists. It is an addition to the proposal, not a replacement for the later Conduction/Insulation combat specialization. It neither occupies that future choice nor changes extraction rate, neuron price, existing-job duration or particle capacity. UI previews the exact before/after duration. No broad research-tree framework is needed: a typed one-tier definition and explicit prerequisites suffice.

For a deposit with maximum integer milli-unit rate `R` per second and `n` eligible neighbors, accrue `R * n` into a per-player/per-deposit remainder each tick; divide by `6 * 20` to obtain whole milli-units and retain the remainder. Brain income uses denominator 20. This preserves fractional income, grants nothing for unowned sides and supports later shared deposits without multiplying total production. A completed, brain-connected brain/neuron counts; queued destinations and construction sites do not. At the bank cap discard excess whole income, retaining only the proper fractional remainder; do not store an overflow payout.

## Commands, jobs and exact tick order

### Actions are a public engine/network contract

Define an exported discriminated union, with no browser callbacks, wall-clock timestamps or arbitrary object payloads. Proposed Phase 0 action bodies are:

| Action                     | Typed payload and purpose                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `enqueueConstruction`      | A bounded ordered list of validated tile IDs; creates queue items with stable IDs derived from the accepted command identity and item index |
| `cancelQueuedConstruction` | A stable queue-item ID, never a shifting list index                                                                                         |
| `cancelConstruction`       | An active job ID/generation; cannot accidentally cancel a replacement job                                                                   |
| `beginResearch`            | A research ID from the versioned supported enum                                                                                             |
| `cancelResearch`           | The active research job ID/generation                                                                                                       |

Keep these bodies separate from a typed command context containing match/round scope, actor ID, current stream generation, sequence and application tick. The adapter derives actor identity from the member stream and logged seat; wire payloads cannot impersonate another actor. Headless test drivers construct the same context and use the same guards/rule application. Administrative start/settings/roster commands remain in existing room management, not a second parallel management protocol.

`NeuralEntry` must satisfy the real `LogEntry` tuple prefix `[seq, tick, ...body]` in `fuse-netcode`; define explicit versioned encode/decode and `isEntry(unknown)` guards, with a lossless mapping between wire bodies and engine actions. Reuse the netcode's ordering, stream repair and generation rules. Per-stream sequence starts again in a new generation: command identity and checkpointed cursors must include `(matchId, round, actorId, generation)`, not just player ID. Fold eligible retired/current streams according to the authoritative management timeline; do not blindly accept stale generations or reject historical entries required by rollback. A command targeting an old round/entity is a deterministic no-op. `ordinal` is unnecessary unless a later action introduces an identity independent of stream sequence.

The Phase 0 offline `RollbackGame` adapter must implement the existing contract completely, including scope, clocks, settings/seating, view, hash and checkpoint codec. Late input replay restores a checkpoint and reapplies the same actions at their recorded ticks; presentation never invents state corrections. Views are authoritative for queue, balances, research and result state. Cosmetic events may be deduplicated by the runtime, so they must not serve as the source of economic statistics.

Validate shape/bounds at the wire boundary and legality/ownership/affordability again at tick application. Rejections are bounded typed results, separate from facts about actual state changes. Initial caps: 32 queued destinations per player and eight action commands per player per tick, processed in accepted actor sequence order across eligible generations; excess commands receive an explicit limit rejection. Duplicates must not spend twice, and insertion/network arrival order must not determine replay outcome.

Phase 0 acceptance includes action encode/decode round trips, unknown opcode/oversized payload rejection, spoofed actor and foreign-job rejection, new-generation sequence reuse, duplicate/stale scope rejection, and identical hashes for an on-time action versus the same late action after rollback through the existing world/runtime machinery. Use typed in-memory streams and fake time; real WebRTC rooms, recovery qualification and multiplayer browser play remain later work.

### Job rules

A queue is an ordered route intention, not terrain ownership. Reserve neither tiles nor money before a job starts. Reject duplicate destinations; check current legality when starting each entry. A legal but unaffordable head waits and blocks later entries. Illegal/obsolete entries are removed with reasons in a bounded scan of at most 32 entries; at most one valid new neuron job may start per player per tick. A future route segment can become legal after its predecessor completes. Occupied, blocked, deposit or unconnected targets cannot start construction.

1. Capture tick-start connected completed nodes, balances and active research effects. Fold all commands in accepted actor sequence order, including cancellations, queue edits and research starts. A research start atomically checks eligibility, deducts its cost and creates its job; insufficient funding rejects rather than silently queues it. Reject already-active/completed research. Canceling queued construction is free; canceling started construction or research loses its paid cost. Thus begin-research then cancel costs Insight and leaves no job, while cancel then begin may start a new paid job. Started-site cancellation makes that tile claimable next tick, preventing same-tick site cancel/restart.
2. After the command fold, each player's construction queue proposes at most one valid start, including newly enqueued work. Resolve competing destinations as a batch across all owners before atomically reserving accepted destinations, deducting costs once and creating sites/jobs. Earlier accepted spending remains deducted; this tick's income is unavailable. An enqueue followed by its queue cancellation in the same tick costs nothing. Construction and research use separate currencies and can progress concurrently.
3. Advance jobs. Fix each job's required duration when it starts from tick-start settings/research; tick of acceptance counts as its first progress tick. Increment connected construction and active research progress by one; debug uses zero required ticks and completes accepted jobs here. Disconnected construction pauses; it cannot serve as the next segment's support. Never recursively start another job after an instant completion.
4. Credit brain and deposit income using tick-start connectivity and ownership. Mark newly completed neurons/research for availability at the next tick. A neuron finishing now cannot mine, support another construction or retroactively discount a running job in this tick.
5. Advance the tick, publish authoritative results/view and assert bounds/invariants. Do not evaluate victory in sandbox. Clear transient results after consumption; keep no unbounded event history in state.

In Phase 0 no destruction command can cut a completed branch, but connectivity remains derived from completed ownership rather than assumed. Use disconnected-state fixtures to establish safe pause/no-income behavior for later combat. In step 2, prepare each player's next construction claim independently against tick-start eligibility and their own remaining balance. Batch claims across the roster before committing sites/costs: competing owners claiming the same empty tile all fail without payment, remove that attempted queue head with an explicit conflict reason, and cannot start a replacement until next tick. Unique claims commit normally. Do not make iteration order decide ownership. This four-player core behavior is tested now; online conflict delivery and competitive play remain later work.

`?debug` is parsed only by the app, into validated snapshotted `instantConstruction`/`instantResearch` settings for offline sandbox. Costs, placement, queue limits and prerequisites remain unchanged. Show a persistent Debug badge; do not accept a network URL as a rules override. Initial resources remain 60/0 in both modes, so instant research still requires earning 10 Insight. Debug is a timing aid, not an unlimited-money mode.

## Main menu and readable sandbox

Use the existing shared UI/menu conventions and make Neural Defence reachable from the actual game selection. Flow: **main menu → Solo Sandbox → map and spawn selection → Start → running sandbox**. The catalog has loading, empty and failed states with retry/back; selected maps have loading, invalid and ready states. Disable Start until validation succeeds, prevent duplicate launches, and ignore stale async responses after selection changes or leaving the screen. Do not poll/refetch from a render effect.

Show map dimensions and resource legend, normal/debug settings and “one player, no AI.” In debug mode show both instant settings before launch. No nonfunctional online-play button. Surface launch failure with retry and preserve the chosen map/spawn. Reset starts a new scoped session with the same validated configuration and initial stocks; back-to-menu disposes the runtime, pending loads and subscriptions. Confirmation for reset/leaving belongs to the product UI because progress is discarded.

The board shows a large readable brain, flat lighter slate hexes, clear blockers, distinct Biomass/Insight silhouettes and ownership beyond color alone. Selecting a hex shows legal/illegal construction reasons, cost, duration, queue position or active progress. Show queue cancel controls, both balances and current income, research affordability/progress/completed effect, selected-deposit neighbor contribution and a persistent debug indicator. Derive everything from corrected views; a submitted command is not proof of success. Support pointer/touch selection and keyboard-accessible actions without requiring artwork or cosmetic particle simulation.

## Verification and acceptance gates

Reserve statistics support now through stable player/entity identities, simulation ticks, canonical state/codec and bounded typed per-step outcomes containing actual economy changes and construction/research completions. Record earned, spent and cap-discarded amounts distinctly; do not infer income from changes in bank balance. Phase 0 need not implement a history collector, graph UI or persistent statistics storage. The [future statistics contract](ENGINE_PLAN.md#session-statistics-and-future-graphs) defines those later consumers; no future collector may influence gameplay or count speculative rollback ticks twice.

| Boundary     | Required evidence before Phase 0 is considered complete                                                                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Maps         | Round-trip fixture; odd/even row and edge neighbors; whitespace/key-order stable hash; both resources reachable; malformed, oversized, unknown-version and invalid-ring maps rejected with useful paths                                             |
| Economy      | Zero/one/six connected shares; aggregate ownership cannot exceed deposit output; fraction carry across ticks/checkpoint; disconnected/site neighbors earn zero; cap/overflow limits; no tick-of-completion income                                   |
| Construction | Normal/debug duration; queue continuation and insufficient-funds wait; illegal-head skip; one start/tick; no double spend; mixed enqueue/cancel ordering and refund rules; occupied/blocker/deposit rejection; disconnected pause                   |
| Research     | Funding via baseline and deposits; concurrent construction; no repeat purchase; exact completion/next-tick activation; earlier jobs unchanged; debug retains cost/prerequisites; same-tick begin/cancel and cancel/begin ordering                   |
| Determinism  | Same settings/map/commands give same hashes; canonical serialization; checkpoint-resumed versus uninterrupted equality mid-job and mid-fraction; malformed checkpoints rejected atomically; duplicate/stale commands no-op; bounded input rejection |
| Runtime/DI   | Fake-clock progression; solo starts with zero bots and never wins; same headless/runtime replay result; hidden pause/resume; reset/leave cancels scheduled work; existing games retain minimum-two behavior; solo makes no transport calls          |
| Browser      | Real menu launch; loader empty/failure/invalid/retry; stale-response safety; actual build → mine → research → faster build; debug launch; reset/back/re-enter; narrow viewport and keyboard flow; screenshot of the real running sandbox            |
| Scalability  | Long headless run and 4,096-cell synthetic fixture remain bounded; record revision, rules/map hashes, workload, steps/second and memory on the actual machine; no invented performance guarantee or browser-coverage claim                          |

Use meaningful independent arithmetic expectations, boundary fixtures and state invariants rather than mirroring implementation logic. Add a small fixed replay fixture under Neural Defence's own rules version. Rules changes require its version/fixture review; never refresh Fuse Riders' goldens for this game. Checkpoint caches are derived and reconstructed, never hidden dependencies on the previous ticker closure.

In addition to the matrix, require four-player fixtures for per-owner isolation, all shared-deposit contributions, foreign cancellation/command rejection, simultaneous conflicting construction, player-order-independent results and ownership-preserving checkpoint resume. Typed step outcomes must match actual economic changes, including cap-discarded income and rejected commands, so later statistics do not depend on UI animations or guessed balance deltas.

Implement in roughly **four focused agent sessions**, adjusting if shared integration reveals more work: (1) map/engine state and codecs; (2) economy/construction/research with headless checks; (3) solo adapter/minimum-participant capability and menu/board; (4) browser acceptance, scale measurement and fixes. Keep one owner through integration; these are reviewable milestones, not four parallel competing implementations.

During implementation run focused tests first, then repository typecheck, full unit tests, coverage and build before the implementation PR is ready; run the affected local browser flow and report any remaining limits. Shared-runtime changes need their existing regression tests too. Deliver an open reviewed PR, a muted runnable preview and concise evidence. Do not merge or deploy without explicit authorization. **For this planning PR, validate document consistency, links and diff only; wait for the user's review before any implementation.**

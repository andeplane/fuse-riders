# Phase 0: build, connect, mine, research

Status: **implementation proposal for user review; nothing below is implemented**. This is the bounded first milestone of [ENGINE_PLAN.md](ENGINE_PLAN.md), not permission to begin implementation. The wider game remains in [GAMEPLAY.md](GAMEPLAY.md).

## What the player can do

Open Neural Defence from the game menu, choose a small JSON map and start an offline, one-player sandbox with no AI. Construct neurons to extend a connected base, reach Biomass and Insight deposits, watch income accrue, and purchase one useful research upgrade. Time advances continuously during visible play; there are no turns and no automatic solo victory. Normal construction takes time; `?debug` makes construction and research instant while retaining their costs and rules.

This slice proves that the same headless rules can support a readable web game and reproducible tests. It does not yet prove multiplayer balance or that electrical combat is fun. Defer combat, particles, towers, repairs, AI policies, automatic expansion, fog, powerups, map editing, online rooms, career settlement and production deployment. Tower-site metadata may be validated and displayed as a future objective, but cannot construct a tower yet.

## Engine and dependency boundaries

Create `games/neural-defence/` with a public headless engine entrypoint. Keep map validation/geometry, state, commands, economy, jobs, research, observation and state codec/hash in `src/engine/`; app, rendering and the thin room adapter remain outside it. The engine imports no DOM, networking, file system, other game, timer or application module. Do not introduce an ECS, plugin framework or DI container for this slice.

- `loadMap(raw: unknown)` returns a validated canonical definition or structured errors with field paths. `createMatch(map, settings)` returns validated initial state. `step(state, commands)` advances exactly one simulation tick. `observe(state)` returns read-only presentation data; encode/decode/hash cover all authority.
- The engine receives explicit immutable map/rules/settings and validated commands. State holds every mutable gameplay decision: tick, scope, ownership, balances, accrual remainders, bounded queues, active jobs, research and command cursors. Helpers may mutate an exclusively owned working state, but stepping cannot mutate caller-owned maps, commands or retained checkpoints.
- Inject side effects at composition boundaries. Reuse `RuntimeDependencies` in [`room-runtime.ts`](../../packages/fuse-netcode/src/room-runtime.ts): `now`, `hidden`, `token`, `generation`, `schedule`, `onVisibilityChange`. Inject the existing transport dependency separately; solo must never construct a transport. Add only a narrow typed `MapRepository` port for async catalog/map loading, with browser-fetch and in-memory fake implementations. No generic service locator.
- Tests use interface-conforming fakes with controllable time, scheduled callbacks, visibility and map-loader outcomes. No `as any`, private-field mutation, global timer/fetch monkeypatches or sleeps. Do not mock the rules being tested. Test pure engine steps directly; use boundary fakes for app/runtime integration.
- No RNG is needed for the authored Phase 0 map. Later randomized rules use explicit seeded state stored in checkpoints; an injected mutable RNG closure must never hide authoritative state from replay.

Reuse the existing `RoomRuntime` solo path and `TickClock` at 50 ms per tick (20 Hz), through a minimal `RollbackGame` adapter in Phase 0. Set `steps = 1`, `maxSteps = 1`; the adapter folds commands into the same engine used headlessly. Rendering consumes views and interpolation only. Do not introduce a second application simulation interval or a temporary local-only rules implementation.

The existing runtime requires two participants when starting/rematching. Add a narrowly scoped optional per-game/settings minimum-participant capability, defaulting to two, and permit zero configured solo bots. Neural Defence offline sandbox selects one; both runtime guards and its authoritative management fold enforce that choice. Existing games retain their defaults. Completing the local adapter now does not include opening online rooms or claiming network qualification.

The current runtime pauses solo time while the page is hidden. Retain this explicit sandbox convenience, show paused/resumed status where appropriate, and test it; visible play never waits for input. Headless runs always advance exactly the requested ticks without sleeping. Online continuous-time and reconnect behavior remain later work.

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

The shipped map is 12 × 12, sparse blockers, both resource kinds, four spawn slots, and at least one route of at most three new neurons from each spawn to each resource kind. Solo chooses one spawn; unused spawn cells behave as ordinary open cells. Engine owner/slot types support up to four distinct players without hard-coded blue-player logic, but the Phase 0 launch accepts exactly one human. Multiplayer scenarios and fairness are deferred.

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

Commands cover enqueue construction, cancel queued/active construction, begin research and cancel active research. Give each command explicit scope, actor and monotonic actor sequence; the adapter derives actor identity from its stream. Track processed cursors in state so duplicates/stale scope cannot spend twice. Reject malformed or over-limit inputs before mutation, and return bounded typed rejection results for the UI. Initial caps: 32 queued destinations per player and eight action commands per player per tick, processed in accepted actor sequence order; excess commands receive an explicit limit rejection.

A queue is an ordered route intention, not terrain ownership. Reserve neither tiles nor money before a job starts. Reject duplicate destinations; check current legality when starting each entry. A legal but unaffordable head waits and blocks later entries. Illegal/obsolete entries are removed with reasons in a bounded scan of at most 32 entries; at most one valid new neuron job may start per player per tick. A future route segment can become legal after its predecessor completes. Occupied, blocked, deposit or unconnected targets cannot start construction.

1. Capture tick-start connected completed nodes, balances and active research effects. Fold all commands in accepted actor sequence order, including cancellations, queue edits and research starts. A research start atomically checks eligibility, deducts its cost and creates its job; insufficient funding rejects rather than silently queues it. Reject already-active/completed research. Canceling queued construction is free; canceling started construction or research loses its paid cost. Thus begin-research then cancel costs Insight and leaves no job, while cancel then begin may start a new paid job. Started-site cancellation makes that tile claimable next tick, preventing same-tick site cancel/restart.
2. After the command fold, each player's construction queue attempts at most one valid start, including newly enqueued work. Atomically reserve the destination, deduct the cost once and create the site/job. Earlier accepted spending remains deducted; this tick's income is unavailable. An enqueue followed by its queue cancellation in the same tick costs nothing. Construction and research use separate currencies and can progress concurrently.
3. Advance jobs. Fix each job's required duration when it starts from tick-start settings/research; tick of acceptance counts as its first progress tick. Increment connected construction and active research progress by one; debug uses zero required ticks and completes accepted jobs here. Disconnected construction pauses; it cannot serve as the next segment's support. Never recursively start another job after an instant completion.
4. Credit brain and deposit income using tick-start connectivity and ownership. Mark newly completed neurons/research for availability at the next tick. A neuron finishing now cannot mine, support another construction or retroactively discount a running job in this tick.
5. Advance the tick, publish authoritative results/view and assert bounds/invariants. Do not evaluate victory in sandbox. Clear transient results after consumption; keep no unbounded event history in state.

In Phase 0 no destruction command can cut a completed branch, but connectivity remains derived from completed ownership rather than assumed. Use disconnected-state fixtures to establish safe pause/no-income behavior for later combat. Later opposing neutral claims must resolve together with all conflicting claims rejected and uncharged, as specified in the engine plan; Phase 0 must not entrench slot-order ownership, but multi-player conflict execution is outside this slice.

`?debug` is parsed only by the app, into validated snapshotted `instantConstruction`/`instantResearch` settings for offline sandbox. Costs, placement, queue limits and prerequisites remain unchanged. Show a persistent Debug badge; do not accept a network URL as a rules override. Initial resources remain 60/0 in both modes, so instant research still requires earning 10 Insight. Debug is a timing aid, not an unlimited-money mode.

## Main menu and readable sandbox

Use the existing shared UI/menu conventions and make Neural Defence reachable from the actual game selection. Flow: **main menu → Solo Sandbox → map and spawn selection → Start → running sandbox**. The catalog has loading, empty and failed states with retry/back; selected maps have loading, invalid and ready states. Disable Start until validation succeeds, prevent duplicate launches, and ignore stale async responses after selection changes or leaving the screen. Do not poll/refetch from a render effect.

Show map dimensions and resource legend, normal/debug settings and “one player, no AI.” In debug mode show both instant settings before launch. No nonfunctional online-play button. Surface launch failure with retry and preserve the chosen map/spawn. Reset starts a new scoped session with the same validated configuration and initial stocks; back-to-menu disposes the runtime, pending loads and subscriptions. Confirmation for reset/leaving belongs to the product UI because progress is discarded.

The board shows a large readable brain, flat lighter slate hexes, clear blockers, distinct Biomass/Insight silhouettes and ownership beyond color alone. Selecting a hex shows legal/illegal construction reasons, cost, duration, queue position or active progress. Show queue cancel controls, both balances and current income, research affordability/progress/completed effect, selected-deposit neighbor contribution and a persistent debug indicator. Derive everything from corrected views; a submitted command is not proof of success. Support pointer/touch selection and keyboard-accessible actions without requiring artwork or cosmetic particle simulation.

## Verification and acceptance gates

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

Implement in roughly **four focused agent sessions**, adjusting if shared integration reveals more work: (1) map/engine state and codecs; (2) economy/construction/research with headless checks; (3) solo adapter/minimum-participant capability and menu/board; (4) browser acceptance, scale measurement and fixes. Keep one owner through integration; these are reviewable milestones, not four parallel competing implementations.

During implementation run focused tests first, then repository typecheck, full unit tests, coverage and build before the implementation PR is ready; run the affected local browser flow and report any remaining limits. Shared-runtime changes need their existing regression tests too. Deliver an open reviewed PR, a muted runnable preview and concise evidence. Do not merge or deploy without explicit authorization. **For this planning PR, validate document consistency, links and diff only; wait for the user's review before any implementation.**

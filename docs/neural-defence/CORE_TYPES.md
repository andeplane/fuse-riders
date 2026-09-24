# Core data contracts for review

These are proposed TypeScript contracts, not implemented source files. Read them with [the architecture](ARCHITECTURE.md) and [Phase 0 rules](PHASE_0.md). They define authority and boundaries; implementation may refine names while preserving behavior. Runtime guards are mandatory: a type assertion never validates downloaded JSON, actions or checkpoints.

## Identity, quantities and immutable definitions

Use branded IDs to prevent accidental interchange. Brands have plain string/number wire representations; validated constructors create them. Every numeric quantity below must be a finite safe integer with domain-specific bounds. Durations are simulation ticks, currency is milli-units, and particle counts are indivisible units.

```ts
type Brand<T, Name extends string> = T & { readonly __brand: Name };
type PlayerId = Brand<string, "PlayerId">;
type MatchId = Brand<string, "MatchId">;
type EntityId = Brand<string, "EntityId">;
type JobId = Brand<string, "JobId">;
type QueueItemId = Brand<string, "QueueItemId">;
type CohortId = Brand<string, "CohortId">;
type ProfileId = Brand<string, "ProfileId">;
type ReservationId = Brand<string, "ReservationId">;
type TileId = Brand<number, "TileId">;
type SimTick = Brand<number, "SimTick">;
type LogTick = Brand<number, "LogTick">;
type Generation = Brand<number, "Generation">;
type MilliUnits = Brand<number, "MilliUnits">;
type ParticleCount = Brand<number, "ParticleCount">;
type EntityRef = Readonly<{ id: EntityId; generation: Generation }>;
type JobRef = Readonly<{ id: JobId; generation: Generation }>;
type Scope = Readonly<{ matchId: MatchId; round: number }>;
type ResourceKind = "biomass" | "insight";
type ParticleType = "assault" | "guard";
type ResearchId = "growth-efficiency" | "excitation" | "insulation";
type ValidationIssue = Readonly<{
  path: string;
  code: string;
  message: string;
}>;
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

IDs are unique within the documented match scope. Reusing a tile does not reuse its previous structure identity. A late command carrying an old entity/job reference cannot act on its replacement. Player IDs survive elimination and remain usable in historical statistics; spawn slots and display colours do not serve as identity.

| Definition           | Required content                                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MapFileV1`          | Exact JSON union defined in Phase 0: schema version, ID, dimensions, odd-r layout, row-major cell definitions and spawn slots                                                 |
| `MapDefinition`      | Validated immutable canonical map content; content hash; derived neighbors kept outside serialized authority or rebuilt and verified                                          |
| `RulesDefinition`    | Rules version; 20 Hz tick duration; economy rates/caps; construction/research definitions; particle profiles, pool/storage/link limits; combat cadence/HP; all validated caps |
| `MatchSettings`      | Mode (`sandbox` or `combat-lab`/headless competitive scenario), selected spawn assignments and explicit instant construction/research flags; immutable after start            |
| `RosterEntry`        | Stable player ID, spawn slot, display label and controller kind; local human selection is app state, not a property of ownership                                              |
| `ResearchDefinition` | Supported research ID, cost, duration, bounded prerequisite IDs, exclusion group where applicable and typed effect                                                            |
| `ResearchEffect`     | `construction-duration` or `particle-property` with explicit type/property/value; no executable callbacks or arbitrary modifier script in saved data                          |
| `RuleLimits`         | Player capacity (initially four), map dimensions/bytes/cells, command/queue limits, eight routing destinations, pool/cohort/profile/reservation/job bounds                    |

Store resolved rule values or require the exact identified immutable rules bundle when restoring a checkpoint. Never silently resume under a different balance configuration. Schema version, rules version and checkpoint version are distinct.

## Cell state, structures and ownership

Static map terrain and runtime occupancy are separate. Deposits are neutral map features; income belongs to neighboring owners. Cells do not contain `isMine`, `isEnemy`, one global balance, or a single opponent reference.

```ts
type CellOccupancy =
  | { kind: "empty" }
  | { kind: "site"; entity: EntityRef }
  | { kind: "structure"; entity: EntityRef };

type StructureState = Readonly<{
  ref: EntityRef;
  owner: PlayerId;
  tile: TileId;
  kind: "brain" | "neuron" | "construction-site";
  hp: number;
  operationalFrom: SimTick;
  firingCursor: number;
}>;

type RoutingPriority = Readonly<{
  target: EntityRef;
  assault: 0 | 1 | 2 | 3;
  guard: 0 | 1 | 2 | 3;
}>;
```

Checkpoint validation verifies the bidirectional occupancy/entity relationship, owner membership, map legality, HP bounds and operational time. The brain reference resolves to exactly one living brain for each active player. Per-owner connectivity is derived from completed friendly structures, never through enemy neurons or incomplete sites. A site can be damaged without becoming an operational node. Completion preserves prior damage as specified in Phase 0.

## Player state and jobs

```ts
type ConstructionQueueItem = Readonly<{ id: QueueItemId; tile: TileId }>;
type ConstructionJob = Readonly<{
  kind: "construction";
  ref: JobRef;
  owner: PlayerId;
  site: EntityRef;
  queueItem: QueueItemId;
  paid: MilliUnits;
  startedAt: SimTick;
  requiredTicks: number;
  progressTicks: number;
}>;
type ResearchJob = Readonly<{
  kind: "research";
  ref: JobRef;
  owner: PlayerId;
  research: ResearchId;
  paid: MilliUnits;
  startedAt: SimTick;
  requiredTicks: number;
  progressTicks: number;
}>;
type RefitJob = Readonly<{
  kind: "refit";
  ref: JobRef;
  owner: PlayerId;
  fromType: ParticleType;
  toType: ParticleType;
  cohortIds: readonly CohortId[];
  startedAt: SimTick;
  requiredTicks: number;
  progressTicks: number;
}>;
type ResearchCompletion = Readonly<{
  research: ResearchId;
  completedAt: SimTick;
  activeFrom: SimTick;
}>;
type IncomeRemainder = Readonly<{
  resource: ResourceKind;
  source: { kind: "brain" } | { kind: "deposit"; tile: TileId };
  numerator: number;
}>;
type PlayerState = Readonly<{
  id: PlayerId;
  slot: number;
  status: "active" | "eliminated";
  brain: EntityRef;
  balances: Readonly<Record<ResourceKind, MilliUnits>>;
  incomeRemainders: readonly IncomeRemainder[];
  constructionQueue: readonly ConstructionQueueItem[];
  construction: ConstructionJob | null;
  research: ResearchJob | null;
  refit: RefitJob | null;
  completedResearch: readonly ResearchCompletion[];
  priorities: readonly RoutingPriority[];
  desiredAssaultCount: ParticleCount;
}>;
```

Jobs do not own a second copy of particle inventory or currency. `paid` records an already applied debit; refit references escrowed cohorts. Construction/research duration is latched at acceptance. Refit locks its input/output/count until completion even when the desired mix changes. Paused construction is derived from current connectivity, and cancellation follows the explicit no-refund rule for started work. A builder-delivery stage would extend construction deliberately after review, not reinterpret `progressTicks` as travel time.

## Particle types, profiles, cohorts and capacity

```ts
type ParticleProfile = Readonly<{
  id: ProfileId;
  type: ParticleType;
  revision: number;
  attack: number;
  absorption: number;
  ticksPerEdge: number;
}>;
type ParticleLocation =
  | { kind: "reservoir"; brain: EntityRef }
  | { kind: "deployed"; node: EntityRef }
  | { kind: "relay"; node: EntityRef; arrivedAt: SimTick }
  | {
      kind: "transit";
      from: EntityRef;
      to: EntityRef;
      departedAt: SimTick;
      arrivesAt: SimTick;
      receive: ReservationId;
    }
  | { kind: "recovery"; readyAt: SimTick }
  | { kind: "refit"; job: JobRef }
  | { kind: "retired"; at: SimTick };
type ParticleCohort = Readonly<{
  id: CohortId;
  owner: PlayerId;
  type: ParticleType;
  profile: ProfileId;
  count: ParticleCount;
  destination: EntityRef;
  lastConnectedBrainDistance: number;
  location: ParticleLocation;
}>;
type ReceiveReservation = Readonly<{
  id: ReservationId;
  cohort: CohortId;
  target: EntityRef;
  buffer: "reservoir" | "relay" | "deployed";
}>;
```

Each cohort occurs once in the authoritative cohort collection, in exactly one location. A reservation is capacity metadata for that cohort's count, not another particle holding. Ultimate-destination commitments derive from cohorts and their destinations; cached totals must agree. Brain reservoir particles can attack/defend without also being counted as deployed. Eliminated cohorts keep their identities in retired accounting, with no live reservations or jobs.

Split before partially moving/refitting/spending a cohort, using deterministic IDs allocated from checkpointed counters. Merge only when owner, type, profile, destination, location/timing and saved recovery-distance semantics match. Profiles are immutable; research does not rewrite old traveling cohorts. Refit conversion preserves total particle count but changes type explicitly. Final delivery requires the appropriate reserved storage capacity. Intermediate relay stock is ineligible for combat.

The initial pool is 128/player, so even the worst case of one-unit cohorts is bounded. Never allocate a separate object per rendered sparkle. Link usage in the current tick is ephemeral derived work; fairness cursors affecting future arbitration are checkpointed. Shared physical-edge capacity covers both directions and both types. Validate all references, per-compartment capacity, profile/type consistency, arrival times and conservation before installing a snapshot.

## Actions, context and outcomes

```ts
type Action =
  | { kind: "enqueueConstruction"; tiles: readonly TileId[] }
  | { kind: "cancelQueuedConstruction"; item: QueueItemId }
  | { kind: "cancelConstruction"; job: JobRef }
  | { kind: "beginResearch"; research: ResearchId }
  | { kind: "cancelResearch"; job: JobRef }
  | {
      kind: "setNodePriority";
      node: EntityRef;
      type: ParticleType;
      weight: 0 | 1 | 2 | 3;
    }
  | { kind: "setParticleMix"; desiredAssaultCount: ParticleCount };
type CommandContext = Readonly<{
  scope: Scope;
  actor: PlayerId;
  streamGeneration: Generation;
  sequence: number;
  applyAt: LogTick;
}>;
type Command = Readonly<{ context: CommandContext; action: Action }>;
type CommandCursor = Readonly<{
  scope: Scope;
  actor: PlayerId;
  streamGeneration: Generation;
  lastProcessedSequence: number;
}>;
```

The game adapter derives actor and generation from admitted streams and management history; payloads cannot choose another actor. The existing `LogEntry` prefix is `[sequence, logTick, ...body]`; a versioned codec maps action bodies losslessly. Current/retired stream handling follows existing netcode. Management commands are its own existing union, not `Action`. Shape guards run at ingress; current ownership, prerequisites and funds are checked again when applied. Ordinary user rejection reasons form a closed typed enum; diagnostic messages do not influence simulation.

`StepOutcome` is a bounded discriminated union, always stamped with scope and simulation tick. Its required families are:

| Family                | Required typed facts                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Command result        | Actor/generation/sequence, accepted/rejected, stable reason, created queue/job IDs where relevant                      |
| Economy               | Owner, resource, exact earned/spent/cap-discarded amount, brain/deposit/job/research reason and source reference       |
| Construction/research | Owner, job/entity/research ID, started/completed/cancelled, actual completion/activation tick                          |
| Particle movement     | Owner, type/profile, count, source/destination, dispatch/arrival/recovery transition                                   |
| Refit                 | Owner, job, input/output type and count; no fictional gain/loss of total particles                                     |
| Combat                | Attacker/target references and owners, raw damage, absorbed damage and actual HP loss; committed particle types/counts |
| Topology/result       | Destroyed entity, connection loss/restoration, eliminated player and win/draw outcome                                  |

Outcomes are observations of committed rule effects, not commands to apply twice. They are returned, not retained forever in `WorldState`. Later statistics consume confirmed/recomputed outcomes; positional cosmetic-event deduplication is not sufficient. Output caps must aggregate facts deterministically where needed without dropping actual totals silently.

## State container, views and ports

| Contract              | Owns                                                                                                                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorldState`          | Scope, simulation tick, canonical map/rules/settings/roster, runtime occupancy and structures, player states, cohorts/profiles/reservations, command cursors, deterministic ID counters, routing/firing cursors and current lifecycle/result |
| `RoomState`           | Existing netcode log tick, room management/seats/presence/settings, match scope and optional current world; use the existing management state pattern rather than invent another authority model                                             |
| `WorldView`           | Read-only tick-stamped projection: cells/owners/HP, jobs, balances/income, type counts, priorities, congestion, recorded transit endpoints/times and results; selected player/tile belongs to UI state                                       |
| `StepResult`          | Next authoritative state (or explicitly owned mutated state), bounded outcomes; no asynchronous work                                                                                                                                         |
| `Checkpoint`          | Versioned canonical plain data covering all authority; full guard decodes into a new state atomically                                                                                                                                        |
| `MapRepository`       | Typed catalog and map reads with cancellation/error results; browser asset URLs and fetch stay in its adapter                                                                                                                                |
| `RuntimeDependencies` | Reuse existing clock/visibility/token/generation/schedule interface from `fuse-netcode`; no duplicate clock abstraction                                                                                                                      |
| `StatisticsSink`      | Future injected output boundary for bounded reports; failures cannot influence simulation                                                                                                                                                    |

The public pure surface is `validateMap(unknown)`, `createMatch(map, rules, settings, roster)`, `validateAction(unknown)`, `step(state, commands)`, `observe(state)`, `encodeCheckpoint(state)`, `decodeCheckpoint(unknown)`, and `hash(state)`. Use structured `Result` values where validation can fail. The creation API accepts the same immutable resolved rules later included in compatibility checks; no external mutable balance singleton.

Implement `RollbackGame<RoomState, NeuralEntry, WorldView, CosmeticEvent, RoomSettings>` using the actual package interface. `createTicker` bridges log ticks to the pure step and stores no uncheckpointed gameplay state. During Phase 0 one log tick drives one simulation tick; keep their types distinct because the runtime also has lobby ticks. A headless driver can supply the same contextual actions without opening a browser.

Typed tests use fake `RuntimeDependencies` and `MapRepository` through their public interfaces, and ordinary engine inputs for gameplay. They do not reach into private runtime fields, patch global clocks or mock the rules under test. Validate 1–4 owner scenarios and round-trip every state variant, including partial transit, refit, fractional income and damaged construction.

## Builder extension boundary

Builder particles are still a proposal. Do not add `"builder"` to the shipped `ParticleType` union until its capacity/economy role is agreed. If we choose a separate worker pool, define a distinct `BuilderId`/worker state with `idle`, `travelling`, `building`, `returning` and `recovering` variants, and make a construction job reference its assigned builder. Shared transport may carry a typed cargo union while worker and military conservation remain separate. If we choose a common pool instead, extend composition/refit/routing/codec tests explicitly. Neither option should hide a worker in a render-only animation.

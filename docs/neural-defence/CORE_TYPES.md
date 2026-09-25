# Neural Defence core contracts

Status: current implementation reference; Phase 0 acceptance remains open. Authoritative declarations live in [`engine/types.ts`](../../games/neural-defence/src/engine/types.ts), [`engine/index.ts`](../../games/neural-defence/src/engine/index.ts), [`online/game.ts`](../../games/neural-defence/src/online/game.ts) and [`app/contracts.ts`](../../games/neural-defence/src/app/contracts.ts). Refer to source for exact field bounds and runtime guards. The excerpts below use the current discriminants.

## Identity and state

```ts
type Resource = "biomass" | "insight";
type StructureKind = "brain" | "neuron" | "tower";
type Research = "growth" | "excitation" | "conduction";
type Cell =
  | { terrain: "open"; towerSite?: boolean; variant?: string }
  | { terrain: "blocked"; variant?: string }
  | { terrain: "deposit"; resourceKind: Resource; variant?: string };
```

`MapDefinition` carries schema version 1, ID, width, height, `odd-r` layout, row-major cells and explicit `{slot, cellIndex}` spawns. The optional `towerSite` cell flag suggests a test location; it does not restrict tower construction. `RosterEntry` is `{id, slot}`. `World` carries format version 1 and rules version 2, match ID, tick, map, settings, players, structures, attack particles, next entity ID, per-tick outcomes and finish/winner state. Currency is integer milli-units. Player and structure owners use stable IDs; local selection and armed placement are app state, never authority. Version 1 checkpoints are rejected rather than guessing missing auto-expansion state.

Each `Player` owns balances, command sequence, up to 32 construction jobs, **one** `Worker`, completed research, one active research job, attack priorities, mining remainders and statistics. `Worker.mode` is `idle | outbound | building | returning | recovering`; its cell, edge and timing are checkpointed. `Construction` records cell, neuron/tower kind, paid state, progress, latched duration and site HP. `Structure` records ID, cell, owner, kind, HP, brain connectivity and optional firing cursor.

`Particle` is an individual reusable **attack** unit with owner, ID, current cell, destination, edge/timing, `stationed | transit | recovering` mode, attack and speed. There are 128 per living player. The builder is stored separately in `Player.worker`; there is no guard type, composition state or refit job. Research changes future dispatch/recovery profiles as defined by the engine.

## Public actions

These are the current discriminants and payloads:

```ts
type Action =
  | { type: "setAutoExpand"; enabled: boolean }
  | { type: "queueConstruction"; cell: number; kind: "neuron" | "tower" }
  | { type: "cancelConstruction"; cell: number }
  | { type: "startResearch"; research: Research }
  | { type: "cancelResearch" }
  | { type: "setPriority"; cell: number; weight: number };
interface Command {
  playerId: string;
  sequence: number;
  action: Action;
  matchId?: string;
}
```

`isAction` checks shape; `step` checks ownership, funds, legality and sequence. Weight is integer 0–3; zero clears a priority. Outcomes identify tick, player, type and optional target, amount, resource or rejection reason. Current kinds are `rejected`, `queued`, `dispatched`, `constructed`, `researched`, `researchStarted`, `income`, `damage`, `destroyed` and `eliminated`. These per-tick outcomes plus cumulative statistics are not yet a graph history.

## Boundaries and injection

```ts
interface MapRepository {
  list(signal: AbortSignal): Promise<MapSummary[]>;
  load(id: string, signal: AbortSignal): Promise<unknown>;
}
interface NeuralSession {
  readonly localPlayerId: string;
  view(): Readonly<World>;
  dispatch(action: Action): void;
  subscribe(listener: () => void): () => void;
  reset(): void;
  dispose(): void;
}
```

The app also injects `SessionFactory` and `PreferencesStore`; the solo session can receive typed `RuntimeDependencies` for time, scheduling, visibility and identity. The `RollbackGame` adapter defines `NeuralSettings` (map, slot, `sandbox | combat-lab`, engine flags), management/play entries, seating and checkpoint codec. Actors derive from admitted streams; the same engine runs under the adapter. There is no browser multiplayer screen yet.

`loadMap`, `isAction`, `parseSettings` and `decodeState` validate untrusted input at their boundaries. A TypeScript interface does not validate JSON. Mutable gameplay decisions belong in `World` or the room checkpoint; the renderer only reads a view. Future graphs can consume confirmed outcomes by stable owner and tick but cannot affect simulation.

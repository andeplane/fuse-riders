import { neighbors } from "./map.js";
import {
  RULES,
  type Construction,
  type Player,
  type Research,
  type Resource,
  type World,
} from "./types.js";

export type BuildKind = Construction["kind"];
export interface ConstructionDefinition {
  readonly cost: number;
  readonly duration: number;
  readonly connectedNeighbors: number;
  readonly requires: readonly Research[];
  readonly durationUpgrades: readonly {
    readonly research: Research;
    readonly duration: number;
  }[];
}
export interface ResearchDefinition {
  readonly cost: number;
  readonly duration: number;
  readonly requires: readonly Research[];
}

export const CONSTRUCTIONS: Readonly<
  Record<BuildKind, ConstructionDefinition>
> = {
  neuron: {
    cost: RULES.neuronCost,
    duration: RULES.constructionTicks,
    connectedNeighbors: 1,
    requires: [],
    durationUpgrades: [{ research: "growth", duration: 80 }],
  },
  tower: {
    cost: RULES.towerCost,
    duration: RULES.towerConstructionTicks,
    connectedNeighbors: 6,
    requires: [],
    durationUpgrades: [],
  },
};
export const RESEARCH: Readonly<Record<Research, ResearchDefinition>> = {
  growth: {
    cost: RULES.researchCost,
    duration: RULES.researchTicks,
    requires: [],
  },
  excitation: {
    cost: RULES.researchCost,
    duration: RULES.researchTicks,
    requires: [],
  },
  conduction: {
    cost: RULES.researchCost,
    duration: RULES.researchTicks,
    requires: [],
  },
};
// These rules are shared with presentation, but cannot be changed by it.
for (const definition of Object.values(CONSTRUCTIONS)) {
  Object.freeze(definition.requires);
  definition.durationUpgrades.forEach(Object.freeze);
  Object.freeze(definition.durationUpgrades);
  Object.freeze(definition);
}
for (const definition of Object.values(RESEARCH)) {
  Object.freeze(definition.requires);
  Object.freeze(definition);
}
Object.freeze(CONSTRUCTIONS);
Object.freeze(RESEARCH);

export const isBuildKind = (value: unknown): value is BuildKind =>
  typeof value === "string" && Object.hasOwn(CONSTRUCTIONS, value);
export const isResearchKind = (value: unknown): value is Research =>
  typeof value === "string" && Object.hasOwn(RESEARCH, value);
export const constructionDurations = (kind: BuildKind): readonly number[] => [
  0,
  CONSTRUCTIONS[kind].duration,
  ...CONSTRUCTIONS[kind].durationUpgrades.map((upgrade) => upgrade.duration),
];

/** Structured reasons shared by simulation decisions and presentation. */
export type Requirement =
  | { kind: "alive" }
  | { kind: "open-cell" }
  | { kind: "unoccupied-cell" }
  | { kind: "not-queued" }
  | { kind: "queue-space"; limit: number }
  | { kind: "research"; research: Research }
  | {
      kind: "resource";
      resource: Resource;
      required: number;
      available: number;
    }
  | { kind: "neighbors"; required: number; connected: number }
  | { kind: "idle-builder" }
  | { kind: "idle-research" }
  | { kind: "not-researched"; research: Research };
export interface Availability {
  allowed: boolean;
  missing: Requirement[];
}
const result = (missing: Requirement[]): Availability => ({
  allowed: missing.length === 0,
  missing,
});
const living = (player: Readonly<Player>): Requirement[] =>
  player.alive ? [] : [{ kind: "alive" }];

export function researchPrerequisites(
  player: Readonly<Player>,
  requires: readonly Research[],
): Requirement[] {
  return requires
    .filter((id) => !player.research.includes(id))
    .map((research) => ({ kind: "research", research }));
}
function occupied(world: Readonly<World>, cell: number) {
  return (
    world.structures.some((s) => s.cell === cell) ||
    world.players.some((p) => p.queue.some((j) => j.cell === cell && j.paid))
  );
}

export function constructionAvailability(
  player: Readonly<Player>,
  kind: BuildKind,
): Availability {
  const missing = [
    ...living(player),
    ...researchPrerequisites(player, CONSTRUCTIONS[kind].requires),
  ];
  if (player.queue.length >= RULES.queueLimit)
    missing.push({ kind: "queue-space", limit: RULES.queueLimit });
  return result(missing);
}

export function constructionQueueAvailability(
  world: Readonly<World>,
  player: Readonly<Player>,
  kind: BuildKind,
  cell: number | null,
): Availability {
  const missing = constructionAvailability(player, kind).missing;
  if (cell === null || world.map.cells[cell]?.terrain !== "open")
    missing.push({ kind: "open-cell" });
  if (cell !== null && occupied(world, cell))
    missing.push({ kind: "unoccupied-cell" });
  if (player.queue.some((j) => j.cell === cell))
    missing.push({ kind: "not-queued" });
  return result(missing);
}

/** Legal queue entries can wait for these conditions; do not reject the queue action. */
export function constructionDispatchAvailability(
  world: Readonly<World>,
  player: Readonly<Player>,
  job: Readonly<Pick<Construction, "cell" | "kind">>,
): Availability {
  const definition = CONSTRUCTIONS[job.kind];
  const missing = [
    ...living(player),
    ...researchPrerequisites(player, definition.requires),
  ];
  if (player.worker.mode !== "idle" || player.queue.some((j) => j.paid))
    missing.push({ kind: "idle-builder" });
  if (occupied(world, job.cell)) missing.push({ kind: "unoccupied-cell" });
  const connected = neighbors(world.map, job.cell).filter((cell) =>
    world.structures.some(
      (s) => s.cell === cell && s.ownerId === player.id && s.connected,
    ),
  ).length;
  if (connected < definition.connectedNeighbors)
    missing.push({
      kind: "neighbors",
      required: definition.connectedNeighbors,
      connected,
    });
  if (player.biomass < definition.cost)
    missing.push({
      kind: "resource",
      resource: "biomass",
      required: definition.cost,
      available: player.biomass,
    });
  return result(missing);
}

export function researchAvailability(
  player: Readonly<Player>,
  kind: Research,
): Availability {
  const definition = RESEARCH[kind];
  const missing = [
    ...living(player),
    ...researchPrerequisites(player, definition.requires),
  ];
  if (player.researchJob) missing.push({ kind: "idle-research" });
  if (player.research.includes(kind))
    missing.push({ kind: "not-researched", research: kind });
  if (player.insight < definition.cost)
    missing.push({
      kind: "resource",
      resource: "insight",
      required: definition.cost,
      available: player.insight,
    });
  return result(missing);
}

export function constructionDuration(
  world: Readonly<World>,
  player: Readonly<Player>,
  kind: BuildKind,
): number {
  if (world.settings.instantConstruction) return 0;
  const definition = CONSTRUCTIONS[kind];
  return (
    definition.durationUpgrades.find((upgrade) =>
      player.research.includes(upgrade.research),
    )?.duration ?? definition.duration
  );
}

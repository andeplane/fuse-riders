import { neighbors, weaponCells } from "./map.js";
import {
  RULES,
  type Construction,
  type Player,
  type Research,
  type Resource,
  type World,
  type StructureKind,
  type ParticleKind,
} from "./types.js";

export type BuildKind = Construction["kind"];
export const PARTICLES: Readonly<
  Record<
    ParticleKind,
    Readonly<{
      attack: number;
      speed: number;
      recovery: number;
      requires: readonly Research[];
    }>
  >
> = Object.freeze({
  pulse: Object.freeze({
    attack: 2,
    speed: 4,
    recovery: 120,
    requires: Object.freeze([]),
  }),
  heavy: Object.freeze({
    attack: 4,
    speed: 7,
    recovery: 240,
    requires: Object.freeze(["ballistics"] as const),
  }),
  swift: Object.freeze({
    attack: 1,
    speed: 2,
    recovery: 60,
    requires: Object.freeze(["resonance"] as const),
  }),
});
export const isParticleKind = (value: unknown): value is ParticleKind =>
  typeof value === "string" && Object.hasOwn(PARTICLES, value);
export function particleProfile(player: Readonly<Player>) {
  const profile = PARTICLES[player.particleKind];
  return {
    kind: player.particleKind,
    attack: profile.attack + (player.research.includes("excitation") ? 1 : 0),
    speed: profile.speed - (player.research.includes("conduction") ? 1 : 0),
  };
}
export interface ConstructionDefinition {
  readonly upgradesFrom?: readonly StructureKind[];
  readonly adjacentDeposit?: boolean;
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
    upgradesFrom: ["neuron"],
    cost: RULES.towerCost,
    duration: RULES.towerConstructionTicks,
    connectedNeighbors: 1,
    requires: [],
    durationUpgrades: [],
  },
  siege: {
    upgradesFrom: ["neuron"],
    cost: 80_000,
    duration: 280,
    connectedNeighbors: 1,
    requires: ["ballistics"],
    durationUpgrades: [],
  },
  relay: {
    upgradesFrom: ["neuron"],
    cost: 45_000,
    duration: 160,
    connectedNeighbors: 1,
    requires: ["resonance"],
    durationUpgrades: [],
  },
  harvester: {
    upgradesFrom: ["neuron"],
    cost: 60_000,
    duration: 240,
    connectedNeighbors: 1,
    adjacentDeposit: true,
    requires: ["growth"],
    durationUpgrades: [],
  },
  bastion: {
    upgradesFrom: ["neuron"],
    cost: 45_000,
    duration: 160,
    connectedNeighbors: 1,
    requires: ["growth"],
    durationUpgrades: [],
  },
  // Splash: the counter to dense neuron spreads (a siege-tank or TD splash tower).
  spore: {
    upgradesFrom: ["neuron"],
    cost: 55_000,
    duration: 200,
    connectedNeighbors: 1,
    requires: ["growth"],
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
  ballistics: { cost: 20_000, duration: 400, requires: ["excitation"] },
  resonance: { cost: 20_000, duration: 400, requires: ["conduction"] },
};

export const STRUCTURES: Readonly<
  Record<
    StructureKind,
    Readonly<{
      hp: number;
      range: number;
      minRange?: number;
      cadence: number;
      volley: number;
      miningBonus?: number;
      /** Share of each hit, in percent, also dealt to enemy structures next to the target. */
      splashPercent?: number;
      protection?: Readonly<{
        range: number;
        absorbPercent: number;
        capacityPerAttack: number;
      }>;
    }>
  >
> = Object.freeze({
  brain: Object.freeze({ hp: 240, range: 1, cadence: 20, volley: 4 }),
  neuron: Object.freeze({ hp: 60, range: 1, cadence: 20, volley: 0 }),
  tower: Object.freeze({ hp: 120, range: 2, cadence: 20, volley: 8 }),
  siege: Object.freeze({
    hp: 80,
    range: 3,
    minRange: 3,
    cadence: 60,
    volley: 5,
  }),
  relay: Object.freeze({ hp: 90, range: 2, cadence: 10, volley: 3 }),
  harvester: Object.freeze({
    hp: 70,
    range: 0,
    cadence: 20,
    volley: 0,
    miningBonus: 1,
  }),
  spore: Object.freeze({
    hp: 70,
    range: 2,
    cadence: 20,
    volley: 6,
    splashPercent: 50,
  }),
  bastion: Object.freeze({
    hp: 240,
    range: 1,
    cadence: 20,
    volley: 12,
    protection: Object.freeze({
      range: 2,
      absorbPercent: 60,
      capacityPerAttack: 2,
    }),
  }),
});
export const canAttack = (kind: StructureKind): boolean =>
  STRUCTURES[kind].volley > 0;

/** Attack range uses traversable hex steps, like the existing maximum reach. */
export function attackCells(
  map: World["map"],
  cell: number,
  kind: StructureKind,
): ReadonlySet<number> {
  const definition = STRUCTURES[kind];
  const reach = weaponCells(map, cell, definition.range);
  if (!definition.minRange) return reach;
  const cells = new Set(reach);
  for (const near of weaponCells(map, cell, definition.minRange - 1))
    cells.delete(near);
  return cells;
}

export function protectionCells(
  world: Readonly<World>,
  kind: StructureKind,
  cell: number,
): ReadonlySet<number> {
  const field = STRUCTURES[kind].protection;
  return field
    ? new Set([cell, ...weaponCells(world.map, cell, field.range)])
    : new Set();
}

/** A deposit receives its ordinary adjacent contributions and one best specialist bonus. */
/** Structures of one player that can mine the same deposit. */
export const MINERS_PER_DEPOSIT = 2;
export function depositContribution(
  world: Readonly<World>,
  playerId: string,
  cell: number,
): number {
  const adjacent = new Set(neighbors(world.map, cell));
  const miners = world.structures.filter(
    (s) => s.connected && s.ownerId === playerId && adjacent.has(s.cell),
  );
  // Two miners work a deposit; a Harvester adds its bonus on top. Holding
  // more deposits, not crowding one, grows an economy.
  return (
    Math.min(miners.length, MINERS_PER_DEPOSIT) +
    Math.max(0, ...miners.map((s) => STRUCTURES[s.kind].miningBonus ?? 0))
  );
}

export function constructionSiteRequirements(
  world: Readonly<World>,
  kind: BuildKind,
  cell: number | null,
): Requirement[] {
  return CONSTRUCTIONS[kind].adjacentDeposit &&
    (cell === null ||
      !neighbors(world.map, cell).some(
        (n) => world.map.cells[n]?.terrain === "deposit",
      ))
    ? [{ kind: "adjacent-deposit" }]
    : [];
}
// These rules are shared with presentation, but cannot be changed by it.
for (const definition of Object.values(CONSTRUCTIONS)) {
  if (definition.upgradesFrom) Object.freeze(definition.upgradesFrom);
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
  | { kind: "adjacent-deposit" }
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
  | { kind: "sprout-slot"; limit: number }
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
/**
 * Neurons sprout from the network by themselves, like creep: a paid neuron
 * grows while it touches a connected structure, without the builder. A
 * network grows more sprouts at once as its territory grows, so expansion
 * snowballs with map control. The builder only raises towers and upgrades.
 */
export const SPROUT = Object.freeze({
  /** Territory cells per additional concurrent sprout. */
  cellsPerSlot: 50,
  maxSlots: 4,
});
export const isSprout = (
  job: Readonly<Pick<Construction, "kind" | "upgradeFrom">>,
): boolean => job.kind === "neuron" && job.upgradeFrom === undefined;
export function sproutSlots(player: Readonly<Player>): number {
  return Math.min(
    SPROUT.maxSlots,
    1 + Math.floor(player.territory / SPROUT.cellsPerSlot),
  );
}

export function constructionUpgradeSource(
  world: Readonly<World>,
  player: Readonly<Player>,
  kind: BuildKind,
  cell: number,
) {
  return world.structures.find(
    (s) =>
      s.cell === cell &&
      s.ownerId === player.id &&
      CONSTRUCTIONS[kind].upgradesFrom?.includes(s.kind),
  );
}
function occupied(world: Readonly<World>, cell: number, upgradeFrom?: number) {
  return (
    world.structures.some((s) => s.cell === cell && s.id !== upgradeFrom) ||
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
  missing.push(...constructionSiteRequirements(world, kind, cell));
  if (cell === null || world.map.cells[cell]?.terrain !== "open")
    missing.push({ kind: "open-cell" });
  if (
    cell !== null &&
    occupied(
      world,
      cell,
      constructionUpgradeSource(world, player, kind, cell)?.id,
    )
  )
    missing.push({ kind: "unoccupied-cell" });
  if (player.queue.some((j) => j.cell === cell))
    missing.push({ kind: "not-queued" });
  return result(missing);
}

/** Legal queue entries can wait for these conditions; do not reject the queue action. */
export function constructionDispatchAvailability(
  world: Readonly<World>,
  player: Readonly<Player>,
  job: Readonly<Pick<Construction, "cell" | "kind" | "upgradeFrom">>,
): Availability {
  const definition = CONSTRUCTIONS[job.kind];
  const missing = [
    ...living(player),
    ...researchPrerequisites(player, definition.requires),
    ...constructionSiteRequirements(world, job.kind, job.cell),
  ];
  if (isSprout(job)) {
    const limit = sproutSlots(player);
    if (player.queue.filter((j) => j.paid && isSprout(j)).length >= limit)
      missing.push({ kind: "sprout-slot", limit });
  } else if (
    player.worker.mode !== "idle" ||
    player.queue.some((j) => j.paid && !isSprout(j))
  )
    missing.push({ kind: "idle-builder" });
  const source = constructionUpgradeSource(world, player, job.kind, job.cell);
  if (
    occupied(
      world,
      job.cell,
      source?.id === job.upgradeFrom ? source?.id : undefined,
    ) ||
    (job.upgradeFrom !== undefined && source?.id !== job.upgradeFrom)
  )
    missing.push({ kind: "unoccupied-cell" });
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

/**
 * Whether a plan can ever gain the connected neighbours it needs on its own.
 * "connected": the network already touches it. "chained": a queued neuron
 * beside it (itself connected or chained) will touch it once grown, as in a
 * Shift-queued line. "unsupported": nothing built or queued reaches it, so it
 * waits until the network grows beside it by other means.
 */
export type PlanSupport = "connected" | "chained" | "unsupported";

/** Cells holding this player's connected structures, for neighbour counts. */
const connectedCells = (world: Readonly<World>, player: Readonly<Player>) =>
  new Set(
    world.structures
      .filter((s) => s.ownerId === player.id && s.connected)
      .map((s) => s.cell),
  );
const countIn = (world: Readonly<World>, cells: Set<number>, cell: number) =>
  neighbors(world.map, cell).filter((n) => cells.has(n)).length;

/**
 * The support of each of the player's unpaid plans, keyed by cell, plus a
 * prospective plan when `extra` is given (placement asks before queueing).
 * Paid neurons that still touch the network count as future network; a cut
 * off one reverts to waiting on the next step. A pure function of public
 * state, linear in the queue (at most RULES.queueLimit passes).
 */
export function planSupport(
  world: Readonly<World>,
  player: Readonly<Player>,
  extra?: Readonly<Pick<Construction, "cell" | "kind">>,
): Map<number, PlanSupport> {
  const own = connectedCells(world, player);
  const plans: Readonly<Pick<Construction, "cell" | "kind" | "upgradeFrom">>[] =
    player.queue.filter((j) => !j.paid);
  if (extra && !player.queue.some((j) => j.cell === extra.cell))
    plans.push(extra);
  const growing = new Set(
    player.queue
      .filter((j) => j.paid && isSprout(j) && countIn(world, own, j.cell) > 0)
      .map((j) => j.cell),
  );
  const support = new Map<number, PlanSupport>();
  for (let changed = true; changed;) {
    changed = false;
    for (const plan of plans) {
      if (support.has(plan.cell)) continue;
      const required = CONSTRUCTIONS[plan.kind].connectedNeighbors;
      const connected = countIn(world, own, plan.cell);
      const queued = countIn(world, growing, plan.cell);
      const resolved: PlanSupport | null =
        connected >= required
          ? "connected"
          : connected + queued >= required
            ? "chained"
            : null;
      if (!resolved) continue;
      support.set(plan.cell, resolved);
      if (isSprout(plan)) growing.add(plan.cell);
      changed = true;
    }
  }
  for (const plan of plans)
    if (!support.has(plan.cell)) support.set(plan.cell, "unsupported");
  return support;
}

/**
 * Open hexes where this kind could be queued and start at once as far as
 * connection goes: the edge of the connected network. Placement highlights
 * them so the brain's wide artwork cannot hide which hexes touch it.
 */
export function connectedFrontier(
  world: Readonly<World>,
  player: Readonly<Player>,
  kind: BuildKind,
): number[] {
  const own = connectedCells(world, player);
  const candidates = new Set<number>();
  for (const cell of own)
    for (const n of neighbors(world.map, cell))
      if (!own.has(n)) candidates.add(n);
  return [...candidates]
    .filter(
      (cell) =>
        countIn(world, own, cell) >= CONSTRUCTIONS[kind].connectedNeighbors &&
        !constructionUpgradeSource(world, player, kind, cell) &&
        constructionQueueAvailability(world, player, kind, cell).allowed,
    )
    .sort((a, b) => a - b);
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

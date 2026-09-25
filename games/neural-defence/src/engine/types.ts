export type Resource = "biomass" | "insight";
export type StructureKind = "brain" | "neuron" | "tower";
export type Research = "growth" | "excitation" | "conduction";
export type Cell =
  | { terrain: "open"; towerSite?: boolean; variant?: string }
  | { terrain: "blocked"; variant?: string }
  | { terrain: "deposit"; resourceKind: Resource; variant?: string };
export interface MapDefinition {
  schemaVersion: 1;
  id: string;
  width: number;
  height: number;
  layout: "odd-r";
  cells: Cell[];
  spawns: { slot: number; cellIndex: number }[];
}
export interface MatchSettings {
  instantConstruction?: boolean;
  instantResearch?: boolean;
  matchId?: string;
}
export interface RosterEntry {
  id: string;
  slot: number;
}
export interface Construction {
  cell: number;
  kind: "neuron" | "tower";
  paid: boolean;
  progress: number;
  duration: number;
  hp: number;
}
export interface Worker {
  mode: "idle" | "outbound" | "building" | "returning" | "recovering";
  cell: number;
  from: number;
  to: number;
  departedAt: number;
  arrivesAt: number;
  recoverAt: number;
}
export interface Player {
  id: string;
  slot: number;
  alive: boolean;
  biomass: number;
  insight: number;
  sequence: number;
  queue: Construction[];
  worker: Worker;
  research: Research[];
  researchJob: { kind: Research; completesAt: number } | null;
  priorities: Record<string, number>;
  miningRemainders: Record<string, number>;
  statistics: {
    biomassEarned: number;
    insightEarned: number;
    built: number;
    damage: number;
    lost: number;
  };
}
export interface Structure {
  id: number;
  cell: number;
  ownerId: string;
  kind: StructureKind;
  hp: number;
  connected: boolean;
  firingCursor?: number;
}
export interface Particle {
  id: number;
  ownerId: string;
  cell: number;
  destination: number;
  from: number;
  to: number;
  departedAt: number;
  arrivesAt: number;
  recoverAt: number;
  mode: "stationed" | "transit" | "recovering";
  attack: number;
  speed: number;
}
export type Action =
  | { type: "queueConstruction"; cell: number; kind: "neuron" | "tower" }
  | { type: "cancelConstruction"; cell: number }
  | { type: "startResearch"; research: Research }
  | { type: "cancelResearch" }
  | { type: "setPriority"; cell: number; weight: number };
export interface Command {
  playerId: string;
  sequence: number;
  action: Action;
  matchId?: string;
}
export interface Outcome {
  tick: number;
  playerId: string;
  type:
    | "rejected"
    | "queued"
    | "dispatched"
    | "constructed"
    | "researched"
    | "researchStarted"
    | "income"
    | "damage"
    | "destroyed"
    | "eliminated";
  cell?: number;
  /** Origin of a resolved attack; presentation does not infer it from nearby nodes. */
  fromCell?: number;
  amount?: number;
  resource?: Resource;
  reason?: string;
}
export interface World {
  formatVersion: 1;
  rulesVersion: 1;
  matchId: string;
  tick: number;
  map: MapDefinition;
  settings: MatchSettings;
  players: Player[];
  structures: Structure[];
  particles: Particle[];
  nextEntityId: number;
  outcomes: Outcome[];
  winnerId: string | null;
  finished: boolean;
}
export const RULES = Object.freeze({
  version: 1,
  ticksPerSecond: 20,
  particleCount: 128,
  particleSpeed: 4,
  edgeLaunchCapacity: 8,
  edgeTransitCapacity: 32,
  nodeCapacity: 32,
  queueLimit: 32,
  neuronCost: 20_000,
  towerCost: 60_000,
  constructionTicks: 120,
  towerConstructionTicks: 240,
  researchCost: 10_000,
  researchTicks: 400,
  recoveryTicks: 120,
  bankCap: 1_000_000_000,
});

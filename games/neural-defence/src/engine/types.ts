import type { Buff, Powerup } from "./powerups.js";
import type { MatchEvent, TimelineSample } from "./timeline.js";
export type Resource = "biomass" | "insight";
export const AI_STRATEGIES = [
  "balanced",
  "pressure",
  "economy",
  "siege",
  "relay",
  "defensive",
  "swarm",
] as const;
export type AiStrategy = (typeof AI_STRATEGIES)[number];
export const isAiStrategy = (value: unknown): value is AiStrategy =>
  typeof value === "string" && AI_STRATEGIES.some((kind) => kind === value);
export type ParticleKind = "pulse" | "heavy" | "swift";
export type BuildKind =
  "neuron" | "tower" | "siege" | "relay" | "harvester" | "bastion" | "spore";
export type StructureKind = "brain" | BuildKind;
export type Research =
  "growth" | "excitation" | "conduction" | "ballistics" | "resonance";
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
  aiStrategy?: AiStrategy;
  instantConstruction?: boolean;
  instantResearch?: boolean;
  matchId?: string;
  /** Random powerups spawn on contested tiles. Off unless enabled. */
  powerups?: boolean;
}
export interface RosterEntry {
  id: string;
  slot: number;
}
export interface Construction {
  /** Identity of an owned structure retained until specialization completes. */
  upgradeFrom?: number;
  cell: number;
  kind: BuildKind;
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
  autoExpand: boolean;
  particleKind: ParticleKind;
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
    sitesLost: number;
  };
  /** Timed effects from claimed powerups, sorted by kind. */
  buffs: Buff[];
  /** Cells this player's connected network claims (see territory.ts). */
  territory: number;
  /** Tick this player's share first reached dominance, or null. */
  dominanceSince: number | null;
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
  kind: ParticleKind;
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
  | { type: "setParticleKind"; kind: ParticleKind }
  | { type: "setAutoExpand"; enabled: boolean }
  | { type: "queueConstruction"; cell: number; kind: BuildKind }
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
    | "shielded"
    | "destroyed"
    | "eliminated"
    | "claimed"
    | "dominating"
    | "dominanceBroken";
  cell?: number;
  /** Origin of a resolved attack; presentation does not infer it from nearby nodes. */
  fromCell?: number;
  amount?: number;
  resource?: Resource;
  reason?: string;
}
export interface World {
  formatVersion: 1;
  rulesVersion: 11;
  matchId: string;
  tick: number;
  map: MapDefinition;
  settings: MatchSettings;
  players: Player[];
  structures: Structure[];
  particles: Particle[];
  nextEntityId: number;
  /** Powerups on the board, and how many have ever spawned (their draw counter). */
  powerups: Powerup[];
  powerupSerial: number;
  outcomes: Outcome[];
  winnerId: string | null;
  finished: boolean;
  /** How the match was won; null while running or after a mutual loss. */
  victory: "elimination" | "dominance" | null;
  /** Samples and decisive moments for the statistics screen (timeline.ts). */
  timeline: TimelineSample[];
  events: MatchEvent[];
}
export const RULES = Object.freeze({
  version: 11,
  /** Most brains in one match. Maps, seats, colours and bounds all follow it. */
  maxPlayers: 8,
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

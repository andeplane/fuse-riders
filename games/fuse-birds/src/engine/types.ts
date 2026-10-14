export const RULES = "fuse-birds-7";
export const PRACTICE_RULES = "fuse-birds-practice-1";
export const WIDTH = 1536,
  HEIGHT = 768,
  UNIT = 256,
  CHUNK = 128;
export const GRAVITY = 24,
  MAX_VX = 3072,
  MAX_VY = 2560,
  QUANTUM = 16;
export const BODY_X = 5 * UNIT,
  BODY_Y = 6 * UNIT;
export const TURN_TICKS = 500,
  SHOT_STEPS = 600,
  START_AMMO = 3,
  MAX_AMMO = 5;
export const WINDS = [-2, -1, 0, 1, 2] as const;
export type Weapon = "pebble" | "scatter";
export type Phase =
  "preparing" | "aiming" | "flight" | "settling" | "over" | "fault";
export interface Player {
  id: string;
  name: string;
  slot: number;
  x: number;
  y: number;
  hp: number;
  ammo: number;
  ordinal: number;
}
export interface Projectile {
  id: number;
  shot: number;
  owner: string;
  kind: Weapon | "fragment";
  x: number;
  y: number;
  vx: number;
  vy: number;
  expires: number;
  cleared: boolean;
}
export interface Crate {
  id: number;
  x: number;
  y: number;
  vy: number;
  grounded: boolean;
}
export interface Terrain {
  bits: Uint8Array;
  revisions: number[];
  version: number;
}
export interface Vector {
  vx: number;
  vy: number;
}
export interface Witness extends Vector {
  from: string;
  to: string;
  wind: number;
}
export interface Preparation {
  attempt: number;
  pair: number;
  wind: number;
  candidate: number;
  work: number;
  witnesses: Witness[];
}
export interface CrateSearch {
  sites: number[];
  site: number;
  player: number;
  candidate: number;
  work: number;
}
export interface Match {
  rules: typeof RULES | typeof PRACTICE_RULES;
  id: string;
  seed: number;
  rng: number;
  round: number;
  tick: number;
  step: number;
  phase: Phase;
  terrain: Terrain;
  players: Player[];
  projectiles: Projectile[];
  crates: Crate[];
  crateSearch: CrateSearch | null;
  active: number;
  turn: number;
  deadline: number;
  water: number;
  wind: number;
  cycle: number;
  remaining: string[];
  nextEntity: number;
  shot: number;
  preparation: Preparation;
  winner: string | null;
  fault: string | null;
}
export type Action = {
  actor: string;
  round: number;
  turn: number;
  ordinal: number;
} & (
  { type: "launch"; weapon: Weapon; vx: number; vy: number } | { type: "pass" }
);
export type Fact = {
  type:
    | "shot"
    | "blast"
    | "split"
    | "pickup"
    | "damage"
    | "eliminated"
    | "turn"
    | "result"
    | "rejected";
  x?: number;
  y?: number;
  radius?: number;
  actor?: string;
  amount?: number;
  reason?: string;
};
export interface PlayerSpec {
  id: string;
  name: string;
  /** Stable identity/color slot, independent of the current roster's array index. */
  slot?: number;
}

export function integer(
  value: unknown,
  low: number,
  high: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= low &&
    value <= high
  );
}
export function nextRandom(state: { rng: number }): number {
  let x = state.rng || 0x9e3779b9;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state.rng = x >>> 0;
  return state.rng;
}
export function legalVector(vx: unknown, vy: unknown): boolean {
  return (
    integer(vx, -MAX_VX, MAX_VX) &&
    integer(vy, -MAX_VY, MAX_VY) &&
    vx % QUANTUM === 0 &&
    vy % QUANTUM === 0 &&
    Math.abs(vx) + Math.abs(vy) >= 128
  );
}
export function quantize(vx: number, vy: number): Vector {
  return {
    vx: Math.max(-MAX_VX, Math.min(MAX_VX, Math.round(vx / QUANTUM) * QUANTUM)),
    vy: Math.max(-MAX_VY, Math.min(MAX_VY, Math.round(vy / QUANTUM) * QUANTUM)),
  };
}

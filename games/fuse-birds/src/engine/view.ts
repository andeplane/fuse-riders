import {
  HEIGHT,
  WIDTH,
  type Crate,
  type Match,
  type Phase,
  type Player,
  type Projectile,
  type Terrain,
} from "./types.js";
export interface WorldView {
  id: string;
  round: number;
  tick: number;
  phase: Phase;
  width: number;
  height: number;
  players: readonly Readonly<Player>[];
  projectiles: readonly Readonly<Projectile>[];
  crates: readonly Readonly<Crate>[];
  terrain: Readonly<Terrain>;
  active: number;
  turn: number;
  timeLeft: number;
  wind: number;
  water: number;
  movement: number;
  progress: number;
  winner: string | null;
  fault: string | null;
}
/** Owns copies: a consumer cannot mutate the game or a retained rollback snapshot. */
export function getView(state: Match): WorldView {
  return {
    id: state.id,
    round: state.round,
    tick: state.step,
    phase: state.phase,
    width: WIDTH,
    height: HEIGHT,
    players: state.players.map((p) => ({ ...p })),
    projectiles: state.projectiles.map((p) => ({ ...p })),
    crates: state.crates.map((c) => ({ ...c })),
    terrain: {
      bits: state.terrain.bits.slice(),
      revisions: [...state.terrain.revisions],
      version: state.terrain.version,
    },
    active: state.active,
    turn: state.turn,
    timeLeft: Math.max(0, state.deadline - state.tick) / 20,
    wind: state.wind,
    water: state.water,
    movement: state.movement,
    progress:
      state.preparation.witnesses.length /
      (state.players.length * (state.players.length - 1) * 5),
    winner: state.winner,
    fault: state.fault,
  };
}
export type { Fact, Weapon, Vector } from "./types.js";
export { UNIT, BODY_X, BODY_Y, CHUNK } from "./types.js";

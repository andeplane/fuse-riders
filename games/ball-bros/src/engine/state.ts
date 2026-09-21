import { cos, sin, TAU, wrap } from "./math.js";

export const RULES = "ball-bros-1";
export const SIZE = 1000,
  CENTER = 500,
  ARENA = 470;
export const CORE = 17,
  PADDLE = 77,
  PADDLE_HALF = (35 * Math.PI) / 180,
  PADDLE_THICK = 5;
export const BALL_RADIUS = 6,
  BALL_SPEED = 340,
  TURN_SPEED = 3.2;
export const COUNTDOWN = 60,
  AUTO_LAUNCH = 60,
  LIMIT = 2400,
  SUBSTEPS = 5,
  DT = 0.01;
export type Steering = -1 | 0 | 1;
export interface Control {
  steer: Steering;
  launch: boolean;
}
export interface Participant {
  id: string;
  name: string;
  slot: number;
  bot: boolean;
}
export interface Block {
  x: number;
  y: number;
  alive: boolean;
}
export interface Base extends Participant {
  x: number;
  y: number;
  angle: number;
  alive: boolean;
  blocks: Block[];
  steer: Steering;
  launch: boolean;
  saves: number;
  broken: number;
}
export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: string | null;
  held: string | null;
}
export interface ArenaState {
  tick: number;
  phase: "countdown" | "playing" | "over";
  bases: Base[];
  balls: Ball[];
  winner: string | null;
}
export interface Impact {
  kind: "paddle" | "block" | "core" | "wall" | "launch";
  x: number;
  y: number;
  slot: number;
}

export function blockLayout(): Block[] {
  return [10, 14].flatMap((count, ring) =>
    Array.from({ length: count }, (_, i) => {
      const angle = (TAU * (i + ring * 0.5)) / count;
      return {
        x: cos(angle) * (37 + ring * 19),
        y: sin(angle) * (37 + ring * 19),
        alive: true,
      };
    }),
  );
}
export function createArena(participants: readonly Participant[]): ArenaState {
  const bases = [...participants]
    .sort((a, b) => a.slot - b.slot)
    .map((p, i) => {
      const a = -Math.PI / 2 + (TAU * i) / participants.length;
      return {
        id: p.id,
        name: p.name,
        slot: p.slot,
        bot: p.bot,
        x: CENTER + cos(a) * 285,
        y: CENTER + sin(a) * 285,
        angle: wrap(a + Math.PI),
        alive: true,
        blocks: blockLayout(),
        steer: 0 as Steering,
        launch: false,
        saves: 0,
        broken: 0,
      };
    });
  return {
    tick: 0,
    phase: "countdown",
    bases,
    winner: null,
    balls: bases.map((b, id) => ({
      id,
      x: b.x + cos(b.angle) * 90,
      y: b.y + sin(b.angle) * 90,
      vx: 0,
      vy: 0,
      owner: b.id,
      held: b.id,
    })),
  };
}
export function control(state: ArenaState, id: string, input: Control): void {
  const base = state.bases.find((b) => b.id === id);
  if (base?.alive && state.phase !== "over") {
    base.steer = input.steer;
    base.launch ||= input.launch;
  }
}

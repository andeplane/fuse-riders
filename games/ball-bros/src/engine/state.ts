import { cos, sin, TAU, wrap } from "./math.js";

export const RULES = "ball-bros-4";
export const POWER_KINDS = [
  "shrink",
  "bomb",
  "sticky",
  "thief",
  "split",
] as const;
export type PowerKind = (typeof POWER_KINDS)[number];
export const MAX_BALLS = 20,
  PICKUP_RADIUS = 18,
  EFFECT_TICKS = 160;
export interface Pickup {
  id: number;
  kind: PowerKind;
  x: number;
  y: number;
  expires: number;
}
export const SIZE = 1000,
  CENTER = 500,
  ARENA = 470;
export const CORE = 17,
  PADDLE = 104,
  PADDLE_MIN = 88,
  PADDLE_MAX = 124,
  RADIAL_SPEED = 90,
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
  radial: Steering;
  launch: boolean;
}
export interface Participant {
  id: string;
  name: string;
  slot: number;
  bot: boolean;
  avatarId?: string;
}
export interface Block {
  x: number;
  y: number;
  alive: boolean;
}
export interface Base extends Participant {
  avatarId: string;
  x: number;
  y: number;
  angle: number;
  radius: number;
  alive: boolean;
  blocks: Block[];
  steer: Steering;
  radial: Steering;
  launch: boolean;
  saves: number;
  broken: number;
  shrink: number[];
  stickyUntil: number;
  thiefUntil: number;
  stunUntil: number;
}
export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: string | null;
  held: string | null;
  heldUntil: number;
  bomb: boolean;
  splits: number;
}
export interface ArenaState {
  tick: number;
  phase: "countdown" | "playing" | "over";
  bases: Base[];
  balls: Ball[];
  winner: string | null;
  pickups: Pickup[];
}
export interface Impact {
  kind: "paddle" | "block" | "core" | "wall" | "launch" | "pickup" | "bomb";
  power?: PowerKind;
  x: number;
  y: number;
  slot: number;
}

// Outward unit normals of a regular octagon with flat cardinal walls.
export const WALLS = Array.from({ length: 8 }, (_, i) => ({
  x: cos((TAU * i) / 8),
  y: sin((TAU * i) / 8),
}));
export const VERTICES = WALLS.map((n, i) => {
  const next = WALLS[(i + 1) % WALLS.length]!;
  const scale = ARENA / (1 + n.x * next.x + n.y * next.y);
  return {
    x: CENTER + (n.x + next.x) * scale,
    y: CENTER + (n.y + next.y) * scale,
  };
});
export const insideArena = (x: number, y: number, margin = BALL_RADIUS) =>
  WALLS.every(
    (n) => (x - CENTER) * n.x + (y - CENTER) * n.y <= ARENA - margin + 0.01,
  );
// Keep arc length fixed: reaching out trades coverage for an earlier interception.
export const paddleHalf = (radius: number) => (PADDLE_HALF * PADDLE) / radius;
export const paddleScale = (base: Base) => Math.pow(0.75, base.shrink.length);
export const nextRadius = (base: Base) =>
  Math.max(
    PADDLE_MIN,
    Math.min(PADDLE_MAX, base.radius + base.radial * RADIAL_SPEED * DT),
  );
/** Keep even a moving rounded tip slower than a ball, so a return can separate
 * without accelerating balls or trapping them in repeated contacts. */
export function paddleMotion(base: Base) {
  const radius = nextRadius(base);
  const radialSpeed = (radius - base.radius) / DT;
  const tangential =
    Math.sqrt(300 * 300 - radialSpeed * radialSpeed) -
    Math.abs(radialSpeed) * paddleHalf(Math.min(radius, base.radius));
  const omega =
    base.steer *
    Math.min(TURN_SPEED, tangential / Math.max(radius, base.radius));
  return { radius, radialSpeed, omega };
}

export function blockLayout(): Block[] {
  return [12, 16, 20].flatMap((count, ring) =>
    Array.from({ length: count }, (_, i) => {
      const angle = (TAU * (i + ring * 0.5)) / count;
      return {
        x: cos(angle) * (34 + ring * 16),
        y: sin(angle) * (34 + ring * 16),
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
      const distance =
        (ARENA - PADDLE_MAX - 21) /
        Math.max(...WALLS.map((n) => n.x * cos(a) + n.y * sin(a)));
      return {
        id: p.id,
        name: p.name,
        slot: p.slot,
        bot: p.bot,
        avatarId: p.avatarId ?? (p.bot ? "robot" : "fox"),
        x: CENTER + cos(a) * distance,
        y: CENTER + sin(a) * distance,
        angle: wrap(a + Math.PI),
        radius: PADDLE,
        alive: true,
        blocks: blockLayout(),
        steer: 0 as Steering,
        radial: 0 as Steering,
        launch: false,
        saves: 0,
        broken: 0,
        shrink: [],
        stickyUntil: 0,
        thiefUntil: 0,
        stunUntil: 0,
      };
    });
  return {
    tick: 0,
    phase: "countdown",
    bases,
    winner: null,
    pickups: [],
    balls: bases.map((b, id) => ({
      id,
      x: b.x + cos(b.angle) * (b.radius + 13),
      y: b.y + sin(b.angle) * (b.radius + 13),
      vx: 0,
      vy: 0,
      owner: b.id,
      held: b.id,
      heldUntil: COUNTDOWN + AUTO_LAUNCH,
      bomb: false,
      splits: 0,
    })),
  };
}
export function control(state: ArenaState, id: string, input: Control): void {
  const base = state.bases.find((b) => b.id === id);
  if (base?.alive && state.phase !== "over") {
    base.steer = input.steer;
    base.radial = input.radial;
    base.launch ||= input.launch;
  }
}

/** All authoritative lengths/velocities use integer subunits (1024 per world unit). */
export const RULES = "hook-havok-3";
export const S = 1024;
export const WIDTH = 1600,
  HEIGHT = 900,
  HALF = 16 * S,
  BODY = 52 * S;
export const PLATFORMS = [
  [120, 810, 400, 40],
  [220, 670, 220, 28],
  [570, 610, 240, 28],
  [250, 470, 230, 28],
  [950, 480, 250, 28],
  [620, 330, 260, 28],
  [1170, 270, 250, 28],
  [670, 120, 300, 28],
] as const;
export interface Tuning {
  experiment: "movement" | "target" | "ball";
  speed: number;
  jump: number;
  gravity: number;
  air: number;
  pull: number;
  range: number;
}
export const DEFAULT_TUNING: Tuning = {
  experiment: "movement",
  speed: 360,
  jump: 760,
  gravity: 1800,
  air: 55,
  pull: 2800,
  range: 650,
};
export interface Input {
  move: -1 | 0 | 1;
  jump: boolean;
  fire: boolean;
  reset: boolean;
  aimX: number;
  aimY: number;
}
export const NEUTRAL: Input = {
  move: 0,
  jump: false,
  fire: false,
  reset: false,
  aimX: 800,
  aimY: 100,
};
export interface Hook {
  phase: "ready" | "flying" | "attached" | "retracting";
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  distance: number;
  platform: number;
}
export interface World {
  slot: number;
  combat: Combat;
  tick: number;
  x: number;
  feet: number;
  vx: number;
  vy: number;
  grounded: boolean;
  coyote: number;
  buffer: number;
  respawn: number;
  deaths: number;
  facing: -1 | 1;
  input: Input;
  previous: Input;
  hook: Hook;
  tuning: Tuning;
}
export interface Target {
  x: number;
  feet: number;
  vx: number;
  vy: number;
  grounded: boolean;
  respawn: number;
}
export interface Ball {
  id: number;
  tier: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}
export interface Combat {
  target: Target | null;
  balls: Ball[];
  hits: number;
  falls: number;
  impact: { tick: number; x: number; y: number };
}
export const BALL_FIELD = [850, 650, 600, 200] as const;
export const BALL_RADII = [14, 24, 40] as const;
export function createTarget(): Target {
  return {
    x: 450 * S,
    feet: 810 * S - 1,
    vx: 0,
    vy: 0,
    grounded: true,
    respawn: 0,
  };
}
export function createCombat(mode: Tuning["experiment"]): Combat {
  return {
    target: mode === "target" ? createTarget() : null,
    balls:
      mode === "ball"
        ? [{ id: 1, tier: 2, x: 940 * S, y: 720 * S, vx: 2 * S, vy: 0 }]
        : [],
    hits: 0,
    falls: 0,
    impact: { tick: 0, x: 0, y: 0 },
  };
}
export function readyHook(): Hook {
  return {
    phase: "ready",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    distance: 0,
    platform: -1,
  };
}
export function createWorld(tuning: Tuning = DEFAULT_TUNING, slot = 0): World {
  return {
    slot,
    combat: createCombat(tuning.experiment),
    tick: 0,
    x: [310, 170, 240, 380, 450][slot]! * S,
    feet: 810 * S - 1,
    vx: 0,
    vy: 0,
    grounded: true,
    coyote: 6,
    buffer: 0,
    respawn: 0,
    deaths: 0,
    facing: 1,
    input: { ...NEUTRAL },
    previous: { ...NEUTRAL },
    hook: readyHook(),
    tuning: { ...tuning },
  };
}
export function resetWorld(world: World): void {
  const fresh = createWorld(world.tuning, world.slot);
  Object.assign(world, fresh, {
    tick: world.tick,
    deaths: world.deaths,
    input: { ...world.input },
    previous: { ...world.input },
  });
}
export function cancel(world: World): void {
  world.input = { ...NEUTRAL, aimX: world.input.aimX, aimY: world.input.aimY };
  world.previous = { ...world.input };
  world.buffer = 0;
  world.hook = readyHook();
}

import { MAPS, type MapId } from "./maps.js";
/** All authoritative lengths/velocities use integer subunits (1024 per world unit). */
export const RULES = "hook-havok-8";
export const S = 1024;
export const WIDTH = 1600,
  HEIGHT = 900,
  HALF = 16 * S,
  BODY = 52 * S;
/** Original belfry geometry, retained for its traversal fixtures. Runtime uses tuning.map. */
export const PLATFORMS = MAPS.belfry.platforms;
export interface Tuning {
  jumpMode: "single" | "double";
  wire: "tip" | "spiked";
  map: MapId;
  rules: "free" | "elimination" | "score";
  experiment: "movement" | "target" | "ball" | "ricochet" | "surge";
  speed: number;
  jump: number;
  gravity: number;
  air: number;
  pull: number;
  range: number;
}
export const DEFAULT_TUNING: Tuning = {
  jumpMode: "single",
  wire: "tip",
  map: "belfry",
  rules: "free",
  experiment: "movement",
  speed: 360,
  jump: 760,
  gravity: 1800,
  air: 55,
  pull: 2800,
  range: 650,
};
export interface Input {
  drop: boolean;
  move: -1 | 0 | 1;
  jump: boolean;
  fire: boolean;
  reset: boolean;
  aimX: number;
  aimY: number;
}
export const NEUTRAL: Input = {
  drop: false,
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
  airJump: boolean;
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
export const BALL_FIELD = MAPS.belfry.ballField;
export const BALL_RADII = [14, 24, 40] as const;
export const isBallMode = (mode: Tuning["experiment"]): boolean =>
  mode === "ball" || mode === "ricochet" || mode === "surge";
export function ballField(
  mode: Tuning["experiment"],
  map: MapId,
): readonly [number, number, number, number] {
  return mode === "ball" ? MAPS[map].ballField : [0, 0, WIDTH, 870];
}
export function ballSpeed(mode: Tuning["experiment"], tier: number): number {
  return (4 - tier) * S * (mode === "surge" ? 2 : 1);
}
export function ballBounce(mode: Tuning["experiment"]): number {
  return (mode === "ball" ? 5 : mode === "surge" ? 11 : 8) * S;
}
export function createTarget(map: MapId = "belfry"): Target {
  const [x, feet] = MAPS[map].target;
  return {
    x: x * S,
    feet: feet * S - 1,
    vx: 0,
    vy: 0,
    grounded: true,
    respawn: 0,
  };
}
export function createCombat(
  mode: Tuning["experiment"],
  map: MapId = "belfry",
): Combat {
  return {
    target: mode === "target" ? createTarget(map) : null,
    balls: isBallMode(mode)
      ? [
          {
            id: 1,
            tier: 2,
            x: MAPS[map].ballSpawn[0] * S,
            y: (mode === "ball" ? MAPS[map].ballSpawn[1] : 740) * S,
            vx: ballSpeed(mode, 2),
            vy: 0,
          },
        ]
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
  const [x, feet] = MAPS[tuning.map].spawns[slot]!;
  return {
    slot,
    airJump: tuning.jumpMode === "double",
    combat: createCombat(tuning.experiment, tuning.map),
    tick: 0,
    x: x * S,
    feet: feet * S - 1,
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

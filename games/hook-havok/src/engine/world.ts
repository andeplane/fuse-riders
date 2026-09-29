import { MAPS, type MapId } from "./maps.js";
import { ALL_POWERS, DASH_KEEP } from "./power-rules.js";
/** All authoritative lengths/velocities use integer subunits (1024 per world unit). */
export const RULES = "hook-havok-15";
export const S = 1024;
export const WIDTH = 1600,
  HEIGHT = 900,
  HALF = 16 * S,
  BODY = 52 * S;
/** Hook flight in world units per tick; the rope never reels shorter than ROPE_MIN units. */
export const HOOK_SPEED = 32,
  ROPE_MIN = 40;
/** Original belfry geometry, retained for its traversal fixtures. Runtime uses tuning.map. */
export const PLATFORMS = MAPS.belfry.platforms;
export interface Tuning {
  /** How well AI keepers play (11C); only rooms with bots feel it. */
  botLevel: "easy" | "normal" | "hard";
  /** Thrown bomb trial (11B): off, a timed fuse, or impact on a rival. */
  bomb: "off" | "fuse" | "impact";
  /** Power-up pool (11D): a bit per kind in POWER_KINDS order, 0 off, ALL_POWERS all. */
  powerUps: number;
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
  botLevel: "normal",
  bomb: "fuse",
  powerUps: ALL_POWERS,
  jumpMode: "double",
  wire: "spiked",
  map: "crossroads",
  rules: "free",
  experiment: "ricochet",
  speed: 360,
  jump: 760,
  gravity: 1800,
  air: 55,
  /** Rope reel-in speed, units/s, while the hook is held. */
  pull: 850,
  range: 650,
};
/** The pre-10A trial defaults: belfry, no balls, single jump, tip-only hook, no bombs or power-ups. Fixtures pin it. */
export const CLASSIC_TUNING: Tuning = {
  ...DEFAULT_TUNING,
  bomb: "off",
  powerUps: 0,
  wire: "tip",
  jumpMode: "single",
  map: "belfry",
  experiment: "movement",
};
export interface Input {
  drop: boolean;
  move: -1 | 0 | 1;
  jump: boolean;
  fire: boolean;
  /** Held to charge a bomb; the release throws toward that tick's aim. */
  bomb: boolean;
  reset: boolean;
  aimX: number;
  aimY: number;
}
export const NEUTRAL: Input = {
  drop: false,
  move: 0,
  jump: false,
  fire: false,
  bomb: false,
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
  /** Air actions a power adds on top of the air jump (Triple jump, Dash bump). */
  bonusJumps: number;
  /** Ticks left in a Dash bump; the dash holds its velocity until 0. */
  dash: number;
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
  /** Ticks the bomb button has been held while armed; 0 when not charging. */
  charge: number;
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
    bonusJumps: 0,
    dash: 0,
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
    charge: 0,
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
  // A cancelled charge is dropped, never thrown.
  world.charge = 0;
  world.hook = readyHook();
  world.bonusJumps = 0;
  endDash(world);
}
/** A dash ends keeping part of its speed; nothing happens outside a dash. */
export function endDash(world: World): void {
  if (!world.dash) return;
  world.dash = 0;
  world.vx = Math.round(world.vx * DASH_KEEP);
  world.vy = Math.round(world.vy * DASH_KEEP);
}

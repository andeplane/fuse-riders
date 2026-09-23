import {
  BALL_FIELD,
  BALL_RADII,
  BODY,
  HALF,
  PLATFORMS,
  S,
  type World,
} from "./world.js";
export interface WorldView {
  keepers: KeeperView[];
  hit: {
    tick: number;
    by: string;
    target: string;
    x: number;
    y: number;
  } | null;
  localId?: string;
  experiment: World["tuning"]["experiment"];
  combat: {
    target: { x: number; feet: number; respawn: number } | null;
    balls: { id: number; x: number; y: number; radius: number }[];
    field: readonly [number, number, number, number];
    hits: number;
    falls: number;
    impact: { tick: number; x: number; y: number };
  };
  tick: number;
  x: number;
  feet: number;
  vx: number;
  vy: number;
  grounded: boolean;
  facing: -1 | 1;
  respawn: number;
  deaths: number;
  hook: { phase: World["hook"]["phase"]; x: number; y: number };
  platforms: readonly (readonly [number, number, number, number])[];
  body: { half: number; height: number };
  aim: { x: number; y: number };
}
export interface KeeperView {
  id: string;
  slot: number;
  name: string;
  connected: boolean;
  shield: number;
  hits: number;
  body: WorldView;
}
export function toView(world: World): WorldView {
  return {
    keepers: [],
    hit: null,
    experiment: world.tuning.experiment,
    combat: {
      target: world.combat.target
        ? {
            x: world.combat.target.x / S,
            feet: world.combat.target.feet / S,
            respawn: world.combat.target.respawn,
          }
        : null,
      balls: world.combat.balls.map((b) => ({
        id: b.id,
        x: b.x / S,
        y: b.y / S,
        radius: BALL_RADII[b.tier]!,
      })),
      field: BALL_FIELD,
      hits: world.combat.hits,
      falls: world.combat.falls,
      impact: {
        tick: world.combat.impact.tick,
        x: world.combat.impact.x / S,
        y: world.combat.impact.y / S,
      },
    },
    tick: world.tick,
    x: world.x / S,
    feet: world.feet / S,
    vx: (world.vx * 60) / S,
    vy: (world.vy * 60) / S,
    grounded: world.grounded,
    facing: world.facing,
    respawn: world.respawn,
    deaths: world.deaths,
    hook: { phase: world.hook.phase, x: world.hook.x / S, y: world.hook.y / S },
    platforms: PLATFORMS,
    body: { half: HALF / S, height: BODY / S },
    aim: { x: world.input.aimX, y: world.input.aimY },
  };
}

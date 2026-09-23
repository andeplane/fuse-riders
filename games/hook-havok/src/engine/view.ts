import { BODY, HALF, PLATFORMS, S, type World } from "./world.js";
export interface WorldView {
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
export function toView(world: World): WorldView {
  return {
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

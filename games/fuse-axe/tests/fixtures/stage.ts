import { planOf, waveSpawns, type World } from "../../src/engine/index.js";

/**
 * The world with its stage won, as the last wave leaves it: the camera (and the party with it) at the last trigger,
 * that wave begun now with every spawn in and fought, no enemy left.
 */
export function cleared(world: World): World {
  const { waves } = planOf(world),
    last = waves.at(-1)!,
    shift = Math.max(0, last.at - world.camX);
  return {
    ...world,
    camX: world.camX + shift,
    heroes: world.heroes.map((hero) => ({ ...hero, x: hero.x + shift })),
    wave: waves.length,
    locked: false,
    waveStep: world.step,
    spawned: waveSpawns(last, world.heroes.length).length,
    enemies: [],
  };
}

/** The world with every hero out of lives where it stands, as the last fall leaves it. */
export const wiped = (world: World): World => ({
  ...world,
  heroes: world.heroes.map((hero) => ({
    ...hero,
    state: "out",
    timer: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    hp: 0,
    lives: 0,
  })),
});

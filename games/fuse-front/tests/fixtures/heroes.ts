import {
  MAX_LEVEL,
  MAX_XP,
  respawnSteps,
  type World,
} from "../../src/engine/index.js";

/**
 * The world with every hero dead at the top level, waiting its full respawn (1,040 steps), so a rule test about
 * units, turrets or forts sees no hero shoot, capture or level up. It still decodes.
 */
export const benchHeroes = (world: World): World => ({
  ...world,
  heroes: world.heroes.map((hero) => ({
    ...hero,
    hp: 0,
    xp: MAX_XP,
    cooldown: 0,
    respawn: respawnSteps(MAX_LEVEL),
  })),
});

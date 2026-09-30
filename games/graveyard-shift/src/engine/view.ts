import { GRAVES, SHRINES, WALLS, type World } from "./world.js";
/** Presentation gets a detached snapshot, including the arena geometry it draws. */
export interface WorldView extends World {
  arena: {
    graves: typeof GRAVES;
    shrines: typeof SHRINES;
    walls: typeof WALLS;
  };
}
export const toView = (world: World): WorldView => ({
  ...structuredClone(world),
  arena: {
    graves: GRAVES.map((p) => ({ ...p })),
    shrines: SHRINES.map((p) => ({ ...p })),
    walls: WALLS.map((p) => ({ ...p })),
  },
});

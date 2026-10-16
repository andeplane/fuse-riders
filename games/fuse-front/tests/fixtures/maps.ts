import { readFileSync } from "node:fs";
import { loadMap, type GameMap, type MapFile } from "../../src/engine/index.js";

export const DUST_BASIN_FILE = new URL(
  "../../maps/dust-basin.json",
  import.meta.url,
);

export const dustBasin = (): GameMap =>
  loadMap(JSON.parse(readFileSync(DUST_BASIN_FILE, "utf8")));

/**
 * A small map for rule tests: flags 0 and 1 are the west and east homes (forts 0 and 1), flag 2 the middle with a
 * robot factory, flag 3 the south-west home of fort 2, and flag 4 the south-east with a vehicle factory.
 */
export const tinyFile = (): MapFile => ({
  name: "Tiny",
  width: 14,
  height: 10,
  terrain: [
    "##############",
    "#............#",
    "#............#",
    "#.....##.....#",
    "#............#",
    "#............#",
    "#............#",
    "#............#",
    "#............#",
    "##############",
  ],
  flags: [
    { x: 2, y: 2 },
    { x: 11, y: 2 },
    { x: 6, y: 5 },
    { x: 2, y: 7 },
    { x: 11, y: 7 },
  ],
  buildings: [
    { kind: "robotFactory", x: 7, y: 5 },
    { kind: "vehicleFactory", x: 10, y: 7 },
    { kind: "turret", x: 6, y: 6 },
  ],
  forts: [
    { seat: 1, x: 12, y: 1 },
    { seat: 0, x: 1, y: 1 },
    { seat: 2, x: 1, y: 8 },
  ],
});

export const tiny = (): GameMap => loadMap(tinyFile());

/** Sites on the tiny map by id: the buildings in file order, then the forts by seat. */
export const TINY = {
  robotFactory: 0,
  vehicleFactory: 1,
  turret: 2,
  fort0: 3,
  fort1: 4,
  fort2: 5,
  middle: 2,
  southEast: 4,
} as const;

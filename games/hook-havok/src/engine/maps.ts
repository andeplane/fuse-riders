export type MapId = "belfry" | "crossroads";
export type Platform = readonly [number, number, number, number];
interface Layout {
  readonly platforms: readonly Platform[];
  readonly spawns: readonly (readonly [number, number])[];
  readonly target: readonly [number, number];
  readonly ballField: readonly [number, number, number, number];
  readonly ballSpawn: readonly [number, number];
}
/** World units; stable platform order is part of the collision and checkpoint contract. */
export const MAPS: Readonly<Record<MapId, Layout>> = {
  belfry: {
    platforms: [
      [120, 810, 400, 40],
      [220, 670, 220, 28],
      [570, 610, 240, 28],
      [250, 470, 230, 28],
      [950, 480, 250, 28],
      [620, 330, 260, 28],
      [1170, 270, 250, 28],
      [670, 120, 300, 28],
    ],
    spawns: [
      [310, 810],
      [170, 810],
      [240, 810],
      [380, 810],
      [450, 810],
    ],
    target: [450, 810],
    ballField: [850, 650, 600, 200],
    ballSpawn: [940, 720],
  },
  crossroads: {
    platforms: [
      [80, 810, 200, 32],
      [390, 810, 200, 32],
      [700, 810, 200, 32],
      [1010, 810, 200, 32],
      [1320, 810, 200, 32],
      [330, 660, 260, 28],
      [690, 660, 220, 28],
      [1010, 660, 260, 28],
      [90, 510, 280, 28],
      [660, 510, 280, 28],
      [1230, 510, 280, 28],
      [350, 360, 280, 28],
      [970, 360, 280, 28],
      [650, 210, 300, 28],
    ],
    spawns: [
      [180, 810],
      [1420, 810],
      [800, 810],
      [490, 810],
      [1110, 810],
    ],
    target: [850, 810],
    ballField: [600, 610, 400, 200],
    ballSpawn: [800, 700],
  },
};
export const isMapId = (value: unknown): value is MapId =>
  value === "belfry" || value === "crossroads";

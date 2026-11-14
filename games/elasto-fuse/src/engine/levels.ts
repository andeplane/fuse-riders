import type { Level, LevelObject, ObjectKind, Point } from "./level.js";
import { RAW_LEVELS } from "./levels-data.js";
import { CAMPAIGN } from "./campaign-data.js";

const KINDS: readonly ObjectKind[] = ["apple", "flower", "killer"];

const points = (flat: readonly number[]): Point[] => {
  const result: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2)
    result.push({ x: flat[i]!, y: flat[i + 1]! });
  return result;
};

/**
 * The original 54-level campaign in canonical order, followed by the imported external tracks.
 * `elasto-fuse-campaign.ts` extracts the internal levels from Elma.res; `elasto-fuse-levels.ts` imports external
 * POT06 files. Coordinates are y up in the original game's scale (a wheel is 0.4 units).
 * These are rules data: changing their geometry or ordering changes `RULES`.
 */
export const LEVELS: readonly Level[] = [
  ...CAMPAIGN,
  ...RAW_LEVELS.map(([id, name, polygons, start, objects]) => ({
    id,
    name,
    polygons: polygons.map(points),
    start: { x: start[0], y: start[1] },
    faceLeft: true,
    objects: objects.map(([kind, x, y]): LevelObject => ({
      kind: KINDS[kind]!,
      x,
      y,
    })),
  })),
];
export const LEVEL_COUNT = LEVELS.length;

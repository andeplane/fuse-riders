import type { Level, LevelObject, ObjectKind, Point } from "./level.js";
import { RAW_LEVELS } from "./levels-data.js";

const KINDS: readonly ObjectKind[] = ["apple", "flower", "killer"];

const points = (flat: readonly number[]): Point[] => {
  const result: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2)
    result.push({ x: flat[i]!, y: flat[i + 1]! });
  return result;
};

/**
 * The tour's levels: every level from Elasto Mania v1.0, converted from its `POT06` file by
 * `scripts/elasto-fuse-levels.ts` and held in `levels-data.ts`. Coordinates are y up in the engine's world units, the
 * original game's own scale (a wheel is 0.4 units), so the imported geometry keeps the feel it had. The start is the
 * bike's left wheel and the bike faces left, as in the original. They are rules data: changing one changes `RULES`.
 */
export const LEVELS: readonly Level[] = RAW_LEVELS.map(
  ([id, name, polygons, start, objects]) => ({
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
  }),
);
export const LEVEL_COUNT = LEVELS.length;

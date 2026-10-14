// Where debris comes to rest. Pure, so it is tested without Phaser.
import { segmentHit, type TerrainView, type Vec2 } from "../../engine/index.js";

/** How far below a chunk's centre it touches rock (px). */
export const CHUNK_FOOT = 3;

/**
 * Where a chunk that ended a frame with its foot in rock stopped: the point its path from `from` (its centre at the
 * start of the frame) to `to` (its centre now) first met the rock, not wherever the frame ended. A fast chunk travels
 * tens of pixels in a frame, so stopping it at `to` would bury it that deep. Returns `to` when the path never touched
 * rock (the foot was not in it), and the start `from` when the chunk began in rock.
 */
export function restingPlace(grid: TerrainView, from: Vec2, to: Vec2): Vec2 {
  const hit = segmentHit(
    grid,
    from.x,
    from.y + CHUNK_FOOT,
    to.x,
    to.y + CHUNK_FOOT,
  );
  return hit ? { x: hit.x, y: hit.y - CHUNK_FOOT } : to;
}

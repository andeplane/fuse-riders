import { wrapImages, type WrapOffset } from '../shared/wrap.js';

/**
 * How a board is put on screen when it is not simply drawn where it is. Geometry lives here rather than in the scene
 * for the same reason `arena-wall.ts` does: it is the part worth testing, and the renderer stays a painter.
 */
export interface ArenaView { x: number; y: number; width: number; height: number; scrollX: number; scrollY: number }

/**
 * The crossed map: the world shifted by half a board in both directions, wrapping at the screen's edges. Four views,
 * each a quarter of the world shown in the diagonally opposite quarter of the screen, so the outer wall meets in a
 * cross at the centre. Viewports are in backing pixels and tile the screen exactly, whatever its parity; a camera
 * draws a world point at its viewport's corner plus the point's distance from the scroll.
 */
export function crossViews(worldWidth: number, worldHeight: number, screenWidth: number, screenHeight: number): ArenaView[] {
  const splitX = Math.round(screenWidth / 2), splitY = Math.round(screenHeight / 2);
  const columns = [{ x: 0, width: splitX, scrollX: worldWidth / 2 }, { x: splitX, width: screenWidth - splitX, scrollX: 0 }];
  const rows = [{ y: 0, height: splitY, scrollY: worldHeight / 2 }, { y: splitY, height: screenHeight - splitY, scrollY: 0 }];
  return rows.flatMap(row => columns.map(column => ({ ...column, ...row })));
}

/** Where on the crossed screen a world point is drawn, as a fraction of the screen: for tests and for anything that must point at the board. */
export function crossScreenPoint(x: number, y: number, worldWidth: number, worldHeight: number): { x: number; y: number } {
  return { x: ((x + worldWidth / 2) % worldWidth) / worldWidth, y: ((y + worldHeight / 2) % worldHeight) / worldHeight };
}

/** Every place something within `reach` of an open edge has to be drawn, its own first. */
export function edgeGhosts(width: number, height: number, x: number, y: number, reach: number): WrapOffset[] {
  return wrapImages(width, height, x - reach, y - reach, x + reach, y + reach);
}

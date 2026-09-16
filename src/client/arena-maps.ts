import type { ArenaMapId, Obstacle, ObstacleKind } from '../shared/arena-map.js';
import type { ThemeDefinition } from './themes.js';

/**
 * How a map looks. The map is the room's shared choice of ground and scenery; the theme is still each device's own
 * style, so this only supplies the colours a map owns and leaves walls, trails and sprites to `ThemeDefinition`.
 *
 * Geometry lives here rather than in the scene for the same reason `arena-wall.ts` does: it is the part worth
 * testing, and the renderer stays a painter of primitives.
 */
export interface MapGround {
  floorCenter: string;
  floorEdge: string;
  grid: string;
  gridSize: number;
  /** Debris colour thrown when a blast clears an obstacle. */
  dust: string;
}

export const ARENA_MAP_LABELS: Record<ArenaMapId, string> = {
  classic: 'Classic neon grid',
  desert: 'Desert',
  forest: 'Forest',
  city: 'City',
};

const GROUNDS: Record<Exclude<ArenaMapId, 'classic'>, Omit<MapGround, 'gridSize'>> = {
  desert: { floorCenter: '#4a2f12', floorEdge: '#150a03', grid: 'rgba(255,171,79,.10)', dust: '#e0b271' },
  forest: { floorCenter: '#0f3018', floorEdge: '#030f07', grid: 'rgba(96,255,148,.10)', dust: '#6bd98a' },
  city: { floorCenter: '#1d2438', floorEdge: '#04060e', grid: 'rgba(126,166,255,.13)', dust: '#9fb2d8' },
};

/** Classic keeps the style's own floor exactly as it was before maps existed. */
export function mapGround(map: ArenaMapId, theme: ThemeDefinition): MapGround {
  const gridSize = theme.rendering.gridSize;
  if (map === 'classic') {
    return { floorCenter: theme.palette.floorCenter, floorEdge: theme.palette.floorEdge, grid: theme.palette.grid, gridSize, dust: theme.palette.rim };
  }
  return { ...GROUNDS[map], gridSize };
}

export type ObstaclePart =
  | { shape: 'rect'; x: number; y: number; width: number; height: number; color: string; alpha?: number }
  | { shape: 'circle'; x: number; y: number; radius: number; color: string; alpha?: number };

interface ObstacleStyle {
  body: string;
  /** The lit face along the top edge. */
  top: string;
  shade: string;
  detail: string;
  build: 'block' | 'tree' | 'cactus' | 'tower';
}

export const OBSTACLE_STYLES: Record<ObstacleKind, ObstacleStyle> = {
  rock: { body: '#7d6a4e', top: '#a8916a', shade: '#38301f', detail: '#5d4e38', build: 'block' },
  crate: { body: '#8a6534', top: '#bd8c4c', shade: '#3c2a12', detail: '#d8a45c', build: 'block' },
  cactus: { body: '#2f8f4f', top: '#55d47f', shade: '#123a20', detail: '#8fffb4', build: 'cactus' },
  tree: { body: '#1f7a3a', top: '#3fc966', shade: '#0a2b14', detail: '#5a3a1e', build: 'tree' },
  bush: { body: '#276b34', top: '#4ab35c', shade: '#0b2513', detail: '#8ce89c', build: 'tree' },
  building: { body: '#39415a', top: '#5b6889', shade: '#12162a', detail: '#ffd98a', build: 'tower' },
};

/** A small deterministic sequence per obstacle, so windows and chips never flicker between frames. */
function noise(seed: number, step: number): number {
  const mixed = Math.imul(seed + 1, 0x9e3779b1) ^ Math.imul(step + 1, 0x85ebca6b);
  return ((mixed ^ (mixed >>> 15)) >>> 0) / 0x1_0000_0000;
}

/** Everything the renderer draws for one obstacle, back to front, in world units. */
export function obstacleParts(obstacle: Obstacle): ObstaclePart[] {
  const style = OBSTACLE_STYLES[obstacle.kind];
  const { x, y, halfWidth: hw, halfHeight: hh } = obstacle;
  const left = x - hw, top = y - hh, width = hw * 2, height = hh * 2;
  // The ground shadow anchors a piece to the floor, and takes the silhouette of what stands on it: a rectangle
  // under a tree would advertise a footprint the crown does not fill.
  const parts: ObstaclePart[] = [];
  if (style.build === 'tree') {
    // The crown fills the footprint, because the footprint is what the simulation kills against: a small canopy
    // floating in a larger lethal square would kill riders that never touched anything drawn.
    const canopy = Math.min(hw, hh);
    const trunkWidth = Math.max(6, width * .18);
    parts.push({ shape: 'circle', x: x + 4, y: y + 6, radius: canopy, color: '#000000', alpha: .35 });
    parts.push({ shape: 'rect', x: x - trunkWidth / 2, y, width: trunkWidth, height: hh, color: style.detail });
    parts.push({ shape: 'circle', x, y, radius: canopy, color: style.shade });
    parts.push({ shape: 'circle', x: x - canopy * .28, y: y - canopy * .2, radius: canopy * .62, color: style.body });
    parts.push({ shape: 'circle', x: x + canopy * .26, y: y + canopy * .12, radius: canopy * .56, color: style.body });
    parts.push({ shape: 'circle', x: x - canopy * .18, y: y - canopy * .34, radius: canopy * .3, color: style.top });
    return parts;
  }
  parts.push({ shape: 'rect', x: left + 4, y: top + 6, width, height, color: '#000000', alpha: .35 });
  if (style.build === 'cactus') {
    const stem = Math.max(8, width * .42);
    parts.push({ shape: 'rect', x: x - stem / 2, y: top, width: stem, height, color: style.body });
    parts.push({ shape: 'rect', x: x - stem / 2, y: top, width: Math.max(2, stem * .3), height, color: style.top });
    // One arm each side, the lower one shorter, so a cactus reads as a cactus at any size.
    const armThickness = Math.max(5, stem * .55);
    parts.push({ shape: 'rect', x: left, y: y - hh * .25, width: hw, height: armThickness, color: style.body });
    parts.push({ shape: 'rect', x: left, y: y - hh * .25 - hh * .35, width: armThickness, height: hh * .4, color: style.body });
    parts.push({ shape: 'rect', x: x + stem / 2, y: y + hh * .1, width: hw - stem / 2, height: armThickness, color: style.body });
    parts.push({ shape: 'rect', x: x + hw - armThickness, y: y - hh * .25, width: armThickness, height: hh * .4, color: style.body });
    for (let rib = 1; rib < 4; rib += 1) {
      parts.push({ shape: 'rect', x: x - stem / 2 + 2, y: top + (height * rib) / 4, width: stem - 4, height: 1.5, color: style.shade, alpha: .6 });
    }
    return parts;
  }
  parts.push({ shape: 'rect', x: left, y: top, width, height, color: style.shade });
  parts.push({ shape: 'rect', x: left + 2, y: top + 2, width: width - 4, height: height - 4, color: style.body });
  parts.push({ shape: 'rect', x: left + 3, y: top + 3, width: width - 6, height: Math.min(6, height * .18), color: style.top });
  parts.push({ shape: 'rect', x: left + 3, y: top + height - 5, width: width - 6, height: 3, color: style.shade, alpha: .8 });
  if (style.build === 'tower') {
    // Window grid, lit on a fixed pattern per building, so a city block reads as inhabited without animating.
    const columns = Math.max(2, Math.round(width / 40));
    const rows = Math.max(2, Math.round(height / 34));
    const paneWidth = (width - 16) / columns, paneHeight = (height - 22) / rows;
    for (let column = 0; column < columns; column += 1) for (let row = 0; row < rows; row += 1) {
      const lit = noise(obstacle.id, column * 7 + row) > .45;
      parts.push({
        shape: 'rect', x: left + 8 + column * paneWidth + 3, y: top + 14 + row * paneHeight + 3,
        width: Math.max(2, paneWidth - 9), height: Math.max(2, paneHeight - 9),
        color: lit ? style.detail : style.shade, alpha: lit ? .85 : .55,
      });
    }
    return parts;
  }
  // Rocks and crates get one deterministic chip each, the same trick the pixel wall uses to break up a flat face.
  const chipWidth = Math.max(4, width * .2), chipHeight = Math.max(3, height * .16);
  parts.push({
    shape: 'rect', x: left + 5 + noise(obstacle.id, 1) * Math.max(0, width - chipWidth - 10),
    y: top + 8 + noise(obstacle.id, 2) * Math.max(0, height - chipHeight - 12),
    width: chipWidth, height: chipHeight, color: style.detail, alpha: .75,
  });
  return parts;
}

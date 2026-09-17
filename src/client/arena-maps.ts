import type {
  ArenaMapId,
  Obstacle,
  ObstacleKind,
} from "../shared/arena-map.js";
import type { ThemeDefinition } from "./themes.js";

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
  classic: "Classic neon grid",
  desert: "Desert",
  forest: "Forest",
  city: "City",
  wrap: "Wrap-around",
  cross: "Crossed",
};

/** Maps that change the edges rather than the ground play on the style's own floor, as classic does. */
const GROUNDS: Partial<Record<ArenaMapId, Omit<MapGround, "gridSize">>> = {
  desert: {
    floorCenter: "#4a2f12",
    floorEdge: "#150a03",
    grid: "rgba(255,171,79,.10)",
    dust: "#e0b271",
  },
  forest: {
    floorCenter: "#0f3018",
    floorEdge: "#030f07",
    grid: "rgba(96,255,148,.10)",
    dust: "#6bd98a",
  },
  city: {
    floorCenter: "#1d2438",
    floorEdge: "#04060e",
    grid: "rgba(126,166,255,.13)",
    dust: "#9fb2d8",
  },
};

/** Classic keeps the style's own floor exactly as it was before maps existed, and so do the two maps built on it. */
export function mapGround(map: ArenaMapId, theme: ThemeDefinition): MapGround {
  const gridSize = theme.rendering.gridSize;
  const ground = GROUNDS[map];
  if (!ground) {
    return {
      floorCenter: theme.palette.floorCenter,
      floorEdge: theme.palette.floorEdge,
      grid: theme.palette.grid,
      gridSize,
      dust: theme.palette.rim,
    };
  }
  return { ...ground, gridSize };
}

export type ObstaclePart =
  | {
      shape: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
      alpha?: number;
    }
  | {
      shape: "ellipse";
      x: number;
      y: number;
      radiusX: number;
      radiusY: number;
      color: string;
      alpha?: number;
    };

interface ObstacleStyle {
  body: string;
  /** The lit face along the top edge. */
  top: string;
  shade: string;
  detail: string;
  build: "block" | "tree" | "cactus" | "tower";
}

export const OBSTACLE_STYLES: Record<ObstacleKind, ObstacleStyle> = {
  rock: {
    body: "#7d6a4e",
    top: "#a8916a",
    shade: "#38301f",
    detail: "#5d4e38",
    build: "block",
  },
  crate: {
    body: "#8a6534",
    top: "#bd8c4c",
    shade: "#3c2a12",
    detail: "#d8a45c",
    build: "block",
  },
  cactus: {
    body: "#2f8f4f",
    top: "#55d47f",
    shade: "#123a20",
    detail: "#8fffb4",
    build: "cactus",
  },
  tree: {
    body: "#1f7a3a",
    top: "#3fc966",
    shade: "#0a2b14",
    detail: "#5a3a1e",
    build: "tree",
  },
  bush: {
    body: "#276b34",
    top: "#4ab35c",
    shade: "#0b2513",
    detail: "#8ce89c",
    build: "tree",
  },
  building: {
    body: "#39415a",
    top: "#5b6889",
    shade: "#12162a",
    detail: "#ffd98a",
    build: "tower",
  },
};

/** A small deterministic sequence per obstacle, so windows and chips never flicker between frames. */
function noise(seed: number, step: number): number {
  const mixed =
    Math.imul(seed + 1, 0x9e3779b1) ^ Math.imul(step + 1, 0x85ebca6b);
  return ((mixed ^ (mixed >>> 15)) >>> 0) / 0x1_0000_0000;
}

/** Everything the renderer draws for one obstacle, back to front, in world units. */
export function obstacleParts(obstacle: Obstacle): ObstaclePart[] {
  const style = OBSTACLE_STYLES[obstacle.kind];
  const { x, y, halfWidth: hw, halfHeight: hh } = obstacle;
  const left = x - hw,
    top = y - hh,
    width = hw * 2,
    height = hh * 2;
  // The ground shadow anchors a piece to the floor, and takes the silhouette of what stands on it: a rectangle
  // under a tree would advertise a footprint the crown does not fill.
  const parts: ObstaclePart[] = [];
  if (style.build === "tree") {
    // The crown is an ellipse on the footprint's own half extents, not a circle on the smaller of them: the
    // footprint is what the simulation kills against, and a crown that does not reach its edges would kill riders
    // that touched nothing drawn. Tree and bush sizes are rolled per axis, so they are rarely square.
    parts.push({
      shape: "ellipse",
      x: x + 4,
      y: y + 6,
      radiusX: hw,
      radiusY: hh,
      color: "#000000",
      alpha: 0.35,
    });
    parts.push({
      shape: "ellipse",
      x,
      y,
      radiusX: hw,
      radiusY: hh,
      color: style.shade,
    });
    parts.push({
      shape: "ellipse",
      x: x - hw * 0.12,
      y: y - hh * 0.1,
      radiusX: hw * 0.78,
      radiusY: hh * 0.78,
      color: style.body,
    });
    parts.push({
      shape: "ellipse",
      x: x + hw * 0.2,
      y: y + hh * 0.18,
      radiusX: hw * 0.5,
      radiusY: hh * 0.5,
      color: style.body,
    });
    parts.push({
      shape: "ellipse",
      x: x - hw * 0.22,
      y: y - hh * 0.28,
      radiusX: hw * 0.3,
      radiusY: hh * 0.3,
      color: style.top,
    });
    // The trunk base, peeking out at the foot of the crown, is what tells a tree from a rock at a glance.
    const trunkWidth = Math.max(6, width * 0.18);
    parts.push({
      shape: "rect",
      x: x - trunkWidth / 2,
      y: y + hh * 0.55,
      width: trunkWidth,
      height: hh * 0.45,
      color: style.detail,
    });
    return parts;
  }
  parts.push({
    shape: "rect",
    x: left + 4,
    y: top + 6,
    width,
    height,
    color: "#000000",
    alpha: 0.35,
  });
  if (style.build === "cactus") {
    const stem = Math.max(8, width * 0.42);
    parts.push({
      shape: "rect",
      x: x - stem / 2,
      y: top,
      width: stem,
      height,
      color: style.body,
    });
    parts.push({
      shape: "rect",
      x: x - stem / 2,
      y: top,
      width: Math.max(2, stem * 0.3),
      height,
      color: style.top,
    });
    // One arm each side, the lower one shorter, so a cactus reads as a cactus at any size.
    const armThickness = Math.max(5, stem * 0.55);
    parts.push({
      shape: "rect",
      x: left,
      y: y - hh * 0.25,
      width: hw,
      height: armThickness,
      color: style.body,
    });
    parts.push({
      shape: "rect",
      x: left,
      y: y - hh * 0.25 - hh * 0.35,
      width: armThickness,
      height: hh * 0.4,
      color: style.body,
    });
    parts.push({
      shape: "rect",
      x: x + stem / 2,
      y: y + hh * 0.1,
      width: hw - stem / 2,
      height: armThickness,
      color: style.body,
    });
    parts.push({
      shape: "rect",
      x: x + hw - armThickness,
      y: y - hh * 0.25,
      width: armThickness,
      height: hh * 0.4,
      color: style.body,
    });
    for (let rib = 1; rib < 4; rib += 1) {
      parts.push({
        shape: "rect",
        x: x - stem / 2 + 2,
        y: top + (height * rib) / 4,
        width: stem - 4,
        height: 1.5,
        color: style.shade,
        alpha: 0.6,
      });
    }
    return parts;
  }
  parts.push({
    shape: "rect",
    x: left,
    y: top,
    width,
    height,
    color: style.shade,
  });
  parts.push({
    shape: "rect",
    x: left + 2,
    y: top + 2,
    width: width - 4,
    height: height - 4,
    color: style.body,
  });
  parts.push({
    shape: "rect",
    x: left + 3,
    y: top + 3,
    width: width - 6,
    height: Math.min(6, height * 0.18),
    color: style.top,
  });
  parts.push({
    shape: "rect",
    x: left + 3,
    y: top + height - 5,
    width: width - 6,
    height: 3,
    color: style.shade,
    alpha: 0.8,
  });
  if (style.build === "tower") {
    // Window grid, lit on a fixed pattern per building, so a city block reads as inhabited without animating.
    const columns = Math.max(2, Math.round(width / 40));
    const rows = Math.max(2, Math.round(height / 34));
    const paneWidth = (width - 16) / columns,
      paneHeight = (height - 22) / rows;
    for (let column = 0; column < columns; column += 1)
      for (let row = 0; row < rows; row += 1) {
        const lit = noise(obstacle.id, column * 7 + row) > 0.45;
        parts.push({
          shape: "rect",
          x: left + 8 + column * paneWidth + 3,
          y: top + 14 + row * paneHeight + 3,
          width: Math.max(2, paneWidth - 9),
          height: Math.max(2, paneHeight - 9),
          color: lit ? style.detail : style.shade,
          alpha: lit ? 0.85 : 0.55,
        });
      }
    return parts;
  }
  // Rocks and crates get one deterministic chip each, the same trick the pixel wall uses to break up a flat face.
  const chipWidth = Math.max(4, width * 0.2),
    chipHeight = Math.max(3, height * 0.16);
  parts.push({
    shape: "rect",
    x: left + 5 + noise(obstacle.id, 1) * Math.max(0, width - chipWidth - 10),
    y: top + 8 + noise(obstacle.id, 2) * Math.max(0, height - chipHeight - 12),
    width: chipWidth,
    height: chipHeight,
    color: style.detail,
    alpha: 0.75,
  });
  return parts;
}

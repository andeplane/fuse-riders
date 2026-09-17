import type { ArenaMapId, Obstacle, ObstacleKind } from "../engine/view.js";
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
    floorCenter: "#624020",
    floorEdge: "#24170f",
    grid: "rgba(255,171,79,.10)",
    dust: "#e0b271",
  },
  forest: {
    floorCenter: "#164338",
    floorEdge: "#081b20",
    grid: "rgba(96,255,148,.10)",
    dust: "#6bd98a",
  },
  city: {
    floorCenter: "#302344",
    floorEdge: "#100f24",
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
      shape: "triangle";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      x3: number;
      y3: number;
      color: string;
      alpha?: number;
    }
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
    body: "#ae7154",
    top: "#e8ac79",
    shade: "#513d3b",
    detail: "#805449",
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
    body: "#414462",
    top: "#8b82b0",
    shade: "#12162a",
    detail: "#67e6dc",
    build: "tower",
  },
};

/** A small deterministic sequence per obstacle, so rooftop details and chips never flicker between frames. */
function noise(seed: number, step: number): number {
  const mixed =
    Math.imul(seed + 1, 0x9e3779b1) ^ Math.imul(step + 1, 0x85ebca6b);
  return ((mixed ^ (mixed >>> 15)) >>> 0) / 0x1_0000_0000;
}

/**
 * Map-specific landmarks use normalized artwork inside the existing footprint.
 * These are skins for wire-level rock/building kinds, never new collision geometry.
 */
function landmarkParts(
  obstacle: Obstacle,
  map: ArenaMapId,
): ObstaclePart[] | null {
  if (obstacle.kind !== "rock" && obstacle.kind !== "building") return null;
  const { x, y, halfWidth: hw, halfHeight: hh } = obstacle;
  const left = x - hw,
    top = y - hh,
    w = hw * 2,
    h = hh * 2;
  const parts: ObstaclePart[] = [
    {
      shape: "rect",
      x: left + 4,
      y: top + 6,
      width: w,
      height: h,
      color: "#000000",
      alpha: 0.35,
    },
  ];
  const rect = (
    u: number,
    v: number,
    width: number,
    height: number,
    color: string,
  ) =>
    parts.push({
      shape: "rect",
      x: left + u * w,
      y: top + v * h,
      width: width * w,
      height: height * h,
      color,
    });
  const ellipse = (
    u: number,
    v: number,
    rx: number,
    ry: number,
    color: string,
  ) =>
    parts.push({
      shape: "ellipse",
      x: left + u * w,
      y: top + v * h,
      radiusX: rx * w,
      radiusY: ry * h,
      color,
    });
  const triangle = (
    u1: number,
    v1: number,
    u2: number,
    v2: number,
    u3: number,
    v3: number,
    color: string,
  ) =>
    parts.push({
      shape: "triangle",
      x1: left + u1 * w,
      y1: top + v1 * h,
      x2: left + u2 * w,
      y2: top + v2 * h,
      x3: left + u3 * w,
      y3: top + v3 * h,
      color,
    });
  if (obstacle.kind === "building") {
    // Parapet around a flat roof: equipment and service access, no facade windows.
    rect(0, 0, 1, 1, "#171d30");
    rect(0.02, 0.02, 0.96, 0.96, "#9c9aae");
    rect(0.04, 0.05, 0.92, 0.91, "#565b73");
    rect(0.07, 0.09, 0.86, 0.82, obstacle.id % 2 ? "#343e50" : "#444257");
    rect(0.07, 0.09, 0.86, 0.035, "#262c40");
    rect(0.07, 0.09, 0.025, 0.82, "#262c40");
    // Raised stairwell with a shaded side and a small roof access hatch.
    rect(0.16, 0.2, 0.29, 0.36, "#202b3d");
    rect(0.13, 0.16, 0.29, 0.34, "#afb3b6");
    rect(0.15, 0.19, 0.25, 0.27, "#7c8997");
    rect(0.2, 0.28, 0.12, 0.14, "#3c485e");
    rect(0.29, 0.34, 0.015, 0.025, "#ebd6a3");
    // Two fan housings, with cross-blades rather than glowing panes.
    for (const v of [0.21, 0.53]) {
      rect(0.6, v + 0.03, 0.25, 0.25, "#232b3c");
      rect(0.57, v, 0.25, 0.25, "#8d9da6");
      ellipse(0.695, v + 0.125, 0.085, 0.085, "#303e4f");
      ellipse(0.695, v + 0.125, 0.057, 0.057, "#526475");
      rect(0.685, v + 0.054, 0.02, 0.142, "#a8bac0");
      rect(0.624, v + 0.115, 0.142, 0.02, "#a8bac0");
    }
    // Conduit from the stairwell to the air handlers and a striped service zone.
    rect(0.22, 0.55, 0.025, 0.27, "#829493");
    rect(0.22, 0.795, 0.46, 0.025, "#829493");
    for (let stripe = 0; stripe < 4; stripe++)
      rect(0.31 + stripe * 0.048, 0.64, 0.024, 0.08, "#d6b875");
  } else if (map === "forest") {
    // A fallen trunk: bark fills the solid rectangle, with a cut end, growth rings and moss.
    rect(0, 0, 1, 1, "#38291f");
    rect(0.04, 0.03, 0.96, 0.91, "#755039");
    rect(0.08, 0.12, 0.92, 0.14, "#ad7b4e");
    rect(0.08, 0.78, 0.92, 0.16, "#4e382d");
    for (let groove = 0; groove < 5; groove++) {
      const start = 0.22 + noise(obstacle.id, groove) * 0.18;
      rect(start, 0.2 + groove * 0.135, 0.94 - start, 0.025, "#46332a");
    }
    ellipse(0.15, 0.5, 0.15, 0.48, "#d5ac71");
    ellipse(0.15, 0.5, 0.115, 0.39, "#855b38");
    ellipse(0.15, 0.5, 0.085, 0.31, "#d5ac71");
    ellipse(0.15, 0.5, 0.054, 0.22, "#a67646");
    ellipse(0.15, 0.5, 0.025, 0.11, "#e3bd80");
    for (let moss = 0; moss < 5; moss++) {
      const u = 0.42 + moss * 0.1;
      ellipse(u, 0.17 + (moss % 2) * 0.05, 0.075, 0.11, "#426c3c");
      ellipse(u, 0.15 + (moss % 2) * 0.05, 0.043, 0.055, "#76924a");
    }
    // Small flowers rooted in the moss.
    for (const u of [0.48, 0.78]) {
      ellipse(u - 0.025, 0.23, 0.025, 0.04, "#efbadb");
      ellipse(u + 0.025, 0.23, 0.025, 0.04, "#efbadb");
      ellipse(u, 0.19, 0.025, 0.04, "#fce0e7");
      ellipse(u, 0.27, 0.025, 0.04, "#fce0e7");
      ellipse(u, 0.23, 0.015, 0.025, "#ffd477");
    }
  } else {
    // Four sunlit/shaded faces meeting at an apex; nested courses read as a stepped pyramid.
    rect(0, 0, 1, 1, "#947047");
    for (let level = 0; level < 5; level++) {
      const a = 0.025 + level * 0.075,
        b = 1 - a;
      triangle(a, a, b, a, 0.5, 0.5, level % 2 ? "#ead095" : "#dfbe7e");
      triangle(a, a, 0.5, 0.5, a, b, level % 2 ? "#c39a5c" : "#ceaa69");
      triangle(b, a, b, b, 0.5, 0.5, level % 2 ? "#a27b49" : "#b28a50");
      triangle(a, b, 0.5, 0.5, b, b, level % 2 ? "#86613e" : "#957147");
    }
    // Central stair descending the south face.
    rect(0.455, 0.53, 0.09, 0.445, "#d1aa6c");
    for (let step = 0; step < 6; step++)
      rect(0.455, 0.57 + step * 0.067, 0.09, 0.015, "#8e693e");
    rect(0.45, 0.45, 0.1, 0.1, "#f3dca1");
  }
  return parts;
}

/** Everything the renderer draws for one obstacle, back to front, in world units. */
export function obstacleParts(
  obstacle: Obstacle,
  map: ArenaMapId,
): ObstaclePart[] {
  const landmark = landmarkParts(obstacle, map);
  if (landmark) return landmark;
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
    // The crown is an ellipse on the footprint's own half extents, not a circle on the smaller of them: riders die
    // against that same ellipse, a little shrunk (`obstacleHitbox`), so a crown drawn any smaller would kill riders
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
    // Inset leaf clusters keep the full elliptical crown legible at collision edges.
    for (let leaf = 0; leaf < 9; leaf++) {
      const angle = (leaf / 9) * Math.PI * 2;
      parts.push({
        shape: "ellipse",
        x: x + Math.cos(angle) * hw * 0.48,
        y: y + Math.sin(angle) * hh * 0.48,
        radiusX: hw * (obstacle.kind === "bush" ? 0.18 : 0.25),
        radiusY: hh * 0.2,
        color: leaf % 3 === 0 ? style.top : style.body,
      });
    }
    if (obstacle.kind === "bush") {
      for (let berry = 0; berry < 5; berry++) {
        parts.push({
          shape: "rect",
          x: x - hw * 0.4 + noise(obstacle.id, berry) * hw * 0.8,
          y: y - hh * 0.4 + noise(obstacle.id, berry + 9) * hh * 0.8,
          width: 3,
          height: 3,
          color: "#f1b887",
        });
      }
      return parts;
    }
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
    parts.push({
      shape: "rect",
      x: x - stem * 0.22,
      y: top + 2,
      width: stem * 0.44,
      height: Math.min(5, hh * 0.2),
      color: "#ffadba",
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
  if (obstacle.kind === "crate") {
    // Metal binding and corner rivets around timber slats.
    for (const fraction of [0.28, 0.66]) {
      parts.push({
        shape: "rect",
        x: left + width * fraction,
        y: top + 3,
        width: 3,
        height: height - 6,
        color: "#e0af73",
      });
    }
    for (const fraction of [0.28, 0.55, 0.78]) {
      parts.push({
        shape: "rect",
        x: left + 4,
        y: top + height * fraction,
        width: width - 8,
        height: 2,
        color: style.shade,
        alpha: 0.55,
      });
    }
    for (const dx of [4, width - 7])
      for (const dy of [4, height - 7])
        parts.push({
          shape: "rect",
          x: left + dx,
          y: top + dy,
          width: 3,
          height: 3,
          color: "#ffe1a5",
        });
  }
  // Crates get one deterministic chip each, the same trick the pixel wall uses to break up a flat face.
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

/** Low-contrast, world-anchored ground detail, baked once per map/size/style change.
 * No scenery here is solid; obstacle silhouettes are painted separately above the grid.
 */
export function paintMapGround(
  ctx: Pick<
    CanvasRenderingContext2D,
    | "save"
    | "restore"
    | "lineWidth"
    | "strokeStyle"
    | "fillStyle"
    | "strokeRect"
    | "fillRect"
    | "beginPath"
    | "ellipse"
    | "stroke"
    | "fill"
    | "moveTo"
    | "lineTo"
  >,
  map: ArenaMapId,
  width: number,
  height: number,
): void {
  if (map !== "desert" && map !== "forest" && map !== "city") return;
  ctx.save();
  ctx.lineWidth = 1;
  if (map === "city") {
    ctx.strokeStyle = "rgba(174,142,208,0.09)";
    for (let y = 0; y < height; y += 144)
      for (let x = 0; x < width; x += 192) {
        ctx.strokeRect(x + 9, y + 9, 174, 126);
        ctx.fillStyle = "rgba(94,215,211,0.12)";
        ctx.fillRect(x + 16, y + 16, 18, 2);
        ctx.fillRect(x + 16, y + 20, 2, 10);
      }
  } else {
    const spacing = map === "desert" ? 95 : 78;
    for (let y = 0, row = 0; y < height; y += spacing, row++)
      for (let x = 0, col = 0; x < width; x += spacing, col++) {
        const seed = row * 97 + col;
        const px = x + noise(seed, 0) * spacing;
        const py = y + noise(seed, 1) * spacing;
        if (map === "desert") {
          ctx.strokeStyle = "rgba(245,189,119,0.10)";
          for (let ripple = 0; ripple < 3; ripple++) {
            ctx.beginPath();
            ctx.ellipse(
              px,
              py + ripple * 7,
              28 + ripple * 7,
              9,
              -0.2,
              0.15,
              2.7,
            );
            ctx.stroke();
          }
        } else {
          ctx.fillStyle = "rgba(75,160,119,0.07)";
          ctx.beginPath();
          ctx.ellipse(px, py, 24, 10, noise(seed, 3) * 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(123,191,143,0.16)";
          ctx.beginPath();
          ctx.moveTo(px - 4, py - 4);
          ctx.lineTo(px, py + 3);
          ctx.lineTo(px + 3, py - 6);
          ctx.stroke();
        }
      }
  }
  ctx.restore();
}

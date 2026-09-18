import {
  obstacleVariant,
  type ArenaMapId,
  type Obstacle,
} from "../shared/arena-map.js";
import type { ThemeDefinition } from "./themes.js";

/**
 * How a map looks. The map is the room's shared choice of ground and scenery; the theme is still each device's own
 * style, so this only supplies the colours a map owns and leaves walls, trails and sprites to `ThemeDefinition`.
 *
 * Floor decoration and artwork selection live here; authoritative obstacle geometry stays in shared/arena-map.
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

function noise(seed: number, step: number): number {
  const mixed =
    Math.imul(seed + 1, 0x9e3779b1) ^ Math.imul(step + 1, 0x85ebca6b);
  return ((mixed ^ (mixed >>> 15)) >>> 0) / 0x1_0000_0000;
}

export interface ObstacleArtwork {
  file: string;
  anchorX: number;
  anchorY: number;
  unitsPerPixel: number;
  pixelWidth: number;
  pixelHeight: number;
}
/** Original source PNG coordinates; dimensions and scales are checked against the sidecars. */
export const DEFAULT_OBSTACLE_ART: Readonly<Record<string, ObstacleArtwork>> = {
  "building-small-sandstone": {
    file: "/props/desert-industrial-v1/building-small-sandstone.png",
    anchorX: 628.5,
    anchorY: 613.5,
    unitsPerPixel: 0.10158730158730159,
    pixelWidth: 1254,
    pixelHeight: 1254,
  },
  "building-small-vent": {
    file: "/props/desert-industrial-v1/building-small-vent.png",
    anchorX: 627.5,
    anchorY: 613.0,
    unitsPerPixel: 0.0994263862332696,
    pixelWidth: 1254,
    pixelHeight: 1254,
  },
  "building-small-workshop": {
    file: "/props/desert-industrial-v1/building-small-workshop.png",
    anchorX: 830.0,
    anchorY: 462.0,
    unitsPerPixel: 0.09076175040518639,
    pixelWidth: 1659,
    pixelHeight: 948,
  },
  "building-large-warehouse": {
    file: "/props/desert-industrial-v1/building-large-warehouse.png",
    anchorX: 887.0,
    anchorY: 446.0,
    unitsPerPixel: 0.1343669250645995,
    pixelWidth: 1774,
    pixelHeight: 887,
  },
  "building-large-factory": {
    file: "/props/desert-industrial-v1/building-large-factory.png",
    anchorX: 507.0,
    anchorY: 774.0,
    unitsPerPixel: 0.1411042944785276,
    pixelWidth: 1013,
    pixelHeight: 1553,
  },
  "building-large-sandstone": {
    file: "/props/desert-industrial-v1/building-large-sandstone.png",
    anchorX: 661.0,
    anchorY: 596.0,
    unitsPerPixel: 0.1629327902240326,
    pixelWidth: 1322,
    pixelHeight: 1190,
  },
  "crate-small-wood": {
    file: "/props/desert-industrial-v1/crate-small-wood.png",
    anchorX: 626.5,
    anchorY: 628.5,
    unitsPerPixel: 0.03858520900321544,
    pixelWidth: 1254,
    pixelHeight: 1254,
  },
  "crate-long-wood": {
    file: "/props/desert-industrial-v1/crate-long-wood.png",
    anchorX: 627.0,
    anchorY: 649.0,
    unitsPerPixel: 0.0711743772241993,
    pixelWidth: 1254,
    pixelHeight: 1254,
  },
  "crate-tall-metal": {
    file: "/props/desert-industrial-v1/crate-tall-metal.png",
    anchorX: 467.5,
    anchorY: 866.0,
    unitsPerPixel: 0.053811659192825115,
    pixelWidth: 934,
    pixelHeight: 1684,
  },
  "crate-wide-amber": {
    file: "/props/desert-industrial-v1/crate-wide-amber.png",
    anchorX: 768.5,
    anchorY: 501.0,
    unitsPerPixel: 0.0477326968973747,
    pixelWidth: 1536,
    pixelHeight: 1024,
  },
  "rock-small-faceted": {
    file: "/props/desert-industrial-v1/rock-small-faceted.png",
    anchorX: 627.0,
    anchorY: 624.0,
    unitsPerPixel: 0.06755126658624849,
    pixelWidth: 1254,
    pixelHeight: 1254,
  },
  "rock-large-cracked": {
    file: "/props/desert-industrial-v1/rock-large-cracked.png",
    anchorX: 627.0,
    anchorY: 623.0,
    unitsPerPixel: 0.11363636363636363,
    pixelWidth: 1254,
    pixelHeight: 1254,
  },
  "rock-medium-fused": {
    file: "/props/desert-industrial-v1/rock-medium-fused.png",
    anchorX: 627.0,
    anchorY: 630.0,
    unitsPerPixel: 0.09112709832134293,
    pixelWidth: 1254,
    pixelHeight: 1254,
  },
  "pyramid-small-sandstone": {
    file: "/props/desert-industrial-v1/pyramid-small-sandstone.png",
    anchorX: 627.0,
    anchorY: 631.5,
    unitsPerPixel: 0.08294930875576037,
    pixelWidth: 1254,
    pixelHeight: 1254,
  },
  "pyramid-large-stepped": {
    file: "/props/desert-industrial-v1/pyramid-large-stepped.png",
    anchorX: 767.5,
    anchorY: 514.5,
    unitsPerPixel: 0.11276429130775255,
    pixelWidth: 1536,
    pixelHeight: 1024,
  },
  "pyramid-tall-obsidian": {
    file: "/props/desert-industrial-v1/pyramid-tall-obsidian.png",
    anchorX: 627.5,
    anchorY: 613.5,
    unitsPerPixel: 0.11416921508664628,
    pixelWidth: 1254,
    pixelHeight: 1254,
  },
};
/** Add map-specific replacements by stable variant id; absent variants always use the shared pack. */
export type MapObstacleArt = Partial<
  Record<ArenaMapId, Readonly<Record<string, ObstacleArtwork>>>
>;
export const MAP_OBSTACLE_ART: MapObstacleArt = {};
export function obstacleArtwork(
  obstacle: Obstacle,
  map: ArenaMapId,
  skins: MapObstacleArt = MAP_OBSTACLE_ART,
): ObstacleArtwork {
  const variant = obstacleVariant(obstacle);
  return skins[map]?.[variant.id] ?? DEFAULT_OBSTACLE_ART[variant.id]!;
}
export function obstacleTextureKey(art: ObstacleArtwork): string {
  return `obstacle:${art.file}`;
}
export function obstacleArtSources(
  skins: MapObstacleArt = MAP_OBSTACLE_ART,
): ObstacleArtwork[] {
  return [
    ...new Map(
      [
        ...Object.values(DEFAULT_OBSTACLE_ART),
        ...Object.values(skins).flatMap((skin) => Object.values(skin)),
      ].map((art) => [art.file, art]),
    ).values(),
  ];
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

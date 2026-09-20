import type {
  ArenaMapId,
  Obstacle,
  ObstacleKind,
  Track,
} from "../engine/view.js";
import { obstacleVariant, trackLength, trackPose } from "../engine/view-kit.js";
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
  drift: "Drifting cross",
  trains: "Trains",
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
  build: "wall" | "train";
}

/**
 * Only the movers are painted from primitives. Standing scenery is the shared prop catalog, drawn as its own
 * artwork (`DEFAULT_OBSTACLE_ART`), so a rock or a crate has no style here.
 */
export const OBSTACLE_STYLES: Record<MoverObstacleKind, ObstacleStyle> = {
  // The drifting cross is drawn as the pixel style draws the boundary: a violet run with warning studs along it.
  wall: {
    body: "#593dba",
    top: "#a58cff",
    shade: "#160c33",
    detail: "#ffd166",
    build: "wall",
  },
  // A car's colours come from its train's livery (`TRAIN_LIVERIES`); these are the fallback for a car off any train.
  train: {
    body: "#8d99ae",
    top: "#c9d1de",
    shade: "#1b2130",
    detail: "#fff2a8",
    build: "train",
  },
};

/** One livery per train of the map, by the `train` index its cars carry: red, yellow and blue, in that order. */
export const TRAIN_LIVERIES: readonly {
  body: string;
  top: string;
  shade: string;
}[] = [
  { body: "#e63946", top: "#ff9aa2", shade: "#3d0a11" },
  { body: "#ffc531", top: "#ffe79a", shade: "#4a3400" },
  { body: "#3a86ff", top: "#9cc3ff", shade: "#0b2a5e" },
];

/**
 * What a car is doing, for the lights: which way its rails run where it stands, and whether it leads or ends its
 * train. Static scenery has none; a screen works it out from the track and the ids (the lowest id of a train is its
 * locomotive, the highest its last car: `fixedScenery` lays them head first).
 */
export interface MoverPose {
  dx: number;
  dy: number;
  head: boolean;
  tail: boolean;
}

/** A small deterministic sequence per obstacle, so rooftop details and chips never flicker between frames. */
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
    anchorX: 191.45693779904306,
    anchorY: 186.88755980861245,
    unitsPerPixel: 0.33348292196459733,
    pixelWidth: 382,
    pixelHeight: 382,
  },
  "building-small-vent": {
    file: "/props/desert-industrial-v1/building-small-vent.png",
    anchorX: 187.14912280701753,
    anchorY: 182.82456140350877,
    unitsPerPixel: 0.33337082442919813,
    pixelWidth: 374,
    pixelHeight: 374,
  },
  "building-small-workshop": {
    file: "/props/desert-industrial-v1/building-small-workshop.png",
    anchorX: 226.13622664255576,
    anchorY: 125.87341772151899,
    unitsPerPixel: 0.3331277520402745,
    pixelWidth: 452,
    pixelHeight: 258,
  },
  "building-large-warehouse": {
    file: "/props/desert-industrial-v1/building-large-warehouse.png",
    anchorX: 357.5,
    anchorY: 179.7576099210823,
    unitsPerPixel: 0.33338031477566366,
    pixelWidth: 715,
    pixelHeight: 358,
  },
  "building-large-factory": {
    file: "/props/desert-industrial-v1/building-large-factory.png",
    anchorX: 214.71174728529124,
    anchorY: 327.78479763079963,
    unitsPerPixel: 0.33319032705535767,
    pixelWidth: 429,
    pixelHeight: 658,
  },
  "building-large-sandstone": {
    file: "/props/desert-industrial-v1/building-large-sandstone.png",
    anchorX: 323.0,
    anchorY: 291.2375189107413,
    unitsPerPixel: 0.33343211869376327,
    pixelWidth: 646,
    pixelHeight: 581,
  },
  "crate-small-wood": {
    file: "/props/desert-industrial-v1/crate-small-wood.png",
    anchorX: 72.44218500797447,
    anchorY: 72.67344497607655,
    unitsPerPixel: 0.33369553165539423,
    pixelWidth: 145,
    pixelHeight: 145,
  },
  "crate-long-wood": {
    file: "/props/desert-industrial-v1/crate-long-wood.png",
    anchorX: 134.0,
    anchorY: 138.7017543859649,
    unitsPerPixel: 0.3330323471609922,
    pixelWidth: 268,
    pixelHeight: 268,
  },
  "crate-tall-metal": {
    file: "/props/desert-industrial-v1/crate-tall-metal.png",
    anchorX: 75.58083511777302,
    anchorY: 140.00642398286936,
    unitsPerPixel: 0.3328482760668785,
    pixelWidth: 151,
    pixelHeight: 272,
  },
  "crate-wide-amber": {
    file: "/props/desert-industrial-v1/crate-wide-amber.png",
    anchorX: 110.07161458333333,
    anchorY: 71.7578125,
    unitsPerPixel: 0.3332610110653069,
    pixelWidth: 220,
    pixelHeight: 147,
  },
  "rock-small-faceted": {
    file: "/props/desert-industrial-v1/rock-small-faceted.png",
    anchorX: 127.00000000000001,
    anchorY: 126.39234449760767,
    unitsPerPixel: 0.33350113503604567,
    pixelWidth: 254,
    pixelHeight: 254,
  },
  "rock-large-cracked": {
    file: "/props/desert-industrial-v1/rock-large-cracked.png",
    anchorX: 214.0,
    anchorY: 212.6347687400319,
    unitsPerPixel: 0.33294392523364486,
    pixelWidth: 428,
    pixelHeight: 428,
  },
  "rock-medium-fused": {
    file: "/props/desert-industrial-v1/rock-medium-fused.png",
    anchorX: 171.5,
    anchorY: 172.32057416267943,
    unitsPerPixel: 0.3331585460494578,
    pixelWidth: 343,
    pixelHeight: 343,
  },
  "pyramid-small-sandstone": {
    file: "/props/desert-industrial-v1/pyramid-small-sandstone.png",
    anchorX: 156.0,
    anchorY: 157.1196172248804,
    unitsPerPixel: 0.33339241403757536,
    pixelWidth: 312,
    pixelHeight: 312,
  },
  "pyramid-large-stepped": {
    file: "/props/desert-industrial-v1/pyramid-large-stepped.png",
    anchorX: 259.8307291666667,
    anchorY: 174.1796875,
    unitsPerPixel: 0.3330883681705921,
    pixelWidth: 520,
    pixelHeight: 347,
  },
  "pyramid-tall-obsidian": {
    file: "/props/desert-industrial-v1/pyramid-tall-obsidian.png",
    anchorX: 215.17145135566187,
    anchorY: 210.37081339712918,
    unitsPerPixel: 0.3329492923689638,
    pixelWidth: 430,
    pixelHeight: 430,
  },
};
/** Add map-specific replacements by stable variant id; absent variants always use the shared pack. */
export type MapObstacleArt = Partial<
  Record<ArenaMapId, Readonly<Record<string, ObstacleArtwork>>>
>;
export const MAP_OBSTACLE_ART: MapObstacleArt = {};
/**
 * A piece's artwork: the map's own replacement for that variant when it has one, else the shared pack. A mover carries
 * no artwork — it is painted from primitives (`obstacleParts`) — so it has none.
 */
export function obstacleArtwork(
  obstacle: Obstacle,
  map: ArenaMapId,
  skins: MapObstacleArt = MAP_OBSTACLE_ART,
): ObstacleArtwork | null {
  const variant = obstacleVariant(obstacle);
  if (!variant) return null;
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

/** The kinds drawn from primitives: a map's movers, which carry no artwork of their own. */
export type MoverObstacleKind = Extract<ObstacleKind, "wall" | "train">;
export function isMoverObstacleKind(
  kind: ObstacleKind,
): kind is MoverObstacleKind {
  return kind === "wall" || kind === "train";
}

/**
 * A mover's primitives. Standing scenery is drawn from its catalog artwork instead, so this returns nothing for
 * it: a caller that paints every obstacle would otherwise draw a rock twice.
 */
export function obstacleParts(
  obstacle: Obstacle,
  _map: ArenaMapId,
  mover?: MoverPose,
): ObstaclePart[] {
  if (!isMoverObstacleKind(obstacle.kind)) return [];
  const style = OBSTACLE_STYLES[obstacle.kind];
  return style.build === "wall"
    ? wallParts(obstacle, style)
    : trainCarParts(obstacle, mover);
}

/**
 * A run of wall the width of the board: the pixel boundary's violet, a lit edge along its length and a warning stud
 * every so often, so a wandering wall reads as the wall it is and not as a trail. Works for any footprint: the long
 * side is the length.
 */
function wallParts(obstacle: Obstacle, style: ObstacleStyle): ObstaclePart[] {
  const { x, y, halfWidth: hw, halfHeight: hh } = obstacle;
  const left = x - hw,
    top = y - hh,
    width = hw * 2,
    height = hh * 2;
  const horizontal = width >= height;
  // A shallower drop shadow than a rock's: a 12-unit band with six units of shadow under it would read as half again its lethal thickness.
  const parts: ObstaclePart[] = [
    {
      shape: "rect",
      x: left + 2,
      y: top + 3,
      width,
      height,
      color: "#000000",
      alpha: 0.35,
    },
    { shape: "rect", x: left, y: top, width, height, color: style.shade },
    {
      shape: "rect",
      x: left + 1,
      y: top + 1,
      width: Math.max(1, width - 2),
      height: Math.max(1, height - 2),
      color: style.body,
    },
  ];
  const lit = Math.max(1, Math.min(2, (horizontal ? height : width) * 0.2));
  parts.push(
    horizontal
      ? {
          shape: "rect",
          x: left + 1,
          y: top + 1,
          width: Math.max(1, width - 2),
          height: lit,
          color: style.top,
        }
      : {
          shape: "rect",
          x: left + 1,
          y: top + 1,
          width: lit,
          height: Math.max(1, height - 2),
          color: style.top,
        },
  );
  const span = horizontal ? width : height;
  const stud = Math.max(1, Math.min(3, (horizontal ? height : width) - 4));
  for (let at = 48; at < span - 8; at += 96)
    parts.push({
      shape: "rect",
      x: horizontal ? left + at : x - stud / 2,
      y: horizontal ? y - stud / 2 : top + at,
      width: stud,
      height: stud,
      color: style.detail,
    });
  return parts;
}

/**
 * A car of a train in its livery: an outlined box with a roof stripe along the way it runs, a headlight on the
 * locomotive and a tail light on the last car. The box is the footprint exactly, however the rails turn under it.
 */
function trainCarParts(obstacle: Obstacle, mover?: MoverPose): ObstaclePart[] {
  const { x, y, halfWidth: hw, halfHeight: hh } = obstacle;
  const livery =
    (obstacle.motion?.kind === "rail" &&
      TRAIN_LIVERIES[obstacle.motion.train]) ||
    OBSTACLE_STYLES.train;
  const left = x - hw,
    top = y - hh,
    width = hw * 2,
    height = hh * 2;
  const dx = mover?.dx ?? 1,
    dy = mover?.dy ?? 0;
  const alongX = Math.abs(dx) >= Math.abs(dy);
  const parts: ObstaclePart[] = [
    {
      shape: "rect",
      x: left + 4,
      y: top + 6,
      width,
      height,
      color: "#000000",
      alpha: 0.35,
    },
    { shape: "rect", x: left, y: top, width, height, color: livery.shade },
    {
      shape: "rect",
      x: left + 2,
      y: top + 2,
      width: Math.max(1, width - 4),
      height: Math.max(1, height - 4),
      color: livery.body,
    },
  ];
  // The roof stripe runs the way the car does; the windows sit either side of it.
  const stripe = Math.max(2, Math.min(6, (alongX ? height : width) * 0.2));
  parts.push(
    alongX
      ? {
          shape: "rect",
          x: left + 4,
          y: y - stripe / 2,
          width: Math.max(1, width - 8),
          height: stripe,
          color: livery.top,
        }
      : {
          shape: "rect",
          x: x - stripe / 2,
          y: top + 4,
          width: stripe,
          height: Math.max(1, height - 8),
          color: livery.top,
        },
  );
  const pane = Math.max(1, Math.min(3, Math.min(width, height) * 0.1));
  for (const side of [-1, 1])
    for (const along of [-0.25, 0.25]) {
      const px = alongX ? x + along * (width - 8) : x + side * (hw - 5);
      const py = alongX ? y + side * (hh - 5) : y + along * (height - 8);
      parts.push({
        shape: "rect",
        x: px - pane / 2,
        y: py - pane / 2,
        width: pane,
        height: pane,
        color: "#eaf6ff",
        alpha: 0.85,
      });
    }
  const lamp = Math.max(1, Math.min(4, Math.min(width, height) * 0.14));
  if (mover?.head)
    parts.push({
      shape: "rect",
      x: x + dx * (hw - lamp) - lamp / 2,
      y: y + dy * (hh - lamp) - lamp / 2,
      width: lamp,
      height: lamp,
      color: "#fff7c2",
    });
  if (mover?.tail)
    parts.push({
      shape: "rect",
      x: x - dx * (hw - lamp) - lamp / 2,
      y: y - dy * (hh - lamp) - lamp / 2,
      width: lamp,
      height: lamp,
      color: "#ff3b30",
    });
  return parts;
}

export interface TrackSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
/** How a loop of track is drawn: a gravel bed along the centreline, sleepers across it, and two rails either side. */
export interface TrackDecoration {
  bed: readonly TrackSegment[];
  sleepers: readonly TrackSegment[];
  rails: readonly TrackSegment[];
}
export const TRACK_GAUGE = 10;
export const SLEEPER_SPACING = 14;
export const SLEEPER_HALF_LENGTH = 8;
export const TRACK_COLOURS = Object.freeze({
  bed: "#232833",
  sleeper: "#5a4632",
  rail: "#b9c2cc",
});

/**
 * Rails are the loop offset either side of its centreline, mitred at every corner so they meet cleanly; sleepers
 * are laid at a fixed spacing along it. Pure geometry from the same loop the cars are advanced along.
 */
export function trackDecoration(track: Track): TrackDecoration {
  const points = track.points;
  const count = points.length;
  const bed: TrackSegment[] = [];
  for (let index = 0; index < count; index += 1) {
    const from = points[index]!,
      to = points[(index + 1) % count]!;
    bed.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y });
  }
  const rails: TrackSegment[] = [];
  for (const side of [-1, 1]) {
    const offset = points.map((point, index) => {
      const before = points[(index + count - 1) % count]!,
        after = points[(index + 1) % count]!;
      const inX = point.x - before.x,
        inY = point.y - before.y,
        outX = after.x - point.x,
        outY = after.y - point.y;
      const inLength = Math.hypot(inX, inY) || 1,
        outLength = Math.hypot(outX, outY) || 1;
      // Left normals of the two rails meeting here, and the bisector between them.
      const n0x = -inY / inLength,
        n0y = inX / inLength,
        n1x = -outY / outLength,
        n1y = outX / outLength;
      const mx = n0x + n1x,
        my = n0y + n1y;
      const mLength = Math.hypot(mx, my) || 1;
      const bx = mx / mLength,
        by = my / mLength;
      const reach = TRACK_GAUGE / 2 / Math.max(0.5, bx * n0x + by * n0y);
      return { x: point.x + side * bx * reach, y: point.y + side * by * reach };
    });
    for (let index = 0; index < count; index += 1) {
      const from = offset[index]!,
        to = offset[(index + 1) % count]!;
      rails.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y });
    }
  }
  const sleepers: TrackSegment[] = [];
  const length = trackLength(track);
  for (
    let along = SLEEPER_SPACING / 2;
    along < length;
    along += SLEEPER_SPACING
  ) {
    const pose = trackPose(track, along);
    sleepers.push({
      x1: pose.x - pose.dy * SLEEPER_HALF_LENGTH,
      y1: pose.y + pose.dx * SLEEPER_HALF_LENGTH,
      x2: pose.x + pose.dy * SLEEPER_HALF_LENGTH,
      y2: pose.y - pose.dx * SLEEPER_HALF_LENGTH,
    });
  }
  return { bed, sleepers, rails };
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

/**
 * Arena maps: the ground a round is played on and the solid obstacles standing on it.
 *
 * An obstacle is simulation geometry, not decoration. A rider that touches one dies exactly as it dies against the
 * boundary, and a bomb blast clears it away, so the layout has to be identical on every device: it is generated once
 * per round from the game's own seeded stream and travels in snapshots and checkpoints like any other state.
 *
 * The visual STYLE a device renders in (`ThemeId`) is a separate, per-device choice and is deliberately not part of
 * this: a map says where the rocks are and what colour the ground is, a style says how walls, trails and sprites draw.
 */

import type { ObstacleMotion } from "./scenery-motion.js";

export const ARENA_MAPS = [
  "classic",
  "desert",
  "forest",
  "city",
  "wrap",
  "cross",
  "drift",
  "trains",
] as const;
export type ArenaMapId = (typeof ARENA_MAPS)[number];
/**
 * `rotate` cycles `ROTATION_MAPS`: the obstacle maps and `classic`, the obstacle-free arena, so a match has open
 * rounds among the cluttered ones. Naming `classic` is how a room turns obstacles off altogether.
 *
 * Two maps change the board's edges rather than what stands on it. `wrap` has none until overtime: riders, shells,
 * bullets, thrown bombs and blasts all carry through one side and out of the other (see `wrap.ts`). `cross` is the
 * classic arena under exactly the classic rules, and differs only in how it is drawn — shifted by half a board, so
 * the outer wall meets in a cross at the middle of the screen and the screen's own edges are open. Neither is in the
 * rotation: one changes the rules of the edges and the other only how hard the board is to read, so a room opts in.
 *
 * Two more put scenery that moves on the board (`scenery-motion.ts`). `drift` is the wrapping board with a cross of
 * walls on it that wanders like a screensaver logo, turned back by the board's edges. `trains` keeps the classic
 * walls and runs trains round two loops of track; the track is decoration, the trains kill. Both are opt-in too.
 */
export type ArenaMapChoice = ArenaMapId | "rotate";
export const ARENA_MAP_CHOICES = ["rotate", ...ARENA_MAPS] as const;
export const ROTATION_MAPS = [
  "classic",
  "desert",
  "forest",
  "city",
] as const satisfies readonly ArenaMapId[];

export const OBSTACLE_KINDS = [
  "rock",
  "building",
  "crate",
  "pyramid",
  "wall",
  "train",
] as const;
export type ObstacleKind = (typeof OBSTACLE_KINDS)[number];
/** Kinds a blast does not clear and the overtime walls do not crush: the moving pieces a map is made of. */
export const PERMANENT_OBSTACLE_KINDS: readonly ObstacleKind[] = Object.freeze([
  "wall",
  "train",
]);
export function obstacleIsPermanent(obstacle: Pick<Obstacle, "kind">): boolean {
  return PERMANENT_OBSTACLE_KINDS.includes(obstacle.kind);
}

/**
 * The kinds a layout samples from the shared prop catalog. The movers are shaped by the map that lays them
 * (`scenery-motion.ts`) rather than by any artwork, so they have no catalog entry.
 */
export type PropObstacleKind = Exclude<ObstacleKind, "wall" | "train">;
export function isPropObstacleKind(
  kind: ObstacleKind,
): kind is PropObstacleKind {
  return !PERMANENT_OBSTACLE_KINDS.includes(kind);
}

export interface ObstacleVariant {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}
/** Fixed collider sizes from the source art. List order and dimensions are simulation rules. */
export const OBSTACLE_VARIANTS: Record<
  PropObstacleKind,
  readonly ObstacleVariant[]
> = {
  rock: [
    { id: "rock-small-faceted", width: 56.0, height: 56.0 },
    { id: "rock-large-cracked", width: 100.0, height: 100.0 },
    { id: "rock-medium-fused", width: 76.0, height: 76.0 },
  ],
  building: [
    { id: "building-small-sandstone", width: 96.0, height: 64.71111111111111 },
    { id: "building-small-vent", width: 60.55066921606119, height: 104.0 },
    { id: "building-small-workshop", width: 112.0, height: 49.55591572123177 },
    { id: "building-large-warehouse", width: 208.0, height: 69.06459948320413 },
    { id: "building-large-factory", width: 104.69938650306747, height: 184.0 },
    {
      id: "building-large-sandstone",
      width: 160.0,
      height: 135.23421588594704,
    },
  ],
  crate: [
    { id: "crate-small-wood", width: 36.0, height: 34.76527331189711 },
    {
      id: "crate-long-wood",
      width: 80.00000000000001,
      height: 34.87544483985766,
    },
    { id: "crate-tall-metal", width: 42.134529147982065, height: 72.0 },
    { id: "crate-wide-amber", width: 60.0, height: 35.22673031026253 },
  ],
  pyramid: [
    { id: "pyramid-small-sandstone", width: 72.0, height: 70.25806451612904 },
    { id: "pyramid-large-stepped", width: 144.0, height: 84.23492560689115 },
    { id: "pyramid-tall-obsidian", width: 77.52089704383282, height: 112.0 },
  ],
};
/**
 * IDs survive removals and rollback; neither array position nor the map's skin selects geometry. A mover carries no
 * artwork of its own, so it has no variant.
 */
export function obstacleVariant(
  obstacle: Pick<Obstacle, "id" | "kind">,
): ObstacleVariant | null {
  if (!isPropObstacleKind(obstacle.kind)) return null;
  const variants = OBSTACLE_VARIANTS[obstacle.kind];
  return variants[(obstacle.id - 1) % variants.length]!;
}

/**
 * A prop stands at exactly its catalog collider, so a checkpoint cannot smuggle in a rock of any other size. A mover's
 * size is its map's; the checkpoint's own map checks decide whether it belongs on this board at all.
 */
export function validObstacleDimensions(obstacle: Obstacle): boolean {
  const variant = obstacleVariant(obstacle);
  if (!variant) return obstacle.halfWidth > 0 && obstacle.halfHeight > 0;
  return (
    obstacle.halfWidth === variant.width / 2 &&
    obstacle.halfHeight === variant.height / 2
  );
}

/** Axis-aligned and centred, so every test below is a clamp rather than a rotation. */
export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
  /** Present on scenery that moves: advanced once a tick by `moveScenery`, and restored from a checkpoint with it. */
  motion?: ObstacleMotion;
}

/** Bounds the whole obstacle rectangle must sit inside, already inset by the boundary. */
export interface ObstacleBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
/** A capsule no obstacle may touch: the spawn point and the road ahead of it. */
export interface ClearCapsule {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  radius: number;
}
export interface ObstacleSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Surface radius: zero for a wall, rock radius for a point circle. */
  radius: number;
}

/** Every collision path uses the same complete rectangle or circle footprint. */
export const OBSTACLE_HIT_SHAPES: Record<
  ObstacleKind,
  { round: boolean; scale: number }
> = {
  rock: { round: true, scale: 1 },
  crate: { round: false, scale: 1 },
  building: { round: false, scale: 1 },
  pyramid: { round: false, scale: 1 },
  wall: { round: false, scale: 1 },
  train: { round: false, scale: 1 },
};
export interface ObstacleHitbox extends Obstacle {
  round: boolean;
}
export function obstacleHitbox(obstacle: Obstacle): ObstacleHitbox {
  return { ...obstacle, round: obstacle.kind === "rock" };
}
export const hitboxBlocksPath = obstacleBlocksPath;
export const hitboxBounceNormal = obstacleBounceNormal;

/** A whole board's worth. Also the checkpoint's array bound, so a hostile layout cannot grow the state. */
export const MAX_OBSTACLES = 40;
/** Obstacles keep clear of the boundary wall, so a rider can always ride the perimeter. */
export const OBSTACLE_WALL_MARGIN = 26;
export const OBSTACLE_PLACEMENT_ATTEMPTS = 24;

interface ObstacleSpecies {
  /** Only catalog props are sampled; a map's movers are laid by `scenery-motion.ts`, not by a recipe. */
  kind: PropObstacleKind;
  /** Inclusive count range; the roll is one RNG sample whatever the outcome. */
  min: number;
  max: number;
}
interface ArenaMapRecipe {
  species: readonly ObstacleSpecies[];
  /** Gap every pair of obstacles keeps, so the board is never sealed into rooms a rider cannot leave. */
  spacing: number;
}

/**
 * Sizes are in world units against a 1600x900 arena with a rider 14 units across and a turning circle near 54, so
 * the smallest gap a layout can leave (`spacing`) is comfortably wider than the tightest turn a rider can make.
 */
export const ARENA_MAP_RECIPES: Record<ArenaMapId, ArenaMapRecipe> = {
  classic: { species: [], spacing: 0 },
  desert: {
    spacing: 76,
    species: [
      { kind: "pyramid", min: 3, max: 4 },
      { kind: "rock", min: 4, max: 6 },
      { kind: "building", min: 2, max: 3 },
      { kind: "crate", min: 3, max: 4 },
    ],
  },
  forest: {
    spacing: 70,
    species: [
      { kind: "rock", min: 4, max: 6 },
      { kind: "building", min: 3, max: 4 },
      { kind: "crate", min: 3, max: 5 },
      { kind: "pyramid", min: 2, max: 3 },
    ],
  },
  city: {
    spacing: 104,
    species: [
      { kind: "building", min: 4, max: 6 },
      { kind: "crate", min: 4, max: 6 },
      { kind: "pyramid", min: 2, max: 3 },
      { kind: "rock", min: 2, max: 3 },
    ],
  },
  wrap: { species: [], spacing: 0 },
  cross: { species: [], spacing: 0 },
  drift: { species: [], spacing: 0 },
  trains: { species: [], spacing: 0 },
};

/** Whether a map's edges are open until overtime: `wrap`, and `drift`, which is `wrap` with a wandering cross on it. */
export function mapWraps(map: ArenaMapId): boolean {
  return map === "wrap" || map === "drift";
}

/** Whether there is anything solid on the board besides the wall: sampled scenery, or the movers a map starts with. */
export function mapHasScenery(map: ArenaMapId): boolean {
  return (
    ARENA_MAP_RECIPES[map].species.length > 0 ||
    map === "drift" ||
    map === "trains"
  );
}

/** The inset a round starts with. A wrapping board has no wall to inset until overtime brings one in from the edges. */
export function initialBoundaryInset(map: ArenaMapId, walled: number): number {
  return mapWraps(map) ? 0 : walled;
}

/**
 * Whether the board's edges are open right now. Overtime closes them: the walls come in from the very edge, and from
 * the first tick they stand the round is an ordinary walled one, which is how a wrapping round is guaranteed to end.
 */
export function edgesOpen(board: {
  map: ArenaMapId;
  boundaryInset: number;
}): boolean {
  return mapWraps(board.map) && board.boundaryInset <= 0;
}

export interface ObstacleLayoutOptions {
  map: ArenaMapId;
  bounds: ObstacleBounds;
  /** The game's seeded stream; the number of samples drawn depends only on the values it returns. */
  random: () => number;
  keepClear: readonly ClearCapsule[];
}

/**
 * The round's layout. Rejection sampling with a bounded attempt count per obstacle: a crowded board simply places
 * fewer, which every replica agrees on because the rejections are driven by the same samples in the same order.
 */
export function generateObstacles(options: ObstacleLayoutOptions): Obstacle[] {
  const recipe = ARENA_MAP_RECIPES[options.map];
  const { bounds, random, keepClear } = options;
  const placed: Obstacle[] = [];
  for (const species of recipe.species) {
    const count =
      species.min + Math.floor(random() * (species.max - species.min + 1));
    for (
      let index = 0;
      index < count && placed.length < MAX_OBSTACLES;
      index += 1
    ) {
      for (
        let attempt = 0;
        attempt < OBSTACLE_PLACEMENT_ATTEMPTS;
        attempt += 1
      ) {
        const variant = obstacleVariant({
          kind: species.kind,
          id: placed.length + 1,
        })!;
        const halfWidth = variant.width / 2;
        const halfHeight = variant.height / 2;
        const spanX = bounds.maxX - bounds.minX - 2 * halfWidth;
        const spanY = bounds.maxY - bounds.minY - 2 * halfHeight;
        // Two samples are drawn either way, so a board too small for this species does not shift every later roll.
        const x = bounds.minX + halfWidth + random() * Math.max(0, spanX);
        const y = bounds.minY + halfHeight + random() * Math.max(0, spanY);
        if (spanX < 0 || spanY < 0) break;
        const candidate: Obstacle = {
          id: placed.length + 1,
          kind: species.kind,
          x,
          y,
          halfWidth,
          halfHeight,
        };
        if (
          keepClear.some((capsule) =>
            obstacleBlocksPath(
              candidate,
              capsule.x1,
              capsule.y1,
              capsule.x2,
              capsule.y2,
              capsule.radius,
            ),
          )
        )
          continue;
        if (
          placed.some((other) => obstacleGap(candidate, other) < recipe.spacing)
        )
          continue;
        placed.push(candidate);
        break;
      }
    }
  }
  return placed;
}

/** Rotation is by round rather than by roll, so a match visits every map in the rotation before it repeats one. */
export function chooseArenaMap(
  choice: ArenaMapChoice,
  seed: number,
  round: number,
): ArenaMapId {
  if (choice !== "rotate") return choice;
  const offset = (seed >>> 0) % ROTATION_MAPS.length;
  // `round` starts at 1 and only ever grows within a match.
  return ROTATION_MAPS[
    (offset + Math.max(0, round - 1)) % ROTATION_MAPS.length
  ]!;
}

/** Shell surfaces: four radius-zero walls, or a point expanded to the rock radius. */
export function obstacleEdges(obstacle: Obstacle): ObstacleSegment[] {
  if (obstacle.kind === "rock")
    return [
      {
        x1: obstacle.x,
        y1: obstacle.y,
        x2: obstacle.x,
        y2: obstacle.y,
        radius: obstacle.halfWidth,
      },
    ];
  const minX = obstacle.x - obstacle.halfWidth,
    maxX = obstacle.x + obstacle.halfWidth;
  const minY = obstacle.y - obstacle.halfHeight,
    maxY = obstacle.y + obstacle.halfHeight;
  return [
    { x1: minX, y1: minY, x2: maxX, y2: minY, radius: 0 },
    { x1: maxX, y1: minY, x2: maxX, y2: maxY, radius: 0 },
    { x1: maxX, y1: maxY, x2: minX, y2: maxY, radius: 0 },
    { x1: minX, y1: maxY, x2: minX, y2: minY, radius: 0 },
  ];
}

/** Whether a swept point of the given radius touches the obstacle anywhere along the step. */
export function obstacleBlocksPath(
  obstacle: Obstacle,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  radius: number,
): boolean {
  return (
    segmentObstacleDistanceSquared(obstacle, x1, y1, x2, y2) <= radius * radius
  );
}

/** Whether a disk overlaps the obstacle: blast destruction, and clearance for anything spawned on the board. */
export function obstacleTouchesCircle(
  obstacle: Obstacle,
  x: number,
  y: number,
  radius: number,
): boolean {
  return obstacleDistanceSquared(obstacle, x, y) <= radius * radius;
}

/**
 * Outward unit normal of the surface nearest a point, for whatever bounces off scenery rather than dying on it.
 * Past a corner the diagonal is the true normal, which is what keeps a bounce off a corner from facing a flat side.
 */
export function obstacleBounceNormal(
  obstacle: Obstacle,
  x: number,
  y: number,
): { nx: number; ny: number } {
  const dx = x - obstacle.x,
    dy = y - obstacle.y;
  if (obstacle.kind === "rock") {
    const length = Math.sqrt(dx * dx + dy * dy);
    return length > 0 ? { nx: dx / length, ny: dy / length } : { nx: 1, ny: 0 };
  }
  const outX = Math.abs(dx) - obstacle.halfWidth,
    outY = Math.abs(dy) - obstacle.halfHeight;
  if (outX > 0 && outY > 0) {
    const length = Math.sqrt(outX * outX + outY * outY);
    return {
      nx: (Math.sign(dx) * outX) / length,
      ny: (Math.sign(dy) * outY) / length,
    };
  }
  return outX > outY
    ? { nx: Math.sign(dx) || 1, ny: 0 }
    : { nx: 0, ny: Math.sign(dy) || 1 };
}

export function obstacleDistanceSquared(
  obstacle: Obstacle,
  x: number,
  y: number,
): number {
  if (obstacle.kind === "rock") {
    const dx = x - obstacle.x,
      dy = y - obstacle.y;
    const gap = Math.max(0, Math.sqrt(dx * dx + dy * dy) - obstacle.halfWidth);
    return gap * gap;
  }
  const dx = Math.max(Math.abs(x - obstacle.x) - obstacle.halfWidth, 0);
  const dy = Math.max(Math.abs(y - obstacle.y) - obstacle.halfHeight, 0);
  return dx * dx + dy * dy;
}

/** Retained only while the whole rectangle is still in play: overtime walls crush what they reach. */
export function obstacleInsideBounds(
  obstacle: Obstacle,
  bounds: ObstacleBounds,
): boolean {
  return (
    obstacle.x - obstacle.halfWidth >= bounds.minX &&
    obstacle.x + obstacle.halfWidth <= bounds.maxX &&
    obstacle.y - obstacle.halfHeight >= bounds.minY &&
    obstacle.y + obstacle.halfHeight <= bounds.maxY
  );
}

/** Conservative bounding-box separation, also used for circular rocks during placement. */
function obstacleGap(a: Obstacle, b: Obstacle): number {
  const dx = Math.max(Math.abs(a.x - b.x) - a.halfWidth - b.halfWidth, 0);
  const dy = Math.max(Math.abs(a.y - b.y) - a.halfHeight - b.halfHeight, 0);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Both shapes are convex, so the closest pair sits either on an endpoint of the segment or on a corner of the
 * rectangle — unless they cross, which the clip below settles first.
 */
export function segmentObstacleDistanceSquared(
  obstacle: Obstacle,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  if (obstacle.kind === "rock") {
    const distance = Math.sqrt(
      pointSegmentDistanceSquared(obstacle.x, obstacle.y, x1, y1, x2, y2),
    );
    const gap = Math.max(0, distance - obstacle.halfWidth);
    return gap * gap;
  }
  if (segmentCrossesObstacle(obstacle, x1, y1, x2, y2)) return 0;
  let best = Math.min(
    obstacleDistanceSquared(obstacle, x1, y1),
    obstacleDistanceSquared(obstacle, x2, y2),
  );
  const minX = obstacle.x - obstacle.halfWidth,
    maxX = obstacle.x + obstacle.halfWidth;
  const minY = obstacle.y - obstacle.halfHeight,
    maxY = obstacle.y + obstacle.halfHeight;
  for (const [cx, cy] of [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ] as const) {
    best = Math.min(best, pointSegmentDistanceSquared(cx, cy, x1, y1, x2, y2));
  }
  return best;
}

/** Liang-Barsky: the segment survives clipping against all four slabs exactly when it meets the rectangle. */
function segmentCrossesObstacle(
  obstacle: Obstacle,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): boolean {
  const dx = x2 - x1,
    dy = y2 - y1;
  const edges: readonly (readonly [number, number])[] = [
    [-dx, x1 - (obstacle.x - obstacle.halfWidth)],
    [dx, obstacle.x + obstacle.halfWidth - x1],
    [-dy, y1 - (obstacle.y - obstacle.halfHeight)],
    [dy, obstacle.y + obstacle.halfHeight - y1],
  ];
  let enter = 0,
    leave = 1;
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const crossing = q / p;
    if (p < 0) {
      if (crossing > leave) return false;
      if (crossing > enter) enter = crossing;
    } else {
      if (crossing < enter) return false;
      if (crossing < leave) leave = crossing;
    }
  }
  return true;
}

function pointSegmentDistanceSquared(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax,
    dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const along =
    lengthSquared > 0
      ? Math.max(
          0,
          Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared),
        )
      : 0;
  const offsetX = px - (ax + along * dx),
    offsetY = py - (ay + along * dy);
  return offsetX * offsetX + offsetY * offsetY;
}

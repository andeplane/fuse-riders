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

export const ARENA_MAPS = [
  "classic",
  "desert",
  "forest",
  "city",
  "wrap",
  "cross",
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
 */
export type ArenaMapChoice = ArenaMapId | "rotate";
export const ARENA_MAP_CHOICES = ["rotate", ...ARENA_MAPS] as const;
export const ROTATION_MAPS: readonly ArenaMapId[] = [
  "classic",
  "desert",
  "forest",
  "city",
];

export const OBSTACLE_KINDS = [
  "rock",
  "cactus",
  "tree",
  "bush",
  "building",
  "crate",
] as const;
export type ObstacleKind = (typeof OBSTACLE_KINDS)[number];

/** Axis-aligned and centred, so every test below is a clamp rather than a rotation. */
export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
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
}

/**
 * What a rider dies against. A flat-faced piece is its whole footprint: the face drawn is the face hit. A crown is
 * drawn as an ellipse, so it kills as one, and the corners of its footprint are floor; it and the cactus, which is
 * mostly the air between its arms, also give up a little of their extent, so a brush past one is a brush.
 * Projectiles, blasts and placement still use the whole footprint: only the rider's own death is judged this way.
 */
export const OBSTACLE_HIT_SHAPES: Record<
  ObstacleKind,
  { round: boolean; scale: number }
> = {
  rock: { round: false, scale: 1 },
  crate: { round: false, scale: 1 },
  building: { round: false, scale: 1 },
  cactus: { round: false, scale: 0.85 },
  tree: { round: true, scale: 0.9 },
  bush: { round: true, scale: 0.9 },
};

/** An obstacle's footprint scaled about its centre, read as the ellipse inside it when `round`. */
export interface ObstacleHitbox extends Obstacle {
  round: boolean;
}

export function obstacleHitbox(obstacle: Obstacle): ObstacleHitbox {
  const { round, scale } = OBSTACLE_HIT_SHAPES[obstacle.kind];
  return {
    ...obstacle,
    halfWidth: obstacle.halfWidth * scale,
    halfHeight: obstacle.halfHeight * scale,
    round,
  };
}

/**
 * Whether a swept rider of the given radius touches the hitbox anywhere along the step. A round one is tested in the
 * space where the ellipse, grown by the radius on each axis, is the unit circle: not the exact offset curve of an
 * ellipse, but within a fraction of a unit of it for crowns this close to round, and plain arithmetic throughout.
 */
export function hitboxBlocksPath(
  hitbox: ObstacleHitbox,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  radius: number,
): boolean {
  if (!hitbox.round) return obstacleBlocksPath(hitbox, x1, y1, x2, y2, radius);
  const rx = hitbox.halfWidth + radius,
    ry = hitbox.halfHeight + radius;
  return (
    pointSegmentDistanceSquared(
      0,
      0,
      (x1 - hitbox.x) / rx,
      (y1 - hitbox.y) / ry,
      (x2 - hitbox.x) / rx,
      (y2 - hitbox.y) / ry,
    ) <= 1
  );
}

/** Outward unit normal of the hitbox's surface nearest a point: what a shielded rider is turned away along. */
export function hitboxBounceNormal(
  hitbox: ObstacleHitbox,
  x: number,
  y: number,
): { nx: number; ny: number } {
  if (!hitbox.round) return obstacleBounceNormal(hitbox, x, y);
  // The gradient of the ellipse's own equation, which is its normal at every point on it.
  const gx = (x - hitbox.x) / (hitbox.halfWidth * hitbox.halfWidth),
    gy = (y - hitbox.y) / (hitbox.halfHeight * hitbox.halfHeight);
  const length = Math.sqrt(gx * gx + gy * gy);
  return length > 0 ? { nx: gx / length, ny: gy / length } : { nx: 1, ny: 0 };
}

/** A whole board's worth. Also the checkpoint's array bound, so a hostile layout cannot grow the state. */
export const MAX_OBSTACLES = 40;
/** Obstacles keep clear of the boundary wall, so a rider can always ride the perimeter. */
export const OBSTACLE_WALL_MARGIN = 26;
export const OBSTACLE_PLACEMENT_ATTEMPTS = 24;

interface ObstacleSpecies {
  kind: ObstacleKind;
  /** Inclusive count range; the roll is one RNG sample whatever the outcome. */
  min: number;
  max: number;
  width: readonly [number, number];
  height: readonly [number, number];
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
      { kind: "rock", min: 7, max: 10, width: [64, 124], height: [44, 86] },
      { kind: "cactus", min: 5, max: 8, width: [26, 38], height: [44, 72] },
    ],
  },
  forest: {
    spacing: 70,
    species: [
      { kind: "tree", min: 11, max: 15, width: [40, 58], height: [40, 58] },
      { kind: "bush", min: 4, max: 7, width: [30, 44], height: [26, 38] },
      { kind: "rock", min: 2, max: 4, width: [70, 120], height: [50, 88] },
    ],
  },
  city: {
    spacing: 104,
    species: [
      {
        kind: "building",
        min: 5,
        max: 7,
        width: [118, 210],
        height: [88, 156],
      },
      { kind: "crate", min: 5, max: 8, width: [30, 46], height: [30, 46] },
    ],
  },
  wrap: { species: [], spacing: 0 },
  cross: { species: [], spacing: 0 },
};

/** The inset a round starts with. A wrapping board has no wall to inset until overtime brings one in from the edges. */
export function initialBoundaryInset(map: ArenaMapId, walled: number): number {
  return map === "wrap" ? 0 : walled;
}

/**
 * Whether the board's edges are open right now. Overtime closes them: the walls come in from the very edge, and from
 * the first tick they stand the round is an ordinary walled one, which is how a wrapping round is guaranteed to end.
 */
export function edgesOpen(board: {
  map: ArenaMapId;
  boundaryInset: number;
}): boolean {
  return board.map === "wrap" && board.boundaryInset <= 0;
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
        const halfWidth =
          (species.width[0] +
            random() * (species.width[1] - species.width[0])) /
          2;
        const halfHeight =
          (species.height[0] +
            random() * (species.height[1] - species.height[0])) /
          2;
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

/** The four walls of an obstacle, for projectiles that bounce off solid geometry rather than die on it. */
export function obstacleEdges(obstacle: Obstacle): ObstacleSegment[] {
  const minX = obstacle.x - obstacle.halfWidth,
    maxX = obstacle.x + obstacle.halfWidth;
  const minY = obstacle.y - obstacle.halfHeight,
    maxY = obstacle.y + obstacle.halfHeight;
  return [
    { x1: minX, y1: minY, x2: maxX, y2: minY },
    { x1: maxX, y1: minY, x2: maxX, y2: maxY },
    { x1: maxX, y1: maxY, x2: minX, y2: maxY },
    { x1: minX, y1: maxY, x2: minX, y2: minY },
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

/** Shortest distance between two obstacles, zero when they overlap. */
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

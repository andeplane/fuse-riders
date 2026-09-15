

/**
 * Boundary and trail decoration geometry, in world units, shared by the Phaser arena and the legacy
 * canvas renderer so one theme cannot look pixelated in one and smooth in the other (#68 flattened
 * the walls in both; this restores the split the themes always described).
 */
export interface WallBrick { x: number; y: number; width: number; height: number; seed: number }
/** Three points of an L bracket hugging one arena corner. */
export type WallBracket = readonly [number, number, number, number, number, number];
export interface WallStud { x: number; y: number }

export interface PixelWall {
  bricks: readonly WallBrick[];
  brackets: readonly WallBracket[];
  /** Warning-light studs, drawn orange with a pale core. */
  studs: readonly WallStud[];
  studSize: number;
}

const BRICK = 32;
const GAP = 3;

const wallDepth = (inset: number): number => Math.max(8, Math.min(18, inset - 2));

/** The pixel themes' chunky brick wall: one brick run along each inner edge, plus corner furniture. */
export function pixelWall(width: number, height: number, inset: number): PixelWall {
  const depth = wallDepth(inset);
  const thickness = depth - 3;
  const bricks: WallBrick[] = [];
  let seed = 0;
  for (let x = inset; x < width - inset; x += BRICK + GAP) {
    const run = Math.min(BRICK, width - inset - x);
    bricks.push({ x, y: inset - depth, width: run, height: thickness, seed: seed++ });
    bricks.push({ x, y: height - inset + 3, width: run, height: thickness, seed: seed++ });
  }
  for (let y = inset; y < height - inset; y += BRICK + GAP) {
    const run = Math.min(BRICK, height - inset - y);
    bricks.push({ x: inset - depth, y, width: thickness, height: run, seed: seed++ });
    bricks.push({ x: width - inset + 3, y, width: thickness, height: run, seed: seed++ });
  }
  const arm = 27;
  const o = Math.max(2, inset - depth - 3);
  return {
    // A degenerate brick draws nothing but still costs a fill; drop it here rather than in each renderer.
    bricks: bricks.filter((brick) => brick.width > 1 && brick.height > 1),
    brackets: [
      [o + arm, o, o, o, o, o + arm],
      [width - o - arm, o, width - o, o, width - o, o + arm],
      [o, height - o - arm, o, height - o, o + arm, height - o],
      [width - o, height - o - arm, width - o, height - o, width - o - arm, height - o],
    ],
    studs: [
      { x: o + 5, y: o + 5 }, { x: width - o - 11, y: o + 5 },
      { x: o + 5, y: height - o - 11 }, { x: width - o - 11, y: height - o - 11 },
    ],
    studSize: 7,
  };
}

/** The smooth themes' single `wallWidth` stroke, set just outside the rim. */
export function smoothWallRect(width: number, height: number, inset: number): { x: number; y: number; width: number; height: number } {
  const offset = Math.max(3, inset - 8);
  return { x: offset, y: offset, width: width - offset * 2, height: height - offset * 2 };
}

/** World-space spacing between a pixel trail's bright core studs. */
export const TRAIL_STUD_SPACING = 6;

/**
 * Bright core studs along one trail path, the dotted highlight that reads as pixel art where a
 * smooth theme draws a hairline. Spacing is coarse on purpose: the full 4px run the pre-Phaser
 * canvas used costs thousands of fills per trail rebuild.
 * ponytail: fixed spacing, sample by remaining life if long trails ever cost too much.
 */
export function trailStuds(path: readonly WallStud[], spacing = TRAIL_STUD_SPACING): WallStud[] {
  const studs: WallStud[] = [];
  // Distances are measured along the whole path, so spacing stays even across every segment seam
  // instead of restarting — a trail is one segment per tick, and restarting would cluster the studs.
  let walked = 0;
  let next = 0;
  for (let index = 1; index < path.length; index++) {
    const from = path[index - 1]!;
    const to = path[index]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-6) continue;
    while (next <= walked + length) {
      const t = (next - walked) / length;
      studs.push({ x: Math.round(from.x + dx * t), y: Math.round(from.y + dy * t) });
      next += spacing;
    }
    walked += length;
  }
  return studs;
}

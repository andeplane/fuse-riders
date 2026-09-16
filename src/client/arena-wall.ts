import type { ThemeDefinition } from './themes.js';

/** Boundary and trail decoration geometry in world units, shared by Phaser's WebGL and Canvas backends. */
export interface WallBrick {
  x: number; y: number; width: number; height: number;
  /** One deterministic chip inside the brick, so a run does not read as a smooth extruded bar. */
  chip: WallRect;
}
/** Three points of an L bracket hugging one arena corner. */
export type WallBracket = readonly [number, number, number, number, number, number];
export interface WallStud { x: number; y: number }
export interface WallRect { x: number; y: number; width: number; height: number }

export interface PixelWall {
  kind: 'pixel';
  bricks: readonly WallBrick[];
  brackets: readonly WallBracket[];
  /** Warning-light studs, drawn in the theme's blast color with a pale core. */
  studs: readonly WallStud[];
  studSize: number;
}
export interface SmoothWall {
  kind: 'smooth';
  rect: WallRect;
  strokeWidth: number;
}
export type ArenaWall = PixelWall | SmoothWall;

const BRICK = 32;
const GAP = 3;

/** Bricks must stay inside the shaded band, so the run can never be deeper than the inset itself. */
const wallDepth = (inset: number): number => Math.min(18, Math.max(2, inset - 2));

/** How this theme draws the arena boundary. `pixelated` is the whole difference. */
export function arenaWall(width: number, height: number, inset: number, theme: ThemeDefinition): ArenaWall {
  return theme.rendering.pixelated
    ? pixelWall(width, height, inset)
    : { kind: 'smooth', rect: smoothWallRect(width, height, inset), strokeWidth: theme.rendering.wallWidth };
}

/** The pixel styles' chunky brick wall: one brick run along each inner edge, plus corner furniture. */
export function pixelWall(width: number, height: number, inset: number): PixelWall {
  const depth = wallDepth(inset);
  const thickness = depth - 3;
  const bricks: WallBrick[] = [];
  let seed = 0;
  const brick = (x: number, y: number, w: number, h: number): WallBrick => {
    const n = seed++;
    return {
      x, y, width: w, height: h,
      // 5/7 in from the lit corner, clamped so a short brick cannot put its chip outside itself.
      chip: {
        x: x + Math.min(5 + (n % Math.max(1, Math.round(w) - 11)), w - 4),
        y: y + Math.min(7 + ((n * 3) % Math.max(1, Math.round(h) - 12)), h - 3),
        width: 3, height: 2,
      },
    };
  };
  for (let x = inset; x < width - inset; x += BRICK + GAP) {
    const run = Math.min(BRICK, width - inset - x);
    bricks.push(brick(x, inset - depth, run, thickness));
    bricks.push(brick(x, height - inset + 3, run, thickness));
  }
  for (let y = inset; y < height - inset; y += BRICK + GAP) {
    const run = Math.min(BRICK, height - inset - y);
    bricks.push(brick(inset - depth, y, thickness, run));
    bricks.push(brick(width - inset + 3, y, thickness, run));
  }
  const arm = 27;
  const o = Math.max(2, inset - depth - 3);
  return {
    kind: 'pixel',
    // A brick too small for its own 6px inner detail draws a zero-width or misplaced sliver (reachable at the
    // half-unit insets where a run ends short in overtime); drop it rather than clamp in each renderer.
    bricks: bricks.filter((piece) => piece.width > 6 && piece.height > 6),
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

/** The smooth styles' single `wallWidth` stroke, set just outside the rim. */
export function smoothWallRect(width: number, height: number, inset: number): WallRect {
  const offset = Math.max(3, inset - 8);
  return { x: offset, y: offset, width: width - offset * 2, height: height - offset * 2 };
}

/** World-space spacing between a pixel trail's bright core studs. */
export const TRAIL_STUD_SPACING = 6;

/**
 * Bright core studs along one trail path, the dotted highlight that reads as pixel art where a
 * smooth style draws a hairline. Spacing is coarse on purpose: the full 4px run the pre-Phaser
 * canvas used costs thousands of fills per trail rebuild.
 *
 * Each stud is anchored to its own segment, never to a distance walked from `path[0]`. A saturated
 * trail loses expired segments off the FRONT every tick (`TRAIL_LIFETIME_TICKS`), so a path-relative
 * phase would shift by `RIDER_SPEED/TICK_HZ mod spacing` each tick and every stud on the standing
 * part of the trail would crawl. Segment endpoints never move, so this is stable. The Canvas
 * renderer anchors its sparkle pixels per segment for the same reason, at its own finer spacing.
 * ponytail: fixed spacing, sample by remaining life if long trails ever cost too much.
 */
export function trailStuds(path: readonly WallStud[], spacing = TRAIL_STUD_SPACING): WallStud[] {
  const studs: WallStud[] = [];
  for (let index = 1; index < path.length; index++) {
    const from = path[index - 1]!;
    const to = path[index]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 1e-6)) continue;
    const count = Math.max(1, Math.round(length / spacing));
    for (let step = 0; step < count; step++) {
      const t = step / count;
      studs.push({ x: Math.round(from.x + dx * t), y: Math.round(from.y + dy * t) });
    }
  }
  // Cap the far end only when a segment actually drew: a stationary rider or a NaN pose has no trail.
  const last = path[path.length - 1];
  if (last && studs.length > 0) studs.push({ x: Math.round(last.x), y: Math.round(last.y) });
  return studs;
}

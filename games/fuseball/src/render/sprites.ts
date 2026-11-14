import {
  TEAM,
  TEAM_DARK,
  TEAM_DEEP,
  TEAM_LIGHT,
  VISOR,
  WHITE,
} from "./palette.js";

/** The part of a 2D canvas context the renderer draws with: a real context satisfies it, and so does a test's fake. */
export type Paint = Pick<
  CanvasRenderingContext2D,
  | "save"
  | "restore"
  | "setTransform"
  | "translate"
  | "beginPath"
  | "closePath"
  | "moveTo"
  | "lineTo"
  | "arc"
  | "ellipse"
  | "rect"
  | "clip"
  | "fill"
  | "stroke"
  | "fillRect"
  | "fillText"
  | "createRadialGradient"
  | "createLinearGradient"
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "globalAlpha"
  | "font"
  | "textAlign"
  | "textBaseline"
>;

/**
 * The riders: Fuseball's own pixel characters, a big round helmet with a dark visor over a small suit and boots,
 * drawn one sprite pixel to one field pixel inside the 18 px collision circle. Each frame faces right; the fuse that
 * trails from the helmet is drawn by the scene, since it follows the rider's speed.
 *
 * `o` outline, `c` team colour, `l` highlight, `d` shade, `v` visor, `w` glint, `b` boots.
 */
export const SPRITE_W = 16,
  SPRITE_H = 18;

const HELMET = [
  "....oooooooo....",
  "...ollcccccco...",
  "..olccccccccco..",
  "..occcccccccco..",
  "..occcovvvvvvo..",
  "..occcovwwvvvo..",
  "..occcovvvvvvo..",
  "..occccooooooo..",
  "..odccccccccdo..",
  "...oddddddddo...",
];
const SUIT = [
  "....oddddddo....",
  "...oddddwwddo...",
  "...occcccccco...",
  "...oddddddddo...",
  "....oooooooo....",
];
const BLANK = "................";

export type FrameName = "stand" | "runA" | "runB" | "air" | "slide";
const ART: Record<FrameName, readonly string[]> = {
  stand: [
    ...HELMET,
    ...SUIT,
    "....obo..obo....",
    "....obo..obo....",
    "....obbo.obbo...",
  ],
  runA: [
    ...HELMET,
    ...SUIT,
    "...obo....obo...",
    "..obo......obo..",
    "..obbo.....obbo.",
  ],
  runB: [
    ...HELMET,
    ...SUIT,
    ".....oboobo.....",
    ".....obbobo.....",
    "......oobbo.....",
  ],
  air: [...HELMET, ...SUIT, "...obbo..obbo...", "....oo....oo....", BLANK],
  slide: [
    BLANK,
    BLANK,
    BLANK,
    BLANK,
    BLANK,
    BLANK,
    BLANK,
    BLANK,
    "..oooooooo......",
    ".ollcccccco.....",
    "olccccccccco....",
    "occcovvvvvvo....",
    "occcovwwvvvo....",
    "occccooooooo....",
    "odcccccccdoooo..",
    ".oddddwwddcccoo.",
    "..ooooddddddbbo.",
    "......ooooooooo.",
  ],
};

/** One horizontal run of same-coloured pixels. */
export interface Run {
  x: number;
  y: number;
  w: number;
  key: string;
}
const runsOf = (rows: readonly string[]): Run[] => {
  const runs: Run[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const key = row[x]!;
      let end = x + 1;
      while (end < row.length && row[end] === key) end++;
      if (key !== ".") runs.push({ x, y, w: end - x, key });
      x = end;
    }
  });
  // Grouped by colour, so drawing a frame changes the fill a handful of times.
  return runs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
};
export const FRAME_NAMES = Object.keys(ART) as FrameName[];
export const FRAME_ART: Readonly<Record<FrameName, readonly string[]>> = ART;
export const FRAMES: Readonly<Record<FrameName, readonly Run[]>> = {
  stand: runsOf(ART.stand),
  runA: runsOf(ART.runA),
  runB: runsOf(ART.runB),
  air: runsOf(ART.air),
  slide: runsOf(ART.slide),
};

/** What colour a sprite key is on a team. */
export function inkOf(key: string, slot: number): string {
  const team = slot === 1 ? 1 : 0;
  switch (key) {
    case "o":
      return TEAM_DARK[team];
    case "l":
      return TEAM_LIGHT[team];
    case "d":
      return TEAM_DEEP[team];
    case "v":
      return VISOR;
    case "w":
      return WHITE;
    case "b":
      return TEAM_LIGHT[team];
    default:
      return TEAM[team];
  }
}

/** Which frame a rider wears: `x` picks the stride, so legs move with the ground covered and not with the clock. */
export function frameFor(rider: {
  x: number;
  vx: number;
  grounded: boolean;
  sliding: boolean;
}): FrameName {
  if (rider.sliding) return "slide";
  if (!rider.grounded) return "air";
  if (Math.abs(rider.vx) < 0.12) return "stand";
  return Math.floor(rider.x / 7) % 2 === 0 ? "runA" : "runB";
}

/** Draws a frame centred on (`cx`, `cy`), mirrored when `facing` is −1. */
export function drawRider(
  g: Paint,
  frame: FrameName,
  slot: number,
  cx: number,
  cy: number,
  facing: -1 | 1,
): void {
  const left = cx - SPRITE_W / 2,
    top = cy - SPRITE_H / 2;
  let key = "";
  for (const run of FRAMES[frame]) {
    if (run.key !== key) g.fillStyle = inkOf((key = run.key), slot);
    g.fillRect(
      facing === 1 ? left + run.x : left + SPRITE_W - run.x - run.w,
      top + run.y,
      run.w,
      1,
    );
  }
}

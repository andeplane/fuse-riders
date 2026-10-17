/** Robot sprites (string rows over `robotPalette`), tanks, buggies and supply crates. */
import { type Img, SHADOW, spriteWidth } from "./image.js";
import { METAL, TEAM, type TeamId, robotPalette } from "./palette.js";
import { bevel, sell } from "./shape.js";

/** Rows of a robot sprite facing right; see `robotPalette` for the characters. */
export type RobotSprite = readonly string[];

// prettier-ignore
export const GRUNT: RobotSprite = ["..kkkk....", ".kGGGGk...", "kGeeeeGk..", "kGggggGk..", ".kkttkk...", "kttuttkkkk", "ktTttkdddk", ".kttTkkkk.", ".kt..kt...", ".kk..kk..."];
// prettier-ignore
export const TORCH: RobotSprite = ["..kkkk....", ".kGGGGk...", "kGeeeeGk..", "kGggggGk..", "okkttkk...", "oottuttkkk", "ooTttkdddk", "okttTkkkk.", ".kt..kt...", ".kk..kk..."];
// prettier-ignore
export const LONG: RobotSprite = ["..kkkk.......", ".kGGGGk......", "kGeeeeGk.....", "kGggggGk.....", ".kkttkk......", "kttuttkkkkkkk", "ktTttkGddddGk", ".kttTkkkkkkkk", ".kt..kt......", ".kk..kk......"];
/** The Brick hero: a heavy bruiser. */
// prettier-ignore
export const BRICK: RobotSprite = ["....kkkkkk....", "...kGGGGGGk...", "..kGGwGGGGGk..", "..kGyyyyyyGk..", "..kGkyykyyGk..", "..kgGGGGGGgk..", ".kkkttttttkkk.", "kyykttuuttkyyk", "kttktttttktttk", "kTTktTTTTktTTk", ".kkkttttttkkk.", "...ktTkkTtk...", "...kttk.ktk...", "...kTTk.kTk...", "..kkkkk.kkkk.."];
/** The Vix hero: a hooded sniper. */
// prettier-ignore
export const VIX: RobotSprite = ["....kkkkk.....", "...kdddddk....", "..kdGGGGGdk...", "..kdGrrrGdk...", "..kdGGGGGdk...", "...kkGGGkk....", "..kttkkkttk...", ".kuttttttuk...", ".kttkttkttkkkkk", ".kTTkttkTTkdddk", "..kkttttkkkkkk.", "...ktk.ktk....", "...ktk.ktk....", "...kkk.kkk...."];

export function unitShadow(
  img: Img,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  img.ell(x + w / 2 + 1, y + h - 1, w / 2, 1.6, SHADOW);
}

/** A robot with its top-left at (x, y), facing right (dir 1) or mirrored left (dir -1). */
export function robot(
  img: Img,
  rows: RobotSprite,
  x: number,
  y: number,
  tm: TeamId,
  dir = 1,
): void {
  unitShadow(img, x, y, spriteWidth(rows) - 2, rows.length);
  img.sprite(x, y, rows, robotPalette(tm), dir < 0);
}

export interface TankOptions {
  /** Hull length (default 18). */
  readonly L?: number;
  /** Hull width (default 12). */
  readonly W?: number;
  /** 1 faces right, -1 faces left. */
  readonly dir?: number;
  /** Twin barrels and hazard marks. */
  readonly heavy?: boolean;
}

/** A top-down tank with its top-left at (x, y). The `wreck` team draws a burnt-out hull. */
export function tank(
  img: Img,
  x: number,
  y: number,
  tm: TeamId,
  o: TankOptions = {},
): void {
  const T = TEAM[tm];
  const L = o.L || 18;
  const W = o.W || 12;
  const dir = o.dir || 1;
  const heavy = !!o.heavy;
  img.rect(x + 2, y + 3, L, W, SHADOW);
  for (const ty of [y, y + W - 3]) {
    img.rect(x, ty, L, 3, "#101010");
    for (let i = 1; i < L - 1; i++)
      img.px(x + i, ty + 1, i % 2 ? "#4a4c50" : "#8a8e92");
  }
  img.rect(x, y + 3, L, W - 6, "#101010");
  img.rect(x + 1, y + 3, L - 2, W - 6, T.t);
  img.rect(x + 1, y + 3, L - 2, 1, T.u);
  img.rect(x + 1, y + W - 4, L - 2, 1, T.T);
  const rear = dir > 0 ? x + 2 : x + L - 5;
  for (let i = 0; i < 3; i++)
    img.rect(rear + i, y + 5, 1, W - 10, i % 2 ? T.T : "#101010");
  if (heavy) {
    img.rect(dir > 0 ? x + L - 6 : x + 3, y + 4, 3, 1, "#f8d030");
    img.rect(dir > 0 ? x + L - 6 : x + 3, y + W - 5, 3, 1, "#f8d030");
  }
  const cx = x + Math.floor(L / 2) - dir * 2;
  const cy = y + Math.floor(W / 2);
  const r = heavy ? 5 : 4;
  const bl = heavy ? 13 : 10;
  const bx = dir > 0 ? cx : cx - bl;
  if (heavy) {
    img.rect(bx, cy - 3, bl, 2, "#101010");
    img.rect(bx, cy + 1, bl, 2, "#101010");
    img.rect(bx, cy - 3, bl, 1, "#9a9ea2");
    img.rect(bx, cy + 1, bl, 1, "#9a9ea2");
  } else {
    img.rect(bx, cy - 1, bl, 3, "#101010");
    img.rect(bx, cy, bl, 1, "#9a9ea2");
  }
  img.rect(
    dir > 0 ? cx + bl - 2 : cx - bl,
    cy - (heavy ? 4 : 2),
    2,
    heavy ? 8 : 5,
    "#101010",
  );
  if (tm === "wreck")
    sell(img, cx, cy, r, r - 1, ["#101010", "#141210", "#262220", "#3a3430"]);
  else sell(img, cx, cy, r, r - 1, METAL);
  img.px(cx, cy, "#101010");
  img.px(cx + 1, cy + 1, T.t);
}

/** A four-wheeled buggy with its top-left at (x, y). */
export function buggy(
  img: Img,
  x: number,
  y: number,
  tm: TeamId,
  dir = 1,
): void {
  const T = TEAM[tm];
  img.rect(x + 2, y + 3, 15, 10, SHADOW);
  for (const wx of [x + 1, x + 11])
    for (const wy of [y, y + 8]) {
      img.rect(wx, wy, 5, 3, "#101010");
      img.rect(wx + 1, wy + 1, 3, 1, "#5a5c60");
    }
  img.rect(x + 1, y + 2, 15, 7, "#101010");
  img.rect(x + 2, y + 3, 13, 5, T.t);
  img.rect(x + 2, y + 3, 13, 1, T.u);
  img.rect(x + 2, y + 7, 13, 1, T.T);
  img.rect(dir > 0 ? x + 11 : x + 4, y + 3, 2, 5, "#101010");
  img.rect(dir > 0 ? x + 11 : x + 4, y + 4, 1, 3, "#60c0f0");
  sell(img, x + 7, y + 5, 2, 2, METAL);
  img.rect(dir > 0 ? x + 8 : x + 1, y + 5, 7, 1, "#101010");
}

/** A wooden crate stamped with a question mark (a mystery pickup). */
export function crate(img: Img, x: number, y: number): void {
  img.rect(x + 2, y + 2, 14, 14, SHADOW);
  bevel(img, x, y, 14, 14, "#9a6a38", "#c89458", "#5a3a18");
  img.line(x + 2, y + 2, x + 11, y + 11, "#5a3a18");
  img.line(x + 11, y + 2, x + 2, y + 11, "#5a3a18");
  img.sprite(
    x + 4,
    y + 2,
    [
      ".yyyy.",
      "yyk.yy",
      ".k..yy",
      "...yyk",
      "..yyk.",
      "..kk..",
      "..yy..",
      "..kk..",
    ],
    { y: "#f8d030", k: "#101010" },
  );
}

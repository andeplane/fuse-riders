/** 44×44 hero portraits for the HUD and hero select. */
import { Img, rgba } from "./image.js";
import {
  DARK_METAL,
  GOLD,
  METAL,
  TEAM,
  type TeamColours,
  type TeamId,
  teamRamp,
} from "./palette.js";
import { sbox, sell } from "./shape.js";

export type HeroId = "brick" | "vix" | "rivet" | "tally";
export const HEROES: readonly HeroId[] = ["brick", "vix", "rivet", "tally"];
/** Portraits are square. */
export const PORTRAIT_SIZE = 44;

function portraitBg(img: Img, x: number, y: number, T: TeamColours): void {
  for (let j = 0; j < PORTRAIT_SIZE; j++)
    for (let i = 0; i < PORTRAIT_SIZE; i++)
      img.px(x + i, y + j, j % 2 ? "#1a1e22" : "#20262c");
  const [r, g, b] = rgba(T.t);
  img.ell(x + 22, y + 22, 18, 18, [r, g, b, 50]);
}

function shoulders(
  img: Img,
  x: number,
  y: number,
  T: TeamColours,
  wide = 1,
): void {
  sbox(img, x + 12, y + 32, 20, 14, teamRamp(T), 2);
  sell(img, x + 9, y + 38, 9 * wide, 7, teamRamp(T), 2);
  sell(img, x + 35, y + 38, 9 * wide, 7, teamRamp(T), 2);
}

function brick(img: Img, x: number, y: number, T: TeamColours): void {
  sbox(img, x + 18, y + 27, 8, 8, DARK_METAL, 1);
  shoulders(img, x, y, T, 1.15);
  for (const sx of [x + 5, x + 34]) {
    img.px(sx, y + 36, "#f8d030");
    img.px(sx + 1, y + 35, "#f8d030");
    img.px(sx + 2, y + 36, "#f8d030");
    img.px(sx + 3, y + 35, "#f8d030");
    img.px(sx + 4, y + 36, "#f8d030");
  }
  sbox(img, x + 8, y + 5, 28, 25, METAL, 4, 2);
  img.rect(x + 10, y + 13, 24, 7, "#101010");
  img.rect(x + 12, y + 15, 7, 3, "#f8d030");
  img.rect(x + 25, y + 15, 7, 3, "#f8d030");
  img.rect(x + 12, y + 15, 7, 1, "#fff4b0");
  img.rect(x + 25, y + 15, 7, 1, "#fff4b0");
  img.line(x + 12, y + 12, x + 19, y + 14, "#101010");
  img.line(x + 32, y + 12, x + 25, y + 14, "#101010");
  img.rect(x + 13, y + 22, 18, 6, "#101010");
  for (let i = 0; i < 8; i++) img.rect(x + 14 + i * 2, y + 23, 1, 4, "#8a8e92");
  img.line(x + 29, y + 7, x + 32, y + 10, "#4a4e52");
  img.px(x + 30, y + 7, "#e8ecf0");
  img.rect(x + 30, y + 1, 2, 5, "#3a3c40");
  img.rect(x + 30, y + 0, 2, 2, "#f03020");
}

function vix(img: Img, x: number, y: number, T: TeamColours): void {
  sell(
    img,
    x + 22,
    y + 17,
    15,
    16,
    ["#101010", "#16181c", "#24282e", "#3a4048"],
    2,
  );
  shoulders(img, x, y, T, 0.85);
  sbox(img, x + 11, y + 29, 22, 6, teamRamp(T), 2);
  sbox(img, x + 14, y + 7, 16, 21, METAL, 5, 2);
  img.rect(x + 15, y + 14, 14, 6, "#101010");
  sell(img, x + 22, y + 17, 4, 4, [
    "#101010",
    "#7a1006",
    "#c81c10",
    "#ff6040",
    "#ffffff",
  ]);
  img.px(x + 20, y + 15, "#ffffff");
  img.px(x + 21, y + 15, "#ffd0c0");
  img.rect(x + 18, y + 23, 8, 1, "#101010");
  img.rect(x + 18, y + 25, 8, 1, "#4a4e52");
  img.line(x + 30, y + 44, x + 42, y + 20, "#101010");
  img.line(x + 31, y + 44, x + 43, y + 20, "#6e7276");
  img.rect(x + 40, y + 18, 4, 3, "#101010");
}

function rivet(img: Img, x: number, y: number, T: TeamColours): void {
  sbox(img, x + 18, y + 27, 8, 8, DARK_METAL, 1);
  shoulders(img, x, y, T, 1);
  img.line(x + 4, y + 30, x + 12, y + 44, "#101010");
  img.line(x + 5, y + 30, x + 13, y + 44, "#a8acb0");
  sbox(img, x + 1, y + 26, 8, 6, METAL, 1);
  img.rect(x + 3, y + 26, 3, 3, "#20262c");
  sell(img, x + 22, y + 18, 12, 11, METAL, 2);
  sell(img, x + 22, y + 9, 14, 7, GOLD, 2);
  img.rect(x + 7, y + 12, 30, 3, "#101010");
  img.rect(x + 7, y + 12, 30, 1, "#f8d030");
  img.rect(x + 21, y + 2, 2, 8, "#d89a20");
  for (const ex of [x + 17, x + 27]) {
    sell(img, ex, y + 18, 4, 4, [
      "#101010",
      "#7a3a08",
      "#e07818",
      "#ffb040",
      "#fff4b0",
    ]);
    img.px(ex - 1, y + 17, "#ffffff");
  }
  img.rect(x + 21, y + 18, 2, 1, "#101010");
  img.rect(x + 16, y + 24, 12, 4, "#101010");
  for (let i = 0; i < 5; i++) img.rect(x + 17 + i * 2, y + 25, 1, 2, "#8a8e92");
}

function tally(img: Img, x: number, y: number, T: TeamColours): void {
  sbox(img, x + 18, y + 27, 8, 8, DARK_METAL, 1);
  shoulders(img, x, y, T, 0.9);
  sbox(
    img,
    x + 12,
    y + 29,
    20,
    5,
    ["#101010", "#8a5a10", "#d89a20", "#f8d030"],
    2,
  );
  img.rect(x + 30, y + 1, 1, 9, "#3a3c40");
  sell(img, x + 30, y + 2, 2, 2, GOLD);
  sell(img, x + 22, y + 16, 13, 12, METAL, 2);
  sell(img, x + 8, y + 17, 3, 5, DARK_METAL);
  sell(img, x + 36, y + 17, 3, 5, DARK_METAL);
  for (const ex of [x + 17, x + 27]) {
    sell(img, ex, y + 15, 4, 4, [
      "#101010",
      "#0a4a6a",
      "#20a0d8",
      "#80e8ff",
      "#ffffff",
    ]);
    img.px(ex - 1, y + 13, "#ffffff");
    img.px(ex - 2, y + 14, "#ffffff");
  }
  img.rect(x + 18, y + 22, 8, 2, "#101010");
  img.px(x + 18, y + 21, "#101010");
  img.px(x + 25, y + 21, "#101010");
  img.line(x + 8, y + 21, x + 14, y + 25, "#3a3c40");
}

const DRAW: Readonly<
  Record<HeroId, (img: Img, x: number, y: number, T: TeamColours) => void>
> = { brick, vix, rivet, tally };

/**
 * Draws a hero's portrait with its top-left at (x, y), tinted for a team. The art overhangs its square (shoulders run
 * past the bottom edge), so it is drawn on a square of its own and only that square is composited onto `img`.
 */
export function portrait(
  img: Img,
  x: number,
  y: number,
  who: HeroId,
  tm: TeamId,
): void {
  const T = TEAM[tm];
  const square = new Img(PORTRAIT_SIZE, PORTRAIT_SIZE);
  portraitBg(square, 0, 0, T);
  DRAW[who](square, 0, 0, T);
  square.rect(0, 0, PORTRAIT_SIZE, 1, [0, 0, 0, 120]);
  img.blit(square, x, y);
}

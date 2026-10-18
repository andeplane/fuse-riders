/** 30×30 spell icons for Vix, Rivet and Tally, beside Brick's in `ui.ts`, keyed by spell effect for the HUD. */
import { Img } from "./image.js";
import { hash } from "./noise.js";
import { METAL, TEAM, teamRamp } from "./palette.js";
import { sbox } from "./shape.js";
import { tank } from "./units.js";
import {
  iconIronHide,
  iconOrbital,
  iconRally,
  iconShockwave,
  type IconDraw,
} from "./ui.js";

/** A dark speckled field to draw a glyph on. */
function field(img: Img, x: number, y: number, bg: string, fleck: string) {
  img.rect(x, y, 30, 30, bg);
  for (let j = 0; j < 30; j++)
    for (let i = 0; i < 30; i++)
      if (hash(i, j, 9) < 0.12) img.px(x + i, y + j, fleck);
}

/** A thick line: the segment drawn at each offset within `w`. */
function stroke(
  img: Img,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c: string,
  w = 2,
) {
  for (let d = 0; d < w; d++) img.line(x0 + d, y0, x1 + d, y1, c);
}

// prettier-ignore
const ICONS: Readonly<Record<string, IconDraw>> = {
  shockwave: iconShockwave,
  rally: iconRally,
  ironHide: iconIronHide,
  orbitalDrop: iconOrbital,
  snipe: (img, x, y) => {
    field(img, x, y, "#14181c", "#1e2428");
    img.ring(x + 15, y + 15, 10, 10, "#e8483c");
    img.ring(x + 15, y + 15, 4, 4, "#f8d838");
    stroke(img, x + 15, y + 2, x + 15, y + 9, "#e8e8e8", 1);
    stroke(img, x + 15, y + 21, x + 15, y + 28, "#e8e8e8", 1);
    stroke(img, x + 2, y + 15, x + 9, y + 15, "#e8e8e8", 1);
    stroke(img, x + 21, y + 15, x + 28, y + 15, "#e8e8e8", 1);
  },
  cloak: (img, x, y) => {
    field(img, x, y, "#121620", "#1a2030");
    for (let j = 0; j < 22; j++)
      for (let i = 0; i < 18; i++)
        if (Math.abs(i - 9) <= 3 + j / 3 && (i + j) % (j < 11 ? 1 : 2) === 0)
          img.px(x + 6 + i, y + 5 + j, j < 6 ? "#7aa8d8" : "#4a6c98");
    img.rect(x + 12, y + 10, 6, 2, "#9ae8ff");
  },
  stickyMine: (img, x, y) => {
    field(img, x, y, "#201a12", "#2c2418");
    for (const [a, b] of [[15, 4], [15, 26], [4, 15], [26, 15], [7, 7], [23, 23], [7, 23], [23, 7]] as const)
      stroke(img, x + 15, y + 15, x + a, y + b, "#8a8e92", 1);
    img.ell(x + 15, y + 15, 8, 8, "#4a4e52");
    img.ell(x + 15, y + 15, 6, 6, "#6a6e72");
    img.ell(x + 15, y + 15, 2, 2, "#ff4030");
  },
  hijack: (img, x, y) => {
    field(img, x, y, "#14181c", "#1e2428");
    tank(img, x + 4, y + 14, "blue", { L: 16, W: 11 });
    stroke(img, x + 20, y + 4, x + 26, y + 10, "#f8d838");
    stroke(img, x + 26, y + 4, x + 26, y + 10, "#f8d838");
    stroke(img, x + 20, y + 10, x + 26, y + 10, "#f8d838");
  },
  repair: (img, x, y) => {
    field(img, x, y, "#12181a", "#1a2428");
    stroke(img, x + 8, y + 22, x + 19, y + 11, "#c8ccd0", 3);
    img.ring(x + 21, y + 9, 5, 5, "#c8ccd0");
    img.ring(x + 21, y + 9, 4, 4, "#c8ccd0");
    img.rect(x + 20, y + 3, 4, 4, "#12181a");
    img.rect(x + 5, y + 5, 8, 2, "#6ad83a");
    img.rect(x + 8, y + 2, 2, 8, "#6ad83a");
  },
  turretDrop: (img, x, y) => {
    field(img, x, y, "#14181c", "#1e2428");
    stroke(img, x + 9, y + 26, x + 13, y + 18, "#8a8e92");
    stroke(img, x + 20, y + 26, x + 16, y + 18, "#8a8e92");
    sbox(img, x + 9, y + 11, 12, 8, teamRamp(TEAM.red), 1);
    img.rect(x + 20, y + 13, 8, 2, "#2a2e32");
    img.rect(x + 13, y + 3, 4, 6, "#f8d838");
  },
  fortify: (img, x, y) => {
    field(img, x, y, "#14181c", "#1e2428");
    img.rect(x + 6, y + 4, 2, 22, "#c8ccd0");
    img.rect(x + 8, y + 4, 10, 7, "#c8301c");
    sbox(img, x + 14, y + 13, 12, 13, METAL, 2);
    img.rect(x + 19, y + 15, 2, 9, "#f8d838");
  },
  overclock: (img, x, y) => {
    field(img, x, y, "#1c1410", "#281c14");
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      img.rect(x + 13 + Math.round(Math.cos(a) * 10), y + 13 + Math.round(Math.sin(a) * 10), 4, 4, "#c8ccd0");
    }
    img.ell(x + 15, y + 15, 8, 8, "#a8acb0");
    img.ell(x + 15, y + 15, 3, 3, "#1c1410");
    stroke(img, x + 15, y + 15, x + 21, y + 9, "#f08a20");
  },
  dash: (img, x, y) => {
    field(img, x, y, "#121a16", "#1a2820");
    for (const ox of [3, 11, 19]) {
      stroke(img, x + ox, y + 7, x + ox + 7, y + 15, ox === 19 ? "#9af0a0" : "#4ab86a", 3);
      stroke(img, x + ox, y + 23, x + ox + 7, y + 15, ox === 19 ? "#9af0a0" : "#4ab86a", 3);
    }
  },
  flare: (img, x, y) => {
    field(img, x, y, "#10141c", "#182030");
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      stroke(img, x + 15, y + 15, x + 15 + Math.round(Math.cos(a) * 12), y + 15 + Math.round(Math.sin(a) * 12), "#f8a030", 1);
    }
    img.ell(x + 15, y + 15, 5, 5, "#f8d838");
    img.ell(x + 15, y + 15, 2, 2, "#fffbe0");
  },
  spotter: (img, x, y) => {
    field(img, x, y, "#14181c", "#1e2428");
    img.ell(x + 15, y + 15, 12, 7, "#e8e8e8");
    img.ell(x + 15, y + 15, 6, 6, "#2a5ad0");
    img.ell(x + 15, y + 15, 3, 3, "#101010");
    img.px(x + 13, y + 13, "#ffffff");
  },
  blitz: (img, x, y) => {
    field(img, x, y, "#14141c", "#1e1e2c");
    stroke(img, x + 18, y + 2, x + 9, y + 16, "#f8d838", 3);
    stroke(img, x + 9, y + 16, x + 21, y + 14, "#f8d838", 3);
    stroke(img, x + 21, y + 14, x + 11, y + 28, "#fff4a0", 3);
  },
};

/** The icon for a spell effect; a plain bay for one without art. */
export function spellIcon(effect: string): IconDraw {
  return ICONS[effect] ?? ((img, x, y) => img.rect(x, y, 30, 30, "#14181c"));
}

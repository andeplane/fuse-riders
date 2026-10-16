/** Forts, factories, turrets and capture flags, each drawn at a position for a team. */
import { type Img, SHADOW } from "./image.js";
import { puffs } from "./effects.js";
import { CONCRETE, TEAM, type TeamId, teamRamp } from "./palette.js";
import { bevel, sell } from "./shape.js";

export type FactoryKind = "robot" | "vehicle";

/** Yellow-and-black diagonal stripes. */
export function hazard(
  img: Img,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++)
      img.px(x + i, y + j, ((x + i + y + j) >> 1) % 2 ? "#f8d030" : "#181818");
}

/** A team fort, about 64×52 with its top-left at (x, y). */
export function fort(img: Img, x: number, y: number, tm: TeamId): void {
  const T = TEAM[tm];
  img.rect(x + 5, y + 10, 58, 42, SHADOW);
  bevel(img, x, y + 8, 58, 42, CONCRETE.mid, CONCRETE.hi, CONCRETE.lo);
  bevel(img, x + 5, y + 12, 48, 22, "#9a988e", "#c8c6ba", "#6a685e");
  for (let i = x + 13; i < x + 52; i += 8)
    img.rect(i, y + 13, 1, 20, "#828076");
  img.rect(x + 5, y + 30, 48, 3, T.t);
  img.rect(x + 5, y + 30, 48, 1, T.u);
  img.rect(x + 1, y + 35, 56, 14, "#6a685e");
  for (let i = x + 3; i < x + 56; i += 5) img.rect(i, y + 36, 1, 12, "#57554c");
  img.rect(x + 1, y + 35, 56, 1, "#2e2c28");
  hazard(img, x + 21, y + 37, 16, 12);
  img.rect(x + 23, y + 39, 12, 10, "#141414");
  for (let r = y + 40; r < y + 49; r += 2)
    img.rect(x + 23, r, 12, 1, "#2a2a2c");
  for (const wx of [x + 5, x + 12, x + 41, x + 48]) {
    img.rect(wx, y + 39, 5, 4, "#101010");
    img.rect(wx + 1, y + 40, 3, 1, "#40d0ff");
    img.px(wx + 1, y + 41, "#1a6a8a");
  }
  for (const tx of [x - 3, x + 49]) {
    img.rect(tx + 3, y + 3, 12, 14, SHADOW);
    bevel(img, tx, y, 12, 14, CONCRETE.mid, CONCRETE.hi, CONCRETE.lo);
    bevel(img, tx + 2, y + 2, 8, 7, T.t, T.u, T.T);
    img.rect(tx + 3, y + 11, 6, 1, "#101010");
  }
  img.rect(x + 28, y + 6, 2, 13, "#2a2a2a");
  img.px(x + 28, y + 7, "#909090");
  img.ell(x + 29, y + 5, 9, 4, "#101010");
  img.ell(x + 29, y + 5, 8, 3, "#d8d8d0");
  img.rect(x + 22, y + 6, 15, 1, "#9a9a92");
  img.rect(x + 23, y + 3, 6, 1, "#ffffff");
  img.px(x + 29, y + 5, "#f03020");
  img.rect(x + 44, y + 14, 1, 9, "#202020");
  img.px(x + 44, y + 13, "#ff3020");
}

/** A robot (40 wide) or vehicle (48 wide) factory with a saw-tooth roof, door and smoking chimney. */
export function factory(
  img: Img,
  x: number,
  y: number,
  tm: TeamId,
  kind: FactoryKind = "robot",
): void {
  const T = TEAM[tm];
  const W = kind === "vehicle" ? 48 : 40;
  img.rect(x + 5, y + 7, W, 29, SHADOW);
  bevel(img, x + W - 10, y - 8, 7, 16, "#5a5e62", "#8a8e92", "#33363a");
  img.rect(x + W - 9, y - 8, 5, 2, "#101010");
  bevel(img, x, y + 4, W, 28, CONCRETE.mid, CONCRETE.hi, CONCRETE.lo);
  const teeth = Math.floor((W - 2) / 10);
  for (let i = 0; i < teeth; i++) {
    const tx = x + 1 + i * 10;
    for (let r = 0; r < 10; r++) {
      const len = Math.max(1, Math.round((8 * (r + 1)) / 10));
      img.rect(
        tx,
        y + 5 + r,
        len,
        1,
        r < 2 ? "#cac8bc" : r < 6 ? "#a6a498" : "#8e8c82",
      );
      img.rect(tx + len, y + 5 + r, 9 - len, 1, "#284a5c");
      if ((r + i) % 3 === 0 && len < 8)
        img.px(tx + len + 1, y + 5 + r, "#8ad0f0");
    }
    img.rect(tx + 9, y + 5, 1, 10, "#101010");
  }
  img.rect(x + 1, y + 15, W - 2, 1, "#101010");
  img.rect(x + 1, y + 16, W - 2, 2, T.t);
  img.rect(x + 1, y + 16, W - 2, 1, T.u);
  img.rect(x + 1, y + 18, W - 2, 13, "#6a685e");
  for (let i = x + 3; i < x + W - 2; i += 5)
    img.rect(i, y + 19, 1, 11, "#5a584f");
  const dw = kind === "vehicle" ? 24 : 14;
  const dx = x + Math.floor((W - dw) / 2);
  img.rect(dx - 1, y + 19, dw + 2, 13, "#101010");
  hazard(img, dx - 1, y + 19, dw + 2, 2);
  img.rect(dx, y + 21, dw, 10, "#3c3e42");
  for (let r = y + 22; r < y + 31; r += 2) img.rect(dx, r, dw, 1, "#2a2c2e");
  img.px(dx - 3, y + 22, T.u);
  img.px(dx + dw + 2, y + 22, T.u);
  img.px(dx - 3, y + 23, T.T);
  img.px(dx + dw + 2, y + 23, T.T);
  puffs(img, x + W - 8, y - 11, 4, x);
}

/** A gun turret centred on (x, y), barrel pointing right (dir 1) or left (dir -1). */
export function turret(
  img: Img,
  x: number,
  y: number,
  tm: TeamId,
  dir = 1,
): void {
  const T = TEAM[tm];
  img.ell(x + 2, y + 2, 7, 4, SHADOW);
  sell(img, x, y, 7, 4, [
    "#101010",
    CONCRETE.lo,
    CONCRETE.mid,
    CONCRETE.hi,
    "#e0ded2",
  ]);
  const bx = dir > 0 ? x + 2 : x - 10;
  img.rect(bx, y - 4, 9, 3, "#101010");
  img.rect(bx, y - 3, 8, 1, "#8a8e92");
  sell(img, x, y - 2, 4, 3, teamRamp(T));
}

/** A capture flag whose pole stands at (x, y). */
export function flag(img: Img, x: number, y: number, tm: TeamId): void {
  const T = TEAM[tm];
  img.rect(x + 1, y + 1, 7, 1, SHADOW);
  img.rect(x - 1, y - 1, 4, 2, "#303030");
  img.rect(x, y - 16, 1, 16, "#1a1a1a");
  img.rect(x + 1, y - 16, 1, 16, "#8a8a8a");
  img.px(x, y - 17, "#f8d030");
  img.px(x + 1, y - 17, "#f8d030");
  const rows: readonly (readonly [number, number])[] = [
    [2, 8],
    [2, 9],
    [2, 9],
    [3, 9],
    [2, 8],
  ];
  rows.forEach(([a, b], i) => {
    for (let k = a; k <= b; k++)
      img.px(
        x + k,
        y - 16 + i,
        i === 0 ? T.u : i === 4 ? T.T : (k + i) % 4 === 0 ? T.u : T.t,
      );
    img.px(x + b + 1, y - 16 + i, "#101010");
  });
  for (let k = 2; k <= 8; k++) img.px(x + k, y - 11, "#101010");
}

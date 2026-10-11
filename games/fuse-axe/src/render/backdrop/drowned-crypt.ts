import { FLOOR_TOP_PX, VIEW_H, VIEW_W } from "../../engine/view-kit.js";
import { bayer, dither, hash, Raster } from "./kit.js";
import type { Brush, StageArt } from "./kit.js";

/**
 * Stage 3, Drowned Crypt: a cold night in a flooded graveyard under a broken cathedral. Far to near: the sky and a pale
 * moon stand still, the cathedral's silhouette and its shattered rose window drift at 1/8 of the camera, ruined
 * cloisters, mausoleums and dead trees at 1/4, and at the floor's own speed a bank of graves, iron fences, dead trees
 * and braziers burning green, black water below it with crosses sunk in it, the causeway of wet flagstones the heroes
 * fight along (broken open by the graves the bonewalkers claw out of) and lily pads in the water in front; reeds and
 * broken stones pass in front of the heroes at 5/4. It ends at the cathedral's great doors in its ruined wall, up a
 * flight of steps: the gate the boss waits in. The layout comes from a cosmetic hash, so every device draws the same
 * crypt. Only the ripples, the fog, the green fires and the drips from the trees move.
 */

/**
 * The crypt's road, five screens as Wyrmbone Pass's, and the furthest the camera's left edge goes on it. The engine
 * has no Stage 3 yet (its `stageLengthPx(3)` is Stage 1's until it has), so the backdrop is laid out on its own length.
 * TODO(stage 3 in the engine): give `STAGE_3` this road, or this the engine's, then drop `cameraEnd` below;
 * `drowned-crypt.test.ts` holds the two equal once the engine has the stage.
 */
export const CRYPT_LENGTH = 5 * VIEW_W;
export const CRYPT_END = CRYPT_LENGTH - VIEW_W;

const FLOOR = FLOOR_TOP_PX;
/** The far bank's waterline: graves stand above it, and black water lies between it and the causeway. */
export const BANK = FLOOR - 13;
/** The causeway's front edge, with water and lily pads below it. */
export const SHORE = VIEW_H - 8;
/** The great doors' centre in the last screen, and the ruined wall they are set in, from here to the stage end. */
const GATE_X = CRYPT_END + 176;
const WALL_X = GATE_X - 124;

const INK = 0x07060e;
const VOID = 0x030407;
const WATER = 0x070b12;
const SKY = [
  0x050410, 0x0a0819, 0x100d24, 0x16142e, 0x1a1d36, 0x1c283c, 0x20343e,
  0x264340,
];
/** A material's ink, shadow, base and light, and the colour of its tops (moss). */
type Ramp = readonly [number, number, number, number, number?];
const STONE: Ramp = [INK, 0x23263a, 0x343a4e, 0x50586c, 0x3c5a48];
const GRAVE: Ramp = [INK, 0x363a4e, 0x545a6e, 0x7a8294, 0x4e6e52];
const MID: Ramp = [0x080a12, 0x131726, 0x1b2132, 0x283042, 0x1f302c];
const BARK: Ramp = [INK, 0x14111c, 0x1a1622, 0x302e40];
const MOUND: Ramp = [INK, 0x1c181c, 0x282226, 0x3e3436];
const ROAD = [0x111220, 0x161828, 0x1c2030, 0x232838, 0x2b3242, 0x343c4e];
const IRON = 0x22263a;
const IRON_LIT = 0x3e4458;
const BONE = 0xb8b0a8;
const GLOW = [0x0c2a22, 0x1e5a44, 0x48b080];
const FLAME = ["#eaffe0", "#8ef0a8", "#36c27a", "#1a6a58"];
/** The fog's, the ripples' and the drips' colours, which nothing else draws. */
const FOG = "#2e4448";
const RIPPLE = ["#6a8e92", "#41606a", "#273c44"];
const DROP = "#9cc4c4";

type Box = readonly [x0: number, y0: number, x1: number, y1: number];
type Inside = (x: number, y: number) => boolean;

/**
 * Paints the pixels in `box` that `inside` holds, lit by the moon at the upper right: inked where they meet the
 * outside, a top colour (moss) along the top, light along the right, shadow along the bottom and left, base between.
 */
function shape(r: Raster, box: Box, inside: Inside, ramp: Ramp) {
  const [[x0, y0, x1, y1], [ink, dark, base, lit, top = lit]] = [box, ramp];
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      if (!inside(x, y)) continue;
      let c = base;
      if (!inside(x, y - 1) || !inside(x, y + 1)) c = ink;
      else if (!inside(x - 1, y) || !inside(x + 1, y)) c = ink;
      else if (!inside(x, y - 2)) c = top;
      else if (!inside(x + 1, y - 1) || !inside(x + 2, y)) c = lit;
      else if (!inside(x, y + 2) || !inside(x - 2, y)) c = dark;
      else if (hash(x, y) > 0.93) c = dark;
      r.px(x, y, c);
    }
}

/** The colour a raster holds at a pixel, or −1 where it is clear or off the raster. */
function rgbAt(r: Raster, x: number, y: number) {
  const row = y - r.top;
  if (!(x >= 0 && x < r.width && row >= 0 && row < r.height)) return -1;
  const i = (row * r.width + x) * 4;
  const [red, green, blue] = [r.rgba[i]!, r.rgba[i + 1]!, r.rgba[i + 2]!];
  return r.rgba[i + 3] ? (red << 16) | (green << 8) | blue : -1;
}

/** Mirrors what `keep` holds above row `line` into the water below it, at half its light, broken up with depth. */
function mirror(r: Raster, x0: number, x1: number, line: number, keep: Inside) {
  for (let y = line; y < FLOOR; y++)
    for (let x = x0; x < x1; x++) {
      const d = y - line;
      const [sx, sy] = [x + ((d >> 1) & 1), line - 1 - d];
      const src = keep(sx, sy) ? rgbAt(r, sx, sy) : -1;
      if (src >= 0 && bayer(x, y) < 0.95 - d * 0.05)
        r.px(x, y, (src >> 1) & 0x7f7f7f);
    }
}

/** A gravestone: where it stands, its foot's row, width, height, kind (slab, cross, ringed cross) and lean. */
type Stone = readonly [number, number, number, number, number, number];

/** Paints a gravestone, cut off at the waterline `line` if it is sunk, and returns its shape. */
function headstone(r: Raster, stone: Stone, ramp: Ramp, line = stone[1] + 1) {
  const [x, foot, w, h, kind, lean] = stone;
  const arm = h - Math.max(3, Math.round(h * 0.3));
  const inside = (px: number, py: number) => {
    const v = foot - py + 0.5;
    if (py > foot || py >= line || v > h + 1) return false;
    const [u, half] = [px + 0.5 - x - (v * lean) / 8, w / 2];
    if (!kind) return Math.hypot(u, Math.max(0, v - h + half)) < half;
    const ring = kind === 2 && Math.abs(Math.hypot(u, v - arm) - 2.8) < 1;
    const bar = Math.abs(v - arm) < 1.3 && Math.abs(u) < half;
    return ring || (v < h && (Math.abs(u) < 1.3 || bar));
  };
  shape(r, [x - w - 4, foot - h - 3, x + w + 4, foot + 1], inside, ramp);
  return inside;
}

/** A dead tree's limb from `[x0, y0]` to `[x1, y1]`, `w` pixels thick. */
type Limb = readonly [number, number, number, number, number];

/** A dead tree standing on `foot`: a trunk leaning `lean` (radians), forking three times into gnarled branches. */
function limbs(x: number, foot: number, h: number, lean: number, seed: number) {
  const out: Limb[] = [];
  const grow = (x0: number, y0: number, a: number, len: number, d: number) => {
    const [x1, y1] = [x0 + Math.sin(a) * len, y0 - Math.cos(a) * len];
    const s = seed * 64 + out.push([x0, y0, x1, y1, Math.max(1, 2 * d - 1)]);
    for (const side of d ? [-1, 1] : []) {
      const turn = side * (0.35 + 0.6 * hash(s, side + 3));
      const next = len * (0.55 + 0.2 * hash(s, side + 5));
      grow(x1, y1, a * 0.6 + turn, next, d - 1);
    }
  };
  grow(x, foot, lean, h * 0.45, 3);
  return out;
}

function stroke(r: Raster, tree: readonly Limb[], [ink, dark, , lit]: Ramp) {
  for (const [x0, y0, x1, y1, w] of tree) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let s = 0; s <= n; s++) {
      const x = Math.round(x0 + ((x1 - x0) * s) / n - w / 2);
      const y = Math.round(y0 + ((y1 - y0) * s) / n);
      r.rect(x, y, w, 1, dark);
      if (w < 3) continue;
      r.px(x, y, ink);
      r.px(x + w - 1, y, lit);
    }
  }
}

/** Thin clouds: each one's centre, row and half its length. */
const CLOUDS = [244, 33, 35, 120, 22, 45, 40, 48, 30];

function sky(r: Raster) {
  for (let y = 0; y < FLOOR; y++)
    for (let x = 0; x < r.width; x++) {
      const glow = Math.max(0, 1 - Math.hypot(x - 252, y - 30) / 70) * 0.25;
      r.px(x, y, dither(SKY, y / 92 + glow, x, y));
    }
  for (let i = 0; i < 70; i++) {
    const [x, y] = [hash(i, 1) * r.width, hash(i, 2) * 64];
    if (Math.hypot(x - 252, y - 30) > 24)
      r.px(x, y, i % 5 ? 0x343c5c : 0xb8c8dc);
  }
  // A pale moon, its left limb in shadow, a haze about it and thin clouds across the sky.
  for (let y = 6; y < 56; y++)
    for (let x = 228; x < 278; x++) {
      const d = Math.hypot(x + 0.5 - 252, y + 0.5 - 30);
      if (d >= 11) {
        if (d < 22 && bayer(x, y) < (22 - d) / 20) r.px(x, y, 0x24304a);
        continue;
      }
      const shade = Math.hypot(x + 0.5 - 255, y + 0.5 - 29) > 11;
      const sea =
        Math.hypot(x - 249, y - 27) < 3 || Math.hypot(x - 255, y - 34) < 2;
      r.px(x, y, shade ? 0x7e968e : sea ? 0xaec4b4 : 0xd8ead2);
    }
  for (let i = 0; i < 9; i += 3) {
    const [cx, cy, half] = [CLOUDS[i]!, CLOUDS[i + 1]!, CLOUDS[i + 2]!];
    for (let j = 0; j < 3; j++)
      for (let x = cx - half + j * 4; x < cx + half - j * 3; x++)
        r.px(x, cy + j, j === 2 ? 0x2c3a50 : 0x12162a);
  }
}

const CATH_X = 228;

/** The broken cathedral, by a pixel of the far layer: its towers and spire, gable, nave and the stumps past them. */
function cathedral(x: number, y: number) {
  const u = x + 0.5 - CATH_X;
  const a = Math.abs(u);
  const ruin = Math.floor(hash(x >> 1, 7) * 7);
  const lancet = (u - 44) % 12 > 4 && (u - 44) % 12 < 8 && y > 57 && y < 70;
  if (a < 24) return y > 32 + a * 0.6;
  if (u < 0 && a < 40) return y > 28 || y > 6 + Math.abs(u + 32) * 2.4;
  if (u > 0 && u < 40)
    return y > 30 + ruin && !(a > 30 && a < 34 && y > 38 && y < 50);
  if (u > 0 && u < 104) return y > (u > 70 ? 54 + ruin : 48) && !lancet;
  if (u > 0 && u < 126) return y > 58 + ruin;
  return u > -86 && y > 64 + ruin;
}

/** The far layer: the cathedral on a fog-bound rise of dead woods, its rose window glowing through the gaps. */
function far(r: Raster) {
  for (let x = 0; x < r.width; x++) {
    const rise = 76 + Math.round(3 * Math.sin(x * 0.045) + 2 * Math.sin(x / 9));
    const spike = hash(x >> 1, 5) > 0.86 ? 2 + Math.floor(hash(x, 6) * 6) : 0;
    for (let y = r.top; y < FLOOR; y++) {
      const lit = !cathedral(x + 1, y) || !cathedral(x, y - 1);
      if (y >= rise || (y >= rise - spike && x % 2 === 0))
        r.px(x, y, y > 80 && bayer(x, y) < (y - 80) / 16 ? 0x172230 : 0x0d1220);
      else if (cathedral(x, y)) r.px(x, y, lit ? 0x1a1f33 : 0x0b0d1a);
    }
  }
  // The rose window: tracery round a bright heart, a third of its panes knocked out to the sky.
  for (let y = 40; y < 62; y++)
    for (let x = CATH_X - 11; x < CATH_X + 11; x++) {
      const [u, v] = [x + 0.5 - CATH_X, y + 0.5 - 51];
      const [d, angle] = [Math.hypot(u, v), Math.atan2(v, u)];
      const pane = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 12);
      const ring = d < 4.7 ? 1 : 0;
      const spoke = Math.abs(Math.sin(angle * 6)) * d < 0.7;
      if (d >= 9.5) continue;
      if (d > 8.5 || Math.abs(d - 4.7) < 0.5 || spoke) r.px(x, y, 0x1a1f33);
      else if (d < 2.5) r.px(x, y, 0x6aa08a);
      else if (hash(pane, 40 + ring) < 0.35)
        r.rgba[((y - r.top) * r.width + x) * 4 + 3] = 0;
      else r.px(x, y, (pane + ring) % 2 ? 0x2e5a50 : 0x48386a);
    }
}

/** A run of ruined cloister arches on the mid layer's ground, some bays fallen to their column stumps. */
function arcade(r: Raster, x0: number, bays: number, seed: number) {
  const inside = (x: number, y: number) => {
    const u = x + 0.5 - x0;
    const bay = Math.floor(u / 14);
    const w = u - bay * 14 - 3;
    if (u < 0 || bay > bays || (bay === bays && w >= 0)) return false;
    const fallen = hash(bay, seed) > 0.65;
    if (w < 0)
      return y > (fallen ? 62 + Math.floor(hash(bay, seed + 2) * 20) : 56);
    const a = Math.abs(w - 5.5);
    const crown = 70 - Math.sqrt(Math.max(0, 81 - (a + 3.5) ** 2));
    return !fallen && y > 56 && y < crown;
  };
  shape(r, [x0 - 2, 48, x0 + bays * 14 + 6, FLOOR], inside, MID);
}

/** A mausoleum `w` wide on the mid layer's ground: a plinth, a body, its pediment and cross, a dark door. */
function mausoleum(r: Raster, cx: number, w: number, ground: number) {
  const body = (x: number, y: number) => {
    const [a, v] = [Math.abs(x + 0.5 - cx), ground - y - 0.5];
    if (v < 0) return false;
    if (v < 3) return a < w / 2 + 2;
    if (v < 20) return a < w / 2;
    if (v < 28) return a < w / 2 + 1 - ((v - 20) * (w / 2 + 1)) / 8;
    return v < 36 && (a < 1 || (Math.abs(v - 32) < 1 && a < 3));
  };
  shape(r, [cx - w, ground - 40, cx + w, ground], body, MID);
  for (let v = 3; v < 15; v++) r.rect(cx - 3, ground - 1 - v, 6, 1, VOID);
}

/** The mid layer: a low graveyard ground in the fog, with cloisters, mausoleums, dead trees and leaning stones. */
function mid(r: Raster) {
  const ground = (x: number) => 86 + Math.round(1.5 * Math.sin(x * 0.031));
  for (let x = 0; x < r.width; x++)
    for (let y = ground(x); y < FLOOR; y++)
      r.px(x, y, y === ground(x) ? 0x1a2a26 : 0x0d111b);
  for (let x = 16, n = 0; x < r.width; n++) {
    const [kind, g] = [(n * 3 + (hash(n, 20) > 0.7 ? 1 : 0)) % 4, ground(x)];
    if (kind === 0) arcade(r, x, 3 + Math.floor(hash(n, 21) * 3), n * 7);
    if (kind === 1) mausoleum(r, x + 16, 26 + Math.floor(hash(n, 22) * 10), g);
    if (kind === 2) stroke(r, limbs(x, g, 40 + hash(n, 23) * 16, 0.1, n), MID);
    for (let i = 0; i < 3; i++)
      headstone(r, [x + 34 + i * 9, g, 4 + i, 5 + 2 * i, i % 2, i - 1], MID);
    x += kind === 0 ? 90 : 56 + Math.floor(hash(n, 24) * 40);
  }
  for (let y = 64; y < BANK; y++)
    for (let x = 0; x < r.width; x++)
      if (rgbAt(r, x, y) >= 0 && bayer(x, y) < 0.4 - Math.abs(y - 79) / 30)
        r.px(x, y, 0x182430);
}

/** The bank's dead trees: where each stands, its height and lean. */
const TREES = [62, 410, 668, 946, 1214].map((x, i) =>
  limbs(x, BANK - 1, 58 + 16 * hash(i, 8), (i % 2 ? -1 : 1) * 0.12, i * 13 + 5),
);

/** A drip: the twig it hangs from, the row it lands on in the water, and its seed. */
type Drip = readonly [x: number, top: number, bottom: number, seed: number];

/** One drip from each tree, off the lowest tip of its branches. */
export const DRIPS: readonly Drip[] = TREES.map((tree, i) => {
  const tip = tree.reduce((low, limb) => (limb[3] > low[3] ? limb : low));
  const x = Math.round(tip[2]);
  return [x, Math.min(Math.round(tip[3]) + 1, BANK - 4), BANK + 3 + (x % 7), i];
});

/** The braziers along the bank, and the two flanking the great doors. */
const BRAZIERS = [150, 476, 806, 1104, GATE_X - 31, GATE_X + 31];

/** A brazier's iron stand and bowl, its rim lit green by the fire. */
function brazier(r: Raster, x: number) {
  for (let j = 0; j < 12; j++) {
    r.px(x - 3 + (j >> 2), BANK - 1 - j, IRON);
    r.px(x, BANK - 1 - j, IRON);
    r.px(x + 3 - (j >> 2), BANK - 1 - j, IRON_LIT);
  }
  for (let j = 0; j < 4; j++) {
    const [left, w] = [x - 5 + j, 11 - 2 * j];
    r.rect(left, BANK - 16 + j, w, 1, j ? IRON : GLOW[2]!);
    if (j) r.px(left + w - 1, BANK - 16 + j, j === 1 ? GLOW[1]! : IRON_LIT);
  }
}

/** A run of iron railings on the bank, spear-topped, some bars bent or gone and the rails broken. */
function fence(r: Raster, x0: number, len: number) {
  for (let x = x0; x < x0 + len; x++) {
    if (hash(x >> 3, 31) < 0.85) {
      r.px(x, BANK - 11, IRON);
      r.px(x, BANK - 4, IRON);
    }
    if ((x - x0) % 3 || hash(x, 32) > 0.88) continue;
    const bend = hash(x, 33) > 0.8 ? 1 : 0;
    for (let y = BANK - 13; y < BANK; y++)
      r.px(x + (y < BANK - 8 ? bend : 0), y, IRON);
    r.rect(x + bend - 1, BANK - 13, 3, 1, IRON);
    r.px(x + bend, BANK - 14, IRON_LIT);
  }
}

/** How high the doorway's opening rises at `a` from its centre line, `k` pixels out into its mouldings. */
const arch = (a: number, k: number) =>
  a < 22 + k ? 26 + Math.sqrt(Math.max(0, (34 + k) ** 2 - (a + 12) ** 2)) : -1;
const MOULDING = [INK, STONE[1], STONE[3], STONE[3], INK, STONE[2]];
const WALL = [STONE[1], STONE[2], STONE[3]];
/** The keystone's skull, a row of 7 bits each: brow, eyes, nose, teeth. */
const SKULL = [0x3e, 0x7f, 0x49, 0x77, 0x3e, 0x2a];

/** The cathedral's ruined west wall at the stage end: blocks and ivy, a gable, buttresses and the doors, ajar. */
function gate(r: Raster) {
  for (let x = WALL_X; x < CRYPT_LENGTH; x++) {
    const ragged = 28 + 6 * Math.sin(x * 0.08) + hash(x >> 2, 60) * 9;
    const crumble = BANK - (x - WALL_X) * 1.4;
    const gable = 4 + Math.abs(x + 0.5 - GATE_X) * 0.55 + hash(x >> 2, 61) * 5;
    const top = Math.round(Math.min(Math.max(ragged, crumble), gable));
    const ivy = hash(x >> 4, 65) > 0.5 && hash(x >> 1, 63) > 0.4;
    for (let y = top; y < BANK; y++) {
      const course = Math.floor((BANK - 1 - y) / 6);
      const joint = (x + course * 7) % 15 === 0 || (BANK - 1 - y) % 6 === 5;
      const block = hash(Math.floor((x + course * 7) / 15), course + 62);
      let c = joint ? IRON : dither(WALL, 0.2 + block * 0.5, x, y);
      if (ivy && y - top < 3 + hash(x >> 1, 64) * 26)
        c = (x ^ y) & 1 ? 0x24382c : 0x16241e;
      if (y - top === 1) c = STONE[3];
      if (y === top || x === WALL_X || rgbAt(r, x - 1, y) < 0) c = INK;
      r.px(x, y, c);
    }
  }
  // Lancet windows, dark to a green glow at their sills.
  for (const wx of [GATE_X - 86, GATE_X + 74, GATE_X + 116])
    for (let y = 40; y < 68; y++)
      for (let x = wx - 3; x < wx + 3; x++)
        if (Math.hypot(x + 0.5 - wx, Math.max(0, 47 - y)) < 3)
          r.px(x, y, dither([VOID, ...GLOW], (y - 40) / 40, x, y));
  const pier = (x: number, y: number) => {
    const a = Math.abs(Math.abs(x + 0.5 - GATE_X) - 40);
    return a < (y < 50 ? 4 : 5.5) && y >= 18 + a * 1.5 && y < BANK;
  };
  shape(r, [GATE_X - 48, 10, GATE_X + 48, BANK], pier, STONE);
  // The doorway's mouldings, and the doors: dark planks banded with iron, and a glow from the crypt between them.
  for (let v = 0; v < 70; v++)
    for (let u = -30; u < 30; u++) {
      const [x, y, a] = [GATE_X + u, BANK - 1 - v, Math.abs(u + 0.5)];
      let k = 0;
      while (k < 7 && !(v < arch(a, k))) k++;
      const band = [7, 23, 41].find((b) => v === b || v === b - 1);
      let c = a % 4 < 1 ? 0x120c12 : (a >> 2) & 1 ? 0x2a1c22 : 0x23171d;
      if (band !== undefined) c = v === band && a % 6 > 4 ? IRON_LIT : IRON;
      if (a < 1.5) c = dither(GLOW, 1 - v / 60, x, y);
      if (k < 7) r.px(x, y, k ? MOULDING[k - 1]! : c);
    }
  for (let i = 0; i < 42; i++) {
    const bit = (SKULL[Math.floor(i / 7)]! >> (6 - (i % 7))) & 1;
    r.px(GATE_X - 3 + (i % 7), BANK - 67 + i / 7, bit ? BONE : 0x2a2030);
  }
}

/** Still black water from row `y0` to `y1`: the horizon's glow mirrored at its far edge, darkening, in streaks. */
function water(r: Raster, y0: number, y1: number) {
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < r.width; x++) {
      const t = ((y - y0) / (y1 - y0)) * 1.3;
      let c = dither([0x16262c, 0x0e1a20, 0x0a1218, WATER], t, x, y);
      if (hash(x >> 3, y * 7 + 400) > 0.86 && hash(x, y) > 0.3) c = 0x24393e;
      r.px(x, y, c);
    }
}

/** The far bank above the water, everything standing on it, the water and its reflection. */
function bank(r: Raster) {
  for (let x = 0; x < WALL_X + 8; x++) {
    r.px(x, BANK - 2, x % 5 ? 0x1c1a1e : 0x24221e);
    r.px(x, BANK - 1, hash(x >> 2, 33) > 0.4 ? 0x2c3a3a : 0x1c1a1e);
    if (hash(x, 34) > 0.7) r.px(x, BANK - 3, 0x1a2620);
  }
  gate(r);
  for (const tree of TREES) stroke(r, tree, BARK);
  const taken = [...BRAZIERS, ...TREES.map((tree) => tree[0]![0])];
  for (let x = 20, n = 0; x < WALL_X - 24; n++) {
    const kind = Math.floor(hash(n, 35) * 5);
    const len = 24 + Math.floor(hash(n, 36) * 30);
    const clear = (a: number, b: number) => taken.every((t) => t < a || t > b);
    if (kind === 4 && clear(x - 8, x + len + 8)) fence(r, x, len);
    const [w, h] = [7 + (kind % 2) * 3, 11 + Math.floor(hash(n, 37) * 8)];
    const lean = Math.round((hash(n, 38) - 0.5) * 4);
    if (kind < 4 && clear(x - 12, x + 12))
      headstone(r, [x, BANK - 1, w, h, kind % 3, lean], GRAVE);
    x += kind === 4 ? len + 6 : 14 + Math.floor(hash(n, 39) * 24);
  }
  for (const x of BRAZIERS) brazier(r, x);
  water(r, BANK, FLOOR);
  mirror(r, 0, r.width, BANK, (_, y) => y < BANK - 2);
  for (const x of BRAZIERS)
    for (let y = BANK; y < FLOOR - 2; y++)
      for (let i = -2; i <= 2; i++)
        if (bayer(x + i, y) < 0.5 - Math.abs(i) * 0.15 - (y - BANK) * 0.03)
          r.px(x + i, y, GLOW[1]!);
}

/** Crosses and stones sunk to their shoulders in the water, each with its waterline and reflection. */
function sunken(r: Raster) {
  for (let x = 34, n = 0; x < WALL_X - 30; n++) {
    const line = BANK + 4 + Math.floor(hash(n, 41) * 7);
    const foot = line + 2 + Math.floor(hash(n, 42) * 4);
    const w = 8 + Math.floor(hash(n, 43) * 4);
    const h = 15 + Math.floor(hash(n, 44) * 8);
    const lean = Math.round((hash(n, 45) - 0.5) * 6);
    const inside = headstone(r, [x, foot, w, h, n % 3, lean], GRAVE, line);
    mirror(r, x - 12, x + 12, line, inside);
    for (let i = -7; i <= 7; i++)
      if (inside(x + i, line - 1) || inside(x + i + 1, line - 1))
        r.px(x + i, line, 0x34505a);
    x += 46 + Math.floor(hash(n, 46) * 80);
  }
}

/** The graves the bonewalkers will claw out of, broken through the causeway: where each pit is. */
export const GRAVES = [318, 128, 702, 150, 988, 124, 1190, 146];

const EARTH = [VOID, MOUND[1], MOUND[2], MOUND[3]];

/** An open grave: spilt mud, its dug earth heaped behind it, the pit, its headstone and a bone. */
function openGrave(r: Raster, x: number, y: number) {
  for (let i = 0; i < 46; i++) {
    const [u, v] = [(hash(i, x) - 0.5) * 56, (hash(i, y) - 0.5) * 16];
    r.rect(x + u, y + v, 2, 1, i % 3 ? MOUND[2] : MOUND[3]);
  }
  // The pit: its far lip catching the light, the earth wall inside it, and the dark below.
  for (let j = 0; j < 10; j++) {
    const [a, b] = [Math.floor(hash(j, x) * 2), Math.floor(hash(j, y) * 2)];
    for (let i = -12 + a; i < 12 - b; i++) {
      const wall = dither(EARTH, 1.3 - j / 3, i, j);
      const c = j ? (j === 1 || j === 9 ? INK : j < 4 ? wall : VOID) : ROAD[5];
      r.px(x + i, y - 5 + j, c!);
    }
  }
  const heap = (px: number, py: number) =>
    ((px - x - 20.5) / 10) ** 2 + ((py - y - 0.5) / 5) ** 2 <
      1 - hash(px >> 1, py) * 0.3 && py < y + 4;
  shape(r, [x + 9, y - 5, x + 33, y + 4], heap, MOUND);
  headstone(r, [x - 15, y - 5, 8, 14, 0, -3], GRAVE);
  r.rect(x - 7, y + 6, 4, 1, BONE);
  r.px(x - 2, y + 5, BONE);
}

/** The causeway: a kerb along the water, rows of wet flagstones deepening towards the viewer, puddles and moss. */
function causeway(r: Raster) {
  for (let x = 0; x < r.width; x++) {
    const joint = (x + 5) % 17 === 0;
    r.px(x, FLOOR, joint ? INK : 0x4e5868);
    r.px(x, FLOOR + 1, joint ? INK : 0x2e3442);
    r.px(x, FLOOR + 2, ROAD[1]!);
  }
  for (let y0 = FLOOR + 3, k = 0; y0 < SHORE - 2; k++) {
    const y1 = Math.min(y0 + 5 + k, SHORE - 2);
    for (let xs = -Math.floor(hash(k, 200) * 20), n = 0; xs < r.width; n++) {
      const w = 14 + k * 4 + Math.floor(hash(n, 210 + k) * 24);
      const tone = 0.15 + (k / 8) * 0.5 + (hash(n, 230 + k) - 0.5) * 0.2;
      const puddle = hash(n, 240 + k) > 0.75;
      const [wet, mossy] = [hash(n, 260 + k) > 0.6, hash(n, 270 + k) > 0.6];
      const glint = xs + Math.floor(hash(n, 250 + k) * w);
      for (let y = y0; y < y1; y++)
        for (let x = xs; x < xs + w; x++) {
          const grain = (hash(x >> 2, y >> 1) - 0.5) * 0.15;
          let c = dither(ROAD, tone + grain, x, y);
          if (y === y0 + 1 && wet && hash(x >> 2, y + k) > 0.5) c = ROAD[5]!;
          const u = (x + 0.5 - xs - w / 2) / (w * 0.32);
          const v = (y + 0.5 - (y0 + y1) / 2) / 1.7;
          if (puddle && u * u + v * v < 1)
            c = Math.abs(x - glint) < 2 && v < 0 ? 0x4a6a70 : 0x0e1820;
          const seam = y === y0 ? hash(x >> 3, k + 280) > 0.25 : x === xs;
          if (seam) c = mossy && hash(x >> 1, y) > 0.5 ? 0x1e3226 : ROAD[0]!;
          r.px(x, y, c);
        }
      xs += w;
    }
    y0 = y1;
  }
  for (let i = 0; i < GRAVES.length; i += 2)
    openGrave(r, GRAVES[i]!, GRAVES[i + 1]!);
  // The front kerb, then water with lily pads, a few flowering.
  for (let x = 0; x < r.width; x++) {
    r.px(x, SHORE - 2, (x + 9) % 23 ? 0x3a4250 : INK);
    r.px(x, SHORE - 1, ROAD[0]!);
  }
  water(r, SHORE, VIEW_H);
  for (let i = 0; i < r.width / 36; i++) {
    const cx = Math.floor(hash(i, 250) * r.width);
    const cy = SHORE + 2 + Math.floor(hash(i, 251) * 5);
    const rx = 3.5 + Math.floor(hash(i, 252) * 4);
    for (let y = -2; y <= 2; y++)
      for (let x = -rx; x <= rx; x++)
        if ((x / rx) ** 2 + (y / 1.8) ** 2 < 1 && !(y === 0 && x > 0))
          r.px(cx + x, cy + y, y < 0 ? 0x4a8050 : 0x2a5236);
    if (hash(i, 253) > 0.7) r.rect(cx, cy - 2, 2, 1, 0xe8d8f0);
  }
}

/** The road and everything at its speed: the bank behind the water, the sunken graves, the causeway, the steps. */
function crypt(r: Raster) {
  bank(r);
  sunken(r);
  causeway(r);
  for (let k = 0; k < 4; k++) {
    const [y0, half] = [BANK + 3 * k, 22 + k * 3];
    const y1 = k < 3 ? y0 + 3 : FLOOR;
    for (let y = y0; y < y1; y++)
      for (let x = GATE_X - half; x < GATE_X + half; x++) {
        const edge = x === GATE_X - half || x === GATE_X + half - 1;
        const c = y === y0 ? STONE[3] : y === y1 - 1 ? STONE[1] : STONE[2];
        r.px(x, y, edge || (y > y0 && (x - GATE_X) % 9 === 0) ? INK : c);
      }
  }
}

/** Reeds, bulrushes and broken stones along the bottom edge, passing a little faster than the floor. */
function reeds(r: Raster) {
  for (let x = 0, n = 0; x < r.width; n++) {
    const blades = hash(n, 300) > 0.3 ? 3 + Math.floor(hash(n, 301) * 5) : 0;
    for (let b = 0; b < blades; b++) {
      const s = n * 9 + b;
      const bx = x + Math.floor(hash(s, 302) * 10);
      const h = 5 + Math.floor(hash(s, 303) * 8);
      const lean = hash(s, 304) > 0.5 ? 1 : -1;
      for (let j = 0; j < h; j++) {
        const c = j > h - 3 ? 0x2c4434 : 0x121c18;
        r.px(bx + (j > h * 0.6 ? lean : 0), VIEW_H - 1 - j, c);
      }
      if (hash(s, 305) > 0.75)
        r.rect(bx + lean, VIEW_H - h - 2, 1, 3, 0x2e2018);
    }
    if (!blades) {
      r.rect(x, VIEW_H - 4, 8, 4, 0x0e1018);
      r.rect(x + 1, VIEW_H - 5, 6, 1, 0x2a3040);
    }
    x += 26 + Math.floor(hash(n, 306) * 60);
  }
}

/** A fire: its left column, width, base row, tallest flame and seed. */
type Fire = readonly [number, number, number, number, number];

/** The green fires in the braziers, the last two flanking the great doors. */
export const FIRES = BRAZIERS.map((x, i): Fire => [x - 4, 9, BANK - 17, 13, i]);

const tone = (j: number, h: number, env: number) =>
  Math.min(3, Math.floor((j / h) * 3.2 + (1 - env) * 1.6));

function burn(brush: Brush, fire: Fire, cam: number, t: number) {
  const [x0, w, base, height, seed] = fire;
  if (x0 + w + 16 < cam || x0 - 16 >= cam + VIEW_W) return;
  for (let i = 0; i < w; i++) {
    const x = x0 + i - cam;
    if (x < 0 || x >= VIEW_W) continue;
    const env = Math.sin((Math.PI * (i + 0.5)) / w);
    const lick = 0.3 * Math.sin((x0 + i) * 0.9 + seed + t * 11);
    const sway = 0.2 * Math.sin((x0 + i) * 0.37 + seed * 2 - t * 7);
    const h = Math.max(1, Math.round(height * env * (0.55 + lick + sway)));
    for (let j = 0; j < h;) {
      const c = tone(j, h, env);
      let k = j + 1;
      while (k < h && tone(k, h, env) === c) k++;
      brush.fillStyle = FLAME[c]!;
      brush.fillRect(x, base - k + 1, 1, k - j);
      j = k;
    }
  }
  for (let i = 0; i < 3; i++) {
    const life = (t * (0.3 + hash(i, seed) * 0.3) + hash(i, seed + 1)) % 1;
    const drift = (hash(i, seed + 2) - 0.5) * w + Math.sin(life * 7 + i) * 3;
    const x = Math.round(x0 + w / 2 + drift) - cam;
    if (x < 0 || x >= VIEW_W) continue;
    brush.fillStyle = FLAME[1 + Math.min(2, Math.floor(life * 3))]!;
    brush.fillRect(x, Math.round(base - height * 0.6 - life * 30), 1, 1);
  }
}

/** One row of world pixels from `x0` to `x1`, clipped to the screen at camera `cam`. */
function run(brush: Brush, x0: number, x1: number, y: number, cam: number) {
  const [from, to] = [Math.max(x0 - cam, 0), Math.min(x1 - cam, VIEW_W)];
  if (to > from) brush.fillRect(from, y, to - from, 1);
}

/**
 * The first of the world-fixed, screen-wide tiles a pattern repeats in that can reach the screen: the one `margin` left
 * of it. The tiles run on from there while they begin before the screen's right edge.
 */
const firstTile = (cam: number, margin: number) =>
  Math.floor((cam - margin) / VIEW_W);

/** Banks of fog drifting over the graves and the black water, thin as a dither, each swelling and fading. */
function fog(brush: Brush, cam: number, t: number) {
  brush.fillStyle = FOG;
  for (let k = firstTile(cam, 210); k * VIEW_W < cam + VIEW_W; k++)
    for (let i = 0; i < 3; i++) {
      const seed = k * 3 + i;
      const phase = (t / 34 + hash(seed, 90)) % 1;
      const len = Math.round(110 * Math.sin(Math.PI * phase));
      const tile = k * VIEW_W + Math.round(phase * 90);
      const left = tile + Math.floor(hash(seed, 91) * VIEW_W);
      const y = 64 + Math.floor(hash(seed, 92) * 34);
      for (let row = -2; row <= 2; row++) {
        const a = Math.abs(row);
        for (let s = a * 12 + (row & 1); s < len - a * 12; s += a > 1 ? 4 : 2)
          run(brush, left + s, left + s + 1, y + row, cam);
      }
    }
}

/** A ring on the water at `life` (0 to 1): a pair of dashes spreading from `x` and fading. */
function ring(brush: Brush, x: number, y: number, life: number, cam: number) {
  const w = 1 + Math.floor(life * 6);
  brush.fillStyle = RIPPLE[Math.min(2, Math.floor(life * 3))]!;
  run(brush, x - w - 1, x - w + 1, y, cam);
  run(brush, x + w, x + w + 2, y, cam);
}

/** Rings spreading on the black water behind the causeway and in front of it. */
function ripples(brush: Brush, cam: number, t: number) {
  for (let k = firstTile(cam, 20); k * VIEW_W < cam + VIEW_W; k++)
    for (let i = 0; i < 10; i++) {
      const seed = k * 10 + i;
      const life = (t / (2.2 + hash(seed, 110) * 2) + hash(seed, 111)) % 1;
      const x = k * VIEW_W + 8 + Math.floor(hash(seed, 112) * (VIEW_W - 8));
      const depth = Math.floor(hash(seed, 113) * (i < 6 ? 10 : 5));
      ring(brush, x, (i < 6 ? BANK + 2 : SHORE + 2) + depth, life, cam);
    }
}

/** Now and then a drop swells on a dead tree's twig, falls and rings the water. */
function drips(brush: Brush, cam: number, t: number) {
  for (const [x, top, bottom, seed] of DRIPS) {
    const life = (t / (3.5 + hash(seed, 120) * 3) + hash(seed, 121)) % 1;
    const f = (life - 0.6) / 0.12;
    const y = top + Math.round((bottom - top) * f * f);
    brush.fillStyle = DROP;
    if (life > 0.3 && life < 0.6) run(brush, x, x + 1, top, cam);
    else if (life >= 0.6 && life < 0.72) {
      run(brush, x, x + 1, y - 1, cam);
      run(brush, x, x + 1, y, cam);
    } else if (life >= 0.72) ring(brush, x, bottom, (life - 0.72) / 0.28, cam);
  }
}

export const DROWNED_CRYPT: StageArt = {
  back: [
    { rate: [0, 1], top: 0, height: FLOOR, paint: sky },
    { rate: [1, 8], top: 4, height: FLOOR - 4, paint: far },
    { rate: [1, 4], top: 40, height: FLOOR - 40, paint: mid },
    { rate: [1, 1], top: 0, height: VIEW_H, paint: crypt },
  ],
  cameraEnd: CRYPT_END,
  front: { rate: [5, 4], top: VIEW_H - 12, height: 12, paint: reeds },
  animate(brush, camX, frame) {
    const t = frame / 60;
    ripples(brush, camX, t);
    fog(brush, camX, t);
    for (const fire of FIRES) burn(brush, fire, camX, t);
    drips(brush, camX, t);
  },
};

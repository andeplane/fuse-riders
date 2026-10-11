import {
  cameraEndPx,
  FLOOR_TOP_PX,
  stageLengthPx,
  VIEW_H,
  VIEW_W,
} from "../../engine/view-kit.js";
import { bayer, dither, hash, Raster } from "./kit.js";
import type { Brush, StageArt } from "./kit.js";

/**
 * Stage 2, Wyrmbone Pass: a cold dawn on a mountain road through the bones of a dead giant wyrm. Far to near: the sky
 * and the setting moon stand still, snowy peaks drift at 1/8 of the camera, the near mountains with a winding path and
 * their pines at 1/4, the road and the carcass at the floor's own speed, and stones and bone chips in front of the
 * heroes at 5/4. The wyrm lies along the pass, tail first: half-buried vertebrae, two runs of ribs arching over the
 * road (the front ones planted in its verge), a lesser wyrm's skull partway, then the raiders' camp under its neck and
 * its own great skull set in the cliff at the end, jaws open as the gate the boss waits in. The layout comes from a
 * cosmetic hash, so every device draws the same pass. Only the fires, the mist and the snow move.
 */

const FLOOR = FLOOR_TOP_PX;
const LENGTH = stageLengthPx(2);
/** The great skull's centre in the last screen, and the cliff it is set in, from here to the stage end. */
const GATE_X = cameraEndPx(2) + 176;
const CLIFF_X = GATE_X - 128;
/** The lesser skull's snout, and the raiders' camp. */
const SKULL_X = 652;
const CAMP_X = 1150;
const CAMPFIRE_X = CAMP_X + 72;

const INK = 0x150c1f;
const VOID = 0x0c0814;
const SNOW = 0xd2dcf0;
const SNOW_SHADE = 0x8a98c0;
/** A material's ink, shadow, base and light, and the colour of its tops when snow lies on them. */
type Ramp = readonly [
  ink: number,
  dark: number,
  base: number,
  lit: number,
  top?: number,
];
const BONE: Ramp = [INK, 0x6c5e78, 0xb4a8b0, 0xf2ece6];
const BONE_FAR: Ramp = [0x1c1830, 0x4a4462, 0x7a7390, 0xaca6c2];
const STONE: Ramp = [INK, 0x2a2c48, 0x40466a, 0x666e96, SNOW];
const HIDE: Ramp = [INK, 0x3e2232, 0x5e3038, 0x84483e, SNOW];
const SKY = [
  0x080a1c, 0x0e1230, 0x161c44, 0x222a58, 0x323a6a, 0x4a4e7e, 0x6a6490,
  0x92809e, 0xc29ca6,
];
const ROAD = [0x1c1e36, 0x252842, 0x2f3350, 0x3a3f5e, 0x464c6c, 0x535a7c];
const PINE = 0x141c2c;
const WOOD = 0x3a2a3a;
const FLAME = ["#fff6b8", "#ffc22e", "#f86420", "#a82434"];
/** The mist's colour, which no flame or snowflake shares. */
const MIST = "#56628c";

type Box = readonly [x0: number, y0: number, x1: number, y1: number];

/**
 * Paints the pixels in `box` that `inside` holds, lit from the dawn at the upper right: inked where they meet the
 * outside, light along the top and right, shadow along the bottom and left, and between them `tone` (0 dark to 1
 * light) or the base colour; a material with a colour for its tops (snow) has it there.
 */
function shape(
  r: Raster,
  [x0, y0, x1, y1]: Box,
  inside: (x: number, y: number) => boolean,
  [ink, dark, base, lit, top = lit]: Ramp,
  tone?: (x: number, y: number) => number,
) {
  const w = x1 - x0 + 4;
  const mask = new Uint8Array(w * (y1 - y0 + 4));
  for (let y = y0 - 2; y < y1 + 2; y++)
    for (let x = x0 - 2; x < x1 + 2; x++)
      mask[(y - y0 + 2) * w + x - x0 + 2] = inside(x, y) ? 1 : 0;
  const at = (x: number, y: number) =>
    mask[(y - y0 + 2) * w + x - x0 + 2] === 1;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      if (!at(x, y)) continue;
      let c = base;
      if (!at(x, y - 1) || !at(x, y + 1) || !at(x - 1, y) || !at(x + 1, y))
        c = ink;
      else if (!at(x, y - 2)) c = top;
      else if (!at(x + 1, y - 1) || !at(x + 2, y)) c = lit;
      else if (!at(x, y + 2) || !at(x - 2, y) || !at(x - 1, y + 1)) c = dark;
      else if (tone) c = dither([dark, base, lit], tone(x, y), x, y);
      else if (hash(x, y) > 0.95) c = dark;
      r.px(x, y, c);
    }
}

type Ellipse = readonly [cx: number, cy: number, rx: number, ry: number];
type Sweep = readonly [a0: number, a1: number, t0: number, t1: number];

/**
 * Where a pixel lies across a band along an ellipse between angles a0 and a1 (radians, y up), `t0` pixels thick either
 * side at a0 and `t1` at a1, from −1 (inner edge) to 1 (outer); NaN when off it. A rib or a horn.
 */
function arc(
  x: number,
  y: number,
  [cx, cy, rx, ry]: Ellipse,
  [a0, a1, t0, t1]: Sweep,
) {
  const dx = (x + 0.5 - cx) / rx;
  const dy = (cy - y - 0.5) / ry;
  const f = (Math.atan2(dy, dx) - a0) / (a1 - a0);
  const off = (Math.hypot(dx, dy) - 1) * Math.hypot(rx * dx, ry * dy);
  const across = off / (t0 + (t1 - t0) * f);
  return f >= 0 && f <= 1 && Math.abs(across) <= 1 ? across : NaN;
}

function sky(r: Raster) {
  for (let y = 0; y < FLOOR; y++)
    for (let x = 0; x < r.width; x++)
      r.px(x, y, dither(SKY, (y - 6) / 94 + (x / VIEW_W) * 0.14, x, y));
  // The last stars, fading towards the dawn on the right.
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(hash(i, 1) * r.width);
    if (hash(i, 3) * VIEW_W < x * 0.8) continue;
    r.px(x, 3 + Math.floor(hash(i, 2) * 40), i % 4 ? 0x4a5288 : 0xd8dcff);
  }
  // The moon setting in the west, lit from the dawn side, in a faint halo.
  for (let y = 34; y < 72; y++)
    for (let x = 34; x < 76; x++) {
      const d = Math.hypot(x - 55, y - 53);
      if (d >= 9.5) {
        if (d < 16 && bayer(x, y) < (16 - d) / 14) r.px(x, y, 0x4c5486);
        continue;
      }
      const shade = Math.hypot(x - 58.5, y - 52) > 9.5;
      const crater =
        Math.hypot(x - 57, y - 50) < 2 || Math.hypot(x - 52, y - 56) < 1.5;
      r.px(x, y, shade ? 0x8e96b8 : crater ? 0xc0c8dc : 0xeef0f8);
    }
  // Long thin clouds, their bellies catching the dawn.
  for (const [cx, cy, len] of [
    [168, 26, 76],
    [250, 42, 60],
    [104, 66, 44],
    [286, 72, 38],
  ] as const)
    for (let j = 0; j < 4; j++) {
      const half = Math.round((len / 2) * (1 - Math.abs(j - 1.5) * 0.24));
      for (let x = cx - half + j * 3; x < cx + half + j * 3; x++) {
        const glow = (x - cx + half) / (2 * half) + cx / VIEW_W - 0.6;
        const belly = j === 3 || (j === 2 && bayer(x, cy + j) < glow);
        r.px(x, cy + j, belly ? (glow > 0.3 ? 0xc89ca2 : 0x8e7698) : 0x2a3062);
      }
    }
}

/** Snowy peaks, big and small, each a jagged cone: its dawn face lit, its snow streaking down the gullies. */
const PEAKS = Array.from({ length: 22 }, (_, n) => {
  const big = n % 2 === 0;
  return [
    -30 + n * 26 + Math.floor(hash(n, 31) * 14),
    (big ? 42 : 62) + Math.floor(hash(n, 32) * 16),
    0.7 + hash(n, 33) * 0.6,
  ] as const;
});

function peaks(r: Raster) {
  for (let x = 0; x < r.width; x++) {
    let top = Infinity;
    let peak = PEAKS[0]!;
    for (const p of PEAKS) {
      const y = p[1] + Math.abs(x - p[0]) * p[2];
      if (y < top) [top, peak] = [y, p];
    }
    top = Math.round(top) + (hash(x >> 1, 34) > 0.6 ? 1 : 0);
    const lit = x >= peak[0];
    const snow =
      peak[1] + 5 + (76 - peak[1]) * 0.4 + Math.floor(hash(x >> 1, 35) * 7);
    for (let y = top; y < FLOOR; y++) {
      let c =
        y < snow ? (lit ? 0xd0daf0 : 0x8692be) : lit ? 0x485282 : 0x343a64;
      if (y > 84 && bayer(x, y) < (y - 84) / 16) c = 0x4a4f80;
      r.px(x, y, c);
    }
  }
}

const midRidge = (x: number) =>
  Math.round(
    77 +
      8 * Math.sin(x * 0.021 + 0.5) +
      4 * Math.sin(x * 0.056 + 2) +
      1.5 * Math.sin(x * 0.17),
  );

/** The near mountains, a path winding up them to a watch post, and a fringe of pines along their foot. */
function mountains(r: Raster) {
  for (let x = 0; x < r.width; x++) {
    const top = midRidge(x);
    const lit = midRidge(x + 2) > top;
    for (let y = top; y < FLOOR; y++) {
      const rock = lit ? 0x2e3458 : 0x23284a;
      const snow = lit ? 0x6e7ca6 : 0x4e5a86;
      r.px(x, y, y - top < 2 && top < 76 ? snow : rock);
    }
  }
  for (let p = 70; p < r.width; p += 300) {
    let [x, y, dir] = [p, FLOOR - 9, 1];
    while (y > midRidge(x) + 4) {
      for (let k = 0; k < 24 && y > midRidge(x) + 3; k++, x += dir)
        r.px(x, y - Math.floor(k / 5), 0x55608a);
      y -= 5;
      dir = -dir;
    }
    r.rect(x - 2, y - 7, 5, 6, 0x161a30);
    r.px(x, y - 5, 0xffc22e);
  }
  for (let x = 2, n = 0; x < r.width; n++) {
    const th = 8 + Math.floor(hash(n, 37) * 9);
    for (let j = 0; j < th; j++) {
      const w = Math.floor((j % 4) * 0.5 + j * 0.3);
      r.rect(x - w, FLOOR - th + j, 2 * w + 1, 1, PINE);
      if (j % 4 === 1) r.px(x + w, FLOOR - th + j, 0x4e5a86);
    }
    x += hash(n, 38) > 0.65 ? 18 + Math.floor(hash(n, 39) * 40) : 5;
  }
}

/** A rib's base, the half-axes of the ellipse it follows, how far round it goes, and whether it is planted in front. */
type Rib = readonly [number, number, number, number, boolean];

/** A run of ribs from `a` to `b`, tallest in the middle, alternately behind the road's back edge and planted in it. */
function ribcage(a: number, b: number, seed: number): Rib[] {
  const ribs: Rib[] = [];
  for (let x = a, n = 0; x < b; n++) {
    const tall = Math.sin((Math.PI * (x - a)) / (b - a));
    const ry = Math.round(48 + 66 * tall + 10 * hash(n, seed));
    const end = Math.PI * (0.64 + 0.12 * hash(n, seed + 1));
    ribs.push([x, 20 + Math.round(ry * 0.3), ry, end, n % 2 === 1]);
    x += 40 + Math.floor(hash(n, seed + 2) * 14);
  }
  return ribs;
}

const RIBS = [...ribcage(236, 610, 40), ...ribcage(800, 1100, 44)];

/** One rib: rising from its base at the floor's edge, arching back towards the tail and hanging to a point. */
function rib(r: Raster, [x, rx, ry, end, front]: Rib) {
  const base = front ? FLOOR + 6 : FLOOR - 1;
  const t0 = front ? 7 : 5;
  const along: Ellipse = [x - rx, base, rx, ry];
  const span: Sweep = [0, end, t0, 1.6];
  const box: Box = [x - 2 * rx - 8, base - ry - 8, x + 8, base];
  const at = (px: number, py: number) => arc(px, py, along, span);
  shape(
    r,
    box,
    (px, py) => !isNaN(at(px, py)),
    front ? BONE : BONE_FAR,
    (px, py) => 0.55 + at(px, py) * 0.7,
  );
  if (front)
    shape(
      r,
      [x - 12, FLOOR + 2, x + 12, FLOOR + 10],
      (px, py) => ((px + 0.5 - x) / 11) ** 2 + ((py - FLOOR - 8) / 4) ** 2 < 1,
      STONE,
    );
}

/** The wyrm's spine along the back of the road, from its thin tail to its neck, sunk to the middle in the ground. */
function spine(r: Raster) {
  for (let x = 20; x < CLIFF_X;) {
    const s = x < 300 ? 0.5 + (0.75 * (x - 20)) / 280 : x < 1060 ? 1.25 : 1;
    const cx = x;
    shape(
      r,
      [cx - 16, FLOOR - 24, cx + 16, FLOOR],
      (px, py) => {
        const u = px + 0.5 - cx;
        const v = FLOOR - py - 0.5;
        const f = (v - 5 * s) / (9 * s);
        return (
          (u / (8 * s)) ** 2 + (v / (6 * s)) ** 2 < 1 ||
          (f >= 0 && f < 1 && Math.abs(u + f * 3 * s) < 2.6 * s - f * s) ||
          Math.hypot(u + 3 * s, v - 14 * s) < 2 * s ||
          (Math.abs(v - 3 * s) < 1.4 * s && Math.abs(u) < 11 * s)
        );
      },
      BONE_FAR,
      (px, py) => 0.5 + (px - cx) / (12 * s) + (FLOOR - py - 6) / 30,
    );
    x += Math.round(19 * s + 3);
  }
}

/** A lesser wyrm's skull partway along, side on and sunk to the jaw, snout to the left. */
function lesserSkull(r: Raster) {
  const ground = FLOOR + 2;
  const horn: Ellipse = [SKULL_X + 116, ground - 28, 30, 20];
  const sweep: Sweep = [Math.PI, Math.PI * 0.38, 5, 1.2];
  shape(
    r,
    [SKULL_X - 2, ground - 56, SKULL_X + 152, ground],
    (x, y) => {
      const u = x + 0.5 - SKULL_X;
      const v = ground - y - 0.5;
      const head =
        ((u - 72) / 30) ** 2 + ((v - 18) / 20) ** 2 < 1 ||
        (u > 1 && u < 74 && v < 13 + u * 0.18 - Math.max(0, 8 - u) * 0.9);
      const holes =
        ((u - 64) / 7.5) ** 2 + ((v - 23) / 5) ** 2 < 1 ||
        ((u - 11) / 3) ** 2 + ((v - 13) / 1.6) ** 2 < 1 ||
        (v > 5 && v < 8 && u > 6 && u < 60 - (8 - v) * 4);
      return (v >= 0 && head && !holes) || !isNaN(arc(x, y, horn, sweep));
    },
    BONE,
    (x, y) => 0.05 + (x - SKULL_X) / 150 + (ground - y) / 70,
  );
  for (let u = 9; u < 54; u += 5)
    r.rect(SKULL_X + u, ground - 8, 1, 2, BONE[3]);
}

const BANNER_SKULL = ["x..x", "xxxx", ".xx.", "x..x"];

/** The raiders' camp under the wyrm's neck: two hide tents, a campfire, spears and Vorhal's banner. */
function camp(r: Raster) {
  for (const [cx, half, h] of [
    [CAMP_X + 26, 22, 28],
    [CAMP_X + 116, 17, 22],
  ] as const) {
    shape(
      r,
      [cx - half - 1, FLOOR - h - 1, cx + half + 2, FLOOR],
      (x, y) => FLOOR - y - 0.5 < h - (Math.abs(x + 0.5 - cx) * h) / half,
      HIDE,
      (x) => (x < cx ? 0.3 : 0.6) + ((x - cx) % 6 === 0 ? -0.3 : 0),
    );
    for (let j = 0; j < 4; j++) {
      r.px(cx - 2 - j, FLOOR - h - 4 + j, WOOD);
      r.px(cx + 2 + j, FLOOR - h - 4 + j, WOOD);
    }
    for (let y = FLOOR - Math.round(h * 0.5); y < FLOOR; y++) {
      const w = Math.round((y - FLOOR + h * 0.5) * 0.35);
      r.rect(cx - w, y, 2 * w + 1, 1, y > FLOOR - 4 ? 0xa84a30 : VOID);
    }
  }
  for (const x of [CAMP_X - 8, CAMP_X - 4, CAMP_X + 1]) {
    r.rect(x, FLOOR - 30, 1, 30, WOOD);
    r.rect(x, FLOOR - 33, 1, 3, 0xa8b4cc);
  }
  for (let i = -6; i <= 6; i += 3)
    r.rect(CAMPFIRE_X + i - 1, FLOOR - 2, 3, 2, i % 2 ? STONE[2] : STONE[3]);
  r.rect(CAMPFIRE_X - 4, FLOOR - 3, 9, 1, WOOD);
  // Vorhal's banner on a pole before the skull.
  const pole = CAMP_X + 150;
  r.rect(pole, FLOOR - 46, 2, 46, WOOD);
  r.rect(pole - 6, FLOOR - 46, 16, 2, WOOD);
  for (let y = 0; y < 18; y++)
    for (let x = -5; x < 9; x++) {
      if (y > 13 && Math.abs(x - 1.5) < (y - 13) * 1.8) continue;
      const skull = BANNER_SKULL[y - 4]?.[x] === "x";
      const red = x < 2 ? 0xa82434 : 0x7a1a30;
      r.px(pole + x, FLOOR - 44 + y, skull ? 0xe8d8c8 : red);
    }
}

/** The mouth's arch above the floor, by distance from the gate's centre line. */
const mouthTop = (a: number) => 36 - 7 * (a / 27) ** 3;
const EYE_V = 60;
const TORCH_V = 28;
/** The fangs: distance from the centre line and length; a negative distance rises from the jaw. */
const FANGS = [6, 6, 13, 10, 21, 16, -10, 8, -19, 11];

/** Whether a pixel `a` from the centre line and `v` above the floor is on a fang. */
function fang(a: number, v: number) {
  for (let i = 0; i < FANGS.length; i += 2) {
    const [k, len] = [Math.abs(FANGS[i]!), FANGS[i + 1]!];
    const root = FANGS[i]! < 0 ? 0 : Math.round(mouthTop(k)) + 1;
    const f = FANGS[i]! < 0 ? (len - v) / len : (v - root + len) / len;
    if (f >= 0 && f <= 1 && Math.abs(a - k) < 0.7 + (len / 5) * f) return true;
  }
  return false;
}

/** The great skull, face on in the cliff at the stage end: horned, eyes burning, jaws open on a dark throat. */
function greatSkull(x: number, y: number) {
  const u = x + 0.5 - GATE_X;
  const a = Math.abs(u);
  const v = FLOOR - y - 0.5;
  const ea = a - 27;
  const bone =
    (v < 40 && a < 39 - v * 0.15) ||
    (v >= 30 && v < 64 && a < 52 - Math.abs(v - 48) * 0.45) ||
    (v >= 56 && (a / 48) ** 2 + ((v - 60) / 30) ** 2 < 1) ||
    [8, 20].some((k) => {
      const tip = 68 + 30 * Math.sqrt(1 - (k / 48) ** 2) - v;
      return tip > 0 && tip < 12 && Math.abs(a - k) < tip * 0.35;
    });
  const holes =
    (a < 27 && v < mouthTop(a) && !fang(a, v)) ||
    (ea / 10) ** 2 + ((v - EYE_V - ea * 0.35) / 6.5) ** 2 < 1 ||
    ((a - 8) / 2.2) ** 2 + ((v - 46) / 3) ** 2 < 1;
  const horn: Ellipse = [GATE_X + Math.sign(u) * 84, FLOOR - 76, 46, 26];
  const sweep: Sweep =
    u < 0 ? [0, Math.PI * 0.58, 6.5, 1.2] : [Math.PI, Math.PI * 0.42, 6.5, 1.2];
  return (v >= 0 && bone && !holes) || !isNaN(arc(x, y, horn, sweep));
}

/** The cliff the great skull is set in, from its crag to the stage end, the skull, its fangs and torches. */
function gate(r: Raster) {
  const cliffTop = (x: number) =>
    Math.max(
      FLOOR -
        62 +
        Math.round(5 * Math.sin(x * 0.09) + 4 * Math.sin(x * 0.23 + 1)),
      FLOOR - (x - CLIFF_X) * 3.5 + Math.floor(hash(x >> 3, 22) * 14),
    ) + Math.floor(hash(x >> 1, 21) * 2);
  // Faceted rock: lit where a coarse noise falls away towards the dawn.
  const facet = (x: number, y: number) => {
    const [gx, gy] = [Math.floor(x / 11), Math.floor(y / 9)];
    const [fx, fy] = [x / 11 - gx, y / 9 - gy];
    const h = (i: number, j: number) => hash(gx + i, gy + j + 26);
    const top = h(0, 0) + (h(1, 0) - h(0, 0)) * fx;
    return top + (h(0, 1) + (h(1, 1) - h(0, 1)) * fx - top) * fy;
  };
  shape(
    r,
    [CLIFF_X, FLOOR - 76, LENGTH, FLOOR],
    (x, y) => x >= CLIFF_X && y >= cliffTop(x) && y < FLOOR,
    STONE,
    (x, y) => 0.45 + 3.5 * (facet(x, y) - facet(x + 2, y - 2)),
  );
  // The throat, dark to a glow far inside, and the eye sockets, behind the bone.
  for (let v = 0; v < 74; v++)
    for (let u = -40; u < 40; u++) {
      const a = Math.abs(u + 0.5);
      const throat = a < 27 && v < mouthTop(a);
      if (!throat && !(v > 50 && a > 14 && a < 40)) continue;
      const glow = throat ? (1 - a / 27) * (1 - v / 16) : (EYE_V - 4 - v) / 6;
      r.px(GATE_X + u, FLOOR - 1 - v, bayer(u, v) < glow ? 0x3a1428 : VOID);
    }
  shape(r, [GATE_X - 132, 0, GATE_X + 132, FLOOR], greatSkull, BONE, (x, y) => {
    const v = FLOOR - y;
    return 0.45 + (x - GATE_X) / 60 + (v - 50) / 100 - (v < 34 ? 0.3 : 0);
  });
  for (const side of [-1, 1]) {
    const x = GATE_X + side * 47;
    r.rect(x - 1, FLOOR - TORCH_V + 3, 2, TORCH_V - 3, WOOD);
    r.rect(x - 3, FLOOR - TORCH_V, 6, 3, STONE[1]);
    r.rect(x - 3, FLOOR - TORCH_V, 6, 1, STONE[3]);
  }
}

/** A wind-bent pine on the back of the road: its crown flagged away from the wind, snow on the branches. */
function pine(r: Raster, x: number, h: number) {
  for (let j = 0; j < h; j++) {
    const tx = x + Math.round((j / h) ** 2 * 9);
    r.rect(tx, FLOOR - 1 - j, 2, 1, WOOD);
    if (j < 5 || j % 4 > 1) continue;
    const left = 1 + Math.floor((h - j) * 0.12);
    const right = 2 + Math.floor((h - j) * 0.5);
    const top = j % 4 === 2 ? SNOW_SHADE : PINE;
    r.rect(tx - left, FLOOR - 1 - j, left + right + 2, 1, top);
    r.rect(tx - left + 1, FLOOR - j, left + right + 1, 1, PINE);
    r.px(tx + right + 2, FLOOR - j + 1, PINE);
  }
}

/** A cairn of stacked stones, or a boulder, as ellipses `[dx, dy, rx, ry]` from its foot. */
const CAIRN = [0, 3, 7, 3, 1, 8, 5, 2.5, 0, 12, 3.5, 2, 1, 15, 2, 1.5];
const BOULDER = [0, 5, 11, 6, 9, 3, 7, 4];

function stones(r: Raster, x: number, parts: readonly number[]) {
  shape(
    r,
    [x - 14, FLOOR - 22, x + 20, FLOOR],
    (px, py) => {
      for (let i = 0; i < parts.length; i += 4) {
        const u = (px + 0.5 - x - parts[i]!) / parts[i + 2]!;
        const v = (py + 0.5 - FLOOR + parts[i + 1]!) / parts[i + 3]!;
        if (u * u + v * v < 1) return true;
      }
      return false;
    },
    STONE,
  );
}

const PROPS: [number, number][] = [];
for (let x = 12, n = 0; x < CLIFF_X - 40; n++) {
  const busy =
    (x > SKULL_X - 24 && x < SKULL_X + 150) ||
    (x > CAMP_X - 30 && x < CAMP_X + 170);
  if (!busy) PROPS.push([x, Math.floor(hash(n, 50) * 4)]);
  x += 26 + Math.floor(hash(n, 51) * 50);
}

/** A thigh bone on the verge, in front of the road's back edge. */
function bone(r: Raster, x: number, y: number) {
  shape(
    r,
    [x - 3, y - 4, x + 18, y + 4],
    (px, py) => {
      const [u, v] = [px + 0.5 - x, Math.abs(py + 0.5 - y)];
      return (
        (u > 2 && u < 13 && v < 1.3) ||
        Math.hypot(u - 2, v - 1.3) < 1.9 ||
        Math.hypot(u - 13, v - 1.3) < 1.9
      );
    },
    BONE,
  );
}

/** The seams between the road's flagstones: rows that grow taller towards the viewer, broken by the joints. */
function seams(width: number) {
  const seam = new Uint8Array(width * VIEW_H);
  for (let y = FLOOR + 8, k = 0; y < VIEW_H - 3; y += 6 + k * 2, k++) {
    for (let x = 0; x < width; x++) {
      const wobble = Math.round(1.2 * Math.sin(x * 0.05 + k * 2));
      if (hash(x >> 3, 300 + k) > 0.45) seam[(y + wobble) * width + x] = 1;
    }
    for (let x = Math.floor(hash(k, 301) * 30); x < width;) {
      if (hash(x, 304 + k) > 0.35)
        for (let j = 1; j < 4 + k; j++)
          seam[(y + j) * width + x + (j >> 2)] = 1;
      x += 18 + k * 4 + Math.floor(hash(x, 302 + k) * 30);
    }
  }
  return seam;
}

function road(r: Raster) {
  const seam = seams(r.width);
  for (let x = 0; x < r.width; x++) {
    for (let y = FLOOR; y < VIEW_H; y++) {
      const depth = (y - FLOOR) / (VIEW_H - FLOOR);
      const grain = (hash(x >> 2, (y >> 1) + 70) - 0.5) * 0.16;
      const edge = seam[y * r.width + x]
        ? -0.18
        : seam[(y - 1) * r.width + x]
          ? 0.12
          : 0;
      r.px(x, y, dither(ROAD, 0.12 + depth * 0.72 + grain + edge, x, y));
    }
    const drift =
      2 + Math.floor(2.5 + 2 * Math.sin(x * 0.045) + hash(x, 71) * 1.5);
    for (let j = 0; j < drift; j++) {
      const c = j === drift - 1 ? 0x56628c : j ? SNOW : SNOW_SHADE;
      r.px(x, FLOOR + j, c);
    }
  }
  for (let i = 0; i < Math.floor((60 * r.width) / VIEW_W); i++) {
    const x = Math.floor(hash(i, 72) * r.width);
    const y = FLOOR + 8 + Math.floor(hash(i, 73) * 66);
    r.rect(x, y, 2, 1, ROAD[5]!);
    r.rect(x, y + 1, 2, 1, ROAD[0]!);
  }
  // Frost in the hollows, and frozen puddles mirroring the dawn.
  for (let k = 0; k * 160 < r.width; k++) {
    const cx = k * 160 + Math.floor(hash(k, 74) * 120);
    const cy = 118 + Math.floor(hash(k, 75) * 50);
    const ice = k % 3 === 1;
    const [rx, ry] = ice ? [11, 2.4] : [18, 3];
    for (let y = -3; y <= 3; y++)
      for (let x = -rx; x <= rx; x++) {
        if ((x / rx) ** 2 + (y / ry) ** 2 > 1) continue;
        if (!ice && bayer(cx + x, cy + y) > 0.5) continue;
        const shine = x & 1 ? 0xc29ca6 : 0x92809e;
        const c = !ice ? 0x6a76a0 : y ? (y < 0 ? 0x2a3062 : 0x4a4e7e) : shine;
        r.px(cx + x, cy + y, c);
      }
  }
}

/** The road and everything at its speed: the carcass, the camp and the cliff, then what stands in front of the edge. */
function pass(r: Raster) {
  for (const [x, kind] of PROPS)
    if (kind < 2) pine(r, x, 26 + Math.floor(hash(x, 52) * 20));
    else stones(r, x, kind === 2 ? CAIRN : BOULDER);
  spine(r);
  for (const each of RIBS) if (!each[4]) rib(r, each);
  lesserSkull(r);
  camp(r);
  gate(r);
  road(r);
  for (const each of RIBS) if (each[4]) rib(r, each);
  for (let x = 40, n = 0; x < LENGTH - 200; n++) {
    bone(r, x, FLOOR + 4 + Math.floor(hash(n, 55) * 4));
    x += 60 + Math.floor(hash(n, 54) * 90);
  }
}

/** Stones, bone chips and dry grass along the bottom edge, passing a little faster than the floor. */
function verge(r: Raster) {
  const dark = 0x0c0e1c;
  for (let x = 0; x < r.width; x++) {
    if (hash(x, 80) > 0.72)
      for (let j = 0, n = 2 + Math.floor(hash(x, 81) * 4); j < n; j++)
        r.px(x + (j > 2 ? 1 : 0), VIEW_H - 1 - j, dark);
    if (hash(x, 82) > 0.988) {
      r.rect(x, VIEW_H - 4, 7, 4, dark);
      r.rect(x + 1, VIEW_H - 5, 5, 1, 0x2a3050);
    }
    if (hash(x, 83) > 0.993) {
      r.rect(x, VIEW_H - 3, 6, 2, 0x4a4462);
      r.rect(x + 1, VIEW_H - 3, 4, 1, 0x6c6484);
    }
  }
}

/** A fire: its left column, width, base row, tallest flame and seed. */
type Fire = readonly [
  x: number,
  w: number,
  base: number,
  height: number,
  seed: number,
];

/** The campfire, the torches either side of the gate, and the fires lit in the skull's eye sockets. */
export const FIRES: readonly Fire[] = [
  [CAMPFIRE_X - 4, 9, FLOOR - 3, 14, 3],
  ...[-1, 1].flatMap((side, i): Fire[] => [
    [GATE_X + side * 47 - 2, 5, FLOOR - TORCH_V - 1, 9, 20 + i],
    [GATE_X + side * 27 - 4, 9, FLOOR - EYE_V + 3, 7, 40 + i],
  ]),
];

const tone = (j: number, h: number, env: number) =>
  Math.min(3, Math.floor((j / h) * 3.2 + (1 - env) * 1.6));

function burn(
  brush: Brush,
  [x0, w, base, height, seed]: Fire,
  cam: number,
  t: number,
) {
  if (x0 + w + 16 < cam || x0 - 16 >= cam + VIEW_W) return;
  for (let i = 0; i < w; i++) {
    const x = x0 + i - cam;
    if (x < 0 || x >= VIEW_W) continue;
    const env = Math.sin((Math.PI * (i + 0.5)) / w);
    const lick = 0.25 * Math.sin((x0 + i) * 0.9 + seed + t * 9);
    const sway = 0.18 * Math.sin((x0 + i) * 0.37 + seed * 2 - t * 6);
    const h = Math.max(1, Math.round(height * env * (0.6 + lick + sway)));
    for (let j = 0; j < h;) {
      const c = tone(j, h, env);
      let k = j + 1;
      while (k < h && tone(k, h, env) === c) k++;
      brush.fillStyle = FLAME[c]!;
      brush.fillRect(x, base - k + 1, 1, k - j);
      j = k;
    }
  }
  for (let i = 0; i < 4; i++) {
    const life = (t * (0.4 + hash(i, seed) * 0.4) + hash(i, seed + 1)) % 1;
    const drift = (hash(i, seed + 2) - 0.5) * w + Math.sin(life * 9 + i) * 2;
    const x = Math.round(x0 + w / 2 + drift + life * 10) - cam;
    const y = Math.round(base - height * 0.6 - life * 34);
    if (y < 0 || x < 0 || x >= VIEW_W) continue;
    brush.fillStyle = FLAME[1 + Math.min(2, Math.floor(life * 3))]!;
    brush.fillRect(x, y, 1, 1);
  }
}

/**
 * The first of the world-fixed, screen-wide tiles a pattern repeats in that can reach the screen: the one `margin` left
 * of it. The tiles run on from there while they begin before the screen's right edge.
 */
const firstTile = (cam: number, margin: number) =>
  Math.floor((cam - margin) / VIEW_W);

const WISP_ROWS = [-2, -1, 1, 2] as const;

/** Wisps of mist drifting along the back of the road, thin as a dither, each swelling and fading so none pops. */
function mist(brush: Brush, cam: number, t: number) {
  for (let k = firstTile(cam, 160); k * VIEW_W < cam + VIEW_W; k++)
    for (let i = 0; i < 3; i++) {
      const seed = k * 3 + i;
      const phase = (t / 26 + hash(seed, 90)) % 1;
      const len = Math.round(80 * Math.sin(Math.PI * phase));
      const left =
        k * VIEW_W +
        Math.floor(hash(seed, 91) * VIEW_W) +
        Math.round(phase * 70);
      // Its dither runs two rows below its line, so the line stops three short of the road, whose snow it would speckle.
      const y = FLOOR - 14 + Math.floor(hash(seed, 92) * 12);
      brush.fillStyle = MIST;
      const from = Math.max(left - cam, 0);
      const to = Math.min(left + len - cam, VIEW_W);
      if (to > from) brush.fillRect(from, y, to - from, 1);
      for (const row of WISP_ROWS)
        for (
          let s = Math.abs(row) * 8 + (row & 1);
          s < len - Math.abs(row) * 8;
          s += 2
        ) {
          const x = left + s - cam;
          if (x >= 0 && x < VIEW_W) brush.fillRect(x, y + row, 1, 1);
        }
    }
}

/** A light flurry of snow on the wind, falling through the whole picture. */
function snow(brush: Brush, cam: number, t: number) {
  for (let k = firstTile(cam, 40); k * VIEW_W < cam + VIEW_W; k++)
    for (let i = 0; i < 26; i++) {
      const seed = k * 26 + i;
      const life = (t * (0.1 + hash(seed, 93) * 0.08) + hash(seed, 94)) % 1;
      const y = Math.round(-4 + life * (VIEW_H + 8));
      const sway = Math.round(life * 36 + Math.sin(life * 14 + i) * 2);
      const x = k * VIEW_W + Math.floor(hash(seed, 95) * VIEW_W) + sway - cam;
      if (y < 0 || y >= VIEW_H || x < 0 || x >= VIEW_W) continue;
      brush.fillStyle = i % 3 ? "#a8b6d8" : "#eef4ff";
      brush.fillRect(x, y, 1, 1);
    }
}

export const WYRMBONE_PASS: StageArt = {
  back: [
    { rate: [0, 1], top: 0, height: FLOOR, paint: sky },
    { rate: [1, 8], top: 36, height: FLOOR - 36, paint: peaks },
    { rate: [1, 4], top: 58, height: FLOOR - 58, paint: mountains },
    { rate: [1, 1], top: 0, height: VIEW_H, paint: pass },
  ],
  front: { rate: [5, 4], top: VIEW_H - 12, height: 12, paint: verge },
  animate(brush, camX, frame) {
    const t = frame / 60;
    mist(brush, camX, t);
    for (const fire of FIRES) burn(brush, fire, camX, t);
    snow(brush, camX, t);
  },
};

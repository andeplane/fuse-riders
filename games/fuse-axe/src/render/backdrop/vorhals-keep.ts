import {
  FLOOR_TOP_PX,
  VIEW_H,
  VIEW_W,
  cameraEndPx,
  gravesPx,
  stageLengthPx,
} from "../../engine/view-kit.js";
import { bayer, dither, hash, Raster, rgbAt } from "./kit.js";
import type { Brush, StageArt } from "./kit.js";

/**
 * Stage 4, Vorhal's Keep: torch-lit halls inside the warlord's fortress, cold blue-black stone under warm firelight.
 * Far to near: a blood-red sky and moon stand still, glimpsed through the tall vaulted windows of the hall's far wall,
 * which is hung with Vorhal's horned banners and drifts at 1/8 of the camera; the nave's massive pillars and arches,
 * hanging chains and iron cages and statues of horned knights pass at 1/4; and at the floor's own speed come piers
 * with wall torches, braziers on the kerb, polished flagstones with a long red carpet, and the crypt slabs the
 * bonewalkers claw out of. Pillar bases and chains pass in front of the heroes at 5/4. The halls end in the throne
 * room, lit red by a rose window: Vorhal's horned throne on its dais, and on the wall the Ember Axe he broke, its
 * shards glowing faintly. The layout comes from a cosmetic hash, so every device draws the same keep. Only the fires,
 * the embers and the shards' glow move.
 */

/** The keep's road (the engine's `STAGE_4`, five screens), and the furthest the camera goes on it. */
export const KEEP_LENGTH = stageLengthPx(4);
export const KEEP_END = cameraEndPx(4);

const FLOOR = FLOOR_TOP_PX;
/** The step along the floor's back edge: its lit top row, then its face down to the floor. */
export const KERB = FLOOR - 4;
/** The carpet runner's rows, its gold edges included: from the first to before the second. */
const CARPET = [135, 147] as const;
/** The throne's centre in the last screen, the throne room's wall from its arch on, and the Ember Axe on display. */
export const THRONE_X = KEEP_END + 176;
const ROOM_X = THRONE_X - 152;
export const AXE_X = THRONE_X + 112;
const AXE_Y = 52;
const ROSE_Y = 50;

const INK = 0x05050a;
const VOID = 0x010103;
/** Stone from cold shadow into torchlight: a block's tone plus the fire's warmth on it picks the colour. */
const LIT = [
  0x0b0d15, 0x11141f, 0x181c2a, 0x212637, 0x2e2a34, 0x47302b, 0x65412e,
  0x8a5a36,
];
/** The throne room's stone, lit red by its windows. */
const RED_LIT = [
  0x0c0a12, 0x130d17, 0x1b111b, 0x27141f, 0x37181f, 0x4e1e1d, 0x6a2a1e,
];
const FLAGS = [
  0x06070c, 0x0a0c13, 0x0f121b, 0x151925, 0x1c2130, 0x282634, 0x3c2c2a,
  0x5a3a2a,
];
const SKY = [
  0x0e0208, 0x18040b, 0x26060e, 0x380a12, 0x4e0e16, 0x6a1619, 0x86221c,
  0xa0321f,
];
const FAR_WALL = [0x07080d, 0x0a0b12, 0x0d0f17, 0x11131d];
const COLUMN = [0x07080e, 0x0c0e17, 0x12151f, 0x191d2b, 0x222738, 0x2c3244];
const RED = [0x2a060c, 0x480c14, 0x6c141a, 0x922420];
const GOLD = [0x4a3018, 0x8a6430, 0xc49a48];
const GLASS = [0x3a0810, 0x6a1218, 0x9a2420, 0xd04a26, 0xf07a34];
const BONE = [0x5a4e44, 0xa89a86, 0xd6c8b0];
const IRON = 0x181a24;
const IRON_LIT = 0x3a3e4c;
const IRON_WARM = 0x8a4a28;
const WOOD = [0x2a1810, 0x4a2c1a];
const FLAME = ["#fff2c4", "#ffbc3a", "#ea6020", "#962a1a"];
const EMBER = ["#ffb04c", "#f06c22", "#a8341a"];
/** The broken axe's glow at its dimmest to its brightest. */
export const SHARD_GLOW = ["#4e1a10", "#7e2c14", "#b8481c", "#f07c2c"];

type Inside = (x: number, y: number) => boolean;
type Box = readonly [x0: number, y0: number, x1: number, y1: number];
/** A material: its outline, shadow, base, light, and an edge turned to the fire. */
type Ramp = readonly [number, number, number, number, number];
const MID: Ramp = [0x05060b, 0x0c0e17, 0x131622, 0x1d2130, 0x2c1a20];
const STATUE: Ramp = [0x05060b, 0x171a26, 0x22263a, 0x363c50, 0x40302e];
const THRONE: Ramp = [INK, 0x120e16, 0x1e1820, 0x3a2a30, 0x6a3a2a];
const SLAB: Ramp = [INK, 0x171b28, 0x232838, 0x343c50, 0x4a3a36];
/** The near pillars' bases, almost black, and the firelight on their edge. */
const FRONT = [0x040408, 0x09090f, 0x0f1018, 0x181a24, 0x262836];
const FRONT_WARM = 0x4a2c20;

/** Paints the pixels in `box` that `inside` holds: inked at its edge, light along the top, warm on the left. */
function solid(r: Raster, box: Box, inside: Inside, ramp: Ramp) {
  const [[x0, y0, x1, y1], [ink, dark, base, lit, warm]] = [box, ramp];
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      if (!inside(x, y)) continue;
      let c = base;
      if (!inside(x, y - 1) || !inside(x, y + 1)) c = ink;
      else if (!inside(x - 1, y) || !inside(x + 1, y)) c = ink;
      else if (!inside(x, y - 2)) c = lit;
      else if (!inside(x - 2, y)) c = warm;
      else if (!inside(x + 2, y) || !inside(x, y + 2)) c = dark;
      else if (hash(x, y) > 0.94) c = dark;
      r.px(x, y, c);
    }
}

/** Masonry at a pixel: −1 on a joint, else its block's tone in [0, 1), in courses `h` rows high of blocks `w` wide. */
function masonry(x: number, y: number, w: number, h: number, seed: number) {
  const course = Math.floor(y / h);
  const u = x + (course & 1) * (w >> 1);
  if (y % h === h - 1 || u % w === 0) return -1;
  return hash(Math.floor(u / w), course * 7 + seed);
}

/** A light the static layers are warmed by: where it burns and how far it reaches. */
type Light = readonly [x: number, y: number, reach: number];

/** How warm a pixel is in the nearest of `lights`' glow, from 0 to 1, each glow squashed `squash` times in height. */
function warmth(lights: readonly Light[], x: number, y: number, squash = 1.2) {
  let most = 0;
  for (const [lx, ly, reach] of lights)
    if (Math.abs(x - lx) < reach)
      most = Math.max(most, 1 - Math.hypot(x - lx, (y - ly) * squash) / reach);
  return most;
}

/** A lancet window: its top and bottom rows and half its width. */
type Lancet = readonly [top: number, bottom: number, half: number];

/** Whether a pixel `a` from a lancet window's centre line on row `y` is in its opening, grown by `k`. */
function lancet(a: number, y: number, [top, bottom, half]: Lancet, k = 0) {
  const head = top + half * 1.4;
  if (a >= half + k || y >= bottom + k) return false;
  return y >= head || Math.hypot(a + half * 0.6, head - y) < half * 1.6 + k;
}

/** Vorhal's sigil, a horned helm, a row of 9 bits each. */
const SIGIL = [0x101, 0x101, 0x082, 0x0d6, 0x07c, 0x054, 0x07c, 0x028, 0x010];

function sigil(r: Raster, cx: number, top: number, rgb: number) {
  SIGIL.forEach((bits, j) => {
    for (let i = 0; i < 9; i++)
      if ((bits >> (8 - i)) & 1) r.px(cx - 4 + i, top + j, rgb);
  });
}

/** A banner hung from a rod, `half` its width and `len` long to its swallowtail's points, with the sigil in gold. */
function banner(
  r: Raster,
  [cx, top, len, half]: readonly [number, number, number, number],
  cloth: readonly number[],
  gold: readonly number[],
) {
  for (let i = -half - 2; i <= half + 1; i++)
    r.px(cx + i, top - 1, Math.abs(i + 0.5) > half ? gold[1]! : IRON);
  for (let v = 0; v < len; v++)
    for (let i = -half; i < half; i++) {
      const a = Math.abs(i + 0.5);
      const notch = v - (len - 7);
      if (notch > 0 && a < (notch * half) / 7) continue;
      const fold = Math.cos((i + 0.5) * 1.2) * 0.3;
      let c = dither(cloth, 0.45 + fold - v * 0.004, cx + i, top + v);
      if (v === 2 || v === len - 9) c = gold[1]!;
      if (a > half - 1) c = gold[0]!;
      r.px(cx + i, top + v, c);
    }
  sigil(r, cx, top + 6, gold[2]!);
}

/** A chain hanging from `y0` to `y1`: links alternately face on and edge on. */
function chain(r: Raster, x: number, y0: number, y1: number, lit: number) {
  for (let y = y0; y < y1; y++) {
    const k = (y - y0) % 4;
    if (k === 0 || k === 3) r.px(x, y, k ? lit : IRON);
    else {
      r.px(x - 1, y, IRON);
      r.px(x + 1, y, lit);
    }
  }
}

/** The moon over the keep: its centre and radius. */
const MOON = [180, 54, 7.5] as const;

/** A blood-red sky and moon, seen only through the far wall's windows. */
function sky(r: Raster) {
  const [mx, my, mr] = MOON;
  for (let y = 0; y < FLOOR; y++)
    for (let x = 0; x < r.width; x++) {
      const d = Math.hypot(x + 0.5 - mx, y + 0.5 - my);
      let c = dither(SKY, (y - 30) / 90 + Math.max(0, 1 - d / 70) * 0.4, x, y);
      if (d < mr) {
        const shade = Math.hypot(x + 0.5 - mx - 2, y + 0.5 - my + 2) > mr;
        const mare = hash(x >> 2, y >> 2) > 0.72;
        c = shade ? 0x8a2a1e : mare ? 0xc8482c : 0xe8683a;
        if (d > mr - 1.5 && x > mx && y < my) c = 0xffa070;
      }
      r.px(x, y, c);
    }
}

/** The far wall's bays: a window in the middle of each, a shaft between them; its windows, and its dim banners. */
const BAY = 60;
const WINDOW: Lancet = [32, 92, 9];
const DIM_RED = RED.map((c) => (c >> 1) & 0x7f7f7f);
const DIM_GOLD = [0x2a1c10, 0x4a3418, 0x6a4c22];

/** The hall's far wall: vaulted ribs, tall windows open to the sky between wall shafts, banners on every other shaft. */
function far(r: Raster) {
  for (let x = 0; x < r.width; x++)
    for (let y = 0; y < FLOOR; y++) {
      const u = ((x + BAY / 2) % BAY) - BAY / 2;
      const a = Math.abs(u + 0.5);
      if (lancet(a, y, WINDOW)) {
        const ring = Math.abs(Math.hypot(a, y + 0.5 - 40) - 3) < 0.7;
        if ((a < 1 && y > 44) || y === 66 || y === 80 || ring)
          r.px(x, y, y > 60 && a > 0.5 ? 0x2a0a10 : FAR_WALL[0]!);
        continue;
      }
      let c: number;
      if (lancet(a, y, WINDOW, 2))
        c = lancet(a, y, WINDOW, 1) ? 0x4a121a : 0x1a1d2a;
      else if (a > BAY / 2 - 3.5 && y >= 30)
        c = a > BAY / 2 - 1 ? COLUMN[3]! : COLUMN[2]!;
      else if (y < 34 && Math.hypot(a, 34 - y) > 31.5) c = 0x06070b;
      else if (y < 34 && Math.hypot(a, 34 - y) > 29.5) c = COLUMN[2]!;
      else {
        const tone = masonry(x, y, 13, 7, 3);
        c = tone < 0 ? FAR_WALL[0]! : dither(FAR_WALL, 0.2 + tone * 0.6, x, y);
        if (a < 13 && y >= 92 && bayer(x, y) < (104 - y) / 24) c = 0x240a10;
      }
      r.px(x, y, c);
    }
  for (let x = BAY / 2; x < r.width; x += 2 * BAY)
    banner(r, [x, 36, 40, 6], DIM_RED, DIM_GOLD);
}

/** The nave's arcade: pillars this far apart, the arches springing from their capitals at this row. */
const SPAN = 112;
const SPRING = 52;
const NAVE = 92;

/** A statue of a horned knight on its plinth, hands on the pommel of a sword stood point down before it. */
function knight(r: Raster, cx: number) {
  const top = NAVE - 10;
  const plinth: Inside = (x, y) =>
    y >= top && y < NAVE && Math.abs(x + 0.5 - cx) < (y < top + 2 ? 11 : 10);
  solid(r, [cx - 12, top, cx + 12, NAVE], plinth, MID);
  const body: Inside = (x, y) => {
    const [a, v] = [Math.abs(x + 0.5 - cx), top - y - 0.5];
    if (v < 0) return false;
    if (v < 18) return a < 7 - v * 0.08;
    if (v < 26) return a < 6;
    if (v < 30) return a < 9 - (v - 26) * 0.5;
    return v < 37 && a < 3.6;
  };
  solid(r, [cx - 10, top - 40, cx + 10, top], body, STATUE);
  for (let k = 0; k < 8; k++)
    for (const side of [-1, 1]) {
      const y = top - 33 - Math.round(k * k * 0.12) - Math.max(0, k - 4);
      r.px(cx + side * (4 + k) - (side < 0 ? 1 : 0), y, STATUE[3]);
      if (k < 4)
        r.px(cx + side * (4 + k) - (side < 0 ? 1 : 0), y + 1, STATUE[1]);
    }
  r.rect(cx - 2, top - 33, 4, 1, INK);
  r.rect(cx, top - 17, 1, 17, 0x3a4054);
  r.rect(cx - 4, top - 18, 8, 1, STATUE[3]);
  r.rect(cx - 2, top - 21, 4, 3, STATUE[1]);
}

/** An iron cage hung on a chain in a bay of the nave, some with what is left of a prisoner. */
function cage(r: Raster, cx: number, top: number, bones: boolean) {
  chain(r, cx, 0, top, IRON_LIT);
  for (let y = top; y < top + 18; y++)
    for (let i = -6; i <= 6; i++) {
      const ring = y === top + 2 || y === top + 9 || y === top + 17;
      const dome = y < top + 2 && Math.abs(i) < 3 + (y - top) * 2;
      if (ring || dome || (y > top + 2 && i % 3 === 0))
        r.px(cx + i, y, i > 0 && !ring ? IRON_LIT : IRON);
    }
  if (!bones) return;
  r.rect(cx - 1, top + 4, 3, 3, BONE[1]!);
  r.px(cx - 1, top + 5, INK);
  r.px(cx + 1, top + 5, INK);
  for (let j = 0; j < 4; j++) r.rect(cx - 2, top + 8 + j * 2, 5, 1, BONE[0]!);
  r.rect(cx + 2, top + 17, 1, 6, BONE[1]!);
}

/** The nave: massive pillars with arches between them, statues and hanging cages in turn in its bays. */
function mid(r: Raster) {
  for (let x = 0; x < r.width; x++)
    for (let y = 0; y < FLOOR; y++) {
      const p = ((x - SPAN / 2 + SPAN) % SPAN) - SPAN / 2;
      const [a, q] = [Math.abs(p + 0.5), SPAN / 2 - Math.abs(p + 0.5)];
      const wide = (y >= SPRING - 8 && y < SPRING) || y >= NAVE - 8;
      let c = -1;
      if (y >= NAVE) c = y === NAVE ? 0x1a1e2a : 0x0a0b12;
      else if (a < (wide ? 14 : 11)) {
        const s = (p + 0.5) / (wide ? 14 : 11);
        const t = 0.6 - 0.4 * s - 0.25 * s * s - (y % 12 === 0 ? 0.2 : 0);
        c =
          wide && (y === SPRING - 8 || y === NAVE - 8)
            ? COLUMN[5]!
            : dither(COLUMN, t, x, y);
        if (s > 0.8 && bayer(x, y) < 0.5) c = 0x2a0e14;
        if (a > (wide ? 13 : 10)) c = MID[0];
      } else if (y < SPRING) {
        const d = Math.hypot(q, SPRING - y);
        if (d >= 46) {
          const tone = masonry(x, y, 14, 8, 11);
          c = tone < 0 ? MID[0] : dither(COLUMN, 0.1 + tone * 0.4, x, y);
        } else if (d >= 42) {
          const joint = Math.floor(Math.atan2(SPRING - y, q) * 12) % 2;
          c = d < 43 ? MID[0] : joint ? COLUMN[3]! : COLUMN[4]!;
        }
      }
      if (c >= 0) r.px(x, y, c);
    }
  for (let k = 0; k * SPAN < r.width + SPAN / 2; k++) {
    const cx = k * SPAN;
    if (k % 2) knight(r, cx);
    else cage(r, cx + 10, 40 + Math.floor(hash(k, 13) * 14), hash(k, 14) > 0.4);
    for (let j = 0; j < 2; j++) {
      const x = cx - 30 + Math.floor(hash(k, 15 + j) * 60);
      const end = 24 + Math.floor(hash(k, 17 + j) * 40);
      if (Math.abs(x - cx - (k % 2 ? 0 : 10)) > 12) chain(r, x, 0, end, MID[3]);
    }
  }
}

/** The halls' wall torches, one on each pier, then the one at the throne room's arch. */
export const PIERS = [92, 376, 664, 948, 1212];
const TORCHES = [...PIERS, ROOM_X + 14];
const TORCH_Y = 58;
/** The braziers on the kerb: the halls', then the two flanking the dais. */
export const BRAZIERS = [232, 520, 808, 1080, THRONE_X - 80, THRONE_X + 80];
const BOWL_Y = 84;
const LIGHTS: readonly Light[] = [
  ...TORCHES.map((x): Light => [x, TORCH_Y - 4, 46]),
  ...BRAZIERS.map((x): Light => [x, BOWL_Y - 6, 54]),
];

/** A pier of the hall's wall, `half` wide, its torch in an iron cup, its stone warm about the flame and sooted above. */
function pier(r: Raster, cx: number, half: number) {
  const inside: Inside = (x, y) => {
    const a = Math.abs(x + 0.5 - cx);
    return y < KERB && a < (y >= KERB - 10 ? half + 2 : half);
  };
  for (let y = 0; y < KERB; y++)
    for (let x = cx - half - 2; x < cx + half + 2; x++) {
      if (!inside(x, y)) continue;
      const tone = masonry(x - cx + half, y, half + 2, 8, cx);
      const soot = y > TORCH_Y - 22 && y < TORCH_Y - 8 && Math.abs(x - cx) < 4;
      let t = 0.1 + tone * 0.3 + warmth(LIGHTS, x, y) * 0.75;
      if (x > cx + half - 5) t -= 0.15;
      if (soot && bayer(x, y) < 0.6) t = 0.05;
      let c = tone < 0 ? LIT[0]! : dither(LIT, t, x, y);
      if (!inside(x - 1, y) || !inside(x + 1, y) || y === KERB - 10) c = INK;
      r.px(x, y, c);
    }
  r.rect(cx - 2, TORCH_Y, 5, 1, IRON_WARM);
  r.rect(cx - 1, TORCH_Y + 1, 3, 2, IRON);
  r.rect(cx - 1, TORCH_Y + 3, 2, 6, WOOD[1]!);
  r.rect(cx - 2, TORCH_Y + 8, 4, 1, IRON_LIT);
}

/** A brazier on three iron legs on the kerb, its bowl's rim lit by the fire and coals heaped in it. */
function brazier(r: Raster, x: number) {
  const legs = KERB + 1 - (BOWL_Y + 5);
  for (let j = 0; j <= legs; j++) {
    const [y, off] = [KERB + 1 - j, Math.round(6 - (j * 4) / legs)];
    r.px(x - off, y, IRON);
    r.px(x, y, IRON);
    r.px(x + off, y, IRON_LIT);
  }
  r.rect(x - 4, KERB - 6, 9, 1, IRON_LIT);
  [15, 15, 13, 11, 9, 5].forEach((w, j) =>
    r.rect(x - (w >> 1), BOWL_Y + j, w, 1, j ? IRON : IRON_WARM),
  );
  for (let i = -5; i <= 5; i++)
    r.px(x + i, BOWL_Y - 1, (i + x) % 2 ? 0xff8a30 : 0xa83a1a);
}

/** The step along the back of the floor, its top lit by the fires. */
function kerb(r: Raster) {
  for (let x = 0; x < r.width; x++) {
    const w = warmth(LIGHTS, x, KERB);
    r.px(x, KERB, dither(LIT, 0.4 + w * 0.55, x, KERB));
    for (let y = KERB + 1; y < FLOOR; y++) {
      const joint = (x + 7) % 24 === 0 || y === FLOOR - 1;
      const t = 0.16 + w * 0.4 - (y - KERB) * 0.03;
      r.px(x, y, joint ? INK : dither(LIT, t, x, y));
    }
  }
}

/** The throne room's red rose window behind the throne: a ring of stone, twelve spokes of tracery and a gold heart. */
function rose(r: Raster) {
  for (let y = ROSE_Y - 25; y < ROSE_Y + 25; y++)
    for (let x = THRONE_X - 25; x < THRONE_X + 25; x++) {
      const [u, v] = [x + 0.5 - THRONE_X, y + 0.5 - ROSE_Y];
      const [d, angle] = [Math.hypot(u, v), Math.atan2(v, u)];
      if (d >= 24) continue;
      let c = dither(GLASS, 0.95 - d / 30 + hash(x >> 1, y >> 1) * 0.15, x, y);
      if (d > 21.5) c = d > 23 ? INK : 0x4e1e1d;
      else if (
        Math.abs(d - 8) < 0.7 ||
        (d > 8 && Math.abs(Math.sin(angle * 6)) * d < 0.8)
      )
        c = 0x1c080c;
      else if (d < 3) c = GOLD[2]!;
      r.px(x, y, c);
    }
}

/** Vorhal's throne on the top of the dais: black iron and red velvet, a pointed back, and ivory horns sweeping up. */
function throne(r: Raster) {
  const X = THRONE_X;
  const body: Inside = (x, y) => {
    const a = Math.abs(x + 0.5 - X);
    if (y >= 86) return false;
    if (y >= 62) return a < 15;
    return a < 10 && y >= 32 + a * 0.9;
  };
  solid(r, [X - 16, 30, X + 16, 86], body, THRONE);
  for (let y = 40; y < 70; y++)
    for (let x = X - 6; x < X + 6; x++)
      if (y >= 42 + Math.abs(x + 0.5 - X) * 1.2)
        r.px(x, y, dither(RED, 0.75 - (y - 40) / 50, x, y));
  r.rect(X - 10, 70, 20, 2, RED[2]!);
  r.rect(X - 10, 72, 20, 1, GOLD[1]!);
  sigil(r, X, 48, GOLD[2]!);
  for (let k = 0; k < 17; k += 0.5)
    for (const side of [-1, 1]) {
      const x = X + side * (8 + k * 0.95) - (side < 0 ? 1 : 0);
      const y = 44 - k * 0.35 - Math.max(0, k - 7) ** 1.4 * 0.5;
      const w = k < 6 ? 4 : k < 11 ? 3 : k < 15 ? 2 : 1;
      for (let j = 0; j < w; j++)
        r.px(x, y + j, k >= 14 ? 0x3a2a24 : BONE[j ? (j < w - 1 ? 1 : 0) : 2]!);
    }
  for (const side of [-1, 1]) {
    r.rect(X + side * 13 - 1, 60, 3, 2, BONE[2]!);
    r.px(X + side * 13 - 1, 61, INK);
  }
}

/** The dais: three steps to the throne, a red runner up its middle with gold stair rods. */
function dais(r: Raster) {
  for (let k = 0; k < 3; k++) {
    const [top, half] = [86 + 6 * k, 34 + 8 * k];
    for (let y = top; y < top + 6; y++)
      for (let x = THRONE_X - half; x < THRONE_X + half; x++) {
        const a = Math.abs(x + 0.5 - THRONE_X);
        const face = y - top < 2;
        let c = dither(RED_LIT, face ? 0.75 : 0.35 - (y - top) * 0.04, x, y);
        if (a < 10) c = face ? (y === top ? GOLD[1]! : RED[2]!) : RED[1]!;
        if (a > half - 1 || y === top + 5) c = INK;
        r.px(x, y, c);
      }
  }
}

/** The Ember Axe's head: one bit, by a pixel's offset from the haft (out along `u`) and from the head's middle. */
const bit = (u: number, v: number) =>
  u >= 1.5 && Math.abs(v) < 3 + u * 0.7 && u < 15 - (v * v) / 40;
/** The angles from the haft that the cracks run at across each bit. */
const CRACKS = [-0.55, 0.05, 0.5];
/** Each shard: its bit's side, the sector between cracks it fills, and how far it has come apart. */
const SHARDS = [-1, 1].flatMap((side) =>
  [-0.9, -0.25, 0.28, 0.8].map((mid, sector) => {
    const gap = 1 + ((sector + side + 2) % 2);
    const [dx, dy] = [
      Math.round(Math.cos(mid) * gap),
      Math.round(Math.sin(mid) * gap),
    ];
    return { side, sector, dx: dx * side, dy };
  }),
);

/** Which of the axe's shards covers a world pixel, or −1. */
function shardAt(x: number, y: number): number {
  for (let s = 0; s < SHARDS.length; s++) {
    const { side, sector, dx, dy } = SHARDS[s]!;
    const [u, v] = [(x + 0.5 - AXE_X - dx) * side, y + 0.5 - AXE_Y - dy];
    if (!bit(u, v)) continue;
    const [angle, d] = [Math.atan2(v, u), Math.hypot(u, v)];
    let [k, crack] = [0, false];
    for (const at of CRACKS) {
      const jag = at + (hash(Math.floor(d), Math.round(at * 100)) - 0.5) * 0.2;
      if (Math.abs(angle - jag) * d < 0.6) crack = true;
      if (angle > jag) k++;
    }
    if (!crack && k === sector) return s;
  }
  return -1;
}

/** Whether a world pixel lies where the axe's head was when it was whole. */
const whole = (x: number, y: number) => {
  const [u, v] = [x + 0.5 - AXE_X, y + 0.5 - AXE_Y];
  return bit(u, v) || bit(-u, v);
};

/**
 * The fractures, which glow: where the whole head was and no shard is now, as runs along a row (from, to, the row)
 * with how far out from the haft they lie in steps of 4 px, which times their pulse; then the haft's break, and a
 * shard fallen onto the plinth.
 */
export const GLOW_RUNS: readonly (readonly [number, number, number, number])[] =
  (() => {
    const runs: [number, number, number, number][] = [];
    const add = (x: number, y: number) => {
      const ring = Math.floor(Math.abs(x + 0.5 - AXE_X) / 4);
      const last = runs.at(-1);
      if (last && last[1] === x && last[2] === y && last[3] === ring) last[1]++;
      else runs.push([x, x + 1, y, ring]);
    };
    for (let y = AXE_Y - 16; y < AXE_Y + 16; y++)
      for (let x = AXE_X - 18; x < AXE_X + 18; x++)
        if (whole(x, y) && shardAt(x, y) < 0) add(x, y);
    for (let y = 71; y < 73; y++)
      for (let x = AXE_X - 1; x < AXE_X + 2; x++) add(x, y);
    for (let j = 0; j < 3; j++)
      runs.push([AXE_X + 4 + j, AXE_X + 9 - j, 91 - j, 5]);
    return runs;
  })();

const VELVET = [0x12040a, 0x1e060e, 0x2e0a10, 0x4a1214, 0x6a2016];
const STEEL = [0x4a3634, 0x6a504a, 0x8e7062, 0xb89880];

/**
 * The Ember Axe on the throne room's wall: a dark velvet panel warmed about the head, a plinth, the haft broken in two
 * and the head burst into shards, honed edges bright, the fractures between them dimly aglow until `shards` lights them.
 */
function axe(r: Raster) {
  for (let y = 26; y < 94; y++)
    for (let x = AXE_X - 20; x < AXE_X + 20; x++) {
      const a = Math.abs(x + 0.5 - AXE_X);
      if (y < 26 + a * 0.5 || a >= 20) continue;
      const glow = Math.max(0, 1 - Math.hypot(a, (y - AXE_Y) * 1.3) / 26);
      const edge = a > 18.5 || y < 27.5 + a * 0.5 || y === 93;
      r.px(x, y, edge ? GOLD[0]! : dither(VELVET, 0.15 + glow * 0.8, x, y));
    }
  for (let y = 30; y < 98; y++) {
    const x = AXE_X - 1 + (y > 72 ? 1 : 0);
    const band = y < 34 || y % 10 === 0 || (y > 44 && y < 60);
    r.px(x, y, band ? IRON_LIT : WOOD[1]!);
    r.px(x + 1, y, band ? IRON : WOOD[0]!);
  }
  for (let y = AXE_Y - 16; y < AXE_Y + 16; y++)
    for (let x = AXE_X - 20; x < AXE_X + 20; x++) {
      const s = shardAt(x, y);
      if (s < 0) continue;
      const u = Math.abs(x + 0.5 - AXE_X);
      const out = (y: number, x: number) => shardAt(x, y) < 0 && !whole(x, y);
      let c = dither(STEEL, (u - 1.5) / 14, x, y);
      if (shardAt(x + 2 * Math.sign(x + 0.5 - AXE_X), y) < 0 && u > 8)
        c = 0xe0c8a4;
      if (out(y - 1, x) || out(y + 1, x) || out(y, x - 1) || out(y, x + 1))
        c = 0x1a1012;
      r.px(x, y, c);
    }
  for (const [x0, x1, y] of GLOW_RUNS) r.rect(x0, y, x1 - x0, 1, 0x4e1a10);
  solid(
    r,
    [AXE_X - 12, 92, AXE_X + 12, KERB],
    (x, y) => y >= 92 && y < KERB && Math.abs(x + 0.5 - AXE_X) < 11,
    SLAB,
  );
  for (const [x0, x1, y] of GLOW_RUNS.slice(-3))
    r.rect(x0, y, x1 - x0, 1, 0x4e1a10);
}

/** The throne room: red-lit walls from its arch, a lancet, the rose window, banners, the dais, throne and axe. */
function room(r: Raster) {
  for (let x = ROOM_X; x < r.width; x++)
    for (let y = 0; y < KERB; y++) {
      const tone = masonry(x, y, 16, 9, 77);
      const lit =
        warmth([[THRONE_X, ROSE_Y, 150]], x, y, 1.3) * 0.55 +
        warmth(LIGHTS, x, y) * 0.4;
      const t = tone < 0 ? lit * 0.4 : 0.08 + tone * 0.25 + lit;
      r.px(x, y, dither(RED_LIT, t, x, y));
    }
  pier(r, ROOM_X + 14, 14);
  // A lancet of red glass, leaded in diamonds.
  const glass: Lancet = [32, 88, 8];
  for (let y = 26; y < 92; y++)
    for (let x = ROOM_X + 40; x < ROOM_X + 64; x++) {
      const a = Math.abs(x + 0.5 - ROOM_X - 52);
      if (!lancet(a, y, glass, 2)) continue;
      const t = 0.25 + (y - 32) / 110 + hash(x >> 1, y >> 1) * 0.2;
      const lead = (x + y) % 5 === 0 || (x - y + 200) % 5 === 0 || a < 1;
      let c = lead ? 0x1c080c : dither(GLASS, t, x, y);
      if (!lancet(a, y, glass)) c = lancet(a, y, glass, 1) ? 0x4e1e1d : INK;
      r.px(x, y, c);
    }
  rose(r);
  for (const side of [-1, 1])
    banner(r, [THRONE_X + side * 60, 28, 56, 10], RED, GOLD);
  throne(r);
  axe(r);
}

/** The fires' light on the floor: a pool spreading from the kerb under each. */
const POOLS = LIGHTS.map(([x, , reach]): Light => [x, FLOOR, reach]);
const pool = (x: number, y: number) => warmth(POOLS, x, y, 2.2);

/** A colour `t` of the way from `a` to `b`. */
function mix(a: number, b: number, t: number) {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const [p, q] = [(a >> shift) & 255, (b >> shift) & 255];
    out |= Math.round(p + (q - p) * t) << shift;
  }
  return out;
}

/** The flagstones' width: square-set in rows that deepen towards the viewer, dark and darker in turn. */
const FLAG_W = 32;

/** Polished flagstones in a chequer, a sheen along each one's far edge, warmed under the fires, red before the throne. */
function flags(r: Raster) {
  for (let y0 = FLOOR, k = 0; y0 < VIEW_H; k++) {
    const y1 = Math.min(y0 + 6 + k, VIEW_H);
    for (let y = y0; y < y1; y++)
      for (let x = 0; x < r.width; x++) {
        const n = Math.floor(x / FLAG_W);
        const tone = ((n + k) % 2 ? 0.33 : 0.12) + hash(n, k) * 0.06;
        let c = dither(FLAGS, tone + pool(x, y) * 0.7, x, y);
        if (y === y0 + 1 && (n + k) % 2) c = FLAGS[4]!;
        if (y === y0 || x % FLAG_W === 0) c = y === y0 ? FLAGS[0]! : FLAGS[1]!;
        const red = 1 - Math.hypot((x - THRONE_X) / 150, (y - FLOOR) / 46);
        if (red > 0) c = mix(c, 0x5a0e16, red * 0.5);
        r.px(x, y, c);
      }
    y0 = y1;
  }
}

/** The polish: what stands above the floor mirrored in it, half bright and fading with depth, and each fire's streak. */
function polish(r: Raster) {
  for (let d = 0; d < 30; d++)
    for (let x = 0; x < r.width; x++) {
      const [y, src] = [FLOOR + d, rgbAt(r, x, FLOOR - 1 - d)];
      if (src < 0 || bayer(x, y) >= 0.8 - d * 0.03) continue;
      const under = rgbAt(r, x, y);
      r.px(x, y, ((src >> 1) & 0x7f7f7f) + ((under >> 1) & 0x7f7f7f));
    }
  for (const [x0, w, base] of FIRES) {
    const [x, end] = [x0 + (w >> 1), 2 * FLOOR - base + 4];
    for (let y = FLOOR + 2; y < end; y++)
      for (let i = -2; i <= 2; i++) {
        const t = (y - FLOOR) / (end - FLOOR);
        if (bayer(x + i, y) < (0.1 + 0.55 * t) * (1 - Math.abs(i) * 0.3))
          r.px(x + i, y, t > 0.85 && Math.abs(i) < 2 ? 0x8a5030 : 0x4a2c22);
      }
  }
}

/** The red carpet along the hall, gold-edged and figured with lozenges, and the runner from it up to the dais. */
function carpet(r: Raster) {
  const [top, bottom] = CARPET;
  for (let y = FLOOR; y < top; y++)
    for (let x = THRONE_X - 10; x < THRONE_X + 10; x++) {
      const a = Math.abs(x + 0.5 - THRONE_X);
      r.px(x, y, a > 9 ? GOLD[0]! : a > 8 ? GOLD[1]! : dither(RED, 0.4, x, y));
    }
  for (let x = 0; x < r.width; x++) {
    const glow = pool(x, FLOOR + 10);
    for (let y = top; y < bottom; y++) {
      const v = y - top;
      const lozenge = Math.abs(((x + 8) % 16) - 7.5) + Math.abs(v - 5.5);
      let c = dither(RED, 0.3 + glow * 0.6 - (v === 2 ? 0.25 : 0), x, y);
      if (lozenge < 1.5) c = GOLD[1]!;
      else if (Math.abs(lozenge - 3.5) < 0.5) c = RED[0]!;
      if (v === 1 || v === bottom - top - 2) c = x % 4 ? GOLD[1]! : GOLD[2]!;
      if (v === 0 || v === bottom - top - 1) c = GOLD[0]!;
      r.px(x, y, c);
    }
    r.px(x, bottom, FLAGS[0]!);
  }
}

/**
 * The crypt slabs the bonewalkers claw out of, as pairs of their world x and the floor row they lie on: the engine's
 * (`STAGE_4.graves`, `gravesPx`), where a bonewalker rising from one stands.
 */
export const SLABS = gravesPx(4).flat();

/** An opened crypt slab: the pit in its stone frame, the lid shoved aside and cracked, a bone beside it. */
function slab(r: Raster, x: number, y: number) {
  for (let j = -7; j <= 3; j++)
    for (let i = -14; i < 14; i++) {
      const rim = j === -7 || j === 3 || i === -14 || i === 13;
      let c = rim ? (j === -7 ? SLAB[3] : SLAB[2]) : VOID;
      if (j === -6 || (rim && j === 3)) c = INK;
      else if (!rim && j < -2)
        c = dither([VOID, SLAB[1], SLAB[2]], (-3 - j) / 3, x + i, y + j);
      r.px(x + i, y + j, c);
    }
  const lid: Inside = (px, py) => {
    const u = px - x - 14;
    const v = py - (y - 6) - Math.floor(u / 6);
    return u >= 0 && u < 24 && v >= 0 && v < 9;
  };
  solid(r, [x + 13, y - 7, x + 39, y + 8], lid, SLAB);
  sigil(r, x + 26, y - 4, SLAB[1]);
  for (let j = 0; j < 7; j++)
    r.px(x + 21 + (j >> 1), y - 5 + j + (j >> 2), INK);
  r.rect(x - 9, y + 5, 4, 1, BONE[1]!);
}

/** The road at the floor's speed: piers, braziers, the kerb, the throne room, then the floor and all on it. */
function hall(r: Raster) {
  for (const x of PIERS) pier(r, x, 11);
  room(r);
  kerb(r);
  dais(r);
  for (const x of BRAZIERS) brazier(r, x);
  flags(r);
  polish(r);
  carpet(r);
  for (let i = 0; i < SLABS.length; i += 2) slab(r, SLABS[i]!, SLABS[i + 1]!);
}

/** Bases of the pillars nearest the viewer, passing faster than the floor, with chains draped from some. */
function bases(r: Raster) {
  for (let x = 120, n = 0; x < r.width + 40; n++) {
    // A plinth, a torus, a hollow and a fillet, then the fluted shaft: round, lit warm along its left by the fires.
    for (let y = VIEW_H - 16; y < VIEW_H; y++) {
      const v = VIEW_H - 1 - y;
      const half = [20, 20, 20, 20, 17, 18, 17, 15, 16][v] ?? 14;
      for (let px = x - half; px < x + half; px++) {
        const s = (px + 0.5 - x) / half;
        let t = 0.45 - s * 0.35 - s * s * 0.3;
        if (v === 3 || v === 6 || v === 8) t += 0.3;
        if (v === 7 || (v > 8 && (px - x) % 4 === 0)) t -= 0.25;
        let c = dither(FRONT, t, px, y);
        if (s < -0.8) c = FRONT_WARM;
        if (Math.abs(s) > 0.94) c = INK;
        r.px(px, y, c);
      }
    }
    if (hash(n, 400) > 0.35) {
      const len = 30 + Math.floor(hash(n, 401) * 20);
      for (let s = 0; s < len + 8; s++) {
        const t = Math.min(1, s / len);
        const y = VIEW_H - 12 + Math.round(10 * (1 - (1 - t) ** 2));
        r.px(x + 14 + s, y, s % 3 === 2 ? IRON_WARM : IRON);
        if (s % 4 === 1) r.px(x + 14 + s, y - 1, IRON_LIT);
      }
    }
    x += 230 + Math.floor(hash(n, 402) * 140);
  }
}

/** A fire: its left column, width, base row, tallest flame and seed. */
type Fire = readonly [number, number, number, number, number];

/** The torches' flames, then the braziers'. */
export const FIRES: readonly Fire[] = [
  ...TORCHES.map((x, i): Fire => [x - 2, 5, TORCH_Y - 1, 12, i]),
  ...BRAZIERS.map((x, i): Fire => [x - 5, 11, BOWL_Y - 2, 14, 20 + i]),
];

const tone = (j: number, h: number, env: number) =>
  Math.min(3, Math.floor((j / h) * 3.2 + (1 - env) * 1.6));

/** One row of world pixels from `x0` to `x1`, clipped to the screen at camera `cam`. */
function run(brush: Brush, x0: number, x1: number, y: number, cam: number) {
  const [from, to] = [Math.max(x0 - cam, 0), Math.min(x1 - cam, VIEW_W)];
  if (to > from) brush.fillRect(from, y, to - from, 1);
}

function burn(brush: Brush, fire: Fire, cam: number, t: number) {
  const [x0, w, base, height, seed] = fire;
  if (x0 + w + 16 < cam || x0 - 16 >= cam + VIEW_W) return;
  for (let i = 0; i < w; i++) {
    const env = Math.sin((Math.PI * (i + 0.5)) / w);
    const lick = 0.3 * Math.sin((x0 + i) * 0.9 + seed + t * 11);
    const sway = 0.2 * Math.sin((x0 + i) * 0.37 + seed * 2 - t * 7);
    const h = Math.max(1, Math.round(height * env * (0.55 + lick + sway)));
    for (let j = 0; j < h;) {
      const c = tone(j, h, env);
      let k = j + 1;
      while (k < h && tone(k, h, env) === c) k++;
      brush.fillStyle = FLAME[c]!;
      const x = x0 + i - cam;
      if (x >= 0 && x < VIEW_W) brush.fillRect(x, base - k + 1, 1, k - j);
      j = k;
    }
  }
  for (let i = 0; i < 3; i++) {
    const life = (t * (0.3 + hash(i, seed) * 0.3) + hash(i, seed + 1)) % 1;
    const drift = (hash(i, seed + 2) - 0.5) * w + Math.sin(life * 7 + i) * 3;
    const x = Math.round(x0 + w / 2 + drift);
    brush.fillStyle = FLAME[1 + Math.min(2, Math.floor(life * 3))]!;
    run(brush, x, x + 1, Math.round(base - height * 0.6 - life * 30), cam);
  }
}

/**
 * The first of the world-fixed, screen-wide tiles a pattern repeats in that can reach the screen: the one `margin` left
 * of it. The tiles run on from there while they begin before the screen's right edge.
 */
const firstTile = (cam: number, margin: number) =>
  Math.floor((cam - margin) / VIEW_W);

/** Embers drifting up through the halls, swaying, cooling from gold to dark red as they rise. */
function embers(brush: Brush, cam: number, t: number) {
  for (let k = firstTile(cam, 18); k * VIEW_W < cam + VIEW_W; k++)
    for (let i = 0; i < 7; i++) {
      const seed = k * 7 + i;
      const life = (t / (5 + hash(seed, 140) * 4) + hash(seed, 141)) % 1;
      const sway = Math.round((Math.sin(life * 9 + seed) + 1) * 3 + life * 10);
      const x = k * VIEW_W + Math.floor(hash(seed, 142) * VIEW_W) + sway;
      const y = Math.round(KERB - 4 - life * 66 - hash(seed, 143) * 10);
      brush.fillStyle = EMBER[Math.min(2, Math.floor(life * 3))]!;
      run(brush, x, x + 1, y, cam);
    }
}

/** The broken axe's fractures glowing and dimming slowly, the glow running out from the haft to the edges. */
function shards(brush: Brush, cam: number, t: number) {
  if (AXE_X + 24 < cam || AXE_X - 24 >= cam + VIEW_W) return;
  for (const [x0, x1, y, s] of GLOW_RUNS) {
    const pulse = Math.sin(t * 1.6 - s * 0.6) * 0.5 + 0.5;
    brush.fillStyle = SHARD_GLOW[Math.min(3, Math.floor(pulse * 4))]!;
    run(brush, x0, x1, y, cam);
  }
}

export const VORHALS_KEEP: StageArt = {
  back: [
    { rate: [0, 1], top: 0, height: FLOOR, paint: sky },
    { rate: [1, 8], top: 0, height: FLOOR, paint: far },
    { rate: [1, 4], top: 0, height: FLOOR, paint: mid },
    { rate: [1, 1], top: 0, height: VIEW_H, paint: hall },
  ],
  front: { rate: [5, 4], top: VIEW_H - 16, height: 16, paint: bases },
  animate(brush, camX, frame) {
    const t = frame / 60;
    for (const fire of FIRES) burn(brush, fire, camX, t);
    shards(brush, camX, t);
    embers(brush, camX, t);
  },
};

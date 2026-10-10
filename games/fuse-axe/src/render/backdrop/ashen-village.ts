import {
  CAMERA_END_PX,
  FLOOR_TOP_PX,
  STAGE_LENGTH_PX,
  VIEW_H,
  VIEW_W,
} from "../../engine/view-kit.js";
import { dither, hash, Raster, type Brush, type StageArt } from "./kit.js";

/**
 * Stage 1, Ashen Village: a dusk road through burning thatched huts, after the key scene in `docs/concept-art.html`.
 * Far to near: the sky and low sun stand still, a ridge with Vorhal's keep drifts at 1/8 of the camera, the near hills
 * and their pines at 1/4, the village and its road at the floor's own speed, and grass in front of the heroes at 5/4.
 * The street is laid out once from a cosmetic hash, so every device draws the same village, and it ends at a
 * palisade gate in the last screen, where the boss waits. Only the fires move.
 */

const FLOOR = FLOOR_TOP_PX;
const SKY = [
  0x0d0718, 0x1a0e2e, 0x2c1846, 0x47265a, 0x6e3460, 0xa3444e, 0xd8623c,
  0xf69a46,
];
const HILLS = [0x5a2f5e, 0x3b1f4c, 0x271537, 0x1a0e28] as const;
const ROAD = [0x3a2232, 0x4c2b36, 0x5f363a, 0x74453e, 0x8a5642] as const;
const FLAME = ["#fff6b8", "#ffc22e", "#f86420", "#a82434"];
const INK = 0x150c1f;
const LOG = 0x4a2a2e;
const LOG_LIT = 0x6a4034;
const LOG_DARK = 0x2e1a26;
const RAIL = 0x5a3424;
const CAP = 0x8a5236;
const POST = 0x3c2226;
const GLOW = 0xffb030;
const STRAW = [0xe0a050, 0xb07836, 0x8a5a2c] as const;
/** Colours across one log or plank, left to right: lit by the fires on the left. */
const STAKE = [INK, LOG_LIT, LOG, LOG, LOG_DARK];

interface Hut {
  x: number;
  w: number;
  wall: number;
  roof: number;
  burn: number;
  /** The door's column from the hut's left wall; the window sits on the other side. */
  door: number;
}

/** The village wall runs from here to the stage end; its gate is the last screen's centrepiece. */
const WALL_X = STAGE_LENGTH_PX - 236;
const GATE_X = CAMERA_END_PX + 172;
const TOWERS = [GATE_X - 36, GATE_X + 36] as const;
const TORCH_Y = FLOOR - 37;

/** Huts with fences, pines and clutter between them, from the start of the road to the wall. */
function layout() {
  const huts: Hut[] = [];
  const fences: [number, number][] = [];
  const pines: [number, number][] = [];
  const props: [number, number][] = [];
  let x = 6;
  for (let n = 0; ; n++) {
    const w = 40 + Math.floor(hash(n, 1) * 20);
    if (x + w > WALL_X - 12) break;
    const door = Math.round(w * (hash(n, 2) > 0.5 ? 0.62 : 0.18));
    const wall = 14 + Math.floor(hash(n, 3) * 5);
    const roof = 20 + Math.floor(hash(n, 4) * 9);
    huts.push({ x, w, wall, roof, burn: 0.45 + hash(n, 5) * 0.55, door });
    x += w + 6;
    const gap = 36 + Math.floor(hash(n, 6) * 56);
    fences.push([x, Math.min(x + gap, WALL_X) - 4]);
    if (hash(n, 7) > 0.3)
      pines.push([
        x + 6 + Math.floor(hash(n, 8) * (gap - 12)),
        26 + Math.floor(hash(n, 9) * 14),
      ]);
    if (hash(n, 10) > 0.2)
      props.push([
        x + 7 + Math.floor(hash(n, 11) * (gap - 30)),
        Math.floor(hash(n, 12) * 3),
      ]);
    x += gap;
  }
  fences.push([x, WALL_X]);
  return { huts, fences, pines, props };
}

const { huts: HUTS, fences: FENCES, pines: PINES, props: PROPS } = layout();

function roofTop(h: Hut, x: number) {
  const slope = 1 - Math.abs(x - h.x - h.w / 2) / (h.w / 2 + 5);
  return FLOOR - h.wall - Math.round(h.roof * Math.max(0, slope));
}

interface Fire {
  x0: number;
  /** The flame's base row for each column from `x0`. */
  rows: number[];
  height: number;
  seed: number;
  /** Where embers rise from, and how wide they scatter. */
  cx: number;
  top: number;
  spread: number;
  embers: number;
}

const FIRES: Fire[] = HUTS.map((h, i): Fire => {
  const c = h.x + h.w / 2;
  const span = Math.round((h.w / 2 + 4) * h.burn);
  const x0 = Math.round(c - span);
  const rows = Array.from(
    { length: Math.round(c + span * 0.8) - x0 + 1 },
    (_, k) => roofTop(h, x0 + k) + 2,
  );
  const top = FLOOR - h.wall - h.roof;
  return {
    x0,
    rows,
    height: 16 * h.burn + 6,
    seed: i * 5,
    cx: Math.round(c),
    top,
    spread: 30,
    embers: 14,
  };
}).concat(
  TOWERS.map((x, i) => {
    const rows = [TORCH_Y, TORCH_Y, TORCH_Y, TORCH_Y, TORCH_Y];
    return {
      x0: x - 2,
      rows,
      height: 9,
      seed: 90 + i * 5,
      cx: x,
      top: TORCH_Y - 6,
      spread: 6,
      embers: 4,
    };
  }),
);

/** Firelight on the road, from each hut and torch out to its reach. */
const LIGHTS = [
  ...HUTS.map((h) => ({ x: h.x + h.w / 2, reach: 50 + 50 * h.burn })),
  ...TOWERS.map((x) => ({ x, reach: 34 })),
];

function sky(r: Raster) {
  for (let y = 0; y < FLOOR; y++)
    for (let x = 0; x < r.width; x++)
      r.px(x, y, dither(SKY, (y - 18) / 84, x, y));
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(hash(i, 1) * r.width);
    r.px(
      x,
      21 + Math.floor(hash(i, 2) * 30),
      i % 5 === 0 ? 0xc9b8ff : 0x5a3a7a,
    );
  }
  // A low sun cut by the bands of a synthwave dusk.
  for (let y = 66; y < FLOOR; y++)
    for (let x = 40; x < 110; x++) {
      const d = Math.hypot(x - 76, y - 90);
      if (d >= 21 || (y > 82 && (y - 82) % 4 < (y - 82) / 6)) continue;
      r.px(x, y, d >= 19 ? 0xff8a4a : y < 84 ? 0xffe9a0 : 0xffbe58);
    }
}

/** Vorhal's keep on the horizon: it rises into view mid-stage and stands over the palisade at the end. */
const KEEP = [
  [352, 57, 6],
  [360, 52, 5],
  [367, 60, 9],
  [378, 55, 5],
  [384, 63, 8],
] as const;

function ridge(r: Raster) {
  for (let x = 0; x < r.width; x++) {
    const wave = 9 * Math.sin(x * 0.028 + 1.2) + 5 * Math.sin(x * 0.083 + 2);
    const top = Math.round(80 + wave + 2 * Math.sin(x * 0.21));
    r.rect(x, top + 1, 1, FLOOR - top - 1, HILLS[1]);
    r.px(x, top, HILLS[0]);
  }
  for (const [x0, y0, w] of KEEP) {
    r.rect(x0, y0, w, 90 - y0, HILLS[2]);
    for (let x = x0; x < x0 + w; x += 2) r.px(x, y0 - 1, HILLS[2]);
    r.px(x0 + (w >> 1), y0 + 6, 0xf86420);
  }
}

function hills(r: Raster) {
  for (let x = 0; x < r.width; x++) {
    const wave = 3 * Math.sin(x * 0.045 + 0.3) + 2 * Math.sin(x * 0.13 + 1);
    const top = Math.round(97 + wave);
    r.rect(x, top, 1, FLOOR - top, HILLS[2]);
  }
  // A dark line of pines along the hills, in clumps.
  for (let x = 4, n = 0; x < r.width; n++) {
    const th = 13 + Math.floor(hash(n, 3) * 10);
    for (let j = 0; j < th; j++) {
      const w = Math.floor((j % 6) * 0.6 + j * 0.22);
      r.rect(x - w, FLOOR - th + j - 4, 2 * w + 1, 1, HILLS[3]);
    }
    const clump = hash(n, 4) > 0.6;
    x += clump
      ? 22 + Math.floor(hash(n, 5) * 60)
      : 6 + Math.floor(hash(n, 6) * 6);
  }
}

function pine(r: Raster, cx: number, th: number) {
  r.rect(cx - 1, FLOOR - 3, 2, 3, LOG_DARK);
  for (let j = 0; j < th; j++) {
    const w = Math.floor((j % 7) * 0.7 + j * 0.24);
    r.rect(cx - w, FLOOR - 3 - th + j, 2 * w + 1, 1, HILLS[3]);
    r.px(cx - w, FLOOR - 3 - th + j, HILLS[1]);
  }
}

function fence(r: Raster, a: number, b: number) {
  r.rect(a, FLOOR - 7, b - a, 1, RAIL);
  r.rect(a, FLOOR - 4, b - a, 1, 0x4a2a26);
  for (let x = a + 2; x < b; x += 7) {
    r.rect(x, FLOOR - 9, 1, 9, POST);
    r.px(x, FLOOR - 10, CAP);
  }
}

/** Upright planks or logs from `top` down to the floor: `cycle` repeats across, the outer columns inked. */
function planks(
  r: Raster,
  x0: number,
  w: number,
  top: number,
  cycle: readonly number[],
) {
  for (let x = x0; x < x0 + w; x++) {
    const edge = x === x0 || x === x0 + w - 1;
    r.rect(
      x,
      top,
      1,
      FLOOR - top,
      edge ? INK : cycle[(x - x0) % cycle.length]!,
    );
  }
}

function hut(r: Raster, h: Hut) {
  const top = FLOOR - h.wall;
  planks(r, h.x, h.w, top, [LOG_DARK, 0x54303a, 0x54303a, 0x4a2a34, 0x43262f]);
  // The fire inside shows through the door and a window.
  const dx = h.x + h.door;
  r.rect(dx, FLOOR - 11, 7, 11, 0xa82434);
  r.rect(dx + 1, FLOOR - 9, 5, 9, 0xffc22e);
  r.rect(dx, FLOOR - 11, 7, 2, 0xf86420);
  const wx = h.door > h.w / 2 ? h.x + 6 : h.x + h.w - 12;
  r.rect(wx, FLOOR - 12, 6, 5, INK);
  r.rect(wx + 1, FLOOR - 11, 5, 4, GLOW);
  for (let x = h.x - 5; x <= h.x + h.w + 5; x++) {
    const ty = roofTop(h, x);
    for (let y = ty; y <= top + 2; y++) {
      let c: number = x < h.x + h.w / 2 ? STRAW[1] : STRAW[2];
      if (y - ty < 3 && hash(x, y) > 0.4) c = STRAW[0];
      if (y === top + 1 || (x * 2 + y * 3) % 7 === 0) c = RAIL;
      if (y === ty || y === top + 2) c = INK;
      r.px(x, y, c);
    }
  }
}

/** Pointed stakes from the wall to the stage end, with the gate and its towers left open. */
function palisade(r: Raster) {
  for (let x = WALL_X; x < STAGE_LENGTH_PX; x += 5) {
    if (x + 5 > TOWERS[0] - 9 && x < TOWERS[1] + 9) continue;
    const top = FLOOR - 32 - Math.floor(hash(x, 7) * 7);
    for (let y = top; y < FLOOR; y++)
      for (let i = 0; i < 5; i++) {
        const tip = Math.abs(i - 2);
        if (tip <= y - top) r.px(x + i, y, tip === y - top ? INK : STAKE[i]!);
      }
  }
  for (const y of [FLOOR - 26, FLOOR - 12]) {
    r.rect(WALL_X, y, STAGE_LENGTH_PX - WALL_X, 1, RAIL);
    r.rect(WALL_X, y + 1, STAGE_LENGTH_PX - WALL_X, 1, LOG_DARK);
  }
}

const SKULL = ["x....x", "xxxxxx", "x.xx.x", "xxxxxx", ".x..x."];

/** The closed gate under Vorhal's banner. */
function gate(r: Raster) {
  const left = TOWERS[0] + 9;
  const top = FLOOR - 44;
  planks(
    r,
    left,
    TOWERS[1] - 9 - left,
    top,
    [0x1f1222, 0x54303a, 0x43262f, 0x43262f, 0x43262f],
  );
  r.rect(GATE_X - 1, top, 2, FLOOR - top, INK);
  for (const y of [top + 8, FLOOR - 12]) {
    r.rect(left, y, TOWERS[1] - 9 - left, 3, HILLS[2]);
    for (let x = left + 2; x < TOWERS[1] - 9; x += 6) r.px(x, y + 1, 0x8a7a9a);
  }
  r.rect(TOWERS[0] - 4, top - 6, TOWERS[1] - TOWERS[0] + 8, 6, LOG_DARK);
  r.rect(TOWERS[0] - 4, top - 6, TOWERS[1] - TOWERS[0] + 8, 1, CAP);
  for (let y = top; y < top + 20; y++)
    for (let x = GATE_X - 7; x < GATE_X + 7; x++) {
      if (y > top + 15 && Math.abs(x + 0.5 - GATE_X) < (y - top - 15) * 2)
        continue;
      const rim = x === GATE_X - 7 || x === GATE_X + 6;
      r.px(x, y, rim ? 0x3a0f24 : x < GATE_X ? 0xa82434 : 0x7a1a30);
    }
  SKULL.forEach((row, j) =>
    [...row].forEach((c, i) => {
      if (c === "x") r.px(GATE_X - 3 + i, top + 5 + j, 0xe8d8c8);
    }),
  );
}

function tower(r: Raster, cx: number) {
  const top = FLOOR - 54;
  planks(r, cx - 8, 17, top, [LOG_DARK, LOG_LIT, LOG, LOG]);
  for (const y of [top + 6, FLOOR - 20]) r.rect(cx - 8, y, 17, 2, HILLS[2]);
  r.rect(cx - 7, top - 12, 15, 9, HILLS[2]);
  r.rect(cx - 2, top - 10, 5, 4, GLOW);
  r.rect(cx - 9, top - 12, 2, 9, POST);
  r.rect(cx + 8, top - 12, 2, 9, POST);
  r.rect(cx - 11, top - 3, 23, 3, LOG_DARK);
  r.rect(cx - 11, top - 3, 23, 1, CAP);
  for (let j = 0; j < 10; j++) {
    const w = 2 + Math.round(j * 1.2);
    const straw = j % 3 === 0 ? STRAW[2] : STRAW[1];
    r.rect(cx - w, top - 22 + j, 2 * w + 1, 1, j === 9 ? INK : straw);
    r.px(cx - w, top - 22 + j, INK);
    r.px(cx + w, top - 22 + j, INK);
  }
  r.rect(cx - 1, TORCH_Y + 1, 2, 5, RAIL);
}

/** A mound of straw `w` wide either side of `cx`, its base on row `base`. */
function hay(r: Raster, cx: number, base: number, w: number, h: number) {
  for (let j = 0; j < h; j++) {
    const half = Math.round(Math.sqrt(1 - (j / (h + 0.5)) ** 2) * w);
    for (let i = -half; i <= half; i++) {
      let c: number = i < 0 ? STRAW[0] : STRAW[1];
      if ((i + j * 2) % 5 === 0) c = STRAW[2];
      if (Math.abs(i) === half || j === h - 1) c = INK;
      r.px(cx + i, base - j, c);
    }
  }
}

/** Clutter along the back of the road: barrels, a haystack or a hay cart. */
function prop(r: Raster, x: number, kind: number) {
  if (kind === 0) {
    for (const [bx, bh] of [
      [0, 9],
      [7, 8],
    ] as const) {
      planks(r, x + bx, 6, FLOOR - bh, [INK, CAP, RAIL, RAIL, RAIL]);
      r.rect(x + bx, FLOOR - bh, 6, 1, INK);
      r.rect(x + bx + 1, FLOOR - bh + 2, 4, 1, LOG_DARK);
      r.rect(x + bx + 1, FLOOR - 3, 4, 1, LOG_DARK);
    }
  } else if (kind === 1) hay(r, x + 9, FLOOR - 1, 9, 9);
  else {
    hay(r, x + 8, FLOOR - 10, 8, 5);
    for (let k = 0; k < 7; k++) r.px(x - k, FLOOR - 9 + k, RAIL);
    r.rect(x, FLOOR - 10, 17, 3, RAIL);
    r.rect(x, FLOOR - 7, 17, 1, INK);
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.hypot(dx, dy);
        if (d < 1.2 || (d > 2.8 && d < 4.3))
          r.px(x + 11 + dx, FLOOR - 4 + dy, d < 1.2 ? CAP : POST);
      }
  }
}

function road(r: Raster) {
  for (let x = 0; x < r.width; x++) {
    let near = Infinity;
    for (const light of LIGHTS)
      near = Math.min(near, Math.abs(x - light.x) / light.reach);
    for (let y = FLOOR; y < VIEW_H; y++) {
      const lit = Math.max(0, 1 - Math.hypot(near, (y - FLOOR) / 30)) * 0.42;
      const depth = (y - FLOOR) / (VIEW_H - FLOOR);
      r.px(x, y, dither(ROAD, depth * 0.75 + lit, x, y));
    }
    r.px(x, FLOOR, 0x241626);
    r.px(x, FLOOR + 1, (x * 7) % 5 === 0 ? 0x3d2a3a : 0x2e1c2c);
    if (hash(x, 60) > 0.7) r.px(x, FLOOR - 1, 0x2e1c2c);
    for (const ry of [139, 163]) {
      const y = ry + Math.round(2 * Math.sin(x * 0.035 + ry));
      r.px(x, y, ROAD[0]);
      if (x % 3 !== 0) r.px(x, y + 1, ROAD[3]);
    }
  }
  for (let i = 0; i < Math.floor((70 * r.width) / VIEW_W); i++) {
    const x = Math.floor(hash(i, 61) * r.width);
    const y = FLOOR + 4 + Math.floor(hash(i, 62) * 62);
    r.px(x, y, ROAD[4]);
    if (hash(i, 63) > 0.6) {
      r.rect(x + 1, y, 1, 1, ROAD[3]);
      r.rect(x, y + 1, 2, 1, ROAD[1]);
    }
  }
  // Puddles catching the firelight.
  for (let k = 0; k < 4; k++) {
    const cx = 34 + k * 300 + Math.floor(hash(k, 64) * 120);
    const cy = 122 + Math.floor(hash(k, 65) * 40);
    for (let y = -2; y <= 2; y++)
      for (let x = -13; x <= 13; x++) {
        if ((x / 13) ** 2 + (y / 2.6) ** 2 > 1) continue;
        const shine = (x + k) & 1 ? 0xf69a46 : 0xd8623c;
        r.px(
          cx + x,
          cy + y,
          y === 0 && Math.abs(x) < 8 ? shine : y < 0 ? 0x47265a : 0x2c1846,
        );
      }
  }
}

function village(r: Raster) {
  for (const [x, th] of PINES) pine(r, x, th);
  for (const [a, b] of FENCES) fence(r, a, b);
  for (const h of HUTS) hut(r, h);
  palisade(r);
  gate(r);
  for (const x of TOWERS) tower(r, x);
  for (const [x, kind] of PROPS) prop(r, x, kind);
  road(r);
}

/** Tufts and the odd weed or stone along the front edge, passing a little faster than the floor. */
function grass(r: Raster) {
  for (let x = 0; x < r.width; x++) {
    if (hash(x, 40) > 0.7)
      for (let j = 0, n = 2 + Math.floor(hash(x, 41) * 4); j < n; j++)
        r.px(x + (j > 2 ? 1 : 0), VIEW_H - 1 - j, 0x1a0e1c);
    if (hash(x, 42) > 0.985)
      for (let j = 0, n = 7 + Math.floor(hash(x, 43) * 4); j < n; j++)
        r.px(
          x - (j > n / 2 ? 1 : 0) - (j === n - 1 ? 1 : 0),
          VIEW_H - 1 - j,
          0x1a0e1c,
        );
    if (hash(x, 44) > 0.993) {
      r.rect(x, VIEW_H - 3, 5, 3, 0x241626);
      r.rect(x + 1, VIEW_H - 3, 3, 1, 0x3d2a3a);
    }
  }
}

const tone = (j: number, h: number, env: number) =>
  Math.min(3, Math.floor((j / h) * 3.2 + (1 - env) * 1.6));

/** One fire's flames and embers, each flame column in a few solid runs. */
function burn(brush: Brush, fire: Fire, cam: number, t: number) {
  const span = fire.rows.length;
  const left = fire.x0 - cam;
  if (left + span + 40 < 0 || left - 40 >= VIEW_W) return;
  for (let i = 0; i < span; i++) {
    const x = left + i;
    if (x < 0 || x >= VIEW_W) continue;
    const wx = fire.x0 + i;
    const env = Math.sin((Math.PI * (i + 0.5)) / span);
    const lick = 0.25 * Math.sin(wx * 0.9 + fire.seed + t * 9);
    const sway = 0.2 * Math.sin(wx * 0.31 + fire.seed * 2 - t * 6);
    const h = Math.max(1, Math.round(fire.height * env * (0.55 + lick + sway)));
    const base = fire.rows[i]!;
    for (let j = 0; j < h;) {
      const c = tone(j, h, env);
      let k = j + 1;
      while (k < h && tone(k, h, env) === c) k++;
      brush.fillStyle = FLAME[c]!;
      brush.fillRect(x, base - k + 1, 1, k - j);
      j = k;
    }
    if (hash(wx + Math.floor(t * 8) * 13, fire.seed) > 0.8) {
      brush.fillStyle = FLAME[2 + (wx & 1)]!;
      brush.fillRect(x, base - h - 2, 1, 1);
    }
  }
  for (let i = 0; i < fire.embers; i++) {
    const rate = 0.25 + hash(i, fire.seed) * 0.3;
    const life = (t * rate + hash(i, fire.seed + 1)) % 1;
    const drift = (hash(i, fire.seed + 2) - 0.5) * fire.spread;
    const x =
      Math.round(fire.cx + drift + Math.sin(life * 9 + i) * 3 + life * 12) -
      cam;
    const y = Math.round(fire.top - life * 60);
    if (y <= 20 || x < 0 || x >= VIEW_W) continue;
    brush.fillStyle = FLAME[Math.min(3, Math.floor(life * 4))]!;
    brush.fillRect(x, y, 1, 1);
  }
}

export const ASHEN_VILLAGE: StageArt = {
  back: [
    { rate: [0, 1], top: 0, height: FLOOR, paint: sky },
    { rate: [1, 8], top: 48, height: FLOOR - 48, paint: ridge },
    { rate: [1, 4], top: 74, height: FLOOR - 74, paint: hills },
    { rate: [1, 1], top: 28, height: VIEW_H - 28, paint: village },
  ],
  front: { rate: [5, 4], top: VIEW_H - 12, height: 12, paint: grass },
  animate(brush, camX, frame) {
    const t = frame / 60;
    for (const fire of FIRES) burn(brush, fire, camX, t);
  },
};

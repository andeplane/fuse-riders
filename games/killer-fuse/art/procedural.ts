/**
 * Killer Fuse's hand-pixelled art: everything small or geometric enough that drawing it pixel by pixel beats
 * generating it (berries, the hive and its holes, eggs, tiles, the snail track, effects, lettering). Each function
 * returns finished pixels on the shared palette; `scripts/killer-fuse-art.ts` lays them out into sheets.
 */
import {
  CREAM,
  FROST,
  GOLD,
  ICE,
  INK,
  LIME,
  NAVY,
  VIOLET,
  WHITE,
  type Ramp,
} from "./assets.ts";
import {
  alpha,
  blit,
  fromRows,
  img,
  put,
  rect,
  rgbAt,
  type Img,
  type Rgb,
} from "./pixel.ts";

const [, , , VOID] = [0, 0, 0, NAVY.void];

// ---------------------------------------------------------------------------------------------------------------
// Primitives

const disc = (m: Img, cx: number, cy: number, r: number, c: Rgb) => {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) put(m, x, y, c);
};

const ring = (
  m: Img,
  cx: number,
  cy: number,
  r: number,
  c: Rgb,
  gapEvery = 0,
) => {
  const steps = Math.max(8, Math.round(r * 8));
  for (let i = 0; i < steps; i++) {
    if (gapEvery && Math.floor((i / steps) * gapEvery * 2) % 2) continue;
    const a = (i / steps) * Math.PI * 2;
    put(
      m,
      Math.round(cx + Math.cos(a) * r),
      Math.round(cy + Math.sin(a) * r),
      c,
    );
  }
};

/** A four-point sparkle of radius `r` (0 is a single pixel). */
const star = (
  m: Img,
  cx: number,
  cy: number,
  r: number,
  c: Rgb,
  core: Rgb = c,
) => {
  for (let i = -r; i <= r; i++) {
    put(m, cx + i, cy, c);
    put(m, cx, cy + i, c);
  }
  put(m, cx, cy, core);
};

/** Deterministic noise in [0, 1) from two integers. */
const hash = (a: number, b: number) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ---------------------------------------------------------------------------------------------------------------
// Berries

const BERRY_KEY: Record<string, Rgb> = {
  d: LIME[0],
  s: LIME[1],
  b: LIME[2],
  w: LIME[3],
  W: WHITE,
};

/** The berry, 6 by 6: on a pile and in a hive hole. */
export const berry = () =>
  fromRows(
    [".sbbb.", "sbwwbb", "sbwbbb", "sbbbbb", "dsbbbs", ".dsss."],
    BERRY_KEY,
  );

/** Two frames of a loose, kicked berry: the highlight turns as it rolls. */
export const berryLoose = () => [
  fromRows(
    [".sbbb.", "sbbbwb", "sbbbwb", "sbbbbb", "dsbbbs", ".dsss."],
    BERRY_KEY,
  ),
  fromRows(
    [".sbbb.", "sbbbbb", "sbbbbb", "sbbwwb", "dsbbbs", ".dsss."],
    BERRY_KEY,
  ),
];

/** The berry as a worker carries it: one pixel smaller, so it does not hide the head. */
export const berryCarried = () =>
  fromRows([".bbb.", "bwwbb", "sbbbb", "sbbbs", ".sss."], BERRY_KEY);

/** Where berries sit on a pile base, bottom row first, as top-left corners relative to the base sprite. */
export const PILE_SLOTS: readonly (readonly [number, number])[] = [
  [3, -5],
  [10, -5],
  [17, -5],
  [24, -5],
  [6, -10],
  [13, -10],
  [20, -10],
  [10, -15],
  [17, -15],
  [13, -20],
];

/** The bush a berry pile grows on: 33 by 8, berries stack above it at `PILE_SLOTS`. */
export const pileBase = () =>
  fromRows(
    [
      "..s...s.....s......s.....s...s...",
      ".sbs.sbs...sbs....sbs...sbs.sbs..",
      "sbbdsbbds.sbbds..sbbds.sbbdsbbds.",
      "dbddbbddssbbddssdbbddssbbddbbdds.",
      ".ddvddvvddddvvddddvvddddvvddvdd..",
      "..vVVVVVVVVVVVVVVVVVVVVVVVVVVv...",
      "...vvVVVVVVVVVVVVVVVVVVVVVVvv....",
      "....vvvvvvvvvvvvvvvvvvvvvvvv.....",
    ],
    { d: NAVY.slate, s: LIME[0], b: LIME[1], v: VIOLET[0], V: VIOLET[1] },
  );

// ---------------------------------------------------------------------------------------------------------------
// Hive

/** A pointy-top hexagon, 16 by 18. */
const HEX_W = 16;
const HEX_H = 18;
const hexStart = (y: number) => {
  const r = y < HEX_H / 2 ? y : HEX_H - 1 - y;
  return r >= 4 ? 0 : 7 - r * 2;
};
const inHex = (x: number, y: number) =>
  y >= 0 && y < HEX_H && x >= hexStart(y) && x < HEX_W - hexStart(y);
const hexWall = (x: number, y: number) =>
  inHex(x, y) &&
  !(inHex(x - 2, y) && inHex(x + 2, y) && inHex(x, y - 2) && inHex(x, y + 2));

/** Top-left corners of the six holes inside the 64 by 48 hive, top row first. */
export const HIVE_HOLES: readonly (readonly [number, number])[] = [
  [11, 7],
  [25, 7],
  [39, 7],
  [18, 21],
  [32, 21],
  [46, 21],
];

/** One hive hole, 16 by 18: an empty cell, or one with a banked berry glowing in it. */
export const hiveHole = (team: Ramp, filled: boolean): Img => {
  const m = img(HEX_W, HEX_H);
  for (let y = 0; y < HEX_H; y++)
    for (let x = 0; x < HEX_W; x++) {
      if (!inHex(x, y)) continue;
      if (hexWall(x, y))
        put(m, x, y, y < 5 ? team[3] : y > 12 ? team[1] : team[2]);
      else put(m, x, y, filled ? LIME[0] : y < 7 ? NAVY.void : NAVY.deep);
    }
  if (filled) {
    disc(m, 7.5, 8.5, 4.6, LIME[1]);
    disc(m, 7.5, 8.2, 3.9, LIME[2]);
    disc(m, 6.5, 6.8, 1.5, LIME[3]);
    put(m, 6, 6, WHITE);
  } else {
    // A faint rim of light at the bottom of the empty cell, so it reads as a hollow.
    for (let x = 5; x < 11; x++) put(m, x, 13, NAVY.night);
  }
  return m;
};

/** The hive, 64 by 48, with six empty holes at `HIVE_HOLES`. */
export const hive = (team: Ramp): Img => {
  const m = img(64, 48);
  const half = (y: number) => {
    // A beehive dome on a base plate.
    if (y >= 43) return 31;
    const t = (42 - y) / 42;
    return Math.round(30 * Math.sqrt(Math.max(0, 1 - t ** 2.8)));
  };
  for (let y = 1; y < 48; y++) {
    const hw = half(y);
    for (let x = 32 - hw; x < 32 + hw; x++) {
      if (y >= 43) {
        put(m, x, y, y === 43 ? team[2] : y === 47 ? NAVY.night : NAVY.steel);
        continue;
      }
      const band = (y - 2) % 9;
      const edge = x < 32 - hw + 2 || x >= 32 + hw - 2;
      let c: Rgb = band === 8 ? NAVY.night : band < 2 ? NAVY.steel : NAVY.slate;
      if (x - (32 - hw) < 6 && band !== 8) c = band < 2 ? FROST : NAVY.steel;
      if (edge) c = team[1];
      if (y === 1 || half(y - 1) <= 32 - x - 1 || half(y - 1) < x - 31)
        c = team[2];
      put(m, x, y, c);
    }
  }
  // The crown of the hive: a team lamp on a gold stud.
  rect(m, 30, 0, 4, 2, GOLD[2]);
  rect(m, 31, 0, 2, 1, GOLD[3]);
  // Team lamps on the base plate.
  for (let x = 6; x < 60; x += 8) rect(m, x, 45, 3, 1, team[2]);
  for (const [hx, hy] of HIVE_HOLES) blit(m, hiveHole(team, false), hx, hy);
  return m;
};

// ---------------------------------------------------------------------------------------------------------------
// Eggs (HUD)

export const egg = (team: Ramp, broken: boolean): Img => {
  const key: Record<string, Rgb> = {
    d: team[0],
    s: team[1],
    b: team[2],
    w: team[3],
    W: WHITE,
    n: NAVY.steel,
    N: NAVY.slate,
    k: FROST,
  };
  return broken
    ? fromRows(
        [
          "..........",
          "..........",
          "..........",
          "..........",
          "..........",
          ".k..k.k.k.",
          ".nknnknkn.",
          ".nnnnnnnN.",
          ".nnnnnnNN.",
          ".NnnnnNNN.",
          "..NNNNNN..",
          "...NNNN...",
        ],
        key,
      )
    : fromRows(
        [
          "....bb....",
          "...bbbb...",
          "..bwwbbb..",
          "..bwbbbb..",
          ".bbwbbbbs.",
          ".bbbbbbbs.",
          ".bbbbbbbs.",
          ".bbbbbbss.",
          ".sbbbbbss.",
          ".sbbbbssd.",
          "..sssssd..",
          "...dddd...",
        ],
        key,
      );
};

// ---------------------------------------------------------------------------------------------------------------
// Tiles (8 by 8)

const TILE_KEY: Record<string, Rgb> = {
  L: VIOLET[3],
  V: VIOLET[2],
  v: VIOLET[1],
  u: VIOLET[0],
  B: NAVY.slate,
  D: NAVY.dusk,
  N: NAVY.night,
  S: NAVY.steel,
  g: GOLD[2],
  G: GOLD[3],
  o: GOLD[1],
  c: FROST,
};

const BODY = [
  "BBBBBBBB",
  "BDDDBBBB",
  "DBBBDBBB",
  "BBBBBDDD",
  "BBBBBBBB",
  "BDDDBBBB",
  "DBBBDBBB",
  "BBBBBDDD",
];

const withRows = (base: readonly string[], rows: Record<number, string>) =>
  base.map((row, y) => rows[y] ?? row);

const columns = (base: readonly string[], cols: Record<number, string>) =>
  base.map((row, y) =>
    [...row]
      .map((ch, x) => (cols[x] && ch !== "." ? (cols[x]?.[y] ?? ch) : ch))
      .join(""),
  );

const TOP = withRows(BODY, { 0: "LLLLLLLL", 1: "VVVVVVVV", 2: "uuuuuuuu" });
const BOTTOM = withRows(BODY, { 6: "DDDDDDDD", 7: "NNNNNNNN" });
const LEFT = "SSSSSSSS";
const RIGHT = "NNNNNNNN";
const corner = (rows: string[], x: number, y: number) =>
  rows.map((row, j) =>
    j === y ? row.slice(0, x) + "." + row.slice(x + 1) : row,
  );

/** The tiles of the platform set by name; the sheet lays them out in this order, 8 by 8 each. */
export const TILES: Record<string, readonly string[]> = {
  topLeft: corner(columns(TOP, { 0: "LVvSSSSS" }), 0, 0),
  top: TOP,
  topRight: corner(columns(TOP, { 7: "LVuNNNNN" }), 7, 0),
  left: columns(BODY, { 0: LEFT }),
  middle: BODY,
  right: columns(BODY, { 7: RIGHT }),
  bottomLeft: corner(columns(BOTTOM, { 0: LEFT }), 0, 7),
  bottom: BOTTOM,
  bottomRight: corner(columns(BOTTOM, { 7: RIGHT }), 7, 7),
  // A one-tile-high slab: top and bottom in one.
  slabLeft: corner(
    corner(
      columns(withRows(TOP, { 6: "DDDDDDDD", 7: "NNNNNNNN" }), {
        0: "LVvSSSSN",
      }),
      0,
      0,
    ),
    0,
    7,
  ),
  slab: withRows(TOP, { 6: "DDDDDDDD", 7: "NNNNNNNN" }),
  slabRight: corner(
    corner(
      columns(withRows(TOP, { 6: "DDDDDDDD", 7: "NNNNNNNN" }), {
        7: "LVuNNNNN",
      }),
      7,
      0,
    ),
    7,
    7,
  ),
  // The thin one-way ledge: only its top four rows are drawn.
  ledgeLeft: [".LLLLLLL", "VVVVVVVV", ".uDuDuDu", "..N...N.", "", "", "", ""],
  ledge: ["LLLLLLLL", "VVVVVVVV", "DuDuDuDu", "..N...N.", "", "", "", ""],
  ledgeRight: ["LLLLLLL.", "VVVVVVVV", "DuDuDuD.", "..N...N.", "", "", "", ""],
  // Variety for long runs: a circuit node and a lit hex cell.
  middleNode: withRows(BODY, { 3: "BBoGoDDD", 4: "BBBoBBBB" }),
  middleCell: [
    "BBBBBBBB",
    "BBDDDDBB",
    "BDNNNNDB",
    "DNNNNNND",
    "DNNNNNND",
    "BDNNNNDB",
    "BBDDDDBB",
    "BBBBBBBB",
  ],
  topLamp: withRows(TOP, { 0: "LLLGGLLL", 1: "VVVggVVV", 2: "uuuoouuu" }),
  // The snail track: a platform top with gold running lights.
  track: withRows(BODY, { 0: "GGGGGGGG", 1: "ggoggogg", 2: "ouuuouuu" }),
  trackLeft: corner(
    columns(withRows(BODY, { 0: "GGGGGGGG", 1: "ggoggogg", 2: "ouuuouuu" }), {
      0: "GgoSSSSS",
    }),
    0,
    0,
  ),
  trackRight: corner(
    columns(withRows(BODY, { 0: "GGGGGGGG", 1: "ggoggogg", 2: "ouuuouuu" }), {
      7: "GgoNNNNN",
    }),
    7,
    0,
  ),
};

export const tile = (name: string): Img => {
  const rows = TILES[name];
  if (!rows) throw new Error(`no tile ${name}`);
  const m = img(8, 8);
  blit(m, fromRows(rows, TILE_KEY), 0, 0);
  return m;
};

/** A snail goal post in a team's colour, 16 by 40, standing on the track with its foot at the bottom centre. */
export const goalPost = (team: Ramp): Img => {
  const m = img(16, 40);
  // Pole.
  rect(m, 7, 10, 2, 30, FROST);
  rect(m, 7, 10, 1, 30, ICE);
  rect(m, 5, 38, 6, 2, NAVY.steel);
  rect(m, 6, 37, 4, 1, FROST);
  // Bands in the team colour.
  for (let y = 16; y < 36; y += 6) rect(m, 7, y, 2, 2, team[2]);
  // The sign: a hexagonal plate with a snail-shell swirl.
  const plate = [
    "....tttttttt....",
    "..ttbbbbbbbbtt..",
    ".tbbwwwwwwbbbbt.",
    "tbbwbbbbbbwbbbbs",
    "tbwbbwwwwbbwbbbs",
    "tbwbwbbbbwbwbbbs",
    "tbwbwbwwbwbwbbbs",
    "tbwbwbbwbwbwbbbs",
    "tbwbbwwbbwbwbbbs",
    "tbbwbbbbwbbwbbbs",
    ".tbbwwwwbbwbbbs.",
    "..ssbbbbbbbbss..",
    "....ssssssss....",
  ];
  blit(
    m,
    fromRows(plate, { t: team[3], b: team[1], w: team[3], s: team[0] }),
    0,
    0,
  );
  return m;
};

// ---------------------------------------------------------------------------------------------------------------
// Effects: each returns its frames, all the same size.

/** A kill: a white flash that bursts into eight shards of the victim's colour. 32 by 32, 6 frames. */
export const killBurst = (team: Ramp): Img[] =>
  Array.from({ length: 6 }, (_, i) => {
    const m = img(32, 32);
    const c = 15.5;
    // Eight spikes, the four diagonal ones shorter; they fly outward and thin as the flash fades.
    const outer = [5, 10, 13, 15, 15, 15][i] ?? 15;
    const inner = [0, 0, 5, 9, 12, 14][i] ?? 14;
    const colour =
      [WHITE, WHITE, team[3], team[2], team[2], team[1]][i] ?? team[1];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const scale = k % 2 === 0 ? 1 : 0.72;
      for (let d = inner * scale; d <= outer * scale; d += 0.5) {
        const x = Math.round(c + Math.cos(a) * d);
        const y = Math.round(c + Math.sin(a) * d);
        put(m, x, y, colour);
        // Thick near the centre while the flash is young.
        if (i < 3 && d < outer * scale * 0.6) {
          put(m, x + 1, y, colour);
          put(m, x, y + 1, colour);
        }
      }
    }
    if (i < 3) {
      disc(m, c, c, [4, 6, 4][i] ?? 4, i < 2 ? WHITE : team[3]);
      disc(m, c, c, [2, 4, 2][i] ?? 2, i < 2 ? team[3] : team[2]);
    }
    if (i === 2 || i === 3) ring(m, c, c, i === 2 ? 8 : 11, team[2]);
    return m;
  });

/** A worker's death: a puff of cloud that breaks up. 24 by 24, 5 frames. */
export const deathPuff = (team: Ramp): Img[] =>
  Array.from({ length: 5 }, (_, i) => {
    const m = img(24, 24);
    const blobs: [number, number, number][] = [
      [0, 0, 5],
      [-5, 2, 3.5],
      [5, 1, 3.5],
      [-2, -4, 3],
      [3, -4, 3],
    ];
    for (const [k, [bx, by, r]] of blobs.entries()) {
      const spread = 1 + i * 0.35;
      const radius = r - i * (k === 0 ? 1.2 : 0.7);
      if (radius < 0.5) continue;
      const x = 11.5 + bx * spread;
      const y = 12.5 + by * spread - i;
      disc(m, x, y + 1, radius, i < 2 ? ICE : FROST);
      disc(m, x, y, radius - 0.8, i < 3 ? WHITE : ICE);
    }
    if (i < 3) {
      star(m, 5 - i, 6 - i, 1, team[2], team[3]);
      star(m, 19 + i, 8 - i, 1, team[2], team[3]);
    } else {
      put(m, 3, 4, team[1]);
      put(m, 21, 5, team[1]);
    }
    return m;
  });

/** The puff of air under a flap. 16 by 8, 4 frames; place it under the wings. */
export const flapPuff = (): Img[] =>
  Array.from({ length: 4 }, (_, i) => {
    const m = img(16, 8);
    const c = [WHITE, WHITE, ICE, FROST][i] ?? FROST;
    for (const side of [-1, 1]) {
      // A curl of air under each wing, drifting out and down as it thins.
      const x = (dx: number) => (side < 0 ? 7 - dx : 8 + dx);
      const reach = 1 + i * 2;
      put(m, x(reach), i, c);
      put(m, x(reach + 1), i + 1, c);
      if (i < 3) put(m, x(reach + 1), i + 2, c);
      if (i < 2) put(m, x(reach), i + 3, ICE);
      if (i === 0) put(m, x(0), 1, WHITE);
    }
    return m;
  });

/** A gate transforming its worker: gold sparkles rising up the gate. 24 by 32, 6 frames, drawn over the gate. */
export const gateSparkle = (): Img[] =>
  Array.from({ length: 6 }, (_, i) => {
    const m = img(24, 32);
    for (let k = 0; k < 7; k++) {
      const x = 3 + Math.floor(hash(k, 1) * 18);
      const start = 30 - Math.floor(hash(k, 2) * 10);
      const y = start - Math.floor((i + hash(k, 3) * 3) * (3 + hash(k, 4) * 2));
      const phase = (i + k) % 3;
      if (y < 1 || y > 30) continue;
      if (phase === 0) star(m, x, y, 2, GOLD[3], WHITE);
      else if (phase === 1) star(m, x, y, 1, GOLD[2], GOLD[3]);
      else put(m, x, y, GOLD[3]);
    }
    return m;
  });

/** A berry banked in the hive: a lime ring popping outward. 16 by 16, 5 frames. */
export const berryPop = (): Img[] =>
  Array.from({ length: 5 }, (_, i) => {
    const m = img(16, 16);
    const c = 7.5;
    if (i === 0) {
      disc(m, c, c, 3, WHITE);
      disc(m, c, c, 2, LIME[3]);
    } else {
      ring(m, c, c, 2 + i * 1.3, i < 3 ? LIME[2] : LIME[1], i > 2 ? 4 : 0);
      if (i < 3) ring(m, c, c, 1 + i, LIME[3]);
    }
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const d = 2 + i * 1.5;
      put(
        m,
        Math.round(c + Math.cos(a) * d),
        Math.round(c + Math.sin(a) * d),
        i < 2 ? WHITE : LIME[3],
      );
    }
    return m;
  });

// ---------------------------------------------------------------------------------------------------------------
// Lettering: a chunky 5 by 7 capital font in the spirit of Press Start 2P, for art that carries text.

const GLYPHS: Record<string, readonly string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#.#.#", "#..##", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", ".#.#.", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
};

/** `text` in the 5 by 7 font at `scale`, with strokes thickened to two pixels at scale 1 for weight. */
export const text = (value: string, scale: number, c: Rgb): Img => {
  const m = img(value.length * 6 * scale, 7 * scale);
  [...value].forEach((ch, i) => {
    const glyph = GLYPHS[ch];
    if (!glyph) throw new Error(`no glyph for ${ch}`);
    glyph.forEach((row, y) =>
      [...row].forEach((bit, x) => {
        if (bit === "#")
          rect(m, (i * 6 + x) * scale, y * scale, scale, scale, c);
      }),
    );
  });
  return m;
};

const shadowed = (m: Img, dx: number, dy: number, c: Rgb): Img => {
  const out = img(m.w + dx, m.h + dy);
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++)
      if (alpha(m, x, y)) put(out, x + dx, y + dy, c);
  blit(out, m, 0, 0);
  return out;
};

const ICONS: Record<string, readonly string[]> = {
  // A crown over crossed blades.
  military: [
    "g..g..g..g",
    "gg.gggg.gg",
    "gggggggggg",
    ".GGGGGGGG.",
    "w........w",
    ".w......w.",
    "..w....w..",
    "...w..w...",
    "....ww....",
    "...w..w...",
    "..t....t..",
    ".t......t.",
  ],
  economy: [
    "....dd....",
    "...dss....",
    "..bbbbbb..",
    ".bbwwbbbb.",
    "bbwwbbbbbb",
    "bbwbbbbbbs",
    "bbbbbbbbbs",
    "bbbbbbbbss",
    "sbbbbbbsss",
    ".sbbbbsss.",
    "..ssssss..",
    "..........",
  ],
  snail: [
    "..........",
    "..vvvv....",
    ".vVVVVv...",
    "vVvvvVVv.c",
    "vVvVvVVv.c",
    "vVvVVvVvcc",
    "vVVvvVVccc",
    ".vVVVVvccc",
    "cccccccccc",
    "tccccccct.",
    "..........",
    "..........",
  ],
};

export type WinKind = "military" | "economy" | "snail";

/** A victory banner, 232 by 44: the winning team's name over the kind of win. */
export const banner = (team: Ramp, teamName: string, kind: WinKind): Img => {
  const w = 232;
  const h = 44;
  const m = img(w, h);
  rect(m, 2, 0, w - 4, h, VOID);
  rect(m, 0, 2, w, h - 4, VOID);
  rect(m, 1, 1, w - 2, h - 2, VOID);
  rect(m, 3, 2, w - 6, h - 4, team[2]);
  rect(m, 2, 3, w - 4, h - 6, team[2]);
  rect(m, 3, 2, w - 6, 1, team[3]);
  rect(m, 3, h - 3, w - 6, 1, team[1]);
  rect(m, 4, 4, w - 8, h - 8, NAVY.deep);
  rect(m, 4, 4, w - 8, 1, team[0]);
  // Hex studs along the inside edge.
  for (let x = 10; x < w - 10; x += 12) {
    put(m, x, h - 6, team[0]);
    put(m, x + 1, h - 6, team[0]);
  }
  const title = shadowed(text(`${teamName} WINS`, 2, team[3]), 2, 2, team[1]);
  blit(m, title, Math.floor((w - title.w) / 2) + 1, 8);
  const sub = text(`${kind.toUpperCase()} VICTORY`, 1, GOLD[3]);
  blit(m, shadowed(sub, 1, 1, GOLD[0]), Math.floor((w - sub.w) / 2) + 1, 28);
  const iconKey: Record<string, Rgb> = {
    g: GOLD[2],
    G: GOLD[1],
    w: WHITE,
    t: FROST,
    d: LIME[0],
    s: LIME[1],
    b: LIME[2],
    v: VIOLET[2],
    V: VIOLET[3],
    c: CREAM,
  };
  const icon = fromRows(ICONS[kind] ?? [], iconKey);
  blit(m, icon, 12, 16);
  // Mirrored on the right.
  for (let y = 0; y < icon.h; y++)
    for (let x = 0; x < icon.w; x++)
      if (alpha(icon, x, y)) put(m, w - 13 - x, 16 + y, rgbAt(icon, x, y));
  return m;
};

export { INK };

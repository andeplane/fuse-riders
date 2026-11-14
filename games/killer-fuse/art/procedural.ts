/**
 * Killer Fuse's hand-pixelled tiles, HUD pieces, effects and lettering (units and props are in `arcade.ts`). Each
 * function returns finished pixels on the shared palette; `scripts/killer-fuse-art.ts` lays them out into sheets.
 */
import {
  CREAM,
  FROST,
  GOLD,
  ICE,
  LIME,
  NAVY,
  TAN,
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

const VOID = NAVY.void;

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
// Snail progress strip (HUD)

/** Where the marker's anchor travels along the strip: from Cyan's goal to Pink's, in strip pixels. */
export const STRIP_LANE: readonly [number, number] = [8, 191];

/** The HUD's snail lane, 200 by 7: Cyan's goal cap on the left, Pink's on the right, a tick in the middle. */
export const snailStrip = (cyan: Ramp, pink: Ramp): Img => {
  const w = 200;
  const m = img(w, 7);
  rect(m, 1, 0, w - 2, 7, VOID);
  rect(m, 0, 1, w, 5, VOID);
  rect(m, 2, 1, w - 4, 1, NAVY.steel);
  rect(m, 2, 2, w - 4, 3, NAVY.night);
  rect(m, 2, 5, w - 4, 1, NAVY.dusk);
  // The rail the snail rides: gold dashes, with quarter marks.
  for (let x = 10; x < w - 10; x += 4) rect(m, x, 3, 2, 1, GOLD[0]);
  for (const x of [54, 145]) rect(m, x, 2, 1, 3, NAVY.steel);
  rect(m, 99, 0, 2, 7, WHITE);
  rect(m, 99, 5, 2, 2, FROST);
  for (const [team, left] of [
    [cyan, true],
    [pink, false],
  ] as const) {
    const col = (i: number) => (left ? i : w - 1 - i);
    for (let i = 1; i < 7; i++)
      for (let y = 0; y < 7; y++) {
        if ((i === 1 || i === 6) && (y === 0 || y === 6)) continue;
        put(m, col(i), y, y === 0 ? team[3] : y >= 5 ? team[1] : team[2]);
      }
    for (let y = 1; y < 6; y++) put(m, col(0), y, team[1]);
    // A white chevron pointing at the goal.
    put(m, col(4), 2, WHITE);
    put(m, col(3), 3, WHITE);
    put(m, col(4), 4, WHITE);
  }
  return m;
};

/** The snail on the HUD strip, 9 by 7, facing right. */
export const snailMarker = (): Img =>
  fromRows(
    [
      "..VVV....",
      ".VLLLV.k.",
      "VLVVVLV.c",
      "VLVLVLVcc",
      "VLVVLLVcc",
      "dVLLLVccc",
      "ttccccccc",
    ],
    {
      V: VIOLET[2],
      L: VIOLET[3],
      d: VIOLET[1],
      c: CREAM,
      t: TAN,
      k: WHITE,
    },
  );

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
  w: ICE,
};

/** Slate plating with a honeycomb pressed into it; it tiles in both directions. */
const BODY = [
  "NBBBBBBB",
  "NBBBBBBB",
  "BNBBBBBN",
  "BBNNSNNB",
  "BBBBNBBB",
  "BBBBNBBB",
  "BBBNBNBB",
  "SNNBBBNN",
];

const withRows = (base: readonly string[], rows: Record<number, string>) =>
  base.map((row, y) => rows[y] ?? row);

/** Replaces columns of a tile: `cols[x]` is that column top to bottom, with a space keeping what is there. */
const columns = (base: readonly string[], cols: Record<number, string>) =>
  base.map((row, y) =>
    [...row]
      .map((ch, x) => {
        const to = cols[x]?.[y] ?? " ";
        return ch === "." || to === " " ? ch : to;
      })
      .join(""),
  );

const corner = (rows: readonly string[], x: number, y: number) =>
  rows.map((row, j) =>
    j === y ? row.slice(0, x) + "." + row.slice(x + 1) : row,
  );

/** The neon edge every walkable top has: a light tube on a dark seam. */
const NEON = { 0: "LLLLLwLL", 1: "VVVVVVVV", 2: "uuuuuuuu" };
/** The underside of a platform: a dark lip and its shadow. */
const UNDER = { 6: "DDDDDDDD", 7: "NNNNNNNN" };

const TOP = withRows(BODY, NEON);
const BOTTOM = withRows(BODY, UNDER);
/** A floating platform, 7 rows: the neon edge, three rows of plating, a dark lip and a fringe hanging under it. */
const SLAB = [
  "LLLLLwLL",
  "VVVVVVVV",
  "BNBBBBBN",
  "BBNNSNNB",
  "DDDDvDDD",
  "NNNNNNNN",
  ".u...N.u",
  "",
];
/** The ground, 5 rows: a pale rail the snail crawls on over a thin band of plating. */
const TRACK = [
  "ccccwccc",
  "VVVVVVVV",
  "BBNBBBBN",
  "DDDDDDDD",
  "NNNNNNNN",
  "",
  "",
  "",
];
/** Steel end caps: a lit one on the left, a shaded one on the right, each with a rivet. */
const CAP_LEFT = { 0: "LcSSSSSS", 1: "wScSSgSS" };
const CAP_RIGHT = { 6: "LSSSSoSD", 7: "LDDDDDDN" };
const capped = (rows: readonly string[], side: "left" | "right") =>
  side === "left"
    ? corner(columns(rows, CAP_LEFT), 0, 0)
    : corner(columns(rows, CAP_RIGHT), 7, 0);
/** A platform's end: the corner pixels rounded off, a steel cap down the edge. */
const slabCap = (side: "left" | "right") =>
  side === "left"
    ? [
        ".cLLLLLL",
        "wSVVVVVV",
        "SSBBBBBN",
        "SBNNSNNB",
        "DDDDvDDD",
        ".NNNNNNN",
        "...u...N",
        "",
      ]
    : [
        "LLLLLLL.",
        "VVVVVVSD",
        "BNBBBBSD",
        "BBNNSNBD",
        "DDDDvDDN",
        "NNNNNNN.",
        ".u..N...",
        "",
      ];

/** The tiles of the platform set by name; the sheet lays them out in this order, 8 by 8 each. */
export const TILES: Record<string, readonly string[]> = {
  topLeft: capped(TOP, "left"),
  top: TOP,
  topRight: capped(TOP, "right"),
  left: columns(BODY, { 0: "SSSSSSSS", 1: "cSSSSSSS" }),
  middle: BODY,
  right: columns(BODY, { 6: "DDDDDDDD", 7: "NNNNNNNN" }),
  bottomLeft: corner(columns(BOTTOM, { 0: "SSSSSSDN" }), 0, 7),
  bottom: BOTTOM,
  bottomRight: corner(columns(BOTTOM, { 7: "NNNNNNNN" }), 7, 7),
  // A floating platform, 7 rows drawn: neon top, plating, shadowed underside and a fringe.
  slabLeft: slabCap("left"),
  slab: SLAB,
  slabRight: slabCap("right"),
  // The thin one-way ledge: only its top five rows are drawn, a light tube on struts.
  ledgeLeft: [
    ".cLLLLLL",
    "SVVVVVVV",
    ".uuuuuuu",
    "..D...D.",
    "..N.....",
    "",
    "",
    "",
  ],
  ledge: [
    "LLLLLwLL",
    "VVVVVVVV",
    "uuuuuuuu",
    "..D...D.",
    "......N.",
    "",
    "",
    "",
  ],
  ledgeRight: [
    "LLLLLLL.",
    "VVVVVVVD",
    "uuuuuuu.",
    "..D...D.",
    "..N.....",
    "",
    "",
    "",
  ],
  // Variety for long runs: a circuit node, a lit hex cell and a lamp in the neon edge.
  middleNode: withRows(BODY, { 3: "BBDoGoDB", 4: "BBBBoBBB" }),
  middleCell: [
    "DBBBBBBB",
    "DBBBBBBB",
    "BDBBBBBD",
    "BBDDvDDB",
    "BBBvLvBB",
    "BBBBvBBB",
    "BBBDBDBB",
    "BDDBBBDD",
  ],
  topLamp: withRows(TOP, { 0: "LLLGGLLL", 1: "VVVggVVV", 2: "uuuoouuu" }),
  slabLamp: withRows(SLAB, { 0: "LLwwwLLL", 6: "..u.N..." }),
  // The ground, 5 rows drawn: the snail crawls along it.
  track: TRACK,
  trackLeft: withRows(TRACK, { 0: ".cccwccc", 4: ".NNNNNNN" }),
  trackRight: withRows(TRACK, { 0: "ccccwcc.", 4: "NNNNNNN." }),
  // The ground with a glint, for every few tiles of a long run.
  trackLamp: withRows(TRACK, { 0: "ccwwwccc", 2: "BNBBBNBB" }),
};

export const tile = (name: string): Img => {
  const rows = TILES[name];
  if (!rows) throw new Error(`no tile ${name}`);
  const m = img(8, 8);
  blit(m, fromRows(rows, TILE_KEY), 0, 0);
  return m;
};

// ---------------------------------------------------------------------------------------------------------------
// Effects: each returns its frames, all the same size.

/**
 * A unit bursting apart: `count` specks of one or two pixels in its colour, already flung clear on the first frame,
 * spreading to `reach` pixels and thinning out as they fall. No flash and no fireball.
 */
const scatter = (
  team: Ramp,
  size: number,
  frames: number,
  count: number,
  reach: number,
): Img[] =>
  Array.from({ length: frames }, (_, i) => {
    const m = img(size, size);
    const c = Math.floor(size / 2);
    const t = (i + 1) / frames;
    // Fast at first, slowing: most of the spread happens in the first two frames.
    const out = 1 - (1 - t) * (1 - t);
    for (let k = 0; k < count; k++) {
      // Specks go out one after another near the end.
      if (hash(k, 3) < (t - 0.45) * 1.6) continue;
      const a = (k / count) * Math.PI * 2 + hash(k, 1) * 0.9;
      const d = reach * out * (0.35 + 0.65 * hash(k, 2));
      const x = Math.round(c + Math.cos(a) * d);
      const y = Math.round(c + Math.sin(a) * d * 0.9 + t * t * 5);
      const shade = hash(k, 4);
      const colour =
        shade < 0.12
          ? WHITE
          : (team[shade < 0.5 ? 3 : shade < 0.85 ? 2 : 1] ?? WHITE);
      const big = hash(k, 5) < 0.4 && t < 0.7;
      rect(m, x, y, big ? 2 : 1, big && k % 2 ? 2 : 1, colour);
    }
    return m;
  });

/** A kill: 44 specks in the victim's colour spreading about 40 pixels. 84 by 84, 6 frames. */
export const killBurst = (team: Ramp): Img[] => scatter(team, 84, 6, 44, 40);

/** A Queen's death: a bigger scatter, her head crest thrown clear and tumbling down. 100 by 100, 8 frames. */
export const queenDeath = (team: Ramp): Img[] =>
  scatter(team, 100, 8, 72, 48).map((m, i) => {
    const t = i / 7;
    const x = Math.round(47 + t * 9);
    const y = Math.round(46 - Math.sin(t * Math.PI * 0.85) * 18 + t * 6);
    const crest = img(6, 5);
    blit(
      crest,
      fromRows(["33..", "3333", ".233"], { "2": team[2], "3": team[3] }),
      1,
      1,
      i % 4 >= 2,
    );
    // A dark rim keeps the crest readable among the specks.
    for (let cy = 0; cy < crest.h; cy++)
      for (let cx = 0; cx < crest.w; cx++)
        if (
          !alpha(crest, cx, cy) &&
          (alpha(crest, cx - 1, cy) ||
            alpha(crest, cx + 1, cy) ||
            alpha(crest, cx, cy - 1) ||
            alpha(crest, cx, cy + 1))
        )
          put(m, x + cx, y + cy, VOID);
    blit(m, crest, x, y);
    return m;
  });

/**
 * A unit arriving: a column of the team's light drops onto the spot, narrows and leaves rising glints. 14 by 24,
 * 7 frames; anchored at the feet, drawn over the unit.
 */
export const respawn = (team: Ramp): Img[] =>
  Array.from({ length: 7 }, (_, i) => {
    const m = img(14, 24);
    const half = [1, 3, 5, 4, 2, 1, 0][i] ?? 0;
    const top = [0, 0, 0, 0, 4, 10, 24][i] ?? 24;
    for (let y = top; y < 22; y++)
      for (let dx = -half; dx < half; dx++) {
        const edge = Math.min(dx + half, half - 1 - dx);
        // The column comes to a point at the top and is brightest up the middle.
        if (y - top < half - 1 - edge) continue;
        put(m, 7 + dx, y, edge === 0 ? team[2] : edge < 2 ? team[3] : WHITE);
      }
    // The pool of light at the feet.
    const pool = [2, 4, 6, 6, 6, 5, 3][i] ?? 0;
    rect(m, 7 - pool, 22, pool * 2, 1, i < 5 ? team[3] : team[2]);
    rect(m, 7 - pool + 1, 23, pool * 2 - 2, 1, team[1]);
    if (i > 1)
      for (let k = 0; k < 4; k++) {
        const x = 2 + Math.floor(hash(k, 11) * 10);
        const y = 19 - Math.floor((i - 1) * (2 + hash(k, 12) * 2)) - k * 2;
        if (y < 1) continue;
        put(m, x, y, (i + k) % 2 ? WHITE : team[3]);
      }
    return m;
  });

/** A worker's death: a puff of cloud that breaks up. 16 by 16, 5 frames. */
export const deathPuff = (team: Ramp): Img[] =>
  Array.from({ length: 5 }, (_, i) => {
    const m = img(16, 16);
    const blobs: [number, number, number][] = [
      [0, 0, 3.2],
      [-3, 1, 2.3],
      [3, 1, 2.3],
      [-1, -3, 2],
      [2, -3, 2],
    ];
    for (const [k, [bx, by, r]] of blobs.entries()) {
      const spread = 1 + i * 0.3;
      const radius = r - i * (k === 0 ? 0.8 : 0.45);
      if (radius < 0.5) continue;
      const x = 7.5 + bx * spread;
      const y = 8.5 + by * spread - i * 0.6;
      disc(m, x, y + 1, radius, i < 2 ? ICE : FROST);
      disc(m, x, y, radius - 0.7, i < 3 ? WHITE : ICE);
    }
    put(m, 2 - Math.min(i, 1), 4 - Math.min(i, 3), i < 3 ? team[3] : team[1]);
    put(m, 13 + Math.min(i, 1), 5 - Math.min(i, 3), i < 3 ? team[3] : team[1]);
    return m;
  });

/** The puff of air under a flap. 12 by 6, 4 frames; place it under the wings. */
export const flapPuff = (): Img[] =>
  Array.from({ length: 4 }, (_, i) => {
    const m = img(12, 6);
    const c = [WHITE, WHITE, ICE, FROST][i] ?? FROST;
    for (const side of [-1, 1]) {
      // A curl of air under each wing, drifting out and down as it thins.
      const x = (dx: number) => (side < 0 ? 5 - dx : 6 + dx);
      const reach = 1 + i;
      put(m, x(reach), i, c);
      put(m, x(reach + 1), i + 1, c);
      if (i < 3) put(m, x(reach + 1), i + 2, c);
      if (i === 0) put(m, x(0), 1, WHITE);
    }
    return m;
  });

/**
 * A gate transforming its worker: white sparkles rising up the gate. 35 by 28 (a gate's cell), 6 frames, drawn
 * over the gate and anchored like it.
 */
export const gateSparkle = (): Img[] =>
  Array.from({ length: 6 }, (_, i) => {
    const m = img(35, 28);
    for (let k = 0; k < 7; k++) {
      const x = 5 + Math.floor(hash(k, 1) * 25);
      const start = 25 - Math.floor(hash(k, 2) * 8);
      const y = start - Math.floor((i + hash(k, 3) * 3) * (2 + hash(k, 4) * 2));
      const phase = (i + k) % 3;
      if (y < 2 || y > 25) continue;
      if (phase === 0) star(m, x, y, 1, ICE, WHITE);
      else put(m, x, y, phase === 1 ? WHITE : ICE);
    }
    return m;
  });

/** A berry banked in the hive: a lime ring popping outward. 11 by 11, 5 frames. */
export const berryPop = (): Img[] =>
  Array.from({ length: 5 }, (_, i) => {
    const m = img(11, 11);
    const c = 5;
    if (i === 0) {
      disc(m, c, c, 2, WHITE);
      disc(m, c, c, 1, LIME[3]);
    } else {
      ring(m, c, c, 1.5 + i * 0.8, i < 3 ? LIME[2] : LIME[1], i > 2 ? 4 : 0);
      if (i < 3) ring(m, c, c, 0.6 + i * 0.7, LIME[3]);
    }
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const d = 1.5 + i * 0.9;
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
// Lettering: 7 by 7 capitals with two-pixel stems on an 8-pixel advance, the proportions of Press Start 2P, drawn
// here for art that carries text.

const GLYPHS: Record<string, readonly string[]> = {
  A: [
    "..###..",
    ".##.##.",
    "##...##",
    "##...##",
    "#######",
    "##...##",
    "##...##",
  ],
  C: [
    "..####.",
    ".##..##",
    "##.....",
    "##.....",
    "##.....",
    ".##..##",
    "..####.",
  ],
  E: [
    "#######",
    "##.....",
    "##.....",
    "######.",
    "##.....",
    "##.....",
    "#######",
  ],
  F: [
    "#######",
    "##.....",
    "##.....",
    "######.",
    "##.....",
    "##.....",
    "##.....",
  ],
  I: [
    ".######",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    ".######",
  ],
  K: [
    "##...##",
    "##..##.",
    "##.##..",
    "####...",
    "#####..",
    "##.###.",
    "##..###",
  ],
  L: [
    ".##....",
    ".##....",
    ".##....",
    ".##....",
    ".##....",
    ".##....",
    ".######",
  ],
  M: [
    "##...##",
    "###.###",
    "#######",
    "#######",
    "##.#.##",
    "##...##",
    "##...##",
  ],
  N: [
    "##...##",
    "###..##",
    "####.##",
    "#######",
    "##.####",
    "##..###",
    "##...##",
  ],
  O: [
    ".#####.",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    ".#####.",
  ],
  P: [
    "######.",
    "##...##",
    "##...##",
    "##...##",
    "######.",
    "##.....",
    "##.....",
  ],
  R: [
    "######.",
    "##...##",
    "##...##",
    "##..###",
    "#####..",
    "##.###.",
    "##..###",
  ],
  S: [
    ".####..",
    "##..##.",
    "##.....",
    ".#####.",
    "....###",
    "##...##",
    ".#####.",
  ],
  T: [
    ".######",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
    "...##..",
  ],
  U: [
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    ".#####.",
  ],
  V: [
    "##...##",
    "##...##",
    "##...##",
    "###.###",
    ".#####.",
    "..###..",
    "...#...",
  ],
  W: [
    "##...##",
    "##...##",
    "##.#.##",
    "#######",
    "#######",
    "###.###",
    "##...##",
  ],
  Y: [
    ".##..##",
    ".##..##",
    ".##..##",
    "..####.",
    "...##..",
    "...##..",
    "...##..",
  ],
  " ": [
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
    ".......",
  ],
};

/** `text` in the 7 by 7 font at `scale`; each letter advances 8 pixels and the last has no trailing gap. */
export const text = (value: string, scale: number, c: Rgb): Img => {
  const m = img((value.length * 8 - 1) * scale, 7 * scale);
  [...value].forEach((ch, i) => {
    const glyph = GLYPHS[ch];
    if (!glyph) throw new Error(`no glyph for ${ch}`);
    glyph.forEach((row, y) =>
      [...row].forEach((bit, x) => {
        if (bit === "#")
          rect(m, (i * 8 + x) * scale, y * scale, scale, scale, c);
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
  // Two crossed lances under a crown.
  military: [
    "g..gg..g",
    "gg.gg.gg",
    "gggggggg",
    ".GGGGGG.",
    "........",
    "w......w",
    "ww....ww",
    ".ww..ww.",
    "..wwww..",
    "..twwt..",
    ".tt..tt.",
    "gg....gg",
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
  ],
  snail: [
    "..vvvv...c.c",
    ".vVVVVv..c.c",
    "vVvvvvVv.ccc",
    "vVvVVvVv.ccc",
    "vVvVvvVvcccc",
    "vVvVVVVvccc.",
    ".vVvvvvccc..",
    "cccccccccc..",
    "tcccccccct..",
  ],
};

export type WinKind = "military" | "economy" | "snail";

/** A victory banner, 232 by 44: the winning team's name over the kind of win, with the win's icon at both ends. */
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
  // Plates behind the icons.
  rect(m, 5, 5, 30, h - 10, NAVY.night);
  rect(m, w - 35, 5, 30, h - 10, NAVY.night);
  rect(m, 35, 5, 1, h - 10, team[0]);
  rect(m, w - 36, 5, 1, h - 10, team[0]);
  const title = shadowed(text(`${teamName} WINS`, 2, team[3]), 2, 2, team[1]);
  blit(m, title, Math.floor((w - title.w) / 2) + 1, 7);
  const sub = shadowed(
    text(`${kind.toUpperCase()} VICTORY`, 1, GOLD[3]),
    1,
    1,
    GOLD[0],
  );
  blit(m, sub, Math.floor((w - sub.w) / 2) + 1, 28);
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
  // The icon at twice its size, as chunky as the title.
  const small = fromRows(ICONS[kind] ?? [], iconKey);
  const icon = img(small.w * 2, small.h * 2);
  for (let y = 0; y < small.h; y++)
    for (let x = 0; x < small.w; x++)
      if (alpha(small, x, y))
        rect(icon, x * 2, y * 2, 2, 2, rgbAt(small, x, y));
  const top = Math.floor((h - icon.h) / 2);
  blit(m, icon, 10, top);
  blit(m, icon, w - 10 - icon.w, top, true);
  return m;
};

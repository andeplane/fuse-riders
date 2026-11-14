/**
 * Killer Fuse's hand-pixelled tiles and effects (units and props are in `arcade.ts`). Each
 * function returns finished pixels on the shared palette; `scripts/killer-fuse-art.ts` lays them out into sheets.
 */
import {
  FROST,
  GOLD,
  ICE,
  LIME,
  NAVY,
  VIOLET,
  WHITE,
  type Ramp,
} from "./assets.ts";
import { blit, fromRows, img, put, rect, type Img, type Rgb } from "./pixel.ts";

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
 * Two blades meeting: a white glint that opens into a four-point star and throws yellow sparks. 15 by 15, 4 frames;
 * centred where the blades cross.
 */
export const clash = (): Img[] =>
  Array.from({ length: 4 }, (_, i) => {
    const m = img(15, 15);
    const c = 7;
    if (i > 0)
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.4;
        const d = 2.5 + i * 1.5;
        put(
          m,
          Math.round(c + Math.cos(a) * d),
          Math.round(c + Math.sin(a) * d),
          i < 3 ? GOLD[3] : GOLD[1],
        );
      }
    if (i < 3) star(m, c, c, [1, 3, 2][i] ?? 1, i === 2 ? ICE : WHITE, WHITE);
    else put(m, c, c, ICE);
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

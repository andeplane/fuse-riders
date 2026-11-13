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

/** Half-widths of a cell's eleven rows: a pointy-top hexagon 11 wide, the shape the engine's hole spacing fits. */
const HEX = [1, 2, 4, 5, 5, 5, 5, 5, 4, 2, 1];
const HOLE = 11;

/** Draws one cell centred on (cx, cy): `wall` and `inside` give each row's colours; clipped to `clip` rows/columns. */
const cell = (
  m: Img,
  cx: number,
  cy: number,
  wall: (row: number) => Rgb,
  inside: ((row: number) => Rgb) | undefined,
  clip: { x0: number; x1: number; y0: number; y1: number } = {
    x0: 0,
    x1: m.w - 1,
    y0: 0,
    y1: m.h - 1,
  },
) => {
  HEX.forEach((hw, row) => {
    const y = cy - 5 + row;
    if (y < clip.y0 || y > clip.y1) return;
    const prev = HEX[row - 1] ?? -1;
    const next = HEX[row + 1] ?? -1;
    for (let dx = -hw; dx <= hw; dx++) {
      const x = cx + dx;
      if (x < clip.x0 || x > clip.x1) continue;
      const a = Math.abs(dx);
      const edge = a === hw || a > prev || a > next;
      if (edge) put(m, x, y, wall(row));
      else if (inside) put(m, x, y, inside(row));
    }
  });
};

const SEATED = [
  "..bbb..",
  ".bwwbb.",
  "sbwbbbb",
  "sbbbbbb",
  "sbbbbbs",
  ".sbbbs.",
  "..sss..",
];

/** One hive hole, 11 by 11, drawn centred on the engine's hole position: an empty cell, or a berry seated in it. */
export const hiveHole = (team: Ramp, filled: boolean): Img => {
  const m = img(HOLE, HOLE);
  if (filled) {
    cell(
      m,
      5,
      5,
      (row) => (row < 4 ? WHITE : team[3]),
      () => LIME[0],
    );
    blit(m, fromRows(SEATED, BERRY_KEY), 2, 2);
    put(m, 4, 3, WHITE);
  } else
    cell(
      m,
      5,
      5,
      (row) => (row < 3 ? team[2] : team[1]),
      (row) => (row < 5 ? VOID : row === 8 ? NAVY.dusk : NAVY.deep),
    );
  return m;
};

/** The hive's cell: 81 by 40, standing on its anchor (bottom centre), which goes on the top row of its ledge. */
export const HIVE = {
  w: 81,
  h: 40,
  anchor: [40, 39],
  /** Top centre of a 7-pixel-high count on the plaque, relative to the anchor. */
  count: [0, -30],
  /** Where something may stand on the roof (a Queen's respawn ghost), relative to the anchor. */
  perch: [0, -37],
} as const;

/**
 * The hive, facing the way Cyan's does (Pink's is its mirror image): a ribbed steel dome with a neon rim and a
 * count plaque, over a honeycomb wall between two lamp pillars. `holes` are the engine's hole centres relative to
 * the anchor; the comb is drawn around them, with dim cells continuing it to the walls.
 */
export const hive = (
  team: Ramp,
  holes: readonly (readonly [number, number])[],
): Img => {
  const { w, h } = HIVE;
  const [ax, ay] = HIVE.anchor;
  const m = img(w, h);
  const WALL = 20;
  const half = (y: number) => {
    if (y >= WALL) return 40;
    if (y < 5) return -1;
    const t = (WALL - y) / 16;
    return Math.round(40 * Math.sqrt(Math.max(0, 1 - t ** 2)));
  };
  // The dome: steel skin, ribs every ten pixels, a neon line just inside the rim.
  for (let y = 5; y < WALL; y++) {
    const hw = half(y);
    const above = half(y - 1);
    for (let x = ax - hw; x <= ax + hw; x++) {
      const a = Math.abs(x - ax);
      const top = a > above - 1 || y === 5;
      let c: Rgb;
      if (hw - a === 0 || top) c = y < 13 ? FROST : NAVY.steel;
      else if (hw - a <= 2 || a > above - 3)
        c = y < 13 ? NAVY.steel : NAVY.slate;
      else if (hw - a === 3 || a === above - 3) c = team[2];
      else {
        const rib = a % 10;
        c =
          rib === 5
            ? NAVY.steel
            : rib === 6
              ? NAVY.dusk
              : y === 12
                ? NAVY.dusk
                : y < 9
                  ? NAVY.steel
                  : NAVY.slate;
        if (rib === 5 && (y === 8 || y === 13)) c = FROST;
      }
      put(m, x, y, c);
    }
  }
  // The roof pad and its lamp, with two short horns.
  rect(m, ax - 12, 3, 25, 1, FROST);
  rect(m, ax - 13, 4, 27, 1, NAVY.steel);
  rect(m, ax - 12, 1, 2, 2, NAVY.steel);
  rect(m, ax + 11, 1, 2, 2, NAVY.steel);
  put(m, ax - 12, 0, FROST);
  put(m, ax + 12, 0, FROST);
  rect(m, ax - 3, 2, 7, 1, GOLD[1]);
  rect(m, ax - 2, 1, 5, 1, GOLD[2]);
  rect(m, ax - 1, 0, 3, 2, team[3]);
  put(m, ax, 0, WHITE);
  put(m, ax - 2, 1, GOLD[3]);
  // The plaque the count is written on.
  rect(m, ax - 18, 7, 37, 11, NAVY.steel);
  rect(m, ax - 17, 7, 35, 1, FROST);
  rect(m, ax - 17, 8, 35, 9, team[1]);
  rect(m, ax - 16, 9, 33, 7, VOID);
  rect(m, ax - 17, 8, 35, 1, team[2]);
  for (const x of [ax - 18, ax + 18]) {
    put(m, x, 9, GOLD[2]);
    put(m, x, 15, GOLD[1]);
  }
  // The lintel: a neon bar across the mouth of the dome with a shadow under it.
  rect(m, 0, 18, w, 1, team[2]);
  for (let x = 4; x < w; x += 8) rect(m, x, 18, 2, 1, team[3]);
  rect(m, 0, 19, w, 1, NAVY.steel);
  rect(m, 0, 18, 1, 2, FROST);
  rect(m, w - 1, 18, 1, 2, FROST);
  // The comb wall.
  const inner = { x0: 6, x1: w - 7, y0: WALL, y1: h - 3 };
  rect(m, inner.x0, WALL, inner.x1 - inner.x0 + 1, h - WALL, NAVY.deep);
  rect(m, inner.x0, WALL, inner.x1 - inner.x0 + 1, 2, VOID);
  const at = holes.map(([x, y]) => [ax + x, ay + y] as const);
  const key = (x: number, y: number) => `${x},${y}`;
  const real = new Set(at.map(([x, y]) => key(x, y)));
  const xs = [...new Set(at.map(([x]) => x))].sort((p, q) => p - q);
  const ys = [...new Set(at.map(([, y]) => y))].sort((p, q) => p - q);
  const dx = (xs[2] ?? 0) - (xs[0] ?? 0) || 10;
  const dy = (ys[1] ?? 0) - (ys[0] ?? 0) || 8;
  const ghosts = new Map<string, readonly [number, number]>();
  for (const [x, y] of at)
    for (const [gx, gy] of [
      [x - dx, y],
      [x + dx, y],
      [x - dx / 2, y - dy],
      [x + dx / 2, y - dy],
    ] as const)
      if (!real.has(key(gx, gy)) && gy + 5 >= WALL)
        ghosts.set(key(gx, gy), [gx, gy]);
  for (const [gx, gy] of ghosts.values())
    cell(
      m,
      gx,
      gy,
      () => NAVY.slate,
      () => NAVY.night,
      inner,
    );
  for (const [x, y] of at) {
    if (x - 5 < inner.x0 || x + 5 > inner.x1 || y - 5 < WALL)
      throw new Error(`hive hole at ${x},${y} does not fit the hive art`);
    blit(m, hiveHole(team, false), x - 5, y - 5);
  }
  // Pillars, each with a lamp strip, and the base plate over the feet of the bottom cells.
  for (const side of [0, 1]) {
    const col = (i: number) => (side ? w - 1 - i : i);
    for (let y = WALL; y < h; y++) {
      put(m, col(0), y, FROST);
      put(m, col(1), y, NAVY.steel);
      put(
        m,
        col(2),
        y,
        y > 22 && y < 36 ? team[y % 4 === 3 ? 3 : 2] : NAVY.slate,
      );
      put(m, col(3), y, y > 22 && y < 36 ? team[1] : NAVY.slate);
      put(m, col(4), y, NAVY.steel);
      put(m, col(5), y, NAVY.night);
    }
    rect(m, side ? w - 6 : 0, WALL, 6, 1, FROST);
    rect(m, side ? w - 6 : 0, 36, 6, 1, FROST);
  }
  rect(m, 0, h - 2, w, 1, NAVY.steel);
  rect(m, 0, h - 1, w, 1, NAVY.night);
  for (let x = 2; x < w - 3; x += 6) rect(m, x, h - 2, 3, 1, team[2]);
  return m;
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
// Eggs (HUD)

/** A Queen's life on the HUD, 10 by 12: whole, cracked (flash it as the life is lost), or spent. */
export const egg = (team: Ramp, state: "full" | "cracked" | "broken"): Img => {
  const key: Record<string, Rgb> = {
    d: team[0],
    s: team[1],
    b: team[2],
    w: team[3],
    W: WHITE,
    n: NAVY.steel,
    N: NAVY.slate,
    k: FROST,
    x: VOID,
  };
  if (state === "cracked")
    return fromRows(
      [
        "....bb....",
        "...bbbb...",
        "..bwwbbb..",
        "..bwbxbb..",
        ".bbwxbbbs.",
        ".bbbxxbbs.",
        ".xbbbxbxs.",
        ".bxbxbxbs.",
        ".sbxbbbss.",
        ".sbbbbssd.",
        "..sssssd..",
        "...dddd...",
      ],
      key,
    );
  return state === "broken"
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
const SLAB = withRows(BODY, {
  ...NEON,
  3: "BNBBBBBN",
  4: "BBNNSNNB",
  5: "BBBBNBBB",
  6: "DDDDvDDD",
  7: "NNNNNNNN",
});
/** The snail's lane: a gold rail over hazard stripes. */
const TRACK = withRows(BODY, {
  0: "GGGGGGGG",
  1: "gggggggg",
  2: "oooooooo",
  3: "NNooNNoo",
  4: "NooNNooN",
  5: "ooNNooNN",
  6: "uuuuuuuu",
});
/** Steel end caps: a lit one on the left, a shaded one on the right, each with a rivet. */
const CAP_LEFT = { 0: "LcSSSSSS", 1: "wScSSgSS" };
const CAP_RIGHT = { 6: "LSSSSoSD", 7: "LDDDDDDN" };
const capped = (rows: readonly string[], side: "left" | "right") =>
  side === "left"
    ? corner(columns(rows, CAP_LEFT), 0, 0)
    : corner(columns(rows, CAP_RIGHT), 7, 0);
const slabCap = (side: "left" | "right") => {
  const cap =
    side === "left"
      ? columns(SLAB, { 0: "LcSSSSDN", 1: "wScSgSDN" })
      : columns(SLAB, { 6: "LSSSoSDN", 7: "LDDDDDNN" });
  return corner(
    corner(cap, side === "left" ? 0 : 7, 0),
    side === "left" ? 0 : 7,
    7,
  );
};

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
  // A one-tile-high slab: neon top, honeycomb body, shadowed underside.
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
  slabLamp: withRows(SLAB, { 0: "LLLGGLLL", 1: "VVVggVVV", 2: "uuuoouuu" }),
  // The snail track: the floor's top row.
  track: TRACK,
  trackLeft: corner(columns(TRACK, { 0: "GgoSSSSS" }), 0, 0),
  trackRight: corner(columns(TRACK, { 7: "GgoNNNNN" }), 7, 0),
  // The track with a lane light, for every few tiles of a long run.
  trackLamp: withRows(TRACK, { 0: "GGGwwGGG", 1: "gggGGggg" }),
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

/** A lumpy fireball: a disc with smaller discs budding off its rim. */
const lump = (
  m: Img,
  cx: number,
  cy: number,
  r: number,
  c: Rgb,
  seed: number,
) => {
  if (r < 0.6) return;
  disc(m, cx, cy, r, c);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + seed;
    disc(
      m,
      cx + Math.cos(a) * r * 0.62,
      cy + Math.sin(a) * r * 0.62,
      r * (0.42 + 0.22 * hash(k, seed * 10 + 1)),
      c,
    );
  }
};

/**
 * A chunky explosion in a team's colour, `size` square and `count` frames long: a white flash swells into a
 * fireball, which breaks into puffs while pieces of wing and shell fly out and fall.
 */
const explosion = (team: Ramp, size: number, count: number): Img[] =>
  Array.from({ length: count }, (_, i) => {
    const m = img(size, size);
    const c = size / 2 - 0.5;
    const reach = size / 2 - 3;
    const t = i / (count - 1);
    // Fireball: grows for the first third, then thins out from the middle.
    const grow = Math.min(1, t * 3.2 + 0.3);
    const fade = Math.max(0, (t - 0.3) / 0.7);
    if (fade < 0.25) {
      lump(m, c, c, reach * 0.92 * grow, team[1], 0.3);
      lump(m, c, c, reach * 0.82 * grow, team[2], 0.3);
      lump(m, c, c, reach * 0.62 * grow, team[3], 1.1);
      lump(m, c, c, reach * (0.46 - fade) * grow, WHITE, 2.0);
    } else {
      // Puffs drifting outward, shrinking as they go, darker underneath.
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + 0.4;
        const d = reach * (0.42 + 0.45 * fade) * (0.85 + 0.3 * hash(k, 5));
        const r = reach * 0.34 * (1.15 - fade) * (0.7 + 0.5 * hash(k, 6));
        const x = c + Math.cos(a) * d;
        const y = c + Math.sin(a) * d - fade * 2;
        lump(m, x, y + 1, r, fade > 0.7 ? team[0] : team[1], k);
        lump(m, x, y, r - 1, fade > 0.7 ? team[1] : team[2], k);
        if (fade < 0.5) disc(m, x - 1, y - 1, r * 0.45, team[3]);
      }
      if (fade < 0.45) lump(m, c, c, reach * (0.3 - fade * 0.5), WHITE, 2.0);
    }
    // Pieces of the victim: wing shards (pale) and shell (dark team colour), flung out and pulled down.
    if (i > 0)
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2 + 0.2 + hash(k, 7);
        const speed = 0.75 + 0.45 * hash(k, 8);
        const d = reach * Math.min(1.05, (0.25 + t * 0.95) * speed);
        const x = Math.round(c + Math.cos(a) * d);
        const y = Math.round(c + Math.sin(a) * d + t * t * reach * 0.35);
        const wing = k % 3 !== 0;
        const turn = (i + k) % 2 === 0;
        const big = t < 0.75;
        if (wing) {
          rect(m, x, y, turn ? 3 : 2, turn ? 2 : 3, big ? ICE : FROST);
          if (big) put(m, x, y, WHITE);
        } else {
          rect(m, x, y, big ? 3 : 2, big ? 3 : 2, team[1]);
          put(m, x, y, team[3]);
          if (big) put(m, x + 2, y + 2, team[0]);
        }
      }
    // Sparks while the flash is young.
    if (t < 0.5)
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + 0.9;
        const d = reach * (0.55 + t);
        star(
          m,
          Math.round(c + Math.cos(a) * d),
          Math.round(c + Math.sin(a) * d),
          1,
          team[3],
          WHITE,
        );
      }
    return m;
  });

/** A kill: a chunky explosion in the victim's colour, bigger than a unit at its peak. 48 by 48, 8 frames. */
export const killBurst = (team: Ramp): Img[] => explosion(team, 48, 8);

const CROWN = fromRows(
  ["G..G..G", "G.GGG.G", "GGGGGGG", "ggwgwgg", "ooooooo"],
  { G: GOLD[3], g: GOLD[2], o: GOLD[1], w: WHITE },
);

/** A Queen's death: a bigger explosion, her crown thrown clear and tumbling down. 64 by 64, 10 frames. */
export const queenDeath = (team: Ramp): Img[] =>
  explosion(team, 64, 10).map((m, i) => {
    const t = i / 9;
    const x = Math.round(28 + t * 10);
    const y = Math.round(26 - Math.sin(t * Math.PI * 0.85) * 24 + t * 6);
    const crown = img(9, 7);
    blit(crown, CROWN, 1, 1, i % 4 >= 2);
    // A dark rim keeps the crown readable against the flash.
    for (let cy = 0; cy < 7; cy++)
      for (let cx = 0; cx < 9; cx++)
        if (
          !alpha(crown, cx, cy) &&
          (alpha(crown, cx - 1, cy) ||
            alpha(crown, cx + 1, cy) ||
            alpha(crown, cx, cy - 1) ||
            alpha(crown, cx, cy + 1))
        )
          put(m, x + cx, y + cy, VOID);
    blit(m, crown, x, y);
    return m;
  });

/**
 * A unit arriving: a column of the team's light drops onto the spot, narrows and leaves rising glints. 24 by 36,
 * 7 frames; anchored at the feet, drawn over the unit.
 */
export const respawn = (team: Ramp): Img[] =>
  Array.from({ length: 7 }, (_, i) => {
    const m = img(24, 36);
    const half = [1, 4, 7, 5, 3, 1, 0][i] ?? 0;
    const top = [0, 0, 0, 0, 6, 14, 36][i] ?? 36;
    for (let y = top; y < 34; y++)
      for (let dx = -half; dx < half; dx++) {
        const edge = Math.min(dx + half, half - 1 - dx);
        // The column comes to a point at the top and is brightest up the middle.
        if (y - top < half - 1 - edge) continue;
        put(m, 12 + dx, y, edge === 0 ? team[2] : edge < 3 ? team[3] : WHITE);
      }
    // The pool of light at the feet.
    const pool = [3, 7, 10, 11, 10, 8, 5][i] ?? 0;
    rect(m, 12 - pool, 34, pool * 2, 1, i < 5 ? team[3] : team[2]);
    rect(m, 12 - pool + 2, 35, pool * 2 - 4, 1, team[1]);
    if (i > 1)
      for (let k = 0; k < 6; k++) {
        const x = 3 + Math.floor(hash(k, 11) * 18);
        const y = 30 - Math.floor((i - 1) * (3 + hash(k, 12) * 3)) - k * 2;
        if (y < 1) continue;
        if ((i + k) % 2) star(m, x, y, 1, team[3], WHITE);
        else put(m, x, y, WHITE);
      }
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

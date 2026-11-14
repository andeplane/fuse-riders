/**
 * Killer Fuse's units and props at arcade scale, pixelled by hand: a Worker is 8 by 13 on a 480 by 270 screen, so
 * every pixel is placed here rather than generated. Units are drawn without their outline in a team ramp the caller
 * passes (the pipeline passes its stand-in green and recolours per team); `scripts/killer-fuse-art.ts` outlines
 * them and lays them out into sheets.
 */
import {
  CREAM,
  FROST,
  GOLD,
  ICE,
  INK,
  LIME,
  NAVY,
  TEAMS,
  VIOLET,
  WHITE,
  type Ramp,
} from "./assets.ts";
import {
  blit,
  crop,
  fromRows,
  img,
  put,
  rect,
  type Img,
  type Rgb,
} from "./pixel.ts";

const VOID = NAVY.void;

/** Deterministic noise in [0, 1) from two integers. */
const hash = (a: number, b: number) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ---------------------------------------------------------------------------------------------------------------
// Units

/**
 * A body in three stacked parts, facing right. Letters: 0-3 the team ramp (dark to light), k the visor, w the eye,
 * A the antennae, horns or crest tip and B the boots (both gold on speed units).
 */
interface Body {
  head: readonly string[];
  /** The same head with the eyes shut. */
  blink?: readonly string[];
  /** The same head with the antennae spread, for the idle twitch. */
  twitch?: readonly string[];
  torso: readonly string[];
  /** The torso when standing still: hands on hips, elbows out. */
  akimbo?: readonly string[];
  legs: Record<string, readonly string[]>;
}

const WORKER: Body = {
  head: [".A..A.", ".3333.", "333333", "2kwkwk", "222222"],
  blink: [".A..A.", ".3333.", "333333", "2kkkkk", "222222"],
  twitch: ["A....A", ".3333.", "333333", "2kwkwk", "222222"],
  torso: [".2222.", "122223", "122222"],
  akimbo: ["122223", "1.22.3", ".2222."],
  legs: {
    stand: [".1111.", ".1..1.", ".B..B."],
    a: [".1111.", "11..11", "B....B"],
    b: [".1111.", "..11..", "..BB.."],
    c: [".1111.", ".1.11.", "B...B."],
    d: [".1111.", "..11..", "..B..."],
    air: [".1111.", ".1..1.", "B....B"],
    tuck: ["11..11", ".B..B.", "......"],
  },
};

const WARRIOR: Body = {
  head: [
    "A....A..",
    ".A..A...",
    ".333333.",
    "33333333",
    "2kkkkwwk",
    "22222222",
  ],
  torso: [".222222.", "12222223", "12222222", "11222221", ".111111."],
  legs: {
    stand: [".11..11.", ".11..11.", ".11..11.", ".BB..BB."],
    a: [".11..11.", "11....11", "1......1", "B......B"],
    b: ["..1111..", "...11...", "...11...", "...BB..."],
    c: [".11..11.", ".11.11..", "11...1..", "B....BB."],
    d: ["..1111..", "...11...", "...11...", "...B...."],
    air: ["..1111..", ".11.11..", ".1..1...", "B..B...."],
    tuck: [".11..11.", "11...11.", ".B....B.", "........"],
    // A lunge: the back leg stretched out behind, the front knee bent.
    lunge: [".11..11.", "11....11", "1......1", "B......B"],
  },
};

const QUEEN: Body = {
  head: [
    "33.....",
    "3333...",
    ".23333.",
    ".333333",
    "2333333",
    "2kkkwwk",
    "2222222",
  ],
  torso: [".22222.", "1222223", "1222222", ".12222.", ".11111."],
  legs: {
    stand: [".1...1.", ".1...1.", ".1...1.", ".B...B."],
    a: [".1...1.", "11...11", "1.....1", "B.....B"],
    b: ["..111..", "...1...", "...1...", "...B..."],
    c: [".1...1.", ".1..1..", "1...1..", "B...BB."],
    d: ["..111..", "...1...", "...1...", "..B...."],
    air: ["..111..", ".1.1...", ".1.1...", "B.B...."],
    tuck: [".1...1.", "11..11.", ".B...B.", "......."],
  },
};

/**
 * A wing: W white, I ice, F frost. `root` is the pixel that sits on the body's back column at the shoulder; `front`
 * is the tip of the far wing showing ahead of the chest.
 */
interface Wing {
  rows: readonly string[];
  root: readonly [number, number];
  front?: readonly string[];
}

const WARRIOR_UP = ["WW..", "WWW.", "WIW.", ".IIW", ".FIW", "..FI"];
const WARRIOR_WINGS: Record<string, Wing> = {
  up: { rows: WARRIOR_UP, root: [3, 5] },
  down: { rows: [...WARRIOR_UP].reverse(), root: [3, 0] },
  mid: { rows: ["WWWW", "WIII", ".FF."], root: [3, 1], front: ["WW", "I."] },
  swept: { rows: ["W...", "WWW.", ".IIW", "..FI"], root: [3, 3] },
  folded: { rows: [".W.", "WI.", "WI.", "WF.", "F.."], root: [2, 0] },
};

const QUEEN_UP = [
  "WWW....",
  "WWWW...",
  "WIIWW..",
  ".WIIW..",
  ".WIIIW.",
  "..FIIW.",
  "...FIIW",
  "....FFI",
  "..WIIF.",
  ".WIF...",
];
const QUEEN_WINGS: Record<string, Wing> = {
  up: { rows: QUEEN_UP, root: [6, 7] },
  down: { rows: [...QUEEN_UP].reverse(), root: [6, 2] },
  mid: {
    rows: [".WWWWW.", "WWIIIWW", "WIIIIII", ".FFFF..", "..WIIF.", ".WIF..."],
    root: [6, 2],
  },
  swept: {
    rows: ["WW.....", "WWWW...", ".WIIWW.", "..FIIIW", "....FFI"],
    root: [6, 4],
  },
  folded: {
    rows: ["..W.", ".WW.", ".WI.", "WII.", "WIF.", "WF..", "F..."],
    root: [3, 0],
  },
};

export interface UnitFrame {
  name: string;
  legs: string;
  wing?: string;
  /**
   * How the sword is held: level at the waist, low (forward and down from the hip), up (diagonally up and forward),
   * raised (straight up over the head, leaving a gate) or thrust (level at arm's length, `thrust` pixels long).
   */
  sword?: "level" | "low" | "up" | "raised" | "thrust";
  /** Pixels the whole body is thrown forward (a lunge). */
  lean?: number;
  /** Drawn from the spec's `dash` rows instead of its parts. */
  dash?: boolean;
  /** The antennae spread (the idle twitch). */
  twitch?: boolean;
  /** Drawn from the spec's `dive` rows instead of its parts. */
  dive?: boolean;
  blink?: boolean;
  /** A berry on the back. */
  carry?: boolean;
}

export interface UnitSpec {
  body: Body;
  cell: readonly [number, number];
  /** Rows of the cell below the feet, for a diving sword. */
  below?: number;
  /**
   * The dive as one narrow column, wings folded flat up the back; its first row is one above the head, and the
   * sword hangs straight down under it.
   */
  dive?: readonly string[];
  /**
   * The attack as one level body flying forward, wings streaming over the back: its last four rows are the body,
   * and the sword goes straight on from its front.
   */
  dash?: readonly string[];
  /** Blade length of a thrust, past the outstretched hand. */
  thrust?: number;
  /** A plume sweeping back from the top of the head (the Queen's crest). */
  crest?: readonly string[];
  wings?: Record<string, Wing>;
  /** Blade length in pixels past the body. */
  blade?: number;
  /** A striped abdomen behind the hips (the Queen). */
  abdomen?: boolean;
  frames: readonly UnitFrame[];
  animations: Record<
    string,
    { frames: readonly string[]; fps: number; loop: boolean }
  >;
}

const flier = (queen: boolean): UnitFrame[] => {
  // On the ground a warrior holds his sword diagonally up and forward and the Queen rests hers low; both fly with
  // it level at the waist, pointing forward.
  const rest = queen ? "low" : "up";
  const walk = ["a", "b", "c", "d"].map((legs, i): UnitFrame => ({
    name: `walk${i + 1}`,
    legs,
    wing: "folded",
    sword: rest,
  }));
  return [
    { name: "idle", legs: "stand", wing: "folded", sword: rest },
    { name: "flapUp", legs: "air", wing: "up", sword: "level" },
    { name: "flapMid", legs: "air", wing: "mid", sword: "level" },
    { name: "flapDown", legs: "air", wing: "down", sword: "level" },
    { name: "glide", legs: "tuck", wing: "swept", sword: "level" },
    // Only the Queen dives.
    ...(queen ? [{ name: "dive", legs: "tuck", dive: true }] : []),
    ...walk,
    // The attack: a warrior lunges behind his sword, the Queen dashes level behind hers.
    queen
      ? { name: "attack", legs: "tuck", dash: true }
      : {
          name: "attack",
          legs: "lunge",
          wing: "swept",
          sword: "thrust",
          lean: 2,
        },
  ];
};

const FLY = {
  idle: { frames: ["idle"], fps: 1, loop: false },
  fly: {
    frames: ["flapUp", "flapMid", "flapDown", "flapMid"],
    fps: 16,
    loop: true,
  },
  glide: { frames: ["glide"], fps: 1, loop: false },
  walk: { frames: ["walk1", "walk2", "walk3", "walk4"], fps: 12, loop: true },
  attack: { frames: ["attack"], fps: 1, loop: false },
};

/** The Queen's attack: a level dash, 17 wide and 4 tall, her wings a streak over her back. */
const QUEEN_DASH = [
  "..WWWWWW.........",
  ".WIIIIFF.233.....",
  "31312222222333333",
  "13112222222kkkwwk",
  "31312222222222222",
  "B1.1111111.22222.",
];

/** The Queen's dive: a column five wide, her wings a streak up her back. */
const QUEEN_DIVE = [
  "W....",
  "W.33.",
  "WI333",
  "WI333",
  "WI233",
  "II2kw",
  "I.222",
  "F.222",
  "F1222",
  ".1222",
  ".1222",
  "..122",
  "..111",
  "..11.",
  "..11.",
  "..1B.",
  "..B..",
];

const WORKER_POSES: UnitFrame[] = [
  { name: "idle", legs: "stand" },
  { name: "run1", legs: "a" },
  { name: "run2", legs: "b" },
  { name: "run3", legs: "c" },
  { name: "run4", legs: "d" },
  { name: "jump", legs: "air" },
  { name: "fall", legs: "tuck" },
  { name: "blink", legs: "stand", blink: true },
  { name: "idle2", legs: "stand", twitch: true },
];

/** The Worker's idle at 80 ms a frame: two seconds with two antenna twitches and a blink. */
const WORKER_IDLE = [
  ...Array<string>(8).fill("idle"),
  "idle2",
  "idle2",
  ...Array<string>(8).fill("idle"),
  "idle2",
  "idle2",
  ...Array<string>(3).fill("idle"),
  "blink",
  "blink",
];

export const UNIT_SPECS: Record<"worker" | "warrior" | "queen", UnitSpec> = {
  worker: {
    body: WORKER,
    cell: [14, 14],
    frames: [
      ...WORKER_POSES,
      ...WORKER_POSES.map((pose) => ({
        ...pose,
        name: `${pose.name}Carry`,
        carry: true,
      })),
    ],
    animations: {
      idle: { frames: WORKER_IDLE, fps: 12.5, loop: true },
      // 70 ms a frame (14.3 fps), kept exact so a whole loop comes round to its first frame.
      run: {
        frames: ["run1", "run2", "run3", "run4"],
        fps: 1000 / 70,
        loop: true,
      },
      jump: { frames: ["jump"], fps: 1, loop: false },
      fall: { frames: ["fall"], fps: 1, loop: false },
    },
  },
  warrior: {
    body: WARRIOR,
    // Wide enough for the lunge: the sword's tip is 14 pixels ahead of the anchor.
    cell: [31, 18],
    wings: WARRIOR_WINGS,
    blade: 4,
    thrust: 8,
    frames: flier(false),
    animations: FLY,
  },
  queen: {
    body: QUEEN,
    // Wide enough for the dash: the sword's tip is 15 pixels ahead of the anchor.
    cell: [33, 24],
    below: 5,
    dash: QUEEN_DASH,
    wings: QUEEN_WINGS,
    blade: 7,
    abdomen: true,
    dive: QUEEN_DIVE,
    crest: ["33.", "233", ".23"],
    frames: flier(true),
    animations: { ...FLY, dive: { frames: ["dive"], fps: 1, loop: false } },
  },
};

/** Where a unit's body starts in its cell, and the row of its shoulder. */
export const unitLayout = (spec: UnitSpec) => {
  const [cw, ch] = spec.cell;
  const width = spec.body.torso[0]?.length ?? 0;
  const height =
    spec.body.head.length +
    spec.body.torso.length +
    (spec.body.legs.stand?.length ?? 0);
  const x = Math.floor(cw / 2) - Math.floor(width / 2);
  const y = ch - 1 - (spec.below ?? 0) - height;
  return { x, y, width, torso: y + spec.body.head.length };
};

/** Top-left corner of the carried berry's 5 by 5 cell in a worker frame. */
export const carrySpot = (): [number, number] => {
  const at = unitLayout(UNIT_SPECS.worker);
  return [at.x - 4, at.torso - 1];
};

/**
 * One frame of a unit in `team`'s colours, without its outline; `speed` turns the trim gold, and `bare` leaves out
 * the wings, sword and berry.
 */
export const unitFrame = (
  spec: UnitSpec,
  pose: UnitFrame,
  team: Ramp,
  speed: boolean,
  bare = false,
): Img => {
  const [cw, ch] = spec.cell;
  const cell = img(cw, ch);
  const at = unitLayout(spec);
  const key: Record<string, Rgb> = {
    "0": team[0],
    "1": team[1],
    "2": team[2],
    "3": team[3],
    k: INK,
    w: WHITE,
    A: speed ? GOLD[2] : team[3],
    B: speed ? GOLD[2] : team[0],
    W: WHITE,
    I: ICE,
    F: FROST,
    h: LIME[3],
    b: LIME[2],
    s: LIME[1],
  };
  const middle = at.x + Math.floor(at.width / 2);
  const feet = at.torso + spec.body.torso.length;
  const blade = (i: number, length: number) =>
    i === 0 ? FROST : i === length - 1 ? ICE : WHITE;
  if (pose.dive && spec.dive) {
    const rows = fromRows(spec.dive, key);
    blit(cell, rows, middle - Math.floor(rows.w / 2), at.y - 1);
    // The sword straight down under the body, its tip four pixels below the feet.
    if (!bare)
      for (let i = 0; i < 4; i++)
        put(cell, middle + 1, at.y - 1 + rows.h + i, blade(i, 4));
    return cell;
  }
  if (pose.dash && spec.dash) {
    const rows = fromRows(spec.dash, key);
    const left = middle - Math.floor(rows.w / 2);
    // The four body rows sit round the middle of the standing body.
    const top = at.y + Math.floor((feet + 4 - at.y) / 2) - rows.h + 2;
    blit(cell, rows, left, top);
    if (spec.blade && !bare)
      for (let i = 0; i < spec.blade; i++)
        put(cell, left + rows.w + i, top + rows.h - 2, blade(i, spec.blade));
    return cell;
  }
  const lean = pose.lean ?? 0;
  const shoulder = at.torso + 1;
  const wing = pose.wing && !bare ? spec.wings?.[pose.wing] : undefined;
  if (wing)
    blit(
      cell,
      fromRows(wing.rows, key),
      at.x + lean - wing.root[0],
      shoulder - wing.root[1],
    );
  if (wing?.front)
    blit(cell, fromRows(wing.front, key), at.x + lean + at.width, shoulder - 1);
  if (spec.abdomen)
    blit(cell, fromRows([".3", "31", "13"], key), at.x - 2, at.torso + 2);
  if (spec.crest) blit(cell, fromRows(spec.crest, key), at.x - 2, at.y);
  if (pose.carry && !bare)
    blit(cell, fromRows(["hbb", "bbb", "sbb"], key), at.x - 3, at.torso);
  const legs = spec.body.legs[pose.legs];
  if (!legs) throw new Error(`no legs ${pose.legs}`);
  const head =
    (pose.blink
      ? spec.body.blink
      : pose.twitch
        ? spec.body.twitch
        : undefined) ?? spec.body.head;
  const torso =
    pose.legs === "stand"
      ? (spec.body.akimbo ?? spec.body.torso)
      : spec.body.torso;
  blit(cell, fromRows([...head, ...torso, ...legs], key), at.x + lean, at.y);
  if (spec.blade && pose.sword && !bare) {
    const hand = feet - 2;
    const front = at.x + lean + at.width;
    if (pose.sword === "thrust") {
      // The arm straight out, then the blade.
      const length = spec.thrust ?? spec.blade;
      put(cell, front, hand, team[3]);
      for (let i = 0; i < length; i++)
        put(cell, front + 1 + i, hand, blade(i, length));
      return cell;
    }
    for (let i = 0; i < spec.blade; i++) {
      const c = blade(i, spec.blade);
      if (pose.sword === "level") put(cell, front + i, hand, c);
      else if (pose.sword === "low")
        put(cell, front + i, hand + Math.floor((i + 1) / 2), c);
      else if (pose.sword === "up") put(cell, front + i, hand - 1 - i, c);
      else put(cell, middle, at.y - 1 - i, c);
    }
  }
  return cell;
};

// ---------------------------------------------------------------------------------------------------------------
// Berries and piles

const BERRY_KEY: Record<string, Rgb> = {
  h: LIME[3],
  b: LIME[2],
  s: LIME[1],
  d: LIME[0],
};

const BERRY = [".hbb.", "hbbbs", "bbbbs", "bbbsd", ".ssd."];

/** The berry, 5 by 5 with its own dark rim (no outline): on a pile, carried, and two rolling frames. */
export const berries = (): Img[] =>
  [
    BERRY,
    BERRY,
    [".bbs.", "bbbbs", "hbbbd", "bhbsd", ".bss."],
    [".ssd.", "bbbsd", "bbbbs", "hbbbs", ".hbb."],
  ].map((rows) => fromRows(rows, BERRY_KEY));

/**
 * Top-left corners of a pile's six berries (5 by 5 each), stacked 3-2-1; the first `n` are the ones left when `n`
 * remain, so the top berry goes first.
 */
export const PILE = {
  cell: [27, 18] as const,
  slots: [
    [6, 9],
    [11, 9],
    [16, 9],
    [9, 5],
    [14, 5],
    [11, 1],
  ] as readonly (readonly [number, number])[],
};

/** A berry pile with `count` berries left (0 to 6) on its leaf, without its outline. */
export const pile = (count: number): Img => {
  const [w, h] = PILE.cell;
  const m = img(w, h);
  // The leaf: 25 wide, flat under the berries, its two tips curling up.
  for (let x = 1; x < w - 1; x++) {
    const dx = Math.abs(x - 13);
    const top = 13 - Math.max(0, Math.floor((dx - 7) / 3));
    const bottom = 16 - Math.floor(dx / 3.5);
    for (let y = top; y <= Math.max(top, bottom); y++)
      put(
        m,
        x,
        y,
        y === top ? VIOLET[3] : y === top + 1 ? VIOLET[2] : VIOLET[1],
      );
  }
  rect(m, 13, 14, 1, 3, VIOLET[0]);
  const berry = berries()[0] ?? img(1, 1);
  PILE.slots.slice(0, count).forEach(([x, y]) => blit(m, berry, x, y));
  return m;
};

// ---------------------------------------------------------------------------------------------------------------
// Hive

/** The three hive walls, by the map's time of day: width and height including the outline. */
export const HIVE_SIZES = {
  day: [54, 54],
  dusk: [59, 79],
  night: [85, 51],
} as const;

/**
 * The day map's hole centres relative to the hive's anchor (bottom centre, on the floor), for Cyan: five columns of
 * 2-3-2-3-2. Only the mock scene uses them; in the game the engine places the holes.
 */
export const HIVE_HOLES: readonly (readonly [number, number])[] = [
  -14, -7, 0, 7, 14,
].flatMap((x, column) =>
  (column % 2 ? [14, 24, 34] : [19, 29]).map((up): [number, number] => [
    x,
    -up,
  ]),
);

const HOLE_ROWS = [".xxx.", "xxxxx", "xxxxx", "xxxxx", ".xxx."];

/** A hive hole, 5 by 5: empty, or holding a berry. */
export const hiveHole = (filled: boolean): Img =>
  filled ? fromRows(BERRY, BERRY_KEY) : fromRows(HOLE_ROWS, { x: VOID });

/** A hive: a flat wall in the team's colour, standing on the floor; the holes are drawn over it. */
export const hive = (team: Ramp, [w, h]: readonly [number, number]): Img => {
  const m = img(w, h);
  // The bottom row stays empty: it is the anchor row, which lands on the floor.
  rect(m, 0, 0, w, h - 1, VOID);
  rect(m, 1, 1, w - 2, h - 2, team[1]);
  rect(m, 2, 2, w - 4, h - 3, team[0]);
  // A lit top edge, and short strokes of grain so the wall is not a flat block.
  rect(m, 1, 1, w - 2, 1, team[2]);
  for (let y = 4; y < h - 3; y += 3)
    for (let x = 3; x < w - 5; x++)
      if (hash(x, y) < 0.16)
        rect(m, x, y, 2 + Math.floor(hash(y, x) * 2), 1, team[1]);
  return m;
};

// ---------------------------------------------------------------------------------------------------------------
// Eggs

const EGG: Record<string, readonly string[]> = {
  full: [
    "...WW...",
    "..WWWw..",
    ".WWWwww.",
    ".WWwwww.",
    "WWWwwwwi",
    "WWwwwwwi",
    "tWwwtwti",
    "wttwttwt",
    "wwtwwtii",
    "wwwwwwii",
    "wwwwwiii",
    ".wwwiii.",
    ".iiiiif.",
    "..ifff..",
  ],
  cracked: [
    "...WW...",
    "..WWxw..",
    ".WWxwww.",
    ".WWwxww.",
    "WWWxwwwi",
    "WWxwwxwi",
    "tWxwtxti",
    "wtxxttxt",
    "wwtxwxii",
    "wwxwwxii",
    "wxwwwixi",
    ".wwxiii.",
    ".iiixif.",
    "..ifff..",
  ],
  broken: [
    "........",
    "........",
    "........",
    "........",
    "........",
    "........",
    "........",
    "W..w..i.",
    "wW.wi.ii",
    "wwwwwiii",
    "wxxxxxxi",
    ".wxxxxi.",
    ".iiiiif.",
    "..ifff..",
  ],
};

/** A Queen's egg standing on the hive floor, 8 by 14 without its outline: whole, cracked, or hatched. */
export const egg = (team: Ramp, state: "full" | "cracked" | "broken"): Img => {
  // A whole egg glows warm yellow; a cracked one has dimmed and a shell is dull.
  const [light, body, shade, foot] =
    state === "full"
      ? [CREAM, GOLD[3], GOLD[2], GOLD[1]]
      : state === "cracked"
        ? [GOLD[3], GOLD[2], GOLD[1], GOLD[0]]
        : [GOLD[2], GOLD[1], GOLD[0], NAVY.steel];
  return fromRows(EGG[state] ?? [], {
    W: light,
    w: body,
    i: shade,
    f: foot,
    t: state === "full" ? team[2] : team[1],
    x: VOID,
  });
};

// ---------------------------------------------------------------------------------------------------------------
// Military victory

const FALLEN = [
  ".........VV.........",
  ".........VV.........",
  ".......vVVVVv.......",
  ".........WI.........",
  ".........WI.........",
  ".........WI.........",
  "..WII....WI..233....",
  ".3131222.WI.2333333.",
  ".1311222.WI.22kkkkk.",
  ".3131222222222222222",
  ".B1.1111111.22222...",
];

/** The military win: `team`'s Queen lying dead, eyes shut, a sword planted through her. 22 by 13 with its rim. */
export const fallenQueen = (team: Ramp): Img =>
  fromRows(FALLEN, {
    "1": team[1],
    "2": team[2],
    "3": team[3],
    k: INK,
    B: team[0],
    W: WHITE,
    I: ICE,
    V: VIOLET[3],
    v: VIOLET[2],
  });

// ---------------------------------------------------------------------------------------------------------------
// Gates

export const GATE = {
  cell: [35, 28] as const,
  kinds: ["warrior", "speed"] as const,
};

const WING_ROWS = [
  "...........hO",
  ".........hhOO",
  ".....hhhhOOO.",
  "..hhhhOOOOOo.",
  "hhhOOOOOOOo..",
  "hOOOOOOOoo...",
  "OOOOOOooo....",
  "OOOOooo......",
  "OOooo........",
  "oo...........",
];

/**
 * A gate without its outline: two light stone pillars with a dark alcove a Worker stands in, under a wing pair
 * (warrior) or crossed blades (speed) around a socket. The ornament is white until a team claims the gate; in use,
 * the socket holds the berry and the alcove glows.
 */
export const gate = (
  kind: "warrior" | "speed",
  owner: keyof typeof TEAMS,
  active: boolean,
): Img => {
  const [w, h] = GATE.cell;
  const m = img(w, h);
  const cx = Math.floor(w / 2);
  const stone = TEAMS.neutral;
  const ramp = TEAMS[owner];
  const neutral = owner === "neutral";
  const key: Record<string, Rgb> = {
    O: neutral ? WHITE : ramp[2],
    o: neutral ? FROST : ramp[1],
    h: neutral ? WHITE : ramp[3],
  };
  const base = h - 2;
  const top = base - 12;
  // Pillars: a tall tower outside, a lower shoulder inside, 21 wide and 13 tall.
  for (let dx = 0; dx <= 10; dx++) {
    const from =
      dx >= 7
        ? top + (dx === 9 ? 0 : dx === 7 ? 2 : 1)
        : dx >= 5
          ? top + 5
          : -1;
    const c = dx === 9 ? stone[3] : dx === 7 || dx === 5 ? stone[1] : stone[2];
    for (const x of [cx - dx, cx + dx]) {
      if (from < 0) {
        // The alcove, arched at the top.
        const arch = top + (dx === 4 ? 5 : dx === 3 ? 4 : 3);
        for (let y = arch; y <= base; y++)
          put(m, x, y, active ? (neutral ? NAVY.slate : ramp[0]) : INK);
        continue;
      }
      for (let y = from; y <= base; y++) put(m, x, y, c);
    }
  }
  for (const x of [cx - 9, cx + 9]) rect(m, x, top + 5, 1, 2, stone[1]);
  rect(m, cx - 10, base, 4, 1, stone[1]);
  rect(m, cx + 7, base, 4, 1, stone[1]);
  // The ornament.
  const socketY = kind === "warrior" ? top - 5 : top - 9;
  if (kind === "warrior") {
    const wing = fromRows(WING_ROWS, key);
    blit(m, wing, cx + 3, top - 10);
    blit(m, wing, cx - 2 - wing.w, top - 10, true);
  } else {
    const cy = socketY + 2;
    for (let dx = -10; dx <= 10; dx++) {
      const rise = Math.round(Math.abs(dx) * 0.5);
      // Blades above the crossing, hilts below it.
      put(m, cx + dx, cy - rise, key.O ?? WHITE);
      put(m, cx + dx, cy - rise - 1, key.h ?? WHITE);
      if (Math.abs(dx) <= 8) {
        put(m, cx + dx, cy + rise, key.o ?? WHITE);
        put(m, cx + dx, cy + rise + 1, key.o ?? WHITE);
      }
    }
    for (const side of [-1, 1])
      rect(m, cx + side * 6 - 1, cy + 2, 3, 1, key.O ?? WHITE);
  }
  // The socket between them: a ring, holding the berry while the gate is in use.
  blit(
    m,
    fromRows([".ooo.", "oxxxo", "oxxxo", "oxxxo", ".ooo."], {
      o: key.o ?? WHITE,
      x: VOID,
    }),
    cx - 2,
    socketY,
  );
  if (active) blit(m, berries()[0] ?? img(1, 1), cx - 2, socketY);
  return m;
};

/** The cell of a warrior leaving a gate: a gate's cell with room above it. */
export const EMERGE = { cell: [35, 40] as const, frames: 6 };

/**
 * A new warrior rising out of the top of a warrior gate, sword first, with chips of stone thrown off the pillars:
 * six frames without their outline, drawn over the gate and anchored like it. The warrior is cut off at the gate's
 * top, so it appears to come out of it.
 */
export const emerge = (team: Ramp, speed: boolean): Img[] => {
  const [w, h] = EMERGE.cell;
  const cx = Math.floor(w / 2);
  // The row the warrior comes out of: just inside the top of the pillars.
  const lip = h - 2 - 12 + 3;
  const spec: UnitSpec = { ...UNIT_SPECS.warrior, cell: [19, 24] };
  const tip = unitLayout(spec).y - 1 - (spec.blade ?? 0);
  const stone = TEAMS.neutral;
  return [3, 7, 11, 15, 19, 22].map((risen, i) => {
    const m = img(w, h);
    const pose: UnitFrame = {
      name: "emerge",
      legs: "air",
      wing: (["folded", "folded", "folded", "up", "mid", "down"] as const)[i],
      sword: "raised",
    };
    const unit = unitFrame(spec, pose, team, speed);
    const top = lip - risen - tip;
    blit(m, crop(unit, 0, 0, unit.w, Math.min(unit.h, lip - top)), cx - 9, top);
    // Chips of stone: thrown up and out from the lip, then falling.
    const t = i + 1;
    for (let k = 0; k < 10; k++) {
      const side = k % 2 ? 1 : -1;
      const x =
        cx +
        side * Math.round(3 + hash(k, 1) * 4 + t * (0.8 + hash(k, 2) * 1.4));
      const y = Math.round(lip - 1 - t * (1.5 + hash(k, 3) * 2) + t * t * 0.35);
      if (y >= h - 2 || y < 1 || x < 1 || x > w - 2) continue;
      if (i > 3 && k % 3 === 0) continue;
      put(m, x, y, k % 3 === 0 ? WHITE : (stone[k % 2 ? 3 : 2] ?? WHITE));
    }
    return m;
  });
};

// ---------------------------------------------------------------------------------------------------------------
// Snail goal

/**
 * A snail goal without its outline: a net cage in the team's colour, 27 by 17, open towards the middle of the arena
 * (the right).
 */
export const goalNet = (team: Ramp): Img => {
  const w = 27;
  const h = 17;
  const m = img(w, h);
  // A dome that leans away from its mouth: steep at the back, sloping down to the front.
  const inside = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const fx = (x - 9) / (x < 9 ? 9.5 : 17.5);
    const fy = (h - 1 - y) / 16.5;
    return fx * fx + fy * fy <= 1;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const rim =
        !inside(x - 1, y) ||
        !inside(x + 1, y) ||
        !inside(x, y - 1) ||
        y === h - 1;
      if (rim) put(m, x, y, y < 5 ? team[3] : team[2]);
      else if (x % 4 === 1) put(m, x, y, team[1]);
      else if (y % 4 === 0) put(m, x, y, team[1]);
      else put(m, x, y, NAVY.deep);
    }
  return m;
};

/** Composed concept scenes: the battlefield, the title screen, unit cards, factory scenes and map thumbnails. */
import { boom, flame, hpBar, puffs, selRing, tracer } from "./effects.js";
import { Img } from "./image.js";
import { hash } from "./noise.js";
import { BIOME, type BiomeId, TEAM, type TeamId } from "./palette.js";
import { bevel } from "./shape.js";
import { type FactoryKind, factory, flag, fort, turret } from "./structures.js";
import {
  blob,
  bridge,
  crater,
  plateau,
  river,
  scorch,
  terrain,
  tree,
} from "./terrain.js";
import {
  BRICK,
  GRUNT,
  LONG,
  TORCH,
  VIX,
  buggy,
  crate,
  robot,
  tank,
} from "./units.js";

/** Draw calls queued with their ground line so nearer things (larger y) paint over farther ones. */
class DepthQueue {
  private readonly items: { y: number; draw: () => void }[] = [];

  add(y: number, draw: () => void): void {
    this.items.push({ y, draw });
  }

  /** Draws in ground-line order; ties keep insertion order. */
  flush(): void {
    this.items.sort((a, b) => a.y - b.y).forEach((t) => t.draw());
  }
}

/** The 480×228 Dust Basin battle: two bases across a river, a red push over the bridge. */
export function battlefield(): Img {
  const img = new Img(480, 228);
  const B = BIOME.desert;
  terrain(img, B, 3);
  plateau(img, B, 5, "left", 138, 62);
  plateau(img, B, 6, "right", 342, 62);
  river(img, B, 4, (y) => 240 + Math.sin(y / 22) * 10, 16);
  bridge(img, 221, 118, 26, 10);
  // prettier-ignore
  for (const [x, y, a, b] of [[160, 100, 6, 3], [262, 162, 6, 3], [226, 50, 7, 3], [318, 150, 5, 3], [190, 188, 5, 3], [70, 200, 6, 3]] as const)
    crater(img, B, x, y, a, b, x);
  // prettier-ignore
  for (const [x, y, a, b] of [[252, 110, 10, 6], [268, 128, 8, 5], [150, 168, 12, 6], [322, 178, 11, 6], [200, 130, 9, 4]] as const)
    scorch(img, x, y, a, b, y);
  // prettier-ignore
  for (const [x, y, a, b] of [[170, 70, 9, 5], [58, 114, 11, 6], [130, 212, 9, 5], [342, 214, 10, 6], [452, 114, 10, 6], [205, 200, 7, 4], [394, 124, 6, 4], [22, 204, 8, 5], [165, 34, 8, 5], [316, 30, 8, 5], [92, 30, 6, 4], [384, 32, 7, 4]] as const)
    blob(img, x, y, a, b, B.rock, x + y);
  const q = new DepthQueue();
  q.add(56, () => fort(img, 12, 6, "red"));
  q.add(56, () => fort(img, 410, 6, "blue"));
  q.add(112, () => factory(img, 80, 80, "red", "robot"));
  q.add(182, () => factory(img, 34, 150, "red", "vehicle"));
  q.add(112, () => factory(img, 360, 80, "blue", "robot"));
  q.add(182, () => factory(img, 398, 150, "blue", "vehicle"));
  q.add(206, () => factory(img, 290, 174, "neutral", "robot"));
  q.add(40, () => turret(img, 124, 40, "red", 1));
  q.add(40, () => turret(img, 356, 40, "blue", -1));
  q.add(150, () => turret(img, 182, 148, "red", 1));
  const flags: readonly (readonly [number, number, TeamId])[] = [
    [134, 98, "red"],
    [96, 196, "red"],
    [196, 152, "red"],
    [176, 58, "red"],
    [342, 98, "blue"],
    [388, 198, "blue"],
    [304, 62, "blue"],
    [284, 214, "neutral"],
    [214, 142, "red"],
  ];
  for (const [x, y, tm] of flags) q.add(y, () => flag(img, x, y, tm));
  q.add(168, () => {
    tank(img, 142, 160, "wreck", { dir: 1 });
    puffs(img, 150, 156, 5, 7);
  });
  q.add(186, () => {
    tank(img, 314, 172, "wreck", { dir: -1 });
    puffs(img, 322, 168, 4, 9);
  });
  // Red army.
  q.add(118, () => robot(img, BRICK, 199, 103, "red", 1));
  // prettier-ignore
  for (const [x, y] of [[214, 94], [224, 104], [212, 122], [226, 132], [234, 114], [190, 92]] as const)
    q.add(y + 10, () => robot(img, GRUNT, x, y, "red", 1));
  q.add(150, () => {
    robot(img, TORCH, 228, 140, "red", 1);
    flame(img, 239, 146, 1, 9);
  });
  q.add(102, () => robot(img, LONG, 176, 90, "red", 1));
  q.add(132, () => tank(img, 168, 120, "red", { dir: 1 }));
  q.add(152, () => tank(img, 186, 140, "red", { dir: 1 }));
  for (const [x, y] of [
    [108, 118],
    [118, 124],
    [128, 114],
  ] as const)
    q.add(y + 10, () => robot(img, GRUNT, x, y, "red", 1));
  q.add(198, () => buggy(img, 128, 188, "red", 1));
  // Blue army.
  // prettier-ignore
  for (const [x, y] of [[262, 96], [272, 108], [260, 128], [278, 134], [270, 148]] as const)
    q.add(y + 10, () => robot(img, GRUNT, x, y, "blue", -1));
  q.add(124, () => tank(img, 282, 112, "blue", { dir: -1 }));
  q.add(148, () =>
    tank(img, 296, 130, "blue", { dir: -1, heavy: true, L: 24, W: 16 }),
  );
  q.add(100, () => robot(img, VIX, 304, 86, "blue", -1));
  for (const [x, y] of [
    [360, 118],
    [350, 126],
  ] as const)
    q.add(y + 10, () => robot(img, GRUNT, x, y, "blue", -1));
  q.add(206, () => buggy(img, 346, 196, "blue", -1));
  q.flush();
  // Effects on top: Brick's shockwave, selections, bars, gunfire.
  img.ring(206, 118, 26, 11, [255, 240, 160, 200], 3);
  img.ring(206, 118, 23, 9, [248, 208, 48, 230], 3, 1);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 6.28;
    img.ell(
      206 + Math.cos(a) * 25,
      117 + Math.sin(a) * 10,
      2,
      1.5,
      [236, 206, 150, 170],
    );
  }
  selRing(img, 206, 117, 9, 3);
  hpBar(img, 199, 99, 14, 0.72);
  selRing(img, 311, 99, 8, 3, "#6aa0ff");
  hpBar(img, 304, 82, 14, 0.55);
  tracer(img, 222, 109, 262, 103);
  tracer(img, 234, 120, 270, 113);
  tracer(img, 186, 126, 266, 128, "#fffbe0");
  tracer(img, 266, 102, 232, 108, "#c8e0ff");
  tracer(img, 276, 140, 236, 136, "#c8e0ff");
  boom(img, 252, 106, 6, 1);
  boom(img, 268, 127, 5, 2);
  boom(img, 238, 152, 4, 3);
  return img;
}

/** The 320×200 title-screen backdrop. */
export function titleScene(): Img {
  const img = new Img(320, 200);
  const B = BIOME.desert;
  terrain(img, B, 41);
  plateau(img, B, 42, "left", 100, 48);
  plateau(img, B, 43, "right", 236, 40);
  river(img, B, 44, (y) => 214 + Math.sin(y / 18) * 6, 12);
  bridge(img, 202, 84, 24, 9);
  // prettier-ignore
  for (const [x, y, a, b] of [[150, 60, 8, 4], [280, 130, 10, 5], [60, 150, 9, 5], [180, 170, 7, 4], [300, 70, 6, 4]] as const)
    blob(img, x, y, a, b, B.rock, x);
  for (const [x, y] of [
    [250, 96],
    [190, 140],
    [120, 110],
  ] as const)
    crater(img, B, x, y, 5, 3, x);
  for (const [x, y] of [
    [240, 90],
    [256, 112],
  ] as const)
    scorch(img, x, y, 10, 6, y);
  const q = new DepthQueue();
  q.add(50, () => fort(img, 20, 2, "red"));
  q.add(42, () => fort(img, 262, -4, "blue"));
  q.add(98, () => factory(img, 40, 64, "red", "vehicle"));
  q.add(30, () => turret(img, 250, 34, "blue", -1));
  const flags: readonly (readonly [number, number, TeamId])[] = [
    [150, 84, "red"],
    [196, 104, "red"],
    [276, 70, "blue"],
    [110, 60, "red"],
  ];
  for (const [x, y, t] of flags) q.add(y, () => flag(img, x, y, t));
  q.add(104, () => robot(img, BRICK, 172, 88, "red", 1));
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 4; c++) {
      const x = 110 + c * 13 + r * 4;
      const y = 84 + r * 12;
      q.add(y + 10, () =>
        robot(img, c === 3 && r === 1 ? TORCH : GRUNT, x, y, "red", 1),
      );
    }
  q.add(122, () => tank(img, 116, 110, "red", { dir: 1 }));
  q.add(80, () =>
    tank(img, 132, 66, "red", { dir: 1, heavy: true, L: 24, W: 16 }),
  );
  q.add(98, () => robot(img, LONG, 196, 88, "red", 1));
  // prettier-ignore
  for (const [x, y] of [[236, 98], [250, 84], [246, 112], [262, 100]] as const)
    q.add(y + 10, () => robot(img, GRUNT, x, y, "blue", -1));
  q.add(126, () => tank(img, 262, 116, "blue", { dir: -1 }));
  q.flush();
  selRing(img, 179, 102, 9, 3);
  hpBar(img, 172, 84, 14, 0.9);
  tracer(img, 186, 95, 236, 104);
  tracer(img, 210, 94, 250, 92);
  tracer(img, 148, 116, 260, 122, "#fffbe0");
  boom(img, 240, 94, 6, 7);
  boom(img, 258, 124, 5, 8);
  return img;
}

export type UnitCardId =
  "grunt" | "torch" | "longshot" | "auto" | "buggy" | "light" | "crawler";
export const UNIT_CARDS: readonly UnitCardId[] = [
  "grunt",
  "torch",
  "longshot",
  "auto",
  "buggy",
  "light",
  "crawler",
];

const CARD: Readonly<
  Record<UnitCardId, { seed: number; draw: (img: Img) => void }>
> = {
  grunt: {
    seed: 31,
    draw: (i) => {
      robot(i, GRUNT, 8, 9, "red");
      robot(i, GRUNT, 18, 13, "red");
      robot(i, GRUNT, 10, 17, "red");
    },
  },
  torch: {
    seed: 32,
    draw: (i) => {
      robot(i, TORCH, 8, 9, "red");
      robot(i, TORCH, 10, 16, "red");
      flame(i, 19, 22, 1, 10);
    },
  },
  longshot: {
    seed: 33,
    draw: (i) => {
      blob(i, 20, 22, 9, 4, BIOME.desert.rock, 3);
      robot(i, LONG, 13, 10, "red");
      tracer(i, 26, 16, 40, 14);
    },
  },
  auto: { seed: 34, draw: (i) => crate(i, 13, 7) },
  buggy: {
    seed: 35,
    draw: (i) => {
      buggy(i, 11, 9, "red");
      puffs(i, 6, 16, 3, 2);
    },
  },
  light: { seed: 36, draw: (i) => tank(i, 9, 9, "red", { dir: 1 }) },
  crawler: {
    seed: 37,
    draw: (i) => tank(i, 5, 6, "red", { dir: 1, heavy: true, L: 24, W: 16 }),
  },
};

/** A 40×30 build-menu card showing a unit on desert ground. */
export function unitCard(id: UnitCardId): Img {
  const { seed, draw } = CARD[id];
  const img = new Img(40, 30);
  terrain(img, BIOME.desert, seed);
  draw(img);
  return img;
}

/** An 80×44 scene of a red factory with its product rolling out. */
export function factoryScene(kind: FactoryKind): Img {
  const img = new Img(80, 44);
  terrain(img, BIOME.desert, kind === "robot" ? 21 : 22);
  blob(img, 70, 38, 6, 3, BIOME.desert.rock, 5);
  factory(img, 12, 9, "red", kind);
  flag(img, 6, 40, "red");
  if (kind === "robot") {
    robot(img, TORCH, 26, 32, "red", 1);
    robot(img, TORCH, 38, 33, "red", 1);
  } else tank(img, 34, 32, "red", { dir: 1 });
  return img;
}

/** An 80×40 map-select thumbnail for a biome, seeded by `s`. */
export function mapThumb(biome: BiomeId, s: number): Img {
  const B = BIOME[biome];
  const img = new Img(80, 40);
  terrain(img, B, s);
  if (biome === "desert") {
    river(img, B, s, (y) => 40 + Math.sin(y / 6) * 3, 6);
    bridge(img, 35, 18, 11, 4);
  }
  if (biome === "arctic") {
    for (let x = 0; x < 80; x++) {
      const y = 20 + Math.round(Math.sin(x / 7) * 3);
      img.px(x, y, B.water[1]);
      img.px(x, y + 1, B.water[0]);
      img.px(x, y - 1, "#ffffff");
    }
    for (const [a, b] of [
      [20, 8],
      [60, 32],
      [45, 10],
    ] as const)
      blob(img, a, b, 4, 3, B.rock, a);
  }
  if (biome === "jungle") {
    river(img, B, s, (y) => 40 + Math.sin(y / 5) * 4, 5);
    for (let i = 0; i < 16; i++)
      tree(img, 6 + hash(i, 1, s) * 68, 4 + hash(i, 2, s) * 32, 3, i);
  }
  if (biome === "volcanic") {
    river(img, B, s, (y) => 40 + Math.cos(y / 5) * 5, 5);
    for (const [a, b] of [
      [16, 30],
      [62, 10],
      [30, 8],
      [52, 32],
    ] as const)
      blob(img, a, b, 5, 3, B.rock, a);
  }
  bevel(img, 3, 15, 10, 8, TEAM.red.t, TEAM.red.u, TEAM.red.T);
  bevel(img, 67, 15, 10, 8, TEAM.blue.t, TEAM.blue.u, TEAM.blue.T);
  for (const [a, b] of [
    [22, 30],
    [58, 6],
    [24, 6],
    [56, 32],
  ] as const) {
    img.rect(a, b - 4, 1, 5, "#101010");
    img.rect(a + 1, b - 4, 3, 2, "#f8f8f8");
  }
  return img;
}

/** The seeds the concept sheet uses for each biome thumbnail. */
export const MAP_THUMB_SEEDS: Readonly<Record<BiomeId, number>> = {
  desert: 51,
  arctic: 52,
  jungle: 53,
  volcanic: 54,
};

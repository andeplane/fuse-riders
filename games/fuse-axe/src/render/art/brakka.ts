import type { HeroFrame } from "./animate.js";
import {
  adjust,
  arm,
  armAt,
  BACK,
  bend,
  between,
  breath,
  figure,
  fist,
  leg,
  legAt,
  stride,
  sword,
  type Pose,
} from "../pixel/kit.js";
import { rampSwap, type Palette } from "../pixel/palette.js";
import { Rig, type Point, type Smear } from "../pixel/rig.js";
import type { Sprite } from "../pixel/sprite.js";

/** Brakka the barbarian: a broadsword, a blond mane, a red loincloth. */
export interface BrakkaPose extends Pose {
  /** The sword's angle in degrees, clockwise from pointing right, and its blade's length. */
  readonly sword: number;
  readonly blade: number;
  readonly smear?: Smear;
  /** Degrees the head and the details on the torso turn with the body, clockwise: −90 lies on his back. */
  readonly tilt?: number;
  readonly face?: Face;
}

/**
 * Every frame shares one canvas with room above the head for a raised sword, and one anchor, so the body keeps its
 * place between frames.
 */
const idle: BrakkaPose = {
  size: [84, 78],
  anchor: [36, 74],
  head: [37.5, 32.6],
  chest: [35.5, 43.5],
  waist: [35.5, 49.5],
  far: {
    ...armAt([29, 40.5], [26.5, 47.5], [27, 53.5]),
    ...legAt([33, 54.5], [29.5, 63.5], [28.8, 71.5]),
  },
  near: {
    ...armAt([42.5, 40.5], [43.5, 47.5], [49.2, 47.4]),
    ...legAt([38, 54.5], [42, 63.5], [43.2, 71.5]),
  },
  sword: -66,
  blade: 18,
};

/** Six frames of a march, the sword held up; arms swing against the legs, their bones as long as idle's. */
const walk = [0, 1, 2, 3, 4, 5].map((i) => {
  const step = adjust(idle, stride(idle, i, 6, { reach: 9, lift: 6, dip: 2 }));
  const swing = Math.cos((i / 6) * 2 * Math.PI);
  const hand = (p: Point, dx: number): Point => [
    p[0] + dx,
    p[1] - Math.abs(dx) * 0.3,
  ];
  const [far, near] = [
    hand(step.far.hand, 4 * swing),
    hand(step.near.hand, -1.5 * swing),
  ];
  return adjust(step, {
    head: [step.head[0] + 1, step.head[1]],
    far: { elbow: bend(step.far.shoulder, far, 7.4, 6, -1), hand: far },
    near: { elbow: bend(step.near.shoulder, near, 7.1, 5.7, -1), hand: near },
    sword: -62 + 4 * swing,
  });
});

/** The combo plants the feet in a lunge, and every swing keeps them there. */
const lunge = adjust(idle, {
  far: legAt([34, 55], [28, 63], [22.5, 71.5]),
  near: legAt([39, 55], [45.5, 62.5], [47, 71.5]),
  blade: 19,
});
/** The deeper lunge of the finisher's blow. */
const crouch = adjust(lunge, {
  far: legAt([34, 58], [27, 64.5], [22.5, 71.5]),
  near: legAt([39, 58], [47, 64], [47, 71.5]),
});

const poses: Readonly<Record<HeroFrame, BrakkaPose>> = {
  idle0: idle,
  idle1: adjust(idle, { ...breath(idle, 1), sword: -64 }),
  walk0: walk[0]!,
  walk1: walk[1]!,
  walk2: walk[2]!,
  walk3: walk[3]!,
  walk4: walk[4]!,
  walk5: walk[5]!,
  rise: adjust(idle, {
    head: [38.5, 31],
    chest: [36.5, 42],
    waist: [36, 48.5],
    far: {
      ...armAt([30, 39.5], [25, 36], [22, 31]),
      ...legAt([33.5, 53.5], [30.5, 62.5], [27, 71]),
    },
    near: {
      ...armAt([43, 39.5], [48, 36], [50, 30]),
      ...legAt([38.5, 53.5], [45, 55], [42, 62]),
    },
    sword: -60,
  }),
  fall: adjust(idle, {
    head: [38, 32.5],
    chest: [36, 43.5],
    far: {
      ...armAt([29.5, 40.5], [24.5, 43], [20, 40]),
      ...legAt([33, 54.5], [29, 62], [28, 70]),
    },
    near: {
      ...armAt([42.5, 40.5], [48, 43], [53, 41]),
      ...legAt([38, 54.5], [44, 60], [42.5, 67]),
    },
    sword: -20,
  }),
  land: adjust(idle, {
    head: [38, 37],
    chest: [36, 48],
    waist: [35.5, 53.5],
    far: {
      ...armAt([29.5, 45], [25.5, 51], [25, 57]),
      ...legAt([33, 58.5], [28, 64], [28.8, 71.5]),
    },
    near: {
      ...armAt([43, 45], [46, 51], [51, 51]),
      ...legAt([38, 58.5], [44, 64], [43.2, 71.5]),
    },
    sword: -40,
  }),
  // A forehand: the sword raised over the shoulder comes down level through a motion arc.
  windup1: adjust(lunge, {
    head: [39, 34],
    chest: [36.5, 44],
    waist: [36, 50],
    far: armAt([30, 41], [25.5, 46], [23, 51.5]),
    near: armAt([43, 41], [48, 37], [46, 30]),
    sword: -115,
  }),
  strike1: adjust(lunge, {
    head: [41.5, 34],
    chest: [38.5, 44],
    waist: [36.5, 50],
    far: armAt([32, 41], [26.5, 45], [22.5, 48.5]),
    near: armAt([45, 41], [50, 44.5], [55, 45]),
    sword: 6,
    smear: { center: [52, 47], inner: 13, outer: 18, from: -80, to: 4 },
    face: "yell",
  }),
  follow1: adjust(lunge, {
    head: [43, 36],
    chest: [39.5, 45.5],
    waist: [37, 51],
    far: armAt([33, 42], [27, 45], [22, 47]),
    near: armAt([46, 42.5], [50, 48], [53, 53]),
    sword: 45,
  }),
  // A backhand: from low behind the hip, the blade sweeps up and forward.
  windup2: adjust(lunge, {
    head: [39, 35],
    chest: [36.5, 45],
    waist: [36, 50.5],
    far: armAt([30, 41.5], [26, 47], [24, 52]),
    near: armAt([43, 42], [43, 49], [39, 54]),
    sword: 150,
  }),
  strike2: adjust(lunge, {
    head: [41, 33.5],
    chest: [38, 43.5],
    waist: [36.5, 50],
    far: armAt([31, 41], [26, 45], [22, 48]),
    near: armAt([45, 40.5], [51, 40], [56, 37]),
    sword: -30,
    smear: { center: [47, 41], inner: 13, outer: 22, from: 80, to: -30 },
    face: "yell",
  }),
  follow2: adjust(lunge, {
    head: [40.5, 33],
    chest: [37.5, 43.5],
    waist: [36.5, 50],
    far: armAt([31, 41], [26, 46], [24, 51]),
    near: armAt([44.5, 40.5], [48, 35], [49, 28]),
    sword: -75,
  }),
  // The finisher: the sword hauled up behind the head and brought down overhead into the ground.
  windup3: adjust(lunge, {
    head: [35, 35],
    chest: [34.5, 45],
    waist: [35.5, 50.5],
    far: armAt([29, 42], [24.5, 47], [21, 51.5]),
    near: armAt([41, 41.5], [45, 28], [39, 21]),
    sword: 165,
  }),
  strike3: adjust(crouch, {
    head: [44, 39],
    chest: [40.5, 48],
    waist: [37.5, 53.5],
    far: armAt([33, 45], [27, 48], [22, 50]),
    near: armAt([47, 45], [52, 50], [56, 54]),
    sword: 35,
    smear: { center: [46, 47], inner: 15, outer: 24, from: -150, to: 35 },
    face: "yell",
  }),
  follow3: adjust(crouch, {
    head: [46, 44],
    chest: [42, 52],
    waist: [38.5, 56.5],
    far: {
      ...armAt([35, 49], [31, 55], [31, 60]),
      ...legAt([34, 59.5], [27, 65], [22.5, 71.5]),
    },
    near: {
      ...armAt([49, 49], [54, 55], [58, 60]),
      ...legAt([39, 59.5], [48, 65], [47, 71.5]),
    },
    sword: 40,
  }),
  hurt: adjust(idle, {
    head: [33, 35],
    chest: [33, 45],
    waist: [34.5, 50.5],
    far: {
      ...armAt([27, 42], [22, 40], [19, 36]),
      ...legAt([33, 55], [29, 63.5], [28.8, 71.5]),
    },
    near: {
      ...armAt([40, 42], [45, 46], [49, 51]),
      ...legAt([38, 55], [41.5, 63.5], [43.2, 71.5]),
    },
    sword: 40,
    face: "pain",
  }),
  // Flung back through the air, head first, then flat on his back.
  knockdown: adjust(idle, {
    head: [20, 67.5],
    chest: [31, 67.5],
    waist: [38, 68],
    far: {
      ...armAt([29, 65.5], [25, 59.5], [20, 56.5]),
      ...legAt([42, 67.5], [50, 62.5], [57, 58.5]),
    },
    near: {
      ...armAt([31, 64.5], [34, 57.5], [31, 52.5]),
      ...legAt([43, 66.5], [51, 65.5], [59, 62.5]),
    },
    sword: -125,
    tilt: -90,
    face: "pain",
  }),
  down: adjust(idle, {
    head: [20, 67.5],
    chest: [31, 67.5],
    waist: [38, 68],
    far: {
      ...armAt([29, 69], [22, 71.5], [15, 71]),
      ...legAt([42, 69], [51, 70], [60, 71]),
    },
    near: {
      ...armAt([31, 65], [35, 70], [40, 66]),
      ...legAt([43, 67], [52, 67.5], [61, 70]),
    },
    sword: -2,
    tilt: -90,
    face: "out",
  }),
  getup: adjust(idle, {
    head: [39, 44],
    chest: [37, 54],
    waist: [36, 59.5],
    far: {
      ...armAt([30, 50.5], [27, 57], [29, 62]),
      ...legAt([33, 64], [31, 71], [22, 71]),
    },
    near: {
      ...armAt([44, 50.5], [47, 57], [49, 61]),
      ...legAt([38, 64], [46, 60], [47, 71.5]),
    },
    sword: 40,
  }),
};
export const BRAKKA_POSES = poses;

/**
 * Hand-placed brow, eye and mouth pixels, rows from the brow down, the first column on the head's centre; they turn
 * with the head.
 */
const FACES = {
  calm: ["3kk", " k ", "", "", "  11"],
  yell: ["3kk", " k ", "", "  kk", "  11"],
  pain: ["k3 ", " kk", "", "  kk", "  k1"],
  out: ["", "kk ", "", "", "  11"],
};
type Face = keyof typeof FACES;

export function paintBrakka(pose: BrakkaPose): Sprite {
  const { head: h, chest, waist, far, near } = pose;
  const radians = ((pose.tilt ?? 0) * Math.PI) / 180;
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
  /** The point (dx, dy) from `p` in the body's own frame, turned with it. */
  const at = (p: Point, dx: number, dy: number): Point => [
    p[0] + dx * cos - dy * sin,
    p[1] + dx * sin + dy * cos,
  ];
  const rig = new Rig(...pose.size);
  if (pose.smear) rig.smear(pose.smear);
  arm(rig, far, { ...BACK, bracer: "l" });
  fist(rig, far.hand, BACK);
  leg(rig, far, { ...BACK, cuff: "b" });
  // Torso, pecs, a four-pack and the neck, all one part.
  const body = { group: "body" };
  rig.ellipse(waist, 6, 5.5, "s", body);
  rig.ellipse(chest, 8.3, 6.2, "s", body);
  rig.ellipse(at(chest, -2.9, -0.5), 4.3, 3.6, "s", { ...body, flat: 0.8 });
  rig.ellipse(at(chest, 3.1, -0.5), 4.6, 3.8, "s", { ...body, flat: 0.8 });
  for (const dx of [-1.2, 2.1])
    for (const dy of [-1, 2])
      rig.ellipse(at(waist, dx, dy), 2.2, 1.75, "s", { ...body, flat: 0.6 });
  rig.capsule(at(h, -1, 3.5), at(chest, 0.5, -4), 2.6, 2.9, "s", body);
  // The mane falls behind the head; the fringe and headband sit on top of it.
  const mane = { group: "mane", bias: 0.12 };
  rig.capsule(at(h, -3.4, -0.5), at(h, -5.5, 4.5), 4.3, 3.3, "h", mane);
  rig.capsule(at(h, -5.5, 4.5), at(h, -6.8, 9.5), 3.3, 2.2, "h", mane);
  rig.capsule(at(h, -3, -3.5), at(h, -8, -2), 1.9, 0.8, "h", mane);
  rig.capsule(at(h, -4.5, 1), at(h, -9, 4), 1.9, 0.8, "h", mane);
  const face = { group: "head", bias: 0.2 };
  rig.ellipse(h, 3.7, 4.3, "s", face);
  rig.ellipse(at(h, 1.7, 2.4), 2.8, 2.3, "s", face);
  rig.ellipse(at(h, 4, 0.9), 1, 1.1, "s", face);
  const fringe = { group: "fringe", edge: "none" } as const;
  rig.ellipse(at(h, -0.6, -3.1), 4.3, 2.6, "h", fringe);
  rig.capsule(at(h, -4, -2), at(h, -4.3, 1.5), 2.1, 1.7, "h", fringe);
  const band = { edge: "none" } as const;
  rig.capsule(at(h, -4, -1.9), at(h, 3.6, -1.9), 0.75, 0.75, "c", band);
  // A baldric from the near shoulder to the far hip, then the near leg, loincloth, belt and buckle.
  const strap = { edge: "shade", flat: 0.2 } as const;
  rig.capsule(
    at(near.shoulder, -1.5, -2),
    at(waist, -4, 2.5),
    1,
    1,
    "l",
    strap,
  );
  leg(rig, near, { cuff: "b" });
  const hips = between(far.hip, near.hip);
  const cloth = [
    at(hips, -3, -1.5),
    at(hips, 4, -1.5),
    at(hips, 3.5, 5),
    at(hips, 1.5, 7.5),
    at(hips, -1, 6.5),
    at(hips, -2.5, 4.5),
  ];
  rig.poly(cloth, "c");
  const belt = { edge: "shade" } as const;
  rig.capsule(at(hips, -6, -1.2), at(hips, 5.5, -1.2), 1.7, 1.7, "l", belt);
  rig.ellipse(at(hips, 3, -1.2), 1.5, 1.5, "n", belt);
  arm(rig, near, { bracer: "l" });
  sword(rig, near.hand, pose.sword, pose.blade, 4.2);
  const painting = rig.bake();
  FACES[pose.face ?? "calm"].forEach((row, j) =>
    [...row].forEach((key, i) => {
      const [x, y] = at(h, i, j - 1);
      if (key !== " ") painting.stamp(Math.round(x), Math.round(y), [key]);
    }),
  );
  return painting.sprite(pose.anchor);
}

/** The HUD's 16 × 16 portrait: his face on a violet plate in an ink frame. */
export function paintBrakkaPortrait(): Sprite {
  const plate: Point[] = [
    [2, 2],
    [16, 2],
    [16, 16],
    [2, 16],
  ];
  const rig = new Rig(18, 18).poly(plate, "i", { bevel: 2 });
  const body = { group: "body" };
  rig.ellipse([9.5, 17.5], 7.5, 3.5, "s", body);
  rig.capsule([9.5, 12], [9.5, 16], 2.6, 3, "s", body);
  const mane = { group: "mane", bias: 0.12 };
  rig.capsule([6, 5], [4.5, 13], 4, 3, "h", mane);
  rig.capsule([5, 4], [2, 8], 1.8, 1, "h", mane);
  const face = { group: "head", bias: 0.2 };
  rig.ellipse([9.5, 8], 4.2, 4.8, "s", face);
  rig.ellipse([11.5, 10.5], 3, 2.5, "s", face);
  rig.ellipse([13.5, 8.6], 1.1, 1.2, "s", face);
  const fringe = { group: "fringe", edge: "none" } as const;
  rig.ellipse([9, 4], 4.8, 2.6, "h", fringe);
  rig.capsule([5.5, 4.5], [5.5, 9], 2, 1.8, "h", fringe);
  rig.capsule([5, 5.2], [13, 5.2], 0.8, 0.8, "c", { edge: "none" });
  // Only the plate shows: everything outside it is cleared, and the outline closes round it.
  const clear = Array.from({ length: 18 }, (_, y) =>
    y < 2 || y > 15 ? ".".repeat(18) : `..${" ".repeat(14)}..`,
  );
  return rig
    .bake()
    .stamp(0, 0, clear)
    .stamp(10, 7, ["3kk", " k "])
    .stamp(12, 11, ["11"])
    .sprite([9, 16]);
}

const hair = (light: string, base: string, shadow: string): Palette => ({
  H: light,
  h: base,
  3: shadow,
});
const skin = (light: string, base: string, shadow: string): Palette => ({
  S: light,
  s: base,
  1: shadow,
});

/**
 * Up to five Brakkas in one room, each told apart by his hair, skin and the colour of his loincloth and headband:
 * blond and red, then dark and blue, auburn and green, silver and violet, black and teal.
 */
const SWAPS: Readonly<Record<string, Palette>> = {
  second: {
    ...rampSwap("Cc0", "Uu@"),
    ...hair("#b58a6a", "#5e3a36", "#2c1828"),
    ...skin("#eeb184", "#b86d45", "#723a3a"),
  },
  third: {
    ...rampSwap("Cc0", "Vv!"),
    ...rampSwap("Hh3", "Ee4"),
    ...skin("#ffe0bc", "#eaa77a", "#a85e52"),
  },
  fourth: {
    ...rampSwap("Cc0", "Qq^"),
    ...rampSwap("Hh3", "Ww5"),
  },
  fifth: {
    ...rampSwap("Cc0", "Yy&"),
    ...hair("#6c5e78", "#3a2e48", "#1e1628"),
    ...skin("#d8946a", "#9c5a3c", "#5a2e30"),
  },
};

export const BRAKKA = figure(BRAKKA_POSES, paintBrakka, SWAPS);
export const BRAKKA_PORTRAIT = paintBrakkaPortrait();

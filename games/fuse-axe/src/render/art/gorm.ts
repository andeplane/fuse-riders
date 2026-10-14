import type { HeroFrame } from "./animate.js";
import {
  beard,
  head,
  headTurn,
  hornedHelm,
  portrait,
  stampFace,
  turn,
  type Faces,
  type HeroPose,
} from "../pixel/head.js";
import {
  adjust,
  arm,
  armAt,
  armTo,
  axe,
  BACK,
  between,
  breath,
  figure,
  fist,
  leg,
  legAt,
  legTo,
  offset,
  sprint,
  stride,
  type Side,
} from "../pixel/kit.js";
import { rampSwap, type Palette } from "../pixel/palette.js";
import { Rig, type Point } from "../pixel/rig.js";
import type { Sprite } from "../pixel/sprite.js";

/** Gorm the dwarf: a double-bit battle axe, a grey beard, a horned helm and a blue tunic. */
export interface GormPose extends HeroPose {
  /** The haft's angle in degrees, clockwise from pointing right, and how far up it the head is from the near hand. */
  readonly axe: number;
  readonly haft: number;
  /** Both hands on the haft: the far fist grips it too, drawn over it. */
  readonly both?: boolean;
}

/** The haft's whole length: what is not above the near hand sticks out below it. */
const AXE = 25;

/** A point `d` px back down the haft from the near hand, where the far hand grips a two-handed swing. */
const grip = (hand: Point, degrees: number, d: number): Point => {
  const radians = (degrees * Math.PI) / 180;
  return [hand[0] - Math.cos(radians) * d, hand[1] - Math.sin(radians) * d];
};

/** One canvas and anchor for every frame, with room above for the axe raised overhead and before him for the chop. */
const idle: GormPose = {
  size: [96, 80],
  anchor: [36, 76],
  head: [37, 45],
  chest: [34.5, 54.5],
  waist: [34.5, 59.5],
  far: {
    ...armAt([27, 51.5], [25, 57.5], [26.5, 62.5]),
    ...legAt([32, 63], [31, 68.2], [31, 73.5]),
  },
  near: {
    ...armAt([42.5, 51.5], [46, 57], [50.5, 59.5]),
    ...legAt([38, 63], [40, 68.2], [41, 73.5]),
  },
  axe: -90,
  haft: 14,
};
const { far: F, near: N } = idle;

/**
 * Six frames of a short, quick, stamping stride, the axe carried upright: a planted foot sweeps back his walking speed
 * a step for `WALK_STEPS.gorm` (5) steps. That speed is 0.8 px a step to the eye but 205/256 px in the engine's
 * sub-pixels, and the reach is drawn for the exact figure.
 */
const REACH = (1.5 * 5 * 205) / 256;
const walk = [0, 1, 2, 3, 4, 5].map((i) => {
  const step = adjust(
    idle,
    stride(idle, i, 6, { reach: REACH, lift: 4, dip: 1.5 }),
  );
  const swing = Math.cos((i / 6) * 2 * Math.PI);
  const hand = (p: Point, dx: number): Point => [
    p[0] + dx,
    p[1] - Math.abs(dx) * 0.3,
  ];
  return adjust(step, {
    head: [step.head[0] + 1, step.head[1]],
    far: armTo(F, step.far.shoulder, hand(step.far.hand, 4 * swing)),
    near: armTo(N, step.near.shoulder, hand(step.near.hand, -1.5 * swing)),
    axe: -96 + 4 * swing,
  });
});

/** The combo's squat: the feet planted wide and the hips dropped, as every swing keeps them. */
const squat = adjust(idle, {
  far: legTo(F, [33, 65], [27.5, 73.5]),
  near: legTo(N, [39, 65], [45, 73.5]),
});
/** The cleave drops the hips lower still, the thighs turning about the same knees above the same boots. */
const crouch = adjust(squat, {
  far: { hip: [34, 66.5] },
  near: { hip: [40, 66.5] },
});

/** Both hands on the haft: the near hand at `hand`, the far one `d` px further down it. */
const twoHanded = (
  pose: GormPose,
  far: Point,
  near: Point,
  hand: Point,
  degrees: number,
  d = 4,
) => ({
  far: armTo(F, far, grip(hand, degrees, d)),
  near: armTo(N, near, hand),
  axe: degrees,
  both: true,
  haft: pose.haft,
});

/** A two-handed grip's arms on the legs `far` and `near`, for a blow in the air. */
const tucked = (
  grip: ReturnType<typeof twoHanded>,
  far: Partial<Side>,
  near: Partial<Side>,
) => ({
  ...grip,
  far: { ...grip.far, ...far },
  near: { ...grip.near, ...near },
});

/**
 * Six frames of a quick, stumpy sprint, leaning into it: a planted foot sweeps back his running speed a step for
 * `RUN_STEPS.gorm` steps (4.5 px a frame), and the fists pump against the legs, the near one only a little as it holds
 * the axe up before him.
 */
const leaning = adjust(idle, {
  head: [40.5, 46.5],
  chest: [37, 55.5],
  waist: [35.5, 60.5],
  far: { shoulder: [29.5, 52.5], ...legTo(F, [32, 64], [31, 73.5]) },
  near: { shoulder: [45, 52.5], ...legTo(N, [38, 64], [41, 73.5]) },
});
const run = [0, 1, 2, 3, 4, 5].map((i) => {
  const step = adjust(
    leaning,
    sprint(leaning, i, 6, { reach: 4.5, lift: 6, dip: 1 }),
  );
  // 1 as the near foot lands ahead, when the far fist is forward and the near one back.
  const swing = Math.cos((i / 6) * 2 * Math.PI);
  const pump = (side: Side, ahead: number) =>
    armTo(
      side,
      side.shoulder,
      offset(side.shoulder, -5 + 10 * ahead, 7 - 4 * ahead),
    );
  return adjust(step, {
    far: pump(step.far, (1 + swing) / 2),
    near: pump(step.near, 0.875 - swing / 8),
    axe: -62.5 - 12.5 * swing,
  });
});

/**
 * Riding a beast, seated astride its saddle with the axe in both hands: the hips on the seat, the near leg down its
 * flank to the stirrup, the boot's sole on the anchor (which the scene sets on the saddle point), the far leg out of
 * sight on its far side. His legs are too short for the stirrup a ravager rides with, so the near one is drawn longer,
 * mostly hidden by the tunic, and reaches it straight down.
 */
const seated = adjust(idle, {
  head: [37.5, 41.5],
  chest: [35, 51],
  waist: [35, 56],
  far: { hip: [33, 59.5] },
  near: legAt([38.5, 59.5], [41.5, 66.5], [40.5, 73.5]),
  astride: true,
});
const seat = adjust(
  seated,
  twoHanded(seated, [27.5, 48], [42.5, 48], [46.5, 52.5], -80, 5),
);

const poses: Readonly<Record<HeroFrame, GormPose>> = {
  idle0: idle,
  idle1: adjust(idle, { ...breath(idle, 1), axe: -92 }),
  walk0: walk[0]!,
  walk1: walk[1]!,
  walk2: walk[2]!,
  walk3: walk[3]!,
  walk4: walk[4]!,
  walk5: walk[5]!,
  rise: adjust(idle, {
    head: [38, 43],
    chest: [35.5, 52.5],
    waist: [35, 57.5],
    far: {
      ...armTo(F, [28, 49.5], [22, 45]),
      ...legTo(F, [33, 61], [30, 73.5]),
    },
    near: {
      ...armTo(N, [43.5, 49.5], [49, 44], 1),
      ...legAt([38.5, 61], [44.5, 62], [42, 68]),
    },
    axe: -70,
  }),
  fall: adjust(idle, {
    head: [38, 44.5],
    chest: [35.5, 54],
    waist: [35, 59],
    far: {
      ...armTo(F, [28, 51], [21, 50]),
      ...legTo(F, [32.5, 62.5], [30.5, 72]),
    },
    near: {
      ...armTo(N, [43, 51], [51, 52]),
      ...legTo(N, [38.5, 62.5], [43, 69]),
    },
    axe: -40,
  }),
  land: adjust(idle, {
    head: [38, 48.5],
    chest: [35.5, 58],
    waist: [35, 62.5],
    far: {
      ...armTo(F, [28, 55], [25.5, 64]),
      ...legTo(F, [32, 66], [31, 73.5]),
    },
    near: {
      ...armTo(N, [43, 55], [50, 62]),
      ...legTo(N, [38, 66], [41, 73.5]),
    },
    axe: -60,
  }),
  // A short level hack: the axe drawn back past his hip, then hacked straight through in front of him.
  windup1: adjust(squat, {
    head: [35.5, 46.5],
    chest: [33.5, 56],
    waist: [34, 61],
    ...twoHanded(squat, [26, 53], [41, 53], [31, 60], 190),
  }),
  strike1: adjust(squat, {
    head: [40, 46.5],
    chest: [37, 56],
    waist: [35.5, 61],
    ...twoHanded(squat, [30, 53], [44.5, 53], [50.5, 55.5], 0),
    smear: { center: [52, 100], inner: 45, outer: 52, from: -112, to: -76 },
    face: "yell",
  }),
  follow1: adjust(squat, {
    head: [41, 47],
    chest: [38, 56.5],
    waist: [36, 61.5],
    ...twoHanded(squat, [31, 53.5], [45, 53.5], [50, 59], 25),
  }),
  // The uppercut: the axe swung low behind him, then chopped up and forward to above his head.
  windup2: adjust(squat, {
    head: [35, 47.5],
    chest: [33.5, 57],
    waist: [34, 61.5],
    ...twoHanded(squat, [26.5, 54], [41, 54], [34, 61], 160),
  }),
  strike2: adjust(squat, {
    head: [39.5, 45],
    chest: [37, 54.5],
    waist: [35.5, 60],
    ...twoHanded(squat, [30, 51.5], [44.5, 51.5], [49, 48], -55),
    smear: { center: [45, 52], inner: 12, outer: 21, from: 100, to: -60 },
    face: "yell",
  }),
  follow2: adjust(squat, {
    head: [39, 44.5],
    chest: [36.5, 54],
    waist: [35.5, 60],
    ...twoHanded(squat, [29.5, 51], [44, 51], [45.5, 42], -95),
  }),
  // The cleave: the axe hauled up behind his helm and brought right over the top, biting into the ground before him.
  windup3: adjust(squat, {
    head: [32.5, 46.5],
    chest: [32, 56],
    waist: [33.5, 61],
    ...twoHanded(squat, [24.5, 52], [38.5, 51.5], [33, 41], -145),
  }),
  strike3: adjust(crouch, {
    head: [42, 50],
    chest: [38.5, 59],
    waist: [36, 63.5],
    ...twoHanded(crouch, [31.5, 56], [45.5, 56], [52, 64], 40),
    smear: { center: [42, 60], inner: 16, outer: 25, from: -150, to: 40 },
    face: "yell",
  }),
  follow3: adjust(crouch, {
    head: [43, 51],
    chest: [39, 60],
    waist: [36.5, 64],
    ...twoHanded(crouch, [32, 57], [46, 57], [53, 65.5], 45),
  }),
  hurt: adjust(idle, {
    head: [33, 47.5],
    chest: [32.5, 57],
    waist: [33.5, 61.5],
    far: {
      ...armTo(F, [25, 54], [19, 49], 1),
      ...legAt([32, 63.5], [31, 68.5], [31, 73.5]),
    },
    near: {
      ...armTo(N, [40.5, 54], [47, 60]),
      ...legAt([38, 63.5], [40, 68.5], [41, 73.5]),
    },
    axe: -60,
    face: "pain",
  }),
  // Flung back through the air, helm first, then flat on his back.
  knockdown: adjust(idle, {
    head: [22, 67.5],
    chest: [32, 66.5],
    waist: [38.5, 67.5],
    far: {
      ...armAt([29.5, 66], [25, 60], [20, 57]),
      ...legAt([43, 68.5], [49, 63.5], [54, 59]),
    },
    near: {
      ...armAt([30, 60], [34, 54], [31, 49]),
      ...legAt([44, 67], [50, 65], [56, 61.5]),
    },
    axe: -125,
    tilt: -90,
    face: "pain",
  }),
  down: adjust(idle, {
    head: [22, 67.5],
    chest: [32, 66.5],
    waist: [38.5, 67.5],
    far: {
      ...armAt([30, 69], [24, 72], [18, 72]),
      ...legAt([43, 69], [49, 70.5], [55, 71.5]),
    },
    near: {
      ...armAt([33, 62], [38, 66], [43, 63]),
      ...legAt([44, 67], [50, 68], [56, 70]),
    },
    axe: 0,
    tilt: -90,
    face: "out",
  }),
  getup: adjust(idle, {
    head: [38, 54],
    chest: [36, 63],
    waist: [35, 67.5],
    far: {
      ...armTo(F, [29, 60], [29, 70]),
      ...legAt([32, 70.5], [29, 74], [23, 73.5]),
    },
    near: {
      ...armTo(N, [43, 60], [49, 66]),
      ...legAt([38, 70.5], [45, 67], [46, 73.5]),
    },
    axe: -50,
  }),
  // Magic: squatting, the axe gripped upright before his beard in both fists, then heaved up overhead.
  charge: adjust(squat, {
    ...twoHanded(squat, [27.5, 51.5], [42, 51.5], [44, 44], -90, 5),
  }),
  cast: adjust(squat, {
    head: [36.5, 44.5],
    ...twoHanded(squat, [28, 50.5], [41.5, 50.5], [38, 34], -90, 5),
    face: "yell",
  }),
  run0: run[0]!,
  run1: run[1]!,
  run2: run[2]!,
  run3: run[3]!,
  run4: run[4]!,
  run5: run[5]!,
  // The headbutt: the helm driven forward and down like a ram's, the arms flung back with the axe; then he stops dead.
  dash: adjust(idle, {
    head: [46, 51.5],
    chest: [39.5, 57.5],
    waist: [36, 61.5],
    far: {
      ...armTo(F, [31, 54.5], [23, 61]),
      ...legTo(F, [32.5, 64.5], [23, 73.5]),
    },
    near: {
      ...armTo(N, [45, 55], [32, 62], 1),
      ...legTo(N, [38.5, 64.5], [45, 73.5]),
    },
    axe: 170,
    face: "yell",
  }),
  dashstop: adjust(idle, {
    head: [38, 45.5],
    chest: [35, 55],
    waist: [34.5, 60],
    far: {
      ...armTo(F, [27.5, 52], [23, 60]),
      ...legTo(F, [32, 63.5], [26, 73.5]),
    },
    near: {
      ...armTo(N, [43, 52], [50, 58]),
      ...legTo(N, [38, 63.5], [46, 73.5]),
    },
    axe: -50,
  }),
  // The jump attack: the axe hauled up behind his helm in the air, then chopped down before him, the knees tucked.
  jumpwindup: adjust(idle, {
    head: [37, 43.5],
    chest: [35, 53],
    waist: [35, 58],
    ...tucked(
      twoHanded(idle, [27, 50], [40, 50], [30.5, 43], -140),
      legTo(F, [33, 61.5], [30, 73.5]),
      legAt([38.5, 61.5], [44.5, 62.5], [42, 68.5]),
    ),
  }),
  jumpstab: adjust(idle, {
    head: [41, 46],
    chest: [37.5, 55.5],
    waist: [35.5, 60],
    ...tucked(
      twoHanded(idle, [30, 52.5], [45, 52.5], [51, 58], 50),
      legTo(F, [33, 63], [30, 73.5]),
      legAt([38.5, 63], [44.5, 63.5], [42, 69]),
    ),
    smear: { center: [43, 53], inner: 12, outer: 21, from: -115, to: 50 },
    face: "yell",
  }),
  // The back attack: he looks over his shoulder and swings the axe up and over, back behind him.
  backwindup: adjust(squat, {
    head: [38.5, 46],
    chest: [35.5, 55.5],
    waist: [35, 60.5],
    ...twoHanded(squat, [28, 52.5], [43, 52.5], [45, 46], -60),
    lookBack: true,
  }),
  backstrike: adjust(squat, {
    head: [33.5, 46.5],
    chest: [32.5, 56],
    waist: [33.5, 61],
    ...twoHanded(squat, [25.5, 53], [39.5, 53], [25, 54], 182),
    smear: { center: [30, 55], inner: 12, outer: 22, from: -60, to: -175 },
    face: "yell",
    lookBack: true,
  }),
  backfollow: adjust(squat, {
    head: [33.5, 47],
    chest: [32.5, 56.5],
    waist: [33.5, 61],
    ...twoHanded(squat, [25.5, 53.5], [39.5, 53.5], [27, 62], 150),
    lookBack: true,
  }),
  // The grab clutches with both hands; the throw heaves the body up over his helm and tosses it behind him.
  grab: adjust(squat, {
    head: [39.5, 46.5],
    chest: [36.5, 56],
    waist: [35.5, 61],
    far: armTo(F, [29.5, 53], [44, 52]),
    near: armTo(N, [44, 53], [49, 57]),
    axe: -95,
    face: "yell",
  }),
  heave: adjust(crouch, {
    head: [35.5, 47.5],
    chest: [34.5, 57],
    waist: [35, 62],
    far: armTo(F, [27.5, 53.5], [31, 42.5], 1),
    near: armTo(N, [41, 53.5], [39.5, 42], 1),
    axe: -120,
    face: "yell",
  }),
  toss: adjust(squat, {
    head: [33.5, 47.5],
    chest: [33, 57],
    waist: [34, 61.5],
    far: armTo(F, [26, 54], [19, 46], 1),
    near: armTo(N, [39.5, 54], [29, 45], 1),
    axe: 200,
    lookBack: true,
  }),
  // In the saddle: the axe held up before him; hauled back over his shoulder as the beast winds up, then chopped out
  // level at the foe as it strikes; raised overhead, hunched forward, through a hop.
  ride: seat,
  ridewindup: adjust(seat, {
    head: [36, 41.5],
    chest: [34, 51],
    ...twoHanded(seat, [26.5, 48], [41.5, 48], [45, 38], -120, 4),
  }),
  rideattack: adjust(seat, {
    head: [40, 42],
    chest: [37, 51.5],
    ...twoHanded(seat, [30, 48.5], [44.5, 48.5], [51, 52], 5),
    face: "yell",
  }),
  ridehop: adjust(seat, {
    head: [40, 44],
    chest: [37, 53],
    waist: [36, 57],
    ...twoHanded(seat, [29, 50], [43.5, 50], [48, 40], -100, 4),
  }),
};
export const GORM_POSES = poses;

/** Rows from the brow down, under the helm's rim: bushy brows, two eyes, and a mouth in the beard when he roars. */
const FACES: Faces = {
  calm: ["", "WW WW", "k  k"],
  yell: ["", "WW WW", "k  k", "", "", "", "", "  kk"],
  pain: ["", " W  W", "kk kk", "", "", "", "", "  k"],
  out: ["", "", "kk kk"],
};

export function paintGorm(pose: GormPose): Sprite {
  const { head: h, chest, waist, far, near } = pose;
  const at = turn(pose.tilt);
  const rig = new Rig(...pose.size);
  if (pose.smear) rig.smear(pose.smear);
  const stout = { thick: 1.15 };
  const breeches = { ...stout, material: "l", boot: "i", bootTop: 0.3 };
  arm(rig, far, { ...BACK, ...stout, bracer: "l" });
  if (!pose.both) fist(rig, far.hand, { ...BACK, ...stout });
  if (!pose.astride) leg(rig, far, { ...BACK, ...breeches });
  // A barrel of a body in a blue tunic; the wide parts are capsules, which turn with the body.
  const hips = between(far.hip, near.hip);
  const body = { group: "body" };
  rig.capsule(at(waist, -3.2, 0), at(waist, 3.2, 0), 5, 5, "u", body);
  rig.capsule(at(chest, -2.2, 0), at(chest, 2.2, 0), 7.2, 7.2, "u", body);
  leg(rig, near, breeches);
  const skirt = [
    at(hips, -7, -2),
    at(hips, 7, -2),
    at(hips, 7.5, 3),
    at(hips, 2, 4),
    at(hips, -3, 3.5),
    at(hips, -7.5, 2),
  ];
  rig.poly(skirt, "u");
  const belt = { edge: "shade" } as const;
  rig.capsule(at(hips, -7.5, -2.2), at(hips, 7, -2.2), 2, 2, "l", belt);
  const buckle = [
    at(hips, 0.5, -4.4),
    at(hips, 4.5, -4.4),
    at(hips, 4.5, 0),
    at(hips, 0.5, 0),
  ];
  rig.poly(buckle, "n", { bevel: 1 });
  // The near arm goes under the beard, which falls over the shoulder pad, then the helm over the head.
  arm(rig, near, { ...stout, bracer: "l", pad: "n" });
  // The head, beard and helm turn with the head, which may look back over the shoulder.
  const look = headTurn(pose, at);
  head(rig, h, look, 1.1);
  rig.ellipse(look(h, 5.5, 2.4), 1.7, 1.5, "s", { group: "head", bias: 0.2 });
  beard(rig, h, look, "w");
  hornedHelm(rig, h, look);
  axe(rig, near.hand, pose.axe, pose.haft, { ...stout, butt: AXE - pose.haft });
  if (pose.both) fist(rig, far.hand, { ...BACK, ...stout });
  const painting = stampFace(rig.bake(), h, look, FACES[pose.face ?? "calm"]);
  // The ground hides whatever reaches below the floor: the axe's bit where it bites in.
  const [w, height] = pose.size;
  const ground = height - pose.anchor[1] - 1;
  painting.stamp(0, pose.anchor[1] + 1, Array(ground).fill(".".repeat(w)));
  return painting.sprite(pose.anchor);
}

/** The HUD's 16 × 16 portrait: his eyes between the horned helm and the beard. */
export function paintGormPortrait(): Sprite {
  const hair = { group: "beard", bias: 0.1 };
  return portrait({
    behind: (rig) => rig.ellipse([9.5, 17.5], 8, 4.4, "u", { group: "tunic" }),
    over: (rig) => {
      const beard: Point[] = [
        [4.5, 10.5],
        [10, 11],
        [15.6, 11],
        [15, 15],
        [11.5, 17.5],
        [7.5, 17.5],
        [4.5, 13.5],
      ];
      // The beard shades the cheeks above it rather than inking a line under the eyes.
      const soft = { ...hair, edge: "shade" } as const;
      rig
        .capsule([5, 4], [2.5, 0.5], 1.4, 0.8, "b", { bias: -0.2 })
        .poly(beard, "w", { ...soft, bevel: 2, grain: 3 })
        .capsule([10, 11.5], [15.5, 11.5], 1, 1, "w", soft)
        .ellipse([14.3, 8.6], 1.2, 1.2, "s", { group: "head", bias: 0.2 })
        .capsule([7, 4.6], [12, 4.6], 2.8, 2.8, "m", { group: "helm" })
        .capsule([4, 6], [15.5, 6], 1, 1, "n", { edge: "none" })
        .capsule([14, 4], [16.5, 0.5], 1.4, 0.8, "b");
    },
    face: [[8, 7, ["WW WW", " k  k"]]],
  });
}

const beardOf = (light: string, base: string, shadow: string): Palette => ({
  W: light,
  w: base,
  5: shadow,
});

/** Steel and bronze traded: a bronze helm and axe head, a steel rim, buckle and shoulder pad. */
const gilded: Palette = {
  ...rampSwap("Mm7", "Nn8"),
  ...rampSwap("Nn8", "Mm7"),
};

/**
 * Up to five Gorms in one room, told apart by his beard, tunic and metal: grey, blue and steel, then red, green and
 * bronze; black, red and steel; blond, violet and bronze; brown, teal and steel.
 */
const SWAPS: Readonly<Record<string, Palette>> = {
  second: {
    ...rampSwap("Ww5", "Ee4"),
    ...rampSwap("Uu@", "Vv!"),
    ...gilded,
  },
  third: {
    ...beardOf("#6c5e78", "#3a2e48", "#1e1628"),
    ...rampSwap("Uu@", "Cc0"),
  },
  fourth: {
    ...rampSwap("Ww5", "Hh3"),
    ...rampSwap("Uu@", "Qq^"),
    ...gilded,
  },
  fifth: {
    ...beardOf("#b58a6a", "#5e3a36", "#2c1828"),
    ...rampSwap("Uu@", "Yy&"),
  },
};

export const GORM = figure(GORM_POSES, paintGorm, SWAPS);
export const GORM_PORTRAIT = paintGormPortrait();

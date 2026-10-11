import type { HeroFrame } from "./animate.js";
import {
  head,
  headTurn,
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
  sword,
  type Side,
} from "../pixel/kit.js";
import { rampSwap, type Palette } from "../pixel/palette.js";
import { Rig, type Point } from "../pixel/rig.js";
import type { Sprite } from "../pixel/sprite.js";

/** Rhea the amazon: a longsword, a red mane, bronze armour and a green skirt. */
export interface RheaPose extends HeroPose {
  /** The sword's angle in degrees, clockwise from pointing right, and its blade's length. */
  readonly sword: number;
  readonly blade: number;
  /** Degrees the mane swings clockwise from hanging down her back: up behind her as she moves, forward when hit. */
  readonly hair: number;
}

/** One canvas and anchor for every frame, tall enough for the longsword raised overhead. */
const idle: RheaPose = {
  size: [96, 83],
  anchor: [38, 80],
  head: [39, 38.5],
  chest: [38, 49],
  waist: [38, 55],
  far: {
    ...armAt([33.5, 46.2], [30.5, 52.5], [31.5, 58]),
    ...legAt([35.5, 60.5], [32.5, 69.5], [31.5, 77.5]),
  },
  near: {
    ...armAt([42.8, 46.2], [45, 52.5], [48.5, 57]),
    ...legAt([40.5, 60.5], [43, 69.5], [44.5, 77.5]),
  },
  sword: 52,
  blade: 22,
  hair: 0,
};
const { far: F, near: N } = idle;

/**
 * Six frames of a light, long stride, the blade carried low: a planted foot sweeps back 6.25 px a frame, her 1.25 px a
 * step for `WALK_STEPS.rhea` steps.
 */
const walk = [0, 1, 2, 3, 4, 5].map((i) => {
  const step = adjust(
    idle,
    stride(idle, i, 6, { reach: 9.375, lift: 5, dip: 1.5 }),
  );
  const swing = Math.cos((i / 6) * 2 * Math.PI);
  const lean = (p: Point, dx: number): Point => [p[0] + dx, p[1]];
  const hand = (p: Point, dx: number): Point => [
    p[0] + dx,
    p[1] - Math.abs(dx) * 0.35,
  ];
  const shoulder = (p: Point) => lean(p, 1);
  return adjust(step, {
    head: lean(step.head, 2),
    chest: lean(step.chest, 1),
    far: armTo(F, shoulder(step.far.shoulder), hand(step.far.hand, 5 * swing)),
    near: armTo(
      N,
      shoulder(step.near.shoulder),
      hand(lean(step.near.hand, 1), -2.5 * swing),
    ),
    sword: 40 + 5 * swing,
    hair: 18 + 6 * Math.abs(swing),
  });
});

/** The combo's fencer's lunge: the back leg straight, the front knee over the foot; every swing keeps the feet. */
const lunge = adjust(idle, {
  far: legAt([38.5, 61], [32, 68.5], [26, 77.5]),
  near: legAt([43.5, 61], [50.5, 68], [52, 77.5]),
});
/** The finisher drops her hips into the same footing. */
const crouch = adjust(lunge, {
  far: legAt([38.5, 64], [31.5, 70], [26, 77.5]),
  near: legAt([43.5, 64], [51.5, 69.5], [52, 77.5]),
});

/**
 * Six frames of a sprint, leaning into it, the mane streaming: a planted foot sweeps back her running speed a step for
 * `RUN_STEPS.rhea` steps (9 px a frame), and the fists pump against the legs, the blade trailing behind and swinging up.
 */
const leaning = adjust(idle, {
  head: [45.5, 41.5],
  chest: [42, 51.5],
  waist: [40, 56.5],
  far: { shoulder: [37, 49], ...legTo(F, [35.5, 62], [31.5, 77.5]) },
  near: { shoulder: [46.5, 49], ...legTo(N, [40.5, 62], [44.5, 77.5]) },
});
const run = [0, 1, 2, 3, 4, 5].map((i) => {
  const step = adjust(
    leaning,
    sprint(leaning, i, 6, { reach: 9, lift: 11, dip: 2 }),
  );
  // 1 as the near foot lands ahead, when the far fist is forward and the near one back.
  const swing = Math.cos((i / 6) * 2 * Math.PI);
  const pump = (side: Side, ahead: number) =>
    armTo(
      side,
      side.shoulder,
      offset(side.shoulder, -6 + 12 * ahead, 7 - 5 * ahead),
    );
  return adjust(step, {
    far: pump(step.far, (1 + swing) / 2),
    near: pump(step.near, (1 - swing) / 2),
    sword: -170 + 120 * ((1 - swing) / 2) ** 2,
    hair: 55 + 8 * Math.abs(swing),
  });
});

/**
 * Riding a beast, seated astride its saddle: the hips on the seat, the near leg down its flank to the stirrup, the
 * greave's sole on the anchor (which the scene sets on the saddle point), the far leg out of sight on its far side and
 * the far hand on the reins.
 */
const seat = adjust(idle, {
  head: [39.5, 41.5],
  chest: [38, 52],
  waist: [38, 58],
  far: { ...armTo(F, [33.5, 49.2], [42, 57]), hip: [35, 63.5] },
  near: {
    ...armTo(N, [42.8, 49.2], [49, 54.5]),
    ...legTo(N, [40.5, 63.5], [42.5, 77.5]),
  },
  sword: -45,
  hair: 10,
  astride: true,
});

const poses: Readonly<Record<HeroFrame, RheaPose>> = {
  idle0: idle,
  idle1: adjust(idle, { ...breath(idle, 1), sword: 54 }),
  walk0: walk[0]!,
  walk1: walk[1]!,
  walk2: walk[2]!,
  walk3: walk[3]!,
  walk4: walk[4]!,
  walk5: walk[5]!,
  // Off the ground the front knee tucks and the blade rises; she comes down legs first, the blade forward.
  rise: adjust(idle, {
    head: [40, 36.5],
    chest: [39, 47],
    waist: [38.5, 53],
    far: {
      ...armTo(F, [34.5, 44.2], [25, 42]),
      // The trailing toe points down to the anchor's row, which every frame keeps.
      ...legTo(F, [36.5, 59.5], [33, 77.5]),
    },
    near: {
      ...armTo(N, [43.5, 44.2], [51, 36], 1),
      ...legAt([41, 58.5], [48.5, 59], [45.5, 67]),
    },
    sword: -50,
    hair: -10,
  }),
  fall: adjust(idle, {
    head: [39.5, 38],
    chest: [38.5, 48.5],
    waist: [38, 54.5],
    far: {
      ...armTo(F, [34, 45.5], [24, 44]),
      ...legTo(F, [35.5, 60], [33, 77.5]),
    },
    near: {
      ...armTo(N, [43, 45.5], [53, 47]),
      ...legTo(N, [40.5, 60], [44, 72]),
    },
    sword: -15,
    hair: 40,
  }),
  land: adjust(idle, {
    head: [39.5, 43],
    chest: [38.5, 53.5],
    waist: [38, 59.5],
    far: {
      ...armTo(F, [34, 50.5], [30, 61.5]),
      ...legAt([35.5, 64.5], [30.5, 70], [31.5, 77.5]),
    },
    near: {
      ...armTo(N, [43.5, 50.5], [51, 58]),
      ...legAt([40.5, 64.5], [47, 70], [44.5, 77.5]),
    },
    sword: 30,
    hair: -15,
  }),
  // A quick flat slash: the blade drawn back across her body sweeps level through the air in front of her.
  windup1: adjust(lunge, {
    head: [40.5, 40],
    chest: [39, 50.5],
    waist: [40, 56],
    far: armTo(F, [34.5, 47.5], [44, 50]),
    near: armTo(N, [43, 47.5], [35, 53], 1),
    sword: 174,
    hair: 5,
  }),
  strike1: adjust(lunge, {
    head: [43, 40],
    chest: [41, 50],
    waist: [40.5, 56],
    far: armTo(F, [36.5, 47.3], [26, 50]),
    near: armTo(N, [45.5, 47.3], [57.5, 47.5]),
    sword: -2,
    smear: {
      center: [64, 90],
      inner: 40,
      outer: 46.6,
      from: -127,
      to: -67,
    },
    face: "yell",
    hair: 35,
  }),
  follow1: adjust(lunge, {
    head: [43.5, 41],
    chest: [41.5, 51],
    waist: [41, 56.5],
    far: armTo(F, [37, 48.5], [27.5, 54]),
    near: armTo(N, [46, 48.5], [55, 55]),
    sword: 25,
    hair: 25,
  }),
  // The thrust: the blade drawn back level beside her, then the whole arm and blade driven straight out.
  windup2: adjust(lunge, {
    head: [40, 40.5],
    chest: [39, 51],
    waist: [40, 56.5],
    far: armTo(F, [34.5, 48], [27, 55]),
    near: armTo(N, [43.5, 48], [41, 52]),
    sword: -4,
    hair: 5,
  }),
  strike2: adjust(lunge, {
    head: [45, 40.5],
    chest: [43, 50],
    waist: [41, 56],
    far: armAt([38, 47.2], [32, 52], [29.5, 57]),
    near: armAt([47.4, 47.2], [54, 48.5], [60, 49]),
    sword: -2,
    smear: { center: [75, 49], inner: 7, outer: 10, from: -50, to: 50 },
    face: "yell",
    hair: 35,
  }),
  follow2: adjust(lunge, {
    head: [44, 40.5],
    chest: [42, 50.5],
    waist: [41, 56],
    far: armTo(F, [37, 47.5], [28.5, 56]),
    near: armTo(N, [46.5, 47.5], [58, 51.5]),
    sword: 6,
    hair: 25,
  }),
  // The finisher: the blade whirled up behind her and right round overhead, down into a crouch.
  windup3: adjust(lunge, {
    head: [37.5, 40],
    chest: [37, 50],
    waist: [39, 56],
    far: armTo(F, [33, 47], [41, 56]),
    near: armTo(N, [42, 47], [42, 29], 1),
    sword: 195,
    hair: -5,
  }),
  strike3: adjust(crouch, {
    head: [46, 44],
    chest: [43.5, 53.5],
    waist: [41.5, 59.5],
    far: armTo(F, [38.5, 51], [30, 56]),
    near: armTo(N, [48, 51], [57, 57]),
    sword: 33,
    smear: { center: [50, 50], inner: 26, outer: 33, from: 140, to: 396 },
    face: "yell",
    hair: 45,
  }),
  follow3: adjust(crouch, {
    head: [47.5, 46],
    chest: [45, 55.5],
    waist: [42.5, 61],
    far: {
      ...armTo(F, [40, 52], [32, 61]),
      ...legAt([38.5, 65], [31.5, 70.5], [26, 77.5]),
    },
    near: {
      ...armTo(N, [49, 53], [59, 61]),
      ...legAt([43.5, 65], [52, 70], [52, 77.5]),
    },
    sword: 45,
    hair: 30,
  }),
  hurt: adjust(idle, {
    head: [34.5, 41],
    chest: [35, 51],
    waist: [36.5, 56.5],
    far: {
      ...armTo(F, [30, 48], [22, 42], 1),
      ...legAt([35.5, 61], [32.5, 70], [31.5, 77.5]),
    },
    near: {
      ...armTo(N, [41.5, 48], [50, 56]),
      ...legAt([40.5, 61], [43.5, 70], [44.5, 77.5]),
    },
    sword: 70,
    face: "pain",
    hair: -35,
  }),
  // Flung back through the air, head first, then flat on her back, the mane spread on the ground.
  knockdown: adjust(idle, {
    head: [25, 74.5],
    chest: [36, 74.5],
    waist: [43, 75],
    far: {
      ...armAt([34, 72.5], [30, 66.5], [25, 63.5]),
      ...legAt([47, 74.5], [55, 69.5], [62, 65.5]),
    },
    near: {
      ...armAt([36, 71.5], [39, 64.5], [36, 59.5]),
      ...legAt([48, 73.5], [56, 72.5], [64, 69.5]),
    },
    sword: -125,
    tilt: -90,
    face: "pain",
    hair: 60,
  }),
  down: adjust(idle, {
    head: [25, 74.5],
    chest: [36, 74.5],
    waist: [43, 75],
    far: {
      ...armAt([34, 76], [27, 78.5], [20, 78]),
      ...legAt([47, 76], [56, 77], [65, 78]),
    },
    near: {
      ...armAt([36, 72], [40, 77], [45, 73]),
      ...legAt([48, 74], [57, 74.5], [66, 77]),
    },
    sword: -2,
    tilt: -90,
    face: "out",
    hair: 60,
  }),
  getup: adjust(idle, {
    head: [40, 50],
    chest: [38, 60],
    waist: [37, 65.5],
    far: {
      ...armAt([31, 56.5], [28, 63], [30, 68]),
      ...legAt([34, 70], [32, 77], [23, 77]),
    },
    near: {
      ...armAt([45, 56.5], [48, 63], [50, 67]),
      ...legAt([39, 70], [47, 66], [48, 77.5]),
    },
    sword: 30,
    hair: 0,
  }),
  // Magic: braced, the longsword raised upright before her and her free hand open to the sky, then thrust up.
  charge: adjust(idle, {
    far: {
      ...armTo(F, [33.5, 46.2], [27, 38]),
      ...legTo(F, [35.5, 61], [29, 77.5]),
    },
    near: {
      ...armTo(N, [42.8, 46.2], [47.5, 44], 1),
      ...legTo(N, [40.5, 61], [47, 77.5]),
    },
    sword: -84,
    hair: 12,
  }),
  cast: adjust(idle, {
    head: [38.5, 37.5],
    far: {
      ...armTo(F, [33.5, 45.5], [30, 32]),
      ...legTo(F, [35.5, 61], [29, 77.5]),
    },
    near: {
      ...armTo(N, [42.8, 45.5], [44, 32], 1),
      ...legTo(N, [40.5, 61], [47, 77.5]),
    },
    sword: -90,
    hair: 28,
    face: "yell",
  }),
  run0: run[0]!,
  run1: run[1]!,
  run2: run[2]!,
  run3: run[3]!,
  run4: run[4]!,
  run5: run[5]!,
  // The shoulder charge, lighter and longer than Brakka's: the near shoulder leading, the blade trailing; then she
  // brakes on the front foot.
  dash: adjust(idle, {
    head: [46, 47.5],
    chest: [43, 53.5],
    waist: [40, 58.5],
    far: {
      ...armTo(F, [37, 51], [48, 56]),
      ...legTo(F, [36.5, 62.5], [21, 77.5]),
    },
    near: {
      ...armTo(N, [50, 51], [36, 61], 1),
      ...legTo(N, [41.5, 62.5], [51, 77.5]),
    },
    sword: 168,
    face: "yell",
    hair: 65,
  }),
  dashstop: adjust(idle, {
    head: [40, 40],
    chest: [38, 51],
    waist: [38, 57],
    far: {
      ...armTo(F, [33.5, 48], [28, 56]),
      ...legTo(F, [35.5, 62], [28, 77.5]),
    },
    near: {
      ...armTo(N, [43, 48], [51, 56]),
      ...legTo(N, [40.5, 62], [52, 77.5]),
    },
    sword: 22,
    hair: -10,
  }),
  // The jump attack: the blade raised overhead in the air, then driven down and forward, the front knee tucked.
  jumpwindup: adjust(idle, {
    head: [40, 37],
    chest: [39, 47.5],
    waist: [38.5, 53.5],
    far: {
      ...armTo(F, [34.5, 45], [26, 42], 1),
      ...legTo(F, [36, 59.5], [32, 77.5]),
    },
    near: {
      ...armTo(N, [43.5, 45], [46, 33], 1),
      ...legAt([41, 59], [48.5, 60], [45.5, 68]),
    },
    sword: -100,
    hair: -10,
  }),
  jumpstab: adjust(idle, {
    head: [44, 40.5],
    chest: [41.5, 50.5],
    waist: [39.5, 56.5],
    far: {
      ...armTo(F, [36, 47.5], [27, 45], 1),
      ...legTo(F, [37, 61], [33, 77.5]),
    },
    near: {
      ...armTo(N, [47, 47.5], [54, 56]),
      ...legAt([42, 61], [50, 62.5], [45, 69.5]),
    },
    sword: 55,
    smear: { center: [49, 50], inner: 18, outer: 27, from: -95, to: 55 },
    face: "yell",
    hair: 40,
  }),
  // The back attack: she looks over her shoulder and whips the blade up and over, back behind her.
  backwindup: adjust(lunge, {
    head: [41.5, 40],
    chest: [39, 50],
    waist: [39.5, 56],
    far: armTo(F, [35, 47], [31, 57]),
    near: armTo(N, [45, 47], [50, 38], 1),
    sword: -55,
    hair: 45,
    lookBack: true,
  }),
  backstrike: adjust(lunge, {
    head: [37, 40],
    chest: [37, 50.5],
    waist: [39, 56],
    far: armTo(F, [32.5, 47.5], [37, 57]),
    near: armTo(N, [43, 47.5], [29, 49], 1),
    sword: 185,
    smear: { center: [35, 50], inner: 18, outer: 27, from: -60, to: -175 },
    face: "yell",
    hair: 70,
    lookBack: true,
  }),
  backfollow: adjust(lunge, {
    head: [37, 41],
    chest: [37, 51],
    waist: [39, 56.5],
    far: armTo(F, [32.5, 48], [38, 58]),
    near: armTo(N, [43, 48], [31, 57], 1),
    sword: 150,
    hair: 35,
    lookBack: true,
  }),
  // The grab clutches with both hands; the throw heaves the body up over her head and tosses it behind her.
  grab: adjust(lunge, {
    head: [42.5, 40],
    chest: [40.5, 50.5],
    waist: [40, 56],
    far: armTo(F, [36, 47.5], [51, 47]),
    near: armTo(N, [45.5, 47.5], [53, 54]),
    sword: 75,
    face: "yell",
    hair: 15,
  }),
  heave: adjust(crouch, {
    head: [38, 41],
    chest: [37.5, 52],
    waist: [39, 58],
    far: armTo(F, [33, 49], [36, 35], 1),
    near: armTo(N, [43, 49], [44.5, 35]),
    sword: -120,
    face: "yell",
    hair: 0,
  }),
  toss: adjust(lunge, {
    head: [36, 41],
    chest: [36.5, 51.5],
    waist: [38.5, 57],
    far: armTo(F, [32, 48.5], [24, 44], 1),
    near: armTo(N, [42, 48.5], [28, 45.5], 1),
    sword: 200,
    hair: 35,
    lookBack: true,
  }),
  // In the saddle: the blade held ready; drawn back over her shoulder as the beast winds up, then thrust at the foe as
  // it strikes; low over its neck through a hop, the mane streaming.
  ride: seat,
  ridewindup: adjust(seat, {
    head: [37.5, 41.5],
    chest: [37, 52],
    waist: [37.5, 58],
    far: armTo(F, [32.5, 49.2], [40, 57]),
    near: armTo(N, [41.8, 49.2], [48, 40], 1),
    sword: -135,
    hair: 20,
  }),
  rideattack: adjust(seat, {
    head: [43, 42],
    chest: [40.5, 52.5],
    waist: [39, 58],
    far: armTo(F, [36, 49.5], [43, 58]),
    near: armTo(N, [45, 49.5], [57, 51]),
    sword: -5,
    face: "yell",
    hair: 40,
  }),
  ridehop: adjust(seat, {
    head: [42, 42.5],
    chest: [40, 53],
    waist: [39, 58.5],
    far: armTo(F, [35.5, 50], [45, 58]),
    near: armTo(N, [45, 50], [53, 44]),
    sword: -65,
    hair: 35,
  }),
};
export const RHEA_POSES = poses;

const FACES: Faces = {
  calm: ["4k", " k", "", "", "  1"],
  yell: ["4k", " k", "", "  k", "  1"],
  pain: ["k4", " kk", "", "  k", "  k"],
  out: ["", "kk", "", "", "  1"],
};

/** The mane's joints as it hangs, from the crown down her back, and their radii. */
const MANE: readonly (readonly [dx: number, dy: number, r: number])[] = [
  [-2, -1, 4.8],
  [-4, 6, 4.2],
  [-2.5, 7, 3.2],
  [-0.5, 6, 1.4],
];

export function paintRhea(pose: RheaPose): Sprite {
  const { head: h, chest, waist, far, near } = pose;
  const at = turn(pose.tilt);
  // The neck and everything above it turn with the head, which may look back over the shoulder.
  const look = headTurn(pose, at);
  const rig = new Rig(...pose.size);
  if (pose.smear) rig.smear(pose.smear);
  // The mane hangs from the crown in screen space, swung as one piece about it; lying down it spreads flat. Looking
  // back, it hangs and swings the other way.
  const back = pose.lookBack ? -1 : 1;
  const swing = (pose.hair * Math.PI) / 180;
  const [cos, sin] = [Math.cos(swing), back * Math.sin(swing)];
  const flat = 1 - 0.4 * Math.abs(Math.sin(((pose.tilt ?? 0) * Math.PI) / 180));
  const mane = { group: "mane", bias: 0.1 };
  let [prev, radius] = [look(h, MANE[0]![0], MANE[0]![1]), MANE[0]![2] * flat];
  for (const [across, dy, r] of MANE.slice(1)) {
    const dx = back * across;
    const next: Point = [
      prev[0] + dx * cos - dy * sin,
      prev[1] + dx * sin + dy * cos,
    ];
    rig.capsule(prev, next, radius, r * flat, "e", mane);
    [prev, radius] = [next, r * flat];
  }
  const slim = { thick: 0.8 };
  const greave = { thick: 0.86, boot: "n", bootTop: 0.2, foot: "l" };
  arm(rig, far, { ...BACK, ...slim, bracer: "n" });
  fist(rig, far.hand, { ...BACK, ...slim });
  if (!pose.astride) leg(rig, far, { ...BACK, ...greave });
  // Hips, waist, chest and neck one part, the bronze breastplate over them; the wide parts are capsules, which turn
  // with the body where an ellipse would not.
  const hips = between(far.hip, near.hip);
  const body = { group: "body" };
  rig.capsule(at(hips, -2.2, -1), at(hips, 2.2, -1), 4, 4, "s", body);
  rig.ellipse(waist, 4.6, 4.8, "s", body);
  rig.ellipse(chest, 5.9, 5.3, "s", body);
  rig.capsule(look(h, -0.8, 3.5), at(chest, 0.5, -4), 2, 2.3, "s", body);
  const plate = { group: "plate" };
  rig.capsule(at(chest, -1.4, 1.8), at(chest, 2.2, 1.8), 3.6, 3.6, "n", plate);
  rig.ellipse(at(chest, -2, 0.4), 2.8, 2.6, "n", { ...plate, flat: 0.8 });
  rig.ellipse(at(chest, 2.6, 0.4), 3.1, 2.8, "n", { ...plate, flat: 0.8 });
  head(rig, h, look, 0.92);
  const fringe = { group: "fringe", edge: "none" } as const;
  rig.ellipse(look(h, -0.6, -3), 4.3, 2.6, "e", fringe);
  rig.capsule(look(h, -3.6, -1.5), look(h, -3.2, 4.5), 2, 1.5, "e", fringe);
  const circlet = { edge: "none", flat: 0.3 } as const;
  rig.capsule(look(h, -3.6, -1.9), look(h, 3.3, -2.1), 0.6, 0.6, "n", circlet);
  leg(rig, near, greave);
  // A green skirt under a bronze belt.
  const skirt = [
    at(hips, -6, -2),
    at(hips, 6, -2),
    at(hips, 7, 4),
    at(hips, 3, 5),
    at(hips, -2, 4.5),
    at(hips, -6.5, 3),
  ];
  rig.poly(skirt, "v");
  const belt = { edge: "shade" } as const;
  rig.capsule(at(hips, -6, -2), at(hips, 6, -2), 1.1, 1.1, "n", belt);
  arm(rig, near, { ...slim, bracer: "n", pad: "n" });
  sword(rig, near.hand, pose.sword, pose.blade, 3, { thick: 0.84, guard: 3 });
  const painting = rig.bake();
  return stampFace(painting, h, look, FACES[pose.face ?? "calm"]).sprite(
    pose.anchor,
  );
}

/** The HUD's 16 × 16 portrait: her face under a bronze circlet, the red mane falling past her shoulders. */
export function paintRheaPortrait(): Sprite {
  const mane = { group: "mane", bias: 0.1 };
  const fringe = { group: "fringe", edge: "none" } as const;
  return portrait({
    behind: (rig) =>
      rig
        .ellipse([10, 17.5], 6, 2.2, "n", { group: "plate" })
        .capsule([6.5, 5], [4.5, 15], 4.4, 3.2, "e", mane)
        .capsule([5, 4], [3, 9], 2, 1.2, "e", mane),
    over: (rig) =>
      rig
        .ellipse([9, 4], 4.8, 2.6, "e", fringe)
        .capsule([5.5, 4.5], [5.5, 10], 2, 1.6, "e", fringe)
        .capsule([5, 5.2], [13, 5], 0.7, 0.7, "n", { edge: "none" }),
    face: [
      [10, 7, ["4k", " k"]],
      [12, 11, ["c"]],
    ],
    jaw: 0.85,
  });
}

const hair = (light: string, base: string, shadow: string): Palette => ({
  E: light,
  e: base,
  4: shadow,
});

/**
 * Up to five Rheas in one room, told apart by her hair, armour and skirt: red, bronze and green, then blond, steel and
 * blue; black, bronze and violet; silver, steel and red; chestnut, bronze and teal.
 */
const SWAPS: Readonly<Record<string, Palette>> = {
  second: {
    ...rampSwap("Ee4", "Hh3"),
    ...rampSwap("Nn8", "Mm7"),
    ...rampSwap("Vv!", "Uu@"),
  },
  third: {
    ...hair("#6c5e78", "#3a2e48", "#1e1628"),
    ...rampSwap("Vv!", "Qq^"),
    S: "#d8946a",
    s: "#9c5a3c",
    1: "#5a2e30",
  },
  fourth: {
    ...rampSwap("Ee4", "Ww5"),
    ...rampSwap("Nn8", "Mm7"),
    ...rampSwap("Vv!", "Cc0"),
  },
  fifth: {
    ...hair("#b58a6a", "#5e3a36", "#2c1828"),
    ...rampSwap("Vv!", "Yy&"),
  },
};

export const RHEA = figure(RHEA_POSES, paintRhea, SWAPS);
export const RHEA_PORTRAIT = paintRheaPortrait();

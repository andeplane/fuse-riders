import type { EnemyAnim, Tier } from "../../engine/view.js";
import { LANCER_STEPS, SPEAR } from "../../engine/view-kit.js";
import type { AnimStrip } from "./animate.js";
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
  offset,
  stride,
  turned,
  type Pose,
  type Side,
} from "../pixel/kit.js";
import { rampSwap, type Palette } from "../pixel/palette.js";
import { Rig, type Painting, type Point } from "../pixel/rig.js";
import type { Sprite } from "../pixel/sprite.js";

/**
 * The lancer, the spear-carrying foot soldier: a bronze helm with a plume, a white steel cuirass over a pleated skirt,
 * leather boots banded at the knee and a long spear with a steel head. Its plume, skirt and knee bands are red, the
 * tier ramp (`Cc0`) that `LANCER_TIERS` recolours, as a ravager's tunic is.
 */
export interface LancerPose extends Pose {
  /** The head's turn in degrees, clockwise: positive nods forward, -90 lies on its back. */
  readonly tilt: number;
  /** The spear's angle in degrees, clockwise from pointing right: from the butt toward the head. */
  readonly spear: number;
  /** How far the spear's point is from the near hand along the haft (`HOLD`): a thrust lets it slide out. */
  readonly hold: number;
  /** The thrust's speed lines streaking back along the haft. */
  readonly lunge?: boolean;
  /** The wind-up's glint on the spear's point. */
  readonly glint?: boolean;
  /** The spear's point is driven into the floor: what reaches below the feet is cut off, and clods fly. */
  readonly buried?: boolean;
  /** Mouth open in pain. */
  readonly pain?: boolean;
  /** The far hand has let go of the haft and goes where the pose puts it. */
  readonly loose?: boolean;
  /** The spear has fallen from the hands to lie on the floor along `spear`, its point here. */
  readonly dropped?: Point;
  /** Astride a beast: the far leg is on its far side, out of sight. */
  readonly astride?: boolean;
}

/** One canvas and one feet anchor for every frame: room ahead for the thrust, behind for the drawn-back spear. */
const SIZE: Point = [104, 72];
const ANCHOR: Point = [46, 66];
/** A point `dx` ahead of the feet and `up` above them. */
const F = (dx: number, up: number): Point => [ANCHOR[0] + dx, ANCHOR[1] - up];
/** The arm's and the leg's two bones. */
const ARM = [7, 6.5] as const;
const LEG = [8.8, 7.6] as const;
/** The spear: its whole length, and how far its point usually is from the near hand. */
const SPEAR_LENGTH = 46;
const HOLD = 26;
/** The spear's steel head, from its point back to the bronze socket. */
const HEAD = 7;

/** How far a spine from `top` down to `bottom` leans, in degrees clockwise from upright. */
const lean = (top: Point, bottom: Point) =>
  (Math.atan2(top[0] - bottom[0], bottom[1] - top[1]) * 180) / Math.PI;

/** The spear's point and butt in a pose. */
export function spearEnds({ near, spear, hold, dropped }: LancerPose): {
  tip: Point;
  butt: Point;
} {
  const tip = dropped ?? turned(near.hand, spear)(hold, 0);
  return { tip, butt: turned(tip, spear)(-SPEAR_LENGTH, 0) };
}

interface Build {
  readonly head: Point;
  readonly tilt?: number;
  readonly chest: Point;
  readonly waist: Point;
  /** The far shoulder and the near one. */
  readonly shoulders: readonly [Point, Point];
  readonly hand: Point;
  readonly spear: number;
  readonly hold?: number;
  /** The far hand grips the haft this far behind the near one; otherwise it is at `free`. */
  readonly grip?: number;
  readonly free?: Point;
  /** Which way each elbow bends (`bend`'s side): -1, below a forward reach, unless given. */
  readonly elbows?: readonly [far: 1 | -1, near: 1 | -1];
  readonly hips: readonly [Point, Point];
  readonly ankles: readonly [Point, Point];
}
type Flags = Pick<LancerPose, "lunge" | "glint" | "buried" | "pain">;

/** A pose from its key joints: the elbows and knees bent to the bones' lengths, the far hand on the haft if it grips. */
function build(b: Build, flags: Flags = {}): LancerPose {
  const along = turned(b.hand, b.spear);
  const farHand = b.grip === undefined ? b.free! : along(-b.grip, 0);
  const [farElbow, nearElbow] = b.elbows ?? [-1, -1];
  const armTo = (shoulder: Point, hand: Point, side: 1 | -1) =>
    armAt(shoulder, bend(shoulder, hand, ...ARM, side), hand);
  const legTo = (hip: Point, ankle: Point) =>
    legAt(hip, bend(hip, ankle, ...LEG, 1), ankle);
  return {
    size: SIZE,
    anchor: ANCHOR,
    head: b.head,
    tilt: b.tilt ?? 0,
    chest: b.chest,
    waist: b.waist,
    far: {
      ...armTo(b.shoulders[0], farHand, farElbow),
      ...legTo(b.hips[0], b.ankles[0]),
    },
    near: {
      ...armTo(b.shoulders[1], b.hand, nearElbow),
      ...legTo(b.hips[1], b.ankles[1]),
    },
    spear: b.spear,
    hold: b.hold ?? HOLD,
    ...(b.grip === undefined && { loose: true }),
    ...flags,
  };
}

/** The whole pose turned `degrees` clockwise about `pivot` and moved by `move`, head and spear with it. */
function tipped(
  pose: LancerPose,
  degrees: number,
  pivot: Point,
  [mx, my]: Point,
): LancerPose {
  const turn = turned(pivot, degrees);
  const to = ([x, y]: Point): Point => {
    const [tx, ty] = turn(x - pivot[0], y - pivot[1]);
    return [tx + mx, ty + my];
  };
  const side = (s: Side): Side => ({
    shoulder: to(s.shoulder),
    elbow: to(s.elbow),
    hand: to(s.hand),
    hip: to(s.hip),
    knee: to(s.knee),
    ankle: to(s.ankle),
  });
  return {
    ...pose,
    head: to(pose.head),
    chest: to(pose.chest),
    waist: to(pose.waist),
    far: side(pose.far),
    near: side(pose.near),
    tilt: pose.tilt + degrees,
    spear: pose.spear + degrees,
  };
}

/** At ease: the spear upright at its side, its butt by the near foot, the far hand on the hip. */
const idle = build({
  head: F(2.5, 38.5),
  chest: F(0.5, 29),
  waist: F(0, 23),
  shoulders: [F(-5, 32), F(6, 31.5)],
  hand: F(9.5, 22.5),
  spear: -82,
  free: F(-7, 21),
  hips: [F(-2.5, 18.5), F(2.5, 18.5)],
  ankles: [F(-6, 2.5), F(6.5, 2.5)],
});

/** The walk carries the spear sloped forward over the near shoulder's side, the far hand on the haft below. */
const carry = build({
  head: F(3, 38.5),
  chest: F(0.5, 29),
  waist: F(0, 23),
  shoulders: [F(-5, 32), F(6, 31.5)],
  hand: F(9, 25),
  spear: -64,
  grip: 9,
  hips: [F(-2.5, 18.5), F(2.5, 18.5)],
  ankles: [F(-6, 2.5), F(6.5, 2.5)],
});
/**
 * The walk's stride: a planted foot keeps pace with an ash lancer's walk, 0.8 px a step, for `LANCER_WALK_STEPS` a
 * frame (a quicker tier's feet slide a little).
 */
export const LANCER_WALK_STEPS = 6;
const STRIDE = { reach: 0.8 * LANCER_WALK_STEPS, lift: 2.5, dip: 1 };
const walk = (i: number) => adjust(carry, stride(carry, i, 4, STRIDE));

/** The telegraph: rocked back on the far foot, the spear brought down level and drawn back, its point glinting. */
const windup = build(
  {
    head: F(-2, 37.5),
    tilt: -8,
    chest: F(-2.5, 28),
    waist: F(-1.5, 22),
    shoulders: [F(-8, 31), F(3, 30.5)],
    hand: F(-1, 25.5),
    spear: -6,
    grip: 10,
    hips: [F(-4, 17.5), F(1, 17.5)],
    ankles: [F(-10, 2.5), F(8, 2.5)],
  },
  { glint: true },
);

/** The thrust: lunging onto the near foot, both arms driving the spear out level, its point at `SPEAR.reach`. */
const THRUST_UP = 24.5;
const THRUST_HOLD = 22;
const thrust = build(
  {
    head: F(8.5, 35.5),
    tilt: 12,
    chest: F(5.5, 27),
    waist: F(3, 21),
    shoulders: [F(0, 30), F(10, 29.5)],
    hand: F(SPEAR.reach - THRUST_HOLD, THRUST_UP),
    hold: THRUST_HOLD,
    spear: 0,
    grip: 10,
    hips: [F(0.5, 17), F(5, 17)],
    ankles: [F(-10, 2.5), F(15, 2.5)],
  },
  { lunge: true },
);

/** After the thrust: the spear drawn back in, its point dipping, the weight coming back over the feet. */
const recover = build({
  head: F(5, 37),
  tilt: 6,
  chest: F(2.5, 28),
  waist: F(1, 22.5),
  shoulders: [F(-3, 31), F(8, 30.5)],
  hand: F(10, 22),
  spear: 14,
  grip: 10,
  hips: [F(-1.5, 18), F(3.5, 18)],
  ankles: [F(-8, 2.5), F(11, 2.5)],
});

/** The leap rising: the near knee driven up, the far leg trailing, the spear raised overhead in both hands. */
const rise = build({
  head: F(3, 38),
  tilt: -6,
  chest: F(0.5, 28.5),
  waist: F(-0.5, 22.5),
  shoulders: [F(-5, 31.5), F(5.5, 31)],
  hand: F(11.5, 43.5),
  spear: -16,
  grip: 11,
  elbows: [1, 1],
  hips: [F(-2, 18), F(3, 18)],
  ankles: [F(-8, 2.5), F(6, 9)],
});

/** The leap falling: legs reaching for the floor, the spear pointed down ahead of it in both hands. */
const fall = build({
  head: F(4.5, 38),
  tilt: 10,
  chest: F(1.5, 28.5),
  waist: F(0, 22.5),
  shoulders: [F(-4, 31.5), F(7, 31)],
  hand: F(8, 25),
  spear: 58,
  grip: 9,
  hips: [F(-2, 18.5), F(3, 18.5)],
  ankles: [F(-6, 2.5), F(5, 3.5)],
});

/** Landed: crouched over the spear it drove into the floor `SPEAR.plunge` ahead, both hands on the haft. */
const PLUNGE_ANGLE = 52;
/** It enters the floor's row (the feet's lowest) mid-pixel at `SPEAR.plunge`, its point `BURIED` deeper. */
const ENTRY = offset(F(SPEAR.plunge, 0), 0.5, 0.5);
const BURIED = 3;
const plungeHand = turned(ENTRY, PLUNGE_ANGLE)(BURIED - HOLD, 0);
const plunge = build(
  {
    head: F(6, 31),
    tilt: 16,
    chest: F(3, 22.5),
    waist: F(0.5, 16.5),
    shoulders: [F(-2, 25.5), F(8.5, 25)],
    hand: plungeHand,
    spear: PLUNGE_ANGLE,
    grip: 9,
    hips: [F(-2.5, 12), F(2.5, 12)],
    ankles: [F(-10, 2.5), F(10, 2.5)],
  },
  { buried: true },
);

/** Struck: the head snaps back, the body reels, the far arm flies out and the spear lurches up in the near hand. */
const hurt = build(
  {
    head: F(-1, 37.5),
    tilt: -20,
    chest: F(-1.5, 28.5),
    waist: F(-0.5, 22.5),
    shoulders: [F(-7, 31.5), F(4, 31)],
    hand: F(10, 27),
    spear: -70,
    hold: 24,
    free: F(-13, 26),
    hips: [F(-3, 18.5), F(2, 18.5)],
    ankles: [F(-7, 2.5), F(6, 2.5)],
  },
  { pain: true },
);

/** The hips, which the falling poses turn about. */
const HIPS = F(0, 18.5);

/** Flung back through the air: tipped over backwards, arms and legs trailing toward the blow, the spear loose. */
const knockdown = tipped(
  build(
    {
      head: F(1, 38),
      tilt: -15,
      chest: F(0, 29),
      waist: F(0, 23),
      shoulders: [F(-5, 32), F(6, 31.5)],
      hand: F(13, 30),
      spear: 40,
      hold: 30,
      free: F(5, 28),
      hips: [F(-2.5, 18.5), F(2.5, 18.5)],
      ankles: [F(7, 5), F(15, 8)],
    },
    { pain: true },
  ),
  -60,
  HIPS,
  [2, 11.5],
);

/** Laid out on its back, head toward where the blow came from, the spear fallen across the floor beside it. */
const downBody = tipped(
  build(
    {
      head: F(2, 38.5),
      tilt: -10,
      chest: F(0, 29),
      waist: F(0, 23),
      shoulders: [F(-5, 32), F(6, 31.5)],
      hand: F(4, 20),
      spear: 90,
      free: F(-6, 20),
      hips: [F(-2.5, 18.5), F(2.5, 18.5)],
      ankles: [F(-1.5, 2.5), F(3.5, 2.5)],
    },
    { pain: true },
  ),
  -90,
  HIPS,
  [4, 8],
);
const down: LancerPose = { ...downBody, spear: 0, dropped: F(24, 1.5) };

/** Getting up: kneeling on the far knee, leaning on the spear planted upright in front. */
const getup = build({
  head: F(5, 31),
  tilt: 10,
  chest: F(2, 22),
  waist: F(1, 16),
  shoulders: [F(-4, 25), F(7.5, 24.5)],
  hand: F(11, 20),
  spear: -86,
  grip: 8,
  hips: [F(-1.5, 11.5), F(3, 11.5)],
  ankles: [F(-11, 2.5), F(9, 2.5)],
});

export const LANCER_POSES = {
  idle,
  breathe: adjust(idle, breath(idle, 1)),
  walk0: walk(0),
  walk1: walk(1),
  walk2: walk(2),
  walk3: walk(3),
  windup,
  thrust,
  recover,
  rise,
  fall,
  plunge,
  hurt,
  knockdown,
  down,
  getup,
};
export type LancerFrame = keyof typeof LANCER_POSES;

/** The enemy view's anims but a ravager's mace, a sack imp's and an ogre's own. */
export type LancerAnim = Exclude<
  EnemyAnim,
  | "attack"
  | "stumble"
  | "flee"
  | "slam"
  | "sweep"
  | "stagger"
  | "ride"
  | "rise"
  | "pile"
  | "reassemble"
>;

const W = LANCER_WALK_STEPS;
const WALK_CYCLE: AnimStrip<LancerFrame> = {
  frames: [
    ["walk0", W],
    ["walk1", W],
    ["walk2", W],
    ["walk3", W],
  ],
  loop: true,
};
const once = (frame: LancerFrame, steps: number): AnimStrip<LancerFrame> => ({
  frames: [[frame, steps]],
  loop: false,
});

/**
 * The lancer's anims, timed to the engine (`LANCER_STEPS`): the wind-up held for an ash lancer's (a quicker tier's ends
 * sooner, on the same frame), the thrust for exactly the steps the spear is out, the stand open after it, the leap
 * rising on every step it climbs and falling after, and the plunge standing over the spear. The rest are as long as
 * the engine keeps any enemy in them, as a ravager's are (hurt 20, knockdown 28, down 45, getup 20, dead 60, held 12,
 * thrown 30); the tests play the engine against them.
 */
export const LANCER_ANIMS: Readonly<
  Record<LancerAnim, AnimStrip<LancerFrame>>
> = {
  idle: {
    frames: [
      ["idle", 32],
      ["breathe", 32],
    ],
    loop: true,
  },
  walk: WALK_CYCLE,
  // A wave's lancer walking back in to a locked screen strides like a walker.
  enter: WALK_CYCLE,
  windup: once("windup", LANCER_STEPS.windup[0]),
  thrust: once("thrust", LANCER_STEPS.thrust),
  recover: once("recover", LANCER_STEPS.recover),
  leap: {
    frames: [
      ["rise", LANCER_STEPS.leapApex + 1],
      ["fall", LANCER_STEPS.leap - LANCER_STEPS.leapApex - 1],
    ],
    loop: false,
  },
  plunge: once("plunge", LANCER_STEPS.plunge),
  hurt: once("hurt", 20),
  knockdown: once("knockdown", 28),
  down: once("down", 45),
  getup: once("getup", 20),
  dead: once("down", 60),
  held: once("hurt", 12),
  thrown: once("knockdown", 30),
};

/**
 * What a lancer wears: the cuirass's, the helm's and the pauldron's metal, the plume (forward, down and girth from the
 * head along its sweep), the spear haft's girth and its head's width, and a captain's cape and gold trim.
 */
export interface LancerGear {
  readonly armour: string;
  readonly helm: string;
  readonly pad: string;
  readonly plume: readonly (readonly [number, number, number])[];
  readonly haft: number;
  readonly blade: number;
  readonly cape?: string;
  readonly trim?: string;
}
/** A foot soldier's: white steel, a bronze helm with a red plume, an ash spear. */
const FOOT_SOLDIER: LancerGear = {
  armour: "m",
  helm: "n",
  pad: "m",
  plume: [
    [1.5, -6.5, 1.2],
    [-1.5, -9.5, 1.9],
    [-6, -8.5, 1.5],
    [-8.8, -3.5, 0.6],
  ],
  haft: 0.75,
  blade: 3.4,
};

/** The ash-wood haft with an iron butt cap, the bronze socket and the leaf-shaped steel head. */
function spear(rig: Rig, pose: LancerPose, gear: LancerGear) {
  const { tip, butt } = spearEnds(pose);
  const along = turned(tip, pose.spear);
  rig.capsule(butt, along(-HEAD + 0.5, 0), gear.haft, gear.haft, "l");
  rig.capsule(butt, turned(butt, pose.spear)(1.5, 0), 0.95, 0.95, "i");
  // The point is drawn through the pixel it lies in.
  rig.blade(along(-HEAD, 0), along(1, 0), gear.blade, "m", { tip: 4.5 });
  rig.capsule(along(-HEAD - 0.6, 0), along(-HEAD + 0.6, 0), 1.2, 1.2, "n");
}

/** The thrust's speed lines: streaks of light either side of the haft, trailing back from the spear's head. */
function lunge(rig: Rig, pose: LancerPose) {
  const { tip } = spearEnds(pose);
  const along = turned(tip, pose.spear);
  const glow = { edge: "none" } as const;
  for (const [across, from, to, key] of [
    [-3.5, -9, -26, "F"],
    [3.5, -11, -30, "F"],
    [-6.5, -14, -22, "F"],
    [-3.5, -9, -17, "Z"],
    [3.5, -11, -19, "Z"],
  ] as const)
    rig.capsule(along(from, across), along(to, across), 0.5, 0.5, key, glow);
}

/** The pleated skirt's outline round the hips, forward and down in the body's axes. */
const SKIRT: readonly Point[] = [
  [-5.5, -1.5],
  [5.5, -1.5],
  [7, 6],
  [-6.5, 6],
];

/** A captain's cape hanging from his shoulders down his back, forward and down along his chest's axes. */
const CAPE: readonly Point[] = [
  [2.5, -4.6],
  [-5.5, -4.2],
  [-9.5, 6],
  [-13.5, 17],
  [-10, 19.5],
  [-6.5, 17.5],
  [-3, 19],
  [-1, 8],
];

export function paintLancer(
  pose: LancerPose,
  gear: LancerGear = FOOT_SOLDIER,
): Sprite {
  const { chest, waist, far, near } = pose;
  const rig = new Rig(...pose.size);
  if (pose.lunge) lunge(rig, pose);
  const spine = lean(chest, waist);
  const torso = turned(chest, spine);
  const belly = turned(waist, spine);
  const hips = turned(between(far.hip, near.hip), spine);
  const head = turned(pose.head, pose.tilt);
  const legs = { material: "s", boot: "l", cuff: "c", bootTop: 0.08 };
  // A cape hangs down the back; on a figure flung down or lying, what would reach under the floor drapes along it.
  if (gear.cape)
    rig.poly(
      CAPE.map(([forward, down]): Point => {
        const [x, y] = torso(forward, down);
        return [x, Math.min(y, pose.anchor[1])];
      }),
      gear.cape,
      { bevel: 1.5, bias: -0.35 },
    );
  arm(rig, far, { ...BACK, bracer: "l" });
  if (pose.loose) fist(rig, far.hand, BACK);
  if (!pose.astride) leg(rig, far, { ...BACK, ...legs });
  // The white steel cuirass, broad at the chest over a narrower waist; a captain's edged in gold at collar and waist.
  const body = { group: "body" };
  rig.capsule(torso(-2, 0), torso(2, 0), 6, 6, gear.armour, body);
  rig.capsule(belly(-1, 0), belly(1, 0), 5.2, 5.2, gear.armour, body);
  const trim = { edge: "none" } as const;
  if (gear.trim) {
    rig.capsule(torso(-3.5, -5), torso(4, -4.4), 0.7, 0.7, gear.trim, trim);
    rig.capsule(belly(-4.4, 3.4), belly(4.6, 3.4), 0.7, 0.7, gear.trim, trim);
  }
  leg(rig, near, legs);
  // The pleated skirt hanging from a bronze belt.
  rig.poly(
    SKIRT.map(([forward, down]) => hips(forward, down)),
    "c",
    { bevel: 1.5 },
  );
  for (const forward of [-3, 0.5, 4])
    rig.capsule(hips(forward, 0), hips(forward + 0.3, 5), 0.4, 0.4, "0", {
      edge: "none",
    });
  rig.capsule(hips(-5.8, -1.6), hips(5.8, -1.6), 1.5, 1.5, "n", {
    edge: "none",
  });
  // The helm: a bronze bowl with a cheek guard over a face showing at the mouth, the plume sweeping up and back.
  const skin = { bias: -0.1 };
  rig.capsule(head(-1, 3), head(-0.5, 6), 2.6, 2.6, "s", skin);
  const face = { group: "head", bias: 0.05 };
  rig.capsule(head(0, 0), head(0.5, 1), 3.7, 3.7, "s", face);
  rig.capsule(head(1.8, 2.4), head(2.4, 2.4), 2.1, 2.1, "s", face);
  const helm = { group: "helm" };
  rig.capsule(head(-1.5, -2), head(1.2, -2), 3.9, 3.9, gear.helm, helm);
  rig.capsule(head(-3.2, 0), head(-2.5, 3.2), 2.4, 2, gear.helm, helm);
  rig.capsule(head(1.8, -0.2), head(3.6, 1.2), 1.6, 1.2, gear.helm, helm);
  if (gear.trim)
    rig.capsule(head(-4.6, -2), head(3, -2.6), 0.7, 0.7, gear.trim, trim);
  const plume = { group: "plume" };
  gear.plume.forEach(([forward, down, girth], i) => {
    const next = gear.plume[i + 1];
    if (next)
      rig.capsule(head(forward, down), head(next[0], next[1]), girth, next[2], "C", plume); // prettier-ignore
  });
  spear(rig, pose, gear);
  if (!pose.loose) fist(rig, far.hand, BACK);
  arm(rig, near, { bracer: "l" });
  // A steel pauldron capping the near shoulder.
  const pad = turned(offset(near.shoulder, 0.2, -0.6), spine);
  rig.capsule(pad(-1.6, 0), pad(1.6, 0), 2.5, 2.3, gear.pad);
  fist(rig, near.hand);
  const painting = rig.bake();
  // The eye a dark slit in the helm, the mouth below it; hurt opens the mouth.
  const dot = (forward: number, down: number, key: string) => {
    const [x, y] = head(forward, down);
    painting.stamp(Math.floor(x), Math.floor(y), [key]);
  };
  for (const forward of [0.5, 1.5, 2.5]) dot(forward, -0.5, "k");
  dot(2.5, 2.5, "1");
  if (pose.pain) [2.5, 3.5].forEach((down) => dot(2, down, "k"));
  if (pose.glint) glint(painting, spearEnds(pose).tip);
  if (pose.buried) bury(painting, pose);
  return painting.sprite(pose.anchor);
}

/** A four-pointed star of light on the spear's point. */
function glint(painting: Painting, [x, y]: Point) {
  const [gx, gy] = [Math.floor(x), Math.floor(y)];
  painting.stamp(gx - 2, gy - 2, ["  F", "  Z", "FZZZF", "  Z", "  F"]);
}

/** Everything under the feet is cleared, and clods of earth burst up round the buried point. */
function bury(painting: Painting, { anchor, size }: LancerPose) {
  const [ay, [w, h]] = [anchor[1], size];
  painting.stamp(1, ay + 1, Array<string>(h - ay - 1).fill(".".repeat(w - 2)));
  const x = Math.floor(ENTRY[0]);
  painting
    .stamp(x - 5, ay - 1, ["9l       l9", "lL9     9Ll"])
    .stamp(x - 7, ay - 6, ["9", "", "", "l"])
    .stamp(x + 6, ay - 8, ["l", "", " 9"]);
}

/** A palette per tier: the lancer's own red, and the ravagers' rust and violet on the same ramp. */
export const LANCER_TIERS: Readonly<Record<Tier, Palette>> = {
  0: {},
  1: rampSwap("Cc0", "Tt%"),
  2: rampSwap("Cc0", "Qq^"),
};

export const LANCER = figure(LANCER_POSES, paintLancer, {
  rust: LANCER_TIERS[1],
  violet: LANCER_TIERS[2],
});

/** The pose builder, the feet-anchored point and the thrust's grip the captain's own poses are built with (`captain.ts`). */
export { build as buildLancer, F as lancerAt, THRUST_HOLD };

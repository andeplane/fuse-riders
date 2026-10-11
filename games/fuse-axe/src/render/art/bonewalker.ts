import type { EnemyAnim } from "../../engine/view.js";
import { BONE_SWORD, BONEWALKER_STEPS } from "../../engine/view-kit.js";
import type { AnimStrip } from "./animate.js";
import {
  adjust,
  armAt,
  armTo,
  BACK,
  bend,
  between,
  figure,
  legAt,
  offset,
  stride,
  turned,
  type Local,
  type Pose,
} from "../pixel/kit.js";
import { rampSwap } from "../pixel/palette.js";
import type { Painting, Point, ShapeOptions } from "../pixel/rig.js";
import { Rig } from "../pixel/rig.js";
import type { Sprite } from "../pixel/sprite.js";

/**
 * The bonewalker, the Drowned Crypt's skeleton swordsman: a skull with glowing eye sockets on a bare spine and
 * ribcage, long bones knobbed at the joints, a tattered loincloth and a rusty sword. The violet one is the knight
 * (`BONE_KNIGHT`), in a rusted helm, breastplate and pauldron, with a tattered cape and a longer blade. The rags and
 * the cape are the enemy-tier ramp (`Aa$`), so a tier is a three-colour swap.
 *
 * A frame is a skeleton: each bone's two ends, the skull's and the pelvis's turn, and the sword's hilt and angle. A
 * frame on its feet is built from a pose's joints, as a ravager's is; the bone pile is the bones heaped on the floor,
 * and the reassembly mixes the two, each bone flying from the heap back to its place. Nothing is drawn below the
 * floor: a sword planted in it, or a body still in its grave, is cut off there.
 */
type Bone = readonly [Point, Point];
// prettier-ignore
const PARTS = ["spine", "farUpper", "farFore", "farHand", "farThigh", "farShin", "farFoot",
  "nearUpper", "nearFore", "nearHand", "nearThigh", "nearShin", "nearFoot"] as const;
type Part = (typeof PARTS)[number];
export interface Skeleton {
  /** Each bone's ends: the spine's from the chest down to the waist, a hand's from the wrist to the fingertips. */
  readonly bones: Readonly<Record<Part, Bone>>;
  readonly skull: Point;
  /** The skull's turn in degrees, clockwise (positive nods forward), and the jaw's drop in pixels. */
  readonly tilt: number;
  readonly jaw: number;
  /** The pelvis, and its turn in degrees clockwise. */
  readonly pelvis: Point;
  readonly hips: number;
  /** The sword's hilt, and its angle in degrees clockwise from pointing right. */
  readonly hilt: Point;
  readonly blade: number;
}
export interface BoneFrame {
  readonly body: Skeleton;
  /** The sword's motion arc, its front at the figure's reach (`BONE_SWORD`). */
  readonly slash?: boolean;
  /** Climbing out of its grave: earth heaped on the lip (1), or clods flying too (2). */
  readonly sunk?: 1 | 2;
  /** The eye sockets dark: a pile at rest, or bones crumbling. */
  readonly dim?: boolean;
  /** Bone dust bursting off a body falling apart. */
  readonly dust?: boolean;
}

/** One canvas and one feet anchor for every frame: room ahead for the knight's slash, above for the raised sword. */
const SIZE: Point = [104, 84];
const ANCHOR: Point = [46, 76];
/** A point `dx` ahead of the feet and `up` above them. */
const F = (dx: number, up: number): Point => [ANCHOR[0] + dx, ANCHOR[1] - up];
/** The arm's and the leg's two bones. */
const ARM: Pose["far"] = { ...armAt([0, 0], [0, 7], [0, 13.5]), ...legAt([0, 0], [0, 9], [0, 17.5]) }; // prettier-ignore

/** How far a spine from `top` down to `bottom` leans, in degrees clockwise from upright. */
const lean = (top: Point, bottom: Point) =>
  (Math.atan2(top[0] - bottom[0], bottom[1] - top[1]) * 180) / Math.PI;

interface BonePose extends Pose {
  readonly tilt: number;
  readonly jaw: number;
  readonly blade: number;
}
/**
 * A pose from its key joints: the shoulders across the top of the chest and the hips under the waist, turned as the
 * spine leans, and the elbows (below a forward reach unless `elbows` says) and knees bent to the bones' lengths.
 */
function build(b: {
  readonly skull: Point;
  readonly tilt: number;
  readonly jaw?: number;
  readonly chest: Point;
  readonly waist: Point;
  /** The far hand and the near one, and so the ankles. */
  readonly hands: readonly [Point, Point];
  readonly ankles: readonly [Point, Point];
  readonly blade: number;
  readonly elbows?: readonly [1 | -1, 1 | -1];
}): BonePose {
  const spine = lean(b.chest, b.waist);
  const [top, bottom] = [turned(b.chest, spine), turned(b.waist, spine)];
  const [farElbow, nearElbow] = b.elbows ?? [-1, -1];
  const side = (i: 0 | 1, elbow: 1 | -1) => {
    const [shoulder, hip] = [top(8 * i - 4, -3.5), bottom(4 * i - 2, 4)];
    const knee = bend(hip, b.ankles[i], 9, 8.5, 1);
    return {
      ...armTo(ARM, shoulder, b.hands[i], elbow),
      ...legAt(hip, knee, b.ankles[i]),
    };
  };
  return {
    size: SIZE,
    anchor: ANCHOR,
    head: b.skull,
    tilt: b.tilt,
    jaw: b.jaw ?? 0,
    chest: b.chest,
    waist: b.waist,
    far: side(0, farElbow),
    near: side(1, nearElbow),
    blade: b.blade,
  };
}

/** `d` on past `b` along the bone from `a`. */
const past = ([a, b]: Bone, d: number): Point => {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [b[0] + ((b[0] - a[0]) / l) * d, b[1] + ((b[1] - a[1]) / l) * d];
};
/** A pose's bones: each limb's from joint to joint, the hands on past the wrists and the feet forward of the ankles. */
function skeletonOf(p: BonePose): Skeleton {
  const { far, near } = p;
  const hand = ({ elbow, hand }: Pose["far"]): Bone => [
    hand,
    past([elbow, hand], 3),
  ];
  const foot = ({ ankle }: Pose["far"]): Bone => [offset(ankle, -1, 1.8), offset(ankle, 3, 2)]; // prettier-ignore
  return {
    // prettier-ignore
    bones: {
      spine: [p.chest, p.waist],
      farUpper: [far.shoulder, far.elbow], farFore: [far.elbow, far.hand], farHand: hand(far),
      farThigh: [far.hip, far.knee], farShin: [far.knee, far.ankle], farFoot: foot(far),
      nearUpper: [near.shoulder, near.elbow], nearFore: [near.elbow, near.hand], nearHand: hand(near),
      nearThigh: [near.hip, near.knee], nearShin: [near.knee, near.ankle], nearFoot: foot(near),
    },
    skull: p.head,
    tilt: p.tilt,
    jaw: p.jaw,
    pelvis: offset(between(far.hip, near.hip), 0, 0.5),
    hips: lean(p.chest, p.waist),
    hilt: near.hand,
    blade: p.blade,
  };
}

/** Every point of a skeleton in one order: each bone's ends, then the skull, the pelvis and the hilt. */
const points = (s: Skeleton): Point[] => [
  ...PARTS.flatMap((part) => s.bones[part]),
  s.skull,
  s.pelvis,
  s.hilt,
];
/** Every point of a skeleton moved by `to` (given its index in `points`), its skull, pelvis and sword turned `turn`. */
function moved(
  s: Skeleton,
  to: (p: Point, i: number) => Point,
  turn = 0,
): Skeleton {
  const all = points(s).map(to);
  const bones = PARTS.map((part, i) => [part, [all[2 * i], all[2 * i + 1]]]);
  const [skull, pelvis, hilt] = all.slice(-3) as [Point, Point, Point];
  return {
    ...s,
    bones: Object.fromEntries(bones) as Record<Part, Bone>,
    ...{ skull, pelvis, hilt },
    tilt: s.tilt + turn,
    hips: s.hips + turn,
    blade: s.blade + turn,
  };
}
/** The whole skeleton turned `degrees` clockwise about `pivot` and moved by `move`: a body tipped over. */
function tipped(s: Skeleton, degrees: number, pivot: Point, move: Point) {
  const turn = turned(pivot, degrees);
  const to = ([x, y]: Point) =>
    offset(turn(x - pivot[0], y - pivot[1]), ...move);
  return moved(s, to, degrees);
}
/** Each bone's ends knocked loose by up to `k` pixels, a different way for each: a skeleton rattling. */
const shaken = (s: Skeleton, k: number) =>
  moved(s, (p, i) => offset(p, ((i % 3) - 1) * k, (((i * 2) % 5) / 2 - 1) * k));
/** The bones spread `wide` times as far either side of the anchor and lifted `high` times as far off the floor. */
const spread = (s: Skeleton, wide: number, high: number) =>
  moved(s, ([x, y]) => F((x - ANCHOR[0]) * wide, (ANCHOR[1] - y) * high));
/**
 * Each bone `t` of the way from where it lies in `from` to where it is in `to`, flung up to `lift` pixels over the
 * straight path on the way (each end a little differently, the feet sliding along the floor to where they stand):
 * the pile pulling itself together.
 */
function mixed(from: Skeleton, to: Skeleton, t: number, lift: number) {
  const mix = (a: number, b: number) => a + (b - a) * t;
  const ends = points(to);
  const fly = (i: number, up: number) =>
    Math.sin(Math.PI * t) * lift * (0.5 + (i % 5) / 8) * Math.min(1, up / 8);
  const body = moved(from, ([x, y], i) => {
    const [tx, ty] = ends[i]!;
    return [mix(x, tx), mix(y, ty) - fly(i, ANCHOR[1] - ty)];
  });
  return {
    ...body,
    tilt: mix(from.tilt, to.tilt),
    jaw: mix(from.jaw, to.jaw),
    hips: mix(from.hips, to.hips),
    blade: mix(from.blade, to.blade),
  };
}

/** Stooped, the sword held low and forward, the far hand hanging. */
// prettier-ignore
const idle = build({ skull: F(3.5, 41), tilt: 6, chest: F(0.5, 31.5), waist: F(0, 23),
  hands: [F(-5, 22), F(9.5, 24)], ankles: [F(-4.5, 2), F(5, 2)], blade: -25 });
/** The idle's sway: the skull lolls back with the jaw hanging, the body settles a pixel and the sword dips. */
// prettier-ignore
const sway = build({ skull: F(4, 40), tilt: -4, jaw: 1, chest: F(1, 30.5), waist: F(0.5, 22.5),
  hands: [F(-4.5, 21), F(10, 23)], ankles: [F(-4.5, 2), F(5, 2)], blade: -18 });
/**
 * The walk's stride: a planted foot keeps pace with a bone bonewalker's walk, 0.7 px a step, for `BONE_WALK_STEPS` a
 * frame. It lurches: the skull jolts, the jaw clacks and the far arm swings loose.
 */
export const BONE_WALK_STEPS = 8;
const STRIDE = { reach: 0.7 * BONE_WALK_STEPS, lift: 3, dip: 1.5 };
// prettier-ignore
const LURCH = [[14, 0, 1, 1, -1, 2], [-2, 1, -0.5, 0, -4, 0], [12, 0, 1, 1, 2, 1], [0, 1.5, 0, -0.5, -2, -1]] as const;
const walk = (i: number) => {
  const step = adjust(idle, stride(idle, i, 4, STRIDE));
  const [tilt, jaw, dx, dy, hx, hy] = LURCH[i]!;
  const far = armTo(step.far, step.far.shoulder, offset(step.far.hand, hx, hy));
  return {
    ...step,
    head: offset(step.head, dx, dy),
    tilt,
    jaw,
    far: { ...step.far, ...far },
  };
};
/** Raising the sword up beside the skull. */
// prettier-ignore
const lift = build({ skull: F(2.5, 41), tilt: -4, chest: F(0, 31.5), waist: F(0, 23),
  hands: [F(3, 25), F(6, 38)], ankles: [F(-5.5, 2), F(6, 2)], blade: -100 });
/** The telegraph: leaning back, the sword raised high behind the skull, the far claw reaching out for balance. */
// prettier-ignore
const windup = build({ skull: F(1, 40.5), tilt: -12, jaw: 1.5, chest: F(-1, 31), waist: F(-0.5, 22.5),
  hands: [F(6, 29), F(0, 45)], elbows: [-1, 1], ankles: [F(-6.5, 2), F(7, 2)], blade: -145 });
/** The slash: lunging, the sword brought down in front through a motion arc. */
// prettier-ignore
const attack = build({ skull: F(7, 38.5), tilt: 16, chest: F(3, 30), waist: F(1, 21.5),
  hands: [F(-5, 25), F(14, 26)], ankles: [F(-7.5, 2), F(9, 2)], blade: 30 });
/** After the slash: the sword hanging point down in front, the body coming back up. */
// prettier-ignore
const recover = build({ skull: F(5, 39.5), tilt: 10, chest: F(1.5, 30.5), waist: F(0.5, 22),
  hands: [F(-4.5, 22), F(11, 21)], ankles: [F(-6, 2), F(7.5, 2)], blade: 70 });
/** Struck: the skull snaps back with its jaw hanging open, the arms flung out. */
// prettier-ignore
const hurt = build({ skull: F(-0.5, 40), tilt: -22, jaw: 2, chest: F(-1.5, 31), waist: F(-0.5, 22.5),
  hands: [F(-11, 29), F(9, 31)], ankles: [F(-5.5, 2), F(5.5, 2)], blade: -60 });
/** On one knee, leaning on the sword planted in front: getting up, and the end of a reassembly. */
// prettier-ignore
const kneel = build({ skull: F(5, 33), tilt: 12, chest: F(2, 24), waist: F(1, 15.5),
  hands: [F(-3, 16), F(10, 17)], ankles: [F(-10, 1.5), F(7, 2)], blade: 82 });
/** The hips, which the falling poses turn about. */
const HIPS = F(0, 19);

/**
 * Clawing up out of its grave, the floor its lip: a claw bursting up through the earth, the sword's point and the
 * claw gripping the lip, the skull coming up between the hands, the shoulders heaving out, a leg climbing over the
 * lip, then crouched on it.
 */
// prettier-ignore
const RISE: readonly BonePose[] = [
  build({ skull: F(1, -9), tilt: 0, chest: F(0, -10), waist: F(0, -18),
    hands: [F(-1.5, 5.5), F(5, -14)], elbows: [1, -1], ankles: [F(-4, -36), F(4, -36)], blade: -90 }),
  build({ skull: F(1, -5), tilt: -10, chest: F(0, -12), waist: F(0, -20),
    hands: [F(-7, 2), F(5.5, -2)], elbows: [1, -1], ankles: [F(-4, -38), F(4, -38)], blade: -80 }),
  build({ skull: F(1.5, 2.5), tilt: -14, chest: F(0.5, -6.5), waist: F(0, -14.5),
    hands: [F(-9, 1.5), F(9, 2)], elbows: [1, 1], ankles: [F(-4, -32), F(4, -32)], blade: -75 }),
  build({ skull: F(2.5, 12), tilt: 4, jaw: 1.5, chest: F(1, 3), waist: F(0.5, -5.5),
    hands: [F(-9, 1.5), F(10, 1.5)], elbows: [1, 1], ankles: [F(-4, -23), F(4, -23)], blade: -40 }),
  build({ skull: F(3.5, 22), tilt: 10, chest: F(1.5, 13), waist: F(1, 4.5),
    hands: [F(-8, 1.5), F(11, 8)], elbows: [1, -1], ankles: [F(-3, -12), F(8, 2)], blade: 60 }),
  build({ skull: F(4.5, 33), tilt: 12, jaw: 1, chest: F(2, 24), waist: F(1, 15.5),
    hands: [F(-5, 15), F(10, 17)], ankles: [F(-6, 2), F(7, 2)], blade: 82 }),
];

/** The bone pile: the ribcage on its side, the long bones crossed under and over it, the skull on top, the sword stuck in it. */
// prettier-ignore
const PILE: Skeleton = {
  bones: {
    spine: [F(-7, 4.5), F(1.5, 4.5)], farUpper: [F(-12, 1.5), F(-5, 2.5)], farFore: [F(1, 1.5), F(7.5, 4)],
    farHand: [F(-16, 1.5), F(-13, 1)], farThigh: [F(-13, 4), F(-4.5, 1.5)], farShin: [F(5, 1.5), F(13.5, 1.5)],
    farFoot: [F(14.5, 1), F(18, 1.5)], nearUpper: [F(2.5, 7), F(9, 3)], nearFore: [F(-9, 7), F(-2.5, 9.5)],
    nearHand: [F(-19, 1), F(-16, 1.5)], nearThigh: [F(-10, 1.5), F(-1, 4)], nearShin: [F(8, 7.5), F(15, 2)],
    nearFoot: [F(-22, 1), F(-18.5, 1)],
  },
  skull: F(1, 11), tilt: -24, jaw: 1, pelvis: F(6.5, 3), hips: -70, hilt: F(-12, 10), blade: 76,
};
const kneeling = skeletonOf(kneel);
const hurtBody = skeletonOf(hurt);
const stand = (pose: BonePose, more: Omit<BoneFrame, "body"> = {}): BoneFrame => ({ body: skeletonOf(pose), ...more }); // prettier-ignore
export const BONEWALKER_POSES = {
  idle: stand(idle),
  sway: stand(sway),
  walk0: stand(walk(0)),
  walk1: stand(walk(1)),
  walk2: stand(walk(2)),
  walk3: stand(walk(3)),
  lift: stand(lift),
  windup: stand(windup),
  attack: stand(attack, { slash: true }),
  recover: stand(recover),
  hurt: { body: hurtBody },
  // Rattling: every bone knocked loose a pixel, the jaw agape.
  rattle: { body: { ...shaken(hurtBody, 1), jaw: 3, tilt: -12 } },
  knockdown: { body: tipped(skeletonOf(adjust(hurt, { tilt: -10 })), -62, HIPS, [2, 12]) }, // prettier-ignore
  down: { body: tipped(skeletonOf(adjust(idle, { blade: 70 })), -90, HIPS, [4, 15.5]) }, // prettier-ignore
  getup: { body: kneeling },
  rise0: { body: skeletonOf(RISE[0]!), sunk: 2 },
  rise1: { body: skeletonOf(RISE[1]!), sunk: 2 },
  rise2: { body: skeletonOf(RISE[2]!), sunk: 1 },
  rise3: { body: skeletonOf(RISE[3]!), sunk: 1 },
  rise4: { body: skeletonOf(RISE[4]!), sunk: 1 },
  rise5: { body: skeletonOf(RISE[5]!) },
  // Falling apart: the bones bounce up off the floor in a puff of dust.
  scatter: {
    body: shaken(spread(PILE, 1.25, 1.4), 1.2),
    dim: true,
    dust: true,
  },
  pile: { body: PILE, dim: true },
  // The pile twitching: the skull lifts and turns, the bones shift, the eyes flicker back on.
  twitch: {
    body: { ...shaken(PILE, 0.7), skull: F(0.5, 12.5), tilt: -8, jaw: 2 },
  },
  crumble: { body: spread(PILE, 1.5, 0.5), dim: true },
  reassemble0: { body: mixed(PILE, kneeling, 0.3, 6) },
  reassemble1: { body: mixed(PILE, kneeling, 0.6, 6) },
  reassemble2: { body: mixed(PILE, kneeling, 0.85, 6) },
} satisfies Record<string, BoneFrame>;
export type BonewalkerFrame = keyof typeof BONEWALKER_POSES;

/** The enemy view's anims a bonewalker has: a ravager's but riding, and its rise, bone pile and reassembly. */
export type BonewalkerAnim = Exclude<
  EnemyAnim,
  "stumble" | "flee" | "slam" | "sweep" | "stagger" | "thrust" | "leap" | "plunge" | "ride" // prettier-ignore
>;
type Strip = AnimStrip<BonewalkerFrame>;
const once = (...frames: (readonly [BonewalkerFrame, number])[]): Strip => ({
  frames,
  loop: false,
});
const W = BONE_WALK_STEPS;
const WALK_CYCLE: Strip = {
  frames: [["walk0", W], ["walk1", W], ["walk2", W], ["walk3", W]], // prettier-ignore
  loop: true,
};
const STEPS = BONEWALKER_STEPS;
/** The rise's frames share its steps evenly, the last taking any left over. */
const RISEN = Math.floor(STEPS.rise / RISE.length);
/** The steps a pile lies still before it twitches, the warning that it is about to pull itself together. */
export const PILE_STILL = STEPS.pile - 42;

/**
 * The bonewalker's anims, timed to the engine (`BONEWALKER_STEPS`): the rise spread over every step it climbs out of
 * its grave; the wind-up raising the sword and holding it for a bone bonewalker's (a quicker tier's ends sooner, on
 * the same frame), the slash for exactly the steps the sword is out and the stand after it; the pile falling apart,
 * lying still for `PILE_STILL` steps, then twitching quicker and quicker to the step it pulls itself together; and the
 * reassembly flinging its bones back together onto one knee. Struck, it rattles; at the last it falls apart and the
 * bones crumble. The rest are as long as the engine keeps any enemy in them, as a ravager's are (knockdown 28, down
 * 45, getup 20, dead 60, held 12, thrown 30); the tests play the engine against them.
 */
export const BONEWALKER_ANIMS: Readonly<Record<BonewalkerAnim, Strip>> = {
  idle: { frames: [["idle", 30], ["sway", 30]], loop: true }, // prettier-ignore
  walk: WALK_CYCLE,
  // A wave's bonewalker walking in from the screen's edge, or back in to a locked screen, lurches like a walker.
  enter: WALK_CYCLE,
  windup: once(["lift", 5], ["windup", Math.max(...Object.values(STEPS.windup)) - 5]), // prettier-ignore
  attack: once(["attack", STEPS.attack]),
  recover: once(["recover", STEPS.recover]),
  hurt: once(["hurt", 4], ["rattle", 4], ["hurt", 4], ["rattle", 4], ["hurt", 4]), // prettier-ignore
  knockdown: once(["knockdown", 28]),
  down: once(["down", 45]),
  getup: once(["getup", 20]),
  dead: once(["scatter", 6], ["crumble", 54]),
  held: once(["rattle", 3], ["hurt", 3], ["rattle", 3], ["hurt", 3]),
  thrown: once(["knockdown", 30]),
  rise: once(
    ...RISE.map((_, i) => [`rise${i}` as BonewalkerFrame, i < RISE.length - 1 ? RISEN : STEPS.rise - RISEN * i] as const), // prettier-ignore
  ),
  // prettier-ignore
  pile: once(["scatter", 6], ["pile", PILE_STILL - 6], ["twitch", 5], ["pile", 8], ["twitch", 5], ["pile", 6],
    ["twitch", 5], ["pile", 4], ["twitch", STEPS.pile - PILE_STILL - 33]),
  // prettier-ignore
  reassemble: once(["reassemble0", 8], ["reassemble1", 8], ["reassemble2", 7], ["getup", STEPS.reassemble - 23]),
};

/** How a figure is drawn: the knight's armour and cape, and its sword's blade, width and reach. */
interface Look {
  readonly knight: boolean;
  readonly blade: number;
  readonly width: number;
  readonly reach: number;
}
const WALKER: Look = { knight: false, blade: 13, width: 2.4, reach: BONE_SWORD[0] }; // prettier-ignore
const KNIGHT: Look = { knight: true, blade: 19, width: 3.2, reach: BONE_SWORD[2] }; // prettier-ignore

/** Bone, and the knight's dull steel. */
const [BONE, PLATE] = ["b", "w"];
/** A long bone, `r` thick, knobbed at both ends. */
function long(rig: Rig, [a, b]: Bone, r: number, o: ShapeOptions = {}) {
  const part = { ...o, group: rig.newGroup() };
  rig.capsule(a, b, r, r * 0.8, BONE, part);
  rig.ellipse(a, r * 1.4, r * 1.4, BONE, part);
  rig.ellipse(b, r * 1.25, r * 1.25, BONE, part);
}
/** A bony hand from the wrist: the knuckles and three long fingers spread toward the tips. */
function claw(rig: Rig, [wrist, tips]: Bone, o: ShapeOptions = {}) {
  const part = { ...o, group: rig.newGroup() };
  const angle = lean(wrist, tips) - 90;
  const knuckles = between(wrist, tips, 0.25);
  rig.ellipse(knuckles, 1.5, 1.5, BONE, part);
  for (const fan of [-45, 0, 45]) {
    const tip = turned(knuckles, angle + fan)(3, 0);
    rig.capsule(knuckles, tip, 0.75, 0.6, BONE, part);
  }
}

/** The loincloth's front and back flaps in tatters round the hips, forward and down in the pelvis's axes. */
// prettier-ignore
const RAG: readonly Point[] = [[-3.8, -1.4], [4.2, -1.4], [4.4, 1.5], [4, 7.4], [3, 5.2], [2, 8], [1.2, 2.4],
  [0, 1.2], [-1.2, 4.2], [-2.2, 2], [-3.2, 4.6], [-4.4, 1.2]];
/** The knight's cape hanging from the shoulders behind, in tatters, forward and down in the chest's axes. */
// prettier-ignore
const CAPE: readonly Point[] = [[-1, -5.5], [-4.5, -4.5], [-7, 5], [-8.5, 15], [-9, 23], [-7.4, 20], [-6.4, 24.5],
  [-4.6, 20.5], [-3.4, 23], [-2.2, 17], [-0.5, 8]];
/** Each rib's height down the chest and how far forward it curves. */
const RIBS = [[-2.4, 3.8], [0.1, 3.9], [2.6, 3.4], [5, 2.4]] as const; // prettier-ignore

/** The ribcage round the chest: the spine down its back, the collarbone, four ribs curving down to the breastbone. */
function ribs(rig: Rig, chest: Local) {
  const cage = { group: "ribs" };
  rig.capsule(chest(-2.6, -5.2), chest(-2.2, 5.8), 1.1, 1, BONE, cage);
  rig.capsule(chest(-2.6, -4.8), chest(3.4, -4.6), 0.9, 0.9, BONE, cage);
  for (const [down, front] of RIBS)
    rig.capsule(chest(-2.4, down - 0.6), chest(front, down + 0.9), 0.8, 0.7, BONE, cage); // prettier-ignore
  rig.capsule(chest(3.4, -4.4), chest(3.6, 0.4), 0.8, 0.7, BONE, cage);
}

/** A sword gripped at `hilt` pointing `degrees` clockwise from right: a notched blade on a rusted guard. */
function sword(rig: Rig, hilt: Point, degrees: number, look: Look) {
  const along = turned(hilt, degrees);
  const [iron, grip] = look.knight ? ["i", "l"] : ["l", "i"];
  rig.capsule(along(-3, 0), along(1.8, 0), 0.9, 0.9, grip);
  rig.ellipse(along(-3.4, 0), 1.2, 1.2, iron);
  const steel = look.knight ? "m" : "w";
  rig.blade(along(2.4, 0), along(2.4 + look.blade, 0), look.width, steel, { tip: 3.5 }); // prettier-ignore
  const guard = look.width + 0.6;
  rig.capsule(along(2.2, -guard), along(2.2, guard), 0.9, 0.9, iron);
}

/** The slash's motion arc about the near shoulder, its front on the very column `reach` in front of the feet. */
function slashOf({ bones }: Skeleton, reach: number) {
  const [cx, sy] = bones.nearUpper[0];
  const outer = ANCHOR[0] + reach + 0.9 - cx;
  const center: Point = [cx, Math.floor(sy) + 0.5];
  return { center, inner: outer - 7, outer, from: -120, to: 40 };
}

export function paintBonewalker(frame: BoneFrame, look = WALKER): Sprite {
  const { body } = frame;
  const { bones } = body;
  const rig = new Rig(...SIZE);
  if (frame.slash) rig.smear(slashOf(body, look.reach));
  const spine = lean(...bones.spine);
  const chest = turned(bones.spine[0], spine);
  const hips = turned(body.pelvis, body.hips);
  const head = turned(body.skull, body.tilt);
  const local = (at: Local, shape: readonly Point[]) => shape.map(([f, d]) => at(f, d)); // prettier-ignore
  if (look.knight) rig.poly(local(chest, CAPE), "a", { bevel: 1.5, bias: -0.15 }); // prettier-ignore
  long(rig, bones.farUpper, 1, BACK);
  long(rig, bones.farFore, 0.85, BACK);
  claw(rig, bones.farHand, BACK);
  long(rig, bones.farThigh, 1.25, BACK);
  long(rig, bones.farShin, 1.05, BACK);
  rig.capsule(...bones.farFoot, 1.1, 0.9, BONE, BACK);
  // The spine on down to the pelvis, the ribcage, and the knight's breastplate over it.
  rig.capsule(chest(-2.2, 5), hips(-1, -1.5), 1, 0.9, BONE);
  rig.capsule(hips(-2.4, 0), hips(2.4, 0.3), 1.9, 1.5, BONE, { group: "pelvis" }); // prettier-ignore
  ribs(rig, chest);
  if (look.knight) {
    rig.capsule(chest(0.2, -2), chest(0.8, 1.4), 4.6, 3.8, PLATE);
    rig.capsule(chest(-0.4, 5.6), chest(2, 5.8), 2.2, 2, PLATE);
  }
  long(rig, bones.nearThigh, 1.25);
  long(rig, bones.nearShin, 1.05);
  rig.capsule(...bones.nearFoot, 1.1, 0.9, BONE);
  rig.poly(local(hips, RAG), "a", { bevel: 1.4 });
  rig.capsule(hips(-4.4, -1.2), hips(4.6, -1.2), 1, 1, "l", { edge: "none" });
  // The neck's bones; the skull, its cranium, cheekbone and jaw; and the knight's rusted helm with its brim and crest.
  rig.capsule(head(-0.8, 4), head(-1, 7), 1, 1, BONE, { bias: -0.1 });
  const skull = { group: "skull" };
  rig.ellipse(head(-0.2, -0.8), 3.9, 3.6, BONE, skull);
  rig.capsule(head(1.4, 1.2), head(2.6, 1.5), 2.4, 2.2, BONE, skull);
  const jaw = body.jaw;
  rig.capsule(head(0.6, 3.5 + jaw), head(3.4, 3.3 + jaw), 1.2, 1.1, BONE, { bias: -0.05 }); // prettier-ignore
  if (look.knight) {
    const helm = { group: "helm" };
    rig.ellipse(head(-0.6, -3.2), 4.5, 3, PLATE, helm);
    rig.capsule(head(-4, -1), head(-4.2, 2.6), 1.5, 1.1, PLATE, helm);
    rig.capsule(head(1.5, -6.2), head(-3.5, -5.6), 0.8, 0.8, PLATE, helm);
    rig.capsule(head(-5, -1.3), head(4.6, -1.5), 0.9, 0.9, PLATE, { ...helm, edge: "none" }); // prettier-ignore
  }
  sword(rig, body.hilt, body.blade, look);
  long(rig, bones.nearUpper, 1);
  long(rig, bones.nearFore, 0.85);
  claw(rig, bones.nearHand);
  const pad = turned(offset(bones.nearUpper[0], -0.2, -0.4), spine);
  if (look.knight) rig.capsule(pad(-1.6, 0), pad(1.6, 0), 2.7, 2.3, PLATE);
  const painting = rig.bake();
  const dot = ([x, y]: Point, key: string) =>
    painting.stamp(Math.floor(x), Math.floor(y), [key]);
  // The eye socket, a dark hollow with a glowing point unless it is dim, the nose's hole and the teeth's line.
  for (const [f, d] of [[1.2, -0.4], [2.2, -0.4], [1.2, 0.6]] as const) dot(head(f, d), "k"); // prettier-ignore
  dot(head(2.2, 0.6), frame.dim ? "k" : "J");
  dot(head(3.9, 1.6), "k");
  for (const f of [1.2, 2.2, 3.2]) dot(head(f, 3.2 + jaw / 2), "k");
  // Rust on the blade, and on the knight's helm, breastplate and pauldron.
  const along = turned(body.hilt, body.blade);
  const spots = [0.3, 0.55, 0.8].map((t) => along(2.4 + look.blade * t, (t - 0.5) * look.width)); // prettier-ignore
  if (look.knight) spots.push(head(-1.5, -4), head(1, -4.6), head(-3.6, 0), chest(1.5, -2.5), chest(-1, 1.5), pad(0, -1)); // prettier-ignore
  spots.forEach((spot, i) => dot(spot, i % 2 ? "3" : "8"));
  // Nothing below the floor: what is still in the grave, or a sword's point planted in the earth, is cut off.
  const [w, h] = SIZE;
  painting.stamp(0, ANCHOR[1] + 1, Array<string>(h - ANCHOR[1] - 1).fill(".".repeat(w))); // prettier-ignore
  if (frame.sunk) earth(painting, frame.sunk);
  if (frame.dust) dust(painting);
  return painting.sprite(ANCHOR);
}

/** Earth heaped on the grave's lip either side, and clods flying where the bones break through. */
function earth(painting: Painting, sunk: 1 | 2) {
  const [x, y] = ANCHOR;
  painting.stamp(x - 12, y - 1, ["  969", "9999699"]);
  painting.stamp(x + 5, y - 1, ["    996", "  9699999"]);
  if (sunk === 2)
    painting
      .stamp(x - 8, y - 9, ["9", "", "", " 6"])
      .stamp(x + 6, y - 12, [" 9", "", "9", "", "", "  6"])
      .stamp(x - 4, y - 15, ["9"]);
}
/** Puffs of bone dust over a body falling apart. */
function dust(painting: Painting) {
  const [x, y] = ANCHOR;
  painting
    .stamp(x - 14, y - 10, [" W", "w w"])
    .stamp(x + 9, y - 13, ["w", " W"])
    .stamp(x - 2, y - 17, ["W w"]);
}

/**
 * The tiers on the rags' ramp (the knight's cape too): a bone bonewalker's dusky grave cloth, then the ravagers' rust
 * and violet.
 */
export const BONEWALKER_TIERS = {
  grave: rampSwap("Aa$", "Ii#"),
  rust: rampSwap("Aa$", "Tt%"),
  violet: rampSwap("Aa$", "Qq^"),
};
/** The bonewalker in its rags, and the violet tier's knight, both playing `BONEWALKER_ANIMS`. */
export const BONEWALKER = figure(
  BONEWALKER_POSES,
  (frame) => paintBonewalker(frame),
  BONEWALKER_TIERS,
);
export const BONE_KNIGHT = figure(
  BONEWALKER_POSES,
  (frame) => paintBonewalker(frame, KNIGHT),
  { violet: BONEWALKER_TIERS.violet },
);

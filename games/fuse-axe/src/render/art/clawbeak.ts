import type { MountAnim } from "../../engine/view.js";
import { CLAWBEAK, CLAWBEAK_STEPS } from "../../engine/view-kit.js";
import type { AnimStrip } from "./animate.js";
import {
  BACK,
  bend,
  between,
  figure,
  offset as at,
  turned,
  type Local,
} from "../pixel/kit.js";
import { Rig, type Point, type ShapeOptions } from "../pixel/rig.js";
import type { Sprite } from "../pixel/sprite.js";

/**
 * The clawbeak, the beast a ravager rides: a teal two-legged runner with a long tail held level behind, a big hooked
 * gold beak, a red crest and little clawed arms, saddled in leather over a red blanket with a brass stirrup. It faces
 * right; its anchor is between its feet on the floor, and its saddle point (where its rider's feet anchor goes, the
 * rider's frame seating it astride) is `CLAWBEAK.saddle` over that, a pixel or two lower while its body dips.
 */
export interface ClawbeakLeg {
  readonly hip: Point;
  readonly knee: Point;
  /** The ankle, high behind the foot as a bird's is. */
  readonly hock: Point;
  /** The ball of the foot, its toes reaching forward from it. */
  readonly foot: Point;
}
export interface ClawbeakPose {
  readonly size: Point;
  readonly anchor: Point;
  /** Where the rider's feet anchor sits: `CLAWBEAK.saddle` over the anchor at rest. */
  readonly saddle: Point;
  /** The body's centre, and its pitch in degrees clockwise (positive: chest down). */
  readonly body: Point;
  readonly tilt: number;
  /** The throat under the head, where the neck meets it. */
  readonly neck: Point;
  /** The head's centre and its turn in degrees clockwise (positive: beak down), and how far the beak gapes, 0 to 1. */
  readonly head: Point;
  readonly nod: number;
  readonly gape: number;
  /** The tail's spine from its root at the rump to its tip. */
  readonly tail: readonly Point[];
  /** The little arms' claws, far and near. */
  readonly claws: readonly [far: Point, near: Point];
  readonly far: ClawbeakLeg;
  readonly near: ClawbeakLeg;
  /** The tail's lash: a flat ring of motion round the body at `CLAWBEAK.reach` either side, ending at the tail. */
  readonly ring?: boolean;
  /** Eye wide in fright. */
  readonly panic?: boolean;
}

/** One canvas and one anchor for every frame: room either side for the tail's ring, above for the coiled tail. */
const SIZE: Point = [88, 60];
const ANCHOR: Point = [44, 55];
/** A point `dx` ahead of the feet and `up` above them. */
const F = (dx: number, up: number): Point => [ANCHOR[0] + dx, ANCHOR[1] - up];
/** The thigh's and the shin's lengths, and the foot's height over the floor row so its sole lies on it. */
const THIGH = 8;
const SHIN = 8.5;
const SOLE = 0.5;
/** The tail's girth along its spine, root to tip. */
const TAIL = [6, 4.5, 3.2, 1.9, 0.7] as const;
/** The ring's height over the floor, and the tail's girth at its tip, which the ring's outer edge runs through. */
const RING_UP = 10;

/** A leg from `hip` to a foot at `foot`, the ankle behind it (tucked under a lifted foot) and the knee bent forward. */
function legTo(hip: Point, foot: Point, lifted = false): ClawbeakLeg {
  const hock = at(foot, lifted ? -0.8 : -2.4, -5);
  return { hip, knee: bend(hip, hock, THIGH, SHIN, 1), hock, foot };
}
const planted = (dx: number): Point => F(dx, SOLE);

/** The body, neck, head, tail, arms and hips moved down by `dy` (a breath, a step's dip), the feet where they stand. */
function settle(pose: ClawbeakPose, dy: number): ClawbeakPose {
  const down = (p: Point) => at(p, 0, dy);
  const leg = (l: ClawbeakLeg) => ({
    ...l,
    hip: down(l.hip),
    knee: bend(down(l.hip), l.hock, THIGH, SHIN, 1),
  });
  return {
    ...pose,
    saddle: down(pose.saddle),
    body: down(pose.body),
    neck: down(pose.neck),
    head: down(pose.head),
    tail: pose.tail.map(down),
    claws: [down(pose.claws[0]), down(pose.claws[1])],
    far: leg(pose.far),
    near: leg(pose.near),
  };
}

const HIPS = { far: F(-2, 20), near: F(1, 19.5) } as const;

/** Standing: body level over the feet, neck up in an S, tail held straight out behind. */
const idle: ClawbeakPose = {
  size: SIZE,
  anchor: ANCHOR,
  saddle: F(0, CLAWBEAK.saddle),
  body: F(-1, 22),
  tilt: -3,
  neck: F(17, 34),
  head: F(19.5, 38),
  nod: 0,
  gape: 0,
  tail: [F(-8, 24), F(-15, 25), F(-22, 25), F(-29, 23.5), F(-35, 21)],
  claws: [F(13, 18), F(15, 17.5)],
  far: legTo(HIPS.far, planted(-3)),
  near: legTo(HIPS.near, planted(3)),
};

/** Breathing out: the body a pixel lower, the tail's tip drooping. */
const breathe: ClawbeakPose = {
  ...settle(idle, 1),
  tail: [F(-8, 23), F(-15, 23.5), F(-22, 23), F(-29, 21), F(-34.5, 18)],
};

/** Steps each walk frame holds: a planted foot sweeps back `BEAST_WALK.x` (1.25 px) a step, `STRIDE` px a frame. */
export const CLAWBEAK_WALK_STEPS = 5;
const STRIDE = 1.25 * CLAWBEAK_WALK_STEPS;

/**
 * Frame `i` of the four-frame strut: each foot planted `STRIDE` ahead and swept back under the body to `STRIDE` behind
 * over two frames, then swung forward, lifted, as the other is planted. The body dips as the feet are widest apart and
 * the head bobs forward as a foot passes, as a bird's does; the tail sways against the step.
 */
function strut(i: number): ClawbeakPose {
  const foot = (phase: number, hip: Point, centre: number): ClawbeakLeg => {
    const q = (i / 4 + phase) % 1;
    if (q < 0.5) return legTo(hip, planted(centre + STRIDE * (1 - 4 * q)));
    const lift = 4 * Math.sin((q - 0.5) * 2 * Math.PI);
    return legTo(hip, F(centre + STRIDE * (4 * q - 3), SOLE + lift), lift > 0);
  };
  const passing = i % 2 === 1;
  const sway = passing ? -1 : 1;
  const pose: ClawbeakPose = {
    ...idle,
    neck: at(idle.neck, passing ? 1.5 : 0, 0),
    head: at(idle.head, passing ? 2.5 : 0, 0),
    tail: idle.tail.map((p, j) => at(p, 0, (sway * j) / 3)),
    far: foot(0.5, HIPS.far, -3),
    near: foot(0, HIPS.near, 3),
  };
  return passing ? pose : settle(pose, 1);
}

/** Foraging: the strut's first step with the neck stooped and the beak open at the floor ahead. */
const peck: ClawbeakPose = {
  ...strut(0),
  tilt: 10,
  neck: F(21, 17),
  head: F(24, 10.5),
  nod: 70,
  gape: 0.6,
  tail: [F(-8, 24), F(-15, 27), F(-22, 29), F(-29, 29.5), F(-35, 28.5)],
};

/**
 * Frame `i` of the panicked four-frame run: long bounds, one foot down at a time (landing far ahead, then under the
 * body as the other kicks up behind and swings through high), the body pitched forward and bobbing up over the
 * planted foot, the neck stretched up and the beak open in a squawk, the little arms flailing, the tail streaming out.
 */
function bolt(i: number): ClawbeakPose {
  const reach = [9, 1, -7, 1];
  const lifts = [0, 0, 6, 5];
  const leg = (j: number, hip: Point) => {
    const k = (i + j) % 4;
    return legTo(hip, F(reach[k]!, SOLE + lifts[k]!), lifts[k]! > 0);
  };
  const up = i % 2 === 0 ? 0 : -2;
  const pose: ClawbeakPose = {
    ...idle,
    tilt: 6,
    neck: F(19, 38),
    head: F(21, 43),
    nod: -18,
    gape: 1,
    tail: [F(-8, 25), F(-15, 27), F(-22, 28), F(-29, 29.5), F(-35, 30)],
    claws: i % 2 === 0 ? [F(15, 23), F(17, 24)] : [F(14, 15), F(16, 15)],
    far: leg(2, HIPS.far),
    near: leg(0, HIPS.near),
    panic: true,
  };
  return settle(pose, up);
}

/** The wind-up's first half: crouching, head down, the tail lifting and curling up behind. */
const coil1: ClawbeakPose = {
  ...settle(idle, 1),
  tilt: 6,
  neck: F(19, 31),
  head: F(22, 34),
  nod: 15,
  tail: [F(-8, 24), F(-14, 28), F(-18, 34), F(-18, 40), F(-14, 45)],
  far: legTo(at(HIPS.far, 0, 1), planted(-5)),
  near: legTo(at(HIPS.near, 0, 1), planted(5)),
};
/** Wound up: crouched low and braced wide, snarling, the tail coiled high over the back like a scorpion's. */
const coil2: ClawbeakPose = {
  ...settle(idle, 2),
  tilt: 9,
  neck: F(20, 29),
  head: F(24, 31),
  nod: 22,
  gape: 0.5,
  tail: [F(-8, 23), F(-13, 29), F(-15, 36), F(-11, 43), F(-5, 46)],
  far: legTo(at(HIPS.far, 0, 2), planted(-6)),
  near: legTo(at(HIPS.near, 0, 2), planted(6)),
};
/** The lash: the tail whipped right round the body, out level behind it, and the ring of its sweep. */
const lash: ClawbeakPose = {
  ...settle(idle, 2),
  tilt: 4,
  neck: F(20, 32),
  head: F(24, 35),
  nod: 8,
  gape: 1,
  tail: [F(-8, 21), F(-15, 16), F(-22, 12.5), F(-29, 11), F(-35, RING_UP)],
  far: legTo(at(HIPS.far, 0, 2), planted(-7)),
  near: legTo(at(HIPS.near, 0, 2), planted(5)),
  ring: true,
};
/** After the lash: coming back up, the tail swinging up behind. */
const recover: ClawbeakPose = {
  ...settle(idle, 1),
  tilt: 1,
  tail: [F(-8, 23), F(-15, 21), F(-22, 19), F(-29, 17), F(-35, 16)],
  far: legTo(at(HIPS.far, 0, 1), planted(-5)),
  near: legTo(at(HIPS.near, 0, 1), planted(4)),
};

/**
 * A hero's hop, rising: the beast pushes off its far foot, the near leg drawn up under it, the neck stretched and the
 * tail streaming out behind. (The scene lifts the whole beast by its height in the air; one foot stays on the anchor
 * row, as in every frame.)
 */
const leap: ClawbeakPose = {
  ...idle,
  tilt: -5,
  neck: F(18, 36),
  head: F(21, 40),
  nod: -8,
  tail: [F(-8, 25), F(-15, 27), F(-22, 28), F(-29, 29.5), F(-35, 30)],
  claws: [F(14, 19), F(16, 19)],
  far: legTo(HIPS.far, planted(-5)),
  near: legTo(HIPS.near, F(4, SOLE + 7), true),
};
/** The hop's fall: the near foot reaching down ahead for the floor, the far leg trailing, the tail lifting behind. */
const drop: ClawbeakPose = {
  ...idle,
  tilt: 3,
  neck: F(17, 35),
  head: F(20, 39),
  nod: 5,
  tail: [F(-8, 25), F(-15, 26), F(-22, 26), F(-29, 24.5), F(-35, 22)],
  far: legTo(HIPS.far, F(-1, SOLE + 3), true),
  near: legTo(HIPS.near, planted(6)),
};

export const CLAWBEAK_POSES = {
  idle,
  breathe,
  walk0: strut(0),
  walk1: strut(1),
  walk2: strut(2),
  walk3: strut(3),
  peck,
  run0: bolt(0),
  run1: bolt(1),
  run2: bolt(2),
  run3: bolt(3),
  coil1,
  coil2,
  lash,
  recover,
  leap,
  drop,
};
export type ClawbeakFrame = keyof typeof CLAWBEAK_POSES;

/**
 * The rows each frame's saddle sits below `CLAWBEAK.saddle`, which the scene lowers the rider by. A ridden beast shows
 * only the idle, walk, wind-up and lash frames; the run (its body bobbing up, so a negative dip) and the peck are a
 * riderless beast's, which nobody sits.
 */
export const CLAWBEAK_DIPS = Object.fromEntries(
  Object.entries(CLAWBEAK_POSES).map(([frame, pose]) => [
    frame,
    pose.saddle[1] - (pose.anchor[1] - CLAWBEAK.saddle),
  ]),
) as Readonly<Record<ClawbeakFrame, number>>;

type Frames = readonly (readonly [ClawbeakFrame, number])[];
const loop = (...frames: Frames): AnimStrip<ClawbeakFrame> => ({
  frames,
  loop: true,
});
const W = CLAWBEAK_WALK_STEPS;
const strip = (steps: number) =>
  loop(["walk0", steps], ["walk1", steps], ["walk2", steps], ["walk3", steps]);
/** A clawbeak's anims: every beast's but a drake's breath and the captain's saddle thrust (`DRAKE_ONLY`). */
export type ClawbeakAnim = Exclude<MountAnim, "breathe" | "lance">;
/** The lash shows from the step the tail lands for `LASH_STEPS`, then the beast recovers to the sweep's end. */
export const LASH_STEPS = 6;
const COIL = CLAWBEAK_STEPS.windup / 2;

/**
 * The clawbeak's anims, played by `mountFrame`. The walk keeps a planted foot on the ground at its pace (`walk` and
 * `leave` 1.25 px a step); walking a wave in (0.75 px a step) and wandering (0.5 px) take the strut slower, wandering
 * stooping to peck every other cycle. The sweep winds up from its first step, lashes on the step the tail lands
 * (`CLAWBEAK_STEPS.windup`) and recovers to its end; the panic bolts; a hero's hop leaps and drops.
 */
export const CLAWBEAK_ANIMS: Readonly<
  Record<ClawbeakAnim, AnimStrip<ClawbeakFrame>>
> = {
  idle: loop(["idle", 32], ["breathe", 32]),
  walk: strip(W),
  enter: strip(8),
  leave: strip(W),
  wander: loop(
    ...strip(12).frames,
    ["peck", 12],
    ["walk1", 12],
    ["walk2", 12],
    ["walk3", 12],
  ),
  flee: loop(["run0", 3], ["run1", 3], ["run2", 3], ["run3", 3]),
  // A hero's hop rises for `hopRise` steps, as its jump does, then falls, holding the fall until it lands.
  hop: {
    frames: [
      ["leap", CLAWBEAK_STEPS.hopRise],
      ["drop", 1],
    ],
    loop: false,
  },
  sweep: {
    frames: [
      ["coil1", COIL],
      ["coil2", CLAWBEAK_STEPS.windup - COIL],
      ["lash", LASH_STEPS],
      ["recover", CLAWBEAK_STEPS.sweep - CLAWBEAK_STEPS.windup - LASH_STEPS],
    ],
    loop: false,
  },
};

/** A leg: the drumstick thigh, the shin back to the ankle, the foot forward to its three clawed toes. */
function leg(rig: Rig, l: ClawbeakLeg, o: ShapeOptions) {
  const part = { ...o, group: rig.newGroup() };
  rig.capsule(l.hip, l.knee, 5, 2.8, "y", part);
  rig.capsule(l.knee, l.hock, 2.2, 1.4, "y", part);
  rig.capsule(l.hock, l.foot, 1.4, 1.2, "y", part);
  const toe = (dx: number, dy: number) => {
    rig.capsule(l.foot, at(l.foot, dx, dy), 1.1, 0.7, "y", part);
    rig.ellipse(at(l.foot, dx + 0.9, dy + 0.1), 0.8, 0.7, "b", o);
  };
  toe(3.4, 0.2);
  toe(2.6, -0.6);
  rig.capsule(l.foot, at(l.foot, -1.8, 0.1), 0.9, 0.6, "b", o);
}

/** A little arm from the chest to its claw, the elbow bent down. */
function arm(rig: Rig, shoulder: Point, claw: Point, o: ShapeOptions) {
  const elbow = bend(shoulder, claw, 2.6, 2.8, -1);
  const part = { ...o, group: rig.newGroup() };
  rig.capsule(shoulder, elbow, 1.4, 1.1, "y", part);
  rig.capsule(elbow, claw, 1.1, 0.9, "y", part);
  rig.capsule(claw, at(claw, 1.2, 0.8), 0.7, 0.4, "b", o);
}

/**
 * The lash's ring: an ellipse `CLAWBEAK.reach` either side at `RING_UP` over the floor, its far half a thin trail
 * behind the body from the back round over the top, its near half thickening round the front to the tail, white-hot
 * along its rim.
 */
function ring(rig: Rig, half: "far" | "near") {
  // Round the anchor pixel's centre, its outer edge on the reach (a hair past, so the last column is surely painted).
  const [cx, cy] = at(F(0, RING_UP), 0.5, 0);
  const ry = CLAWBEAK.reach * 0.2;
  const n = 20;
  const glow = { edge: "none" } as const;
  // The far half runs from the back (left) up over the top; the near half from the front round the bottom.
  const angle = (t: number) =>
    half === "far" ? Math.PI * (1 + t) : Math.PI * t;
  const r = (t: number) => (half === "near" ? 0.9 + 1.6 * t : 0.6 + 0.4 * t);
  const p = (t: number, out = 0): Point => [
    cx + (CLAWBEAK.reach + 0.3 - r(t) + out) * Math.cos(angle(t)),
    cy + (ry + out * 0.2) * Math.sin(angle(t)),
  ];
  for (let i = 0; i < n; i++) {
    const [t0, t1] = [i / n, (i + 1) / n];
    rig.capsule(p(t0), p(t1), r(t0), r(t1), half === "near" ? "f" : "~", glow);
    if (half === "near")
      rig.capsule(
        p(t0, r(t0) * 0.6),
        p(t1, r(t1) * 0.6),
        0.3 + 0.5 * t0,
        0.3 + 0.5 * t1,
        t0 > 0.45 ? "Z" : "F",
        glow,
      );
  }
}

/**
 * Outlines as (forward, down) pairs along a part's axes: the blanket over the back and down the flank from the body's
 * centre, the crest's comb of plumes swept back from the brow and the beak's hooked upper half from the head's, and
 * its lower half from the jaw's hinge.
 */
const BLANKET = [-7.5, -7, 6, -7, 6.8, -0.5, 5, 2.5, -5.5, 2.5, -8, -1];
const CREST = [
  2.6, -3, 1.2, -8, -1.4, -6.2, -4.6, -9, -5.8, -6, -10.8, -7.2, -7.6, -2.8,
  -10.8, -1, -4, 0.8,
];
const BEAK = [
  2.2, -3.6, 5.5, -3.6, 8.6, -2.6, 10.8, -0.6, 11.6, 2, 10.6, 3.6, 9.6, 2, 2.2,
  1.8,
];
const JAW = [0, 0, 6.5, 0.2, 7.2, 1.3, 0.8, 2.4];
const outline = (local: Local, pairs: readonly number[]): Point[] =>
  Array.from({ length: pairs.length / 2 }, (_, i) =>
    local(pairs[2 * i]!, pairs[2 * i + 1]!),
  );

export function paintClawbeak(pose: ClawbeakPose): Sprite {
  const rig = new Rig(...pose.size);
  if (pose.ring) ring(rig, "far");
  const torso = turned(pose.body, pose.tilt);
  const head = turned(pose.head, pose.nod);
  leg(rig, pose.far, BACK);
  arm(rig, torso(7, 3), pose.claws[0], BACK);
  // The tail, body and neck are one part, tapering smoothly into one another.
  const body = { group: "body" };
  pose.tail.forEach((p, i) => {
    const next = pose.tail[i + 1];
    if (next) rig.capsule(p, next, TAIL[i]!, TAIL[i + 1]!, "y", body);
  });
  rig.capsule(torso(-7, 0.3), torso(6.5, 0), 6.6, 7.2, "y", body);
  const throat = torso(7.5, -3);
  const bend1 = at(between(throat, pose.neck), -1.5, 0);
  rig.capsule(throat, bend1, 4.6, 3.6, "y", body);
  rig.capsule(bend1, pose.neck, 3.6, 3, "y", body);
  // The saddle: a red blanket, the leather seat with its cantle behind and brass pommel in front, a girth strap.
  rig.poly(outline(torso, BLANKET), "c", { bevel: 1.2 });
  const strap = { edge: "none" } as const;
  rig.capsule(torso(4.2, -4.5), torso(4.5, 6.2), 1.1, 1.1, "l", strap);
  rig.capsule(torso(-5, -7.4), torso(4, -7.4), 1.9, 1.9, "l");
  rig.capsule(torso(-5.6, -7.6), torso(-6.8, -10), 1.6, 1.3, "l");
  rig.capsule(torso(4.6, -8), torso(5.6, -10.2), 1.2, 1.1, "n");
  leg(rig, pose.near, {});
  // The stirrup on its leather, hanging where the rider's boot goes.
  const stirrup = at(pose.saddle, 4, -0.5);
  rig.capsule(torso(1.5, -6), at(stirrup, 0, -1.5), 0.6, 0.6, "l", strap);
  rig.capsule(at(stirrup, -1.3, 0), at(stirrup, 1.3, 0), 0.8, 0.8, "n");
  // The head, its crest of red plumes swept back behind it and the big hooked beak, its lower half dropping as it
  // gapes.
  rig.poly(outline(head, CREST), "c", { bevel: 1.6 });
  rig.ellipse(pose.head, 4.8, 4, "y");
  const jaw = turned(head(2.6, 1.6), pose.nod + 28 * pose.gape);
  rig.poly(outline(jaw, JAW), "n", { bevel: 1, bias: -0.15 });
  rig.poly(outline(head, BEAK), "n", { bevel: 1.4 });
  arm(rig, torso(8, 3.5), pose.claws[1], {});
  if (pose.ring) ring(rig, "near");
  const painting = rig.bake();
  // The eye under the crest, gold with a black pupil, wide and white in fright; the nostril on the beak.
  const dot = ([x, y]: Point, keys: string) =>
    painting.stamp(Math.floor(x), Math.floor(y), [keys]);
  dot(head(0.4, -1.2), pose.panic ? "Bk" : "Dk");
  dot(head(5, -1.4), "8");
  // Dark bands across the tail's top.
  for (const i of [1, 2, 3]) {
    const [x, y] = pose.tail[i]!;
    painting.stamp(Math.floor(x), Math.floor(y - TAIL[i]! + 1), ["&", "&"]);
  }
  return painting.sprite(pose.anchor);
}

export const CLAWBEAK_FIGURE = figure(CLAWBEAK_POSES, paintClawbeak);

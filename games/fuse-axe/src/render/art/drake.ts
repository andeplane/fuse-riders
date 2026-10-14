import type { MountAnim } from "../../engine/view.js";
import { CLAWBEAK, DRAKE_STEPS } from "../../engine/view-kit.js";
import type { AnimStrip } from "./animate.js";
import {
  BACK,
  bend,
  between,
  figure,
  offset as at,
  turned,
} from "../pixel/kit.js";
import { Rig, type Point, type ShapeOptions } from "../pixel/rig.js";
import type { Sprite } from "../pixel/sprite.js";

/**
 * The ember drake, the beast the lancer captain rides: a small orange-red dragon on four legs, a long neck and a horned
 * head, gold belly plates, small bat wings folded up behind the saddle, red spines down its neck and tail, and a black
 * saddle blanket trimmed in gold under the leather seat and brass stirrup. It faces right; its anchor is between its feet
 * on the floor, and its saddle point is the clawbeak's (`CLAWBEAK.saddle` over the anchor, lower as the body dips), so
 * any rider sits it as it sits a clawbeak. Its fire shows in its throat as it inhales; the flame itself is drawn by
 * `drake-fx.ts` from the frame's jaws (`DRAKE_MOUTHS`).
 */
export interface DrakeLeg {
  /** The hip or the shoulder; the knee (bent forward) or the elbow (bent back); the hock or the wrist; the foot. */
  readonly top: Point;
  readonly mid: Point;
  readonly low: Point;
  readonly foot: Point;
}
export interface DrakePose {
  readonly size: Point;
  readonly anchor: Point;
  /** Where the rider's feet anchor sits: `CLAWBEAK.saddle` over the anchor at rest. */
  readonly saddle: Point;
  /** The body's centre and its pitch in degrees clockwise (positive: chest down); how far the chest swells, in px. */
  readonly body: Point;
  readonly tilt: number;
  readonly swell: number;
  /** The neck's spine from the chest (the body's own point) on: three points to the nape. */
  readonly neck: readonly Point[];
  /** The head's centre, its turn in degrees clockwise (positive: snout down), and how far the jaws gape, 0 to 1. */
  readonly head: Point;
  readonly nod: number;
  readonly gape: number;
  readonly tail: readonly Point[];
  /** The near wing's wrist and its two finger tips; the far wing is the same, a little ahead and higher. */
  readonly wing: readonly [wrist: Point, upper: Point, lower: Point];
  readonly legs: Readonly<Record<(typeof LEGS)[number], DrakeLeg>>;
  /** The fire in its throat: none, kindling (the inhale's start) or blazing (drawn in, and pouring out). */
  readonly fire: 0 | 1 | 2;
  /** Eye wide and white in fright. */
  readonly panic?: boolean;
}
const LEGS = ["farHind", "farFore", "nearHind", "nearFore"] as const;

/** One canvas and one anchor for every frame: room behind for the tail, above for the reared head and raised wings. */
const SIZE: Point = [100, 66];
const ANCHOR: Point = [48, 60];
/** A point `dx` ahead of the feet and `up` above them. */
const F = (dx: number, up: number): Point => [ANCHOR[0] + dx, ANCHOR[1] - up];
const SOLE = 0.5;
const planted = (dx: number): Point => F(dx, SOLE);
/** The neck's and the tail's girth along their spines. */
const NECK = [5.2, 4.4, 3.7, 3.3] as const;
const TAIL = [6.4, 5, 3.6, 2.3, 1] as const;
/** A hind leg's two bones and its knee bent forward; a foreleg's, its elbow bent back. */
const HIND = [8, 8.5, 1] as const;
const FORE = [7, 7.5, -1] as const;
const bones = (name: (typeof LEGS)[number]) =>
  name.endsWith("Hind") ? HIND : FORE;

/** A hind leg to a foot at `foot`: the hock high behind it (tucked under a lifted one), the knee bent forward. */
function hind(hip: Point, foot: Point, lifted = false): DrakeLeg {
  const low = at(foot, lifted ? -1 : -2.6, -5);
  return { top: hip, mid: bend(hip, low, ...HIND), low, foot };
}
/** A foreleg to a foot at `foot`: the wrist over it, the elbow bent back. */
function fore(shoulder: Point, foot: Point, lifted = false): DrakeLeg {
  const low = at(foot, lifted ? -1.8 : -0.8, -4);
  return { top: shoulder, mid: bend(shoulder, low, ...FORE), low, foot };
}
const HIPS = { far: F(-9, 20), near: F(-7.5, 19.5) } as const;
const SHOULDERS = { far: F(6, 19), near: F(7.5, 18.5) } as const;
/** Every foot planted: the hind feet either side of `back`, the forefeet either side of `front`. */
const stand = (back: number, front: number) => ({
  farHind: hind(HIPS.far, planted(back - 2)),
  nearHind: hind(HIPS.near, planted(back + 2)),
  farFore: fore(SHOULDERS.far, planted(front - 1.5)),
  nearFore: fore(SHOULDERS.near, planted(front + 1.5)),
});

/** Everything but the feet moved down by `dy` (a breath, a step's dip, a crouch), the legs bent to reach them. */
function settle(pose: DrakePose, dy: number): DrakePose {
  const down = (p: Point) => at(p, 0, dy);
  const legs = Object.fromEntries(
    LEGS.map((name) => {
      const [l, [upper, lower, side]] = [pose.legs[name], bones(name)];
      return [name, { ...l, top: down(l.top), mid: bend(down(l.top), l.low, upper, lower, side) }]; // prettier-ignore
    }),
  ) as DrakePose["legs"];
  const [wrist, upper, lower] = pose.wing;
  return {
    ...pose,
    ...{ saddle: down(pose.saddle), body: down(pose.body), head: down(pose.head) }, // prettier-ignore
    ...{ neck: pose.neck.map(down), tail: pose.tail.map(down), legs },
    wing: [down(wrist), down(upper), down(lower)],
  };
}

/** Standing: the neck up in a curve, the head level, the tail held out behind and the wings folded. */
const idle: DrakePose = {
  ...{ size: SIZE, anchor: ANCHOR, saddle: F(0, CLAWBEAK.saddle) },
  ...{ body: F(-1, 22), tilt: -2, swell: 0, nod: 0, gape: 0, fire: 0 },
  neck: [F(11, 28), F(14, 33.5), F(16.5, 38)],
  head: F(20.5, 41),
  tail: [F(-11, 23), F(-18, 22), F(-25, 19.5), F(-31, 16), F(-36, 12)],
  wing: [F(-13, 41), F(-25, 33), F(-21, 27)],
  legs: stand(-10, 8.5),
};
/** Breathing out: a pixel lower, the tail's tip and the wings drooping. */
const rest: DrakePose = {
  ...settle(idle, 1),
  tail: [F(-11, 22), F(-18, 20.5), F(-25, 17.5), F(-30.5, 13.5), F(-35, 9.5)],
  wing: [F(-13, 39), F(-25, 31), F(-21, 26)],
};

/** Steps each walk frame holds: a planted foot sweeps back `BEAST_WALK.x` (1.25 px) a step, `STRIDE` px a frame. */
export const DRAKE_WALK_STEPS = 5;
const STRIDE = 1.25 * DRAKE_WALK_STEPS;

/**
 * Frame `i` of the four-frame walk, diagonal pairs together (the near forefoot with the far hind one): each foot
 * planted `STRIDE` ahead of its place and swept back under the body to `STRIDE` behind over two frames, then lifted and
 * swung forward as the other pair is planted. The body dips as the feet are widest apart, the head bobs and the tail
 * sways against the step.
 */
function walk(i: number): DrakePose {
  const foot = (phase: number, centre: number, leg: typeof hind, top: Point) => {
    const q = (i / 4 + phase) % 1;
    if (q < 0.5) return leg(top, planted(centre + STRIDE * (1 - 4 * q)));
    const lift = 4 * Math.sin((q - 0.5) * 2 * Math.PI);
    return leg(top, F(centre + STRIDE * (4 * q - 3), SOLE + lift), lift > 0);
  }; // prettier-ignore
  const passing = i % 2 === 1;
  const sway = passing ? -1 : 1;
  const pose: DrakePose = {
    ...idle,
    neck: idle.neck.map((p, j) => at(p, passing ? j / 2 : 0, 0)),
    head: at(idle.head, passing ? 1.5 : 0, passing ? -0.5 : 0),
    tail: idle.tail.map((p, j) => at(p, 0, (sway * j) / 3)),
    wing: [at(idle.wing[0], 0, sway / 2), idle.wing[1], idle.wing[2]],
    legs: {
      farHind: foot(0, -12, hind, HIPS.far),
      nearHind: foot(0.5, -8, hind, HIPS.near),
      farFore: foot(0.5, 7, fore, SHOULDERS.far),
      nearFore: foot(0, 10, fore, SHOULDERS.near),
    },
  };
  return passing ? pose : settle(pose, 1);
}

/**
 * The inhale's first half, the telegraph: rearing back on braced legs, the chest swelling, the neck drawn up and back,
 * the snout lifting and the fire kindling in its throat, the wings half raised.
 */
const inhale1: DrakePose = {
  ...idle,
  ...{ tilt: -5, swell: 1, nod: -22, gape: 0.15, fire: 1 },
  neck: [F(10, 29.5), F(11.5, 35.5), F(12.5, 40.5)],
  head: F(15.5, 44.5),
  tail: [F(-11, 23), F(-17, 21), F(-23, 17.5), F(-28, 13), F(-32, 8.5)],
  wing: [F(-11, 45), F(-25, 39), F(-22, 30)],
  legs: stand(-11, 9.5),
};
/** Drawn in: reared up a pixel higher, the chest full and glowing, the snout high and smoking, the wings raised. */
const inhale2 = settle(
  {
    ...inhale1,
    ...{ tilt: -5.5, swell: 2, nod: -36, gape: 0.3, fire: 2 },
    neck: [F(9.5, 30.5), F(10, 37), F(10, 42.5)],
    head: F(13, 47),
    tail: [F(-11, 23), F(-16, 20), F(-21, 16), F(-25, 11.5), F(-28, 7)],
    wing: [F(-10, 47), F(-25, 43), F(-23, 33)],
  },
  -1,
);
/**
 * The flame pouring out (`blast0`, `blast1` in turn): lunging forward on wide-braced legs, the neck thrust out level,
 * the jaws wide on the flame, the throat blazing, the wings swept back and the tail up for balance; the head, and so
 * the jaws the flame leaves, hold still from one to the other.
 */
const blast0: DrakePose = {
  ...idle,
  ...{ body: F(0, 22), tilt: 4, nod: 10, gape: 1, fire: 2 },
  neck: [F(12, 27), F(16, 28.5), F(19.5, 29)],
  head: F(22, 28),
  tail: [F(-10, 23), F(-17, 24), F(-24, 24), F(-30, 22.5), F(-35, 20)],
  wing: [F(-12, 40), F(-27, 36), F(-25, 29)],
  legs: stand(-12, 11),
};
const blast1: DrakePose = {
  ...blast0,
  tail: [F(-10, 23), F(-17, 23), F(-24, 22), F(-30, 19.5), F(-35, 16.5)],
  wing: [F(-12, 39), F(-27, 34), F(-25, 28)],
};

/** The captain's saddle thrust winding up: the drake crouches on wide legs, head down out of his spear's way, tail up. */
const crouch = settle(
  {
    ...idle,
    ...{ tilt: 5, nod: 18, gape: 0.25 },
    neck: [F(11, 25), F(15, 26), F(18.5, 25.5)],
    head: F(22, 24),
    tail: [F(-10, 23), F(-16, 26), F(-21, 30), F(-25, 34), F(-27, 38)],
    wing: [F(-14, 38), F(-25, 29), F(-21, 25)],
    legs: stand(-12, 11),
  },
  2,
);
/** The thrust: braced under it, the head low and roaring, the tail lashing up, the wings flared. */
const brace = settle(
  {
    ...idle,
    ...{ tilt: 7, nod: 22, gape: 0.7 },
    neck: [F(12, 24), F(16, 24), F(20, 23)],
    head: F(23.5, 21),
    tail: [F(-10, 23), F(-17, 26), F(-23, 29), F(-28, 33), F(-31, 37)],
    wing: [F(-12, 42), F(-28, 37), F(-25, 29)],
    legs: stand(-13, 12),
  },
  1,
);

/**
 * A hero's hop, rising: the drake pushes off its near hind foot, the forelegs drawn up under it, the neck stretched,
 * the wings spread high and the tail streaming; falling, the near forefoot reaches for the floor, the hind legs tucked
 * and the wings up to brake. (The scene lifts the whole beast by its height in the air; one foot stays on the anchor
 * row, as in every frame.)
 */
const leap: DrakePose = {
  ...idle,
  ...{ tilt: -4, nod: -10 },
  neck: [F(12, 30), F(16, 36), F(19, 40.5)],
  head: F(23, 43.5),
  tail: [F(-11, 23), F(-18, 23.5), F(-25, 23), F(-32, 21.5), F(-38, 19)],
  wing: [F(-9, 50), F(-26, 47), F(-25, 37)],
  legs: {
    farHind: hind(HIPS.far, F(-15, 3), true),
    nearHind: hind(HIPS.near, planted(-10)),
    farFore: fore(SHOULDERS.far, F(9, 8), true),
    nearFore: fore(SHOULDERS.near, F(11, 7), true),
  },
};
const drop: DrakePose = {
  ...idle,
  ...{ tilt: 5, nod: 6 },
  neck: [F(11, 28), F(14.5, 33), F(17.5, 37)],
  head: F(21.5, 39.5),
  wing: [F(-10, 51), F(-24, 52), F(-27, 43)],
  legs: {
    farHind: hind(HIPS.far, F(-12, 5), true),
    nearHind: hind(HIPS.near, F(-8, 4), true),
    farFore: fore(SHOULDERS.far, F(8, 3), true),
    nearFore: fore(SHOULDERS.near, planted(12)),
  },
};

/**
 * Frame `i` of the panicked four-frame gallop: two feet down and two up in every frame, each leg in turn reaching far
 * ahead, sweeping back and kicking up behind; the body pitched forward and bobbing, the head high and the jaws open in
 * a shriek, the eye wide, the wings flapping and the tail streaming out.
 */
function run(i: number): DrakePose {
  const [reach, lift] = [[8, 1, -6, 2], [0, 0, 5, 6]] as const; // prettier-ignore
  const leg = (j: number, centre: number, kind: typeof hind, top: Point) => {
    const k = (i + j) % 4;
    return kind(top, F(centre + reach[k]!, SOLE + lift[k]!), lift[k]! > 0);
  };
  const up = i % 2 === 0;
  return settle(
    {
      ...idle,
      ...{ tilt: 6, nod: -15, gape: 1, panic: true },
      neck: [F(12, 29), F(16, 35), F(18.5, 40)],
      head: F(22, 43),
      tail: [F(-11, 24), F(-18, 26), F(-25, 27), F(-32, 27.5), F(-38, 27)],
      wing: up
        ? [F(-8, 50), F(-24, 50), F(-26, 40)]
        : [F(-14, 34), F(-29, 27), F(-23, 22)],
      legs: {
        nearHind: leg(0, -10, hind, HIPS.near),
        farHind: leg(1, -12, hind, HIPS.far),
        nearFore: leg(2, 10, fore, SHOULDERS.near),
        farFore: leg(3, 8, fore, SHOULDERS.far),
      },
    },
    up ? 0 : -1,
  );
}

// prettier-ignore
export const DRAKE_POSES = {
  idle, rest, walk0: walk(0), walk1: walk(1), walk2: walk(2), walk3: walk(3),
  inhale1, inhale2, blast0, blast1, crouch, brace, leap, drop,
  run0: run(0), run1: run(1), run2: run(2), run3: run(3),
};
export type DrakeFrame = keyof typeof DRAKE_POSES;
const each = <T>(of: (pose: DrakePose) => T) =>
  Object.fromEntries(
    Object.entries(DRAKE_POSES).map(([frame, pose]) => [frame, of(pose)]),
  ) as Readonly<Record<DrakeFrame, T>>;

/** The rows each frame's saddle sits below `CLAWBEAK.saddle`, which the scene lowers the rider by (rearing: above). */
export const DRAKE_DIPS = each(
  ({ saddle, anchor }) => saddle[1] - (anchor[1] - CLAWBEAK.saddle),
);
/**
 * Each frame's jaws as (ahead, up) from the anchor in whole pixels, between the tips of the upper and the lower jaw:
 * where `drake-fx.ts` starts the flame.
 */
export const DRAKE_MOUTHS = each(({ head, nod, gape, anchor }): Point => {
  const [x, y] = turned(head, nod)(9, 1.6 + 2.2 * gape);
  return [Math.round(x - anchor[0]), Math.round(anchor[1] - y)];
});

/** A drake's anims: every beast's but a clawbeak's tail sweep. */
export type DrakeAnim = Exclude<MountAnim, "sweep">;
type Frames = readonly (readonly [DrakeFrame, number])[];
const strip = (loop: boolean, ...frames: Frames): AnimStrip<DrakeFrame> => ({
  frames,
  loop,
});
const walking = (steps: number) =>
  strip(true, ["walk0", steps], ["walk1", steps], ["walk2", steps], ["walk3", steps]); // prettier-ignore
/** Steps each flame frame holds, the two taking turns while the flame is out. */
export const BLAST_STEPS = 4;
const FLAMING = DRAKE_STEPS.breathe - DRAKE_STEPS.inhale;
const INHALE1 = DRAKE_STEPS.inhale / 2;

/**
 * The drake's anims, played by `mountFrame`. The walk keeps a planted foot on the ground at its pace (`walk` and
 * `leave` 1.25 px a step; walking in and wandering are slower and slide a little). The breath rears back and swells
 * for exactly the inhale (`DRAKE_STEPS.inhale`) and pours out its flame from the step it is out to the breath's end;
 * the captain's saddle thrust crouches for its wind-up and braces from the step it lands; the panic gallops; a
 * hero's hop leaps for as many steps as its jump rises, then drops.
 */
export const DRAKE_ANIMS: Readonly<Record<DrakeAnim, AnimStrip<DrakeFrame>>> = {
  idle: strip(true, ["idle", 32], ["rest", 32]),
  walk: walking(DRAKE_WALK_STEPS),
  enter: walking(8),
  leave: walking(DRAKE_WALK_STEPS),
  wander: walking(12),
  flee: strip(true, ["run0", 3], ["run1", 3], ["run2", 3], ["run3", 3]),
  hop: strip(false, ["leap", DRAKE_STEPS.hopRise], ["drop", 1]),
  breathe: strip(
    false,
    ["inhale1", INHALE1],
    ["inhale2", DRAKE_STEPS.inhale - INHALE1],
    ...Array.from(
      { length: Math.ceil(FLAMING / BLAST_STEPS) },
      (_, i): readonly [DrakeFrame, number] => [
        i % 2 ? "blast1" : "blast0",
        Math.min(BLAST_STEPS, FLAMING - i * BLAST_STEPS),
      ],
    ),
  ),
  lance: strip(
    false,
    ["crouch", DRAKE_STEPS.lanceWindup],
    ["brace", DRAKE_STEPS.lance - DRAKE_STEPS.lanceWindup],
  ),
};

/** A leg: the haunch or upper arm, the shin to the hock or wrist, the foot forward to bone claws. */
function leg(rig: Rig, l: DrakeLeg, haunch: number, o: ShapeOptions) {
  const part = { ...o, group: rig.newGroup() };
  rig.capsule(l.top, l.mid, haunch, haunch * 0.55, "x", part);
  rig.capsule(l.mid, l.low, 2.7, 2, "x", part);
  rig.capsule(l.low, l.foot, 2, 1.7, "x", part);
  for (const [dx, dy] of [[3.4, 0.2], [2.6, -0.7]] as const) {
    rig.capsule(l.foot, at(l.foot, dx, dy), 1.3, 0.8, "x", part);
    rig.ellipse(at(l.foot, dx + 0.9, dy + 0.1), 0.8, 0.7, "b", o);
  } // prettier-ignore
}

/**
 * A folded bat wing: a bony arm up from the back to the wrist, two fingers fanning down from it, the red membrane
 * between them scalloped along its trailing edge.
 */
function wing(
  rig: Rig,
  [root, rump]: readonly [Point, Point],
  [wrist, upper, lower]: DrakePose["wing"],
  o: ShapeOptions,
) {
  const scallop = between(wrist, between(upper, lower), 0.8);
  rig.poly([root, wrist, upper, scallop, lower, between(lower, rump, 0.6), rump], "c", { ...o, bevel: 1.3 }); // prettier-ignore
  const bone = { ...o, edge: "shade" } as const;
  for (const tip of [upper, lower])
    rig.capsule(wrist, tip, 0.8, 0.4, "x", bone);
  rig.capsule(root, wrist, 1.9, 1.2, "x", o);
  rig.capsule(wrist, at(wrist, 1.4, -1.8), 0.9, 0.3, "b", o);
}

/** A point `t` of the way down a spine, nudged `by` px across it (positive: right of travel, a neck's underside). */
function across(spine: readonly Point[], t: number, by: number): Point {
  const i = Math.min(spine.length - 2, Math.floor(t * (spine.length - 1)));
  const [a, b] = [spine[i]!, spine[i + 1]!];
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const l = Math.hypot(dx, dy);
  return at(between(a, b, t * (spine.length - 1) - i), (-dy / l) * by, (dx / l) * by); // prettier-ignore
}
const girthAt = (girth: readonly number[], t: number) =>
  girth[Math.round(t * (girth.length - 1))]!;

/** A row of red spines along the top of a spine (`side` of travel), `girth` its radius at each point. */
function spines(rig: Rig, spine: readonly Point[], girth: readonly number[], side: 1 | -1) {
  for (let t = 0.2; t < 0.95; t += 0.2) {
    const base = across(spine, t, side * (girthAt(girth, t) - 0.6));
    const tip = across(spine, t - 0.06, side * (girthAt(girth, t) + 2.4));
    rig.capsule(base, tip, 1.1, 0.3, "c");
  }
} // prettier-ignore

/** The saddle blanket over the back from the body's centre, as (forward, down) pairs along the body's axes. */
const BLANKET = [-7.5, -7.6, 6, -7.6, 7, -0.5, 5, 3.4, -5.5, 3.4, -8.4, -1];

export function paintDrake(pose: DrakePose): Sprite {
  const rig = new Rig(...pose.size);
  const torso = turned(pose.body, pose.tilt);
  const head = turned(pose.head, pose.nod);
  const neck = [torso(7.5, -2), ...pose.neck];
  // The far wing peeks out a little ahead of and above the near one, the far legs behind the body in shadow.
  const roots = [torso(-6.5, -5.5), torso(-11, -3)] as const;
  const far = (p: Point) => at(p, 3, -2);
  const [wrist, upper, lower] = pose.wing;
  wing(rig, [far(roots[0]), far(roots[1])], [far(wrist), far(upper), far(lower)], BACK); // prettier-ignore
  leg(rig, pose.legs.farHind, 5.6, BACK);
  leg(rig, pose.legs.farFore, 4, BACK);
  spines(rig, pose.tail, TAIL, 1);
  spines(rig, neck, NECK, -1);
  // The horns swept back from the skull, the far one behind the head.
  const horn = (dx: number, dy: number, o: ShapeOptions) => {
    rig.capsule(head(-1 + dx, -2.4 + dy), head(-6.5 + dx, -4.6 + dy), 1.6, 0.9, "b", o); // prettier-ignore
    rig.capsule(head(-6.5 + dx, -4.6 + dy), head(-9.5 + dx, -3.4 + dy), 0.9, 0.4, "b", o); // prettier-ignore
  };
  horn(1, -0.8, BACK);
  // The tail, body and neck are one part, tapering into one another, the gold belly plates along their undersides.
  const body = { group: "body" };
  const chain = (spine: readonly Point[], girth: readonly number[]) =>
    spine.forEach((p, i) => {
      const next = spine[i + 1];
      if (next) rig.capsule(p, next, girth[i]!, girth[i + 1]!, "x", body);
    });
  chain(pose.tail, TAIL);
  rig.capsule(torso(-9, 0.5), torso(6.5, 0), 7.4, 8 + pose.swell, "x", body);
  chain(neck, NECK);
  rig.capsule(torso(-7, 5.4), torso(6, 5.4 + pose.swell / 2), 2.2, 2.8 + pose.swell / 2, "h", body); // prettier-ignore
  // The throat's plates glow as the fire is drawn into it: embers, then blazing.
  const throat = [0, 0.33, 0.66, 1].map((t) => across(neck, t, girthAt(NECK, t) - 1.7)); // prettier-ignore
  const plates = ["h", "~", "f"][pose.fire]!;
  throat.forEach((p, i) => i && rig.capsule(throat[i - 1]!, p, 2.1, 1.7, plates, body)); // prettier-ignore
  wing(rig, roots, pose.wing, {});
  // The saddle: a black blanket trimmed in gold, the leather seat with its cantle behind and brass pommel in front.
  const outline = (pairs: readonly number[]) =>
    Array.from({ length: pairs.length / 2 }, (_, i) =>
      torso(pairs[2 * i]!, pairs[2 * i + 1]!),
    );
  rig.poly(outline(BLANKET), "i", { bevel: 1.2 });
  const trim = { edge: "none" } as const;
  rig.capsule(torso(-5.5, 3.4), torso(5, 3.4), 0.7, 0.7, "n", trim);
  rig.capsule(torso(4.2, -4.5), torso(4.5, 6.6), 1.1, 1.1, "l", trim);
  rig.capsule(torso(-5, -7.4), torso(4, -7.4), 1.9, 1.9, "l");
  rig.capsule(torso(-5.6, -7.6), torso(-6.8, -10), 1.6, 1.3, "l");
  rig.capsule(torso(4.6, -8), torso(5.6, -10.2), 1.2, 1.1, "n");
  leg(rig, pose.legs.nearHind, 6, {});
  leg(rig, pose.legs.nearFore, 4.2, {});
  // The stirrup on its leather, hanging where the rider's boot goes.
  const stirrup = at(pose.saddle, 4, -0.5);
  rig.capsule(torso(1.5, -6), at(stirrup, 0, -1.5), 0.6, 0.6, "l", trim);
  rig.capsule(at(stirrup, -1.3, 0), at(stirrup, 1.3, 0), 0.8, 0.8, "n");
  // The head: the lower jaw dropping on its hinge as it gapes, the mouth dark (or blazing) behind it, the skull, brow
  // and snout over it, the near horn and a spike at the cheek.
  const jaw = turned(head(-1, 2), pose.nod + 36 * pose.gape);
  if (pose.gape > 0.1)
    rig.poly([head(0, 1.4), head(10, 1.6), jaw(9, -0.4), jaw(0.5, -0.6)], pose.fire > 1 ? "f" : "=", trim); // prettier-ignore
  rig.capsule(jaw(0, 0), jaw(9, 0.3), 2.2, 1.3, "x", { bias: -0.1 });
  const skull = { group: "head" };
  rig.ellipse(pose.head, 5, 4.2, "x", skull);
  rig.capsule(head(2, 0.3), head(10, 0.9), 3.1, 2.2, "x", skull);
  rig.capsule(head(-1, -3.2), head(4, -2.6), 1.5, 1.1, "x", skull);
  horn(0, 0, {});
  rig.capsule(head(-3, 1.6), head(-7.2, 3.2), 1, 0.3, "b");
  const painting = rig.bake();
  const dot = ([x, y]: Point, rows: readonly string[]) =>
    painting.stamp(Math.floor(x), Math.floor(y), rows);
  // The eye under the brow, glowing (white-hot with the fire in it, wide in fright); the nostril; fangs in the jaws.
  dot(head(1, -1.6), [pose.panic ? "Zk" : pose.fire ? "Ff" : "fD"]);
  dot(head(9, -0.6), ["k"]);
  if (pose.gape > 0.3)
    for (const fang of [head(4, 3), head(8, 3), jaw(6, -1.6)]) dot(fang, ["B"]);
  // Its hottest down the throat and in the chest; smoke from the nostrils as the breath is held.
  if (pose.fire) {
    const hot = pose.fire > 1 ? "F" : "f";
    for (const t of [0.2, 0.5, 0.8])
      dot(across(neck, t, girthAt(NECK, t) - 1.8), [hot]);
    dot(torso(6, 3 + pose.swell / 2), pose.fire > 1 ? [" f", "fFf", " f"] : [" ~", "~f~", " ~"]); // prettier-ignore
  }
  if (pose.fire > 1 && pose.gape < 1) dot(head(8, -5.5), [" W", "wW", "w"]);
  return painting.sprite(pose.anchor);
}

export const DRAKE_FIGURE = figure(DRAKE_POSES, paintDrake);

import type { EnemyAnim } from "../../engine/view.js";
import type { AnimStrip } from "./animate.js";
import { turn } from "../pixel/head.js";
import {
  adjust,
  BACK,
  between,
  figure,
  legAt,
  legTo,
  offset as at,
  stride,
  type Pose,
  type Side,
} from "../pixel/kit.js";
import { Rig, type Point, type ShapeOptions } from "../pixel/rig.js";
import type { Sprite } from "../pixel/sprite.js";

/**
 * The sack imp, the pot thief: a small hunched figure in a blue hood with its tip flopping behind, yellow eyes and a
 * long nose peering out, and a big pale sack slung over its back, its neck gripped at the shoulder.
 */
export interface ImpPose extends Pose {
  /** Degrees the head and hood turn, clockwise: positive peers down, -90 lies on its back. */
  readonly tilt: number;
  /** The hood's tip, (forward, down) from the head in the head's frame. */
  readonly tip: Point;
  /** The sack's centre and its radii across and down. */
  readonly sack: Point;
  readonly bulk: Point;
  /** Where the sack's neck ends: the near hand, which grips it, unless the imp has let go. */
  readonly neck?: Point;
  /** The neck yanked open, magic glinting out of it: a pot pops out. */
  readonly spill?: boolean;
  /** Eyes squeezed shut and mouth open. */
  readonly pain?: boolean;
}

/**
 * Every frame shares one canvas and one feet anchor; the room behind is for the sack, and either side for lying flat.
 * About 22 px from the boots to the hood's tip, under half a ravager.
 */
const idle: ImpPose = {
  size: [56, 44],
  anchor: [27, 39],
  head: [33, 22.4],
  tilt: 8,
  tip: [-4.5, -5.5],
  chest: [29, 27.5],
  waist: [27.5, 31],
  far: {
    shoulder: [27, 26.5],
    elbow: [26.5, 30],
    hand: [28.5, 32.5],
    hip: [26, 33],
    knee: [26.5, 35.5],
    ankle: [25.5, 37.8],
  },
  near: {
    shoulder: [29.5, 26.5],
    elbow: [30, 30],
    hand: [32.5, 28.5],
    hip: [29, 33],
    knee: [30, 35.5],
    ankle: [29.5, 37.8],
  },
  sack: [21, 26.5],
  bulk: [6.5, 6.9],
};

/**
 * The upper body and the sack it grips moved by (`dx`, `dy`): a step's bob, the legs left where they stand. (A sack
 * let go, `neck` set, stays where it was put.)
 */
function bob(pose: ImpPose, dx: number, dy: number): ImpPose {
  const arm = ({ shoulder, elbow, hand }: Side) => ({
    shoulder: at(shoulder, dx, dy),
    elbow: at(elbow, dx, dy),
    hand: at(hand, dx, dy),
  });
  return adjust(pose, {
    head: at(pose.head, dx, dy),
    chest: at(pose.chest, dx, dy),
    waist: at(pose.waist, dx, dy / 2),
    far: arm(pose.far),
    near: arm(pose.near),
    sack: at(pose.sack, dx, dy),
  });
}

/**
 * Steps each scurry frame holds, and each flee frame: a planted foot sweeps back the ground the imp covers in them,
 * at the engine's 0.9 px a step for the scurry (`IMP_WALK`, 230/256 px in its sub-pixels) and 1.6 for the flight
 * (`IMP_FLEE`, 410/256), so it keeps pace with the road.
 */
export const IMP_WALK_STEPS = 4;
export const IMP_FLEE_STEPS = 3;
const SCURRY = { reach: (230 / 256) * IMP_WALK_STEPS, lift: 2, dip: 1 };
const FLIGHT = { reach: (410 / 256) * IMP_FLEE_STEPS, lift: 3, dip: 1 };

/** Four frames of `pose`'s gait: the legs laid out by `stride`, the body bobbing a pixel on the planted frames. */
function gait(
  pose: ImpPose,
  steps: { reach: number; lift: number; dip: number },
  each: (low: number, body: ImpPose) => Partial<ImpPose>,
) {
  return [0, 1, 2, 3].map((i) => {
    const legs = stride(pose, i, 4, steps);
    const low = i % 2 === 0 ? steps.dip : 0;
    const body = bob(pose, 0, low);
    const [far, near] = [legs.far!, legs.near!];
    return adjust(body, {
      far: { ...body.far, ...legAt(far.hip!, far.knee!, far.ankle!) },
      near: { ...body.near, ...legAt(near.hip!, near.knee!, near.ankle!) },
      ...each(low, body),
    });
  });
}

/** A four-frame scurry: short quick steps, the hood's tip jogging on the planted frames. */
const walk = gait(idle, SCURRY, (low) => ({
  tip: [-4.5 - low, -5.5 + low],
}));

/** Running off: lower and further forward, the free arm pumping, the sack bouncing up off the back as the feet land. */
const running = adjust(bob(idle, 1.5, 1), {
  tilt: 14,
  waist: [28, 31.5],
  far: {
    shoulder: [28.5, 27.5],
    elbow: [30.5, 31],
    hand: [32.5, 29.5],
  },
  tip: [-6, -3.5],
});
const flee = gait(running, FLIGHT, (low, body) => ({
  sack: at(body.sack, 0, low ? -1.5 : 0.5),
  tip: [-6.5, low ? -2.5 : -4.5],
}));

/** Kicked: jolted back on its heels, arms thrown up, the sack swung up behind it with its neck torn open. */
const stumble1 = adjust(idle, {
  head: [30.5, 22.5],
  tilt: -18,
  chest: [28, 27.5],
  waist: [27.5, 31],
  far: {
    shoulder: [26, 26.5],
    elbow: [24.5, 24],
    hand: [25.5, 21],
  },
  near: {
    shoulder: [29, 26.5],
    elbow: [32.5, 25.5],
    hand: [34.5, 22.5],
    ...legTo(idle.near, [29, 33], [31.5, 37.8]),
  },
  sack: [21, 23],
  neck: [24.5, 16.5],
  spill: true,
  pain: true,
  tip: [-5.5, -3],
});
/** Staggering back on one foot, the near one kicked up, the sack swinging down again. */
const stumble2 = adjust(idle, {
  head: [30, 23.5],
  tilt: -10,
  chest: [27.5, 28],
  waist: [27, 31.5],
  far: {
    shoulder: [25.5, 27],
    elbow: [23.5, 29],
    hand: [22.5, 31.5],
  },
  near: {
    shoulder: [28.5, 27],
    elbow: [31.5, 27.5],
    hand: [33.5, 25.5],
    knee: [31.5, 34],
    ankle: [33, 36],
  },
  sack: [20.5, 25.5],
  neck: [24, 19],
  pain: true,
  tip: [-6, -4],
});

/**
 * The body turned `degrees` clockwise about `pivot` and moved by `move`, hood and all: tipped over backwards
 * (negative degrees), a body in the air or lying on its back. Its sack, let go, lies or flies where `loose` puts it.
 */
function tipped(
  pose: ImpPose,
  degrees: number,
  pivot: Point,
  [mx, my]: Point,
  loose: Pick<ImpPose, "sack" | "neck"> & Partial<Pick<ImpPose, "bulk">>,
): ImpPose {
  const spin = turn(degrees);
  const to = ([x, y]: Point): Point => {
    const [tx, ty] = spin(pivot, x - pivot[0], y - pivot[1]);
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
    ...loose,
  };
}

const HIPS: Point = [27.5, 33];

/** Flung back through the air, arms and legs trailing toward the blow, the sack flying up over it. */
const knockdown = tipped(
  adjust(idle, {
    far: {
      elbow: [30, 29],
      hand: [33, 30],
      knee: [29, 36],
      ankle: [31.5, 38],
    },
    near: {
      elbow: [32.5, 24.5],
      hand: [33.5, 20.5],
      knee: [32, 35],
      ankle: [35, 37],
    },
    pain: true,
    tip: [-6, -2],
  }),
  -55,
  HIPS,
  [0, 4],
  { sack: [31, 20], neck: [26.5, 24] },
);

/** Laid out on its back, arms flung wide, the sack slumped on the ground behind its head. */
const down = tipped(
  adjust(idle, {
    tilt: -5,
    far: {
      elbow: [25, 30],
      hand: [24, 33],
      knee: [28.5, 36],
      ankle: [27, 38.5],
    },
    near: {
      knee: [31.5, 35.5],
      ankle: [30.5, 38.5],
    },
    pain: true,
    tip: [-5.5, -1.5],
  }),
  -90,
  HIPS,
  [-1, 2],
  { sack: [11, 34.5], bulk: [5.6, 4.6], neck: [16, 30] },
);

/** Getting up: on one knee, hunched over, the sack hauled back onto the shoulder. */
const getup = adjust(bob(idle, 0.5, 3), {
  tilt: 16,
  far: {
    knee: [25.5, 38.2],
    ankle: [21.5, 36.5],
  },
  near: {
    knee: [31, 35],
    ankle: [30.5, 37.8],
  },
  tip: [-5, -4],
});

export const IMP_POSES = {
  idle,
  walk1: walk[0]!,
  walk2: walk[1]!,
  walk3: walk[2]!,
  walk4: walk[3]!,
  flee1: flee[0]!,
  flee2: flee[1]!,
  flee3: flee[2]!,
  flee4: flee[3]!,
  stumble1,
  stumble2,
  knockdown,
  down,
  getup,
};
export type ImpFrame = keyof typeof IMP_POSES;

/** The enemy view's anims a sack imp shows (`idle` only stands in for one it has no frames for). */
export type ImpAnim = Extract<
  EnemyAnim,
  "idle" | "walk" | "stumble" | "knockdown" | "down" | "getup" | "flee"
>;

const cycle = (
  frames: readonly ImpFrame[],
  steps: number,
): AnimStrip<ImpFrame> => ({
  frames: frames.map((frame) => [frame, steps] as const),
  loop: true,
});

/**
 * The imp's anims. The stumble, down and getup last as long as the engine keeps the imp in them (`IMP_STUMBLE_STEPS`
 * 16, `IMP_DOWN_STEPS` 24, `GETUP_STEPS` 20), and the knockdown the steps a knocked-up enemy takes to land; the tests
 * play the engine against them.
 */
export const IMP_ANIMS: Readonly<Record<ImpAnim, AnimStrip<ImpFrame>>> = {
  idle: { frames: [["idle", 32]], loop: true },
  walk: cycle(["walk1", "walk2", "walk3", "walk4"], IMP_WALK_STEPS),
  flee: cycle(["flee1", "flee2", "flee3", "flee4"], IMP_FLEE_STEPS),
  stumble: {
    frames: [
      ["stumble1", 8],
      ["stumble2", 8],
    ],
    loop: false,
  },
  knockdown: { frames: [["knockdown", 28]], loop: false },
  down: { frames: [["down", 24]], loop: false },
  getup: { frames: [["getup", 20]], loop: false },
};

/** A limb from `root` through `mid` to `end` in `key`, `r` thick at the root and tapering. */
function limb(
  rig: Rig,
  [root, mid, end]: readonly [Point, Point, Point],
  r: number,
  key: string,
  o: ShapeOptions,
) {
  const upper = { ...o, group: rig.newGroup() };
  rig.capsule(root, mid, r, r * 0.85, key, upper);
  rig.capsule(mid, end, r * 0.85, r * 0.75, key, o);
}

/**
 * A short leg in blue hose and a leather boot, its toe pointing forward square to the leg, so up on a body lying down,
 * but never down through the floor.
 */
function leg(rig: Rig, { hip, knee, ankle }: Side, o: ShapeOptions) {
  limb(rig, [hip, knee, ankle], 1.7, "u", o);
  rig.capsule(between(knee, ankle, 0.45), ankle, 1.5, 1.5, "l", o);
  const [lx, ly] = [ankle[0] - hip[0], ankle[1] - hip[1]];
  const [fx, fy] = [ly, Math.min(-lx, 0)];
  const r = Math.max(Math.hypot(fx, fy), 1e-6);
  const foot = (forward: number, down: number) =>
    at(ankle, (forward * fx - down * fy) / r, (forward * fy + down * fx) / r);
  rig.capsule(foot(-0.3, 0.9), foot(2.4, 0.5), 1.3, 0.8, "l", o);
}

export function paintImp(pose: ImpPose): Sprite {
  const { head: h, chest, waist, far, near } = pose;
  const ht = turn(pose.tilt);
  const rig = new Rig(...pose.size);
  // The sack behind it all, narrowing to its neck: tied and twisted into a rope over the near shoulder, or let go.
  const { sack, bulk } = pose;
  const top = pose.neck ?? at(near.shoulder, -0.6, -2.2);
  const bag = { group: "sack", bias: -0.05 };
  rig.ellipse(sack, bulk[0], bulk[1], "b", bag);
  rig.ellipse(
    between(sack, top, 0.45),
    bulk[0] * 0.6,
    bulk[1] * 0.55,
    "b",
    bag,
  );
  const mouth = between(sack, top, 0.72);
  if (pose.spill) {
    rig.capsule(between(sack, top, 0.5), top, 2.2, 1.9, "b", bag);
    rig.ellipse(top, 1.5, 1.1, "i", { bias: -1, edge: "shade" });
  } else rig.ellipse(mouth, 1.5, 1.2, "l", { edge: "shade" });
  // The far arm and leg in shadow behind the body.
  limb(rig, [far.shoulder, far.elbow, far.hand], 1.5, "u", BACK);
  rig.ellipse(far.hand, 1.2, 1.2, "s", BACK);
  leg(rig, far, BACK);
  // A hunched body in a blue tunic over a leather belt.
  rig.capsule(waist, chest, 3.3, 3.4, "u", { group: "body" });
  const belt = between(far.hip, near.hip);
  const spine = turn(pose.tilt * 0.6);
  rig.capsule(spine(belt, -3.2, -1.6), spine(belt, 3.4, -1.6), 1, 1, "l", {
    edge: "shade",
  });
  leg(rig, near, {});
  if (!pose.neck) {
    const rope = { group: "rope" };
    rig.capsule(mouth, top, 1.2, 1.1, "b", rope);
    rig.capsule(top, near.hand, 1.1, 1, "b", rope);
  }
  // The hood, its tip flopping behind; in the dark of it two yellow eyes and a toothy grin, and a long nose poking out.
  const hood = { group: "hood" };
  rig.capsule(ht(h, -1.5, -2.2), ht(h, ...pose.tip), 1.9, 0.7, "u", hood);
  rig.ellipse(h, 3.9, 3.6, "u", hood);
  rig.ellipse(ht(h, 2.1, 0.9), 2.2, 2.1, "i", { bias: -1, edge: "none" });
  rig.capsule(ht(h, -0.8, -1.8), ht(h, 3.6, -1.6), 1.2, 1, "u", {
    ...hood,
    edge: "none",
  });
  rig.capsule(ht(h, 3.2, 1.4), ht(h, 6.2, 2.3), 1.1, 0.6, "s", {
    bias: 0.15,
    edge: "shade",
  });
  // The near arm, its hand gripping the rope.
  limb(rig, [near.shoulder, near.elbow, near.hand], 1.6, "u", {});
  rig.ellipse(near.hand, 1.3, 1.3, "s", {});
  const painting = rig.bake();
  const dot = (forward: number, down: number, key: string) => {
    const [x, y] = ht(h, forward, down);
    painting.stamp(Math.floor(x), Math.floor(y), [key]);
  };
  // Hurt, its eyes go wide and white and its mouth falls open.
  const [eye, grin] = pose.pain ? ["Z", "c"] : ["D", "Z"];
  dot(1.6, 0.2, eye);
  dot(3.3, 0.2, eye);
  dot(1.6, 2.4, grin);
  dot(2.6, 2.6, grin);
  // Magic glinting out of the torn-open sack.
  if (pose.spill) {
    const [gx, gy] = [Math.floor(top[0]), Math.floor(top[1]) - 3];
    painting.stamp(gx - 1, gy - 1, [" G ", "GZG", " G "]);
    painting.stamp(gx + 2, gy - 3, ["Z"]);
    painting.stamp(gx - 3, gy - 2, ["G"]);
  }
  return painting.sprite(pose.anchor);
}

export const IMP = figure(IMP_POSES, paintImp);

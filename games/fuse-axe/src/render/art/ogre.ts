import type { EnemyAnim, Tier } from "../../engine/view.js";
import { OGRE_STEPS } from "../../engine/view-kit.js";
import type { AnimStrip } from "./animate.js";
import {
  adjust,
  armAt,
  BACK,
  bend,
  between,
  breath,
  figure,
  legAt,
  offset,
  stride,
  type Pose,
  type Side,
} from "../pixel/kit.js";
import { rampSwap, type Palette } from "../pixel/palette.js";
import {
  Rig,
  type Painting,
  type Point,
  type ShapeOptions,
  type Smear,
} from "../pixel/rig.js";
import type { Sprite } from "../pixel/sprite.js";

/**
 * An Ogre twin, Stage 1's boss: half as big again as a ravager, a hunched brute with a pot belly, a bald head with a
 * topknot, tusks jutting from an underbite, an iron pauldron, bracers and a hide kilt, and a huge two-handed war
 * hammer. Its skin is the olive ramp (`Oo2`), which `OGRE_TIERS` recolours per twin; its eyes glint in `D`, which
 * `OGRE_RAGE` turns red once its twin has fallen.
 */
export interface OgrePose extends Pose {
  /** The head's turn in degrees, clockwise: -90 lies on its back. */
  readonly tilt: number;
  /** The hammer's haft, from the near hand toward the head, in degrees clockwise from pointing right. */
  readonly hammer: number;
  /** The far hand lets go of the haft and goes where the pose puts it; otherwise it grips below the near one. */
  readonly loose?: boolean;
  /** The hammer is behind the body (raised over the back). */
  readonly behind?: boolean;
  readonly smear?: Smear;
  /** The sweep's flat ring of motion round the body, this many pixels either side. */
  readonly spin?: number;
  readonly face?: "calm" | "roar" | "pain";
  /** The hammer's head is driven into the floor: what reaches below the feet is cut off, and clods fly. */
  readonly buried?: boolean;
}

/** One canvas and one feet anchor for every frame: room above for the raised hammer, either side for the swings. */
const SIZE: Point = [140, 124];
const ANCHOR: Point = [64, 116];
/** A point `dx` ahead of the feet and `up` above them. */
const F = (dx: number, up: number): Point => [ANCHOR[0] + dx, ANCHOR[1] - up];
/** The arm's and the leg's two bones, the far hand's grip below the near one and the haft from the near hand. */
const ARM = [12.5, 12] as const;
const LEG = [13, 12.5] as const;
const GRIP = 7;
const HAFT = 30;

/** Offsets from `origin` along axes turned `degrees` clockwise: `forward` the way it points, `down` across it. */
type Local = (forward: number, down: number) => Point;
const turned = (origin: Point, degrees: number): Local => {
  const r = (degrees * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  return (forward, down) => [
    origin[0] + forward * c - down * s,
    origin[1] + forward * s + down * c,
  ];
};
/** How far a spine from `top` down to `bottom` leans, in degrees clockwise from upright. */
const lean = (top: Point, bottom: Point) =>
  (Math.atan2(top[0] - bottom[0], bottom[1] - top[1]) * 180) / Math.PI;

interface Limbs {
  readonly shoulder: Point;
  readonly hand?: Point;
  readonly hip: Point;
  readonly ankle: Point;
}
type Spec = Omit<OgrePose, "size" | "anchor" | "far" | "near"> & {
  readonly far: Limbs;
  readonly near: Limbs & { readonly hand: Point };
};

/** A pose from its ends: the elbows and knees bend to reach, and a gripping far hand holds the haft. */
function build(spec: Spec): OgrePose {
  const grip = turned(spec.near.hand, spec.hammer)(-GRIP, 0);
  const side = (l: Limbs, hand: Point): Side => ({
    shoulder: l.shoulder,
    elbow: bend(l.shoulder, hand, ARM[0], ARM[1], -1),
    hand,
    hip: l.hip,
    knee: bend(l.hip, l.ankle, LEG[0], LEG[1], 1),
    ankle: l.ankle,
  });
  return {
    ...spec,
    size: SIZE,
    anchor: ANCHOR,
    far: side(spec.far, spec.loose ? (spec.far.hand ?? grip) : grip),
    near: side(spec.near, spec.near.hand),
  };
}

/** The whole pose turned `degrees` clockwise about `pivot` and moved by `move`: a standing pose tipped over. */
function tipped(
  pose: OgrePose,
  degrees: number,
  pivot: Point,
  [mx, my]: Point,
): OgrePose {
  const turn = turned(pivot, degrees);
  const to = ([x, y]: Point) =>
    offset(turn(x - pivot[0], y - pivot[1]), mx, my);
  const side = (s: Side): Side => ({
    ...armAt(to(s.shoulder), to(s.elbow), to(s.hand)),
    ...legAt(to(s.hip), to(s.knee), to(s.ankle)),
  });
  const [head, chest, waist] = [to(pose.head), to(pose.chest), to(pose.waist)];
  const [tilt, hammer] = [pose.tilt + degrees, pose.hammer + degrees];
  return {
    ...pose,
    head,
    chest,
    waist,
    tilt,
    hammer,
    far: side(pose.far),
    near: side(pose.near),
  };
}

/** The head (and its turn), chest and waist of a pose, in feet coordinates (`F`). */
const torso = (head: Point, tilt: number, chest: Point, waist: Point) => ({
  head,
  tilt,
  chest,
  waist,
});
const LEGS = {
  far: { shoulder: F(-9, 48), hip: F(-6, 27), ankle: F(-11, 4.8) },
  near: { shoulder: F(5, 46), hip: F(6, 27), ankle: F(11, 4.8) },
};
const STAND = torso(F(12, 58), 0, F(-2, 43.5), F(1, 33.5));
/** A pose's far side: where it stands, its shoulder and foot moved to `shoulder` and `ankle` if given. */
const far = (shoulder = LEGS.far.shoulder, ankle = LEGS.far.ankle) => ({
  ...LEGS.far,
  shoulder,
  ankle,
});
/** A pose's near side, its hand at `hand` and its shoulder moved to `shoulder` if given. */
const near = (hand: Point, shoulder = LEGS.near.shoulder) => ({
  ...LEGS.near,
  shoulder,
  hand,
});

/** Standing square, leaning on the hammer planted head-down in front, both hands on top of the haft. */
const idle = build({ ...STAND, far: far(), near: near(F(19, 39)), hammer: 86 });
/** Walking, the hammer carried low across the body, off the floor. */
const carry = build({
  ...STAND,
  far: far(),
  near: near(F(16, 40)),
  hammer: 52,
});
/** The walk's stomp: a planted foot keeps pace with the calm walk, 0.45 px a step, for `OGRE_WALK_STEPS` a frame. */
export const OGRE_WALK_STEPS = 10;
const STOMP = { reach: 4.5, lift: 5, dip: 2 };
const walk = (i: number) => adjust(carry, stride(carry, i, 4, STOMP));
/** Breathing out or panting: the upper body down a pixel, hammer and all. */
const exhale = (pose: OgrePose) => adjust(pose, breath(pose, 1));

/** Raising the hammer: it swings up past the face. */
const lift = build({
  ...torso(F(10, 58.5), -8, F(-3, 44), F(0.5, 33.5)),
  ...{ far: far(), near: near(F(15, 50)), hammer: -78, face: "roar" },
});
/** The telegraph: leaning back with the hammer raised high over and behind the head, roaring. */
const windup = build({
  ...torso(F(8, 59), -14, F(-4, 44.5), F(-0.5, 34)),
  ...{ far: far(F(-12, 48.5)), near: near(F(-4, 72), F(3, 47)) },
  ...{ hammer: -140, behind: true, face: "roar" },
});
/** The slam: hunched over the hammer brought down in front, its head driven into the floor. */
const slamDown = {
  ...torso(F(21, 48), 24, F(6, 38.5), F(3, 29.5)),
  far: { shoulder: F(-4, 43), hip: F(-5, 26), ankle: F(-14, 4.8) },
  near: { ...near(F(27, 21), F(14, 41.5)), hip: F(6, 26), ankle: F(14, 4.8) },
  ...{ hammer: 36, buried: true },
} satisfies Spec;
const slam = build({
  ...slamDown,
  face: "roar",
  smear: { center: F(12, 42), inner: 34, outer: 46, from: -112, to: 38 },
});
/** Standing open after a blow: hunched, panting, the hammer's head dragged on the floor. */
const recover = build({
  ...torso(F(16, 53), 14, F(2, 40.5), F(2, 31)),
  ...{ far: far(F(-9, 45), F(-13, 4.8)), near: near(F(21, 38), F(10, 44)) },
  ...{ hammer: 66, face: "roar" },
});
/** The sweep's wind-up: twisted back, the hammer drawn low behind the far hip. */
const sweepWindup = build({
  ...torso(F(9, 57.5), -4, F(-5, 43), F(-1, 33)),
  ...{ far: far(F(-15, 47), F(-13, 4.8)), near: near(F(-10, 33), F(3, 46.5)) },
  ...{ hammer: 166, face: "roar" },
});
/** The sweep: the hammer swung round at arm's length, a ring of motion either side. */
const sweep = build({
  ...torso(F(14, 57), 4, F(1, 43), F(2, 33)),
  ...{ far: far(F(-8, 47), F(-13, 4.8)), near: near(F(26, 38), F(11, 46)) },
  ...{ hammer: 0, spin: 52, face: "roar" },
});
/** After the sweep: carried on round, the hammer pulled across low behind on the near side. */
const sweepFollow = build({
  ...torso(F(14, 56.5), 8, F(2, 42.5), F(2, 32.5)),
  ...{ far: far(F(-7, 46.5), F(-13, 4.8)), near: near(F(10, 30), F(11, 45.5)) },
  hammer: 152,
});
/** Staggered: reeling back, head thrown back, the hammer in one hand and the other flung out. */
const stagger = build({
  ...torso(F(6, 57), -26, F(-5, 43), F(-1, 33)),
  ...{
    far: { ...far(F(-15, 47)), hand: F(-30, 42) },
    near: near(F(16, 40), F(4, 46.5)),
  },
  ...{ hammer: -42, loose: true, face: "pain" },
});
/** The hips, which the falling poses turn about. */
const HIPS = F(0, 27);
/** Flung back through the air, and laid out on its back, the hammer fallen across its legs. */
const knockdown = tipped(
  build({ ...stagger, far: { ...far(), hand: F(-24, 52) }, hammer: 30 }),
  -55,
  HIPS,
  [2, 1],
);
const down = tipped(
  build({
    ...{ ...stagger, tilt: -4, far: { ...far(), hand: F(-18, 30) } },
    ...{ near: near(F(9, 26)), hammer: 92 },
  }),
  -90,
  HIPS,
  [4, 3],
);
/** Getting up: on one knee, leaning on the hammer planted head-down in front. */
const getup = build({
  ...torso(F(15, 47), 10, F(1, 35), F(1, 25)),
  far: { shoulder: F(-10, 39), hip: F(-4, 17), ankle: F(-22, 4.8) },
  near: {
    shoulder: F(9, 38),
    hip: F(6, 17),
    ankle: F(17, 4.8),
    hand: F(23, 38),
  },
  ...{ hammer: 88, face: "pain" },
});

export const OGRE_POSES = {
  ...{ idle, breathe: exhale(idle) },
  ...{ walk1: walk(0), walk2: walk(1), walk3: walk(2), walk4: walk(3) },
  ...{ lift, windup, slam, quake: build(slamDown) },
  ...{ recover1: recover, recover2: exhale(recover) },
  ...{ sweepWindup, sweep, sweepFollow, stagger, knockdown, down, getup },
};
export type OgreFrame = keyof typeof OGRE_POSES;

/** Where an enraged twin's steam rises in each frame: the top of its skull, from its feet, facing right. */
export const OGRE_CROWNS: Readonly<Record<OgreFrame, Point>> = (() => {
  const crowns = {} as Record<OgreFrame, Point>;
  for (const frame of Object.keys(OGRE_POSES) as OgreFrame[]) {
    const { head, tilt, anchor } = OGRE_POSES[frame];
    const [x, y] = turned(head, tilt)(-1, -6.5);
    crowns[frame] = [Math.round(x - anchor[0]), Math.round(y - anchor[1])];
  }
  return crowns;
})();

/** The anims an ogre is shown in: never reeling, held or thrown, nor in a sack imp's or a lancer's. */
export type OgreAnim = Exclude<
  EnemyAnim,
  | "hurt"
  | "attack"
  | "held"
  | "thrown"
  | "stumble"
  | "flee"
  | "thrust"
  | "leap"
  | "plunge"
  | "ride"
>;

type Frames = (readonly [OgreFrame, number])[];
const once = (...frames: Frames): AnimStrip<OgreFrame> => ({
  frames,
  loop: false,
});
const loop = (...frames: Frames): AnimStrip<OgreFrame> => ({
  frames,
  loop: true,
});
const W = OGRE_WALK_STEPS;
const WALK = loop(["walk1", W], ["walk2", W], ["walk3", W], ["walk4", W]);
/** Steps the hammer swings up before it is held high, the sweep's strike shows, and each pant lasts. */
const LIFT = 8;
const STRIKE = 8;
const PANT = OGRE_STEPS.recover / 4;
const {
  windup: HOLD,
  slam: SLAM,
  sweep: SWEEP,
  sweepWindup: DRAW,
} = OGRE_STEPS;

/**
 * The ogre's anims, timed by the engine's `OGRE_STEPS`: the wind-up lifts, then holds the hammer high for the calm
 * wind-up's steps (an enraged one's, shorter, cuts the hold short); the slam shows the blow on its first step, the step
 * the hammer lands, then stays bent over it; the sweep winds up and shows its ring of motion from the step it lands;
 * it pants while it stands open. The knockdown, down, getup and dead last as long as a ravager's.
 */
export const OGRE_ANIMS: Readonly<Record<OgreAnim, AnimStrip<OgreFrame>>> = {
  idle: loop(["idle", 36], ["breathe", 36]),
  walk: WALK,
  enter: WALK,
  windup: once(["lift", LIFT], ["windup", HOLD - LIFT]),
  slam: once(["slam", 6], ["quake", SLAM - 6]),
  sweep: once(
    ["sweepWindup", DRAW],
    ["sweep", STRIKE],
    ["sweepFollow", SWEEP - DRAW - STRIKE],
  ),
  recover: once(
    ["recover1", PANT],
    ["recover2", PANT],
    ["recover1", PANT],
    ["recover2", PANT],
  ),
  stagger: once(["stagger", OGRE_STEPS.stagger]),
  knockdown: once(["knockdown", 28]),
  down: once(["down", 45]),
  getup: once(["getup", 20]),
  dead: once(["down", 60]),
};
/** An arm's upper half, one part with its shoulder. */
function upperArm(rig: Rig, s: Side, o: ShapeOptions) {
  const part = { ...o, group: rig.newGroup() };
  rig.ellipse(s.shoulder, 6.2, 5.8, "O", part);
  rig.capsule(s.shoulder, s.elbow, 5.4, 4.6, "O", part);
}
/** The forearm with its iron bracer, and the fist. */
function forearm(rig: Rig, s: Side, o: ShapeOptions) {
  rig.capsule(s.elbow, s.hand, 4.8, 4, "O", o);
  rig.capsule(between(s.elbow, s.hand, 0.45), s.hand, 4.4, 4.1, "i", {
    ...o,
    edge: "shade",
  });
  rig.ellipse(s.hand, 4, 3.7, "O", o);
}
/** A thick bowed leg in a hide wrap, and a broad foot. */
function leg(rig: Rig, s: Side, o: ShapeOptions) {
  const thigh = { ...o, group: rig.newGroup() };
  rig.capsule(s.hip, s.knee, 7, 5.6, "O", thigh);
  rig.capsule(s.knee, s.ankle, 5.6, 4.4, "O", o);
  rig.capsule(between(s.knee, s.ankle, 0.5), s.ankle, 5, 4.7, "l", o);
  rig.ellipse(offset(s.ankle, 2, 2.4), 6.4, 3.2, "l", o);
}

/** The war hammer: a long haft, a great iron maul with steel faces and a bronze socket, a bronze cap at its butt. */
function hammer(rig: Rig, { near, hammer }: OgrePose) {
  const at = turned(near.hand, hammer);
  rig.capsule(at(-GRIP - 5, 0), at(HAFT - 3, 0), 2, 2, "l");
  rig.ellipse(at(-GRIP - 5.5, 0), 2.6, 2.6, "n");
  // The maul across the haft's end, 13 deep and 22 long, its faces 3 wide.
  const box = (d: number, a: number, b: number) => [
    at(HAFT - d, a),
    at(HAFT + d, a),
    at(HAFT + d, b),
    at(HAFT - d, b),
  ];
  rig.poly(box(6.5, -10, 10), "i", { bevel: 3 });
  for (const s of [-1, 1])
    rig.poly(box(7.1, 8 * s, 11 * s), "m", { bevel: 1.4 });
  const socket = { edge: "shade" } as const;
  rig.capsule(at(HAFT - 6.9, 0), at(HAFT + 6.9, 0), 2.6, 2.6, "n", socket);
}

/** The sweep's smear: a flat ring at the hammer's height, its far half behind the body or its near half in front. */
function spin(rig: Rig, pose: OgrePose, half: "far" | "near") {
  const rx = pose.spin!;
  const [cx, cy] = [pose.anchor[0] + 2, pose.near.hand[1]];
  const ry = rx * 0.24;
  const n = 18;
  const glow = { edge: "none" } as const;
  const angle = (t: number) =>
    half === "near" ? Math.PI * (1 - t) : -Math.PI * t;
  const p = (t: number, out = 0): Point => [
    cx + rx * Math.cos(angle(t)),
    cy + (ry + out) * Math.sin(angle(t)),
  ];
  // The near half runs from behind round the front to the hammer, thickening; the far half is a thin trail.
  const r = (t: number) => (half === "near" ? 0.8 + 3.4 * t : 1);
  for (let i = 0; i < n; i++) {
    const [t0, t1] = [i / n, (i + 1) / n];
    rig.capsule(p(t0), p(t1), r(t0), r(t1), "f", glow);
    if (half === "near")
      rig.capsule(
        p(t0, r(t0) * 0.7),
        p(t1, r(t1) * 0.7),
        0.4 + t0,
        0.4 + t1,
        t0 > 0.5 ? "Z" : "F",
        glow,
      );
  }
}

/** Face pixels by expression, rows from the brow down, the first column on the head's centre: eye, mouth, a roar. */
const FACES = {
  calm: ["  kD", "", "", "", "   kkk"],
  roar: ["  kD", "", "", "", "  kkkk", "   0kk", "    k"],
  pain: ["  kk", "", "", "", "   kk", "    k"],
} as const;

/** The hide kilt's outline round the hips, forward and down in the body's axes. */
const KILT: readonly Point[] = [
  [-10, -1],
  [11, -1],
  [12, 7],
  [7.5, 5.5],
  [4.5, 10],
  [0.5, 6.5],
  [-3, 10.5],
  [-7, 6.5],
  [-10.5, 8.5],
];

export function paintOgre(pose: OgrePose): Sprite {
  const { chest, waist, far, near } = pose;
  const rig = new Rig(...pose.size);
  if (pose.smear) rig.smear(pose.smear);
  if (pose.spin) spin(rig, pose, "far");
  if (pose.behind) hammer(rig, pose);
  const spine = lean(chest, waist);
  const torso = turned(chest, spine);
  const belly = turned(waist, spine);
  const hips = turned(between(far.hip, near.hip), spine);
  const head = turned(pose.head, pose.tilt);
  upperArm(rig, far, BACK);
  if (pose.loose) forearm(rig, far, BACK);
  leg(rig, far, BACK);
  // Shoulders broad as a yoke, a deep chest and the pot belly hanging under it, a leather strap across them.
  const body = { group: "body" };
  rig.capsule(far.shoulder, near.shoulder, 5.5, 5.5, "O", body);
  rig.ellipse(torso(0.5, 0), 10, 10.5, "O", body);
  rig.ellipse(belly(3, 2), 11, 10, "O", { group: "belly", edge: "shade" });
  const strap = { edge: "none" } as const;
  rig.capsule(torso(6.5, -8), belly(-9, 6), 2, 2, "l", strap);
  leg(rig, near, {});
  // The hide kilt hanging in tatters from a broad iron belt with a bronze buckle.
  rig.poly(
    KILT.map(([f, d]) => hips(f, d)),
    "l",
    { bevel: 2 },
  );
  rig.capsule(hips(-10.5, -1.5), hips(11, -1.5), 2.6, 2.6, "i", strap);
  rig.ellipse(hips(5.5, -1.5), 2.9, 2.6, "n", strap);
  if (!pose.loose) forearm(rig, far, BACK);
  // The head sunk between the shoulders: a topknot, a pointed ear, the skull, a heavy brow, a flat nose and an
  // underbite with tusks.
  const face = { group: "head" };
  rig.capsule(head(-3, -4.5), head(-6.5, -11), 3, 1.8, "i", {
    group: "hair",
    grain: 2,
  });
  rig.ellipse(head(-3.2, -5.2), 2.4, 1.5, "n", { edge: "shade" });
  rig.poly([head(-2.5, -2), head(-9, -5.5), head(-3.5, 2.5)], "O", {
    bias: -0.12,
  });
  rig.ellipse(head(0, 0), 5.8, 6, "O", face);
  rig.capsule(head(0.5, 3.4), head(4.4, 3.6), 4.3, 4.3, "O", face);
  rig.capsule(head(0.5, -2.6), head(6, -2.2), 2, 2, "O", {
    group: "brow",
    edge: "shade",
    bias: 0.12,
  });
  rig.ellipse(head(6.6, 0.4), 1.9, 1.7, "O", face);
  rig.capsule(head(2.2, 5.6), head(2.5, 2.4), 1, 0.5, "B", { bias: -0.25 });
  rig.capsule(head(5.8, 5.8), head(6.8, 1.6), 1.4, 0.6, "B");
  if (!pose.behind) hammer(rig, pose);
  if (!pose.loose) rig.ellipse(far.hand, 3.8, 3.4, "O", BACK);
  upperArm(rig, near, {});
  forearm(rig, near, {});
  // The iron pauldron capping the near shoulder, a steel spike standing back out of it.
  const pad = turned(offset(near.shoulder, -1, -1), spine);
  rig.capsule(pad(-2.5, -2), pad(-7, -5), 1.5, 0.4, "m");
  rig.ellipse(pad(0, 0), 5.8, 4, "i");
  rig.capsule(pad(-5, 2.2), pad(5, 2.2), 1, 1, "n", { edge: "none" });
  if (pose.spin) spin(rig, pose, "near");
  const painting = rig.bake();
  FACES[pose.face ?? "calm"].forEach((row, j) =>
    [...row].forEach((key, i) => {
      const [x, y] = head(i, j - 1);
      if (key !== " ") painting.stamp(Math.floor(x), Math.floor(y), [key]);
    }),
  );
  if (pose.buried) bury(painting, pose);
  return painting.sprite(pose.anchor);
}

/** Everything under the feet is cleared, and clods of earth burst up round the hammer's head. */
function bury(painting: Painting, { anchor, size, near, hammer }: OgrePose) {
  const [ay, [w, h]] = [anchor[1], size];
  painting.stamp(1, ay + 1, Array<string>(h - ay - 1).fill(".".repeat(w - 2)));
  const x = Math.round(turned(near.hand, hammer)(HAFT, 0)[0]);
  painting
    .stamp(x - 13, ay - 1, ["9l9           9l9", "lL9l9       9l9Ll"])
    .stamp(x - 15, ay - 8, ["6", "", "", " 9"])
    .stamp(x + 12, ay - 10, ["6", "", "  9"])
    .stamp(x - 3, ay - 16, ["b"]);
}

const swap = (skin: string, more: Palette = {}): Palette => ({
  ...rampSwap("Oo2", skin),
  ...more,
});
/** A twin's palette by tier: green and red (the twins' tiers 0 and 1), ember beyond, in soot-black hide. */
export const OGRE_TIERS: Readonly<Record<Tier, Palette>> = {
  0: swap("Vv!"),
  1: swap("Cc0"),
  2: swap("Ee4", rampSwap("Ll9", "Ii#")),
};
/** Once its twin has fallen: the same palettes with the eyes burning red. */
export const RAGE_EYE = "#ff3a2e";
export const OGRE_RAGE: Readonly<Record<Tier, Palette>> = {
  0: { ...OGRE_TIERS[0], D: RAGE_EYE },
  1: { ...OGRE_TIERS[1], D: RAGE_EYE },
  2: { ...OGRE_TIERS[2], D: RAGE_EYE },
};

export const OGRE = figure(OGRE_POSES, paintOgre, {
  green: OGRE_TIERS[0],
  red: OGRE_TIERS[1],
  ember: OGRE_TIERS[2],
  "green enraged": OGRE_RAGE[0],
  "red enraged": OGRE_RAGE[1],
});

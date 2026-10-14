import type { EnemyAnim, VorhalAnim } from "../../engine/view.js";
import { VORHAL_STEPS } from "../../engine/view-kit.js";
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
  turned,
  type Local,
  type Pose,
  type Side,
} from "../pixel/kit.js";
import { rampSwap, type Palette } from "../pixel/palette.js";
import {
  Rig,
  type Point,
  type ShapeOptions,
  type Smear,
} from "../pixel/rig.js";
import type { Sprite } from "../pixel/sprite.js";

/**
 * Vorhal, the final boss: a towering dark knight in black-violet plate, a horned great helm whose visor's eyes glow, a
 * red cape and a greatsword as long as a hero is tall. He stands with its point planted before him and both hands on
 * the hilt, drags it at his side walking, draws it back over his shoulder and cuts twice (a slash down, then a rising
 * backhand) with smears reaching `CUT.reach`, plants it to raise a hand of fire, holds it up in a green light to call
 * his bonewalkers, vaults with his cape streaming, roars in a ring of flame, and lies cracked open, embers in his
 * armour, when he falls. Enraged (`VORHAL_RAGE`) his eyes and trims burn red and the embers on his cape's hem glow.
 */
export interface VorhalPose extends Pose {
  /** The head's turn in degrees, clockwise: -90 lies on its back. */
  readonly tilt: number;
  /** The greatsword from the near hand toward its point, in degrees clockwise from pointing right. */
  readonly sword: number;
  /** The far hand lets go of the grip and goes where the pose puts it; otherwise it grips behind the near one. */
  readonly loose?: boolean;
  /** The sword is behind the body (drawn back over his shoulder). */
  readonly behind?: boolean;
  readonly smear?: Smear;
  /** How far the cape's hem streams out behind him, in pixels. */
  readonly cape: number;
  /** The sword's point is in the floor: what reaches below the feet is cut off. */
  readonly planted?: boolean;
  /** Fire in the raised far hand (the cast: `ember` small), green light up the raised blade, the roar's ring of flame. */
  readonly glow?: "ember" | "fire" | "green" | "aura" | "aura2";
  /** Cracks glowing through his armour, and his eyes `dark`: falling for good. */
  readonly cracked?: boolean;
  readonly dark?: boolean;
}

/** One canvas and one feet anchor for every frame: room above for the raised sword, ahead for the cuts' smears. */
const SIZE: Point = [150, 132];
const ANCHOR: Point = [62, 124];
/** A point `dx` ahead of the feet and `up` above them. */
const F = (dx: number, up: number): Point => [ANCHOR[0] + dx, ANCHOR[1] - up];
/** The arm's and leg's bones; the far hand's grip behind the near one, the hilt to the guard and the blade. */
const ARM = [12, 11.5] as const;
const LEG = [14.5, 14] as const;
const GRIP = 5;
const HILT = 4;
const BLADE = 33;

const lean = (top: Point, bottom: Point) =>
  (Math.atan2(top[0] - bottom[0], bottom[1] - top[1]) * 180) / Math.PI;

interface Limbs {
  readonly shoulder: Point;
  readonly hand?: Point;
  readonly hip: Point;
  readonly ankle: Point;
}
type Spec = Omit<VorhalPose, "size" | "anchor" | "far" | "near" | "cape"> & {
  readonly cape?: number;
  readonly far: Limbs;
  readonly near: Limbs & { readonly hand: Point };
};

/** A pose from its ends: the elbows and knees bend to reach, and a gripping far hand holds the hilt. */
function build(spec: Spec): VorhalPose {
  const grip = turned(spec.near.hand, spec.sword)(-GRIP, 0);
  const side = (l: Limbs, hand: Point): Side => ({
    shoulder: l.shoulder,
    elbow: bend(l.shoulder, hand, ARM[0], ARM[1], -1),
    hand,
    hip: l.hip,
    knee: bend(l.hip, l.ankle, LEG[0], LEG[1], 1),
    ankle: l.ankle,
  });
  return {
    cape: 4,
    ...spec,
    size: SIZE,
    anchor: ANCHOR,
    far: side(spec.far, spec.loose ? (spec.far.hand ?? grip) : grip),
    near: side(spec.near, spec.near.hand),
  };
}

/** The whole pose turned `degrees` clockwise about `pivot` and moved by `move`: a standing pose tipped over. */
function tipped(
  pose: VorhalPose,
  degrees: number,
  pivot: Point,
  [mx, my]: Point,
): VorhalPose {
  const turn = turned(pivot, degrees);
  const to = ([x, y]: Point) =>
    offset(turn(x - pivot[0], y - pivot[1]), mx, my);
  const side = (s: Side): Side => ({
    ...armAt(to(s.shoulder), to(s.elbow), to(s.hand)),
    ...legAt(to(s.hip), to(s.knee), to(s.ankle)),
  });
  return {
    ...pose,
    ...{ head: to(pose.head), chest: to(pose.chest), waist: to(pose.waist) },
    ...{ tilt: pose.tilt + degrees, sword: pose.sword + degrees },
    ...{ far: side(pose.far), near: side(pose.near) },
  };
}

/** The head (and its turn), chest and waist of a pose, in feet coordinates (`F`). */
const torso = (head: Point, tilt: number, chest: Point, waist: Point) => ({ head, tilt, chest, waist }); // prettier-ignore
const LEGS = {
  far: { shoulder: F(-7, 51), hip: F(-4, 31), ankle: F(-9, 4.5) },
  near: { shoulder: F(6, 50.5), hip: F(5, 31), ankle: F(10, 4.5) },
};
const STAND = torso(F(3, 60), 0, F(0, 44), F(0.5, 34.5));
/** A pose's far side where it stands, its shoulder and foot moved if given; its near side, its hand at `hand`. */
const far = (shoulder = LEGS.far.shoulder, ankle = LEGS.far.ankle) => ({ ...LEGS.far, shoulder, ankle }); // prettier-ignore
const near = (hand: Point, shoulder = LEGS.near.shoulder) => ({ ...LEGS.near, shoulder, hand }); // prettier-ignore
/** Feet planted wide for a cut, the hips a little lower. */
const WIDE = {
  far: { hip: F(-4, 29.5), ankle: F(-15, 4.5) },
  near: { hip: F(6, 29.5), ankle: F(17, 4.5) },
};
const wide = (shoulder: Point, hand: Point, nearShoulder: Point) => ({
  far: { ...far(shoulder), ...WIDE.far },
  near: { ...near(hand, nearShoulder), ...WIDE.near },
});

/** Standing square, the greatsword's point planted before him, both hands on its hilt. */
const idle = build({
  ...{ ...STAND, far: far(), near: near(F(15, 37)) },
  ...{ sword: 90, planted: true },
});
/** Walking, the greatsword dragged low ahead of him. */
const carry = build({
  ...{ ...STAND, far: far(), near: near(F(13, 34)) },
  ...{ sword: 30, cape: 8 },
});
/** The walk's heavy tread: a planted foot keeps pace with the calm walk, 0.6 px a step, for `VORHAL_WALK_STEPS`. */
export const VORHAL_WALK_STEPS = 8;
const TREAD = { reach: 4.8, lift: 4, dip: 1.5 };
const walk = (i: number) => ({ ...adjust(carry, stride(carry, i, 4, TREAD)), cape: 7 + 3 * (i % 2) }); // prettier-ignore
/** Breathing out: the upper body down a pixel, the cape stirring. */
const exhale = (pose: VorhalPose, cape = pose.cape + 2) => ({ ...adjust(pose, breath(pose, 1)), cape }); // prettier-ignore

/** Drawing the sword back: it rises past his face. */
const lift = build({
  ...torso(F(1, 60.5), -6, F(-1.5, 44), F(0, 34.5)),
  ...{ far: far(F(-8, 50.5)), near: near(F(3, 53), F(4, 50)), sword: -112 },
});
/** The telegraph: leaning back, the greatsword drawn far back over his shoulder in both hands. */
const windup = build({
  ...torso(F(-1, 60), -12, F(-3, 44), F(-0.5, 34.5)),
  ...wide(F(-10, 50), F(-7, 60), F(2, 50.5)),
  ...{ sword: -165, behind: true, cape: 6 },
});
/** Each cut's smear sweeps round his shoulder, its outer rim `CUT.reach` ahead of his feet where it passes level. */
const SWING = { center: F(4, 40), inner: 24, outer: 46 };
/** The first cut: lunging, the greatsword slashed down from over his shoulder to level ahead. */
const cut1 = build({
  ...torso(F(11, 56), 14, F(5, 41.5), F(2, 33)),
  ...wide(F(-3, 47.5), F(15, 33), F(10, 47)),
  ...{ sword: 14, cape: 11, smear: { ...SWING, from: -150, to: 14 } },
});
/** Carried on through: the blade down low ahead, nearly to the floor. */
const follow1 = build({
  ...torso(F(12, 55), 18, F(5.5, 41), F(2, 33)),
  ...wide(F(-2, 47), F(17, 28), F(11, 46.5)),
  ...{ sword: 52, cape: 9 },
});
/** The second cut: the rising backhand, from low ahead to high, that knocks a hero down. */
const cut2 = build({
  ...torso(F(9, 59), -6, F(3, 43.5), F(1.5, 34)),
  ...wide(F(-6, 49.5), F(14, 45), F(8, 49.5)),
  ...{ sword: -36, cape: 12, smear: { ...SWING, from: 60, to: -36 } },
});
/** Carried on up: the greatsword high over him. */
const follow2 = build({
  ...torso(F(6, 60), -10, F(1.5, 44), F(1, 34.5)),
  ...wide(F(-7, 50.5), F(15, 60), F(5, 50.5)),
  ...{ sword: -62, cape: 9 },
});
/** Standing open after the cuts: hunched, panting, the point on the floor ahead. */
const recover = build({
  ...torso(F(9, 56), 12, F(3, 42), F(1.5, 33.5)),
  ...{ far: far(F(-5, 48.5), F(-13, 4.5)), near: near(F(16, 31), F(9, 48)) },
  ...{ sword: 62, planted: true, cape: 3 },
});
/** The cast: the sword planted, his far hand rising with an ember in it, then raised high and burning. */
const plant = build({
  ...STAND,
  far: { ...far(F(-6, 51.5)), hand: F(-12, 60) },
  near: near(F(15, 37)),
  ...{ sword: 90, planted: true, loose: true, glow: "ember" },
});
const cast = build({
  ...torso(F(2, 60.5), -8, F(-1, 44.5), F(0, 34.5)),
  far: { ...far(F(-5, 52)), hand: F(3, 76) },
  near: near(F(15, 37)),
  ...{ sword: 90, planted: true, loose: true, glow: "fire", cape: 6 },
});
/** The summons: the greatsword lifted, then held straight up over his helm in a green light. */
const raise = build({
  ...torso(F(2, 60.5), -4, F(-0.5, 44.5), F(0, 34.5)),
  ...{ far: far(F(-6, 51)), near: near(F(9, 55), F(5, 51)), sword: -70 },
});
const summon = build({
  ...torso(F(1, 61), -14, F(-1, 45), F(0, 35)),
  ...{ far: far(F(-6, 52)), near: near(F(4, 69), F(5, 52)), sword: -90 },
  ...{ glow: "green", cape: 7 },
});
/** The leap: vaulting up, a knee drawn up and the sword back; then dropping, legs down, the sword raised to land. */
const vault = build({
  ...torso(F(5, 58), 10, F(1, 42.5), F(0, 32.5)),
  far: { ...far(F(-7, 49)), hip: F(-4, 29), ankle: F(-12, 4.5) },
  near: { ...near(F(-4, 54), F(5, 49)), hip: F(4, 29), ankle: F(12, 16) },
  ...{ sword: -150, behind: true, cape: 16 },
});
const descend = build({
  ...torso(F(3, 61), -4, F(0, 45), F(0, 35)),
  far: { ...far(F(-7, 51.5)), hip: F(-4, 31.5), ankle: F(-8, 4.5) },
  near: { ...near(F(10, 64), F(5, 51.5)), hip: F(4, 31.5), ankle: F(8, 7) },
  ...{ sword: -60, cape: 13 },
});
/** The roar: head thrown back, arms flung wide, the greatsword out low in one hand, in a ring of flame. */
const roar = build({
  ...torso(F(0, 60), -34, F(-2, 45), F(0, 34.5)),
  ...wide(F(-9, 51), F(20, 42), F(7, 50.5)),
  far: { ...far(F(-9, 51)), ...WIDE.far, hand: F(-22, 56) },
  ...{ sword: 55, loose: true, glow: "aura", cape: 10 },
});
/** Staggered: rocked back on his heels, the sword's point up, the far hand flung out. */
const stagger = build({
  ...torso(F(-1, 59), -22, F(-4, 43.5), F(-1, 34)),
  far: { ...far(F(-11, 49.5), F(-14, 4.5)), hand: F(-24, 44) },
  near: near(F(9, 40), F(3, 49.5)),
  ...{ sword: -24, loose: true, cape: 2 },
});
/** The hips, which the falling poses turn about. */
const HIPS = F(0, 31);
/** Flung back through the air, and laid out on his back, the sword fallen beside him. */
const flung = build({ ...stagger, far: { ...far(), hand: F(-20, 52) }, sword: 10 }); // prettier-ignore
const knockdown = tipped(flung, -55, HIPS, [2, 4]);
const lying = build({
  ...{ ...stagger, tilt: -4, far: { ...far(), hand: F(-16, 30) } },
  ...{ near: near(F(-3, 36), F(5, 50.5)), sword: 92, cape: 0 },
});
const down = tipped(lying, -90, HIPS, [6, 13]);
/** Getting up: on one knee, leaning on the sword planted before him. */
const getup = build({
  ...torso(F(10, 48), 10, F(2, 33), F(1, 23)),
  far: { shoulder: F(-6, 39), hip: F(-4, 18), ankle: F(-22, 4.5) },
  near: { shoulder: F(9, 38), hip: F(5, 18), ankle: F(16, 4.5), hand: F(19, 33) }, // prettier-ignore
  ...{ sword: 90, planted: true, cape: 0 },
});

export const VORHAL_POSES = {
  ...{ idle, breathe: exhale(idle) },
  ...{ walk1: walk(0), walk2: walk(1), walk3: walk(2), walk4: walk(3) },
  ...{ lift, windup, cut1, follow1, cut2, follow2 },
  ...{ recover1: recover, recover2: exhale(recover, 3) },
  ...{ plant, cast, raise, summon, vault, descend },
  ...{ roar1: roar, roar2: { ...exhale(roar, 12), glow: "aura2" as const } },
  ...{ stagger, knockdown, down, getup },
  ...{ dying: { ...down, cracked: true }, dead: { ...down, cracked: true, dark: true } }, // prettier-ignore
};
export type VorhalFrame = keyof typeof VORHAL_POSES;

/** The anims Vorhal is shown in (`VORHAL_STATES`): an ogre's stands, walks and falls, and his own moves. */
export type VorhalArtAnim =
  | Extract<EnemyAnim, "idle" | "walk" | "enter" | "windup" | "recover" | "stagger" | "leap" | "knockdown" | "down" | "getup" | "dead"> // prettier-ignore
  | VorhalAnim;

type Frames = (readonly [VorhalFrame, number])[];
const once = (...frames: Frames): AnimStrip<VorhalFrame> => ({ frames, loop: false }); // prettier-ignore
const loop = (...frames: Frames): AnimStrip<VorhalFrame> => ({ frames, loop: true }); // prettier-ignore
const W = VORHAL_WALK_STEPS;
const WALK = loop(["walk1", W], ["walk2", W], ["walk3", W], ["walk4", W]);
/** Steps the sword rises before it is drawn back, each cut's strike shows, each pant and each breath of the roar. */
const LIFT = 10;
const STRIKE = 6;
const PANT = VORHAL_STEPS.recover / 4;
const BELLOW = VORHAL_STEPS.roar / 6;
const S = VORHAL_STEPS;

/**
 * Vorhal's anims, timed by the engine's `VORHAL_STEPS`: the wind-up lifts the sword, then holds it back for the calm
 * wind-up's steps (an enraged one's, shorter, cuts the hold short); each cut shows its strike from its first step, the
 * step it lands, then carries on through; the cast plants the sword and raises his hand, burning from the step it
 * marks the sigils; the summons raise the sword, lit green from the step the bonewalkers rise; the leap vaults until
 * its apex, then drops; the roar heaves for as long as it lasts. He falls cracked open, his eyes going dark.
 */
export const VORHAL_ANIMS: Readonly<
  Record<VorhalArtAnim, AnimStrip<VorhalFrame>>
> = {
  idle: loop(["idle", 40], ["breathe", 40]),
  walk: WALK,
  enter: WALK,
  windup: once(["lift", LIFT], ["windup", S.windup - LIFT]),
  cut1: once(["cut1", STRIKE], ["follow1", S.cut1 - STRIKE]),
  cut2: once(["cut2", STRIKE], ["follow2", S.cut2 - STRIKE]),
  recover: once(...([1, 2, 1, 2] as const).map((i) => [`recover${i}`, PANT] as const)), // prettier-ignore
  cast: once(["plant", S.castMark], ["cast", S.cast - S.castMark]),
  summon: once(["raise", S.summonAt], ["summon", S.summon - S.summonAt]),
  leap: once(["vault", S.leapApex + 1], ["descend", S.leap - S.leapApex - 1]),
  roar: once(...([1, 2, 1, 2, 1, 2] as const).map((i) => [`roar${i}`, BELLOW] as const)), // prettier-ignore
  stagger: once(["stagger", S.stagger]),
  knockdown: once(["knockdown", 28]),
  down: once(["down", 45]),
  getup: once(["getup", 20]),
  dead: once(["dying", 12], ["dead", 48]),
};

/** Trims and glows draw no edge on what they cover. */
const FLAT: ShapeOptions = { edge: "none" };

/** An arm's upper half, one part with its shoulder, in mail under plate. */
function upperArm(rig: Rig, s: Side, o: ShapeOptions) {
  const part = { ...o, group: rig.newGroup() };
  rig.ellipse(s.shoulder, 4.6, 4.4, "i", part);
  rig.capsule(s.shoulder, s.elbow, 4, 3.4, "i", part);
}
/** The vambrace, its couter at the elbow, and the gauntlet. */
function forearm(rig: Rig, s: Side, o: ShapeOptions) {
  rig.capsule(s.elbow, s.hand, 3.6, 3, "i", o);
  rig.ellipse(s.elbow, 1.8, 1.8, "q", { ...o, edge: "shade" });
  rig.ellipse(s.hand, 3, 2.8, "i", o);
}
/** A plated leg: cuisse, a violet poleyn at the knee, the greave and a long sabaton. */
function leg(rig: Rig, s: Side, o: ShapeOptions) {
  const thigh = { ...o, group: rig.newGroup() };
  rig.capsule(s.hip, s.knee, 5.2, 4.2, "i", thigh);
  rig.capsule(s.knee, s.ankle, 4, 3.3, "i", o);
  rig.ellipse(s.knee, 2.2, 2, "q", { ...o, edge: "shade" });
  rig.ellipse(offset(s.ankle, 2.4, 2.9), 5.4, 2.6, "i", o);
}

/** The greatsword: a long two-tone blade, a broad gold crossguard set with a red stone, a bound grip and pommel. */
function greatsword(rig: Rig, { near, sword, glow }: VorhalPose) {
  const at = turned(near.hand, sword);
  if (glow === "green")
    rig.capsule(at(HILT, 0), at(HILT + BLADE + 2, 0), 3, 1.6, "J", FLAT);
  rig.capsule(at(-GRIP - 2.5, 0), at(HILT, 0), 1.3, 1.3, "l");
  rig.ellipse(at(-GRIP - 3.2, 0), 2, 2, "n");
  rig.blade(at(HILT + 0.5, 0), at(HILT + BLADE, 0), 4.4, "m", { tip: 6 });
  rig.capsule(at(HILT, -5.5), at(HILT, 5.5), 1.4, 1.4, "n");
  rig.ellipse(at(HILT, 0), 1.3, 1.3, "c", { edge: "none" });
}

/** The cape from his shoulders down his back to a ragged hem near the floor, streaming `cape` behind. */
function capeOf(rig: Rig, torso: Local, sway: number) {
  const hem: Point[] = [
    torso(-10 - sway, 36),
    torso(-7 - 0.75 * sway, 33.5),
    torso(-4 - 0.5 * sway, 37.5),
    torso(-1 - 0.25 * sway, 34.5),
    torso(2, 37),
  ];
  rig.poly(
    [
      torso(2, -8),
      torso(-6.5, -8.5),
      torso(-9.5 - 0.15 * sway, 4),
      torso(-11 - 0.5 * sway, 20),
      ...hem,
      torso(4, 18),
    ],
    "c",
    { bevel: 2.5, bias: -0.1 },
  );
  return hem;
}

/** The horned great helm on its gorget: bone horns sweeping out and up, a violet crest, the visor's slit. */
function horn(rig: Rig, head: Local, side: 1 | -1, o: ShapeOptions) {
  const path: Point[] =
    side > 0
      ? [head(1.5, -4), head(5.5, -7), head(7, -11), head(5.5, -14.5)]
      : [head(-3, -4), head(-7.5, -6.5), head(-9.5, -10.5), head(-9, -14)];
  const r = [2.3, 1.9, 1.3, 0.5];
  const part = { ...o, group: rig.newGroup() };
  for (let i = 0; i < 3; i++)
    rig.capsule(path[i]!, path[i + 1]!, r[i]!, r[i + 1]!, "B", part);
}

/** A pauldron capping a shoulder in two lames edged violet, a steel spike standing up out of it. */
function pauldron(rig: Rig, shoulder: Point, spine: number, o: ShapeOptions) {
  const pad = turned(offset(shoulder, -0.5, 0), spine);
  rig.capsule(pad(-3, -2), pad(-5.5, -7.5), 1.6, 0.4, "m", o);
  rig.ellipse(pad(0, 0), 7.4, 4.8, "i", o);
  rig.capsule(pad(-6.5, 3.2), pad(6.5, 3.2), 1.1, 1.1, "q", { ...o, ...FLAT });
  rig.ellipse(pad(0.5, 4.4), 6, 2.6, "i", { ...o, edge: "shade" });
}

/** Flame tongues licking out round his body, behind it: the roar's aura, its licks shifted on its second breath. */
function aura(rig: Rig, second: boolean) {
  const [cx, cy] = F(0, 38);
  for (let i = 0; i < 14; i++) {
    const a = ((i + (second ? 0.5 : 0)) / 14) * 2 * Math.PI;
    const long = (i % 3 === 0 ? 1.18 : 1.05) + (second ? 0.06 : 0);
    const p = (k: number): Point => [
      cx + Math.cos(a) * 21 * k,
      cy + Math.sin(a) * 38 * k - (k > 0.9 ? 9 : 0),
    ];
    rig.capsule(p(0.62), p(long), 4, 0.6, "~", FLAT);
    rig.capsule(p(0.62), p(long - 0.12), 2.2, 0.5, "f", FLAT);
  }
}

/** The fire in his raised hand: a small ember while it rises, a ball of flame with a tongue up from it once raised. */
function fire(rig: Rig, hand: Point, big: boolean) {
  const k = big ? 1 : 0.5;
  rig.capsule(hand, offset(hand, 0, -10 * k), 4.6 * k, 0.6, "~", FLAT);
  rig.ellipse(hand, 4.6 * k, 4.2 * k, "~", FLAT);
  rig.ellipse(offset(hand, 0, -0.5), 3 * k, 2.8 * k, "f", FLAT);
  rig.ellipse(offset(hand, 0, -0.5), 1.4 * k, 1.4 * k, "F", FLAT);
}

/** Green light rising round him from the floor for the summons. */
function rising(rig: Rig) {
  const motes = [[-20, 2, 12], [-16, 20, 28], [-10, 44, 49], [17, 3, 16], [22, 24, 33], [14, 52, 56]] as const; // prettier-ignore
  for (const [x, from, to] of motes)
    rig.capsule(F(x, from), F(x, to), 0.9, 0.4, "J", FLAT);
}

export function paintVorhal(pose: VorhalPose): Sprite {
  const { chest, waist, far, near } = pose;
  const rig = new Rig(...pose.size);
  if (pose.glow === "aura" || pose.glow === "aura2")
    aura(rig, pose.glow === "aura2");
  if (pose.glow === "green") rising(rig);
  if (pose.smear) rig.smear(pose.smear);
  const spine = lean(chest, waist);
  const torso = turned(chest, spine);
  const hips = turned(between(far.hip, near.hip), spine);
  const head = turned(pose.head, pose.tilt);
  const hem = capeOf(rig, torso, pose.cape);
  horn(rig, head, -1, BACK);
  if (pose.behind) greatsword(rig, pose);
  upperArm(rig, far, BACK);
  pauldron(rig, far.shoulder, spine, BACK);
  if (pose.loose) forearm(rig, far, BACK);
  leg(rig, far, BACK);
  // A broad yoke of shoulders and a deep breastplate over a narrower plated belly, a violet band across the chest;
  // the faulds hang from a gold belt.
  const body = { group: "body" };
  rig.capsule(far.shoulder, near.shoulder, 5, 5, "i", body);
  rig.ellipse(torso(1, -1), 10, 9.5, "i", body);
  rig.ellipse(torso(0.5, 9), 7, 5, "i", { group: "belly", edge: "shade" });
  rig.capsule(torso(-7, 3.5), torso(9, 2), 1.1, 1.1, "q", FLAT);
  rig.poly(
    FAULDS.map(([f, d]) => hips(f, d)),
    "i",
    { bevel: 2 },
  );
  rig.capsule(hips(-9.5, -2.5), hips(10, -2.5), 2, 2, "n", FLAT);
  rig.ellipse(hips(4.5, -2.5), 2.2, 2, "c", FLAT);
  leg(rig, near, {});
  if (!pose.loose) forearm(rig, far, BACK);
  // The gorget, the helm and its crest.
  rig.capsule(head(-0.5, 4.5), torso(1, -7), 3.6, 4, "i");
  const helm = { group: "helm", bias: 0.1 };
  rig.ellipse(head(0, -0.5), 5.8, 6.6, "i", helm);
  rig.capsule(head(1.5, 2.5), head(5.8, 3.2), 3.2, 2.6, "i", helm);
  rig.capsule(head(-5, -2), head(1, -6.4), 1.3, 1.1, "q", FLAT);
  horn(rig, head, 1, {});
  if (!pose.behind) greatsword(rig, pose);
  if (!pose.loose) rig.ellipse(far.hand, 3, 2.8, "i", BACK);
  upperArm(rig, near, {});
  forearm(rig, near, {});
  pauldron(rig, near.shoulder, spine, {});
  if (pose.cracked)
    for (const [a, b, c, d] of CRACKS)
      rig.capsule(torso(a, b), torso(c, d), 0.55, 0.55, "~", FLAT);
  if (pose.glow === "ember" || pose.glow === "fire")
    fire(rig, far.hand, pose.glow === "fire");
  const painting = rig.bake();
  // The visor's slit and its eyes, and embers caught in the cape's hem.
  [..."kPPkP"].forEach((key, i) => {
    const [x, y] = head(1.5 + i, 0.5);
    painting.stamp(Math.floor(x), Math.floor(y), [pose.dark ? "k" : key]);
  });
  for (const [x, y] of hem.slice(0, 4))
    painting.stamp(Math.floor(x) + 1, Math.floor(y) - 2, ["="]);
  if (pose.planted || pose.glow === "aura" || pose.glow === "aura2") {
    const [ay, [w, h]] = [pose.anchor[1], pose.size];
    painting.stamp(1, ay + 1, Array<string>(h - ay - 1).fill(".".repeat(w - 2))); // prettier-ignore
  }
  return painting.sprite(pose.anchor);
}

/** The faulds' outline round the hips, forward and down in the body's axes. */
const FAULDS = [[-9, -3], [9.5, -3], [10.5, 8], [6, 6.5], [2.5, 10], [-2, 7], [-6, 10], [-10, 7.5]] as const; // prettier-ignore
/** The cracks his armour splits along as he falls for good, in the breastplate's axes. */
const CRACKS = [[-2, -7, 1, -2], [1, -2, -1, 3], [-1, 3, 3, 8], [1, -2, 6, -4]] as const; // prettier-ignore

/** Enraged: his eyes, his armour's trims and the embers on his cape burn red. */
export const VORHAL_RAGE: Palette = {
  P: "#ff3a2e",
  ...{ i: "#5a2c5e", "#": "#360c26" },
  "=": "#ffb040",
  ...rampSwap("Qq^", "Cc0"),
};

export const VORHAL = figure(VORHAL_POSES, paintVorhal, {
  enraged: VORHAL_RAGE,
});

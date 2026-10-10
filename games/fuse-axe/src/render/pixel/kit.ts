import type { Palette } from "./palette.js";
import type { Point, Rig, ShapeOptions } from "./rig.js";
import type { Sprite } from "./sprite.js";

/**
 * Body parts on top of the rig, and the pose a figure is painted from. A pose is joint positions on the frame's
 * canvas, so a new animation frame is the same figure with its joints moved.
 */
export interface Side {
  readonly shoulder: Point;
  readonly elbow: Point;
  readonly hand: Point;
  readonly hip: Point;
  readonly knee: Point;
  readonly ankle: Point;
}

export interface Pose {
  /** The canvas the pose is painted on, with a pixel's margin for the outline. */
  readonly size: Point;
  /** The feet anchor on that canvas: between the ankles, on the bottom row of the feet. */
  readonly anchor: Point;
  readonly head: Point;
  readonly chest: Point;
  readonly waist: Point;
  /** The limbs on the far side of the body, drawn behind and darker, and the near ones. */
  readonly far: Side;
  readonly near: Side;
}

export type PoseChanges<P extends Pose> = Partial<Omit<P, "far" | "near">> & {
  readonly far?: Partial<Side>;
  readonly near?: Partial<Side>;
};

/** A copy of `base` with some joints moved: `adjust(idle, { near: { hand: [37, 22] } })`. */
export function adjust<P extends Pose>(
  base: P,
  changes: NoInfer<PoseChanges<P>>,
): P {
  const far = { ...base.far, ...changes.far };
  const near = { ...base.near, ...changes.near };
  return { ...base, ...changes, far, near };
}

/** An arm's joints and a leg's, for `adjust`: `{ near: { ...armAt([40, 32], [46, 29], [44, 22]) } }`. */
export const armAt = (shoulder: Point, elbow: Point, hand: Point) => ({
  shoulder,
  elbow,
  hand,
});
export const legAt = (hip: Point, knee: Point, ankle: Point) => ({
  hip,
  knee,
  ankle,
});

/**
 * The middle joint of a limb from `root` to `end` whose two bones are `upper` and `lower` long: a knee bends to the
 * right of the line from hip to ankle (`side` 1, forward for a figure facing right), an elbow to its left (-1).
 * Out of reach, the limb straightens toward `end`; so close to `root` that the shorter bone could not fold back
 * far enough, it folds as far as it goes. Either way the upper bone keeps its length.
 */
export function bend(
  root: Point,
  end: Point,
  upper: number,
  lower: number,
  side: 1 | -1,
): Point {
  const [dx, dy] = [end[0] - root[0], end[1] - root[1]];
  const length = Math.hypot(dx, dy) || 1e-6;
  const d = Math.max(
    Math.abs(upper - lower),
    Math.min(length, upper + lower),
    1e-6,
  );
  const a = (upper * upper - lower * lower + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, upper * upper - a * a)) * side;
  const [ux, uy] = [dx / length, dy / length];
  return [root[0] + ux * a + uy * h, root[1] + uy * a - ux * h];
}

/** Breathing out: head, chest and arms lowered by `dy`, the waist by half that, the legs where they were. */
export function breath(pose: Pose, dy: number): PoseChanges<Pose> {
  const down = (p: Point) => offset(p, 0, dy);
  const arm = ({ shoulder, elbow, hand }: Side) =>
    armAt(down(shoulder), down(elbow), down(hand));
  return {
    head: down(pose.head),
    chest: down(pose.chest),
    waist: offset(pose.waist, 0, dy / 2),
    far: arm(pose.far),
    near: arm(pose.near),
  };
}

const span = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/**
 * Frame `i` of a walk cycle of `frames`: the near foot is planted `reach` ahead of the hips on frame 0 and sweeps back
 * at an even pace while the far foot swings forward, up to `lift` off the ground, half a cycle behind. On the frames
 * where the feet are widest apart (0 and `frames / 2`) the body dips by `dip`. A planted foot moves
 * `4 × reach / frames` pixels a frame, so walking that far a frame keeps it still on the ground.
 */
export function stride(
  pose: Pose,
  i: number,
  frames: number,
  { reach, lift, dip }: { reach: number; lift: number; dip: number },
): PoseChanges<Pose> {
  const low = (2 * i) % frames === 0 ? dip : 0;
  // The feet swing about the body's centre line, a little to either side of it, not about hips the 3/4 view parts.
  const centre = (pose.far.hip[0] + pose.near.hip[0]) / 2;
  const leg = (side: Side, phase: number) => {
    const q = (i / frames + phase) % 1;
    const swing = q >= 0.5;
    const x = swing ? reach * (4 * q - 3) : reach * (1 - 4 * q);
    const up = swing ? lift * Math.sin((q - 0.5) * 2 * Math.PI) : 0;
    const hip = offset(side.hip, 0, low);
    const ankle: Point = [(centre + side.hip[0]) / 2 + x, side.ankle[1] - up];
    const knee = bend(
      hip,
      ankle,
      span(side.hip, side.knee),
      span(side.knee, side.ankle),
      1,
    );
    return legAt(hip, knee, ankle);
  };
  const body = breath(pose, low);
  return {
    ...body,
    waist: offset(pose.waist, 0, low),
    far: { ...body.far, ...leg(pose.far, 0.5) },
    near: { ...body.near, ...leg(pose.near, 0) },
  };
}

/** A figure's frames by name, each painted once on first use so it keeps one identity for the baker's cache. */
export interface Figure<F extends string = string> {
  readonly frames: readonly F[];
  /** Palette overrides the figure is drawn with, such as a duplicate hero's colours. */
  readonly swaps: Readonly<Record<string, Palette>>;
  sprite(frame: F): Sprite;
}

export function figure<F extends string, P>(
  poses: Readonly<Record<F, P>>,
  paint: (pose: P) => Sprite,
  swaps: Readonly<Record<string, Palette>> = {},
): Figure<F> {
  const painted = new Map<F, Sprite>();
  return {
    frames: Object.keys(poses) as F[],
    swaps,
    sprite(frame) {
      if (!Object.hasOwn(poses, frame))
        throw new Error(`The figure has no frame "${frame}"`);
      const sprite = painted.get(frame) ?? paint(poses[frame]);
      painted.set(frame, sprite);
      return sprite;
    },
  };
}

/** The far side of the body sits in shadow. */
export const BACK: ShapeOptions = { bias: -0.26 };

export const offset = (p: Point, dx: number, dy: number): Point => [
  p[0] + dx,
  p[1] + dy,
];
export const between = (a: Point, b: Point, t = 0.5): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

export interface PartOptions extends ShapeOptions {
  /** Scales the part's girth. */
  readonly thick?: number;
  /** The limb's own material (skin by default), or the boot's, cuff's, bracer's, shoulder pad's. */
  readonly material?: string;
  readonly boot?: string;
  readonly cuff?: string;
  readonly bracer?: string;
  readonly pad?: string;
}

/** A leg with a boot (leather by default) and an optional cuff at the boot's top. */
export function leg(rig: Rig, { hip, knee, ankle }: Side, o: PartOptions = {}) {
  const t = o.thick ?? 1;
  const boot = o.boot ?? "l";
  const skin = o.material ?? "s";
  rig.capsule(hip, knee, 3.8 * t, 2.9 * t, skin, o);
  rig.capsule(knee, ankle, 2.9 * t, 2.2 * t, skin, o);
  const top = between(knee, ankle, 0.3);
  rig.capsule(top, ankle, 2.9 * t, 2.6 * t, boot, o);
  if (o.cuff) rig.ellipse(top, 3.3 * t, 1.5 * t, o.cuff, o);
  rig.ellipse(offset(ankle, 1.4, 1.6), 3.8 * t, 2 * t, boot, o);
}

/** An arm, the upper arm one part with the shoulder, with an optional bracer and shoulder pad. */
export function arm(
  rig: Rig,
  { shoulder, elbow, hand }: Side,
  o: PartOptions = {},
) {
  const t = o.thick ?? 1;
  const skin = o.material ?? "s";
  const upper = { ...o, group: rig.newGroup() };
  rig.ellipse(shoulder, 3.8 * t, 3.5 * t, skin, upper);
  rig.capsule(shoulder, elbow, 3.2 * t, 2.7 * t, skin, upper);
  rig.capsule(elbow, hand, 2.6 * t, 2.2 * t, skin, o);
  const cuff = between(elbow, hand, 0.45);
  if (o.bracer)
    rig.capsule(cuff, hand, 2.5 * t, 2.4 * t, o.bracer, {
      ...o,
      edge: "shade",
    });
  if (o.pad)
    rig.ellipse(offset(shoulder, -0.3, -0.8), 4.2 * t, 3.2 * t, o.pad, o);
}

export function fist(rig: Rig, hand: Point, o: PartOptions = {}) {
  const t = o.thick ?? 1;
  rig.ellipse(hand, 2.3 * t, 2.1 * t, o.material ?? "s", o);
}

/** A steel sword gripped at `hand`, pointing `degrees` clockwise from right, the fist drawn over the grip. */
export function sword(
  rig: Rig,
  hand: Point,
  degrees: number,
  length: number,
  width: number,
  o: PartOptions = {},
) {
  const radians = (degrees * Math.PI) / 180;
  const [ux, uy] = [Math.cos(radians), Math.sin(radians)];
  const along = (d: number, p = hand) => offset(p, ux * d, uy * d);
  const guard = along(2.4);
  const pommel = along(-3.6);
  rig.capsule(pommel, along(1.5), 1, 1, "l");
  rig.ellipse(pommel, 1.3, 1.3, "n");
  rig.blade(along(0.4, guard), along(length, guard), width, "m", { tip: 4 });
  rig.capsule(
    offset(guard, uy * 2.6, -ux * 2.6),
    offset(guard, -uy * 2.6, ux * 2.6),
    1,
    1,
    "n",
  );
  fist(rig, hand, o);
}

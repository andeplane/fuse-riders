import type { Pose } from "./kit.js";
import { Rig, type Painting, type Point, type Smear } from "./rig.js";
import type { Sprite } from "./sprite.js";

/**
 * Heads, faces and portraits for the heroes: what every hero's painter shares above the neck, and the pose fields that
 * drive it.
 */
export type Expression = "calm" | "yell" | "pain" | "out";
/**
 * A hero's hand-placed brow, eye and mouth pixels per expression, rows from the brow down, the first column on the
 * head's centre.
 */
export type Faces = Readonly<Record<Expression, readonly string[]>>;

/** What a hero's pose adds to the body: a swing's motion arc, the body's tilt and the face. */
export interface HeroPose extends Pose {
  readonly smear?: Smear;
  /** Degrees the head and the details on the torso turn with the body, clockwise: −90 lies on the back. */
  readonly tilt?: number;
  readonly face?: Expression;
}

/** The point (dx, dy) from a joint in the body's own frame, turned with the body. */
export type Turn = (p: Point, dx: number, dy: number) => Point;

/** The body's frame turned `tilt` degrees clockwise: `turn(-90)(head, 0, 4)` is 4 px from the head toward the feet. */
export function turn(tilt = 0): Turn {
  const radians = (tilt * Math.PI) / 180;
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
  return (p, dx, dy) => [
    p[0] + dx * cos - dy * sin,
    p[1] + dx * sin + dy * cos,
  ];
}

/** A face in skin, the skull, jaw and nose one part lit a little brighter, `scale` times a broad barbarian's. */
export function head(rig: Rig, h: Point, at: Turn, scale = 1) {
  const face = { group: "head", bias: 0.2 };
  const k = scale;
  rig.ellipse(h, 3.7 * k, 4.3 * k, "s", face);
  rig.ellipse(at(h, 1.7 * k, 2.4 * k), 2.8 * k, 2.3 * k, "s", face);
  rig.ellipse(at(h, 4 * k, 0.9 * k), 1 * k, 1.1 * k, "s", face);
}

/** Stamps a face's rows on the baked painting, turned with the head. */
export function stampFace(
  painting: Painting,
  h: Point,
  at: Turn,
  rows: readonly string[],
): Painting {
  rows.forEach((row, j) =>
    [...row].forEach((key, i) => {
      const [x, y] = at(h, i, j - 1);
      if (key !== " ") painting.stamp(Math.round(x), Math.round(y), [key]);
    }),
  );
  return painting;
}

/** Rows of keys stamped with their top-left at (x, y). */
export type Stamp = readonly [x: number, y: number, rows: readonly string[]];

export interface PortraitParts {
  /** Paints what sits behind the face, such as long hair, on the 18 × 18 canvas, the face centred at (9.5, 8). */
  readonly behind: (rig: Rig) => void;
  /** Paints the fringe and headgear over the face. */
  readonly over: (rig: Rig) => void;
  /** The eyes and mouth. */
  readonly face: readonly Stamp[];
  /** The jaw's and nose's size, 1 for a broad barbarian's. */
  readonly jaw?: number;
}

/** A HUD's 16 × 16 portrait: a hero's head and shoulders on a violet plate in an ink frame. */
export function portrait({
  behind,
  over,
  face,
  jaw = 1,
}: PortraitParts): Sprite {
  const plate: Point[] = [
    [2, 2],
    [16, 2],
    [16, 16],
    [2, 16],
  ];
  const rig = new Rig(18, 18).poly(plate, "i", { bevel: 2 });
  const body = { group: "body" };
  rig.ellipse([9.5, 17.5], 7.5, 3.5, "s", body);
  rig.capsule([9.5, 12], [9.5, 16], 2.6, 3, "s", body);
  behind(rig);
  const skin = { group: "head", bias: 0.2 };
  rig.ellipse([9.5, 8], 4.2, 4.8, "s", skin);
  rig.ellipse([11.5, 10.5], 3 * jaw, 2.5 * jaw, "s", skin);
  rig.ellipse([13.5 - 1 + jaw, 8.6], 1.1 * jaw, 1.2 * jaw, "s", skin);
  over(rig);
  // Only the plate shows: everything outside it is cleared, and the outline closes round it.
  const clear = Array.from({ length: 18 }, (_, y) =>
    y < 2 || y > 15 ? ".".repeat(18) : `..${" ".repeat(14)}..`,
  );
  const painting = rig.bake().stamp(0, 0, clear);
  for (const [x, y, rows] of face) painting.stamp(x, y, rows);
  return painting.sprite([9, 16]);
}

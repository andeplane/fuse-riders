import {
  adjust,
  arm,
  BACK,
  between,
  figure,
  fist,
  leg,
  offset as at,
  sword,
  type Pose,
} from "../pixel/kit.js";
import { rampSwap } from "../pixel/palette.js";
import { Rig, type Smear } from "../pixel/rig.js";
import type { Sprite } from "../pixel/sprite.js";

/** Brakka the barbarian: a broadsword, a blond mane, a red loincloth. */
export interface BrakkaPose extends Pose {
  /** The sword's angle in degrees, clockwise from pointing right, and its blade's length. */
  readonly sword: number;
  readonly blade: number;
  readonly smear?: Smear;
}

const idle: BrakkaPose = {
  size: [48, 52],
  anchor: [23, 50],
  head: [24.5, 8.6],
  chest: [22.5, 19.5],
  waist: [22.5, 25.5],
  far: {
    shoulder: [16, 16.5],
    elbow: [13.5, 23.5],
    hand: [14, 29.5],
    hip: [20, 30.5],
    knee: [16.5, 39.5],
    ankle: [15.8, 47.5],
  },
  near: {
    shoulder: [29.5, 16.5],
    elbow: [30.5, 23.5],
    hand: [36.2, 23.4],
    hip: [25, 30.5],
    knee: [29, 39.5],
    ankle: [30.2, 47.5],
  },
  sword: -66,
  blade: 18,
};

/** The combo's lunging slash: weight forward, the sword swept level through a motion arc. */
const slash = adjust(idle, {
  size: [68, 52],
  anchor: [25, 50],
  head: [30.5, 10],
  chest: [27.5, 20],
  waist: [25.5, 26],
  far: {
    shoulder: [21, 17],
    elbow: [15.5, 21],
    hand: [11.5, 24.5],
    hip: [23, 31],
    knee: [17, 39],
    ankle: [11.5, 47.5],
  },
  near: {
    shoulder: [34, 17],
    elbow: [39, 20.5],
    hand: [44, 21],
    hip: [28, 31],
    knee: [34.5, 38.5],
    ankle: [36, 47.5],
  },
  sword: 6,
  blade: 19,
  smear: { center: [41, 23], inner: 13, outer: 18, from: -80, to: 4 },
});

export const BRAKKA_POSES = { idle, slash };
export type BrakkaFrame = keyof typeof BRAKKA_POSES;

export function paintBrakka(pose: BrakkaPose): Sprite {
  const { head: h, chest, waist, far, near } = pose;
  const rig = new Rig(...pose.size);
  if (pose.smear) rig.smear(pose.smear);
  arm(rig, far, { ...BACK, bracer: "l" });
  fist(rig, far.hand, BACK);
  leg(rig, far, { ...BACK, cuff: "b" });
  // Torso, pecs, a four-pack and the neck, all one part.
  const body = { group: "body" };
  rig.ellipse(waist, 6, 5.5, "s", body);
  rig.ellipse(chest, 8.3, 6.2, "s", body);
  rig.ellipse(at(chest, -2.9, -0.5), 4.3, 3.6, "s", { ...body, flat: 0.8 });
  rig.ellipse(at(chest, 3.1, -0.5), 4.6, 3.8, "s", { ...body, flat: 0.8 });
  for (const dx of [-1.2, 2.1])
    for (const dy of [-1, 2])
      rig.ellipse(at(waist, dx, dy), 2.2, 1.75, "s", { ...body, flat: 0.6 });
  rig.capsule(at(h, -1, 3.5), at(chest, 0.5, -4), 2.6, 2.9, "s", body);
  // The mane falls behind the head; the fringe and headband sit on top of it.
  const mane = { group: "mane", bias: 0.12 };
  rig.capsule(at(h, -3.4, -0.5), at(h, -5.5, 4.5), 4.3, 3.3, "h", mane);
  rig.capsule(at(h, -5.5, 4.5), at(h, -6.8, 9.5), 3.3, 2.2, "h", mane);
  rig.capsule(at(h, -3, -3.5), at(h, -8, -2), 1.9, 0.8, "h", mane);
  rig.capsule(at(h, -4.5, 1), at(h, -9, 4), 1.9, 0.8, "h", mane);
  const face = { group: "head", bias: 0.2 };
  rig.ellipse(h, 3.7, 4.3, "s", face);
  rig.ellipse(at(h, 1.7, 2.4), 2.8, 2.3, "s", face);
  rig.ellipse(at(h, 4, 0.9), 1, 1.1, "s", face);
  const fringe = { group: "fringe", edge: "none" } as const;
  rig.ellipse(at(h, -0.6, -3.1), 4.3, 2.6, "h", fringe);
  rig.capsule(at(h, -4, -2), at(h, -4.3, 1.5), 2.1, 1.7, "h", fringe);
  const band = { edge: "none" } as const;
  rig.capsule(at(h, -4, -1.9), at(h, 3.6, -1.9), 0.75, 0.75, "c", band);
  // A baldric from the near shoulder to the far hip, then the near leg, loincloth, belt and buckle.
  const strap = { edge: "shade", flat: 0.2 } as const;
  rig.capsule(
    at(near.shoulder, -1.5, -2),
    at(waist, -4, 2.5),
    1,
    1,
    "l",
    strap,
  );
  leg(rig, near, { cuff: "b" });
  const hips = between(far.hip, near.hip);
  const cloth = [
    at(hips, -3, -1.5),
    at(hips, 4, -1.5),
    at(hips, 3.5, 5),
    at(hips, 1.5, 7.5),
    at(hips, -1, 6.5),
    at(hips, -2.5, 4.5),
  ];
  rig.poly(cloth, "c");
  const belt = { edge: "shade" } as const;
  rig.capsule(at(hips, -6, -1.2), at(hips, 5.5, -1.2), 1.7, 1.7, "l", belt);
  rig.ellipse(at(hips, 3, -1.2), 1.5, 1.5, "n", belt);
  arm(rig, near, { bracer: "l" });
  sword(rig, near.hand, pose.sword, pose.blade, 4.2);
  // Brow, eye and mouth, placed by hand.
  const [x, y] = [Math.round(h[0]), Math.round(h[1])];
  return rig
    .bake()
    .stamp(x, y - 1, ["3kk", " k "])
    .stamp(x + 2, y + 3, ["11"])
    .sprite(pose.anchor);
}

/** A second Brakka in the same room: dark hair, deeper skin, a blue loincloth. */
const SECOND = {
  ...rampSwap("Cc0", "Uu@"),
  ...{ H: "#b58a6a", h: "#5e3a36", 3: "#2c1828" },
  ...{ S: "#eeb184", s: "#b86d45", 1: "#723a3a" },
};

export const BRAKKA = figure(BRAKKA_POSES, paintBrakka, { second: SECOND });

import {
  adjust,
  arm,
  BACK,
  between,
  figure,
  fist,
  leg,
  offset as at,
  type Pose,
  type Side,
} from "../pixel/kit.js";
import { rampSwap } from "../pixel/palette.js";
import { Rig, type Point, type Smear } from "../pixel/rig.js";
import type { Sprite } from "../pixel/sprite.js";

/**
 * The ravager, the mace-swinging foot soldier: a crested iron helm, a leather harness and a spiked mace. Its tunic,
 * crest, kilt and boots are the enemy-tier ramp (`Aa$`), so a tier is a three-colour swap.
 */
export interface RavagerPose extends Pose {
  /** The head's turn in degrees, clockwise: positive nods forward, -90 lies on its back. */
  readonly tilt: number;
  /** The mace's angle in degrees, clockwise from pointing right. */
  readonly mace: number;
  readonly smear?: Smear;
  /** Eye squeezed shut and mouth open. */
  readonly pain?: boolean;
}

/** Offsets from `origin` along a part's own axes turned `degrees` clockwise: `forward` the way it faces, `down` along it. */
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

/** The upper body moved down by `dy` (a breath, a step's bob), the legs left where they stand. */
function settle(pose: RavagerPose, dy: number): RavagerPose {
  const arms = ({ shoulder, elbow, hand }: RavagerPose["far"]) => ({
    shoulder: at(shoulder, 0, dy),
    elbow: at(elbow, 0, dy),
    hand: at(hand, 0, dy),
  });
  return adjust(pose, {
    head: at(pose.head, 0, dy),
    chest: at(pose.chest, 0, dy),
    waist: at(pose.waist, 0, dy / 2),
    far: arms(pose.far),
    near: arms(pose.near),
  });
}

/**
 * The whole pose turned `degrees` clockwise about `pivot` and moved by `move`, head and mace with it: a standing pose
 * tipped over backwards (negative degrees) becomes a body in the air or lying on its back.
 */
function tipped(
  pose: RavagerPose,
  degrees: number,
  pivot: Point,
  [mx, my]: Point,
): RavagerPose {
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
    mace: pose.mace + degrees,
  };
}

/**
 * Every frame shares one canvas and one feet anchor, so frames line up on the floor; the room above the head is for
 * the raised mace, and the room either side for the swing and for lying flat.
 */
const idle: RavagerPose = {
  size: [72, 72],
  anchor: [31, 66],
  head: [33.5, 27.5],
  tilt: 0,
  chest: [31, 37],
  waist: [31, 43],
  far: {
    shoulder: [24.5, 34],
    elbow: [22.5, 41],
    hand: [23.5, 46.5],
    hip: [28, 47.5],
    knee: [25, 56],
    ankle: [24.5, 63.5],
  },
  near: {
    shoulder: [38, 34.5],
    elbow: [40.5, 40.5],
    hand: [44.5, 41.5],
    hip: [33.5, 47.5],
    knee: [37.5, 56],
    ankle: [38.5, 63.5],
  },
  mace: -48,
};

/** The near foot planted ahead, the far one pushing off behind; the far arm swings forward against it. */
const stride = settle(
  adjust(idle, {
    far: {
      elbow: [25, 41],
      hand: [28.5, 45.5],
      hip: [28, 48],
      knee: [25.5, 56.5],
      ankle: [21, 62.5],
    },
    near: {
      elbow: [39.5, 41],
      hand: [43, 43],
      hip: [33.5, 48],
      knee: [38.5, 56],
      ankle: [41.5, 63.5],
    },
    mace: -40,
  }),
  1,
);
/** The far foot passing under the body, lifted, while the near one bears the weight. */
const passing = adjust(idle, {
  far: { knee: [30.5, 54], ankle: [27.5, 60] },
  near: { knee: [35.5, 56], ankle: [33.5, 63.5] },
});
/** The far foot planted ahead and the near one pushing off: the hips turn with the stride. */
const strideBack = settle(
  adjust(idle, {
    far: {
      elbow: [20.5, 41],
      hand: [19.5, 46],
      hip: [29.5, 48],
      knee: [34.5, 56],
      ankle: [38.5, 63.5],
    },
    near: {
      elbow: [41.5, 40],
      hand: [46, 40.5],
      hip: [32.5, 48],
      knee: [30, 56.5],
      ankle: [24.5, 62.5],
    },
    mace: -55,
  }),
  1,
);
/** The near foot passing, lifted, while the far one bears the weight. */
const passingBack = adjust(idle, {
  far: { knee: [26.5, 56], ankle: [28.5, 63.5] },
  near: { knee: [38, 54], ankle: [34.5, 60.5] },
});

/** The telegraph: leaning back with the mace raised high over the head, the far arm thrown back for balance. */
const windup = adjust(idle, {
  head: [32, 28],
  tilt: -10,
  chest: [30, 37.5],
  waist: [30.5, 43.5],
  far: {
    shoulder: [23.5, 34.5],
    elbow: [20, 40],
    hand: [18.5, 45],
  },
  near: {
    shoulder: [36.5, 34],
    elbow: [39.5, 27],
    hand: [36, 20],
  },
  mace: -125,
});

/** The blow: lunging over the planted feet, the mace brought down in front through a motion arc. */
const attack = adjust(idle, {
  head: [37, 30],
  tilt: 12,
  chest: [34, 38.5],
  waist: [32.5, 44],
  far: {
    shoulder: [27.5, 35],
    elbow: [23.5, 39.5],
    hand: [20.5, 43.5],
    knee: [25.5, 56],
  },
  near: {
    shoulder: [40.5, 35],
    elbow: [45.5, 39.5],
    hand: [50, 43],
    knee: [38.5, 55.5],
  },
  mace: 25,
  smear: { center: [40.5, 35], inner: 17, outer: 24, from: -110, to: 30 },
});

/** After the blow: the mace hangs low and the body comes back up. */
const recover = adjust(idle, {
  head: [35.5, 29],
  tilt: 6,
  chest: [32.5, 38],
  waist: [31.5, 43.5],
  far: {
    shoulder: [26, 34.5],
    elbow: [23, 40.5],
    hand: [22.5, 46],
  },
  near: {
    shoulder: [39.5, 35],
    elbow: [43, 41],
    hand: [46, 46],
  },
  mace: 70,
});

/** Struck: the head snaps back, the body reels and the arms fly out. */
const hurt = adjust(idle, {
  head: [30, 29.5],
  tilt: -20,
  chest: [29.5, 38],
  waist: [30.5, 44],
  far: {
    shoulder: [23, 35],
    elbow: [18.5, 39],
    hand: [15.5, 43.5],
    knee: [25.5, 56.5],
  },
  near: {
    shoulder: [36.5, 35],
    elbow: [41, 37.5],
    hand: [45, 34.5],
    knee: [37, 56.5],
  },
  mace: -75,
  pain: true,
});

/** The hips, which the falling poses turn about. */
const HIPS: Point = [31, 47.5];

/** Flung back through the air: tipped over backwards, head thrown back, arms and legs trailing toward the blow. */
const knockdown = tipped(
  adjust(idle, {
    head: [32, 28],
    tilt: -15,
    far: {
      elbow: [29, 38],
      hand: [35, 39],
      knee: [34, 53.5],
      ankle: [38, 60.5],
    },
    near: {
      elbow: [43.5, 37],
      hand: [49, 38.5],
      knee: [41, 51.75],
      ankle: [47, 57],
    },
    mace: 20,
    pain: true,
  }),
  -60,
  HIPS,
  [2, 11.5],
);

/** Laid out on its back, head toward where the blow came from, one arm flung overhead and the mace across the legs. */
const down = tipped(
  adjust(idle, {
    head: [33, 27.5],
    tilt: -10,
    far: {
      elbow: [23.5, 41],
      hand: [25, 47],
      knee: [30, 56],
      ankle: [27.5, 64],
    },
    near: {
      elbow: [36, 41],
      hand: [33.5, 47.5],
      knee: [35.5, 56],
      ankle: [35, 64],
    },
    mace: 95,
    pain: true,
  }),
  -90,
  HIPS,
  [4, 9],
);

/** Getting up: kneeling on the far knee, leaning on the mace planted in front. */
const getup = adjust(idle, {
  head: [35, 36],
  tilt: 10,
  chest: [32, 45],
  waist: [31.5, 50.5],
  far: {
    shoulder: [25, 42],
    elbow: [23, 48],
    hand: [25, 53],
    hip: [29, 55],
    knee: [26.5, 62.5],
    ankle: [18.5, 63.5],
  },
  near: {
    shoulder: [38.5, 42],
    elbow: [41.5, 46.5],
    hand: [43, 51.5],
    hip: [33.5, 55],
    knee: [40, 55.5],
    ankle: [40.5, 63.5],
  },
  mace: 82,
});

export const RAVAGER_POSES = {
  idle,
  breathe: settle(idle, 1),
  walk1: stride,
  walk2: passing,
  walk3: strideBack,
  walk4: passingBack,
  windup,
  attack,
  recover,
  hurt,
  knockdown,
  down,
  getup,
};
export type RavagerFrame = keyof typeof RAVAGER_POSES;

/** The enemy view's anims (`dead` lies in the `down` frame while the renderer blinks it), and the AI's to come. */
export type RavagerAnim =
  | "idle"
  | "walk"
  | "windup"
  | "attack"
  | "recover"
  | "hurt"
  | "knockdown"
  | "down"
  | "getup"
  | "dead";

/** An anim's frames in order, each with the simulation steps (60 a second) it shows. */
export interface AnimStrip<F extends string> {
  readonly frames: readonly (readonly [frame: F, steps: number])[];
  /** Starts over after the last frame; an anim that does not loop holds its last frame for as long as it lasts. */
  readonly loop: boolean;
}

/**
 * The ravager's anims. A one-frame anim holds its frame for as long as the enemy is in that state, so its steps only
 * pace the lab; they follow the combat tuning (hurt 20, down 45, getup 20, dead 60), and the windup, attack and
 * recover steps stand in until the enemy AI sets that frame data.
 */
export const RAVAGER_ANIMS: Readonly<
  Record<RavagerAnim, AnimStrip<RavagerFrame>>
> = {
  idle: {
    frames: [
      ["idle", 32],
      ["breathe", 32],
    ],
    loop: true,
  },
  walk: {
    frames: [
      ["walk1", 8],
      ["walk2", 8],
      ["walk3", 8],
      ["walk4", 8],
    ],
    loop: true,
  },
  windup: { frames: [["windup", 24]], loop: false },
  attack: { frames: [["attack", 8]], loop: false },
  recover: { frames: [["recover", 16]], loop: false },
  hurt: { frames: [["hurt", 20]], loop: false },
  knockdown: { frames: [["knockdown", 30]], loop: false },
  down: { frames: [["down", 45]], loop: false },
  getup: { frames: [["getup", 20]], loop: false },
  dead: { frames: [["down", 60]], loop: false },
};

const HAFT = 11.5;

/** `count` steel spikes standing out of a ball of `radius`, the first at `from` degrees. */
function spikes(
  rig: Rig,
  center: Point,
  radius: number,
  from: number,
  count: number,
  length: number,
) {
  for (let i = 0; i < count; i++) {
    const out = turned(center, from + (360 / count) * i);
    rig.capsule(out(radius * 0.7, 0), out(radius + length, 0), 0.9, 0.3, "m");
  }
}

/** A spiked iron ball on a leather-wrapped haft, gripped at `hand` and pointing `degrees` clockwise from right. */
function mace(rig: Rig, hand: Point, degrees: number) {
  const along = turned(hand, degrees);
  const ball = along(HAFT, 0);
  rig.capsule(along(-3, 0), ball, 1.1, 1.1, "l");
  spikes(rig, ball, 3, degrees + 30, 6, 2.2);
  rig.ellipse(ball, 3.6, 3.6, "m");
  fist(rig, hand);
}

/** The kilt's outline around the hips, forward and down in the body's axes. */
const KILT: readonly Point[] = [
  [-5.75, -1.5],
  [6.25, -1.5],
  [7.25, 6],
  [3.25, 4.5],
  [0.25, 7],
  [-2.75, 4.5],
  [-6.75, 5.5],
];

export function paintRavager(pose: RavagerPose): Sprite {
  const { chest, waist, far, near } = pose;
  const rig = new Rig(...pose.size);
  if (pose.smear) rig.smear(pose.smear);
  const spine = lean(chest, waist);
  const torso = turned(chest, spine);
  const belly = turned(waist, spine);
  const hips = turned(between(far.hip, near.hip), spine);
  const head = turned(pose.head, pose.tilt);
  const legs = { material: "l", boot: "a", cuff: "w" };
  arm(rig, far, { ...BACK, bracer: "l" });
  fist(rig, far.hand, BACK);
  leg(rig, far, { ...BACK, ...legs });
  // The tunic, a broad chest over a narrower waist in one part, and the harness strap across it.
  const body = { group: "body" };
  rig.capsule(torso(-2.2, 0), torso(2.2, 0), 6.4, 6.4, "a", body);
  rig.capsule(belly(-1.1, 0), belly(1.1, 0), 5.5, 5.5, "a", body);
  const strap = { edge: "none" } as const;
  rig.capsule(torso(-3.5, -5.5), torso(1.5, 3), 2.3, 2.3, "l", strap);
  leg(rig, near, legs);
  rig.poly(
    KILT.map(([forward, down]) => hips(forward, down)),
    "a",
  );
  rig.capsule(hips(-6.25, -1.3), hips(6.25, -1.3), 1.6, 1.6, "l", strap);
  rig.ellipse(hips(0.75, -1.3), 1.6, 1.4, "m", strap);
  arm(rig, near, { bracer: "l" });
  // A spiked iron pauldron capping the near shoulder.
  const pad = turned(at(near.shoulder, 0.3, -0.5), spine);
  spikes(rig, pad(0, -0.4), 2.4, spine - 120, 2, 1.6);
  rig.capsule(pad(-1.5, 0), pad(1.5, 0), 2.3, 2.3, "l");
  mace(rig, near.hand, pose.mace);
  // Neck and face with a jutting nose, the iron helm with its steel brow, and the crest sweeping back.
  const skin = { bias: -0.1 };
  rig.capsule(head(-1, 3), head(-0.5, 6), 2.6, 2.6, "s", skin);
  const face = { group: "head", bias: 0.05 };
  rig.capsule(head(0, -0.5), head(0, 0.5), 3.8, 3.8, "s", face);
  rig.capsule(head(1.5, 2.3), head(2.1, 2.3), 2.3, 2.3, "s", face);
  rig.capsule(head(3.9, 0), head(4.4, 0.9), 1, 0.9, "s", face);
  const helm = { group: "helm" };
  rig.capsule(head(-1.6, -3.7), head(1, -3.7), 3.1, 3.1, "i", helm);
  rig.capsule(head(-4.8, -1.5), head(4.6, -1.5), 1, 1, "m", {
    ...helm,
    edge: "none",
  });
  const crest = { group: "crest" };
  rig.capsule(head(2, -6.6), head(-2.5, -8), 1.6, 1.8, "a", crest);
  rig.capsule(head(-2.5, -8), head(-7, -5.4), 1.8, 1.2, "a", crest);
  rig.capsule(head(-7, -5.4), head(-9, -1.4), 1.2, 0.6, "a", crest);
  // The eye glinting under the brow and a grim mouth; hurt squeezes the eye shut and opens the mouth.
  const painting = rig.bake();
  const dot = (forward: number, down: number, key: string) => {
    const [x, y] = head(forward, down);
    painting.stamp(Math.floor(x), Math.floor(y), [key]);
  };
  const [eye, mouth] = pose.pain ? ["kk", "kk"] : ["kD", "k1"];
  [...eye].forEach((key, i) => dot(1 + i, -0.5, key));
  [...mouth].forEach((key, i) => dot(3 - i, 2.5, key));
  if (pose.pain) dot(3, 3.5, "k");
  dot(-1, 1.5, "1");
  return painting.sprite(pose.anchor);
}

/** The tiers: ash is the figure's own palette; rust and violet recolour the tier ramp. */
export const RAVAGER_TIERS = {
  rust: rampSwap("Aa$", "Tt%"),
  violet: rampSwap("Aa$", "Qq^"),
};

export const RAVAGER = figure(RAVAGER_POSES, paintRavager, RAVAGER_TIERS);

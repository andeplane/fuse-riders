import {
  CAMERA_END,
  CAPACITY,
  ENTER_INSET,
  ENTER_STAGGER,
  EXTRA_DELAY,
  FLOOR_BOTTOM,
  FLOOR_TOP,
  STAGE_LENGTH,
  VIEW_W,
  px,
  type FoeKind,
  type MountKind,
  type Tier,
} from "./tuning.js";

/**
 * A stage as data: triggers along the road, each a wave. When the camera's left edge reaches a wave's `at` the wave
 * starts and the camera holds there until no enemy is left; then GO sends the party on to the next. The last wave
 * is the stage's boss.
 */
export type Side = "left" | "right";

/** One enemy of a wave: it walks in from outside the screen's edge on `side` at depth `y`, `delay` steps in. */
export interface Spawn {
  readonly kind: FoeKind;
  readonly tier: Tier;
  readonly side: Side;
  /** Depth on the floor band, in sub-units. */
  readonly y: number;
  readonly delay: number;
  /** A ravager that rides in on a beast of this kind (`mount.ts`). */
  readonly mount?: MountKind;
}

export interface Wave {
  /** The camera's left edge, in sub-units, that starts the wave and that the camera holds at until it is cleared. */
  readonly at: number;
  /** In order of delay. */
  readonly spawns: readonly Spawn[];
  /** What each hero beyond the first adds (`waveSpawns`), if not copies of `spawns`: a boss's wave adds grunts. */
  readonly extras?: readonly Spawn[];
}

export interface StagePlan {
  readonly name: string;
  /** The road's length in sub-units, and the furthest the camera's left edge goes: with the end at the screen's right. */
  readonly length: number;
  readonly cameraEnd: number;
  /** Strictly along the road, each with a spawn; the last at the camera's end. */
  readonly waves: readonly Wave[];
  /** The sack imps, in order along the road: between waves, or alongside one at its trigger. */
  readonly imps: readonly ImpCue[];
}

/**
 * A sack imp sent when the camera's left edge reaches `at`: it appears just outside the screen's edge on `side` at
 * depth `y` and scurries across with `pots` pots (1 to `IMP_POTS`). One imp, whatever the party's size. An imp walks
 * slower than the camera, so one from the left is only seen when the camera stands still: put its cue at a wave's
 * trigger, where the screen locks, or the camera outruns it and it leaves unseen.
 */
export interface ImpCue {
  readonly at: number;
  readonly side: Side;
  readonly y: number;
  readonly pots: number;
  /** Nor before the world's step `step` (none: any step): camp's camera never moves, so its imps come by the clock. */
  readonly step?: number;
}
const imp = (at: number, side: Side, y: number, pots: number): ImpCue => ({
  at: px(at),
  side,
  y: px(y),
  pots,
});

const ravager = (tier: Tier, side: Side, y: number, delay: number): Spawn => ({
  kind: "ravager",
  tier,
  side,
  y: px(y),
  delay,
});
/** A lancer, which leaps in from beyond the screen's edge rather than walking. */
const lancer = (tier: Tier, side: Side, y: number, delay: number): Spawn => ({
  ...ravager(tier, side, y, delay),
  kind: "lancer",
});
/** A ravager riding in on a clawbeak, whose tail it fights with. */
const rider = (tier: Tier, side: Side, y: number, delay: number): Spawn => ({
  ...ravager(tier, side, y, delay),
  mount: "clawbeak",
});
const ASH = 0,
  RUST = 1,
  VIOLET = 2;
/** One of the Ogre twins, its tier only its palette. */
const ogre = (tier: Tier, side: Side, y: number): Spawn => ({
  kind: "ogre",
  tier,
  side,
  y: px(y),
  delay: 0,
});

/**
 * Ashen Village: four waves building in size and tier, the later two with a lancer leaping in, then the Ogre twins at
 * the village gate.
 */
export const STAGE_1: StagePlan = {
  name: "Ashen Village",
  length: STAGE_LENGTH,
  cameraEnd: CAMERA_END,
  waves: [
    {
      at: px(192),
      spawns: [ravager(ASH, "right", 132, 0), ravager(ASH, "right", 156, 40)],
    },
    {
      at: px(416),
      spawns: [
        ravager(ASH, "right", 120, 0),
        ravager(ASH, "left", 150, 30),
        ravager(RUST, "right", 164, 70),
      ],
    },
    {
      at: px(608),
      spawns: [
        ravager(RUST, "right", 128, 0),
        ravager(ASH, "left", 116, 20),
        lancer(ASH, "right", 160, 50),
        ravager(RUST, "left", 148, 80),
      ],
    },
    {
      at: px(800),
      spawns: [
        ravager(RUST, "right", 120, 0),
        ravager(RUST, "left", 140, 0),
        ravager(VIOLET, "right", 152, 40),
        lancer(RUST, "left", 112, 70),
        ravager(RUST, "right", 168, 100),
      ],
    },
    {
      // The village gate: the Ogre twins come at the party from both sides, and a bigger party meets ravagers too.
      at: CAMERA_END,
      spawns: [ogre(ASH, "left", 132), ogre(RUST, "right", 148)],
      extras: [
        ravager(VIOLET, "left", 116, 60),
        ravager(RUST, "right", 164, 60),
      ],
    },
  ],
  // After wave 2 one comes the other way as the party walks on, another darts in behind wave 3's fight, and after
  // wave 4 a fuller sack runs at the party before the gate.
  imps: [
    imp(480, "right", 136, 2),
    imp(608, "left", 124, 2),
    imp(872, "right", 150, 3),
  ],
};

const ROAD_2 = px(5 * VIEW_W);
/**
 * Wyrmbone Pass, as gameplay to fight through until its boss comes: a screen longer than the village, five waves of
 * ravagers mostly in rust and violet, each with a lancer leaping in, and in waves 2 and 4 a ravager riding a clawbeak
 * (copied, as any spawn is, for a party big enough), and at the pass's end a pair of violet ravagers in place of the
 * lancer captain on his ember drake, with rust ones for a bigger party.
 */
export const STAGE_2: StagePlan = {
  name: "Wyrmbone Pass",
  length: ROAD_2,
  cameraEnd: ROAD_2 - px(VIEW_W),
  waves: [
    {
      at: px(192),
      spawns: [
        ravager(RUST, "right", 132, 0),
        ravager(ASH, "right", 156, 30),
        lancer(ASH, "left", 120, 60),
      ],
    },
    {
      at: px(448),
      spawns: [
        ravager(RUST, "right", 120, 0),
        ravager(RUST, "left", 150, 20),
        rider(ASH, "right", 164, 60),
        lancer(RUST, "left", 128, 90),
      ],
    },
    {
      at: px(704),
      spawns: [
        ravager(VIOLET, "right", 136, 0),
        ravager(RUST, "left", 116, 30),
        lancer(RUST, "right", 160, 60),
        ravager(ASH, "left", 148, 90),
      ],
    },
    {
      at: px(928),
      spawns: [
        ravager(RUST, "right", 120, 0),
        ravager(RUST, "left", 140, 0),
        rider(RUST, "right", 152, 40),
        lancer(VIOLET, "left", 112, 70),
        ravager(ASH, "right", 168, 100),
      ],
    },
    {
      at: px(1120),
      spawns: [
        ravager(VIOLET, "right", 128, 0),
        ravager(VIOLET, "left", 150, 30),
        lancer(RUST, "right", 116, 60),
        ravager(RUST, "left", 164, 90),
        lancer(RUST, "right", 140, 120),
      ],
    },
    {
      at: ROAD_2 - px(VIEW_W),
      spawns: [
        ravager(VIOLET, "left", 132, 0),
        ravager(VIOLET, "right", 148, 0),
      ],
      extras: [ravager(RUST, "left", 116, 60), ravager(RUST, "right", 164, 60)],
    },
  ],
  // One runs at the party between waves 2 and 3, and a fuller sack darts in behind wave 5's fight.
  imps: [imp(576, "right", 136, 2), imp(1120, "left", 124, 3)],
};

/** The run's stages in order: a world's plan is `STAGES[world.stage - 1]`. */
export const STAGES: readonly StagePlan[] = [STAGE_1, STAGE_2];

/**
 * Camp between stages (`camp.ts`): one screen of night clearing, its camera standing still, no wave to fight, and four
 * sack imps sneaking in from alternate edges a few seconds apart to scurry through the camp. A camp imp's sack holds
 * meat and pots in turn (`kick` in `imps.ts`).
 */
export const CAMP: StagePlan = {
  name: "Camp",
  length: px(VIEW_W),
  cameraEnd: 0,
  waves: [],
  imps: (
    [
      [90, "right", 128, 3],
      [240, "left", 152, 2],
      [390, "right", 142, 3],
      [540, "left", 120, 2],
    ] as const
  ).map(([step, side, y, pots]) => ({ ...imp(0, side, y, pots), step })),
};
/**
 * The plan of the stage a world is on (`createWorld` and the codec keep its stage one of `STAGES`), or camp's for a
 * camp's world.
 */
export const planOf = (world: {
  readonly stage: number;
  readonly camp?: boolean;
}): StagePlan => (world.camp ? CAMP : STAGES[world.stage - 1]!);

/** A spawn as it enters: how far inside its edge it walks to. */
export interface Placed extends Spawn {
  readonly inset: number;
}

/**
 * A wave's spawns for a party of `heroes` (an empty world counts one), in the order they enter. Each hero beyond
 * the first adds one: the k-th extra copies the wave's (k mod n)-th spawn (of its `extras`, if it has them) from the
 * other side, mirrored in depth, a round of `EXTRA_DELAY` later per pass through them, and walks a round of
 * `ENTER_STAGGER` further in, so no two arrive on the same spot. The sort is stable: spawns due together enter in
 * list order.
 */
export function waveSpawns(wave: Wave, heroes: number): Placed[] {
  const pool = wave.extras ?? wave.spawns,
    count = pool.length,
    party = Math.min(Math.max(heroes, 1), CAPACITY);
  const extras = Array.from({ length: party - 1 }, (_, k): Placed => {
    const spawn = pool[k % count]!,
      round = 1 + Math.trunc(k / count);
    return {
      ...spawn,
      side: spawn.side === "left" ? "right" : "left",
      y: FLOOR_TOP + FLOOR_BOTTOM - spawn.y,
      delay: spawn.delay + round * EXTRA_DELAY,
      inset: ENTER_INSET + round * ENTER_STAGGER,
    };
  });
  return [
    ...wave.spawns.map((spawn) => ({ ...spawn, inset: ENTER_INSET })),
    ...extras,
  ].sort((a, b) => a.delay - b.delay);
}

import {
  CAMERA_END,
  CAPACITY,
  ENTER_INSET,
  ENTER_STAGGER,
  EXTRA_DELAY,
  FLOOR_BOTTOM,
  FLOOR_TOP,
  px,
  type FoeKind,
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
}

export interface Wave {
  /** The camera's left edge, in sub-units, that starts the wave and that the camera holds at until it is cleared. */
  readonly at: number;
  /** In order of delay. */
  readonly spawns: readonly Spawn[];
}

export interface StagePlan {
  readonly name: string;
  /** Strictly along the road, each with a spawn; the last at the camera's end. */
  readonly waves: readonly Wave[];
  /** The sack imps, in order along the road: between waves, or alongside one at its trigger. */
  readonly imps: readonly ImpCue[];
}

/**
 * A sack imp sent when the camera's left edge reaches `at`: it appears just outside the screen's edge on `side` at
 * depth `y` and scurries across with `pots` pots (1 to `IMP_POTS`). One imp, whatever the party's size.
 */
export interface ImpCue {
  readonly at: number;
  readonly side: Side;
  readonly y: number;
  readonly pots: number;
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
const ASH = 0,
  RUST = 1,
  VIOLET = 2;

/** Ashen Village: five waves building in size and tier, the last at the village gate (the Ogre twins' place). */
export const STAGE_1: StagePlan = {
  name: "Ashen Village",
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
        ravager(ASH, "right", 160, 50),
        ravager(RUST, "left", 148, 80),
      ],
    },
    {
      at: px(800),
      spawns: [
        ravager(RUST, "right", 120, 0),
        ravager(RUST, "left", 140, 0),
        ravager(VIOLET, "right", 152, 40),
        ravager(ASH, "left", 112, 70),
        ravager(RUST, "right", 168, 100),
      ],
    },
    {
      // The village gate: the toughest group stands in for the Ogre twins until they arrive.
      at: CAMERA_END,
      spawns: [
        ravager(VIOLET, "right", 128, 0),
        ravager(VIOLET, "right", 152, 0),
        ravager(RUST, "left", 116, 40),
        ravager(RUST, "left", 164, 40),
        ravager(VIOLET, "left", 140, 90),
        ravager(RUST, "right", 168, 120),
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

/** A spawn as it enters: how far inside its edge it walks to. */
export interface Placed extends Spawn {
  readonly inset: number;
}

/**
 * A wave's spawns for a party of `heroes` (an empty world counts one), in the order they enter. Each hero beyond
 * the first adds one: the k-th extra copies the wave's (k mod n)-th spawn from the other side, mirrored in depth,
 * a round of `EXTRA_DELAY` later per pass through the wave, and walks a round of `ENTER_STAGGER` further in, so no
 * two arrive on the same spot. The sort is stable: spawns due together enter in list order.
 */
export function waveSpawns(wave: Wave, heroes: number): Placed[] {
  const count = wave.spawns.length,
    party = Math.min(Math.max(heroes, 1), CAPACITY);
  const extras = Array.from({ length: party - 1 }, (_, k): Placed => {
    const spawn = wave.spawns[k % count]!,
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

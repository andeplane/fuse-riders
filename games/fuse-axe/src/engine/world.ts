import { CAPACITY, px, type HeroKind } from "./tuning.js";

/**
 * One run's world: plain integer data, so the netcode can clone, hash and checkpoint it. Space is `x` along the
 * road, `y` depth on the floor band (larger is nearer the viewer) and `z` height above the floor, all in sub-units;
 * the camera's left edge is `camX`. Heroes are kept in id order, which is seat order.
 */
export const HERO_STATES = ["idle", "walk", "jump", "land"] as const;
export type HeroState = (typeof HERO_STATES)[number];

export interface Hero {
  id: number;
  seat: number;
  kind: HeroKind;
  x: number;
  y: number;
  z: number;
  /** Velocity along the road and in depth: the walk this step, or the momentum a jump keeps. */
  vx: number;
  vy: number;
  vz: number;
  facing: 1 | -1;
  state: HeroState;
  /** Steps since `state` began. */
  timer: number;
  /** The bits held on the previous step, which the next step derives presses from. */
  held: number;
}

export interface World {
  seed: number;
  /** Steps since the run began. */
  step: number;
  /** The mulberry32 state (`rng.ts`): every random draw advances it, so rollback replays the same draws. */
  rng: number;
  /** The next entity id. */
  nextId: number;
  camX: number;
  heroes: Hero[];
}

export interface HeroEntry {
  seat: number;
  kind: HeroKind;
}

/** Where each seat's hero starts, in pixels: spread across the left of the screen and the depth of the floor. */
export const SPAWNS: readonly (readonly [number, number])[] = [
  [64, 138],
  [48, 116],
  [48, 160],
  [32, 127],
  [32, 149],
];

export function createWorld(options: {
  seed: number;
  heroes: readonly HeroEntry[];
}): World {
  const entries = [...options.heroes].sort((a, b) => a.seat - b.seat);
  entries.forEach((entry, index) => {
    if (
      !Number.isInteger(entry.seat) ||
      entry.seat < 0 ||
      entry.seat >= CAPACITY ||
      entries[index - 1]?.seat === entry.seat
    )
      throw new RangeError(`fuse-axe: bad or repeated seat ${entry.seat}`);
  });
  const heroes = entries.map((entry, index): Hero => {
    const [x, y] = SPAWNS[entry.seat]!;
    return {
      id: index + 1,
      seat: entry.seat,
      kind: entry.kind,
      x: px(x),
      y: px(y),
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      facing: 1,
      state: "idle",
      timer: 0,
      held: 0,
    };
  });
  return {
    seed: options.seed >>> 0,
    step: 0,
    rng: (options.seed ^ 0x5bd1e995) >>> 0,
    nextId: heroes.length + 1,
    camX: 0,
    heroes,
  };
}

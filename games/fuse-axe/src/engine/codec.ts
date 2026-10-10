import { INPUT_MASK } from "./input.js";
import {
  BUFFER_STEPS,
  CAMERA_END,
  CAPACITY,
  ENEMY_KINDS,
  ENEMY_MAX,
  FX_LIFE,
  FX_MAX,
  GO_STEPS,
  HEAVY_HITSTOP,
  HERO_KINDS,
  STAGE_LENGTH,
  TIERS,
  VIEW_H,
  VIEW_W,
  enemyMaxHp,
  px,
} from "./tuning.js";
import { STAGE_1, waveSpawns } from "./stages.js";
import {
  ENEMY_STATES,
  FX_KINDS,
  HERO_STATES,
  type Enemy,
  type Fx,
  type Hero,
  type World,
} from "./world.js";

/**
 * The world as checkpoint fields: nested integer tuples MessagePack carries, and a decoder that checks every field's
 * type, range or enum and every list's length, then each record's own invariants, and returns a whole new world or
 * nothing. Each record is one schema below, written in the order its tuple travels: a new `World` or `Hero` field is
 * one line in its schema (the type checker refuses a schema that misses a field), plus any invariant it brings.
 */
interface Codec<T> {
  encode(value: T): unknown;
  /** The value, or undefined to refuse the whole checkpoint. */
  decode(raw: unknown): T | undefined;
}

const UINT32 = 0xffff_ffff;
const same = (value: unknown): unknown => value;

const int = (low: number, high: number): Codec<number> => ({
  encode: same,
  decode: (raw) =>
    typeof raw === "number" &&
    Number.isInteger(raw) &&
    raw >= low &&
    raw <= high
      ? raw
      : undefined,
});
const oneOf = <T>(values: readonly T[]): Codec<T> => ({
  encode: same,
  decode: (raw) =>
    (values as readonly unknown[]).includes(raw) ? (raw as T) : undefined,
});
const list = <T>(item: Codec<T>, max: number): Codec<T[]> => ({
  encode: (values) => values.map((value) => item.encode(value)),
  decode(raw) {
    if (!Array.isArray(raw) || raw.length > max) return;
    const out: T[] = [];
    for (const each of raw) {
      const value = item.decode(each);
      if (value === undefined) return;
      out.push(value);
    }
    return out;
  },
});
/** A record as a tuple in its schema's order; `valid` checks what spans its fields once each has decoded. */
function record<T extends object>(
  fields: { [K in keyof T]-?: Codec<T[K]> },
  valid: (value: T) => boolean = () => true,
): Codec<T> {
  const keys = Object.keys(fields) as (keyof T)[];
  return {
    encode: (value) => keys.map((key) => fields[key].encode(value[key])),
    decode(raw) {
      if (!Array.isArray(raw) || raw.length !== keys.length) return;
      const out = {} as T;
      for (const [index, key] of keys.entries()) {
        const value = fields[key].decode(raw[index]);
        if (value === undefined) return;
        out[key] = value;
      }
      return valid(out) ? out : undefined;
    },
  };
}
const ascending = <T>(items: readonly T[], key: (item: T) => number) =>
  items.every(
    (item, index) => index === 0 || key(item) > key(items[index - 1]!),
  );

// Bounds with room to spare around what the rules keep: a checkpoint is refused for nonsense, not for a hero a
// later rule moves a little further than this one does.
const ID = int(1, UINT32),
  COUNT = int(0, UINT32),
  X = int(-px(VIEW_W), STAGE_LENGTH + px(VIEW_W)),
  Y = int(0, px(VIEW_H)),
  Z = int(0, px(VIEW_H)),
  SPEED = int(-px(16), px(16)),
  FACING = oneOf([1, -1] as const),
  BUFFER = int(0, BUFFER_STEPS);

// `ENEMY_MAX` bounds the enemy list, and the ones a swing has hit: a hit enemy is not gone within its swing.
const hero = record<Hero>(
  {
    id: ID,
    seat: int(0, CAPACITY - 1),
    kind: oneOf(HERO_KINDS),
    x: X,
    y: Y,
    z: Z,
    vx: SPEED,
    vy: SPEED,
    vz: SPEED,
    facing: FACING,
    state: oneOf(HERO_STATES),
    timer: COUNT,
    held: int(0, INPUT_MASK),
    attackBuf: BUFFER,
    jumpBuf: BUFFER,
    stopUntil: COUNT,
    struck: list(ID, ENEMY_MAX),
    damage: COUNT,
    knockdowns: COUNT,
  },
  (value) => ascending(value.struck, (id) => id),
);

const enemy = record<Enemy>({
  id: ID,
  kind: oneOf(ENEMY_KINDS),
  x: X,
  y: Y,
  z: Z,
  vx: SPEED,
  vz: SPEED,
  facing: FACING,
  hp: COUNT,
  state: oneOf(ENEMY_STATES),
  timer: COUNT,
  stopUntil: COUNT,
  tier: oneOf(TIERS),
  goal: X,
});

const fx = record<Fx>({
  kind: oneOf(FX_KINDS),
  x: X,
  y: Y,
  z: Z,
  born: COUNT,
});

/**
 * The waves. Before the first nothing has begun and the camera is short of its trigger. Once one has, it began no
 * later than now, the camera stands at or past its trigger and short of the next one's (which would have begun it),
 * and no more of its spawns have entered than the party's wave holds: a locked wave holds the camera at its trigger,
 * an unlocked one has all its spawns in. No GO runs longer than one starting now.
 */
function wavesKept(value: World): boolean {
  const latest = STAGE_1.waves[value.wave - 1],
    next = STAGE_1.waves[value.wave];
  if (value.goUntil > value.step + GO_STEPS) return false;
  if (!latest)
    return (
      !value.locked &&
      value.waveStep === 0 &&
      value.spawned === 0 &&
      value.goUntil === 0 &&
      value.camX < next!.at
    );
  const count = waveSpawns(latest, value.heroes.length).length;
  return (
    value.waveStep <= value.step &&
    value.camX >= latest.at &&
    (value.locked
      ? value.camX === latest.at && value.spawned <= count
      : value.spawned === count && (!next || value.camX < next.at))
  );
}

/**
 * Heroes in id order, which is seat order, and enemies in id order, every id below `nextId` and none both a hero's
 * and an enemy's; the ids a swing has hit are enemy ids too, though the enemy may since be gone. No enemy has more
 * hit points than its tier's for this party, no hit-stop runs past the longest a hit starts now, the sparks run
 * oldest first, each born no later than now and not yet past its life, and the waves are as `wavesKept` says.
 */
const world = record<World>(
  {
    seed: COUNT,
    step: COUNT,
    rng: COUNT,
    nextId: ID,
    camX: int(0, CAMERA_END),
    heroes: list(hero, CAPACITY),
    enemies: list(enemy, ENEMY_MAX),
    fx: list(fx, FX_MAX),
    wave: int(0, STAGE_1.waves.length),
    locked: oneOf([false, true]),
    waveStep: COUNT,
    spawned: COUNT,
    goUntil: COUNT,
  },
  (value) => {
    const heroIds = new Set(value.heroes.map((each) => each.id)),
      issued = (id: number) => id < value.nextId,
      enemyId = (id: number) => issued(id) && !heroIds.has(id),
      stopped = (each: Hero | Enemy) =>
        each.stopUntil <= value.step + HEAVY_HITSTOP;
    return (
      ascending(value.heroes, (each) => each.id) &&
      ascending(value.heroes, (each) => each.seat) &&
      ascending(value.enemies, (each) => each.id) &&
      value.heroes.every(
        (each) =>
          issued(each.id) && stopped(each) && each.struck.every(enemyId),
      ) &&
      value.enemies.every(
        (each) =>
          enemyId(each.id) &&
          stopped(each) &&
          each.hp <= enemyMaxHp(each.kind, each.tier, value.heroes.length),
      ) &&
      value.fx.every(
        (each, index) =>
          each.born <= value.step &&
          value.step - each.born < FX_LIFE &&
          (index === 0 || each.born >= value.fx[index - 1]!.born),
      ) &&
      wavesKept(value)
    );
  },
);

export const encodeWorld = (value: World): unknown => world.encode(value);
/** Decodes and validates a world, or returns undefined without touching anything. */
export const decodeWorld = (raw: unknown): World | undefined =>
  world.decode(raw);

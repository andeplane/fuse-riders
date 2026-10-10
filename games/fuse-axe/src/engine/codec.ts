import { INPUT_MASK, LEFT, RIGHT } from "./input.js";
import {
  BUFFER_STEPS,
  CAMERA_END,
  CAPACITY,
  ENEMY_KINDS,
  ENEMY_MAX,
  FLOOR_BOTTOM,
  FLOOR_TOP,
  FX_LIFE,
  FX_MAX,
  GETUP_GRACE,
  GETUP_STEPS,
  GO_STEPS,
  HEAVY_HITSTOP,
  HERO_HP,
  HERO_KINDS,
  IMP_POTS,
  ITEM_KINDS,
  ITEM_LIFE,
  ITEM_MAX,
  JUGGLE_HITS,
  JUGGLE_WINDOW,
  LIVES,
  MAX_POTS,
  RAVAGER,
  RESPAWN_INVULN,
  RUN_GAP,
  RUN_TAP,
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
  IMP_ONLY,
  IMP_STATES,
  type Enemy,
  type Fx,
  type Hero,
  type HeroState,
  type Item,
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
  BUFFER = int(0, BUFFER_STEPS),
  // Where an enemy walks to: `walkTo` and `walkIn` keep a goal on the road and in the floor band, and one past either
  // is a walk that never ends.
  GOAL_X = int(0, STAGE_LENGTH),
  GOAL_Y = int(FLOOR_TOP, FLOOR_BOTTOM);

/** The longest a hero is invulnerable, a double tap's step counts and an idle enemy waits to decide, from any step. */
const INVULN = Math.max(RESPAWN_INVULN, GETUP_STEPS + GETUP_GRACE),
  TAP = Math.max(RUN_TAP, RUN_GAP),
  THINK = Math.max(
    ...TIERS.map((tier) => RAVAGER[tier].think + RAVAGER[tier].jitter),
  );
/**
 * A hero with no hit points is flying from the blow, fallen or out; one fallen or out has none. A hero with no life
 * left is fallen on its last (it goes out after `RESPAWN_DELAY`) or out; one fallen has lost a life, so has fewer
 * than it set out with, and one out has none. One dropping back in has hit points and a life.
 */
const FALLEN: readonly HeroState[] = ["dead", "out"];
const lifeKept = (value: Hero): boolean =>
  value.hp <= HERO_HP[value.kind] &&
  (value.hp > 0 ||
    value.state === "knockdown" ||
    FALLEN.includes(value.state)) &&
  (!FALLEN.includes(value.state) || value.hp === 0) &&
  (value.lives > 0 || FALLEN.includes(value.state)) &&
  (value.state !== "dead" || value.lives < LIVES) &&
  (value.state !== "out" || value.lives === 0);

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
    hp: COUNT,
    lives: int(0, LIVES),
    invulnUntil: COUNT,
    stagger: int(0, JUGGLE_HITS - 1),
    staggerUntil: COUNT,
    tap: oneOf([0, LEFT, RIGHT]),
    tapUntil: COUNT,
    runBuf: BUFFER,
    throws: COUNT,
    pots: int(0, Math.max(...HERO_KINDS.map((kind) => MAX_POTS[kind]))),
  },
  // A double tap waiting as a run knows its direction, and with no tap no step counts for one. No hero holds more
  // pots than its kind's most.
  (value) =>
    ascending(value.struck, (id) => id) &&
    lifeKept(value) &&
    value.pots <= MAX_POTS[value.kind] &&
    (value.runBuf === 0 || value.tap !== 0) &&
    (value.tap !== 0 || value.tapUntil === 0),
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
  goal: GOAL_X,
  goalY: GOAL_Y,
  target: COUNT,
  thinkAt: COUNT,
  holder: COUNT,
  pots: int(0, IMP_POTS),
});
/**
 * A sack imp is of the lowest tier, in an imp's state and going for nobody; every other enemy has no sack and is
 * never in a state only an imp is in.
 */
const sackKept = (value: Enemy): boolean =>
  value.kind === "imp"
    ? value.tier === 0 && IMP_STATES.includes(value.state) && !value.target
    : value.pots === 0 && !IMP_ONLY.includes(value.state);

const fx = record<Fx>({
  kind: oneOf(FX_KINDS),
  x: X,
  y: Y,
  z: Z,
  born: COUNT,
});

/** An item lies on the road and in the floor band, and one that has landed is still. */
const item = record<Item>(
  {
    id: ID,
    kind: oneOf(ITEM_KINDS),
    x: GOAL_X,
    y: GOAL_Y,
    z: Z,
    vz: SPEED,
    born: COUNT,
  },
  (value) => value.z > 0 || value.vz === 0,
);

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
 * The grabs and throws: every enemy `held` is in the hands of a hero mid-grab, and every hero mid-grab holds exactly
 * one; a `thrown` one was thrown by a hero in the world; no other enemy has a holder.
 */
function holdsKept(value: World): boolean {
  const heroes = new Map(value.heroes.map((each) => [each.id, each.state])),
    held = value.enemies.filter((each) => each.state === "held");
  return (
    value.enemies.every((each) =>
      each.state === "held"
        ? heroes.get(each.holder) === "grab"
        : each.state === "thrown"
          ? heroes.has(each.holder)
          : each.holder === 0,
    ) &&
    new Set(held.map((each) => each.holder)).size === held.length &&
    held.length === value.heroes.filter((each) => each.state === "grab").length
  );
}

/**
 * Heroes in id order, which is seat order, and enemies in id order, every id below `nextId` and none both a hero's
 * and an enemy's; the ids a swing has hit are enemy ids too, though the enemy may since be gone, and an enemy goes
 * for a hero in the world or nobody. No enemy has more hit points than its tier's for this party, no hit-stop,
 * invulnerability, run of hits, double tap or idle pause runs past the longest one starting now, the sparks run
 * oldest first, each born no later than now and not yet past its life, the items run in id order, each id issued and
 * no hero's or enemy's, each born no later than now and not yet past its life, no imp is sent before the camera
 * reached its cue, and the sacks, the waves and the grabs are as `sackKept`, `wavesKept` and `holdsKept` say.
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
    items: list(item, ITEM_MAX),
    impsSent: int(0, STAGE_1.imps.length),
  },
  (value) => {
    const heroIds = new Set(value.heroes.map((each) => each.id)),
      enemyIds = new Set(value.enemies.map((each) => each.id)),
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
          issued(each.id) &&
          stopped(each) &&
          each.struck.every(enemyId) &&
          each.invulnUntil <= value.step + INVULN &&
          each.staggerUntil <= value.step + JUGGLE_WINDOW &&
          each.tapUntil <= value.step + TAP,
      ) &&
      value.enemies.every(
        (each) =>
          enemyId(each.id) &&
          stopped(each) &&
          each.hp <= enemyMaxHp(each.kind, each.tier, value.heroes.length) &&
          (each.target === 0 || heroIds.has(each.target)) &&
          each.thinkAt <= value.step + THINK &&
          sackKept(each),
      ) &&
      value.fx.every(
        (each, index) =>
          each.born <= value.step &&
          value.step - each.born < FX_LIFE &&
          (index === 0 || each.born >= value.fx[index - 1]!.born),
      ) &&
      ascending(value.items, (each) => each.id) &&
      value.items.every(
        (each) =>
          enemyId(each.id) &&
          !enemyIds.has(each.id) &&
          each.born <= value.step &&
          value.step - each.born < ITEM_LIFE,
      ) &&
      (value.impsSent === 0 ||
        STAGE_1.imps[value.impsSent - 1]!.at <= value.camX) &&
      wavesKept(value) &&
      holdsKept(value)
    );
  },
);

export const encodeWorld = (value: World): unknown => world.encode(value);
/** Decodes and validates a world, or returns undefined without touching anything. */
export const decodeWorld = (raw: unknown): World | undefined =>
  world.decode(raw);

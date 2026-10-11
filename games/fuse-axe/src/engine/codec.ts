import { INPUT_MASK, LEFT, RIGHT } from "./input.js";
import {
  BUFFER_STEPS,
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
  HITSTOP,
  OGRE,
  HERO_KINDS,
  IMP_POTS,
  ITEM_KINDS,
  ITEM_LIFE,
  ITEM_MAX,
  JUGGLE_HITS,
  JUGGLE_WINDOW,
  LANCER,
  LEAP_VX,
  LIVES,
  MAX_POTS,
  MOUNT_KINDS,
  MOUNT_MAX,
  RAVAGER,
  RESPAWN_INVULN,
  RUN_GAP,
  RUN_TAP,
  SPELLS,
  TAIL_COOL,
  TIERS,
  VIEW_H,
  VIEW_W,
  enemyMaxHp,
  px,
} from "./tuning.js";
import {
  CAMP,
  STAGES,
  planOf,
  waveSpawns,
  type ImpCue,
  type StagePlan,
} from "./stages.js";
import {
  ENEMY_STATES,
  FX_KINDS,
  HERO_STATES,
  IMP_ONLY,
  IMP_STATES,
  LANCER_ONLY,
  LANCER_STATES,
  MOUNT_STATES,
  OGRE_ONLY,
  OGRE_STATES,
  RIDDEN,
  type Enemy,
  type Fx,
  type Hero,
  type HeroState,
  type Item,
  type Mount,
  type Spell,
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
// later rule moves a little further than this one does. Along the road the fields allow the longest stage's (camp's
// among them), and the world holds them to its own stage's (`onRoad`).
const most = (of: (plan: StagePlan) => number) =>
  Math.max(...[...STAGES, CAMP].map(of));
const LENGTH = most((plan) => plan.length),
  /** How far outside the road a figure stands: one walking in from beyond its end, or knocked off its start. */
  BEYOND = px(VIEW_W);
const ID = int(1, UINT32),
  COUNT = int(0, UINT32),
  X = int(-BEYOND, LENGTH + BEYOND),
  Y = int(0, px(VIEW_H)),
  Z = int(0, px(VIEW_H)),
  SPEED = int(-px(16), px(16)),
  FACING = oneOf([1, -1] as const),
  BUFFER = int(0, BUFFER_STEPS),
  // Where an enemy walks to: `walkTo` and `walkIn` keep a goal on the road and in the floor band, and one past either
  // is a walk that never ends.
  GOAL_X = int(0, LENGTH),
  GOAL_Y = int(FLOOR_TOP, FLOOR_BOTTOM);

/** The most pots any hero holds, and the highest level a spell has. */
const POTS = Math.max(...HERO_KINDS.map((kind) => MAX_POTS[kind]));
/** The longest a hero is invulnerable, a double tap's step counts and an idle enemy waits to decide, from any step. */
const INVULN = Math.max(RESPAWN_INVULN, GETUP_STEPS + GETUP_GRACE),
  TAP = Math.max(RUN_TAP, RUN_GAP),
  THINK = Math.max(
    ...[
      ...TIERS.flatMap((tier) => [RAVAGER[tier], LANCER[tier]]),
      OGRE.calm,
      OGRE.rage,
    ].map((each) => each.think + each.jitter),
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
    pots: int(0, POTS),
    magicBuf: BUFFER,
    casts: COUNT,
    magicDamage: COUNT,
  },
  // A double tap waiting as a run knows its direction, and with no tap no step counts for one. No hero holds more
  // pots than its kind's most, and one charging magic has a pot to cast. Magic's damage is part of the damage.
  (value) =>
    ascending(value.struck, (id) => id) &&
    lifeKept(value) &&
    value.pots <= MAX_POTS[value.kind] &&
    (value.state !== "charge" || value.pots > 0) &&
    value.magicDamage <= value.damage &&
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
  poise: COUNT,
  flashUntil: COUNT,
  enraged: oneOf([false, true]),
});
/** The states a lancer is off the floor in: leaping, flying from a blow or from a throw. */
const ALOFT: readonly Enemy["state"][] = ["leap", "knockdown", "thrown"];
/**
 * A sack imp is of the lowest tier, in an imp's state and going for nobody; every other enemy has no sack and is
 * never in a state only an imp is in. An ogre is in an ogre's state; every other enemy is never in a state only an
 * ogre is in, and has no poise, flash or rage of its own. A lancer is in a lancer's state, on the floor unless it is
 * aloft, and leaps no faster than `LEAP_VX`; every other enemy is never in a state only a lancer is in. Only a ravager
 * rides (no other kind's states have `ride`).
 */
const kindKept = (value: Enemy): boolean =>
  (value.kind === "imp"
    ? value.tier === 0 && IMP_STATES.includes(value.state) && !value.target
    : value.pots === 0 && !IMP_ONLY.includes(value.state)) &&
  (value.kind === "ogre"
    ? OGRE_STATES.includes(value.state)
    : !OGRE_ONLY.includes(value.state) &&
      value.poise === 0 &&
      value.flashUntil === 0 &&
      !value.enraged) &&
  (value.kind === "lancer"
    ? LANCER_STATES.includes(value.state) &&
      (value.z === 0 || ALOFT.includes(value.state)) &&
      (value.state !== "leap" || Math.abs(value.vx) <= LEAP_VX)
    : !LANCER_ONLY.includes(value.state));

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

const spell = record<Spell>({ hero: ID, level: int(1, POTS), born: COUNT });

/** A beast stands on the floor, but in a hop or coming down from one its rider was thrown out of (`flee`). */
const mount = record<Mount>(
  {
    id: ID,
    kind: oneOf(MOUNT_KINDS),
    x: X,
    y: Y,
    z: Z,
    vx: SPEED,
    vy: SPEED,
    vz: SPEED,
    facing: FACING,
    state: oneOf(MOUNT_STATES),
    timer: COUNT,
    rider: COUNT,
    goal: GOAL_X,
    coolUntil: COUNT,
  },
  (value) =>
    (value.z === 0 && value.vz === 0) ||
    value.state === "hop" ||
    value.state === "flee",
);

/**
 * The beasts and their riders, both ways: every hero or enemy in `ride` rides exactly one beast and every other none,
 * and a rider stands where its beast does, at its height, facing its way, with no speed of its own. A beast with a
 * rider is in a ridden state (only a hero's hops, only an enemy's walks in) and one without is not; only a hero's
 * walks of its own (`vx`, `vy`); none sweeps again later than one resting now would.
 */
function mountsKept(value: World): boolean {
  const riders = new Map<number, Hero | Enemy>();
  for (const each of [...value.heroes, ...value.enemies])
    if (each.state === "ride") riders.set(each.id, each);
  const heroIds = new Set(value.heroes.map((each) => each.id)),
    ridden = value.mounts.flatMap((each) => (each.rider ? [each.rider] : []));
  return (
    value.mounts.every((each) => {
      const rider = riders.get(each.rider),
        hero = heroIds.has(each.rider);
      return (
        (rider
          ? rider.x === each.x &&
            rider.y === each.y &&
            rider.z === each.z &&
            rider.facing === each.facing &&
            rider.vx === 0 &&
            rider.vz === 0 &&
            RIDDEN.includes(each.state) &&
            (each.state !== "hop" || hero) &&
            (each.state !== "enter" || !hero)
          : each.rider === 0 && !RIDDEN.includes(each.state)) &&
        (hero || (each.vx === 0 && each.vy === 0)) &&
        each.coolUntil <= value.step + TAIL_COOL
      );
    }) &&
    new Set(ridden).size === ridden.length &&
    ridden.length === riders.size
  );
}

/**
 * The spells: one for each hero casting (`cast`) and none for anyone else, in the order they were cast (a step's in
 * hero id order), each of a level its hero's kind has, cast no later than now and still playing.
 */
function spellsKept(value: World): boolean {
  const heroes = new Map(value.heroes.map((each) => [each.id, each]));
  return (
    value.spells.every((each, index) => {
      const hero = heroes.get(each.hero),
        before = value.spells[index - 1],
        level = hero && SPELLS[hero.kind].levels[each.level - 1];
      return (
        hero?.state === "cast" &&
        level !== undefined &&
        each.born <= value.step &&
        value.step - each.born < level.steps &&
        (!before ||
          each.born > before.born ||
          (each.born === before.born && each.hero > before.hero))
      );
    }) &&
    new Set(value.spells.map((each) => each.hero)).size ===
      value.spells.length &&
    value.spells.length ===
      value.heroes.filter((each) => each.state === "cast").length
  );
}

/**
 * The waves. Before the first nothing has begun and the camera is short of its trigger. Once one has, it began no
 * later than now, the camera stands at or past its trigger and short of the next one's (which would have begun it),
 * and no more of its spawns have entered than the party's wave holds: a locked wave holds the camera at its trigger,
 * an unlocked one has all its spawns in. No GO runs longer than one starting now.
 */
function wavesKept(value: World): boolean {
  const { waves } = planOf(value),
    latest = waves[value.wave - 1],
    next = waves[value.wave];
  if (value.goUntil > value.step + GO_STEPS) return false;
  // Camp has no wave, so nothing begins there.
  if (!latest)
    return (
      !value.locked &&
      value.waveStep === 0 &&
      value.spawned === 0 &&
      value.goUntil === 0 &&
      (!next || value.camX < next.at)
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
 * Everything along the road is within the world's own stage: the camera short of its end, no more waves begun or imps
 * sent than it has, every figure and spark no further outside the road than `BEYOND`, and every goal and item on it.
 */
function onRoad(value: World): boolean {
  const { length, cameraEnd, waves, imps } = planOf(value),
    x = (each: { x: number }) => each.x <= length + BEYOND;
  return (
    value.camX <= cameraEnd &&
    value.wave <= waves.length &&
    value.impsSent <= imps.length &&
    value.heroes.every(x) &&
    value.enemies.every((each) => x(each) && each.goal <= length) &&
    value.mounts.every((each) => x(each) && each.goal <= length) &&
    value.fx.every(x) &&
    value.items.every((each) => each.x <= length)
  );
}

/**
 * Heroes in id order, which is seat order, and enemies in id order, every id below `nextId` and none both a hero's
 * and an enemy's; the ids a swing has hit are enemy ids too, though the enemy may since be gone, and an enemy goes
 * for a hero in the world or nobody. No enemy has more hit points than its tier's for this party, no hit-stop,
 * invulnerability, run of hits, double tap or idle pause runs past the longest one starting now, the sparks run
 * oldest first, each born no later than now and not yet past its life, the items run in id order, each id issued and
 * no hero's or enemy's, each born no later than now and not yet past its life and meat only at camp, no imp is sent
 * before the camera reached its cue and its step came, no spell plays at camp, and nothing but sack imps is there
 * (no other enemy, no beast), the beasts run in id order, each id issued and no hero's, enemy's or item's, and the
 * road, the sacks, the waves, the grabs, the spells and the riders are as `onRoad`, `sackKept`, `wavesKept`,
 * `holdsKept`, `spellsKept` and `mountsKept` say.
 */
const world = record<World>(
  {
    seed: COUNT,
    step: COUNT,
    rng: COUNT,
    nextId: ID,
    camX: int(
      0,
      most((plan) => plan.cameraEnd),
    ),
    heroes: list(hero, CAPACITY),
    enemies: list(enemy, ENEMY_MAX),
    fx: list(fx, FX_MAX),
    wave: int(
      0,
      most((plan) => plan.waves.length),
    ),
    locked: oneOf([false, true]),
    waveStep: COUNT,
    spawned: COUNT,
    goUntil: COUNT,
    items: list(item, ITEM_MAX),
    impsSent: int(
      0,
      most((plan) => plan.imps.length),
    ),
    spells: list(spell, CAPACITY),
    stage: int(1, STAGES.length),
    mounts: list(mount, MOUNT_MAX),
    camp: oneOf([false, true]),
  },
  (value) => {
    if (!onRoad(value)) return false;
    const heroIds = new Set(value.heroes.map((each) => each.id)),
      enemyIds = new Set(value.enemies.map((each) => each.id)),
      itemIds = new Set(value.items.map((each) => each.id)),
      issued = (id: number) => id < value.nextId,
      enemyId = (id: number) => issued(id) && !heroIds.has(id),
      stopped = (each: Hero | Enemy) =>
        each.stopUntil <= value.step + HEAVY_HITSTOP,
      sent = (cue: ImpCue) =>
        cue.at <= value.camX && (cue.step ?? 0) <= value.step;
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
          // An ogre's poise counts hit points it has lost since it last fell.
          each.hp + each.poise <=
            enemyMaxHp(each.kind, each.tier, value.heroes.length) &&
          each.flashUntil <= value.step + HITSTOP &&
          (each.target === 0 || heroIds.has(each.target)) &&
          each.thinkAt <= value.step + THINK &&
          kindKept(each),
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
          value.step - each.born < ITEM_LIFE &&
          (each.kind === "pot" || value.camp),
      ) &&
      (value.impsSent === 0 || sent(planOf(value).imps[value.impsSent - 1]!)) &&
      (!value.camp ||
        (value.spells.length === 0 &&
          value.mounts.length === 0 &&
          value.enemies.every((each) => each.kind === "imp"))) &&
      ascending(value.mounts, (each) => each.id) &&
      value.mounts.every(
        (each) =>
          enemyId(each.id) && !enemyIds.has(each.id) && !itemIds.has(each.id),
      ) &&
      wavesKept(value) &&
      holdsKept(value) &&
      spellsKept(value) &&
      mountsKept(value)
    );
  },
);

export const encodeWorld = (value: World): unknown => world.encode(value);
/** Decodes and validates a world, or returns undefined without touching anything. */
export const decodeWorld = (raw: unknown): World | undefined =>
  world.decode(raw);

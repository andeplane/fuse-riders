import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  HERO_KINDS,
  JUMP,
  LEFT,
  RIGHT,
  createWorld,
  spawnEnemy,
  step,
  toView,
  type HeroKind,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import * as Kit from "../src/engine/view-kit.js";

const { px, SUB } = T;
const FULL = T.ENEMY_HP.ravager;
const hero = (world: World, index = 0) => world.heroes[index]!;
const enemy = (world: World, index = 0) => world.enemies[index]!;

/** A hero alone on the road with a ravager at each (dx, dy) px from it. */
function arena(kind: HeroKind, ...at: (readonly [number, number])[]): World {
  let world = createWorld({ seed: 3, heroes: [{ seat: 0, kind }] });
  const { x, y } = hero(world);
  for (const [dx, dy] of at)
    world = spawnEnemy(world, "ravager", x + px(dx), y + px(dy));
  return world;
}
const solo = (kind: HeroKind) =>
  createWorld({ seed: 1, heroes: [{ seat: 0, kind }] });
/** Steps with seat 0 holding each entry's bits in turn. */
const play = (world: World, rows: readonly number[]): World =>
  rows.reduce((w, bits) => step(w, [bits]), world);
const rest = (steps: number) => Array<number>(steps).fill(0);
type Held = (index: number) => readonly number[];
const hold =
  (...bits: number[]): Held =>
  () =>
    bits;
/** Seat 0 presses Attack every other step. */
const mashing: Held = (index) => [index % 2 ? 0 : ATTACK];
/** Steps with `held` (by seat) until `done`, within a bound. */
function until(
  world: World,
  done: (world: World) => boolean,
  held: Held = hold(),
): World {
  for (let index = 0; index < 1000 && !done(world); index++)
    world = step(world, held(index));
  assert.ok(done(world), "never happened");
  return world;
}
const idle = (world: World) => hero(world).state === "idle";
/** One press of Attack, then the whole swing. */
const swingOnce = (world: World) => until(step(world, [ATTACK]), idle);

test("mashing Attack swings two slashes then a finisher, and the hero stands its ground", () => {
  for (const kind of HERO_KINDS) {
    let world = solo(kind);
    const { x, y } = hero(world);
    const seen: string[] = [];
    for (let index = 0; index < 160; index++) {
      world = step(world, [RIGHT | (index % 2 ? 0 : ATTACK)]);
      if (seen.at(-1) !== hero(world).state) seen.push(hero(world).state);
    }
    assert.deepEqual(seen.slice(0, 4), [
      "attack1",
      "attack2",
      "attack3",
      "attack1",
    ]);
    assert.deepEqual([hero(world).x, hero(world).y], [x, y], kind);
  }
});

test("a press in the blade's window chains as the window closes, one in the recovery at once, one in the wind-up is dropped", () => {
  for (const kind of HERO_KINDS) {
    const [first, second] = T.COMBO[kind];
    let world = play(solo(kind), [ATTACK, ...rest(first.startup - 1), ATTACK]);
    world = play(world, rest(first.active - 1));
    assert.equal(hero(world).state, "attack1", kind);
    world = step(world, [0]);
    assert.deepEqual([hero(world).state, hero(world).timer], ["attack2", 0]);
    const lastStep = second.startup + second.active + second.recovery - 1;
    world = play(world, [...rest(lastStep - 1), ATTACK]);
    assert.equal(hero(world).state, "attack3", kind);
    world = until(world, (w) => hero(w).state !== "attack3");
    assert.equal(hero(world).state, "idle");
    // A press during the wind-up is lost: the slash ends in idle, and the next press starts the combo over.
    world = play(solo(kind), [ATTACK, 0, ATTACK]);
    world = until(world, (w) => hero(w).state !== "attack1");
    assert.equal(hero(world).state, "idle", kind);
    assert.equal(hero(step(world, [ATTACK])).state, "attack1");
  }
});

test("a press while the hero is busy waits a few steps: Jump after a slash, Attack after the finisher, either after landing", () => {
  const [first, , last] = T.COMBO.brakka;
  const fresh = solo("brakka");
  const slash = first.startup + first.active + first.recovery;
  // Jump pressed late in a slash's recovery jumps the step the slash ends; pressed a step earlier, it is lost.
  const jumpAt = (t: number) =>
    play(fresh, [ATTACK, ...rest(t - 1), JUMP, ...rest(slash - t)]);
  assert.equal(hero(jumpAt(slash - T.BUFFER_STEPS + 1)).state, "jump");
  assert.equal(hero(jumpAt(slash - T.BUFFER_STEPS)).state, "idle");
  // Attack pressed in the finisher's recovery starts a new combo the step the finisher ends.
  let world = until(fresh, (w) => hero(w).state === "attack3", mashing);
  world = play(world, rest(last.startup + last.active + last.recovery - 3));
  world = play(world, [ATTACK, 0]);
  assert.equal(hero(world).state, "attack3");
  assert.equal(hero(step(world, [0])).state, "attack1");
  // Presses during a landing's recovery act as soon as it ends (they used to be dropped).
  for (const [bits, after] of [
    [JUMP, "jump"],
    [ATTACK, "attack1"],
  ] as const) {
    world = until(step(fresh, [JUMP]), (w) => hero(w).state === "land");
    world = play(world, [...rest(T.LAND_STEPS - 3), bits]);
    assert.equal(hero(world).state, "land");
    world = until(world, (w) => hero(w).state !== "land");
    assert.equal(hero(world).state, after);
  }
});

test("a blade lands only on an enemy lined up in depth, in reach in front of the hero and not overhead", () => {
  const slash = T.COMBO.brakka[0].damage;
  const hp = (dx: number, dy: number) =>
    enemy(swingOnce(arena("brakka", [dx, dy]))).hp;
  for (const [dx, dy] of [
    [20, 0],
    [20, 4],
    [20, -4],
  ] as const)
    assert.equal(hp(dx, dy), FULL - slash, `${dx},${dy} hits`);
  for (const [dx, dy] of [
    [20, 10],
    [20, -10],
    [-30, 0],
    [80, 0],
  ] as const)
    assert.equal(hp(dx, dy), FULL, `${dx},${dy} misses`);
  const overhead = arena("brakka", [20, 0]);
  overhead.enemies[0]!.z = px(60);
  assert.equal(enemy(swingOnce(overhead)).hp, FULL);
  // Turned to the left, the hero hits what is on its left, and nudges it further left.
  const left = swingOnce(play(arena("brakka", [-22, 0]), [LEFT, 0]));
  assert.deepEqual([enemy(left).hp, enemy(left).facing], [FULL - slash, 1]);
  assert.ok(enemy(left).x < hero(left).x - px(22));
});

test("Rhea reaches furthest and Gorm least", () => {
  const reach = (kind: HeroKind) => {
    let furthest = 0;
    for (let dx = 10; dx <= 70; dx++)
      if (enemy(swingOnce(arena(kind, [dx, 0]))).hp < FULL) furthest = dx;
    return furthest;
  };
  const [brakka, rhea, gorm] = HERO_KINDS.map(reach);
  assert.ok(rhea! > brakka! && brakka! > gorm!, `${[brakka, rhea, gorm]}`);
});

test("a swing hits each enemy in reach once however long its window, and every one it reaches", () => {
  const [first] = T.COMBO.gorm;
  let world = arena("gorm", [16, 0], [24, 3], [20, 12]);
  world = play(world, [ATTACK, ...rest(first.startup - 1)]);
  const before = JSON.stringify(world);
  const struck = step(world, [0]);
  assert.equal(JSON.stringify(world), before, "a step leaves its input alone");
  const after = struck.enemies.map((e) => e.hp);
  assert.deepEqual(after, [FULL - first.damage, FULL - first.damage, FULL]);
  assert.deepEqual(
    struck.fx.map((fx) => [fx.kind, fx.born]),
    [
      ["hit", struck.step],
      ["hit", struck.step],
    ],
  );
  world = until(struck, idle);
  assert.deepEqual(
    world.enemies.map((e) => e.hp),
    after,
  );
  assert.ok(world.fx.every((fx) => fx.born === struck.step));
  assert.deepEqual(
    [hero(world).damage, hero(world).knockdowns],
    [2 * first.damage, 0],
  );
});

test("a hit holds attacker and target still for a few steps, a knockdown longer, and nobody else", () => {
  const pair = createWorld({
    seed: 3,
    heroes: [
      { seat: 0, kind: "brakka" },
      { seat: 1, kind: "rhea" },
    ],
  });
  const start = spawnEnemy(
    pair,
    "ravager",
    hero(pair).x + px(18),
    hero(pair).y,
  );
  /** Steps until a hit lands, then counts the steps attacker and target hold still while the other hero walks. */
  const stops = (world: World, held: Held) => {
    const sparks = world.fx.length;
    world = until(world, (w) => w.fx.length > sparks, held);
    const [h, e] = [hero(world).timer, enemy(world).timer];
    const heroTimers: number[] = [],
      enemyTimers: number[] = [];
    for (let index = 0; index < 16; index++) {
      const walker = hero(world, 1).x;
      world = step(world, [0, RIGHT]);
      assert.ok(hero(world, 1).x > walker, "the other hero walks on");
      heroTimers.push(hero(world).timer);
      enemyTimers.push(enemy(world).timer);
      assert.equal(toView(world).enemies[0]!.flash, enemy(world).timer === e);
    }
    const heroStop = heroTimers.findIndex((t) => t !== h);
    assert.equal(
      heroStop,
      enemyTimers.findIndex((t) => t !== e),
    );
    return heroStop;
  };
  const slash = stops(start, () => [ATTACK]);
  const finisher = until(start, (w) => hero(w).state === "attack3", mashing);
  const heavy = stops(finisher, hold());
  assert.ok(slash > 0 && heavy > slash, `${slash} then ${heavy}`);
});

test("the finisher knocks an enemy up and away, it lies down, gets up invulnerable, then stands", () => {
  const dealt: number[] = [];
  for (const kind of HERO_KINDS) {
    let world = arena(kind, [18, 0]);
    const seen: string[] = [],
      sparks = new Set<string>();
    let peak = 0,
      launch = 0,
      landing = 0;
    for (let i = 0; i < 1000 && enemy(world).state !== "getup"; i++) {
      const done = hero(world).state === "attack3" || seen.includes("down");
      world = step(world, [!done && i % 2 === 0 ? ATTACK : 0]);
      const e = enemy(world);
      if (seen.at(-1) !== e.state) {
        seen.push(e.state);
        if (e.state === "knockdown") launch = e.x;
        if (e.state === "down") landing = e.x;
      }
      peak = Math.max(peak, e.z);
      for (const fx of world.fx) sparks.add(fx.kind);
    }
    assert.deepEqual(seen, ["idle", "hurt", "knockdown", "down", "getup"]);
    assert.deepEqual([...sparks].sort(), ["heavy", "hit"]);
    assert.ok(peak > px(8), `${kind} flies ${peak / SUB} px high`);
    assert.ok(landing - launch > px(16), `${kind} flies away`);
    const hp = enemy(world).hp;
    dealt.push(FULL - hp);
    assert.deepEqual(
      [hero(world).damage, hero(world).knockdowns],
      [FULL - hp, 1],
    );
    // Stand the hero right behind it: while it gets up swings pass through it, and once it stands they land.
    world.heroes[0]!.x = enemy(world).x - px(16);
    for (let index = 0; enemy(world).state === "getup"; index++) {
      world = step(world, mashing(index));
      assert.equal(enemy(world).hp, hp);
    }
    assert.equal(enemy(world).state, "idle");
    until(world, (w) => enemy(w).hp < hp, mashing);
  }
  const [brakka, rhea, gorm] = dealt;
  assert.ok(rhea! < brakka! && brakka! < gorm!, `combo damage ${dealt}`);
});

test("the hit that takes the last hp knocks down for good: the enemy lands dead, blinks and is gone", () => {
  let world = arena("rhea", [20, 0]);
  world.enemies[0]!.hp = 3;
  world = until(step(world, [ATTACK]), (w) => w.fx.length > 0);
  assert.deepEqual(
    world.fx.map((fx) => fx.kind),
    ["ko"],
  );
  assert.deepEqual([enemy(world).state, enemy(world).hp], ["knockdown", 0]);
  assert.deepEqual([hero(world).damage, hero(world).knockdowns], [3, 1]);
  world = until(world, (w) => enemy(w).state === "dead");
  assert.equal(enemy(world).z, 0);
  const fell = world.step;
  world = until(world, (w) => w.enemies.length === 0);
  assert.equal(world.step - fell, Kit.DEAD_STEPS);
});

test("heroes never hit each other", () => {
  const pair = createWorld({
    seed: 3,
    heroes: [
      { seat: 0, kind: "gorm" },
      { seat: 1, kind: "brakka" },
    ],
  });
  pair.heroes[1]!.x = hero(pair).x + px(16);
  pair.heroes[1]!.y = hero(pair).y;
  let world = pair;
  for (let index = 0; index < 120; index++) world = step(world, mashing(index));
  assert.deepEqual(hero(world, 1), { ...hero(pair, 1), timer: 120 });
  assert.deepEqual([hero(world).damage, world.fx], [0, []]);
});

test("sparks age, are dropped after their life, and the world keeps only the newest", () => {
  const crowd = Array.from(
    { length: T.FX_MAX + 4 },
    (_, index) => [10 + index / 2, 0] as const,
  );
  let world = arena("brakka", ...crowd);
  world = until(step(world, [ATTACK]), (w) => w.fx.length > 0);
  assert.equal(hero(world).damage, crowd.length * T.COMBO.brakka[0].damage);
  assert.deepEqual(
    world.fx.map((fx) => fx.x),
    world.enemies.slice(4).map((e) => e.x - T.ENEMY_HALF_W),
  );
  const born = world.step;
  assert.ok(toView(world).fx.every((fx) => fx.age === 0));
  world = step(world, [0]);
  assert.ok(toView(world).fx.every((fx) => fx.age === 1));
  world = until(world, (w) => w.fx.length === 0);
  assert.equal(world.step - born, Kit.FX_LIFE);
});

test("enemies spawn in id order on the floor band and idle facing the nearest hero", () => {
  const base = solo("rhea");
  assert.deepEqual(base.enemies, []);
  const before = JSON.stringify(base);
  let world = spawnEnemy(base, "ravager", px(200), px(400));
  world = spawnEnemy(world, "ravager", px(10), 0);
  world = spawnEnemy(world, "ravager", hero(base).x, px(150));
  assert.equal(JSON.stringify(base), before);
  assert.deepEqual(
    world.enemies.map((e) => [e.id, e.y, e.facing, e.hp, e.state]),
    [
      [2, T.FLOOR_BOTTOM, -1, FULL, "idle"],
      [3, T.FLOOR_TOP, 1, FULL, "idle"],
      [4, px(150), -1, FULL, "idle"],
    ],
  );
  assert.equal(world.nextId, 5);
  world = until(world, (w) => hero(w).x > enemy(w).x, hold(RIGHT));
  assert.deepEqual(
    world.enemies.map((e) => e.facing),
    [1, 1, 1],
  );
  const alone = spawnEnemy(
    createWorld({ seed: 1, heroes: [] }),
    "ravager",
    0,
    0,
  );
  assert.equal(enemy(step(alone, [])).facing, -1);
});

test("the view shows the swing, each enemy's anim, hp and flash, and each spark's age", () => {
  let world = arena("gorm", [16, 0]);
  world = until(step(world, [ATTACK]), (w) => w.fx.length > 0);
  const view = toView(world);
  assert.equal(view.heroes[0]!.anim, "attack1");
  const e = enemy(world);
  assert.deepEqual(view.enemies, [
    {
      id: 2,
      kind: "ravager",
      x: Math.floor(e.x / SUB),
      y: Math.floor(e.y / SUB),
      z: 0,
      facing: -1,
      anim: "hurt",
      animStep: 0,
      hp: FULL - T.COMBO.gorm[0].damage,
      maxHp: FULL,
      flash: true,
    },
  ]);
  const [spark] = view.fx;
  assert.equal(spark!.kind, "hit");
  assert.ok(Number.isInteger(spark!.x + spark!.y + spark!.z));
  assert.ok(spark!.z > 0 && spark!.age === 0);
  assert.deepEqual(Kit.HERO_STATES.slice(4), ["attack1", "attack2", "attack3"]);
  assert.deepEqual(Kit.ENEMY_STATES, [
    "idle",
    "hurt",
    "knockdown",
    "down",
    "getup",
    "dead",
  ]);
  assert.deepEqual(Kit.FX_KINDS, ["hit", "heavy", "ko"]);
  for (const kind of Kit.HERO_KINDS)
    assert.deepEqual(
      Kit.SWING_STEPS[kind].map((s) => s.startup + s.active + s.recovery),
      T.COMBO[kind].map((s) => s.startup + s.active + s.recovery),
    );
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  MAGIC,
  RIGHT,
  STAGE_1,
  botInput,
  createWorld,
  decodeWorld,
  encodeWorld,
  spawnEnemy,
  stageCleared,
  step,
  stepTick,
  toView,
  type Enemy,
  type Hero,
  type HeroKind,
  type World,
} from "../src/engine/index.js";
import { REACT, REACT_SPREAD } from "../src/engine/bot.js";
import { quakeAt } from "../src/engine/ogre.js";
import * as T from "../src/engine/tuning.js";

const { px } = T;
const WAVES = STAGE_1.waves;
const party = (...kinds: HeroKind[]) =>
  createWorld({ seed: 5, heroes: kinds.map((kind, seat) => ({ seat, kind })) });
const hero = (world: World, index = 0) => world.heroes[index]!;
const ogres = (world: World) => world.enemies.filter((e) => e.kind === "ogre");
const patchHero = (world: World, index: number, change: Partial<Hero>) => ({
  ...world,
  heroes: world.heroes.map((h, i) => (i === index ? { ...h, ...change } : h)),
});
const patchEnemy = (world: World, index: number, change: Partial<Enemy>) => ({
  ...world,
  enemies: world.enemies.map((e, i) => (i === index ? { ...e, ...change } : e)),
});
/** An ogre `dx` px along the road from the first hero (level with it), facing it, with `change` made to it. */
function ogre(world: World, dx: number, change: Partial<Enemy> = {}): World {
  const next = spawnEnemy(world, "ogre", hero(world).x + px(dx), hero(world).y);
  const facing = dx > 0 ? -1 : 1;
  return patchEnemy(next, next.enemies.length - 1, { facing, ...change });
}
function run(world: World, steps: number, held: readonly number[] = []) {
  for (let index = 0; index < steps; index++) world = step(world, held);
  return world;
}
const FULL = T.enemyMaxHp("ogre", 0, 1);
const kept = (world: World) =>
  assert.deepEqual(decodeWorld(structuredClone(encodeWorld(world))), world);

/** The party at the village gate, the twins' wave begun on this step. */
function gate(...kinds: HeroKind[]): World {
  const start = party(...kinds);
  return step(
    {
      ...start,
      wave: WAVES.length - 1,
      camX: T.CAMERA_END,
      heroes: start.heroes.map((h) => ({ ...h, x: h.x + T.CAMERA_END })),
      impsSent: STAGE_1.imps.length,
    },
    [],
  );
}

test("an ogre is big, slow and tough: its hit points grow with the party, not its tier, and nobody throws it", () => {
  assert.ok(T.ENEMY_BODY.ogre.half >= (3 * T.ENEMY_HALF_W) / 2);
  assert.ok(T.ENEMY_BODY.ogre.height >= (3 * T.ENEMY_HEIGHT) / 2);
  assert.ok(T.OGRE.calm.walk.x < T.RAVAGER[0].walk.x);
  assert.ok(T.OGRE.calm.windup > T.RAVAGER[0].windup);
  assert.ok(T.OGRE.rage.windup < T.OGRE.calm.windup);
  assert.equal(T.THROWABLE.ogre, false);
  assert.ok(T.BOSS.ogre && !T.BOSS.ravager);
  const hp = [1, 2, 3, 4, 5].map((n) => T.enemyMaxHp("ogre", 0, n));
  assert.deepEqual(hp, [150, 187, 225, 262, 300]);
  for (const tier of T.TIERS)
    assert.equal(T.enemyMaxHp("ogre", tier, 3), hp[2]);
  // A staggered ogre in reach is struck, not grabbed.
  let world = ogre(party("brakka"), 16, { state: "stagger" });
  world = step(world, [ATTACK | RIGHT]);
  assert.equal(hero(world).state, "attack1");
  assert.equal(world.enemies[0]!.holder, 0);
});

test("the slam is telegraphed by a long wind-up, then lands on a wide area in front", () => {
  // Brakka in front just inside the slam's lane, Rhea in front just outside it, Gorm close behind.
  let world = ogre(party("brakka", "rhea", "gorm"), 30, {
    state: "windup",
    target: 1,
  });
  const { x, y } = world.enemies[0]!;
  world = patchHero(world, 0, { x: x - px(20), y: y + px(9) });
  world = patchHero(world, 1, { x: x - px(30), y: y - px(11) });
  world = patchHero(world, 2, { x: x + px(12), y });
  const full = world.heroes.map((h) => h.hp);
  world = run(world, T.OGRE.calm.windup - 1);
  assert.equal(world.enemies[0]!.state, "windup");
  assert.deepEqual(
    world.heroes.map((h) => h.hp),
    full,
  );
  world = step(world, []);
  assert.equal(world.enemies[0]!.state, "slam");
  assert.equal(hero(world).hp, full[0]! - T.OGRE.calm.damage);
  assert.equal(hero(world).state, "knockdown", "every blow of its knocks down");
  assert.deepEqual([hero(world, 1).hp, hero(world, 2).hp], [full[1], full[2]]);
});

test("the slam's shockwave runs on along the floor in the ogre's lane: stepped out of or jumped, it misses", () => {
  const start = ogre(party("brakka", "rhea"), 90, { state: "slam", timer: 1 });
  const { x, y } = start.enemies[0]!;
  // Brakka in the lane 80 px in front; Rhea as far, out of the lane but inside the slam's.
  let world = patchHero(start, 0, { x: x - px(80), y });
  world = patchHero(world, 1, { x: x - px(80), y: y + T.LANE + px(1) });
  // Not yet: the front reaches Brakka's body once it has run past the slam's reach.
  const reaches = Math.ceil(
    (px(80) - T.HERO_HALF_W - quakeAt(0)) / T.QUAKE_SPEED,
  );
  world = run(world, reaches - 2);
  assert.equal(hero(world).hp, T.HERO_HP.brakka);
  world = run(world, 2);
  assert.equal(hero(world).hp, T.HERO_HP.brakka - T.QUAKE_DAMAGE);
  assert.equal(hero(world).state, "knockdown");
  world = run(world, T.QUAKE_STEPS);
  assert.equal(hero(world, 1).hp, T.HERO_HP.rhea);
  // In the air as it passes, Brakka is not touched.
  const jumping = patchHero(start, 0, {
    x: x - px(80),
    y,
    state: "jump",
    z: px(4),
    vz: T.JUMP_VZ,
  });
  assert.equal(hero(run(jumping, T.QUAKE_STEPS)).hp, T.HERO_HP.brakka);
  // The ogre recovers after the hammer's follow-through, standing open.
  const after = run(start, T.SLAM_STEPS);
  assert.equal(after.enemies[0]!.state, "recover");
});

test("a hero close behind an ogre as it decides draws the sweep, which knocks it away", () => {
  let world = ogre(party("brakka", "gorm"), -20, {
    state: "idle",
    facing: -1,
    thinkAt: 0,
  });
  // Gorm stands far off in front, Brakka close behind.
  world = patchHero(world, 1, { x: world.enemies[0]!.x - px(90) });
  world = step(world, []);
  assert.equal(world.enemies[0]!.state, "sweep");
  world = run(world, T.SWEEP_WINDUP - 1);
  assert.equal(hero(world).hp, T.HERO_HP.brakka);
  world = step(world, []);
  assert.equal(hero(world).hp, T.HERO_HP.brakka - T.SWEEP_DAMAGE);
  assert.equal(hero(world).state, "knockdown");
  assert.ok(hero(world).vx > 0, "away from the ogre");
  assert.equal(hero(world, 1).hp, T.HERO_HP.gorm);
  world = run(world, T.SWEEP_STEPS - T.SWEEP_WINDUP + T.HEAVY_HITSTOP);
  assert.equal(world.enemies[0]!.state, "recover");
});

test("super armour: a slash flashes it without stopping it, a heavy blow staggers it only while it stands or walks, and enough damage lets one knock it down", () => {
  // Brakka's first slash lands on an ogre winding up: hit points and poise, a flash, and the wind-up goes on.
  let world = ogre(party("brakka"), 30, { state: "windup", target: 1 });
  world = run(step(world, [ATTACK]), T.COMBO.brakka[0].startup);
  let big = world.enemies[0]!;
  assert.equal(big.hp, FULL - T.COMBO.brakka[0].damage);
  assert.equal(big.poise, T.COMBO.brakka[0].damage);
  assert.deepEqual(
    [big.state, big.timer, big.vx],
    ["windup", 1 + T.COMBO.brakka[0].startup, 0],
  );
  assert.ok(toView(world).enemies[0]!.flash);
  assert.equal(world.step > big.stopUntil, true, "it does not hold still");

  // The finisher's blade out, against an ogre in each state.
  const finisher = (state: Enemy["state"], poise = 0) => {
    const swing = T.COMBO.brakka[2];
    const at = ogre(party("brakka"), 30, { state, target: 1, poise });
    return step(
      patchHero(at, 0, { state: "attack3", timer: swing.startup - 1 }),
      [],
    );
  };
  for (const state of ["idle", "walk"] as const) {
    big = finisher(state).enemies[0]!;
    assert.deepEqual([big.state, big.hp], ["stagger", FULL - 12], state);
  }
  for (const state of [
    "windup",
    "slam",
    "sweep",
    "recover",
    "stagger",
  ] as const)
    assert.equal(finisher(state).enemies[0]!.state, state, state);
  // Once it has taken a quarter of its hit points since it last fell, the heavy blow knocks it down, whole again.
  const broken = finisher("windup", Math.ceil(FULL / T.POISE) - 12);
  assert.deepEqual(
    [broken.enemies[0]!.state, broken.enemies[0]!.poise],
    ["knockdown", 0],
  );
  assert.equal(hero(broken).knockdowns, 1);
  // A slash never does, however much it has taken.
  world = ogre(party("brakka"), 30, { state: "windup", poise: FULL / 2 });
  world = run(step(world, [ATTACK]), T.COMBO.brakka[0].startup);
  assert.equal(world.enemies[0]!.state, "windup");
  // Staggered, it decides afresh as soon as the stagger is over.
  world = run(finisher("walk"), T.HITSTOP + T.STAGGER_STEPS);
  assert.notEqual(world.enemies[0]!.state, "stagger");
});

test("a spell knocks an ogre down but takes no more than a boss's share, a thrown body does not topple it", () => {
  let world = ogre(patchHero(party("rhea"), 0, { pots: 6 }), 60, {
    state: "windup",
  });
  world = spawnEnemy(world, "ravager", hero(world).x - px(40), hero(world).y);
  world = step(step(world, [MAGIC]), []);
  world = run(world, T.SPELLS.rhea.levels[5]!.hit);
  const [big, small] = world.enemies;
  assert.equal(big!.hp, FULL - Math.floor((FULL * T.BOSS_SHARE) / T.SHARE));
  assert.equal(big!.state, "knockdown");
  assert.ok(
    small!.hp < T.enemyMaxHp("ravager", 0, 1) / 4,
    "a grunt takes it all",
  );
  // A ravager thrown into an ogre flies on past it.
  let thrown = ogre(party("brakka"), -10, { state: "idle", thinkAt: 999 });
  thrown = spawnEnemy(
    thrown,
    "ravager",
    hero(thrown).x + px(14),
    hero(thrown).y,
  );
  thrown = patchEnemy(thrown, 1, { state: "hurt", timer: 1 });
  thrown = run(step(thrown, [ATTACK | RIGHT]), T.GRAB_STEPS + 10, [RIGHT]);
  assert.equal(thrown.enemies[0]!.hp, FULL);
});

test("the twins enter from both sides in their own colours, the boss bar shows them, a bigger party meets ravagers too", () => {
  const solo = gate("brakka");
  assert.deepEqual([solo.wave, solo.locked], [WAVES.length, true]);
  const [a, b] = ogres(solo);
  assert.ok(a!.x < solo.camX && b!.x > solo.camX + px(T.VIEW_W));
  assert.deepEqual(
    [a, b].map((e) => [e!.state, e!.tier, e!.hp]),
    [
      ["enter", 0, FULL],
      ["enter", 1, FULL],
    ],
  );
  const view = toView(solo);
  assert.deepEqual(view.boss, { kind: "ogre", hp: 2 * FULL, maxHp: 2 * FULL });
  assert.ok(view.enemies.every((e) => e.boss && !e.enraged));
  assert.equal(toView(party("brakka")).boss, null);
  // Three heroes: the twins with more hit points, and two ravagers after them.
  let trio = gate("brakka", "rhea", "gorm");
  trio = run(trio, 200);
  assert.deepEqual(
    trio.enemies.map((e) => e.kind),
    ["ogre", "ogre", "ravager", "ravager"],
  );
  assert.equal(toView(trio).boss!.maxHp, 2 * T.enemyMaxHp("ogre", 0, 3));
  kept(trio);
});

test("when one twin falls the other enrages and winds up faster; both fallen clear the stage", () => {
  let world = run(gate("brakka"), 120);
  world = patchEnemy(world, 0, { hp: 0, state: "knockdown", z: px(10) });
  world = step(world, []);
  assert.deepEqual(
    ogres(world).map((e) => e.enraged),
    [false, true],
  );
  assert.ok(toView(world).enemies[1]!.enraged);
  assert.equal(toView(world).boss!.hp, ogres(world)[1]!.hp);
  // Enraged, the slam lands after the shorter wind-up.
  let angry = patchEnemy(world, 1, { state: "windup", timer: 0 });
  angry = run(angry, T.OGRE.rage.windup);
  assert.equal(ogres(angry)[1]!.state, "slam");
  // Both lying fallen and blinked out, the screen unlocks and the stage is won.
  const done = (w: World) =>
    w.enemies.map((e) => ({
      ...e,
      hp: 0,
      state: "dead" as const,
      timer: T.DEAD_STEPS,
    }));
  world = step({ ...world, enemies: done(world) }, []);
  assert.ok(stageCleared(world));
  assert.equal(toView(world).boss, null);
});

test("a bot steps out of a slam it has seen, then strikes the ogre while it recovers", () => {
  const seen = REACT + REACT_SPREAD;
  let world = ogre(party("brakka"), 34, {
    state: "windup",
    timer: seen,
    target: 1,
  });
  const tick = (w: World) => stepTick(w, [botInput(w, 1)]);
  while (world.enemies[0]!.state === "windup") world = tick(world);
  assert.equal(hero(world).hp, T.HERO_HP.brakka, "the slam missed");
  while (world.enemies[0]!.state !== "idle" && world.step < 400)
    world = tick(world);
  assert.equal(hero(world).hp, T.HERO_HP.brakka, "so did its shockwave");
  assert.ok(
    world.enemies[0]!.hp < FULL,
    "it struck the ogre while it was open",
  );
});

test("a rollback or a checkpoint mid-wind-up, mid-slam, mid-sweep and mid-stagger, an ogre enraged, replays to the same world", () => {
  // The twins in: one about to decide with Gorm close behind it, so the fight opens with a sweep; the other walking
  // into Brakka's finisher, so it opens with a stagger too.
  const entered = run(gate("brakka", "rhea", "gorm"), 150);
  const [a, b] = entered.enemies;
  let opening = patchEnemy(entered, 0, {
    state: "idle",
    facing: -1,
    thinkAt: 0,
  });
  opening = patchHero(opening, 2, { x: a!.x + px(20), y: a!.y });
  opening = patchEnemy(opening, 1, { state: "walk", facing: -1, target: 1 });
  opening = patchHero(opening, 0, {
    ...{ x: b!.x - px(30), y: b!.y, facing: 1 },
    ...{ state: "attack3", timer: T.COMBO.brakka[2].startup - 1 },
  });
  const trail = [opening];
  const play = (w: World) =>
    stepTick(
      w,
      w.heroes.map((h) => botInput(w, h.id)),
    );
  while (trail.length < 900 && !stageCleared(trail.at(-1)!))
    trail.push(play(trail.at(-1)!));
  const end = trail.at(-1)!;
  const first = (found: (e: Enemy) => boolean) => {
    const cut = trail.findIndex((w) => ogres(w).some(found));
    assert.ok(cut > 0, String(found));
    return cut;
  };
  for (const cut of [
    first((e) => e.state === "windup" && e.timer > 0),
    first((e) => e.state === "slam" && e.timer > 2),
    first((e) => e.state === "sweep"),
    first((e) => e.state === "stagger"),
    first((e) => e.poise > 0 && e.flashUntil >= 0),
    first((e) => e.enraged),
  ]) {
    for (const from of [
      trail[cut]!,
      decodeWorld(structuredClone(encodeWorld(trail[cut]!)))!,
    ]) {
      let world = from;
      for (let i = cut; i < trail.length - 1; i++) world = play(world);
      assert.deepEqual(world, end);
    }
  }
});

test("the checkpoint refuses an ogre's fields where the rules never put them", () => {
  let world = ogre(party("brakka"), 30, {
    state: "slam",
    timer: 3,
    poise: 9,
    hp: FULL - 9,
  });
  world = spawnEnemy(world, "ravager", hero(world).x - px(30), hero(world).y);
  world = {
    ...world,
    step: 10,
    enemies: world.enemies.map((e, i) => (i ? e : { ...e, flashUntil: 12 })),
  };
  kept(world);
  const refused = (
    index: number,
    change: Partial<Enemy> | Record<string, unknown>,
  ) =>
    decodeWorld(
      encodeWorld(patchEnemy(world, index, change as Partial<Enemy>)),
    );
  for (const [what, index, change] of [
    ["an ogre reeling", 0, { state: "hurt" }],
    ["an ogre held", 0, { state: "held" }],
    ["an ogre's poise past what it lost", 0, { poise: 10 }],
    ["an ogre flashing too long", 0, { flashUntil: 10 + T.HITSTOP + 1 }],
    ["rage as a number", 0, { enraged: 1 }],
    ["a ravager slamming", 1, { state: "slam" }],
    ["a ravager staggered", 1, { state: "stagger" }],
    ["a ravager with poise", 1, { poise: 1, hp: 30 }],
    ["a ravager flashing", 1, { flashUntil: 10 }],
    ["a ravager enraged", 1, { enraged: true }],
  ] as const)
    assert.equal(refused(index, change), undefined, what);
});

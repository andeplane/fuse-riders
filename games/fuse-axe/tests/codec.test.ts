import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  DOWN,
  JUMP,
  RIGHT,
  createWorld,
  decodeWorld,
  encodeWorld,
  spawnEnemy,
  step,
  stepTick,
  type World,
} from "../src/engine/index.js";
import {
  BUFFER_STEPS,
  CAMERA_END,
  ENEMY_MAX,
  FX_LIFE,
  FX_MAX,
  HEAVY_HITSTOP,
  STAGE_LENGTH,
  enemyMaxHp,
  px,
} from "../src/engine/tuning.js";

/** A rust ravager's full hit points against two heroes, and an ash one's. */
const RUST = enemyMaxHp("ravager", 1, 2),
  ASH = enemyMaxHp("ravager", 0, 2);

/** Three heroes well down the road: two walking, one in the air, the camera moved on. */
function busy(): World {
  let world = createWorld({
    seed: 9,
    heroes: [
      { seat: 0, kind: "brakka" },
      { seat: 2, kind: "rhea" },
      { seat: 4, kind: "gorm" },
    ],
  });
  for (let tick = 0; tick < 200; tick++)
    world = stepTick(world, [
      RIGHT,
      0,
      RIGHT | DOWN,
      0,
      tick === 197 ? JUMP : 0,
    ]);
  return world;
}

test("a world survives the checkpoint whole, and steps on from it identically", () => {
  const world = busy();
  assert.ok(world.camX > 0);
  assert.deepEqual(
    world.heroes.map((hero) => hero.state),
    ["walk", "walk", "jump"],
  );
  const back = decodeWorld(structuredClone(encodeWorld(world)));
  assert.deepEqual(back, world);
  const held = [RIGHT, 0, JUMP, 0, DOWN];
  assert.deepEqual(stepTick(back!, held), stepTick(world, held));
  const empty = createWorld({ seed: 1, heroes: [] });
  assert.deepEqual(decodeWorld(encodeWorld(empty)), empty);
});

test("a corrupt, oversized or out-of-range world is refused whole", () => {
  const good = encodeWorld(busy()) as unknown[];
  const broken = (change: (fields: unknown[]) => void) => {
    const copy = structuredClone(good);
    change(copy);
    return decodeWorld(copy);
  };
  const heroes = (f: unknown[]) => f[5] as unknown[][];
  const hero = (f: unknown[], index = 0) => heroes(f)[index]!;
  assert.ok(broken(() => {}));
  for (const raw of [null, "world", {}, 7])
    assert.equal(decodeWorld(raw), undefined, String(raw));
  for (const [what, change] of [
    ["a field short", (f) => f.pop()],
    ["a field over", (f) => f.push(0)],
    ["a fractional seed", (f) => (f[0] = 1.5)],
    ["a negative step", (f) => (f[1] = -1)],
    ["a step past 32 bits", (f) => (f[1] = 2 ** 32)],
    ["a random state as text", (f) => (f[2] = "1")],
    ["no next id", (f) => (f[3] = 0)],
    ["a camera past the stage", (f) => (f[4] = CAMERA_END + 1)],
    ["a camera behind it", (f) => (f[4] = -1)],
    ["heroes not a list", (f) => (f[5] = {})],
    ["six heroes", (f) => (f[5] = Array(6).fill(hero(f)))],
    ["a hero not a tuple", (f) => (heroes(f)[0] = 7 as never)],
    ["a hero field short", (f) => hero(f).pop()],
    ["an unknown hero", (f) => (hero(f)[2] = "wizard")],
    ["a sixth seat", (f) => (hero(f)[1] = 5)],
    ["a hero off the road", (f) => (hero(f)[3] = STAGE_LENGTH + px(400))],
    ["a hero below the screen", (f) => (hero(f)[4] = px(180) + 1)],
    ["a hero under the floor", (f) => (hero(f)[5] = -1)],
    ["a hero too fast", (f) => (hero(f)[6] = px(17))],
    ["a hero facing nowhere", (f) => (hero(f)[9] = 0)],
    ["an unknown state", (f) => (hero(f)[10] = "fly")],
    ["a negative timer", (f) => (hero(f)[11] = -1)],
    ["unknown held bits", (f) => (hero(f)[12] = 128)],
    ["NaN", (f) => (hero(f)[3] = NaN)],
    ["heroes out of order", (f) => heroes(f).reverse()],
    ["a repeated seat", (f) => (hero(f, 1)[1] = hero(f)[1])],
    ["a repeated id", (f) => (hero(f, 1)[0] = hero(f)[0])],
    ["an id not yet issued", (f) => (f[3] = hero(f, 2)[0])],
  ] as [string, (fields: unknown[]) => void][])
    assert.equal(broken(change), undefined, what);
});

/** The bits for a world's next step: seat 0 presses Attack every other step, seat 1 every third from step 41 on. */
const mash = (world: World) => {
  const now = world.step + 1;
  return [now % 2 ? ATTACK : 0, now > 40 && now % 3 === 1 ? ATTACK : 0];
};
/** A hero swinging with a hit landed, a hurt enemy in hit-stop, another knocked down, and more than one spark. */
const midFight = (world: World) =>
  world.heroes.some(
    (hero) => hero.state.startsWith("attack") && hero.struck.length > 0,
  ) &&
  world.enemies.some(
    (enemy) => enemy.state === "hurt" && world.step <= enemy.stopUntil,
  ) &&
  world.enemies.some((enemy) => enemy.state === "knockdown") &&
  world.fx.length > 1;

/** Brakka and Rhea at a ravager each, stopped mid-fight (`midFight`). */
function fight(): World {
  let world = createWorld({
    seed: 5,
    heroes: [
      { seat: 0, kind: "brakka" },
      { seat: 1, kind: "rhea" },
    ],
  });
  for (const hero of world.heroes)
    world = spawnEnemy(world, "ravager", hero.x + px(20), hero.y);
  while (world.step < 600 && !midFight(world)) world = step(world, mash(world));
  assert.ok(midFight(world), "the fight got going");
  return world;
}

test("a world mid-fight survives the checkpoint whole, and fights on from it identically", () => {
  const world = fight();
  const back = decodeWorld(structuredClone(encodeWorld(world)));
  assert.deepEqual(back, world);
  let restored = back!,
    straight = world;
  for (let index = 0; index < 240; index++) {
    restored = step(restored, mash(restored));
    straight = step(straight, mash(straight));
  }
  assert.deepEqual(restored, straight);
  // Rhea's finisher knocked her ravager down too, and both got up again.
  assert.deepEqual(
    straight.heroes.map((hero) => hero.knockdowns),
    [1, 1],
  );
  assert.ok(straight.heroes[1]!.damage > world.heroes[1]!.damage);
  assert.ok(straight.enemies.every((enemy) => enemy.state === "idle"));
});

test("a mid-fight world with a corrupt hero, enemy, spark or id is refused whole", () => {
  const good = encodeWorld(fight()) as unknown[];
  const now = good[1] as number,
    nextId = good[3] as number;
  const broken = (change: (fields: unknown[]) => void) => {
    const copy = structuredClone(good);
    change(copy);
    return decodeWorld(copy);
  };
  const hero = (f: unknown[], index = 0) => (f[5] as unknown[][])[index]!;
  const enemies = (f: unknown[]) => f[6] as unknown[][];
  const enemy = (f: unknown[], index = 0) => enemies(f)[index]!;
  const sparks = (f: unknown[]) => f[7] as unknown[][];
  /** `count` enemies, every one a copy of the first with ids from 3 up and `nextId` past them. */
  const crowd = (f: unknown[], count: number) => {
    f[6] = Array.from({ length: count }, (_, index) => {
      const copy = [...enemy(f)];
      copy[0] = 3 + index;
      return copy;
    });
    f[3] = 3 + count;
    for (const each of f[5] as unknown[][]) each[16] = [];
  };
  const firstEnemy = enemy(good)[0] as number,
    lastEnemy = enemies(good).at(-1)![0] as number;
  assert.ok(lastEnemy > firstEnemy && sparks(good).length > 1);

  // The edges the rules reach are kept.
  for (const [what, change] of [
    ["an Attack just buffered", (f) => (hero(f)[13] = BUFFER_STEPS)],
    ["a knockdown's hit-stop", (f) => (hero(f)[15] = now + HEAVY_HITSTOP)],
    ["an enemy at full health", (f) => (enemy(f)[8] = ASH)],
    [
      "a rust enemy at its full health",
      (f) => ((enemy(f)[8] = RUST), (enemy(f)[12] = 1)),
    ],
    ["the most enemies", (f) => crowd(f, ENEMY_MAX)],
    ["the most sparks", (f) => (f[7] = Array(FX_MAX).fill(sparks(f)[0]))],
    ["a spark on its last step", (f) => (sparks(f)[0]![4] = now - FX_LIFE + 1)],
  ] as [string, (fields: unknown[]) => void][])
    assert.ok(broken(change), what);

  for (const [what, change] of [
    ["a fourth swing", (f) => (hero(f)[10] = "attack4")],
    ["an Attack buffered too long", (f) => (hero(f)[13] = BUFFER_STEPS + 1)],
    ["a negative Jump buffer", (f) => (hero(f)[14] = -1)],
    ["a fractional Jump buffer", (f) => (hero(f)[14] = 0.5)],
    [
      "a hero's hit-stop past the longest",
      (f) => (hero(f)[15] = now + HEAVY_HITSTOP + 1),
    ],
    ["a negative hit-stop", (f) => (hero(f)[15] = -1)],
    ["struck not a list", (f) => (hero(f)[16] = firstEnemy)],
    ["struck out of order", (f) => (hero(f)[16] = [lastEnemy, firstEnemy])],
    ["an enemy struck twice", (f) => (hero(f)[16] = [firstEnemy, firstEnemy])],
    ["a hero struck", (f) => (hero(f)[16] = [hero(f, 1)[0]])],
    ["struck an id not yet issued", (f) => (hero(f)[16] = [nextId])],
    ["struck id 0", (f) => (hero(f)[16] = [0])],
    [
      "more struck than the most enemies",
      (f) => {
        crowd(f, ENEMY_MAX);
        f[3] = 100;
        hero(f)[16] = Array.from(
          { length: ENEMY_MAX + 1 },
          (_, index) => 3 + index,
        );
      },
    ],
    ["negative damage", (f) => (hero(f)[17] = -1)],
    ["a fractional knockdown tally", (f) => (hero(f)[18] = 1.5)],
    ["knockdowns as text", (f) => (hero(f)[18] = "1")],
    ["enemies not a list", (f) => (f[6] = {})],
    ["more than the most enemies", (f) => crowd(f, ENEMY_MAX + 1)],
    ["an enemy not a tuple", (f) => (enemies(f)[0] = 7 as never)],
    ["an enemy field short", (f) => enemy(f).pop()],
    ["an enemy field over", (f) => enemy(f).push(0)],
    ["an unknown enemy", (f) => (enemy(f)[1] = "ogre")],
    ["an enemy off the road", (f) => (enemy(f)[2] = STAGE_LENGTH + px(400))],
    ["an enemy between sub-units", (f) => (enemy(f)[3] = px(140) + 0.5)],
    ["an enemy under the floor", (f) => (enemy(f)[4] = -1)],
    ["an enemy too fast", (f) => (enemy(f)[5] = px(17))],
    ["an enemy rising too fast", (f) => (enemy(f)[6] = -px(17))],
    ["an enemy facing nowhere", (f) => (enemy(f)[7] = 0)],
    ["an enemy past full health", (f) => (enemy(f)[8] = ASH + 1)],
    ["an ash enemy at rust health", (f) => (enemy(f)[8] = RUST)],
    ["an unknown tier", (f) => (enemy(f)[12] = 3)],
    ["a tier as text", (f) => (enemy(f)[12] = "0")],
    ["an enemy's goal off the road", (f) => (enemy(f)[13] = -px(400))],
    ["an enemy's goal between sub-units", (f) => (enemy(f)[13] = 0.5)],
    ["negative hp", (f) => (enemy(f)[8] = -1)],
    ["an unknown enemy state", (f) => (enemy(f)[9] = "sleep")],
    ["a negative enemy timer", (f) => (enemy(f)[10] = -1)],
    [
      "an enemy's hit-stop past the longest",
      (f) => (enemy(f)[11] = now + HEAVY_HITSTOP + 1),
    ],
    ["enemies out of order", (f) => enemies(f).reverse()],
    ["a repeated enemy id", (f) => (enemy(f, 1)[0] = enemy(f)[0])],
    ["an enemy with a hero's id", (f) => (enemy(f)[0] = hero(f, 1)[0])],
    ["an enemy id not yet issued", (f) => (f[3] = lastEnemy)],
    ["sparks not a list", (f) => (f[7] = 1)],
    [
      "more than the most sparks",
      (f) => (f[7] = Array(FX_MAX + 1).fill(sparks(f)[0])),
    ],
    ["a spark not a tuple", (f) => (sparks(f)[0] = "hit" as never)],
    ["an unknown spark", (f) => (sparks(f)[0]![0] = "boom")],
    ["a spark between sub-units", (f) => (sparks(f)[0]![3] = px(28) + 0.5)],
    ["a spark from the future", (f) => (sparks(f).at(-1)![4] = now + 1)],
    ["a spark past its life", (f) => (sparks(f)[0]![4] = now - FX_LIFE)],
    [
      "sparks newest first",
      (f) =>
        (f[7] = [
          [...sparks(f)[0]!.slice(0, 4), now],
          [...sparks(f)[0]!.slice(0, 4), now - 1],
        ]),
    ],
  ] as [string, (fields: unknown[]) => void][])
    assert.equal(broken(change), undefined, what);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  DOWN,
  JUMP,
  LEFT,
  RIGHT,
  STAGES,
  STAGE_1,
  STAGE_2,
  UP,
  botInput,
  carryOf,
  createWorld,
  decodeWorld,
  defeated,
  encodeWorld,
  spawnEnemy,
  stageCleared,
  step,
  stepTick,
  waveSpawns,
  type World,
} from "../src/engine/index.js";
import { cleared } from "./fixtures/stage.js";
import {
  BUFFER_STEPS,
  CAMERA_END,
  ENEMY_MAX,
  FLOOR_BOTTOM,
  FLOOR_TOP,
  FX_LIFE,
  FX_MAX,
  HEAVY_HITSTOP,
  HERO_HP,
  HERO_KINDS,
  JUGGLE_HITS,
  JUGGLE_WINDOW,
  LIVES,
  RAVAGER,
  RESPAWN_INVULN,
  RUN_GAP,
  RUN_TAP,
  STAGE_LENGTH,
  TIERS,
  VIEW_H,
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
    ["no stage", (f) => (f[16] = 0)],
    ["a stage past the last", (f) => (f[16] = STAGES.length + 1)],
    ["a fractional stage", (f) => (f[16] = 1.5)],
  ] as [string, (fields: unknown[]) => void][])
    assert.equal(broken(change), undefined, what);
});

test("a world's road is its own stage's: what lies past the village's end is refused on Stage 1, kept on Wyrmbone Pass", () => {
  // The pass won, a ravager walking to a spot past the village's end.
  const pass = spawnEnemy(
    cleared(createWorld({ seed: 2, heroes: [{ seat: 0, kind: "gorm" }], stage: 2 })),
    "ravager",
    px(1500),
    px(140),
  ); // prettier-ignore
  assert.equal(pass.camX, STAGE_2.cameraEnd);
  assert.deepEqual(decodeWorld(structuredClone(encodeWorld(pass))), pass);
  const enemy = (f: unknown[]) => (f[6] as unknown[][])[0]!;
  /** The pass's world told it is on Stage 1, with the village's camera and waves if `village`. */
  const asStage1 = (village: boolean, change = (_: unknown[]) => {}) => {
    const fields = structuredClone(encodeWorld(pass)) as unknown[];
    fields[16] = 1;
    if (village)
      [fields[4], fields[8], fields[11]] = [
        CAMERA_END,
        STAGE_1.waves.length,
        waveSpawns(STAGE_1.waves.at(-1)!, 1).length,
      ];
    change(fields);
    return decodeWorld(fields);
  };
  assert.equal(asStage1(false), undefined, "the pass's camera and sixth wave");
  assert.equal(asStage1(true), undefined, "a goal past the village's end");
  const near = (f: unknown[]) => (enemy(f)[13] = CAMERA_END);
  const beyond = (f: unknown[]) => (near(f), (enemy(f)[2] = px(1700)));
  assert.equal(asStage1(true, beyond), undefined, "a ravager past it");
  assert.equal(asStage1(true, near)?.stage, 1, "within reach of its end");
});

test("every world the bots reach on any stage, in a party of one or five, is accepted by the checkpoint", () => {
  let checked = 0;
  for (const party of [1, 5]) {
    let world = createWorld({
      seed: 41,
      heroes: Array.from({ length: party }, (_, seat) => ({
        seat,
        kind: HERO_KINDS[seat % HERO_KINDS.length]!,
      })),
    });
    for (const [index, plan] of STAGES.entries()) {
      if (index > 0)
        world = createWorld({
          seed: 41 + index,
          stage: index + 1,
          heroes: world.heroes.map((hero) => ({
            seat: hero.seat,
            kind: hero.kind,
            carry: carryOf(hero),
          })),
        });
      let furthest = 0;
      while (world.step < 14_000 && !stageCleared(world) && !defeated(world)) {
        const held: number[] = [];
        for (const hero of world.heroes)
          held[hero.seat] = botInput(world, hero.id);
        world = stepTick(world, held);
        furthest = Math.max(furthest, world.camX);
        if (world.step % 15 === 0) {
          checked++;
          assert.deepEqual(
            decodeWorld(JSON.parse(JSON.stringify(encodeWorld(world)))),
            world,
            `${plan.name} at step ${world.step} with ${party}`,
          );
        }
      }
      assert.ok(stageCleared(world), `${plan.name} cleared by ${party}`);
      assert.equal(furthest, plan.cameraEnd, "to the end of its road");
    }
  }
  assert.ok(checked > 1000, `${checked} worlds`);
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
  // Rhea's finisher knocked her ravager down too, and the fight went on.
  assert.ok(straight.heroes.every((hero) => hero.knockdowns > 0));
  assert.ok(straight.heroes.some((h, i) => h.damage > world.heroes[i]!.damage));
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
    lastEnemy = enemies(good).at(-1)![0] as number,
    brakka = HERO_HP.brakka,
    thinking = Math.max(
      ...TIERS.map((t) => RAVAGER[t].think + RAVAGER[t].jitter),
    );
  /** The first hero's double tap: its side, the last step it counts and the run waiting. */
  const tapped = (f: unknown[], tap: number, until: number, buf: number) =>
    Object.assign(hero(f), { 24: tap, 25: until, 26: buf });
  const TAP = Math.max(RUN_TAP, RUN_GAP);
  /** The first hero in `state` with `hp` and `lives`. */
  const life = (f: unknown[], state: string, hp: number, lives: number) =>
    Object.assign(hero(f), { 10: state, 19: hp, 20: lives });
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
    ["a hero at full health", (f) => (hero(f)[19] = brakka)],
    ["a goal at the road's start", (f) => (enemy(f)[13] = 0)],
    ["a goal at the road's end", (f) => (enemy(f)[13] = STAGE_LENGTH)],
    ["a depth goal at the floor's far edge", (f) => (enemy(f)[14] = FLOOR_TOP)],
    [
      "a depth goal at the floor's near edge",
      (f) => (enemy(f)[14] = FLOOR_BOTTOM),
    ],
    ["a hero flying from the last blow", (f) => life(f, "knockdown", 0, 1)],
    ["a hero fallen with a life left", (f) => life(f, "dead", 0, 1)],
    ["a hero fallen on the first life", (f) => life(f, "dead", 0, LIVES - 1)],
    // Fallen on its last life, it lies `RESPAWN_DELAY` steps before it is out.
    ["a hero fallen on its last life", (f) => life(f, "dead", 0, 0)],
    ["a hero out", (f) => life(f, "out", 0, 0)],
    ["a hero dropping back in", (f) => life(f, "respawn", brakka, 2)],
    ["a hero dropping in on its last life", (f) => life(f, "respawn", 1, 1)],
    [
      "a hero flying from its last life's blow",
      (f) => life(f, "knockdown", 0, 1),
    ],
    ["the longest blink", (f) => (hero(f)[21] = now + RESPAWN_INVULN)],
    [
      "a run of hits short of a knockdown",
      (f) => (
        (hero(f)[22] = JUGGLE_HITS - 1),
        (hero(f)[23] = now + JUGGLE_WINDOW)
      ),
    ],
    ["a tap just pressed", (f) => tapped(f, LEFT, now + RUN_TAP, 0)],
    ["a tap waiting for its second", (f) => tapped(f, RIGHT, now + RUN_GAP, 0)],
    ["a double tap waiting to run", (f) => tapped(f, RIGHT, 0, BUFFER_STEPS)],
    ["an enemy going for a hero", (f) => (enemy(f)[15] = hero(f, 1)[0])],
    ["an enemy's longest pause", (f) => (enemy(f)[16] = now + thinking)],
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
    ["a hero past full health", (f) => (hero(f)[19] = brakka + 1)],
    ["negative hero hp", (f) => (hero(f)[19] = -1)],
    ["a hero swinging with no hp", (f) => (hero(f)[19] = 0)],
    ["a fallen hero with hp", (f) => life(f, "dead", 1, 1)],
    ["a fourth life", (f) => (hero(f)[20] = LIVES + 1)],
    ["a hero swinging with no life", (f) => (hero(f)[20] = 0)],
    ["a hero out with a life left", (f) => life(f, "out", 0, 1)],
    ["a hero fallen with every life", (f) => life(f, "dead", 0, LIVES)],
    ["a hero dropping in with no life", (f) => life(f, "respawn", brakka, 0)],
    ["a hero dropping in with no hp", (f) => life(f, "respawn", 0, 2)],
    ["a hero flying with no life", (f) => life(f, "knockdown", 0, 0)],
    ["a blink too long", (f) => (hero(f)[21] = now + RESPAWN_INVULN + 1)],
    ["a run of hits past a knockdown", (f) => (hero(f)[22] = JUGGLE_HITS)],
    ["a run of hits too long", (f) => (hero(f)[23] = now + JUGGLE_WINDOW + 1)],
    ["a tap of Up", (f) => tapped(f, UP, now, 0)],
    ["a tap of both sides", (f) => tapped(f, LEFT | RIGHT, now, 0)],
    ["a tap counting too long", (f) => tapped(f, LEFT, now + TAP + 1, 0)],
    ["a negative tap step", (f) => tapped(f, LEFT, -1, 0)],
    ["a run buffered too long", (f) => tapped(f, LEFT, 0, BUFFER_STEPS + 1)],
    ["a run with no side", (f) => tapped(f, 0, 0, 1)],
    ["a tap step with no tap", (f) => tapped(f, 0, now, 0)],
    ["a fractional knockdown tally", (f) => (hero(f)[18] = 1.5)],
    ["knockdowns as text", (f) => (hero(f)[18] = "1")],
    ["enemies not a list", (f) => (f[6] = {})],
    ["more than the most enemies", (f) => crowd(f, ENEMY_MAX + 1)],
    ["an enemy not a tuple", (f) => (enemies(f)[0] = 7 as never)],
    ["an enemy field short", (f) => enemy(f).pop()],
    ["an enemy field over", (f) => enemy(f).push(0)],
    ["an unknown enemy", (f) => (enemy(f)[1] = "wyvern")],
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
    [
      "an enemy's depth goal off the screen",
      (f) => (enemy(f)[14] = px(VIEW_H) + 1),
    ],
    // A walk toward a goal the rules never set would never end.
    ["a goal behind the road", (f) => (enemy(f)[13] = -1)],
    ["a goal past the road's end", (f) => (enemy(f)[13] = STAGE_LENGTH + 1)],
    ["a depth goal above the floor", (f) => (enemy(f)[14] = FLOOR_TOP - 1)],
    ["a depth goal below the floor", (f) => (enemy(f)[14] = FLOOR_BOTTOM + 1)],
    ["a depth goal at the top of the screen", (f) => (enemy(f)[14] = 0)],
    ["an enemy going for an enemy", (f) => (enemy(f)[15] = lastEnemy)],
    ["an enemy going for an id not issued", (f) => (enemy(f)[15] = nextId)],
    ["an enemy going for half a hero", (f) => (enemy(f)[15] = 1.5)],
    ["an enemy's pause too long", (f) => (enemy(f)[16] = now + thinking + 1)],
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

import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  DOWN,
  HERO_KINDS,
  JUMP,
  LEFT,
  RIGHT,
  SPAWNS,
  TIERS,
  UP,
  createWorld,
  decodeWorld,
  defeated,
  encodeWorld,
  revive,
  spawnEnemy,
  step,
  toView,
  type Enemy,
  type HeroKind,
  type Tier,
  type World,
} from "../src/engine/index.js";
import { STAGE_1 } from "../src/engine/stages.js";
import * as T from "../src/engine/tuning.js";
import * as Kit from "../src/engine/view-kit.js";

const { px } = T;
const hero = (world: World, index = 0) => world.heroes[index]!;
const enemy = (world: World, index = 0) => world.enemies[index]!;
const run = (world: World, steps: number, held: readonly number[] = []) => {
  for (let index = 0; index < steps; index++) world = step(world, held);
  return world;
};
/** Steps holding `held` until `done`, within a bound. */
function until(
  world: World,
  done: (world: World) => boolean,
  held: (world: World, index: number) => readonly number[] = () => [],
): World {
  for (let index = 0; index < 3000 && !done(world); index++)
    world = step(world, held(world, index));
  assert.ok(done(world), "never happened");
  return world;
}
/** A hero alone in seat 0 and a ravager of `tier` (dx, dy) px from it. */
function duel(tier: Tier, dx: number, dy = 0, kind: HeroKind = "gorm"): World {
  const world = createWorld({ seed: 2, heroes: [{ seat: 0, kind }] });
  const { x, y } = hero(world);
  return spawnEnemy(world, "ravager", x + px(dx), y + px(dy), tier);
}
/** The first enemy about to land its mace on the next step: at the end of its wind-up, 24 px from the hero and facing it. */
const armed = (world: World): World => {
  const [first, ...rest] = world.enemies,
    { x, y } = hero(world);
  const facing = x > first!.x ? 1 : -1;
  const ready: Enemy = {
    ...first!,
    state: "windup",
    timer: T.RAVAGER[first!.tier].windup - 1,
    x: x - facing * px(24),
    y,
    facing,
  };
  return { ...world, enemies: [ready, ...rest] };
};
const withHero = (world: World, change: Partial<World["heroes"][number]>) => ({
  ...world,
  heroes: [{ ...hero(world), ...change }, ...world.heroes.slice(1)],
});
/** The world survives the checkpoint whole and steps on from it identically. */
function kept(world: World): void {
  const back = decodeWorld(structuredClone(encodeWorld(world)));
  assert.deepEqual(back, world);
  assert.deepEqual(run(back!, 30, [ATTACK]), run(world, 30, [ATTACK]));
}
const GORM = T.HERO_HP.gorm;

test("a ravager stands, then walks up and lines up in depth before it winds up, facing the hero", () => {
  let world = duel(0, 90, 24);
  const trail = [world];
  while (enemy(world).state !== "windup") {
    world = step(world, []);
    trail.push(world);
    assert.ok(trail.length < 600, "never wound up");
  }
  const [e, h] = [enemy(world), hero(world)];
  assert.ok(Math.abs(e.y - h.y) <= T.AI_LANE);
  assert.ok(Math.abs(e.x - h.x) <= T.ENGAGE_X + T.ENGAGE_SLACK);
  assert.deepEqual([e.facing, e.target], [-1, h.id]);
  const { think, walk } = T.RAVAGER[0];
  assert.ok(trail.slice(1, think).every((w) => enemy(w).state === "idle"));
  assert.ok(trail.some((w) => toView(w).enemies[0]!.anim === "walk"));
  for (const [index, w] of trail.slice(1).entries()) {
    const before = enemy(trail[index]!);
    assert.ok(Math.abs(enemy(w).x - before.x) <= walk.x);
    assert.ok(Math.abs(enemy(w).y - before.y) <= walk.y);
  }
  kept(world);
});

test("the wind-up shows for its tier's steps before the mace lands; higher tiers are quicker, faster and harder", () => {
  for (const tier of TIERS) {
    let world = duel(tier, 24);
    let began = 0;
    while (hero(world).state !== "hurt") {
      world = step(world, []);
      if (enemy(world).state === "windup" && enemy(world).timer === 0)
        began = world.step;
      assert.ok(world.step < 600);
    }
    const fighter = T.RAVAGER[tier];
    assert.equal(world.step - began, fighter.windup, `tier ${tier}`);
    assert.equal(Kit.WINDUP_STEPS[tier], fighter.windup);
    assert.equal(hero(world).hp, GORM - fighter.damage);
    assert.equal(toView(world).enemies[0]!.anim, "attack");
    const swung = until(world, (w) => enemy(w).state !== "attack");
    assert.equal(toView(swung).enemies[0]!.anim, "recover");
    assert.equal(swung.step - world.step, T.HITSTOP + Kit.ATTACK_STEPS);
  }
  for (const tier of [1, 2] as const) {
    const [now, before] = [T.RAVAGER[tier], T.RAVAGER[(tier - 1) as Tier]];
    assert.ok(now.windup < before.windup && now.think < before.think);
    assert.ok(now.walk.x > before.walk.x && now.damage > before.damage);
  }
});

test("a hero who steps out of the lane during the wind-up is missed; one who stays is hit", () => {
  const winding = until(duel(0, 24), (w) => enemy(w).state === "windup");
  const swung = (w: World) => enemy(w).state === "recover";
  const dodged = until(winding, swung, () => [DOWN]);
  assert.equal(hero(dodged).hp, GORM);
  assert.ok(hero(dodged).y - enemy(dodged).y > T.LANE);
  assert.ok(hero(until(winding, swung)).hp < GORM);
  // Stepping back out of its reach misses too.
  const away = until(winding, swung, () => [LEFT]);
  assert.equal(hero(away).hp, GORM);
});

test("at most two ravagers go for a hero at once, from both sides, while the third hovers; none hits another", () => {
  let world = createWorld({ seed: 6, heroes: [{ seat: 0, kind: "gorm" }] });
  for (const [dx, dy] of [
    [60, 0],
    [90, 20],
    [120, -20],
  ] as const)
    world = spawnEnemy(
      world,
      "ravager",
      hero(world).x + px(dx),
      hero(world).y + px(dy),
    );
  const full = enemy(world).hp;
  let most = 0,
    hovered = false,
    surrounded = false;
  for (let index = 0; index < 900; index++) {
    world = step(world, []);
    const h = hero(world),
      engaged = world.enemies.filter((e) => e.target === h.id);
    most = Math.max(most, engaged.length);
    hovered ||= world.enemies.some(
      (e) =>
        e.state === "walk" && !e.target && Math.abs(e.goal - h.x) >= T.HOVER_X,
    );
    surrounded ||=
      engaged.length === 2 && engaged[0]!.x < h.x !== engaged[1]!.x < h.x;
  }
  assert.deepEqual([most, hovered, surrounded], [2, true, true]);
  assert.ok(hero(world).hp < GORM || hero(world).lives < T.LIVES);
  assert.ok(world.enemies.every((e) => e.hp === full));
  // One standing in another's swing is not hit by it.
  const between = spawnEnemy(
    duel(0, 24),
    "ravager",
    hero(world).x + px(12),
    hero(world).y,
  );
  const after = step(armed(between), []);
  assert.equal(hero(after).state, "hurt");
  assert.equal(enemy(after, 1).hp, full);
  assert.notEqual(enemy(after, 1).state, "hurt");
});

test("an enemy reeling, flying, lying, getting up, fallen, walking in or in hit-stop does not think", () => {
  const world = duel(0, 20);
  const e = { ...enemy(world), thinkAt: 0 };
  const cases: [string, Partial<Enemy>, number][] = [
    ["hurt", { state: "hurt" }, T.HURT_STEPS - 1],
    ["knockdown", { state: "knockdown", z: px(1), vz: T.KNOCK_VZ }, 20],
    ["down", { state: "down" }, T.DOWN_STEPS - 1],
    ["getup", { state: "getup" }, T.GETUP_STEPS - 1],
    ["dead", { state: "dead", hp: 0 }, T.DEAD_STEPS - 1],
    ["enter", { state: "enter", goal: e.x + px(30) }, 39],
    ["hit-stop", { stopUntil: world.step + 30 }, 30],
  ];
  for (const [what, change, steps] of cases) {
    let stunned = { ...world, enemies: [{ ...e, ...change }] };
    for (let index = 0; index < steps; index++) {
      stunned = step(stunned, []);
      assert.ok(
        !["walk", "windup", "attack"].includes(enemy(stunned).state),
        what,
      );
    }
    assert.deepEqual([stunned.rng, hero(stunned).hp], [world.rng, GORM], what);
  }
});

test("a mace hit holds a hero in hit-stop, then it reels back; one landing in a swing's wind-up breaks it off", () => {
  let world = step(duel(0, 24), [ATTACK]);
  assert.equal(hero(world).state, "attack1");
  world = step(armed(world), []);
  const struck = world.step;
  assert.deepEqual(
    [
      hero(world).state,
      hero(world).hp,
      hero(world).facing,
      hero(world).stopUntil,
    ],
    ["hurt", GORM - T.RAVAGER[0].damage, 1, struck + T.HITSTOP],
  );
  assert.equal(enemy(world).stopUntil, struck + T.HITSTOP);
  assert.deepEqual(world.fx.at(-1)!.kind, "hit");
  const { x } = hero(world);
  world = until(
    world,
    (w) => hero(w).state === "idle",
    () => [ATTACK],
  );
  assert.equal(world.step - struck, T.HITSTOP + Kit.HERO_HURT_STEPS);
  assert.ok(hero(world).x < x, "knocked back");
  assert.equal(
    enemy(world).hp,
    enemy(duel(0, 24)).hp,
    "the swing never landed",
  );
});

test("the third hit in a row knocks a hero down, as does one low on health or in the air; it gets up invulnerable", () => {
  const hit = (w: World) => step(armed(w), []);
  const between = Kit.HERO_HURT_STEPS + T.HITSTOP;
  // A fresh hero has never been invulnerable, though its `invulnUntil` of 0 is not before step 0.
  assert.equal(toView(duel(0, 24)).heroes[0]!.invulnerable, false);
  let world = hit(duel(0, 24));
  world = hit(run(world, between));
  assert.deepEqual([hero(world).state, hero(world).stagger], ["hurt", 2]);
  kept(world);
  world = hit(run(world, between));
  assert.deepEqual([hero(world).state, hero(world).stagger], ["knockdown", 0]);
  assert.equal(world.fx.at(-1)!.kind, "heavy");
  world = until(world, (w) => hero(w).state === "getup");
  assert.equal(hero(world).z, 0);
  assert.ok(toView(world).heroes[0]!.invulnerable);
  const hp = hero(world).hp;
  assert.equal(hero(hit(world)).hp, hp, "no mace lands getting up");
  world = until(world, (w) => hero(w).state === "idle");
  assert.equal(
    hero(hit(run(world, T.GETUP_GRACE - 1))).hp,
    hp,
    "nor just after",
  );
  world = until(world, (w) => !toView(w).heroes[0]!.invulnerable);
  assert.deepEqual(
    [hero(hit(world)).state, hero(hit(world)).hp < hp],
    ["hurt", true],
  );
  // Hits further apart than the window never knock down (the ravager held still between them).
  let slow = duel(0, 24);
  for (let index = 0; index < 4; index++) {
    slow = hit(slow);
    assert.equal(hero(slow).state, "hurt");
    const until = slow.step + T.JUGGLE_WINDOW + 1;
    slow = run(
      { ...slow, enemies: [{ ...enemy(slow), stopUntil: until }] },
      T.JUGGLE_WINDOW + 1,
    );
  }
  // A hero left with a quarter of its hit points, or caught in the air, goes down at once.
  const low = hit(
    withHero(duel(0, 24), { hp: GORM / 4 + T.RAVAGER[0].damage }),
  );
  assert.equal(hero(low).state, "knockdown");
  const jumped = hit(run(duel(0, 24), 4, [JUMP]));
  assert.equal(hero(jumped).state, "knockdown");
  assert.ok(hero(jumped).z > 0);
});

test("a hero at no hp falls and loses a life, then drops back in at full health and blinks; with none left it is out", () => {
  let world = withHero(duel(0, 24, 0, "brakka"), { hp: 1 });
  world = step(armed(world), []);
  assert.deepEqual(
    [hero(world).state, hero(world).hp, world.fx.at(-1)!.kind],
    ["knockdown", 0, "ko"],
  );
  world = until(world, (w) => hero(w).state === "dead");
  assert.equal(hero(world).lives, T.LIVES - 1);
  const fell = world.step;
  world = run(world, 1);
  assert.equal(enemy(world).target, 0, "enemies leave the fallen be");
  world = until(world, (w) => hero(w).state === "respawn");
  assert.equal(world.step - fell, Kit.RESPAWN_DELAY);
  const [x, y] = SPAWNS[0]!;
  assert.deepEqual(
    [hero(world).x, hero(world).y, hero(world).z, hero(world).hp],
    [world.camX + px(x), px(y), px(y), T.HERO_HP.brakka],
  );
  kept(world);
  world = until(world, (w) => hero(w).state !== "respawn");
  const view = toView(world).heroes[0]!;
  assert.deepEqual(
    [
      view.anim,
      view.invulnerable,
      view.hp,
      view.maxHp,
      view.lives,
      hero(world).z,
    ],
    ["idle", true, T.HERO_HP.brakka, Kit.HERO_HP.brakka, 2, 0],
  );
  assert.equal(hero(world).invulnUntil, world.step + T.RESPAWN_INVULN);
  // The last life lost, the hero is out for good, and the party with nobody else is defeated.
  world = step(armed(withHero(world, { hp: 1, lives: 1, invulnUntil: 0 })), []);
  world = until(
    world,
    (w) => hero(w).state === "out",
    () => [RIGHT | ATTACK],
  );
  assert.deepEqual(
    [hero(world).lives, defeated(world), toView(world).defeated],
    [0, true, true],
  );
  kept(world);
  const later = run(world, 200, [RIGHT | ATTACK]);
  assert.deepEqual([hero(later).state, hero(later).x], ["out", hero(world).x]);
  assert.ok(later.enemies.every((e) => e.target === 0));
  // One hero out does not defeat a party, nor hold its camera back.
  const pair = createWorld({
    seed: 2,
    heroes: [
      { seat: 0, kind: "brakka" },
      { seat: 1, kind: "rhea" },
    ],
  });
  const one = withHero(pair, { state: "out", hp: 0, lives: 0 });
  assert.equal(defeated(one), false);
  assert.ok(run(one, 300, [0, RIGHT]).camX > hero(one).x);
});

test("a party that continues drops back in with every life at the camera, and the stage goes on where it stood", () => {
  // Two heroes out on a locked first wave, with its ravagers still about and the camera moved on.
  let world = createWorld({
    seed: 3,
    heroes: [
      { seat: 0, kind: "rhea" },
      { seat: 2, kind: "gorm" },
    ],
  });
  world = until(
    world,
    (w) => w.locked && w.enemies.length > 0,
    () => [RIGHT, 0, RIGHT],
  );
  const out = {
    ...world,
    heroes: world.heroes.map((each) => ({
      ...each,
      state: "out" as const,
      hp: 0,
      lives: 0,
      attackBuf: 3,
      struck: [world.enemies[0]!.id],
    })),
  };
  assert.ok(defeated(out));
  const before = structuredClone(out);
  const back = revive(out);
  assert.deepEqual(out, before, "the world passed in is left untouched");
  assert.equal(defeated(back), false);
  back.heroes.forEach((each, index) => {
    const [x, y] = SPAWNS[each.seat]!;
    assert.deepEqual(
      [each.state, each.lives, each.hp, each.x, each.y, each.z],
      [
        "respawn",
        T.LIVES,
        T.HERO_HP[each.kind],
        out.camX + px(x),
        px(y),
        px(y),
      ],
      `hero ${index}`,
    );
    assert.deepEqual([each.attackBuf, each.struck], [0, []]);
  });
  assert.deepEqual(
    { ...back, heroes: [] },
    { ...out, heroes: [] },
    "the camera, waves and enemies stand",
  );
  kept(back);
  // They land, blinking, and fight on.
  const landed = until(back, (w) =>
    w.heroes.every((each) => each.state === "idle"),
  );
  assert.ok(toView(landed).heroes.every((each) => each.invulnerable));
});

test("a fallen hero holds the camera no more: the others walk on, and with none on the field it stays put", () => {
  const party = createWorld({
    seed: 1,
    heroes: [
      { seat: 0, kind: "gorm" },
      { seat: 1, kind: "rhea" },
    ],
  });
  // With no lives left it stays down (one with a life would drop back in after `RESPAWN_DELAY`).
  const fallen = { ...hero(party), state: "dead" as const, hp: 0, lives: 0 };
  const marched = run({ ...party, heroes: [fallen, hero(party, 1)] }, 150, [
    0,
    RIGHT,
  ]);
  // The fallen one lies where it fell, behind the camera, and the survivor leads it by the usual distance.
  assert.equal(hero(marched).x, fallen.x);
  assert.ok(marched.camX > fallen.x, "the camera went on past it");
  assert.equal(hero(marched, 1).x - marched.camX, T.CAMERA_LEAD);
  const wiped = run(
    { ...party, heroes: [fallen, { ...fallen, id: 2, seat: 1 }] },
    120,
    [RIGHT, RIGHT],
  );
  assert.equal(wiped.camX, 0);
});

test("a hero whose last life is lost lies where it fell when it goes out, though the camera has left it behind", () => {
  const party = createWorld({
    seed: 1,
    heroes: [
      { seat: 0, kind: "gorm" },
      { seat: 1, kind: "rhea" },
    ],
  });
  const lying = {
    ...hero(party),
    state: "dead" as const,
    hp: 0,
    lives: 0,
    x: px(20),
  };
  let world = { ...party, camX: px(150), heroes: [lying, hero(party, 1)] };
  world = until(world, (w) => hero(w).state === "out");
  assert.equal(hero(world).x, px(20));
  assert.ok(world.camX - hero(world).x > T.VIEW_W / 4, "left behind");
  kept(world);
  assert.equal(hero(run(world, 60, [RIGHT, RIGHT])).x, px(20));
});

test("a hero drops back in on the screen and the floor even at the stage's end, and no mace lands while it drops or blinks", () => {
  const party = createWorld({
    seed: 1,
    heroes: [
      { seat: 0, kind: "gorm" },
      { seat: 4, kind: "rhea" },
    ],
  });
  // Every wave begun and cleared, the camera at the stage's end, one hero lying far behind it with a life left.
  const lying = {
    ...hero(party),
    state: "dead" as const,
    hp: 0,
    lives: 1,
    x: px(5),
  };
  let world = duel(0, 24);
  world = {
    ...party,
    camX: T.CAMERA_END,
    wave: STAGE_1.waves.length,
    heroes: [lying, hero(party, 1)],
    enemies: world.enemies,
  };
  world = until(world, (w) => hero(w).state === "respawn");
  const { x, y } = hero(world);
  assert.ok(x >= world.camX + T.HERO_MARGIN, "on screen, left");
  assert.ok(x <= T.STAGE_LENGTH && x <= world.camX + px(T.VIEW_W), "right");
  assert.ok(y >= T.FLOOR_TOP && y <= T.FLOOR_BOTTOM, "on the floor band");
  assert.deepEqual([hero(world).lives, hero(world).hp], [1, T.HERO_HP.gorm]);
  // A ravager at the drop point winds up and swings: the hero in the air is not struck.
  world = step(armed(world), []);
  assert.deepEqual(
    [hero(world).state, hero(world).hp],
    ["respawn", T.HERO_HP.gorm],
  );
  world = until(world, (w) => hero(w).state === "idle");
  const blink = hero(world).invulnUntil;
  assert.equal(blink, world.step + T.RESPAWN_INVULN);
  // Nor while it blinks, but the step after it ends one does.
  world = step(armed(world), []);
  assert.deepEqual(
    [hero(world).state, hero(world).hp],
    ["idle", T.HERO_HP.gorm],
  );
  world = until(world, (w) => w.step === blink);
  world = step(armed(world), []);
  assert.equal(hero(world).state, "hurt");
  assert.ok(hero(world).hp < T.HERO_HP.gorm);
  assert.equal(hero(world).lives, 1);
});

test("an enemy beside a hero lying down waits out its pause instead of deciding every step, then swings at the one who rises", () => {
  let world = withHero(duel(0, 24), { state: "down" });
  const { think } = T.RAVAGER[0];
  let draws = 0;
  for (let index = 0; index < think + 4; index++) {
    const before = world.rng;
    world = step(world, []);
    if (world.rng !== before) draws++;
    assert.notEqual(enemy(world).state, "windup");
  }
  assert.equal(hero(world).state, "down", "it is still lying");
  // One decision when its pause ran out (it rested again, with a random part), none in the steps before.
  assert.equal(draws, 1);
  assert.ok(enemy(world).thinkAt > world.step);
  kept(world);
  world = until(world, (w) => hero(w).state === "idle");
  world = until(world, (w) => enemy(w).state === "windup");
  assert.equal(enemy(world).target, hero(world).id);
});

/** Walks toward the nearest enemy standing, lining up in depth, and presses Attack every other step regardless. */
function masher(world: World, index: number): number[] {
  const h = hero(world);
  const foes = world.enemies.filter((e) => e.state !== "dead");
  if (foes.length === 0) return [RIGHT];
  const near = foes.reduce((a, b) =>
    Math.abs(b.x - h.x) + Math.abs(b.y - h.y) <
    Math.abs(a.x - h.x) + Math.abs(a.y - h.y)
      ? b
      : a,
  );
  let bits = index % 2 ? 0 : ATTACK;
  if (Math.abs(near.y - h.y) > px(2)) bits |= near.y > h.y ? DOWN : UP;
  if (Math.abs(near.x - h.x) > px(20)) bits |= near.x > h.x ? RIGHT : LEFT;
  return [bits];
}

test("balance: a hero mashing Attack clears the first wave alone, taking hits but keeping its lives", () => {
  for (const kind of HERO_KINDS) {
    let world = createWorld({ seed: 1, heroes: [{ seat: 0, kind }] });
    world = until(
      world,
      (w) => w.wave === 1,
      () => [RIGHT],
    );
    world = until(world, (w) => !w.locked || hero(w).state === "out", masher);
    assert.equal(world.locked, false, kind);
    assert.equal(hero(world).lives, T.LIVES, kind);
    assert.ok(hero(world).hp < T.HERO_HP[kind], `${kind} took no hit`);
  }
});

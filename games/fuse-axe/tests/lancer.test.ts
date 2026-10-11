import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  DOWN,
  MAGIC,
  RIGHT,
  STAGE_1,
  UP,
  botInput,
  createWorld,
  decodeWorld,
  encodeWorld,
  spawnEnemy,
  step,
  stepTick,
  toView,
  type Enemy,
  type HeroKind,
  type World,
} from "../src/engine/index.js";
import { REACT, REACT_SPREAD } from "../src/engine/bot.js";
import { landing } from "../src/engine/lancer.js";
import { hittable } from "../src/engine/step.js";
import * as T from "../src/engine/tuning.js";
import { LANCER_STEPS } from "../src/engine/view-kit.js";
import { LANCER_STATES } from "../src/engine/world.js";
import { enemyFrame } from "../src/render/art/animate.js";
import { LANCER_ANIMS, LANCER_POSES } from "../src/render/art/lancer.js";

const { px } = T;
const party = (...kinds: HeroKind[]) =>
  createWorld({ seed: 9, heroes: kinds.map((kind, seat) => ({ seat, kind })) });
const hero = (world: World, index = 0) => world.heroes[index]!;
const lancer = (world: World) => world.enemies.find((e) => isLancer(e))!;
const isLancer = (enemy: Enemy) => enemy.kind === "lancer";
const hps = (world: World) => world.heroes.map((h) => h.hp);
/** An enemy `dx` px along the road and `dy` in depth from the first hero, facing it, with `change` made to it. */
function foe(
  world: World,
  dx: number,
  change: Partial<Enemy> = {},
  kind: "lancer" | "ravager" = "lancer",
  dy = 0,
  tier: T.Tier = 0,
): World {
  const { x, y } = hero(world);
  const next = spawnEnemy(world, kind, x + px(dx), y + px(dy), tier);
  const facing = dx > 0 ? -1 : 1;
  next.enemies[next.enemies.length - 1] = {
    ...next.enemies.at(-1)!,
    facing,
    ...change,
  };
  return next;
}
const moved = (world: World, index: number, x: number, y: number) => ({
  ...world,
  heroes: world.heroes.map((h, i) => (i === index ? { ...h, x, y } : h)),
});
function run(world: World, steps: number, held: readonly number[] = []) {
  for (let index = 0; index < steps; index++) world = step(world, held);
  return world;
}
function until(world: World, done: (w: World) => boolean, limit = 400) {
  for (let i = 0; i < limit && !done(world); i++) world = step(world, []);
  assert.ok(done(world), "never happened");
  return world;
}
const FULL = T.enemyMaxHp("lancer", 0, 1);
const kept = (world: World) =>
  assert.deepEqual(decodeWorld(structuredClone(encodeWorld(world))), world);

test("a lancer is lighter and quicker than a ravager of its tier, and its spear outreaches the mace", () => {
  for (const tier of T.TIERS) {
    assert.ok(
      T.enemyMaxHp("lancer", tier, 3) < T.enemyMaxHp("ravager", tier, 3),
    );
    assert.ok(T.LANCER[tier].walk.x > T.RAVAGER[tier].walk.x);
  }
  assert.ok(T.THROWABLE.lancer && !T.BOSS.lancer);
  assert.equal(Math.round((10 * T.SPEAR_REACH) / T.MACE_REACH), 16);
  assert.ok(T.SPEAR_LANE < T.LANE);
  // The leap is a hero's jump, no faster along the road than the fastest run.
  assert.equal(T.LEAP_VX, Math.max(...Object.values(T.RUN)));
  assert.equal(T.LEAP_STEPS, 40);
});

test("a lancer keeps to the edge of its spear's reach in the hero's lane, backing off one too close unless cornered", () => {
  let world = foe(party("brakka"), 60, { thinkAt: 0 }, "lancer", 8);
  world = until(world, (w) => lancer(w).state === "windup");
  const dx = lancer(world).x - hero(world).x;
  assert.ok(dx > T.MACE_REACH + T.HERO_HALF_W, "beyond a mace's reach");
  assert.ok(dx <= T.LANCE_ENGAGE + T.LANCE_SLACK);
  assert.ok(Math.abs(lancer(world).y - hero(world).y) <= T.AI_LANE);
  // Too close, it walks back to wind up from the edge of its reach.
  const xs: number[] = [];
  world = until(foe(party("brakka"), 12, { thinkAt: 0 }), (w) => {
    xs.push(lancer(w).x);
    return lancer(w).state === "windup";
  });
  assert.ok(xs.at(-1)! > xs[0]!, "it backed off");
  assert.ok(lancer(world).x - hero(world).x >= T.LANCE_NEAR);
  // Cornered at the screen's left edge, it thrusts at the hero close in front.
  const start = party("brakka");
  let corner = moved(start, 0, px(26), hero(start).y);
  corner = foe(corner, -12, { thinkAt: 0 });
  corner = until(corner, (w) => lancer(w).state === "windup", 30);
  assert.ok(hero(corner).x - lancer(corner).x < T.LANCE_NEAR);
  assert.equal(lancer(corner).x, T.ENEMY_HALF_W);
});

test("the thrust is telegraphed by its wind-up, then lands in a long thin strip: at spear range in the lane, not beyond or out of it", () => {
  let world = foe(party("brakka", "rhea", "gorm"), 40, {
    state: "windup",
    target: 1,
  });
  const { x, y } = lancer(world);
  world = moved(world, 1, x - px(40), y + T.SPEAR_LANE + px(1));
  world = moved(world, 2, x - T.SPEAR_REACH - T.HERO_HALF_W - px(1), y);
  const full = hps(world);
  world = run(world, T.LANCER[0].windup - 1);
  assert.deepEqual([lancer(world).state, hps(world)], ["windup", full]);
  world = step(world, []);
  assert.equal(lancer(world).state, "thrust");
  assert.deepEqual(hps(world), [
    full[0]! - T.LANCER[0].damage,
    ...full.slice(1),
  ]);
  assert.equal(hero(world).state, "hurt", "a thrust is no knockdown");
  // It holds the spear out, then stands open before it decides again.
  world = run(world, T.THRUST_STEPS + T.HITSTOP);
  assert.equal(lancer(world).state, "recover");
  world = run(world, T.LANCE_RECOVER);
  assert.equal(lancer(world).state, "idle");
});

test("a wave's lancer leaps in from beyond the screen's edge, out of reach until it is on screen, and lands with a plunge that knocks down", () => {
  const { at } = STAGE_1.waves[2]!;
  const start = party("brakka");
  // Wave 3 begins on the next step, its lancer 50 steps in; Brakka stands where it comes down.
  const x = at + px(T.VIEW_W) - T.ENTER_INSET - px(20);
  let world = step(
    { ...moved(start, 0, x, px(160)), wave: 2, camX: at, impsSent: 2 },
    [],
  );
  world = until(world, (w) => w.enemies.some(isLancer));
  let leaper = lancer(world);
  assert.deepEqual([leaper.state, leaper.z, leaper.facing], ["leap", 0, -1]);
  assert.ok(leaper.x > world.camX + px(T.VIEW_W) + T.ENEMY_HALF_W);
  const lands = landing(leaper);
  assert.ok(Math.abs(lands.x - leaper.goal) < px(1));
  const heights: number[] = [],
    seen: boolean[] = [];
  for (let i = 0; i < T.LEAP_STEPS; i++) {
    world = step(world, []);
    leaper = lancer(world);
    heights.push(leaper.z);
    if (leaper.state === "leap") seen.push(hittable(world, leaper));
  }
  // Out of reach until its whole body is over the screen's edge, then a blade can meet it in the air.
  assert.ok(!seen[0] && seen.at(-1), seen.join());
  assert.ok(Math.max(...heights) > px(36), "a hero's jump high");
  assert.deepEqual(
    [leaper.state, leaper.x, leaper.y],
    ["plunge", lands.x, lands.y],
  );
  assert.equal(hero(world).state, "knockdown");
  assert.equal(hero(world).hp, T.HERO_HP.brakka - T.LANCER[0].damage);
  kept(world);
});

test("a lancer leaps at a hero out of its reach to land in front of it, and one who steps out of the lane is missed", () => {
  const start = foe(party("brakka"), 100, { thinkAt: 0 }, "lancer", 10);
  let world = step(start, []);
  assert.equal(lancer(world).state, "leap");
  assert.equal(lancer(world).goal, hero(world).x + T.LEAP_LAND);
  world = run(world, T.LEAP_STEPS);
  assert.equal(lancer(world).state, "plunge");
  assert.ok(Math.abs(lancer(world).x - hero(world).x - T.LEAP_LAND) < px(1));
  assert.equal(lancer(world).y, hero(world).y, "steered into its lane");
  assert.equal(hero(world).state, "knockdown");
  world = run(world, T.PLUNGE_STEPS + T.HEAVY_HITSTOP);
  assert.equal(lancer(world).state, "idle");
  // Stepping out of the lane as it flies, Brakka is not touched.
  const dodged = run(step(start, []), T.LEAP_STEPS, [DOWN]);
  assert.equal(lancer(dodged).state, "plunge");
  assert.equal(hero(dodged).hp, T.HERO_HP.brakka);
});

test("in the air a lancer is struck as any foe, a slash knocking it down; dazed it is grabbed and thrown; a spell downs it on screen only", () => {
  // A slash that would only daze a ravager knocks a leaping lancer down.
  const air = { state: "leap", z: px(10), goal: px(84) } as const;
  let world = foe(party("brakka"), 20, air);
  world = run(step(world, [ATTACK]), T.COMBO.brakka[0].startup);
  assert.equal(lancer(world).state, "knockdown");
  assert.equal(lancer(world).hp, FULL - T.COMBO.brakka[0].damage);
  // Dazed, it is grabbed and thrown over the shoulder.
  world = foe(party("brakka"), 14, { state: "hurt", timer: 1 });
  world = step(world, [ATTACK | RIGHT]);
  assert.deepEqual([lancer(world).state, hero(world).state], ["held", "grab"]);
  world = until(world, (w) => lancer(w).state === "down");
  assert.equal(lancer(world).hp, FULL - T.THROW_DAMAGE);
  // A spell downs the lancer leaping on screen; one leaping in beyond its edge flies on once the blow has landed.
  const rhea = party("rhea");
  world = { ...rhea, heroes: [{ ...hero(rhea), pots: 1 }] };
  world = foe(world, 40, { ...air, goal: px(104) });
  world = foe(world, 272, { ...air, goal: px(280), vx: -px(1) });
  world = run(step(step(world, [MAGIC]), []), T.SPELLS.rhea.levels[0]!.hit);
  assert.deepEqual(
    world.enemies.map((e) => [e.state, e.hp < FULL]),
    [
      ["knockdown", true],
      ["leap", false],
    ],
  );
});

test("lancers and ravagers share the two places by a hero: a third of either kind hovers", () => {
  const going = { state: "walk", target: 1 } as const;
  for (const [first, second, third] of [
    ["ravager", "ravager", "lancer"],
    ["lancer", "ravager", "ravager"],
  ] as const) {
    let world = foe(party("brakka"), 30, going, first);
    world = foe(world, -30, going, second);
    world = step(foe(world, 60, { thinkAt: 0 }, third), []);
    assert.deepEqual(
      world.enemies.map((e) => e.target),
      [1, 1, 0],
    );
  }
});

test("a bot keeps out of a lancer's lane closing in, steps out of its thrust and its landing, and beats every tier", () => {
  // Far off and on guard, the lancer is closed on from out of its lane; open after its thrust, it is gone straight at.
  const guarded = foe(party("brakka"), 70, { thinkAt: 999 });
  const bits = botInput(guarded, 1);
  assert.ok(bits & RIGHT && bits & UP && !(bits & DOWN), String(bits));
  guarded.enemies[0] = { ...guarded.enemies[0]!, state: "recover" };
  assert.equal(botInput(guarded, 1), RIGHT);
  const tick = (w: World) => stepTick(w, [botInput(w, 1)]);
  // A thrust wound up at it from beyond its own reach is stepped out of, as is a leap coming down on it.
  const seen = REACT + REACT_SPREAD;
  let world = foe(party("brakka"), 40, {
    state: "windup",
    timer: seen,
    target: 1,
  });
  while (lancer(world).state === "windup") world = tick(world);
  assert.equal(hero(world).hp, T.HERO_HP.brakka, "the thrust missed");
  world = step(foe(party("brakka"), 100, { thinkAt: 0 }), []);
  while (lancer(world).state === "leap") world = tick(world);
  assert.equal(hero(world).hp, T.HERO_HP.brakka, "the plunge missed");
  // One on one, each hero's bot beats a lancer of each tier without losing a life.
  for (const kind of T.HERO_KINDS)
    for (const tier of T.TIERS) {
      world = foe(party(kind), 60, {}, "lancer", 6, tier);
      for (let i = 0; i < 600 && world.enemies.length > 0; i++)
        world = tick(world);
      const result = [world.enemies.length, hero(world).lives];
      assert.deepEqual(result, [0, T.LIVES], `${kind} against tier ${tier}`);
    }
});

test("a rollback or a checkpoint mid-leap, mid-thrust and mid-plunge replays to the same world", () => {
  let opening = party("brakka", "rhea", "gorm");
  for (const [dx, dy, tier] of [
    [60, 0, 0],
    [120, 20, 1],
    [-50, -10, 2],
    [150, -20, 0],
  ] as const)
    opening = foe(opening, dx, { thinkAt: 0 }, "lancer", dy, tier);
  const bots = (w: World) => w.heroes.map((h) => botInput(w, h.id));
  const play = (w: World) => stepTick(w, bots(w));
  const trail = [opening];
  while (trail.length < 400 && trail.at(-1)!.enemies.length > 0)
    trail.push(play(trail.at(-1)!));
  const end = trail.at(-1)!;
  const first = (found: (e: Enemy) => boolean) => {
    const cut = trail.findIndex((w) => w.enemies.some(found));
    assert.ok(cut > 0, String(found));
    return cut;
  };
  for (const cut of [
    first((e) => e.state === "leap" && e.z > 0),
    first((e) => e.state === "windup" && e.timer > 0),
    first((e) => e.state === "thrust"),
    first((e) => e.state === "plunge"),
  ])
    for (const from of [trail[cut]!, decodeWorld(encodeWorld(trail[cut]!))!]) {
      let world = from;
      for (let i = cut; i < trail.length - 1; i++) world = play(world);
      assert.deepEqual(world, end);
    }
});

test("the checkpoint refuses a lancer's fields where the rules never put them, and a ravager in a lancer's state", () => {
  const leaping = { state: "leap", z: px(12), vx: -T.LEAP_VX } as const;
  const world = foe(foe(party("brakka"), 60, leaping), -30, {}, "ravager");
  kept(world);
  const refused = (index: number, change: Partial<Enemy>) => {
    const enemies = [...world.enemies];
    enemies[index] = { ...enemies[index]!, ...change };
    return decodeWorld(encodeWorld({ ...world, enemies }));
  };
  for (const [what, index, change] of [
    ["a lancer swinging a mace", 0, { state: "attack" }],
    ["a lancer slamming", 0, { state: "slam" }],
    ["a lancer standing in the air", 0, { state: "idle" }],
    ["a lancer leaping faster than a run", 0, { vx: -T.LEAP_VX - 1 }],
    ["a ravager thrusting", 1, { state: "thrust" }],
    ["a ravager leaping", 1, { state: "leap" }],
    ["a ravager plunging", 1, { state: "plunge" }],
  ] as const)
    assert.equal(refused(index, change), undefined, what);
  assert.ok(refused(0, { state: "knockdown" }), "flying from a blow");
});

test("the art plays the lancer's every state in its own frames, the leap rising exactly while it climbs", () => {
  assert.deepEqual(Object.keys(LANCER_ANIMS).sort(), [...LANCER_STATES].sort());
  for (const { frames } of Object.values(LANCER_ANIMS))
    for (const [frame] of frames) assert.ok(Object.hasOwn(LANCER_POSES, frame));
  assert.equal(enemyFrame("lancer", "thrust", 0), "thrust");
  // Drive a leap through the engine: the rising frame shows on every step it climbs, and the falling one after.
  let world = step(foe(party("brakka"), 100, { thinkAt: 0 }), []);
  const rise = enemyFrame("lancer", "leap", 0);
  let z = 0;
  while ((world = step(world, [])) && lancer(world).state === "leap") {
    const { animStep } = toView(world).enemies[0]!;
    const climbing = lancer(world).z > z;
    z = lancer(world).z;
    assert.equal(enemyFrame("lancer", "leap", animStep) === rise, climbing);
    assert.equal(climbing, animStep <= LANCER_STEPS.leapApex);
  }
  assert.ok(z < px(4) && lancer(world).state === "plunge");
});

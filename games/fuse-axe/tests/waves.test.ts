import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  DOWN,
  HERO_KINDS,
  RIGHT,
  STAGE_1,
  UP,
  createWorld,
  decodeWorld,
  encodeWorld,
  enemyMaxHp,
  showsGo,
  spawnEnemy,
  stageCleared,
  step,
  toView,
  waveSpawns,
  type Spawn,
  type World,
  type WorldView,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";

const { px, SUB } = T;
const SCREEN = T.VIEW_W * SUB;
const WAVES = STAGE_1.waves;
const hero = (world: World) => world.heroes[0]!;
const enemy = (world: World, index = 0) => world.enemies[index]!;

/** A party of `count` heroes in seats 0 up. */
const party = (count: number): World =>
  createWorld({
    seed: 4,
    heroes: Array.from({ length: count }, (_, seat) => ({
      seat,
      kind: HERO_KINDS[seat % HERO_KINDS.length]!,
    })),
  });
/** The bits held: one for every seat or by seat, or those for step `index`. */
type Bits = number | readonly number[];
type Held = Bits | ((index: number) => Bits);
/** Steps holding `held` until `done`, within a bound. */
function until(
  world: World,
  done: (world: World) => boolean,
  held: Held = 0,
): World {
  for (let index = 0; index < 3000 && !done(world); index++) {
    const bits = typeof held === "function" ? held(index) : held;
    world = step(
      world,
      typeof bits === "number" ? Array<number>(T.CAPACITY).fill(bits) : bits,
    );
  }
  assert.ok(done(world), "never happened");
  return world;
}
/** Attack pressed every other step. */
const mashing: Held = (index) => (index % 2 ? 0 : ATTACK);
const run = (world: World, steps: number, bits = 0): World =>
  until(world, (w) => w.step >= world.step + steps, bits);
/** The party marches right until the next wave begins. */
const toWave = (world: World): World =>
  until(world, (w) => w.wave > world.wave, RIGHT);
/** The latest wave's spawns for this party. */
const due = (world: World) =>
  waveSpawns(WAVES[world.wave - 1]!, world.heroes.length);
/** Until every spawn of the wave is in. */
const allIn = (world: World): World =>
  until(world, (w) => w.spawned === due(w).length);
/** Every enemy gone, as if the party had fought them all down: the rules clear the wave on the next step. */
const rout = (world: World): World => ({ ...world, enemies: [] });
/** The view's wave fields: [wave, waves, locked, go, cleared]. */
const waveOf = ({ wave, waves, locked, go, cleared }: WorldView) => [
  wave,
  waves,
  locked,
  go,
  cleared,
];

test("Stage 1 is five waves along the road, building in size and tier, the last at the stage's end", () => {
  const toughness = (spawns: readonly Spawn[]) =>
    spawns.reduce((sum, s) => sum + enemyMaxHp(s.kind, s.tier, 1), 0);
  assert.equal(WAVES.length, 5);
  WAVES.forEach((wave, index) => {
    const before = WAVES[index - 1];
    assert.ok(wave.at > (before?.at ?? 0) && wave.at <= T.CAMERA_END);
    assert.ok(wave.spawns.length > (before?.spawns.length ?? 1));
    assert.ok(toughness(wave.spawns) > toughness(before?.spawns ?? []));
    wave.spawns.forEach((spawn, i) => {
      assert.ok(spawn.y >= T.FLOOR_TOP && spawn.y <= T.FLOOR_BOTTOM);
      assert.ok(i === 0 || spawn.delay >= wave.spawns[i - 1]!.delay);
    });
    assert.deepEqual(
      waveSpawns(wave, 1),
      wave.spawns.map((spawn) => ({ ...spawn, inset: T.ENTER_INSET })),
    );
  });
  // The village gate, where the Ogre twins will stand: the violets come there.
  assert.equal(WAVES.at(-1)!.at, T.CAMERA_END);
  assert.ok(WAVES.at(-1)!.spawns.filter((s) => s.tier === 2).length >= 2);
  // Five heroes' biggest wave leaves the world plenty of room under its enemy bound.
  const most = Math.max(...WAVES.map((w) => waveSpawns(w, 5).length));
  assert.ok(most <= T.ENEMY_MAX / 4, `${most} at once`);
});

test("reaching a trigger begins its wave and locks the camera, which no hero can push past", () => {
  const start = party(1);
  assert.deepEqual(waveOf(toView(start)), [0, 5, false, false, false]);
  // Brakka walks a pixel a step and the camera follows: the step it reaches the trigger begins the wave.
  const at = WAVES[0]!.at;
  const before = until(start, (w) => w.camX >= at - px(1), RIGHT);
  assert.deepEqual(
    [before.camX, before.wave, before.enemies],
    [at - px(1), 0, []],
  );
  const reached = step(before, [RIGHT]);
  assert.equal(reached.camX, at);
  assert.deepEqual(
    [reached.wave, reached.locked, reached.waveStep, reached.spawned],
    [1, true, reached.step, 1],
  );
  assert.deepEqual(waveOf(toView(reached)), [1, 5, true, false, false]);
  const pushing = run(reached, 400, RIGHT);
  assert.equal(pushing.camX, at);
  assert.equal(hero(pushing).x, at + SCREEN - T.HERO_MARGIN);
  assert.ok(pushing.locked);
  // Once the wave is cleared the camera catches up with the hero at the edge smoothly, not in one jump.
  const freed = step(rout(pushing), [RIGHT]);
  assert.deepEqual([freed.locked, freed.camX], [false, at]);
  assert.equal(run(freed, 10, RIGHT).camX, at + 10 * T.CAMERA_SPEED);
});

test("a wave's spawns enter staggered by their delays, from their side, and walk in to a point on screen", () => {
  const begun = toWave(party(1));
  const at = WAVES[0]!.at;
  // Wave 1: two ash ravagers from the right, 40 steps apart.
  assert.equal(begun.enemies.length, 1);
  const { x, y, state, facing, goal, tier, hp } = enemy(begun);
  assert.deepEqual(
    [x, y, state, facing],
    [at + SCREEN + T.ENTER_OUT, px(132), "enter", -1],
  );
  assert.deepEqual(
    [goal, tier, hp],
    [at + SCREEN - T.ENTER_INSET, 0, T.ENEMY_HP.ravager],
  );
  assert.equal(toView(begun).enemies[0]!.anim, "enter");
  assert.equal(run(begun, 39).enemies.length, 1);
  const second = run(begun, 40);
  assert.equal(second.enemies.length, 2);
  assert.deepEqual(
    [enemy(second, 1).x, enemy(second, 1).y, enemy(second, 1).state],
    [at + SCREEN + T.ENTER_OUT, px(156), "enter"],
  );
  // They walk straight in and stand there.
  const steps = Math.ceil((T.ENTER_OUT + T.ENTER_INSET) / T.ENTER_WALK);
  const walking = run(begun, steps - 1);
  assert.equal(enemy(walking).state, "enter");
  assert.equal(enemy(walking).y, px(132));
  const arrived = run(begun, steps);
  assert.equal(enemy(arrived).state, "idle");
  assert.equal(enemy(arrived).x, at + SCREEN - T.ENTER_INSET);
  // Wave 2 brings one from the left, behind the party, and a rust one.
  const next = toWave(step(rout(allIn(begun)), []));
  const left = until(next, (w) => w.enemies.some((e) => e.facing === 1));
  const from = left.enemies.find((e) => e.facing === 1)!;
  assert.deepEqual(
    [from.x, from.goal, from.state, from.y],
    [
      WAVES[1]!.at - T.ENTER_OUT,
      WAVES[1]!.at + T.ENTER_INSET,
      "enter",
      px(150),
    ],
  );
  assert.equal(left.step - next.waveStep, 30);
  const rust = until(left, (w) => w.enemies.length === 3);
  assert.deepEqual(
    [enemy(rust, 2).tier, enemy(rust, 2).hp, toView(rust).enemies[2]!.tier],
    [1, enemyMaxHp("ravager", 1, 1), 1],
  );
});

test("a wave is fought until every spawn is in and none is left; then the lock lifts and GO shows", () => {
  const begun = toWave(party(1));
  // The first is gone but the second is still due: still locked.
  const early = step(rout(begun), [0]);
  assert.deepEqual([early.locked, showsGo(early)], [true, false]);
  const clear = step(rout(allIn(begun)), [0]);
  assert.equal(clear.locked, false);
  assert.equal(clear.goUntil, clear.step + T.GO_STEPS);
  assert.deepEqual(waveOf(toView(clear)), [1, 5, false, true, false]);
  // While the party waits at the trigger, GO stays on past its two seconds.
  const waiting = run(clear, T.GO_STEPS + 30);
  assert.equal(waiting.camX, WAVES[0]!.at);
  assert.ok(showsGo(waiting));
  // Moving on, GO stops after its two seconds.
  const moving = run(clear, T.GO_STEPS, RIGHT);
  assert.equal(moving.camX, WAVES[0]!.at + T.GO_STEPS * T.WALK.brakka.x);
  assert.ok(showsGo(moving));
  assert.equal(showsGo(step(moving, [RIGHT])), false);
  // The next trigger begins the next wave.
  const second = toWave(moving);
  assert.deepEqual(
    [second.wave, second.locked, showsGo(second)],
    [2, true, false],
  );
});

test("fighting through every wave clears the stage, and the camera then reaches the stage's end", () => {
  let world = party(2);
  for (const [index, wave] of WAVES.entries()) {
    world = toWave(world);
    assert.deepEqual([world.wave, world.camX], [index + 1, wave.at]);
    assert.ok(!stageCleared(world));
    world = step(rout(allIn(world)), []);
    const last = index === WAVES.length - 1;
    assert.deepEqual(
      [world.locked, showsGo(world), stageCleared(world)],
      [false, !last, last],
    );
  }
  assert.deepEqual(waveOf(toView(world)), [5, 5, false, false, true]);
  const end = run(world, 600, RIGHT);
  assert.equal(end.camX, T.CAMERA_END);
  assert.equal(hero(end).x, T.STAGE_LENGTH - T.HERO_MARGIN);
  assert.ok(stageCleared(end) && end.enemies.length === 0);
  assert.deepEqual(decodeWorld(structuredClone(encodeWorld(end))), end);
});

test("each hero beyond the first adds a spawn from the other side, and a quarter more hit points", () => {
  const wave = WAVES[0]!;
  assert.deepEqual(waveSpawns(wave, 0), waveSpawns(wave, 1));
  assert.deepEqual(waveSpawns(wave, 9), waveSpawns(wave, 5));
  // The extras copy the wave's spawns in turn, from the left and mirrored in depth, later and further in each pass.
  const mirror = (y: number) => T.FLOOR_TOP + T.FLOOR_BOTTOM - px(y);
  assert.deepEqual(
    waveSpawns(wave, 5).map((s) => [s.side, s.y, s.delay, s.inset]),
    [
      ["right", px(132), 0, T.ENTER_INSET],
      ["left", mirror(132), 30, T.ENTER_INSET + T.ENTER_STAGGER],
      ["right", px(156), 40, T.ENTER_INSET],
      ["left", mirror(132), 60, T.ENTER_INSET + 2 * T.ENTER_STAGGER],
      ["left", mirror(156), 70, T.ENTER_INSET + T.ENTER_STAGGER],
      ["left", mirror(156), 100, T.ENTER_INSET + 2 * T.ENTER_STAGGER],
    ],
  );
  assert.deepEqual(
    T.TIERS.map((tier) =>
      [1, 2, 3, 4, 5].map((heroes) => enemyMaxHp("ravager", tier, heroes)),
    ),
    [
      [40, 50, 60, 70, 80],
      [50, 62, 75, 87, 100],
      [60, 75, 90, 105, 120],
    ],
  );
  for (const [heroes, size, hp] of [
    [1, 2, 40],
    [5, 6, 80],
  ] as const) {
    const world = until(allIn(toWave(party(heroes))), (w) =>
      w.enemies.every((e) => e.state === "idle"),
    );
    assert.equal(world.enemies.length, size, `${heroes} heroes`);
    assert.ok(world.enemies.every((e) => e.hp === hp));
    assert.ok(toView(world).enemies.every((e) => e.maxHp === hp));
    // Every one stands on screen, none on another's spot.
    const spots = new Set(world.enemies.map((e) => `${e.x},${e.y}`));
    assert.equal(spots.size, size);
    assert.ok(
      world.enemies.every((e) => e.x > world.camX && e.x < world.camX + SCREEN),
    );
  }
});

test("a blade lands on an enemy walking in only once its whole body is on screen", () => {
  // Rhea steps into the first ravager's lane and up to the screen's right edge while Brakka holds the camera back,
  // then both march until the wave begins: she stands at the edge, facing the ravager walking in through her reach.
  const rhea = (w: World) => w.heroes[1]!;
  let world = until(party(2), (w) => rhea(w).y >= px(132), [0, DOWN]);
  world = until(world, (w) => rhea(w).x === w.camX + SCREEN - T.HERO_MARGIN, [
    0,
    RIGHT,
  ]);
  world = toWave(world);
  // (A pixel short: the camera moved on after she was held to its edge.)
  assert.equal(rhea(world).x, world.camX + SCREEN - T.HERO_MARGIN - px(1));
  const full = enemyMaxHp("ravager", 0, 2),
    begun = world.step;
  let before = world;
  while (enemy(world).hp === full) {
    assert.ok(world.step < begun + 200, "never hit");
    before = world;
    world = step(world, [0, world.step % 2 ? 0 : ATTACK]);
  }
  assert.equal(enemy(before).state, "enter");
  assert.ok(enemy(before).x <= before.camX + SCREEN - T.ENEMY_HALF_W);
  assert.ok(
    world.step - begun >
      (T.ENTER_OUT + T.ENEMY_HALF_W) / T.ENTER_WALK - T.COMBO.rhea[0].startup,
    "it walked through her swings unharmed while off screen",
  );
});

test("while the screen is locked, an enemy knocked out of it gets up and walks back in", () => {
  let world = until(allIn(toWave(party(1))), (w) =>
    w.enemies.every((e) => e.state === "idle"),
  );
  const target = enemy(world);
  // Line up behind the first ravager and mash until the finisher throws it off the right of the screen.
  world = until(world, (w) => hero(w).y <= target.y + px(1), UP);
  world = until(world, (w) => hero(w).x >= target.x - px(24), RIGHT);
  world = until(world, (w) => enemy(w).state === "down", mashing);
  assert.ok(enemy(world).x > world.camX + SCREEN - T.ENEMY_HALF_W);
  world = until(world, (w) => enemy(w).state !== "down");
  world = until(world, (w) => enemy(w).state !== "getup");
  assert.equal(enemy(world).state, "enter");
  assert.deepEqual(
    [enemy(world).goal, enemy(world).facing],
    [world.camX + SCREEN - T.RETURN_INSET, -1],
  );
  world = until(world, (w) => enemy(w).state === "idle");
  assert.equal(enemy(world).x, world.camX + SCREEN - T.RETURN_INSET);
  // With the screen not locked, one left outside it stays where it is.
  const behind = spawnEnemy(party(1), "ravager", px(2), px(130));
  assert.deepEqual(
    [enemy(run(behind, 60)).state, enemy(run(behind, 60)).x],
    ["idle", px(2)],
  );
});

test("a wave's next spawn waits while the world holds the most enemies", () => {
  let world = party(1);
  for (let index = 0; index < T.ENEMY_MAX; index++)
    world = spawnEnemy(world, "ravager", T.STAGE_LENGTH, px(110 + index));
  world = toWave(world);
  assert.deepEqual([world.locked, world.spawned], [true, 0]);
  world = step({ ...world, enemies: world.enemies.slice(1) }, [0]);
  assert.deepEqual(
    [world.spawned, world.enemies.length, enemy(world, T.ENEMY_MAX - 1).state],
    [1, T.ENEMY_MAX, "enter"],
  );
});

test("a world mid-wave, with GO up or with the stage cleared survives the checkpoint and plays on identically", () => {
  const mid = until(toWave(step(rout(allIn(toWave(party(2)))), [])), (w) =>
    w.enemies.some((e) => e.state === "enter" && e.facing === 1),
  );
  assert.ok(mid.locked && mid.spawned < due(mid).length);
  const go = step(rout(allIn(mid)), []);
  assert.ok(showsGo(go));
  for (const world of [mid, go]) {
    const back = decodeWorld(structuredClone(encodeWorld(world)))!;
    assert.deepEqual(back, world);
    assert.deepEqual(run(back, 300, RIGHT), run(world, 300, RIGHT));
  }
});

test("a world with corrupt wave fields is refused whole", () => {
  const mid = until(toWave(party(2)), (w) => w.enemies.length > 0);
  const go = step(rout(allIn(mid)), []);
  const encoded = (world: World) => encodeWorld(world) as unknown[];
  const broken = (world: World, change: (f: unknown[]) => void) => {
    const copy = structuredClone(encoded(world));
    change(copy);
    return decodeWorld(copy);
  };
  const fresh = run(party(1), 5),
    at = WAVES[0]!.at,
    count = due(mid).length;
  // The edges the rules reach are kept.
  for (const [what, world, change] of [
    ["all of a wave's spawns in", mid, (f) => (f[11] = count)],
    ["a GO just begun", go, (f) => (f[12] = go.step + T.GO_STEPS)],
    ["the camera just short of the next", go, (f) => (f[4] = WAVES[1]!.at - 1)],
  ] as [string, World, (f: unknown[]) => void][])
    assert.ok(broken(world, change), what);
  for (const [what, world, change] of [
    ["a wave past the last", mid, (f) => (f[8] = WAVES.length + 1)],
    ["a negative wave", mid, (f) => (f[8] = -1)],
    ["a lock as a number", mid, (f) => (f[9] = 1)],
    ["a locked camera past its trigger", mid, (f) => (f[4] = at + 1)],
    ["a camera short of the wave begun", go, (f) => (f[4] = at - 1)],
    ["a camera at the next trigger, unbegun", go, (f) => (f[4] = WAVES[1]!.at)],
    ["unlocked with spawns still due", mid, (f) => (f[9] = false)],
    ["more spawned than the wave holds", mid, (f) => (f[11] = count + 1)],
    ["a negative spawn count", mid, (f) => (f[11] = -1)],
    ["a wave begun in the future", mid, (f) => (f[10] = mid.step + 1)],
    ["a fractional begin step", mid, (f) => (f[10] = 0.5)],
    ["a GO past its length", go, (f) => (f[12] = go.step + T.GO_STEPS + 1)],
    ["no wave but locked", fresh, (f) => (f[9] = true)],
    ["no wave but spawned", fresh, (f) => (f[11] = 1)],
    ["no wave but a begin step", fresh, (f) => (f[10] = 2)],
    ["no wave but GO", fresh, (f) => (f[12] = 1)],
    ["no wave at its trigger", fresh, (f) => (f[4] = at)],
  ] as [string, World, (f: unknown[]) => void][])
    assert.equal(broken(world, change), undefined, what);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  DOWN,
  HERO_KINDS,
  JUMP,
  LEFT,
  RIGHT,
  UP,
  createWorld,
  decodeWorld,
  encodeWorld,
  revive,
  spawnEnemy,
  step,
  stepTick,
  toView,
  type Enemy,
  type Hero,
  type HeroKind,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";

const { px } = T;
const FULL = T.ENEMY_HP.ravager;
const hero = (world: World, index = 0) => world.heroes[index]!;
const enemy = (world: World, index = 0) => world.enemies[index]!;
const solo = (kind: HeroKind = "brakka") =>
  createWorld({ seed: 1, heroes: [{ seat: 0, kind }] });
/** Steps with seat 0 holding each entry's bits in turn. */
const play = (world: World, rows: readonly number[]): World =>
  rows.reduce((w, bits) => step(w, [bits]), world);
const hold = (bits: number, steps: number) => Array<number>(steps).fill(bits);
/** A double tap of `side`: held `tap` steps, let go `gap` steps, then pressed again. */
const tapTap = (side: number, tap = 2, gap = 4) => [
  ...hold(side, tap),
  ...hold(0, gap),
  side,
];
/** Steps holding `bits` until `done`, within a bound. */
function until(world: World, done: (world: World) => boolean, bits = 0): World {
  for (let index = 0; index < 500 && !done(world); index++)
    world = step(world, [bits]);
  assert.ok(done(world), "never happened");
  return world;
}
const withHero = (world: World, change: Partial<Hero>): World => ({
  ...world,
  heroes: [{ ...hero(world), ...change }, ...world.heroes.slice(1)],
});
const withEnemy = (world: World, change: Partial<Enemy>): World => ({
  ...world,
  enemies: [{ ...enemy(world), ...change }, ...world.enemies.slice(1)],
});
/** A hero of `kind` running right, a few steps in. */
const running = (kind: HeroKind = "brakka") =>
  play(solo(kind), [...tapTap(RIGHT), RIGHT, RIGHT]);
/** The world's first enemy at the end of its wind-up `dx` px from the hero, in its lane and facing it. */
function armed(world: World, dx: number): World {
  const { x, y } = hero(world),
    facing = dx < 0 ? 1 : -1;
  return withEnemy(world, {
    state: "windup",
    timer: T.RAVAGER[enemy(world).tier].windup - 1,
    x: x + px(dx),
    y,
    facing,
  });
}

test("a double tap of Left or Right runs; a slow tap or gap, the other side or a held direction walks", () => {
  const state = (rows: readonly number[]) => {
    const { state, facing } = hero(play(solo(), rows));
    return `${state} ${facing}`;
  };
  assert.equal(state(tapTap(RIGHT)), "run 1");
  assert.equal(state(tapTap(LEFT)), "run -1");
  // The first press is a tap for `RUN_TAP` steps, and the second counts for `RUN_GAP` after letting go.
  assert.equal(state(tapTap(RIGHT, T.RUN_TAP)), "run 1");
  assert.equal(state(tapTap(RIGHT, T.RUN_TAP + 1)), "walk 1");
  assert.equal(state(tapTap(RIGHT, 2, T.RUN_GAP)), "run 1");
  assert.equal(state(tapTap(RIGHT, 2, T.RUN_GAP + 1)), "walk 1");
  assert.equal(state([RIGHT, 0, LEFT]), "walk -1");
  assert.equal(state([LEFT, 0, RIGHT]), "walk 1");
  // The other side between the taps cancels the first, and both at once are no tap.
  assert.equal(state([RIGHT, 0, LEFT, 0, RIGHT]), "walk 1");
  assert.equal(state([LEFT | RIGHT, 0, RIGHT]), "walk 1");
  // A double tap with the other side held waits for it to let go.
  const across = [LEFT, LEFT | RIGHT, LEFT, LEFT | RIGHT];
  assert.equal(state(across), "idle -1");
  assert.equal(state([...across, RIGHT]), "run 1");
  // Depth is no side: Up and Down neither make a tap nor break one.
  assert.equal(state([RIGHT, UP, RIGHT]), "run 1");
  assert.equal(state(tapTap(UP)), "walk 1");
  // A side tapped with Up or Down held is a tap of it, and the run steers in depth with them still held.
  assert.equal(state([UP, UP | RIGHT, UP, UP | RIGHT]), "run 1");
  assert.equal(state([DOWN | LEFT, DOWN, DOWN | LEFT]), "run -1");
  // Holding a side never repeats, and a run lasts while it is held.
  let world = solo();
  for (let index = 0; index < 200; index++) {
    world = step(world, [RIGHT]);
    assert.equal(hero(world).state, "walk");
  }
  world = play(solo(), [...tapTap(RIGHT), ...hold(RIGHT, 60)]);
  assert.deepEqual([hero(world).state, hero(world).timer], ["run", 60]);
  // A tap shorter than a log tick still taps, folded into the tick's first step as Choppers folds it.
  world = stepTick(stepTick(stepTick(solo(), [0], [RIGHT]), [0]), [RIGHT]);
  assert.equal(hero(world).state, "run");
  assert.equal(toView(world).heroes[0]!.anim, "run");
});

test("taps each shorter than a log tick fold into one press apiece: two make a run of a step, one makes none", () => {
  // A log tick logs a quick tap as a press then a release, which `stepTick` folds into the first step alone.
  const tap = (world: World) => stepTick(world, [0], [RIGHT]);
  const rest = (world: World) => stepTick(world, [0]);
  const once = tap(solo());
  assert.deepEqual([hero(once).state, hero(once).tap], ["idle", RIGHT]);
  // Left alone it is one tap, not two: later ticks start no run, and the tap lapses.
  const left = rest(rest(rest(once)));
  assert.deepEqual([hero(left).state, hero(left).runBuf], ["idle", 0]);
  assert.equal(hero(left).x, hero(once).x);
  // A second quick tap in the next tick is the double tap: the run lasts the one step Right is down.
  const twice = tap(once);
  assert.equal(hero(twice).x - hero(once).x, T.RUN.brakka);
  assert.equal(hero(twice).state, "idle");
  assert.equal(hero(rest(twice)).x, hero(twice).x);
  // The same pair a tick or two further apart is still a double tap, and one beyond the gap is a walk step.
  const gap = (ticks: number) => {
    let world = once;
    for (let index = 0; index < ticks; index++) world = rest(world);
    return hero(tap(world)).x - hero(once).x;
  };
  assert.equal(gap(2), T.RUN.brakka);
  assert.equal(
    gap(Math.ceil(T.RUN_GAP / T.STEPS_PER_TICK) + 1),
    T.WALK.brakka.x,
  );
});

test("a run is about twice the walk along the road, Gorm slowest, steers in depth at the walk's pace and the camera keeps up", () => {
  for (const kind of HERO_KINDS) {
    const world = running(kind),
      on = step(world, [RIGHT]),
      steered = step(world, [RIGHT | DOWN]);
    assert.equal(hero(on).x - hero(world).x, T.RUN[kind], kind);
    assert.equal(hero(on).y, hero(world).y);
    assert.ok(T.RUN[kind] >= 1.8 * T.WALK[kind].x, kind);
    assert.ok(T.RUN[kind] <= 2 * T.WALK[kind].x, kind);
    assert.deepEqual(
      [hero(steered).state, hero(steered).x - hero(world).x],
      ["run", T.RUN[kind]],
    );
    assert.equal(hero(steered).y - hero(world).y, T.WALK[kind].y);
    assert.equal(
      hero(step(world, [RIGHT | UP])).y - hero(world).y,
      -T.WALK[kind].y,
    );
  }
  assert.ok(T.RUN.gorm < T.RUN.brakka && T.RUN.brakka < T.RUN.rhea);
  // A run across the screen is never held back at its edge: the camera keeps the runner at its lead.
  const far = play(running(), hold(RIGHT, 100));
  assert.equal(hero(far).x - hero(running()).x, 100 * T.RUN.brakka);
  assert.equal(hero(far).x - far.camX, T.CAMERA_LEAD);
});

test("a run ends when its side is let go or the other is pressed, and when a mace lands", () => {
  const world = running(),
    { x } = hero(world);
  assert.deepEqual(
    [hero(step(world, [0])).state, hero(step(world, [0])).x],
    ["idle", x],
  );
  assert.equal(hero(step(world, [UP])).state, "walk");
  assert.equal(hero(step(world, [LEFT | RIGHT])).state, "idle");
  const back = hero(step(world, [LEFT]));
  assert.deepEqual(
    [back.state, back.facing, back.x],
    ["walk", -1, x - T.WALK.brakka.x],
  );
  // A ravager ahead brings its mace down on the runner: it reels, and walks on after with Right still held.
  let hit = step(armed(spawnEnemy(world, "ravager", x, hero(world).y), 24), [
    RIGHT,
  ]);
  assert.equal(hero(hit).state, "hurt");
  hit = until(hit, (w) => hero(w).state !== "hurt", RIGHT);
  assert.equal(hero(hit).state, "walk");
});

test("Attack from a run dashes: it slides forward, knocks down each enemy in its lane once and misses one out of it", () => {
  for (const kind of HERO_KINDS) {
    const dash = T.DASH[kind];
    let world = running(kind);
    const { x, y } = hero(world);
    // One ahead, out of the blow's reach until the dash slides up to it, and one beside it a step out of the lane.
    world = spawnEnemy(world, "ravager", x + px(40), y);
    world = spawnEnemy(world, "ravager", x + px(40), y + T.LANE + 1);
    world = step(world, [RIGHT | ATTACK]);
    assert.deepEqual([hero(world).state, hero(world).struck], ["dash", []]);
    world = until(world, (w) => hero(w).state === "idle");
    assert.equal(hero(world).x - x, dash.active * dash.speed, kind);
    assert.equal(enemy(world).hp, FULL - dash.damage, kind);
    assert.ok(["knockdown", "down"].includes(enemy(world).state), kind);
    assert.equal(enemy(world, 1).hp, FULL, kind);
    assert.deepEqual(
      [hero(world).knockdowns, hero(world).damage],
      [1, dash.damage],
    );
  }
  // Alone, it slides its active steps and stands through its recovery, then is idle: the dash is no faster than the
  // camera, nor anything else a hero does.
  for (const kind of HERO_KINDS) {
    const dash = T.DASH[kind];
    let world = step(running(kind), [RIGHT | ATTACK]);
    const seen: string[] = [];
    for (let index = 0; index < dash.active + dash.recovery; index++) {
      seen.push(hero(world).state);
      world = step(world, [RIGHT]);
    }
    assert.deepEqual(
      seen,
      hold(0, dash.active + dash.recovery).map(() => "dash"),
    );
    assert.equal(hero(world).state, "walk");
    assert.ok(dash.speed < T.CAMERA_SPEED);
  }
  assert.ok(T.DASH.gorm.damage > T.DASH.brakka.damage);
  assert.ok(T.DASH.brakka.damage > T.DASH.rhea.damage);
});

test("a press in a dash's recovery waits for its end, and a double tap in a landing runs once it is free", () => {
  const dash = T.DASH.brakka;
  const struck = (bits: number) =>
    play(step(running(), [RIGHT | ATTACK]), [
      ...hold(0, dash.active + dash.recovery - 3),
      bits,
      0,
      0,
    ]);
  assert.equal(hero(struck(ATTACK)).state, "attack1");
  assert.equal(hero(struck(JUMP)).state, "jump");
  // From a running jump, Right tapped twice as it lands.
  let world = until(
    step(running(), [RIGHT | JUMP]),
    (w) => hero(w).state === "land",
  );
  world = play(world, [RIGHT, 0, RIGHT]);
  assert.equal(hero(world).state, "land");
  assert.ok(hero(world).runBuf > 0);
  world = until(world, (w) => hero(w).state !== "land", RIGHT);
  assert.equal(hero(world).state, "run");
});

test("a running jump keeps the run's speed and carries further than a walking one", () => {
  for (const kind of HERO_KINDS) {
    const leap = (world: World) => {
      const { x } = hero(world);
      world = step(world, [RIGHT | JUMP]);
      assert.equal(hero(world).state, "jump");
      const { vx } = hero(world);
      world = until(world, (w) => hero(w).state === "land", RIGHT);
      return { vx, distance: hero(world).x - x };
    };
    const walked = leap(play(solo(kind), hold(RIGHT, 4))),
      ran = leap(running(kind));
    assert.deepEqual([walked.vx, ran.vx], [T.WALK[kind].x, T.RUN[kind]], kind);
    assert.ok(ran.distance > walked.distance, kind);
    assert.equal(ran.distance * T.WALK[kind].x, walked.distance * T.RUN[kind]);
  }
});

test("no run or dash while reeling, lying, getting up or in hit-stop: a double tap there waits its buffer and no more", () => {
  for (const state of ["hurt", "knockdown", "down", "getup"] as const) {
    let world = withHero(solo(), {
      state,
      timer: 0,
      ...(state === "knockdown" ? { vz: T.KNOCK_VZ, z: px(1) } : {}),
    });
    world = play(world, [...tapTap(RIGHT), RIGHT]);
    assert.equal(hero(world).state, state);
    world = until(
      world,
      (w) => ["idle", "walk"].includes(hero(w).state),
      RIGHT,
    );
    assert.equal(hero(world).state, "walk", state);
    assert.equal(hero(step(world, [RIGHT | ATTACK])).state, "attack1");
  }
  // Hit-stop holds the hero and the double tap it makes in place; Right still held, it runs as the stop ends.
  const stopped = withHero(solo(), { stopUntil: T.HEAVY_HITSTOP });
  let world = play(stopped, [...tapTap(RIGHT, 1, 1), ...hold(RIGHT, 5)]);
  assert.deepEqual(
    [hero(world).state, hero(world).x],
    ["idle", hero(stopped).x],
  );
  world = step(world, [RIGHT]);
  assert.equal(hero(world).state, "run");
  // And a running hero in hit-stop does not dash until it ends.
  const halted = withHero(running(), { stopUntil: running().step + 2 });
  assert.equal(hero(play(halted, [RIGHT | ATTACK, RIGHT])).state, "run");
  assert.equal(
    hero(play(halted, [RIGHT | ATTACK, RIGHT, RIGHT])).state,
    "dash",
  );
});

test("a mace breaks off a dash, and an enemy goes round to the back of a dashing hero as of a swinging one", () => {
  let world = step(running(), [RIGHT | ATTACK]);
  const { x, y } = hero(world);
  world = step(armed(spawnEnemy(world, "ravager", x, y), -24), [RIGHT]);
  assert.equal(hero(world).state, "hurt");
  assert.equal(enemy(world).hp, FULL);
  world = until(world, (w) => hero(w).state !== "hurt", RIGHT);
  assert.equal(hero(world).state, "walk");
  // A ravager ahead going for the hero takes its own side of a runner, and the far side of one dashing at it.
  const ahead = withEnemy(
    spawnEnemy(running(), "ravager", hero(running()).x + px(80), y),
    { state: "walk", target: hero(running()).id },
  );
  const side = (bits: number) => {
    const after = step(ahead, [bits]);
    return Math.sign(enemy(after).goal - hero(after).x);
  };
  assert.equal(side(RIGHT), 1);
  assert.equal(side(RIGHT | ATTACK), -1);
});

test("a world mid-run or mid-dash survives the checkpoint whole and steps on from it identically, and a continue forgets a tap", () => {
  const kept = (world: World) => {
    const back = decodeWorld(structuredClone(encodeWorld(world)));
    assert.deepEqual(back, world);
    const rows = [RIGHT | ATTACK, ...hold(RIGHT, 20), ...tapTap(LEFT)];
    assert.deepEqual(play(back!, rows), play(world, rows));
  };
  const world = spawnEnemy(running("rhea"), "ravager", px(120), px(138));
  kept(world);
  kept(play(world, [0, RIGHT]));
  kept(play(world, [RIGHT | ATTACK, RIGHT]));
  const hit = until(
    step(world, [RIGHT | ATTACK]),
    (w) => w.step <= hero(w).stopUntil,
  );
  kept(hit);
  kept(until(hit, (w) => hero(w).timer >= T.DASH.rhea.active));
  // A continue drops back in with nothing waiting, a tap included.
  const tapped = play(solo(), [RIGHT, 0, 0]);
  assert.notEqual(hero(tapped).tapUntil, 0);
  const revived = revive(withHero(tapped, { runBuf: T.BUFFER_STEPS }));
  assert.deepEqual(
    [hero(revived).tap, hero(revived).tapUntil, hero(revived).runBuf],
    [0, 0, 0],
  );
});

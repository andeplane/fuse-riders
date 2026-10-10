import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  DOWN,
  ENEMY_STATES,
  HERO_KINDS,
  HERO_STATES,
  INPUT_MASK,
  JUMP,
  LEFT,
  RIGHT,
  RULES,
  STAGE_1,
  UP,
  createWorld,
  isInput,
  pressed,
  released,
  seedOf,
  spawnEnemy,
  step,
  stepTick,
  toView,
  waveSpawns,
  type HeroKind,
  type World,
} from "../src/engine/index.js";
import { div } from "../src/engine/math.js";
import { next } from "../src/engine/rng.js";
import * as T from "../src/engine/tuning.js";
import * as Kit from "../src/engine/view-kit.js";

const { SUB, px } = T;
const solo = (kind: HeroKind = "brakka", seat = 0): World =>
  createWorld({ seed: 7, heroes: [{ seat, kind }] });
function run(world: World, held: readonly number[], steps: number): World {
  for (let index = 0; index < steps; index++) world = step(world, held);
  return world;
}
const hero = (world: World, index = 0) => world.heroes[index]!;

test("presses and releases come from the previous step's held bits", () => {
  assert.equal(pressed(LEFT | JUMP, LEFT), JUMP);
  assert.equal(pressed(LEFT, LEFT), 0);
  assert.equal(released(LEFT, LEFT | JUMP), JUMP);
  assert.ok(isInput(0) && isInput(INPUT_MASK));
  for (const bad of [-1, INPUT_MASK + 1, 1.5, "1", 2 ** 32])
    assert.ok(!isInput(bad), String(bad));
  // A held button presses once: holding JUMP from the start jumps once, then stands.
  const world = run(solo(), [JUMP], 120);
  assert.equal(hero(world).state, "idle");
  assert.equal(hero(world).held, JUMP);
  // A tap shorter than a tick is folded into the tick's first step, and still presses.
  const tapped = stepTick(solo(), [0], [JUMP]);
  assert.equal(hero(tapped).state, "jump");
  assert.equal(hero(tapped).held, 0);
  // A direction tapped for less than a tick walks for that first step only, and opposite taps cancel, as in
  // Choppers' fold.
  const walked = (held: number, first: number) =>
    hero(stepTick(solo(), [held], [first])).x - hero(solo()).x;
  assert.equal(walked(0, RIGHT), T.WALK.brakka.x);
  assert.equal(walked(0, LEFT), -T.WALK.brakka.x);
  assert.equal(walked(RIGHT, LEFT | RIGHT), 2 * T.WALK.brakka.x);
  assert.equal(walked(RIGHT, RIGHT), 3 * T.WALK.brakka.x);
});

test("createWorld seats heroes in id order across the left of the screen", () => {
  const world = createWorld({
    seed: 42,
    heroes: [
      { seat: 2, kind: "gorm" },
      { seat: 0, kind: "rhea" },
    ],
  });
  assert.deepEqual(
    world.heroes.map((h) => [h.id, h.seat, h.kind, h.state]),
    [
      [1, 0, "rhea", "idle"],
      [2, 2, "gorm", "idle"],
    ],
  );
  assert.equal(world.nextId, 3);
  assert.equal(world.seed, 42);
  assert.notEqual(world.rng, createWorld({ seed: 43, heroes: [] }).rng);
  const all = createWorld({
    seed: 1,
    heroes: [0, 1, 2, 3, 4].map((seat) => ({ seat, kind: "brakka" as const })),
  });
  for (const h of all.heroes) {
    assert.ok(h.x >= T.HERO_MARGIN && h.x < px(T.VIEW_W / 3));
    assert.ok(h.y >= T.FLOOR_TOP && h.y <= T.FLOOR_BOTTOM);
  }
  assert.equal(new Set(all.heroes.map((h) => `${h.x},${h.y}`)).size, 5);
  for (const seats of [[0, 0], [5], [-1], [1.5]])
    assert.throws(
      () =>
        createWorld({
          seed: 1,
          heroes: seats.map((seat) => ({ seat, kind: "rhea" })),
        }),
      RangeError,
    );
  for (const kind of ["bogus", undefined, "toString"])
    assert.throws(
      () =>
        createWorld({
          seed: 1,
          heroes: [{ seat: 0, kind: kind as unknown as HeroKind }],
        }),
      RangeError,
      String(kind),
    );
});

test("heroes walk in eight directions, slower in depth, and no diagonal beats straight", () => {
  const moved = (kind: HeroKind, bits: number) => {
    const before = hero(solo(kind)),
      after = hero(step(solo(kind), [bits]));
    return { dx: after.x - before.x, dy: after.y - before.y, after };
  };
  const speeds = HERO_KINDS.map((kind) => moved(kind, RIGHT).dx);
  const [brakka, rhea, gorm] = speeds;
  assert.ok(rhea! > brakka! && brakka! > gorm!, "Rhea fastest, Gorm slowest");
  for (const kind of HERO_KINDS) {
    const straightX = moved(kind, RIGHT).dx,
      straightY = moved(kind, DOWN).dy;
    assert.ok(straightY > 0 && straightY < straightX, kind);
    assert.equal(moved(kind, LEFT).dx, -straightX);
    assert.equal(moved(kind, UP).dy, -straightY);
    assert.equal(moved(kind, LEFT | RIGHT).dx, 0);
    assert.equal(moved(kind, LEFT | RIGHT).after.state, "idle");
    for (const bits of [RIGHT | DOWN, RIGHT | UP, LEFT | DOWN, LEFT | UP]) {
      const { dx, dy, after } = moved(kind, bits);
      assert.ok(dx !== 0 && dy !== 0 && after.state === "walk");
      const norm = (dx / straightX) ** 2 + (dy / straightY) ** 2;
      assert.ok(norm <= 1 && norm > 0.97, `${kind} ${bits}: ${norm}`);
    }
  }
});

test("facing follows horizontal input and holds otherwise", () => {
  let world = step(solo(), [LEFT]);
  assert.equal(hero(world).facing, -1);
  world = run(world, [UP], 3);
  world = run(world, [0], 3);
  assert.equal(hero(world).facing, -1);
  assert.equal(hero(world).state, "idle");
  world = step(world, [RIGHT | DOWN]);
  assert.equal(hero(world).facing, 1);
});

test("heroes keep to the floor band and the screen", () => {
  assert.equal(hero(run(solo(), [UP], 200)).y, T.FLOOR_TOP);
  assert.equal(hero(run(solo(), [DOWN], 200)).y, T.FLOOR_BOTTOM);
  const left = run(solo(), [LEFT], 200);
  assert.equal(hero(left).x, T.HERO_MARGIN);
  assert.equal(hero(left).state, "walk");
  // The idle seat-1 hero holds the camera, so the leader walks into the screen's right edge.
  const pair = createWorld({
    seed: 3,
    heroes: [
      { seat: 0, kind: "rhea" },
      { seat: 1, kind: "gorm" },
    ],
  });
  const pushed = run(pair, [RIGHT], 400);
  assert.equal(pushed.camX, hero(pair, 1).x - T.HERO_MARGIN);
  assert.equal(hero(pushed, 1).x, hero(pair, 1).x);
  assert.equal(hero(pushed).x, pushed.camX + T.VIEW_W * SUB - T.HERO_MARGIN);
  // Once the straggler walks on, the camera follows the leader again.
  const caught = run(pushed, [RIGHT, RIGHT], 200);
  assert.ok(caught.camX > pushed.camX);
});

test("a jump rises about 38 px, keeps its launch momentum and lands with a short recovery", () => {
  let world = step(solo(), [RIGHT | JUMP]);
  let apex = 0,
    airborne = 1,
    lastX = hero(world).x;
  while (hero(world).state === "jump") {
    world = step(world, [LEFT]); // no steering in the air
    apex = Math.max(apex, hero(world).z);
    assert.ok(hero(world).x > lastX && hero(world).facing === 1);
    lastX = hero(world).x;
    airborne++;
  }
  assert.ok(apex >= px(36) && apex <= px(40), `apex ${apex / SUB} px`);
  assert.ok(airborne >= 36 && airborne <= 42, `${airborne} steps in the air`);
  assert.equal(hero(world).z, 0);
  let landing = 1;
  for (; hero(step(world, [LEFT])).state === "land"; landing++) {
    world = step(world, [LEFT]);
    assert.equal(hero(world).x, lastX, "a landing hero stands still");
  }
  assert.equal(landing, T.LAND_STEPS);
  world = step(world, [LEFT | JUMP]);
  assert.equal(hero(world).state, "jump", "a fresh press jumps right after");
  assert.equal(hero(world).facing, -1);
  assert.ok(hero(world).x < lastX);
});

test("the camera follows forward only, never leaves the leftmost hero and stops at the first wave", () => {
  let world = solo();
  let lastCam = 0;
  for (let index = 0; index < 200; index++) {
    world = step(world, [RIGHT]);
    assert.ok(world.camX >= lastCam);
    lastCam = world.camX;
  }
  assert.ok(world.camX > 0);
  assert.equal(hero(world).x - world.camX, T.CAMERA_LEAD);
  const back = run(world, [LEFT], 400);
  assert.equal(back.camX, world.camX, "the camera never scrolls back");
  assert.equal(hero(back).x, back.camX + T.HERO_MARGIN);
  // The stage's end, past every wave, is in waves.test.ts.
  const on = run(world, [RIGHT], div(T.STAGE_LENGTH, T.WALK.brakka.x));
  assert.equal(on.camX, STAGE_1.waves[0]!.at);
  assert.equal(run(createWorld({ seed: 1, heroes: [] }), [], 5).camX, 0);
});

/** Held bits that change every few steps, from a seeded stream, for every seat. */
function script(seed: number, steps: number): number[][] {
  let state = seed;
  const rows: number[][] = [];
  for (let index = 0; index < steps; index++) {
    if (index % 7 === 0 || rows.length === 0) {
      const row: number[] = [];
      for (let seat = 0; seat < T.CAPACITY; seat++) {
        const draw = next(state);
        state = draw.state;
        row.push(draw.value & INPUT_MASK);
      }
      rows.push(row);
    } else rows.push(rows[index - 1]!);
  }
  return rows;
}

/** A crowd of ravagers just ahead of the heroes, across the floor, so random play fights. */
function crowd(world: World): World {
  for (let x = 72; x <= 132; x += 12)
    for (let y = 112; y <= 168; y += 8)
      world = spawnEnemy(world, "ravager", px(x), px(y));
  return world;
}
/** Seat 0 mashes Attack (two steps held, two released) while its directions and Jump stay random: whole combos. */
const mashing = (rows: number[][]): number[][] =>
  rows.map((row, index) => [
    (row[0]! & ~ATTACK) | (index % 4 < 2 ? ATTACK : 0),
    ...row.slice(1),
  ]);
/** Every seat holds Right for `steps` steps. */
const march = (steps: number): number[][] =>
  Array.from({ length: steps }, () => Array<number>(T.CAPACITY).fill(RIGHT));

test("the same seed and inputs fold to the same world, and a step leaves its input untouched", () => {
  const start = () =>
    crowd(
      createWorld({
        seed: 99,
        heroes: [
          { seat: 0, kind: "brakka" },
          { seat: 2, kind: "rhea" },
          { seat: 4, kind: "gorm" },
        ],
      }),
    );
  // A brawl, then the party marches on into the first wave.
  const inputs = [...mashing(script(5, 1200)), ...march(600)];
  const seen = new Set<string>(),
    foes = new Set<string>();
  const play = () =>
    inputs.reduce<World>((world, held) => {
      const after = step(world, held);
      for (const h of after.heroes) seen.add(h.state);
      for (const e of after.enemies) foes.add(e.state);
      return after;
    }, start());
  const a = play(),
    b = play();
  assert.equal(seedOf(JSON.stringify(a)), seedOf(JSON.stringify(b)));
  assert.deepEqual([...seen].sort(), [...HERO_STATES].sort());
  // Three heroes' ravagers outlast this brawl's blows (combat.test.ts fells them), so none is seen dead.
  assert.deepEqual(
    [...foes].sort(),
    ENEMY_STATES.filter((state) => state !== "dead").sort(),
  );
  assert.deepEqual([a.wave, a.locked], [1, true]);
  const before = JSON.stringify(a);
  const tick = stepTick(a, [JUMP, 0, RIGHT]);
  assert.equal(JSON.stringify(a), before);
  assert.deepEqual(tick, run(a, [JUMP, 0, RIGHT], T.STEPS_PER_TICK));
  assert.equal(tick.step, a.step + T.STEPS_PER_TICK);
});

test("a rollback replays from a snapshot to the same world, presses, buffers, hit-stop and knockdowns included", () => {
  const start = crowd(
    createWorld({
      seed: 11,
      heroes: [
        { seat: 0, kind: "gorm" },
        { seat: 1, kind: "rhea" },
      ],
    }),
  );
  // A brawl, then on into the first wave, whose spawns walk in while the crowd left behind walks back in.
  const inputs = [...mashing(script(21, 600)), ...march(400)];
  const fold = (world: World, rows: readonly (readonly number[])[]) =>
    rows.reduce<World>((w, held) => step(w, held), world);
  const trail = [start];
  for (const held of inputs) trail.push(step(trail.at(-1)!, held));
  const straight = trail.at(-1)!;
  assert.ok(straight.heroes.every((h) => h.damage > 0 && h.knockdowns > 0));
  assert.equal(straight.camX, STAGE_1.waves[0]!.at);
  // Cut too where a snapshot holds a hit-stop, a press waiting in a swing, an enemy in flight, a wave with spawns
  // still due, and an enemy walking in.
  const first = (found: (world: World) => boolean) => {
    const cut = trail.findIndex(found);
    assert.ok(cut > 0);
    return cut;
  };
  const due = waveSpawns(STAGE_1.waves[0]!, 2).length;
  const cuts = [
    first((w) => w.heroes.some((h) => w.step < h.stopUntil)),
    first((w) => w.heroes.some((h) => h.attackBuf > 0 && h.state !== "idle")),
    first((w) => w.enemies.some((e) => e.state === "knockdown" && e.z > 0)),
    first((w) => w.locked && w.spawned > 0 && w.spawned < due),
    first((w) => w.enemies.some((e) => e.state === "enter")),
  ];
  // Restore a snapshot through JSON, as a checkpoint would, and replay the rest: no press is lost or made twice.
  for (const cut of [1, 7, 8, 50, 301, 599, 999, ...cuts]) {
    const snapshot = JSON.parse(JSON.stringify(trail[cut])) as World;
    assert.deepEqual(fold(snapshot, inputs.slice(cut)), straight, `cut ${cut}`);
  }
});

test("the seeded stream and the seed hash are stable", () => {
  const first = next(1),
    second = next(first.state);
  assert.deepEqual(next(1), first);
  assert.notEqual(first.value, second.value);
  assert.equal(seedOf(""), 0x811c9dc5);
  assert.equal(seedOf("a"), 0xe40c292c);
  assert.equal(RULES, "fuse-axe-3");
});

test("the view gives whole pixels, the anim and its step count", () => {
  const world = run(solo("rhea"), [RIGHT | DOWN], 3);
  const view = toView(world);
  const [h] = view.heroes;
  assert.deepEqual(
    {
      x: h!.x,
      y: h!.y,
      anim: h!.anim,
      animStep: h!.animStep,
      kind: h!.kind,
    },
    {
      x: Math.floor(hero(world).x / SUB),
      y: Math.floor(hero(world).y / SUB),
      anim: "walk",
      animStep: 2,
      kind: "rhea",
    },
  );
  assert.ok(view.heroes.every((v) => Number.isInteger(v.x + v.y + v.z)));
  assert.equal(view.step, 3);
  assert.equal(view.camX, 0);
  assert.ok(Kit.FLOOR_TOP_PX >= Kit.VIEW_H / 2);
  assert.ok(Kit.FLOOR_BOTTOM_PX < Kit.VIEW_H);
  assert.ok(Kit.STAGE_LENGTH_PX >= 3 * Kit.VIEW_W);
  assert.equal(Kit.CAMERA_END_PX, Kit.STAGE_LENGTH_PX - Kit.VIEW_W);
  assert.deepEqual(Kit.HERO_STATES.slice(0, 4), [
    "idle",
    "walk",
    "jump",
    "land",
  ]);
});

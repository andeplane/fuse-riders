import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  JUMP,
  RIGHT,
  STAGE_1,
  createWorld,
  decodeWorld,
  encodeWorld,
  revive,
  sendImp,
  spawnEnemy,
  step,
  toView,
  waveSpawns,
  type Enemy,
  type Hero,
  type HeroKind,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";

const { px } = T;
const SCREEN = T.VIEW_W * T.SUB;
const party = (...kinds: HeroKind[]): World =>
  createWorld({ seed: 4, heroes: kinds.map((kind, seat) => ({ seat, kind })) });
const solo = () => party("brakka");
const imps = (world: World): Enemy[] =>
  world.enemies.filter((each) => each.kind === "imp");
const imp = (world: World): Enemy => imps(world)[0]!;
const hero = (world: World, index = 0) => world.heroes[index]!;
/** The world with hero `index` changed by `patch`. */
const heroAs = (world: World, patch: Partial<Hero>, index = 0): World => ({
  ...world,
  heroes: world.heroes.map((each, i) =>
    i === index ? { ...each, ...patch } : each,
  ),
});
/** The world with its first imp changed by `patch`. */
const impAs = (world: World, patch: Partial<Enemy>): World => ({
  ...world,
  enemies: world.enemies.map((each) =>
    each === imp(world) ? { ...each, ...patch } : each,
  ),
});
/** Steps holding `held` until `done` or `limit` steps, and the world it reached. */
function until(
  world: World,
  done: (world: World) => boolean,
  held: readonly number[] = [],
  limit = 600,
): World {
  for (let index = 0; index < limit && !done(world); index++)
    world = step(world, held);
  assert.ok(done(world), "reached");
  return world;
}
const run = (world: World, steps: number, held: readonly number[] = []) => {
  for (let index = 0; index < steps; index++) world = step(world, held);
  return world;
};
/** The first hero stands `gap` in the imp's path, facing it, free, with no blow landed. */
function facing(world: World, gap = px(16)): World {
  const { x, y, facing } = imp(world);
  return heroAs(world, {
    ...{ x: x + facing * gap, y, facing: facing > 0 ? -1 : 1 },
    ...{ state: "idle", timer: 0, struck: [], held: 0 },
  });
}
/** The hero in the imp's path slashes once, and `steps` more steps pass. */
const swing = (world: World, steps = 30) =>
  run(step(facing(world), [ATTACK]), steps);
/** A pot at (`x`, `y`) and height `z`, still, born now, with the world's next id. */
const pot = (world: World, x: number, y: number, z = 0): World => ({
  ...world,
  nextId: world.nextId + 1,
  items: [
    ...world.items,
    { id: world.nextId, kind: "pot", x, y, z, vz: 0, born: world.step },
  ],
});
/** Pots on the floor and in hand: every one dropped. */
const dropped = (w: World) =>
  w.items.length + w.heroes.reduce((sum, each) => sum + each.pots, 0);

test("an imp scurries in from either edge, zig-zags across without ever attacking, and leaves at the far side", () => {
  for (const side of ["left", "right"] as const) {
    let world = sendImp(solo(), side, hero(solo()).y, 2);
    const dir = side === "left" ? 1 : -1;
    assert.deepEqual(
      [imp(world).x, imp(world).facing, imp(world).state, imp(world).pots],
      [side === "left" ? -T.ENTER_OUT : SCREEN + T.ENTER_OUT, dir, "walk", 2],
    );
    const depths = new Set<number>();
    for (let before = imp(world); ; before = imp(world)) {
      world = step(world, []);
      if (!imps(world).length) break;
      assert.equal(imp(world).x - before.x, dir * T.IMP_WALK);
      assert.equal(Math.abs(imp(world).y - before.y), T.IMP_ZIG_Y);
      depths.add(imp(world).y);
      // It walks straight through Brakka standing in its path: no blow, no hurt.
      assert.deepEqual([hero(world).hp, hero(world).state], [60, "idle"]);
    }
    const zig = Math.max(...depths) - Math.min(...depths);
    assert.equal(zig, T.IMP_ZIG * T.IMP_ZIG_Y);
    assert.ok(world.step * T.IMP_WALK > SCREEN, "it crossed the screen");
    assert.deepEqual([world.enemies, world.items], [[], []]);
  }
});

test("a blow kicks one pot out of the sack: the imp stumbles back, then flees away faster, and no tally counts it", () => {
  let world = spawnEnemy(solo(), "imp", px(160), px(140));
  assert.equal(imp(world).facing, -1, "placed by hand, it heads for the hero");
  // Brakka stands 20 px in its path and slashes once.
  world = step(facing(world, px(20)), [ATTACK]);
  world = until(world, (w) => imp(w).state === "stumble");
  const kicked = imp(world),
    [drop] = world.items;
  assert.deepEqual([kicked.pots, world.items.length], [T.IMP_POTS - 1, 1]);
  assert.deepEqual([drop!.kind, drop!.x, drop!.y], ["pot", kicked.x, kicked.y]);
  assert.ok(drop!.z > T.POT_LIFT, "it pops up out of the sack");
  // It turns to the blow and is pushed back by it.
  assert.deepEqual([kicked.facing, kicked.vx], [-1, T.HURT_PUSH]);
  assert.deepEqual([hero(world).damage, hero(world).knockdowns], [0, 0]);
  assert.equal(world.fx.at(-1)!.kind, "hit");
  world = until(world, (w) => imp(w).state === "flee");
  const fled = step(world, []);
  assert.equal(imp(fled).facing, 1, "away from the blow");
  assert.equal(imp(fled).x - imp(world).x, T.IMP_FLEE);
  const walks = T.HERO_KINDS.map((kind) => T.WALK[kind].x);
  assert.ok(T.IMP_FLEE > Math.max(...walks));
  // The pot lands where it dropped and lies there for the taking.
  world = until(world, (w) => w.items[0]!.z === 0);
  assert.deepEqual([world.items[0]!.x, world.items[0]!.vz], [drop!.x, 0]);
});

test("an imp's sack runs out: no more pots drop than it carried, an empty imp cannot be kicked, and it leaves", () => {
  let world = sendImp(solo(), "left", px(140), 2);
  world = until(world, (w) => imp(w).x > px(120));
  for (const left of [1, 0]) {
    world = until(swing(world), (w) => imp(w).state === "flee");
    assert.deepEqual([imp(world).pots, dropped(world)], [left, 2 - left]);
  }
  world = swing(world, 10);
  assert.deepEqual([imp(world).state, dropped(world)], ["flee", 2]);
  world = until(world, (w) => imps(w).length === 0);
  assert.equal(dropped(world), 2);
});

test("a blow that knocks down sends the imp flying: it lies out of a blade's way, gets up and flees", () => {
  // Brakka faces away with the imp behind it: Attack and Jump together are the back attack.
  let world = heroAs(spawnEnemy(solo(), "imp", px(80), px(138)), {
    facing: -1,
  });
  world = step(world, [ATTACK | JUMP]);
  world = until(world, (w) => imp(w).state === "knockdown");
  assert.equal(hero(world).state, "backattack");
  assert.ok(imp(world).vz > 0 && imp(world).vx > 0);
  assert.equal(world.fx.at(-1)!.kind, "heavy");
  world = until(world, (w) => imp(w).state === "down", [], 120);
  // Lying, it is out of the way of a slash.
  const slashed = run(step(facing(world), [ATTACK]), 20);
  assert.deepEqual([imp(slashed).state, dropped(slashed)], ["down", 1]);
  for (const state of ["getup", "flee"])
    world = until(world, (w) => imp(w).state === state, [], 120);
  assert.deepEqual([imp(world).pots, dropped(world)], [T.IMP_POTS - 1, 1]);
  assert.equal(imp(world).facing, 1, "away from the blow");
});

test("a dash and a jump attack each knock the imp down with one pot, as they do any enemy", () => {
  const { x, y } = hero(solo());
  const running = (gap: number) =>
    [RIGHT, 0, RIGHT, RIGHT].reduce(
      (w, bits) => step(w, [bits]),
      spawnEnemy(solo(), "imp", x + px(gap), y),
    );
  for (const [move, gap, bits] of [
    ["dash", 70, RIGHT | ATTACK],
    ["jumpattack", 40, RIGHT | JUMP],
  ] as const) {
    let world = running(gap);
    assert.equal(hero(world).state, "run");
    world = step(world, [bits]);
    if (move === "jumpattack") world = step(world, [RIGHT | ATTACK]);
    world = until(world, (w) => imp(w).state === "knockdown", [RIGHT], 60);
    assert.equal(hero(world).state, move);
    assert.deepEqual([imp(world).pots, dropped(world)], [T.IMP_POTS - 1, 1]);
    assert.deepEqual([hero(world).damage, hero(world).knockdowns], [0, 0]);
    // The blade's window stays open across the next steps, and no second pot drops.
    assert.equal(dropped(run(world, 20, [RIGHT])), 1, move);
  }
});

test("a thrown body kicks a pot out of an imp it meets", () => {
  // Brakka grabs a dazed ravager and throws it back over the imp scurrying up behind.
  let world = spawnEnemy(solo(), "ravager", px(80), px(138));
  world = { ...world, enemies: [{ ...world.enemies[0]!, state: "hurt" }] };
  world = impAs(spawnEnemy(world, "imp", px(30), px(138)), { facing: 1 });
  world = step(world, [RIGHT | ATTACK]);
  world = until(world, (w) => imp(w).state === "knockdown", [], 60);
  assert.equal(world.enemies[0]!.state, "thrown");
  assert.deepEqual([imp(world).pots, dropped(world)], [T.IMP_POTS - 1, 1]);
  assert.deepEqual([hero(world).damage, hero(world).knockdowns], [0, 1]);
});

test("a wave clears with an imp still on screen, and the imp goes on its way", () => {
  let world = until(solo(), (w) => w.locked, [RIGHT], 400);
  const count = waveSpawns(STAGE_1.waves[0]!, 1).length;
  world = until(world, (w) => w.spawned === count, [], 400);
  world = step(sendImp({ ...world, enemies: [] }, "left", px(150)), []);
  const { locked, go } = toView(world);
  assert.deepEqual([locked, go, imps(world).length], [false, true, 1]);
});

test("a hero on its feet walking over a landed pot picks it up while it holds fewer than its kind's most", () => {
  const start = party("gorm"),
    { x, y } = hero(start),
    near = (w: World, z = 0) => pot(w, x + px(6), y + px(4), z);
  const picked = step(near(start), []);
  assert.deepEqual([hero(picked).pots, picked.items], [1, []]);
  const { pots, maxPots } = toView(picked).heroes[0]!;
  assert.deepEqual([pots, maxPots], [1, T.MAX_POTS.gorm]);
  // Just out of reach along the road or in depth it stays, and full, Gorm leaves it lying.
  const stays = (world: World, what: string) =>
    assert.equal(step(world, []).items.length, 1, what);
  stays(pot(start, x + T.PICKUP_X + 1, y), "along the road");
  stays(pot(start, x, y + T.PICKUP_Y + 1), "in depth");
  stays(near(heroAs(start, { pots: T.MAX_POTS.gorm })), "full");
  // Reeling, flying, lying, getting up or in the air, it cannot; nor while the pot is still popping.
  for (const state of ["hurt", "knockdown", "down", "getup"] as const)
    stays(near(heroAs(start, { state })), state);
  stays(near(heroAs(start, { state: "jump", z: px(10) })), "jumping");
  const popping = near(start, px(5));
  stays(popping, "popping");
  assert.equal(hero(until(popping, (w) => !w.items.length)).pots, 1);
});

test("two heroes on one pot on the same step: the lower id gets it, and a full hero leaves it to the next", () => {
  const spot = { x: px(100), y: px(140) };
  const together = heroAs(heroAs(party("brakka", "gorm"), spot), spot, 1);
  const two = step(pot(pot(together, spot.x, spot.y), spot.x, spot.y), []);
  assert.deepEqual([hero(two).pots, hero(two, 1).pots], [2, 0]);
  const full = heroAs(together, { pots: T.MAX_POTS.brakka });
  const passed = step(pot(full, spot.x, spot.y), []);
  assert.deepEqual([hero(passed).pots, hero(passed, 1).pots], [4, 1]);
});

test("a pot lies ITEM_LIFE steps, blinking through the last ITEM_BLINK, then vanishes; the world keeps the newest ITEM_MAX", () => {
  const start = pot(solo(), px(200), px(110));
  const blinks = (w: World) => toView(w).items[0]?.blink;
  assert.equal(blinks(run(start, T.ITEM_LIFE - T.ITEM_BLINK - 1)), false);
  assert.equal(blinks(run(start, T.ITEM_LIFE - T.ITEM_BLINK)), true);
  assert.equal(run(start, T.ITEM_LIFE - 1).items.length, 1);
  assert.equal(run(start, T.ITEM_LIFE).items.length, 0);
  const [only] = toView(start).items;
  assert.deepEqual(only, {
    id: 2,
    kind: "pot",
    x: 200,
    y: 110,
    z: 0,
    blink: false,
  });
  // A kick with the floor full pushes out the oldest.
  let crowded = spawnEnemy(solo(), "imp", px(160), px(140));
  for (let index = 0; index < T.ITEM_MAX; index++)
    crowded = pot(crowded, px(250), px(110));
  const oldest = crowded.items[0]!.id;
  crowded = step(facing(crowded), [ATTACK]);
  crowded = until(crowded, (w) => imp(w).state === "stumble");
  assert.equal(crowded.items.length, T.ITEM_MAX);
  assert.ok(crowded.items.every((each) => each.id > oldest));
});

test("a hero keeps its pots through a lost life and a continue", () => {
  const fallen = heroAs(party("rhea"), {
    ...{ state: "dead", timer: T.RESPAWN_DELAY - 1 },
    ...{ hp: 0, lives: 2, pots: 5 },
  });
  const back = step(fallen, []);
  assert.deepEqual([hero(back).state, hero(back).pots], ["respawn", 5]);
  assert.equal(hero(revive(back)).pots, 5);
});

test("Stage 1 sends one imp after wave 2, one with wave 3 and one after wave 4, each once, whatever the party", () => {
  const [, w2, w3, w4, w5] = STAGE_1.waves.map((wave) => wave.at);
  const cues = STAGE_1.imps;
  const sacks = cues.map(({ side, pots }) => `${side} ${pots}`);
  assert.deepEqual(sacks, ["right 2", "left 2", "right 3"]);
  const [after2, with3, after4] = cues.map((cue) => cue.at);
  assert.ok(w2! < after2! && after2! < w3! && with3 === w3);
  assert.ok(w4! < after4! && after4! < w5!);
  /** Five heroes past wave 2 and `sent` cues, leading the camera at `camX`. */
  const five = party("brakka", "brakka", "brakka", "brakka", "brakka");
  const past = (camX: number, sent: number): World => ({
    ...five,
    ...{ camX, wave: 2, impsSent: sent },
    spawned: waveSpawns(STAGE_1.waves[1]!, 5).length,
    heroes: five.heroes.map((each) => ({ ...each, x: camX + T.CAMERA_LEAD })),
  });
  let world = until(
    past(after2! - px(8), 0),
    (w) => w.impsSent === 1,
    [RIGHT],
    60,
  );
  const { x, y, facing, pots } = imp(world);
  assert.deepEqual(
    [imps(world).length, facing, y, pots],
    [1, -1, cues[0]!.y, 2],
  );
  assert.equal(x, world.camX + SCREEN + T.ENTER_OUT);
  assert.deepEqual(decodeWorld(encodeWorld(world)), world);
  // Wave 3's cue comes with the wave: on the step it begins.
  const all = Array<number>(5).fill(RIGHT);
  world = until(past(with3! - px(8), 1), (w) => w.wave === 3, all, 60);
  assert.deepEqual([world.impsSent, imp(world).facing], [2, 1]);
  assert.equal(imp(world).x, world.camX - T.ENTER_OUT);
  assert.equal(imps(run(world, 30)).length, 1, "and only one");
});

test("every cue's imp is seen: sent on a legal sack and depth, it comes whole onto the screen, however the camera moves", () => {
  const { imps: cues, waves } = STAGE_1;
  cues.forEach((cue, index) => {
    const what = `cue ${index + 1}`;
    assert.ok(cue.at <= T.CAMERA_END, `${what} is within the camera's reach`);
    assert.ok(index === 0 || cue.at > cues[index - 1]!.at, `${what} in order`);
    assert.ok(cue.pots >= 1 && cue.pots <= T.IMP_POTS, `${what} sack`);
    assert.ok(cue.y >= T.FLOOR_TOP && cue.y <= T.FLOOR_BOTTOM, `${what} depth`);
    // Camera short of the cue, the waves before it fought, the party well ahead: the camera runs at its top speed.
    const wave = waves.filter((each) => each.at < cue.at).length,
      camX = cue.at - px(8),
      lone = solo();
    const world: World = {
      ...lone,
      ...{ camX, wave, impsSent: index },
      spawned: wave ? waveSpawns(waves[wave - 1]!, 1).length : 0,
      heroes: lone.heroes.map((h) => ({
        ...h,
        x: camX + T.CAMERA_LEAD + px(48),
      })),
    };
    const seen = (w: World) =>
      imps(w).some(
        (each) =>
          each.x >= w.camX + T.ENEMY_HALF_W &&
          each.x <= w.camX + SCREEN - T.ENEMY_HALF_W,
      );
    assert.equal(until(world, seen, [RIGHT], 300).impsSent, index + 1, what);
  });
});

test("a sack imp is always of the lowest tier, as the checkpoint requires, and a ravager has no sack", () => {
  assert.throws(
    () => spawnEnemy(solo(), "imp", px(100), px(140), 1),
    RangeError,
  );
  const world = spawnEnemy(
    spawnEnemy(solo(), "imp", px(100), px(140)),
    "ravager",
    px(200),
    px(140),
    2,
  );
  assert.deepEqual(
    world.enemies.map((each) => [each.kind, each.tier, each.pots]),
    [
      ["imp", 0, T.IMP_POTS],
      ["ravager", 2, 0],
    ],
  );
  assert.deepEqual(decodeWorld(encodeWorld(world)), world);
});

test("a sack imp beside a hero claims no side of it: a ravager going for the hero takes its own", () => {
  const goal = (withImp: boolean) => {
    const { x, y } = hero(heroAs(solo(), { x: px(160) }));
    let world = heroAs(solo(), { x: px(160) });
    if (withImp) world = spawnEnemy(world, "imp", x - px(30), y);
    world = spawnEnemy(world, "ravager", x - px(90), y);
    const foe = world.enemies.at(-1)!;
    world = {
      ...world,
      enemies: world.enemies.map((each) =>
        each === foe
          ? { ...each, state: "walk", target: hero(world).id }
          : each,
      ),
    };
    return step(world, []).enemies.at(-1)!.goal - x;
  };
  assert.equal(
    goal(true),
    -T.ENGAGE_X,
    "its own side, the left, as with no imp",
  );
  assert.equal(goal(true), goal(false));
});

test("a cue's imp waits while the world holds the most enemies, and a sack the checkpoint would refuse is never sent", () => {
  let world = createWorld({ seed: 2, heroes: [] });
  for (let index = 0; index < T.ENEMY_MAX; index++)
    world = spawnEnemy(world, "ravager", px(100), px(140));
  const camX = STAGE_1.imps[0]!.at;
  world = step({ ...world, camX, wave: 2, spawned: 3 }, []);
  assert.equal(world.impsSent, 0);
  assert.throws(() => sendImp(world, "left", px(140)), RangeError);
  for (const pots of [0, T.IMP_POTS + 1, 1.5])
    assert.throws(() => sendImp(solo(), "left", px(140), pots), RangeError);
  assert.equal(imp(sendImp(solo(), "right", px(500))).y, T.FLOOR_BOTTOM);
});

test("a world with imps and pots survives the checkpoint whole and plays on identically, and a bad one is refused", () => {
  // The imp placed mid-screen is kicked, another scurries in behind it, and the heroes hold pots.
  let world = spawnEnemy(party("brakka", "gorm"), "imp", px(160), px(140));
  world = step(facing(sendImp(world, "left", px(120))), [ATTACK]);
  world = until(world, (w) => w.items.length > 0 && w.items[0]!.z > 0);
  world = heroAs(heroAs(world, { pots: 2 }), { pots: 3 }, 1);
  world = spawnEnemy(world, "ravager", px(200), px(150));
  const good = encodeWorld(world) as unknown[];
  assert.deepEqual(decodeWorld(structuredClone(good)), world);
  const held = [RIGHT, ATTACK];
  const back = decodeWorld(structuredClone(good))!;
  assert.deepEqual(run(back, 120, held), run(world, 120, held));
  // World fields 5 heroes, 6 enemies, 13 items, 14 imps sent; hero field 28 pots; enemy fields 9 state, 12 tier,
  // 15 target, 18 pots (the kicked imp first, the ravager last); item fields 0 id, 1 kind, 2 x, 3 y, 5 vz, 6 born.
  const [now, nextId] = [world.step, world.nextId];
  const gorm = (f: unknown[]) => (f[5] as unknown[][])[1]!;
  const sack = (f: unknown[]) => (f[6] as unknown[][])[0]!;
  const ravager = (f: unknown[]) => (f[6] as unknown[][]).at(-1)!;
  const item = (f: unknown[]) => (f[13] as unknown[][])[0]!;
  /** The world `age` steps after the first item was born, its sparks gone: on its last step at ITEM_LIFE − 1. */
  const aged = (f: unknown[], age: number) => {
    f[7] = [];
    f[1] = (item(f)[6] as number) + age;
  };
  const last = structuredClone(good);
  aged(last, T.ITEM_LIFE - 1);
  assert.ok(decodeWorld(last), "an item on its last step");
  for (const [what, change] of [
    ["Gorm over his most pots", (f) => (gorm(f)[28] = T.MAX_POTS.gorm + 1)],
    ["a sack over full", (f) => (sack(f)[18] = T.IMP_POTS + 1)],
    ["a ravager with a sack", (f) => (ravager(f)[18] = 1)],
    ["a ravager fleeing", (f) => (ravager(f)[9] = "flee")],
    ["an imp winding up", (f) => (sack(f)[9] = "windup")],
    ["an imp going for a hero", (f) => (sack(f)[15] = 1)],
    ["a violet imp", (f) => (sack(f)[12] = 2)],
    ["too many items", (f) => (f[13] = Array(T.ITEM_MAX + 1).fill(item(f)))],
    ["items out of order", (f) => (f[13] = [item(f), item(f)])],
    ["an unknown item", (f) => (item(f)[1] = "meat")],
    ["an item off the road", (f) => (item(f)[2] = -1)],
    ["an item off the floor", (f) => (item(f)[3] = T.FLOOR_TOP - 1)],
    ["a landed item moving", (f) => ((item(f)[4] = 0), (item(f)[5] = -1))],
    ["an item born later", (f) => (item(f)[6] = now + 1)],
    ["an item past its life", (f) => aged(f, T.ITEM_LIFE)],
    ["an item with an imp's id", (f) => (item(f)[0] = sack(f)[0])],
    ["an item with a hero's id", (f) => (item(f)[0] = 1)],
    ["an item not yet issued", (f) => (item(f)[0] = nextId)],
    ["an imp sent before its cue", (f) => (f[14] = 1)],
    ["more imps sent than cued", (f) => (f[14] = STAGE_1.imps.length + 1)],
  ] as [string, (f: unknown[]) => void][]) {
    const copy = structuredClone(good);
    change(copy);
    assert.equal(decodeWorld(copy), undefined, what);
  }
});

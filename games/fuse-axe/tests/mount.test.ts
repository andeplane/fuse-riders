import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  DOWN,
  JUMP,
  LEFT,
  MAGIC,
  RIGHT,
  STAGE_2,
  UP,
  botInput,
  createWorld,
  decodeWorld,
  encodeWorld,
  spawnEnemy,
  spawnMount,
  step,
  stepTick,
  toView,
  waveSpawns,
  type Enemy,
  type HeroKind,
  type Mount,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";

const { px } = T;
const party = (...kinds: HeroKind[]) =>
  createWorld({ seed: 5, heroes: kinds.map((kind, seat) => ({ seat, kind })) });
const hero = (world: World, index = 0) => world.heroes[index]!;
const beast = (world: World, index = 0) => world.mounts[index]!;
const rider = (world: World) => world.enemies.find((e) => e.state === "ride");
const hps = (world: World) => world.heroes.map((h) => h.hp);
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
const kept = (world: World) =>
  assert.deepEqual(decodeWorld(structuredClone(encodeWorld(world))), world);
/** A ravager of `tier` riding a clawbeak `dx` px along the road and `dy` in depth from the first hero, facing it. */
function mounted(world: World, dx: number, dy = 0, tier: T.Tier = 0): World {
  const { x, y } = hero(world);
  const next = spawnEnemy(world, "ravager", x + px(dx), y + px(dy), tier);
  const enemy = next.enemies.at(-1)!;
  return spawnMount(next, enemy.x, enemy.y, enemy.id);
}
/** A riderless clawbeak `dx` and `dy` sub-units from the first hero. */
const loose = (world: World, dx: number, dy = 0) =>
  spawnMount(world, hero(world).x + dx, hero(world).y + dy);
/** The first hero, standing beside a riderless clawbeak, climbs on. */
const aboard = (world: World) => step(loose(world, px(10)), [JUMP]);
const FULL = T.enemyMaxHp("ravager", 0, 1);

test("an enemy's beast winds its tail up in plain sight, then knocks down every hero around it in its lane, either side, and no further", () => {
  let world = mounted(party("brakka", "rhea", "gorm", "brakka"), 30);
  const { x, y } = beast(world);
  // Rhea behind it, Gorm just out of its lane and the second Brakka just out of its reach.
  world = moved(world, 1, x + px(40), y);
  world = moved(world, 2, x - px(30), y + T.TAIL_LANE + px(1));
  world = moved(world, 3, x + T.TAIL_REACH + T.HERO_HALF_W + px(1), y);
  const full = hps(world);
  world = step(world, []);
  assert.equal(beast(world).state, "sweep");
  world = run(world, T.TAIL_WINDUP - 1);
  assert.deepEqual(hps(world), full, "nothing lands in the wind-up");
  world = step(world, []);
  assert.deepEqual(
    world.heroes.map((h) => [h.state, h.hp]),
    [
      ["knockdown", full[0]! - T.TAIL_DAMAGE],
      ["knockdown", full[1]! - T.TAIL_DAMAGE],
      ["idle", full[2]],
      ["idle", full[3]],
    ],
  );
  assert.ok(hero(world, 0).vx < 0 && hero(world, 1).vx > 0, "away from it");
  // The rider stays on, in the saddle in the view, the beast fighting for it.
  const view = toView(world);
  assert.deepEqual(view.mounts[0]!.rider, { kind: "enemy", id: rider(world)!.id }); // prettier-ignore
  assert.deepEqual([view.enemies[0]!.mounted, view.enemies[0]!.z], [true, T.SADDLE / T.SUB]); // prettier-ignore
  assert.deepEqual(view.mounts[0]!.anim, "sweep");
  kept(world);
  world = run(world, T.TAIL_STEPS - T.TAIL_WINDUP + T.HEAVY_HITSTOP);
  assert.deepEqual([beast(world).state, beast(world).x, rider(world)!.x], ["idle", x, x]); // prettier-ignore
});

test("the saddle takes a slash, which breaks off the tail's wind-up; the finisher knocks the rider off, and the beast panics, wanders and leaves", () => {
  let world = step(mounted(party("brakka"), 20), [ATTACK]);
  assert.equal(beast(world).state, "sweep");
  world = until(world, (w) => rider(w)!.hp < FULL);
  assert.deepEqual(
    [rider(world)!.state, rider(world)!.hp, beast(world).state],
    ["ride", FULL - T.COMBO.brakka[0].damage, "idle"],
  );
  assert.equal(beast(world).coolUntil, world.step + T.TAIL_COOL);
  assert.ok(toView(world).enemies[0]!.flash, "it flashes from the blow");
  for (let i = 0; i < 200 && rider(world); i++)
    world = step(world, [i % 2 ? ATTACK : 0]);
  const fallen = world.enemies[0]!;
  assert.deepEqual([fallen.state, hero(world).knockdowns], ["knockdown", 1]);
  assert.ok(fallen.z >= T.SADDLE, "it falls from the saddle");
  assert.deepEqual([beast(world).rider, beast(world).state, beast(world).facing], [0, "flee", 1]); // prettier-ignore
  assert.deepEqual([toView(world).mounts[0]!.rider, toView(world).enemies[0]!.mounted], [null, false]); // prettier-ignore
  // Riderless, nothing it does lands on anyone; it runs, wanders on screen, then walks off and is gone.
  world = { ...world, enemies: [] };
  const from = beast(world).x;
  world = until(world, (w) => beast(w).state === "wander", T.PANIC_STEPS);
  assert.ok(beast(world).x > from, "it ran from the blow");
  for (let i = 0; i < T.STRAY_STEPS - 1; i++) {
    world = step(world, []);
    assert.ok(world.mounts.length === 1 && Math.abs(beast(world).x - px(T.VIEW_W / 2)) < px(T.VIEW_W / 2)); // prettier-ignore
  }
  world = until(world, (w) => w.mounts.length === 0, 200);
  assert.equal(hps(world)[0], T.HERO_HP.brakka);
});

test("a beast takes no blow: a blade passes it by, as does a spell, whose freeze holds it", () => {
  let world = loose(party("brakka"), px(20));
  world = run(step(world, [ATTACK]), T.COMBO.brakka[0].startup + 2);
  assert.deepEqual([hero(world).struck, world.fx, hero(world).damage], [[], [], 0]); // prettier-ignore
  const rhea = party("rhea");
  world = loose({ ...rhea, heroes: [{ ...hero(rhea), pots: 1 }] }, px(40));
  world = step(step(world, [MAGIC]), []);
  const frozen = beast(world);
  world = run(world, T.SPELLS.rhea.levels[0]!.hit - 2);
  assert.deepEqual(beast(world), frozen);
  assert.equal(world.mounts.length, 1);
});

test("Jump beside a riderless beast climbs on; too far or out of its lane it is a jump; boarding on one step goes to the lower id", () => {
  let world = aboard(party("brakka"));
  assert.deepEqual([hero(world).state, beast(world).rider], ["ride", 1]);
  assert.deepEqual([hero(world).x, hero(world).y], [beast(world).x, beast(world).y]); // prettier-ignore
  const view = toView(world);
  assert.deepEqual([view.heroes[0]!.mounted, view.heroes[0]!.z, view.mounts[0]!.rider], [true, T.SADDLE / T.SUB, { kind: "hero", id: 1 }]); // prettier-ignore
  kept(world);
  for (const [dx, dy] of [
    [T.BOARD_X + 1, 0],
    [0, T.LANE + 1],
  ] as const) {
    world = step(loose(party("brakka"), dx, dy), [JUMP]);
    assert.deepEqual([hero(world).state, beast(world).rider], ["jump", 0]);
  }
  // Rhea is nearer the beast, but Brakka's id is lower.
  const two = party("brakka", "rhea");
  world = loose(two, px(16));
  world = moved(world, 1, beast(world).x + px(6), beast(world).y);
  world = step(world, [JUMP, JUMP]);
  assert.deepEqual(
    world.heroes.map((h) => h.state),
    ["ride", "jump"],
  );
  assert.equal(beast(world).rider, 1);
});

test("riding: the beast's walk, Attack lashing the tail at the enemies around once cooled, Jump hopping it and Down and Jump climbing off", () => {
  let world = aboard(party("brakka"));
  const x0 = hero(world).x;
  world = run(world, 10, [RIGHT]);
  assert.deepEqual([hero(world).x - x0, beast(world).facing, beast(world).state], [10 * T.BEAST_WALK.x, 1, "walk"]); // prettier-ignore
  const { x, y } = hero(world);
  world = spawnEnemy(spawnEnemy(world, "ravager", x + px(30), y), "ravager", x - px(30), y); // prettier-ignore
  world = step(world, [ATTACK]);
  assert.equal(beast(world).state, "sweep");
  world = run(world, T.TAIL_WINDUP);
  assert.deepEqual(world.enemies.map((e) => [e.state, e.hp, Math.sign(e.vx)]), [["knockdown", FULL - T.TAIL_DAMAGE, 1], ["knockdown", FULL - T.TAIL_DAMAGE, -1]]); // prettier-ignore
  assert.deepEqual([hero(world).knockdowns, hero(world).damage, hero(world).state], [2, 2 * T.TAIL_DAMAGE, "ride"]); // prettier-ignore
  world = until({ ...world, enemies: [] }, (w) => beast(w).state === "idle");
  assert.equal(beast(step(world, [ATTACK])).state, "idle", "it is cooling");
  world = run(world, T.TAIL_COOL);
  assert.equal(beast(step(world, [ATTACK])).state, "sweep");
  // A hop carries the hero up with the beast and lands.
  world = until(world, (w) => beast(w).state === "idle");
  world = run(step(world, [JUMP]), 10);
  assert.ok(beast(world).state === "hop" && beast(world).z > px(20));
  assert.equal(hero(world).z, beast(world).z);
  world = until(world, (w) => beast(w).z === 0);
  assert.deepEqual([beast(world).state, hero(world).state], ["idle", "ride"]);
  // Down and Jump drops the hero from the saddle, and the beast wanders off.
  world = step(world, [DOWN | JUMP]);
  assert.deepEqual([hero(world).state, hero(world).z, beast(world).rider, beast(world).state], ["jump", T.SADDLE, 0, "wander"]); // prettier-ignore
  world = until(world, (w) => hero(w).state === "land");
  kept(world);
});

test("the saddle takes a light blow, which breaks off the tail's wind-up; a hard one, or one in a hop, throws the hero off, and the beast panics", () => {
  const windup = T.RAVAGER[0].windup;
  const maced = (world: World, hp: number) => {
    const next = spawnEnemy(world, "ravager", hero(world).x + px(20), hero(world).y); // prettier-ignore
    const last = next.enemies.length - 1;
    next.enemies[last] = { ...next.enemies[last]!, state: "windup", timer: windup - 2, target: 1, facing: -1 }; // prettier-ignore
    next.heroes[0] = { ...hero(next), hp };
    return next;
  };
  let world = step(maced(aboard(party("brakka")), 60), [ATTACK]);
  assert.equal(beast(world).state, "sweep");
  world = step(world, []);
  assert.deepEqual([hero(world).state, hero(world).hp, beast(world).state], ["ride", 60 - T.RAVAGER[0].damage, "idle"]); // prettier-ignore
  assert.equal(hero(world).stopUntil, world.step + T.HITSTOP);
  world = run(maced(aboard(party("brakka")), 10), 2);
  assert.deepEqual([hero(world).state, hero(world).z], ["knockdown", T.SADDLE]);
  assert.deepEqual([beast(world).rider, beast(world).state, beast(world).facing], [0, "flee", -1]); // prettier-ignore
  kept(world);
  // Struck as it hops, the hero is thrown off whatever the blow, and the riderless beast comes down.
  world = step(step(maced(aboard(party("brakka")), 60), []), [JUMP]);
  assert.deepEqual([hero(world).state, beast(world).state], ["knockdown", "flee"]); // prettier-ignore
  assert.ok(beast(world).z > 0);
  kept(world);
  world = until(world, (w) => beast(w).z === 0, 40);
  assert.equal(beast(world).vz, 0);
});

test("Magic from the saddle climbs off to charge or cast where the beast stands", () => {
  const rhea = party("rhea");
  let world = aboard({ ...rhea, heroes: [{ ...hero(rhea), pots: 2 }] });
  const { x } = hero(world);
  world = step(world, [MAGIC]);
  assert.deepEqual([hero(world).state, beast(world).rider, beast(world).state], ["charge", 0, "wander"]); // prettier-ignore
  world = step(world, []);
  assert.deepEqual([hero(world).state, hero(world).x, world.spells.length, hero(world).pots], ["cast", x, 1, 0]); // prettier-ignore
  kept(world);
});

test("Wyrmbone Pass sends riders on clawbeaks in waves 2 and 4, one more for a big party, who ride in on them; a full world sends them on foot", () => {
  assert.deepEqual(
    STAGE_2.waves.map((w) => w.spawns.filter((s) => s.mount).length),
    [0, 1, 0, 1, 0, 0],
  );
  const wave = STAGE_2.waves[1]!;
  assert.equal(waveSpawns(wave, 5).filter((s) => s.mount).length, 2);
  const start = createWorld({ seed: 3, stage: 2, heroes: [{ seat: 0, kind: "gorm" }] }); // prettier-ignore
  const at = { ...moved(start, 0, wave.at + px(100), px(140)), camX: wave.at, wave: 1 }; // prettier-ignore
  let world = until(step(at, []), (w) => w.mounts.length > 0);
  const [enemy, mount] = [rider(world)!, beast(world)];
  assert.deepEqual([mount.state, mount.rider, mount.x, mount.y], ["enter", enemy.id, enemy.x, enemy.y]); // prettier-ignore
  assert.ok(mount.x > world.camX + px(T.VIEW_W));
  world = until(world, (w) => beast(w).state !== "enter");
  assert.equal(beast(world).x, mount.goal);
  kept(world);
  // With every beast out, the rider walks in on foot.
  let full = at;
  for (let i = 0; i < T.MOUNT_MAX; i++) full = spawnMount(full, px(60 + i), px(120)); // prettier-ignore
  assert.throws(() => spawnMount(full, px(60), px(120)), RangeError);
  full = until(step(full, []), (w) => w.enemies.length === 3);
  assert.equal(full.enemies[2]!.state, "enter");
  assert.ok(full.mounts.every((m) => m.rider === 0));
});

test("spawning a beast refuses what the checkpoint would: an unknown kind, a broken position, a rider that cannot ride", () => {
  const world = spawnEnemy(party("brakka"), "lancer", px(100), px(140));
  const odd = JSON.parse('"drake"') as T.MountKind;
  for (const make of [
    () => spawnMount(world, px(90), px(140), 0, odd),
    () => spawnMount(world, 0.5, px(140)),
    () => spawnMount(world, px(90), px(140), world.enemies[0]!.id),
    () => spawnMount(world, px(90), px(140), 99),
  ])
    assert.throws(make, RangeError);
});

test("a bot breaks off a rider's tail or steps out of it, knocks the rider off and beats it, and one left riding climbs off", () => {
  const tick = (w: World) => stepTick(w, [botInput(w, 1)]);
  for (const tier of T.TIERS) {
    let world = mounted(party("brakka"), 60, 4, tier);
    for (let i = 0; i < 600 && world.enemies.length > 0; i++)
      world = tick(world);
    assert.equal(world.enemies.length, 0, `tier ${tier}`);
    assert.equal(hero(world).lives, T.LIVES, `tier ${tier}`);
  }
  let world = tick(aboard(party("brakka")));
  assert.equal(botInput(world, 1), DOWN | JUMP);
  world = tick(world);
  assert.equal(hero(world).state, "jump");
});

test("a rollback or a checkpoint mid-ride, mid-hop, mid-sweep and with a beast riderless replays to the same world", () => {
  // A rider far off and one by Rhea, whom she fights; Brakka climbs on a beast beside him, sweeps, hops, walks and
  // climbs off.
  let opening = mounted(party("brakka", "rhea"), 200, 6, 1);
  const { x, y } = hero(opening, 1);
  opening = spawnEnemy(opening, "ravager", x + px(40), y);
  opening = spawnMount(opening, x + px(40), y, opening.enemies[1]!.id);
  opening = loose(opening, px(10));
  const script = (i: number) =>
    i === 1 ? JUMP
    : i === 4 ? ATTACK
    : i === 20 ? JUMP
    : i > 33 && i < 39 ? RIGHT | UP
    : i === 40 ? DOWN | JUMP
    : 0; // prettier-ignore
  const trail = [opening];
  while (trail.length < 260) {
    const w = trail.at(-1)!;
    trail.push(stepTick(w, [script(trail.length), botInput(w, 2)]));
  }
  const end = trail.at(-1)!;
  const first = (found: (m: Mount, w: World) => boolean) => {
    const cut = trail.findIndex((w) => w.mounts.some((m) => found(m, w)));
    assert.ok(cut > 0, String(found));
    return cut;
  };
  const heroRides = (m: Mount, w: World) => w.heroes.some((h) => h.id === m.rider); // prettier-ignore
  for (const cut of [
    first((m, w) => !heroRides(m, w) && m.state === "walk"),
    first((m, w) => heroRides(m, w) && m.state === "walk"),
    first((m) => m.state === "hop" && m.z > 0),
    first((m, w) => heroRides(m, w) && m.state === "sweep" && m.timer > 0),
    first((m, w) => !heroRides(m, w) && m.state === "sweep" && m.timer > 0),
    first((m) => m.state === "flee"),
    first((m, w) => m.state === "wander" && !heroRides(m, w) && w.step > 120),
  ])
    for (const from of [trail[cut]!, decodeWorld(encodeWorld(trail[cut]!))!]) {
      let world = from;
      for (let i = cut; i < trail.length - 1; i++)
        world = stepTick(world, [script(i + 1), botInput(world, 2)]);
      assert.deepEqual(world, end);
    }
});

test("the checkpoint refuses riders and beasts where the rules never put them", () => {
  let world = mounted(aboard(party("brakka", "rhea")), 80);
  world = loose(world, px(-30), px(10));
  kept(world);
  const [ours, theirs, free] = world.mounts as [Mount, Mount, Mount];
  const enemy = rider(world)!;
  const refused = (mounts: Partial<Mount>[], enemies: Partial<Enemy> = {}) =>
    decodeWorld(
      encodeWorld({
        ...world,
        mounts: mounts.map((change, i) => ({ ...world.mounts[i]!, ...change })),
        enemies: [{ ...enemy, ...enemies }],
      }),
    );
  const at = { x: enemy.x, y: enemy.y, z: 0, facing: enemy.facing };
  for (const [what, mounts, enemies] of [
    ["a beast ridden by nobody there", [{}, { rider: 99 }, {}], {}],
    ["a rider off its beast", [{}, {}, {}], { x: enemy.x + 1 }],
    ["a figure riding no beast", [{}, { rider: 0, state: "wander" }, {}], {}],
    [
      "two beasts under one rider",
      [{}, {}, { ...at, rider: enemy.id, state: "idle" }],
      {},
    ],
    ["a riderless beast sweeping", [{}, {}, { state: "sweep" }], {}],
    ["an enemy's beast hopping", [{}, { state: "hop" }, {}], {}],
    ["a hero's beast walking in", [{ state: "enter" }, {}, {}], {}],
    ["a lancer riding", [{}, {}, {}], { kind: "lancer" }],
    ["a beast standing in the air", [{}, {}, { z: px(4) }], {}],
    ["a beast with an enemy's id", [{}, {}, { id: enemy.id }], {}],
    ["beasts out of id order", [{ id: free.id }, {}, { id: ours.id }], {}],
    [
      "a sweep cooling too long",
      [{}, { coolUntil: world.step + T.TAIL_COOL + 1 }, {}],
      {},
    ],
  ] as const)
    // prettier-ignore
    assert.equal(refused([...mounts], enemies), undefined, what);
  assert.ok(refused([{}, { ...theirs }, {}]), "the world as it is");
  const many = Array.from({ length: T.MOUNT_MAX + 1 }, (_, i) => ({ ...free, id: free.id + i })); // prettier-ignore
  assert.equal(decodeWorld(encodeWorld({ ...world, mounts: many })), undefined);
});

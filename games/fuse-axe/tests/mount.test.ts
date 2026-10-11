import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  DOWN,
  JUMP,
  LEFT,
  MAGIC,
  RIGHT,
  STAGE_1,
  STAGE_2,
  UP,
  botInput,
  carryOf,
  createWorld,
  decodeWorld,
  encodeWorld,
  revive,
  spawnEnemy,
  spawnMount,
  step,
  stepTick,
  toView,
  waveSpawns,
  type Enemy,
  type Hero,
  type HeroKind,
  type Mount,
  type World,
} from "../src/engine/index.js";
import { saddle } from "../src/engine/mount.js";
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
/** A ravager of `tier` riding a clawbeak `dx` px along the road and `dy` in depth from hero `index`, facing it. */
function mounted(
  world: World,
  dx: number,
  dy = 0,
  tier: T.Tier = 0,
  index = 0,
) {
  const { x, y } = hero(world, index);
  const next = spawnEnemy(world, "ravager", x + px(dx), y + px(dy), tier);
  const enemy = next.enemies.at(-1)!;
  return spawnMount(next, enemy.x, enemy.y, enemy.id);
}
/** A riderless clawbeak `dx` and `dy` sub-units from the first hero. */
const loose = (world: World, dx: number, dy = 0) =>
  spawnMount(world, hero(world).x + dx, hero(world).y + dy);
/** The first hero, standing beside a riderless clawbeak, climbs on. */
const aboard = (world: World) => step(loose(world, px(10)), [JUMP]);
/** A ravager 20 px in front of the first hero, two steps from landing its mace on it, the hero left `hp`. */
function maced(world: World, hp: number): World {
  const next = spawnEnemy(world, "ravager", hero(world).x + px(20), hero(world).y); // prettier-ignore
  const timer = T.RAVAGER[0].windup - 2,
    winding = { state: "windup", timer, target: 1, facing: -1 } as const;
  return {
    ...next,
    enemies: next.enemies.map((e, i, all) => (i === all.length - 1 ? { ...e, ...winding } : e)), // prettier-ignore
    heroes: next.heroes.map((h, i) => (i === 0 ? { ...h, hp } : h)),
  };
}
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

test("a bot breaks off a rider's tail or steps out of it, then knocks the rider off and beats it, at every tier", () => {
  const tick = (w: World) => stepTick(w, [botInput(w, 1)]);
  for (const tier of T.TIERS) {
    let world = mounted(party("brakka"), 60, 4, tier);
    for (let i = 0; i < 600 && world.enemies.length > 0; i++)
      world = tick(world);
    assert.equal(world.enemies.length, 0, `tier ${tier}`);
    assert.equal(hero(world).lives, T.LIVES, `tier ${tier}`);
  }
  // One that finds itself riding (a player's seat it took over) climbs off.
  let world = tick(aboard(party("brakka")));
  assert.equal(botInput(world, 1), DOWN | JUMP);
  assert.equal(hero(tick(world)).state, "jump");
});

test("a rollback or a checkpoint mid-walk, mid-sweep, mid-hop, while a hero rides and with a beast riderless replays to the same world", () => {
  // A rider far off and one by Rhea, whom her bot fights; Brakka climbs on a beast beside him, sweeps, hops, walks and
  // climbs off.
  let opening = mounted(party("brakka", "rhea"), 200, 6, 1);
  opening = loose(mounted(opening, 40, 0, 0, 1), px(10));
  const script = (i: number) =>
    i === 1 ? JUMP
    : i === 4 ? ATTACK
    : i === 20 ? JUMP
    : i > 33 && i < 39 ? RIGHT | UP
    : i === 40 ? DOWN | JUMP
    : 0; // prettier-ignore
  const held = (w: World, i: number) => [script(i), botInput(w, 2)];
  const trail = [opening];
  while (trail.length < 260) trail.push(stepTick(trail.at(-1)!, held(trail.at(-1)!, trail.length))); // prettier-ignore
  const end = trail.at(-1)!;
  const first = (found: (m: Mount, heroes: boolean) => boolean) => {
    const cut = trail.findIndex((w) =>
      w.mounts.some((m) =>
        found(
          m,
          w.heroes.some((h) => h.id === m.rider),
        ),
      ),
    );
    assert.ok(cut > 0, String(found));
    return cut;
  };
  for (const cut of [
    first((m, ours) => m.rider > 0 && !ours && m.state === "walk"),
    first((m, ours) => ours && m.state === "walk"),
    first((m) => m.state === "hop" && m.z > 0),
    first((m, ours) => ours && m.state === "sweep" && m.timer > 0),
    first((m, ours) => !ours && m.state === "sweep" && m.timer > 0),
    first((m) => m.state === "flee"),
    first((m) => m.state === "leave"),
  ])
    for (const from of [trail[cut]!, decodeWorld(encodeWorld(trail[cut]!))!]) {
      let world = from;
      for (let i = cut; i < trail.length - 1; i++)
        world = stepTick(world, held(world, i + 1));
      assert.deepEqual(world, end);
    }
});

test("the checkpoint refuses riders and beasts where the rules never put them", () => {
  // Brakka's beast, a ravager's and a riderless one.
  const world = loose(mounted(aboard(party("brakka", "rhea")), 80), px(-30), px(10)); // prettier-ignore
  kept(world);
  const [, theirs, free] = world.mounts as [Mount, Mount, Mount];
  const enemy = rider(world)!;
  const refused = (
    mounts: readonly Partial<Mount>[],
    enemies: Partial<Enemy> = {},
    heroes: Partial<Hero> = {},
  ) =>
    decodeWorld(
      encodeWorld({
        ...world,
        mounts: mounts.map((change, i) => ({ ...world.mounts[i]!, ...change })),
        enemies: [{ ...enemy, ...enemies }],
        heroes: world.heroes.map((h, i) => (i ? h : { ...h, ...heroes })),
      }),
    );
  const at = { x: enemy.x, y: enemy.y, facing: enemy.facing };
  const cases: [string, Partial<Mount>[], Partial<Enemy>?, Partial<Hero>?][] = [
    ["a beast ridden by nobody there", [{}, { rider: 99 }, {}]],
    ["a rider off its beast", [{}, {}, {}], { x: enemy.x + 1 }],
    ["a figure riding no beast", [{}, { rider: 0, state: "wander" }, {}]],
    ["two beasts under one rider", [{}, {}, { ...at, rider: enemy.id, state: "idle" }]], // prettier-ignore
    ["a riderless beast sweeping", [{}, {}, { state: "sweep" }]],
    ["a ridden beast wandering", [{}, { state: "wander" }, {}]],
    ["a lancer riding", [{}, {}, {}], { kind: "lancer" }],
    ["a beast off the floor", [{}, {}, { z: px(4) }]],
    ["a beast still falling on the floor", [{}, {}, { vz: -1 }]],
    ["a beast with an enemy's id", [{}, {}, { id: enemy.id }]],
    ["beasts out of id order", [{}, { id: free.id }, { id: theirs.id }]],
    ["a sweep cooling too long", [{}, { coolUntil: world.step + T.TAIL_COOL + 1 }, {}]], // prettier-ignore
    ["an enemy's beast hopping", [{}, { state: "hop" }, {}]],
    ["an enemy's beast walking of its own", [{}, { vx: 1 }, {}]],
    ["a riderless beast walking of its own", [{}, {}, { vy: 1 }]],
    ["a hero's beast walking in", [{ state: "enter" }, {}, {}]],
    ["a hero above its beast", [{}, {}, {}], {}, { z: px(2) }],
    ["a rider with a speed of its own", [{}, {}, {}], {}, { vx: 1 }],
    ["a rider with a speed in depth", [{}, {}, {}], {}, { vy: 1 }],
    ["a hero's beast faster than its walk", [{ vx: T.BEAST_WALK.x + 1 }, {}, {}]], // prettier-ignore
    ["a hero's beast faster in depth", [{ vy: -T.BEAST_WALK.y - 1 }, {}, {}]], // prettier-ignore
    ["a beast rising faster than a hop", [{}, {}, { state: "flee", z: px(4), vz: T.JUMP_VZ + 1 }]], // prettier-ignore
  ];
  for (const [what, mounts, enemies, heroes] of cases)
    assert.equal(refused(mounts, enemies, heroes), undefined, what);
  assert.ok(refused([{}, { ...theirs }, {}]), "the world as it is");
  const many = Array.from({ length: T.MOUNT_MAX + 1 }, (_, i) => ({ ...free, id: free.id + i })); // prettier-ignore
  assert.equal(decodeWorld(encodeWorld({ ...world, mounts: many })), undefined);
});

/** The rider that fell and the beast that lost it: a knockdown at the saddle's height, the beast panicking. */
function unseated(world: World, id: number) {
  const fallen = world.enemies.find((e) => e.id === id)!;
  assert.equal(fallen.state, "knockdown");
  assert.deepEqual(
    [beast(world).rider, beast(world).state, toView(world).mounts[0]!.rider],
    [0, "flee", null],
  );
  kept(world);
  return fallen;
}

test("a spell, a thrown body and a slash that leaves it no hit points each knock the rider off, and its beast panics", () => {
  // Rhea's spell lands on the rider in view, as it does on any enemy.
  const rhea = party("rhea");
  let world = mounted({ ...rhea, heroes: [{ ...hero(rhea), pots: 1 }] }, 60);
  const id = rider(world)!.id;
  world = run(step(world, [MAGIC]), T.SPELLS.rhea.levels[0]!.hit + 1);
  assert.ok(unseated(world, id).hp < FULL, "it took the spell's damage");
  assert.ok(hero(world).magicDamage > 0);
  // A hurt ravager thrown over Brakka's shoulder flies into a rider behind it, as into any enemy.
  world = party("brakka");
  const { x, y } = hero(world);
  world = spawnEnemy(world, "ravager", x + px(14), y);
  world = spawnEnemy(world, "ravager", x - px(70), y);
  const [body, behind] = world.enemies as [Enemy, Enemy];
  world = spawnMount(world, behind.x, behind.y, behind.id);
  world = {
    ...world,
    enemies: world.enemies.map((e) => (e === body ? { ...e, state: "hurt" } : e)), // prettier-ignore
  };
  world = step(world, [RIGHT | ATTACK]);
  assert.equal(world.enemies[0]!.state, "held", "grabbed");
  world = until(world, (w) => w.enemies[1]!.state !== "ride");
  assert.equal(unseated(world, behind.id).hp, FULL - T.BODY_DAMAGE);
  assert.ok(hero(world).throws === 1 && hero(world).knockdowns === 2);
  // A slash that takes the last hit point knocks it off as the finisher does, and it dies rather than riding on.
  world = mounted(party("brakka"), 20);
  world = { ...world, enemies: world.enemies.map((e) => ({ ...e, hp: 1 })) };
  world = until(step(world, [ATTACK]), (w) => rider(w) === undefined);
  assert.equal(unseated(world, world.enemies[0]!.id).hp, 0);
  world = until(world, (w) => w.enemies[0]!.state === "dead");
  assert.equal(beast(world).rider, 0);
});

test("a rider cannot be grabbed off its beast, and a beast spares an invulnerable hero and one in the air above its tail", () => {
  // Brakka's grab takes a dazed enemy only, and a rider is never dazed: Attack beside one is a slash.
  let world = mounted(party("brakka"), 14);
  world = step(world, [RIGHT | ATTACK]);
  assert.deepEqual([hero(world).state, rider(world)?.state], ["attack1", "ride"]); // prettier-ignore
  // Wound up over the lash step, the tail passes under a hero in the air and one in its getting-up grace.
  world = mounted(party("brakka", "rhea", "gorm"), 30);
  const { x, y } = beast(world);
  world = moved(world, 1, x + px(20), y);
  world = moved(world, 2, x - px(20), y);
  world = {
    ...world,
    heroes: world.heroes.map((h, i) =>
      i === 1
        ? { ...h, state: "jump", z: px(300), vz: 0 }
        : i === 2
          ? { ...h, invulnUntil: world.step + 2 * T.TAIL_STEPS }
          : h,
    ),
  };
  const full = hps(world);
  world = run(world, T.TAIL_WINDUP + 2);
  assert.equal(beast(world).state, "sweep");
  assert.deepEqual(hps(world), [full[0]! - T.TAIL_DAMAGE, full[1], full[2]]);
  assert.deepEqual(world.heroes.map((h) => h.state === "knockdown"), [true, false, false]); // prettier-ignore
});

test("a beast riderless holds no wave, and a wave's spawn of a kind that cannot ride walks in on foot", () => {
  // A wave with every enemy fought and a beast left wandering clears, and the beast goes on.
  const start = party("brakka");
  const wave = createWorld({ seed: 5, heroes: [{ seat: 0, kind: "brakka" }] });
  const spawned = waveSpawns(STAGE_1.waves[0]!, 1).length;
  let world = loose({ ...wave, wave: 1, locked: true, spawned }, px(30));
  assert.equal(start.mounts.length, 0);
  world = step(world, []);
  assert.deepEqual([world.locked, world.mounts.length], [false, 1]);
  // Only a ravager is saddled: a lancer or an ogre a plan names a beast for stays on its own two feet.
  for (const kind of ["lancer", "ogre", "imp"] as const) {
    const odd = spawnEnemy(party("brakka"), kind, px(300), px(140));
    const enemy = { ...odd.enemies[0]! };
    const bare = { ...odd, enemies: [] as Enemy[], mounts: [] as Mount[] };
    saddle(bare, enemy, "clawbeak");
    assert.deepEqual([enemy.state, bare.mounts.length], [odd.enemies[0]!.state, 0], kind); // prettier-ignore
  }
});

test("Jump beside a riderless beast climbs on; too far or out of its lane it is a jump; two on one step leave it to the lower id", () => {
  let world = aboard(party("brakka"));
  assert.deepEqual([hero(world).state, beast(world).rider, beast(world).state], ["ride", 1, "idle"]); // prettier-ignore
  assert.deepEqual([hero(world).x, hero(world).y, hero(world).z], [beast(world).x, beast(world).y, 0]); // prettier-ignore
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
  world = loose(party("brakka", "rhea"), px(16));
  world = step(moved(world, 1, beast(world).x + px(6), beast(world).y), [JUMP, JUMP]); // prettier-ignore
  assert.deepEqual([world.heroes.map((h) => h.state), beast(world).rider], [["ride", "jump"], 1]); // prettier-ignore
  kept(world);
});

test("riding: the beast's walk, Attack lashing its tail at the enemies around (never a hero) once cooled, Jump hopping it, Down and Jump climbing off", () => {
  let world = aboard(party("brakka", "rhea"));
  const x0 = hero(world).x;
  world = run(world, 10, [RIGHT]);
  assert.deepEqual([hero(world).x - x0, beast(world).facing, beast(world).state], [10 * T.BEAST_WALK.x, 1, "walk"]); // prettier-ignore
  const { x, y } = hero(world);
  world = spawnEnemy(spawnEnemy(world, "ravager", x + px(30), y), "ravager", x - px(30), y); // prettier-ignore
  world = moved(world, 1, x + px(12), y + px(4));
  const [rhea, full] = [hero(world, 1), world.enemies[0]!.hp];
  world = run(step(world, [ATTACK]), T.TAIL_WINDUP);
  assert.deepEqual(world.enemies.map((e) => [e.state, e.hp, Math.sign(e.vx)]), [["knockdown", full - T.TAIL_DAMAGE, 1], ["knockdown", full - T.TAIL_DAMAGE, -1]]); // prettier-ignore
  assert.deepEqual([hero(world).knockdowns, hero(world).damage, hero(world).state], [2, 2 * T.TAIL_DAMAGE, "ride"]); // prettier-ignore
  assert.deepEqual([hero(world, 1).hp, hero(world, 1).state], [rhea.hp, "idle"], "Rhea in its sweep is spared"); // prettier-ignore
  world = until({ ...world, enemies: [] }, (w) => beast(w).state === "idle");
  assert.equal(beast(step(world, [ATTACK])).state, "idle", "it is cooling");
  world = run(world, T.TAIL_COOL);
  assert.equal(beast(step(world, [ATTACK])).state, "sweep");
  // A hop carries the hero up with the beast, and lands.
  world = run(step(world, [JUMP]), 10);
  assert.ok(beast(world).state === "hop" && beast(world).z > px(20));
  assert.equal(hero(world).z, beast(world).z);
  kept(world);
  world = until(world, (w) => beast(w).z === 0);
  assert.deepEqual([beast(world).state, hero(world).state], ["idle", "ride"]);
  // Down and Jump drops the hero from the saddle, and the beast wanders off.
  world = step(world, [DOWN | JUMP]);
  assert.deepEqual([hero(world).state, hero(world).z, beast(world).rider, beast(world).state], ["jump", T.SADDLE, 0, "wander"]); // prettier-ignore
  world = until(world, (w) => hero(w).state === "land");
  kept(world);
});

test("the saddle takes a light blow, which breaks off the tail's wind-up; a hard one, or any in a hop, throws the hero off and the beast panics", () => {
  let world = step(maced(aboard(party("brakka")), 60), [ATTACK]);
  assert.equal(beast(world).state, "sweep");
  world = step(world, []);
  assert.deepEqual([hero(world).state, hero(world).hp, beast(world).state], ["ride", 60 - T.RAVAGER[0].damage, "idle"]); // prettier-ignore
  assert.deepEqual([hero(world).stopUntil, beast(world).coolUntil], [world.step + T.HITSTOP, world.step + T.TAIL_COOL]); // prettier-ignore
  kept(world);
  world = run(maced(aboard(party("brakka")), 10), 2);
  assert.deepEqual([hero(world).state, hero(world).z], ["knockdown", T.SADDLE]);
  assert.deepEqual([beast(world).rider, beast(world).state, beast(world).facing], [0, "flee", -1]); // prettier-ignore
  assert.equal(toView(world).mounts[0]!.rider, null);
  kept(world);
  // Struck as it hops, the hero is thrown off whatever the blow, and the riderless beast comes down as it panics.
  world = step(step(maced(aboard(party("brakka")), 60), []), [JUMP]);
  assert.deepEqual([hero(world).state, beast(world).state], ["knockdown", "flee"]); // prettier-ignore
  assert.ok(beast(world).z > 0 && hero(world).z > T.SADDLE, "off the saddle");
  kept(world);
  assert.ok(T.PANIC_STEPS >= T.LEAP_STEPS, "a hop is down before the panic is over"); // prettier-ignore
  world = until(world, (w) => beast(w).z === 0, T.PANIC_STEPS);
  assert.deepEqual([beast(world).vz, beast(world).state], [0, "flee"]);
  kept(world);
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

test("a rider brought to no hit points falls from the saddle and goes out on its last life; no rider outlives a continue or a stage, and camp refuses one", () => {
  let world = aboard(party("brakka"));
  world = run(maced({ ...world, heroes: [{ ...hero(world), lives: 1 }] }, 5), 2); // prettier-ignore
  assert.deepEqual([hero(world).state, hero(world).hp, beast(world).rider], ["knockdown", 0, 0]); // prettier-ignore
  world = until(world, (w) => hero(w).state === "out");
  assert.deepEqual([hero(world).lives, toView(world).heroes[0]!.mounted], [0, false]); // prettier-ignore
  kept(world);
  // A continue drops every hero back in; a beast one still rode is left riderless.
  const riding = aboard(party("brakka", "rhea"));
  world = revive(loose(riding, px(60)));
  assert.deepEqual([hero(world).state, beast(world).rider, beast(world).state], ["respawn", 0, "wander"]); // prettier-ignore
  assert.deepEqual(beast(world, 1), beast(loose(riding, px(60)), 1), "another is left as it was"); // prettier-ignore
  kept(world);
  // The party goes on to camp on foot, carrying its lives, pots and health; the checkpoint refuses a rider there.
  const carry = carryOf(hero(riding));
  const camp = createWorld({ seed: 5, camp: true, heroes: [{ seat: 0, kind: "brakka", carry }] }); // prettier-ignore
  assert.deepEqual([hero(camp).state, camp.mounts], ["idle", []]);
  const sat: Hero = { ...hero(camp), state: "ride" };
  const under = { ...beast(riding), ...{ x: sat.x, y: sat.y, facing: sat.facing }, rider: sat.id, id: camp.nextId }; // prettier-ignore
  const rides = { ...camp, heroes: [sat], mounts: [under], nextId: camp.nextId + 1 }; // prettier-ignore
  assert.ok(decodeWorld(encodeWorld({ ...rides, camp: false })), "on the road");
  assert.equal(decodeWorld(encodeWorld(rides)), undefined);
  assert.equal(decodeWorld(encodeWorld({ ...camp, heroes: [sat] })), undefined);
});

test("a hop carries the walk the beast has on the step it leaves the floor, as a hero's jump does, and keeps it in the air", () => {
  // Jump pressed with Right, from a standstill: the hop goes that way at once, facing it, and no steering follows.
  let world = step(aboard(party("brakka")), []);
  const x0 = beast(world).x;
  world = step(world, [JUMP | RIGHT]);
  assert.deepEqual([beast(world).state, beast(world).facing, beast(world).vx, beast(world).x - x0], ["hop", 1, T.BEAST_WALK.x, T.BEAST_WALK.x]); // prettier-ignore
  world = run(world, 5, [LEFT]);
  assert.equal(beast(world).facing, 1, "no turning in the air");
  assert.equal(
    beast(world).x - x0,
    6 * T.BEAST_WALK.x,
    "no steering in the air",
  );
  kept(world);
  world = until(world, (w) => beast(w).z === 0);
  assert.deepEqual([beast(world).state, beast(world).vx, beast(world).vy], ["idle", 0, 0]); // prettier-ignore
});

test("no world heroes reach riding is refused by the checkpoint, and a rollback from any of them replays to the same one", () => {
  // Three heroes, two steered by pseudo-random presses (Jump, Attack, Magic and every direction), through Wyrmbone Pass,
  // with riderless beasts sent in beside them now and then, so the party boards, sweeps, hops, climbs off and is thrown off.
  let seed = 20261011;
  const roll = (n: number) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 8) % n;
  };
  const presses = [0, 0, 0, RIGHT, RIGHT | UP, RIGHT | DOWN, LEFT, DOWN, JUMP, JUMP, DOWN | JUMP, RIGHT | JUMP, ATTACK, ATTACK | RIGHT, MAGIC, UP | JUMP]; // prettier-ignore
  const base = createWorld({
    seed: 9,
    stage: 2,
    heroes: (["brakka", "rhea", "gorm"] as const).map((kind, seat) => ({
      seat,
      kind,
      carry: { lives: T.LIVES, pots: T.MAX_POTS[kind], hp: T.HERO_HP[kind] },
    })),
  });
  const seen = new Set<string>();
  let world = base;
  const held = [0, 0, 0];
  const trail: { world: World; held: number[]; sent?: number[] }[] = [];
  for (let tick = 0; tick < 1500; tick++) {
    if (tick % 4 === 0) held[0] = presses[roll(presses.length)]!;
    if (tick % 4 === 2) held[1] = presses[roll(presses.length)]!;
    held[2] = botInput(world, world.heroes[2]!.id, [world.heroes[0]!.id, world.heroes[1]!.id]); // prettier-ignore
    let sent: number[] | undefined;
    const near = world.heroes[roll(2)]!;
    if (tick % 70 === 6 && world.mounts.length < T.MOUNT_MAX)
      sent = [near.x + px(roll(41) - 20), near.y + px(roll(13) - 6)].map(Math.round); // prettier-ignore
    const before = world;
    if (sent) world = spawnMount(world, sent[0]!, sent[1]!);
    world = stepTick(world, held);
    trail.push({ world: before, held: [...held], sent });
    if (trail.length > 30) trail.shift();
    const raw = decodeWorld(structuredClone(encodeWorld(world)));
    assert.deepEqual(raw, world, `refused at step ${world.step}`);
    for (const h of world.heroes) {
      seen.add(h.state);
      const mount = world.mounts.find((m) => m.rider === h.id);
      if (mount) seen.add(`beast ${mount.state}`);
    }
    if (tick % 60 === 59) {
      // A rollback from the oldest of the trail replays the same inputs, and the same spawns, to the same world.
      let replay = decodeWorld(encodeWorld(trail[0]!.world))!;
      for (const { held: bits, sent: at } of trail) {
        if (at) replay = spawnMount(replay, at[0]!, at[1]!);
        replay = stepTick(replay, bits);
      }
      assert.deepEqual(replay, world, `rollback at step ${world.step}`);
    }
  }
  for (const covered of [
    "ride",
    "beast sweep",
    "beast hop",
    "beast walk",
    "knockdown",
    "jump",
  ])
    assert.ok(seen.has(covered), `the presses reached ${covered}`);
});

test("only a hero standing or walking climbs on: one in the air, running, swinging, reeling or landing jumps or goes on as it was, and a fleeing or leaving beast is boarded like a wandering one", () => {
  const beside = loose(party("brakka"), px(10));
  for (const state of [
    "jump",
    "run",
    "land",
    "hurt",
    "dash",
    "attack1",
  ] as const) {
    const world = step({ ...beside, heroes: [{ ...hero(beside), state, timer: 1, z: state === "jump" ? px(8) : 0, vz: 0, vx: 0 }] }, [state === "run" ? JUMP | RIGHT : JUMP]); // prettier-ignore
    assert.deepEqual([hero(world).state === "ride", beast(world).rider], [false, 0], state); // prettier-ignore
  }
  for (const [state, facing] of [
    ["flee", 1],
    ["leave", -1],
    ["wander", 1],
  ] as const) {
    const world = step({ ...beside, mounts: [{ ...beast(beside), state, facing }] }, [JUMP]); // prettier-ignore
    assert.deepEqual([hero(world).state, beast(world).rider, beast(world).state], ["ride", 1, "idle"], state); // prettier-ignore
    kept(world);
  }
});

test("the tail sweep kicks a sack imp open as a blade does: a pot pops out and the imp flies, while a hero beside it is spared", () => {
  let world = step(aboard(party("brakka", "rhea")), []);
  const { x, y } = hero(world);
  world = moved(spawnEnemy(world, "imp", x + px(10), y), 1, x - px(10), y);
  const imp = world.enemies[0]!;
  const full = imp.pots;
  world = run(step(world, [ATTACK]), T.TAIL_WINDUP);
  assert.deepEqual(
    world.items.map((item) => item.kind),
    ["pot"],
  );
  assert.deepEqual([world.enemies[0]!.state, world.enemies[0]!.pots, hero(world).struck], ["knockdown", full - 1, [imp.id]]); // prettier-ignore
  assert.equal(hero(world, 1).state, "idle");
  kept(world);
});

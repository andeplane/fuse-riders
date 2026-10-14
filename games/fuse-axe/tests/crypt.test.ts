import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  JUMP,
  MAGIC,
  RIGHT,
  STAGE_3,
  STAGES,
  botInput,
  createWorld,
  decodeWorld,
  encodeWorld,
  spawnEnemy,
  step,
  stepTick,
  toView,
  waveSpawns,
  type Enemy,
  type HeroKind,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import {
  BONEWALKER_STEPS,
  BONE_SWORD,
  gravesPx,
} from "../src/engine/view-kit.js";

const { px } = T;
const party = (...kinds: HeroKind[]) =>
  createWorld({
    seed: 9,
    stage: 3,
    heroes: kinds.map((kind, seat) => ({ seat, kind })),
  });
const hero = (world: World, index = 0) => world.heroes[index]!;
const bones = (world: World) =>
  world.enemies.filter((each) => each.kind === "bonewalker");
const full = (world: World, tier: T.Tier = 0) =>
  T.enemyMaxHp("bonewalker", tier, world.heroes.length);
const kept = (world: World) =>
  assert.deepEqual(decodeWorld(structuredClone(encodeWorld(world))), world);
/** An enemy `dx` px along the road from the first hero, in its lane, facing it, with `change` made to it. */
function foe(
  world: World,
  dx: number,
  change: Partial<Enemy> = {},
  kind: Enemy["kind"] = "bonewalker",
  tier: T.Tier = 0,
): World {
  const { x, y } = hero(world);
  const next = spawnEnemy(world, kind, x + px(dx), y, tier);
  next.enemies[next.enemies.length - 1] = {
    ...next.enemies.at(-1)!,
    facing: dx > 0 ? -1 : 1,
    ...change,
  };
  return next;
}
/** A bonewalker lying as a bone pile `dx` px in front of the first hero. */
const pile = (world: World, dx = 20) =>
  foe(world, dx, { state: "pile", hp: 0 });
/** Steps `world` with `held` (or none) until `done`, at most `limit` steps. */
function until(
  world: World,
  done: (w: World) => boolean,
  held: (w: World) => number[] = () => [],
  limit = 600,
): World {
  for (let i = 0; i < limit && !done(world); i++)
    world = step(world, held(world));
  assert.ok(done(world), String(done));
  return world;
}
/** The world with the camera at wave `index`'s trigger and the party with it, the wave about to begin. */
function at(world: World, index: number): World {
  const shift = STAGE_3.waves[index]!.at - world.camX;
  return {
    ...world,
    camX: world.camX + shift,
    heroes: world.heroes.map((h) => ({ ...h, x: h.x + shift })),
  };
}

test("the Drowned Crypt is Stage 3: five screens to the cathedral's doors, its bonewalkers rising from graves on their waves' screens", () => {
  const { waves, graves = [], length, cameraEnd, imps } = STAGE_3;
  assert.equal(STAGES[2], STAGE_3);
  assert.deepEqual([length, cameraEnd], [px(1600), px(1280)]);
  assert.deepEqual(
    graves.map(({ x, y }) => [x / T.SUB, y / T.SUB]),
    gravesPx(3),
  );
  assert.deepEqual([gravesPx(1), gravesPx(2)], [[], []]);
  assert.ok(waves.length >= 5 && waves.length <= 6);
  assert.equal(waves.at(-1)!.at, cameraEnd);
  assert.ok(imps.length >= 1 && imps.length <= 2);
  const used = new Set<number>();
  const kinds = new Set<string>();
  waves.forEach((wave, index) => {
    assert.ok(wave.at > (waves[index - 1]?.at ?? 0));
    for (const spawn of [...wave.spawns, ...(wave.extras ?? [])]) {
      kinds.add(`${spawn.kind}${spawn.tier}`);
      if (spawn.grave === undefined) continue;
      const grave = graves[spawn.grave]!;
      used.add(spawn.grave);
      // The pit is on the screen the wave holds, a whole body in from its edges.
      assert.equal(spawn.kind, "bonewalker");
      assert.ok(grave.x - T.ENEMY_HALF_W >= wave.at, `wave ${index + 1}`);
      assert.ok(grave.x + T.ENEMY_HALF_W <= wave.at + px(T.VIEW_W));
      assert.equal(spawn.y, grave.y);
    }
  });
  assert.equal(used.size, graves.length, "every grave opens");
  for (const each of ["bonewalker0", "bonewalker1", "ravager2", "lancer1"])
    assert.ok(kinds.has(each), each);
  // A bigger party's copy of a rise claws out of the same grave a rise later; one of a walker walks in a round later.
  const placed = waveSpawns(waves[0]!, 5);
  assert.deepEqual(
    placed.filter((each) => each.grave === 0).map((each) => each.delay),
    [0, T.RISE_STEPS, 2 * T.RISE_STEPS],
  );
});

test("a wave's bonewalker claws up out of its grave facing the party, struck by no blade or spell until it stands", () => {
  let world = at(party("brakka", "rhea"), 0);
  world = {
    ...world,
    heroes: world.heroes.map((h) => ({ ...h, pots: h.kind === "brakka" ? 2 : 0 })), // prettier-ignore
  };
  world = step(world, []);
  const [riser] = bones(world);
  const [x, y] = gravesPx(3)[0]!;
  assert.deepEqual(
    [riser!.state, riser!.x, riser!.y, riser!.hp, riser!.facing],
    ["rise", px(x), px(y), full(world), -1],
  );
  kept(world);
  // Rhea stands at it slashing and Brakka casts at it: nothing lands until it is out of the ground.
  world = {
    ...world,
    heroes: world.heroes.map((h, i) => ({
      ...h,
      x: riser!.x + (i === 0 ? -px(60) : -px(18)),
      y: riser!.y,
      facing: 1,
    })),
  };
  const mash = (w: World) => [w.step < 2 ? MAGIC : 0, w.step % 2 ? ATTACK : 0];
  let blown = false;
  while (bones(world)[0]!.state === "rise") {
    world = step(world, mash(world));
    assert.equal(bones(world)[0]!.hp, full(world));
    blown ||= hero(world).casts === 1 && world.spells.length === 0;
    if (world.step % 7 === 0) kept(world);
  }
  assert.ok(blown, "the spell played out over the rise");
  assert.equal(hero(world, 1).damage, 0);
  assert.ok(world.step > T.RISE_STEPS, "the spell's freeze held the rise");
  world = until(world, (w) => hero(w, 1).damage > 0, mash);
});

test("the first fall with no hit points leaves a bone pile that pulls itself together with half its hit points; the second is the last", () => {
  let world = foe(party("brakka"), 20, { hp: 1 });
  world = until(world, (w) => bones(w)[0]!.state === "pile", (w) => [w.step === 0 ? ATTACK : 0]); // prettier-ignore
  const lying = bones(world)[0]!,
    fell = world.step - lying.timer;
  assert.deepEqual([lying.hp, lying.reassembled, lying.z], [0, false, 0]);
  kept(world);
  // Nobody touches it: it lies its time and pulls itself together, invulnerable, then fights on.
  world = { ...world, heroes: world.heroes.map((h) => ({ ...h, x: h.x - px(120) })) }; // prettier-ignore
  world = until(world, (w) => bones(w)[0]!.state === "reassemble");
  assert.equal(world.step, fell + T.PILE_STEPS);
  const half = Math.trunc(full(world) / 2);
  assert.deepEqual([bones(world)[0]!.hp, bones(world)[0]!.reassembled], [half, true]); // prettier-ignore
  kept(world);
  const back = until(world, (w) => bones(w)[0]!.state !== "reassemble");
  assert.equal(back.step - world.step, T.REASSEMBLE_STEPS);
  assert.equal(bones(back)[0]!.state, "idle");
  // Knocked to nothing again, it falls for good.
  world = foe({ ...back, enemies: [] }, 20, { hp: 1, reassembled: true });
  world = until(world, (w) => bones(w)[0]!.state === "dead", (w) => [w.step === back.step ? ATTACK : 0]); // prettier-ignore
});

test("any blow on a pile shatters it for good: a slash, a jump attack, a thrown body and a spell; nobody grabs one", () => {
  const shattered = (world: World, held: (w: World) => number[], kos = 1) => {
    const before = hero(world).knockdowns;
    world = until(world, (w) => bones(w).every((e) => e.state === "dead"), held); // prettier-ignore
    assert.equal(hero(world).knockdowns, before + kos);
    assert.equal(bones(world)[0]!.hp, 0);
    assert.ok(world.fx.some((fx) => fx.kind === "ko"));
    kept(world);
    // Shattered bones blink out as a defeat does, and never reassemble.
    return until(world, (w) => bones(w).length === 0, () => [], T.DEAD_STEPS + 1); // prettier-ignore
  };
  const start = pile(party("brakka"));
  // Toward it with Attack, as a grab is asked for: the pile is never dazed, so the slash shatters it.
  shattered(start, (w) => [w.step === 0 ? RIGHT | ATTACK : 0]);
  assert.ok(step(start, [RIGHT | ATTACK]).enemies.every((e) => e.state !== "held")); // prettier-ignore
  shattered(start, (w) => [w.step === 0 ? JUMP : w.step === 4 ? ATTACK : 0]);
  shattered(
    { ...start, heroes: start.heroes.map((h) => ({ ...h, pots: 1 })) },
    (w) => [w.step === 0 ? MAGIC : 0],
  );
  // A dazed ravager thrown back over the hero's shoulder lands on the pile behind it (the throw a knockdown too).
  let thrower = foe(pile(party("brakka"), -30), 14, { state: "hurt" }, "ravager"); // prettier-ignore
  thrower = shattered(thrower, (w) => [w.step === 0 ? RIGHT | ATTACK : 0], 2);
  assert.equal(hero(thrower).throws, 1);
});

test("no blade lands on a bonewalker pulling itself together, as on one getting up, but a spell does", () => {
  const mending = (world: World) =>
    foe(world, 20, { state: "reassemble", reassembled: true, hp: 8 });
  const swung = until(mending(party("brakka")), (w) => w.step === 12, (w) => [w.step === 0 ? ATTACK : 0]); // prettier-ignore
  assert.deepEqual(
    [bones(swung)[0]!.state, bones(swung)[0]!.hp],
    ["reassemble", 8],
  );
  const armed = party("brakka");
  const cast = mending({ ...armed, heroes: armed.heroes.map((h) => ({ ...h, pots: 1 })) }); // prettier-ignore
  const blown = until(cast, (w) => bones(w)[0]!.state !== "reassemble", (w) => [w.step === 0 ? MAGIC : 0]); // prettier-ignore
  assert.equal(bones(blown)[0]!.state, "knockdown");
  assert.ok(bones(blown)[0]!.hp < 8);
});

test("a wave waits for its piles; one nobody shatters pulls itself together and is fought again, so the wave still clears", () => {
  let world = at(party("brakka"), 0);
  world = pile(
    {
      ...world,
      wave: 1,
      locked: true,
      spawned: waveSpawns(STAGE_3.waves[0]!, 1).length,
      waveStep: world.step,
    },
    120,
  );
  while (bones(world)[0]!.state === "pile") {
    world = step(world, []);
    assert.ok(world.locked, "no wave is cleared while a pile lies");
  }
  assert.equal(bones(world)[0]!.state, "reassemble");
  const bots = (w: World) => w.heroes.map((h) => botInput(w, h.id));
  world = until(world, (w) => !w.locked, bots, 3000);
  assert.deepEqual(world.enemies, [], "the second fall is the last");
});

test("a bonewalker swings its sword as a ravager its mace, quicker; the violet knight's reaches furthest", () => {
  for (const tier of T.TIERS) {
    const { windup, damage } = T.BONEWALKER[tier];
    assert.ok(windup < T.RAVAGER[tier].windup, `${tier}`);
    assert.ok(T.enemyMaxHp("bonewalker", tier, 3) < T.enemyMaxHp("ravager", tier, 3)); // prettier-ignore
    assert.equal(BONE_SWORD[tier], T.BONE_REACH[tier] / T.SUB);
    assert.equal(BONEWALKER_STEPS.windup[tier], windup);
    // Wound up at a hero a whole sword away (beyond a mace), it lands on the step after the wind-up's last.
    const reach = (T.BONE_REACH[tier] + T.HERO_HALF_W) / T.SUB;
    let world = foe(party("gorm"), reach, { state: "windup", target: 1, timer: windup - 2 }, "bonewalker", tier); // prettier-ignore
    world = step(world, []);
    assert.equal(hero(world).hp, T.HERO_HP.gorm);
    world = step(world, []);
    assert.equal(bones(world)[0]!.state, "attack");
    assert.equal(hero(world).hp, T.HERO_HP.gorm - damage, `${tier}`);
    world = foe(party("gorm"), reach + 1, { state: "windup", target: 1, timer: windup - 1 }, "bonewalker", tier); // prettier-ignore
    assert.equal(hero(step(world, [])).hp, T.HERO_HP.gorm, "out of reach");
  }
  assert.ok(
    T.BONE_REACH[2] > T.BONE_REACH[0] && T.BONE_REACH[0] > T.MACE_REACH,
  );
  assert.deepEqual(
    [BONEWALKER_STEPS.rise, BONEWALKER_STEPS.pile, BONEWALKER_STEPS.reassemble],
    [T.RISE_STEPS, T.PILE_STEPS, T.REASSEMBLE_STEPS],
  );
});

test("at the cathedral's doors a pair of armoured knights walks out from both sides, no boss, a bigger party meeting more", () => {
  const { spawns, extras = [] } = STAGE_3.waves.at(-1)!;
  assert.deepEqual(
    spawns.map((s) => [s.kind, s.tier, s.side, s.grave]),
    [
      ["bonewalker", 2, "left", undefined],
      ["bonewalker", 2, "right", undefined],
    ],
  );
  assert.ok(extras.length > 0 && !T.BOSS.bonewalker);
  const last = STAGE_3.waves.length - 1;
  let world = at(party("brakka", "rhea", "gorm"), last);
  world = { ...world, wave: last, impsSent: STAGE_3.imps.length };
  world = until(world, (w) => w.spawned === 2);
  assert.deepEqual(
    world.enemies.map((e) => [e.kind, e.tier, e.state, e.hp, e.facing]),
    [
      ["bonewalker", 2, "enter", full(world, 2), 1],
      ["bonewalker", 2, "enter", full(world, 2), -1],
    ],
  );
  assert.ok(full(world, 2) > full(world, 0));
  world = until(world, (w) => w.spawned === 4);
  assert.equal(world.enemies.length, 4, "two more for two heroes more");
  assert.equal(toView(world).boss, null);
  kept(world);
});

test("a bot walks over to a pile and shatters it before it pulls itself together", () => {
  let world = pile(party("rhea"), 90);
  while (world.step < T.PILE_STEPS && bones(world)[0]!.state === "pile")
    world = stepTick(world, [botInput(world, 1)]);
  assert.equal(bones(world)[0]!.state, "dead");
  assert.equal(hero(world).knockdowns, 1);
});

test("a bot spends no pot on piles about it, hurt or surrounded, and does on a swordsman", () => {
  const armed = (w: World, hp = T.HERO_HP.rhea): World => ({
    ...w,
    heroes: w.heroes.map((h) => ({ ...h, pots: 2, hp })),
  });
  const thirds = Math.trunc(T.HERO_HP.rhea / 3);
  // Three piles within reach would be a crowd, and one enough for a hero at a third of its health, were they foes.
  const lying = pile(pile(pile(armed(party("rhea")), 20), 30), 40);
  assert.equal(botInput(lying, 1) & MAGIC, 0);
  assert.ok(botInput(lying, 1) & ATTACK, "it shatters one instead");
  assert.equal(botInput(pile(armed(party("rhea"), thirds)), 1) & MAGIC, 0);
  // The same bonewalkers on their feet are cast at.
  const walkers = foe(foe(foe(armed(party("rhea")), 20), 30), 40);
  assert.equal(botInput(walkers, 1) & MAGIC, MAGIC);
  assert.equal(
    botInput(foe(armed(party("rhea"), thirds), 20), 1) & MAGIC,
    MAGIC,
  );
});

test("a rollback or a checkpoint mid-rise, on a pile and mid-reassembly replays to the same world", () => {
  const bots = (w: World) => w.heroes.map((h) => botInput(w, h.id));
  const play = (w: World) => stepTick(w, bots(w));
  const trail = [party("gorm")];
  const done = (w: World) =>
    w.enemies.some((e) => e.state === "reassemble" && e.timer > 10);
  while (trail.length < 4000 && !done(trail.at(-1)!))
    trail.push(play(trail.at(-1)!));
  for (let i = 0; i < 60; i++) trail.push(play(trail.at(-1)!));
  const end = trail.at(-1)!;
  const first = (found: (e: Enemy) => boolean) => {
    const cut = trail.findIndex((w) => w.enemies.some(found));
    assert.ok(cut > 0, String(found));
    return cut;
  };
  for (const cut of [
    first((e) => e.state === "rise" && e.timer > 0),
    first((e) => e.state === "pile" && e.timer > 0),
    first((e) => e.state === "reassemble" && e.timer > 0),
  ])
    for (const from of [trail[cut]!, decodeWorld(encodeWorld(trail[cut]!))!]) {
      let world = from;
      for (let i = cut; i < trail.length - 1; i++) world = play(world);
      assert.deepEqual(world, end);
    }
});

test("the checkpoint refuses a bonewalker where the rules never put one", () => {
  let world = at(party("brakka"), 0);
  world = foe(step(world, []), 40, { state: "pile", hp: 0 });
  world = foe(world, -40, { reassembled: true, hp: 1 }, "bonewalker", 1);
  world = foe(world, 60, {}, "ravager");
  kept(world);
  const [riser, lying, mended, ravager] = [0, 1, 2, 3];
  const refused = (index: number, change: Partial<Enemy>) => {
    const enemies = [...world.enemies];
    enemies[index] = { ...enemies[index]!, ...change };
    return decodeWorld(encodeWorld({ ...world, enemies }));
  };
  assert.equal(world.enemies[riser]!.state, "rise");
  for (const [what, index, change] of [
    ["a rise off its grave", riser, { x: world.enemies[riser]!.x + 1 }],
    ["a rise hurt", riser, { hp: full(world) - 1 }],
    ["a rise going for a hero", riser, { target: 1 }],
    ["a rise in the air", riser, { z: 1 }],
    ["a rise reassembled", riser, { reassembled: true }],
    ["a pile with hit points", lying, { hp: 1 }],
    ["a pile already reassembled", lying, { reassembled: true }],
    ["a pile sliding", lying, { vx: 1 }],
    ["a pile in the air", lying, { z: 1 }],
    ["a reassembly never had", lying, { state: "reassemble", hp: 1 }],
    ["a reassembled one past half", mended, { hp: T.enemyMaxHp("bonewalker", 1, 1) }], // prettier-ignore
    ["a bonewalker riding", mended, { state: "ride" }],
    ["a bonewalker thrusting", mended, { state: "thrust" }],
    ["a ravager reassembled", ravager, { reassembled: true }],
    ["a ravager rising", ravager, { state: "rise" }],
    ["a ravager in a pile", ravager, { state: "pile", hp: 0 }],
    ["a reassembly that is no flag", mended, { reassembled: 1 as never }],
  ] as const)
    assert.equal(refused(index, change), undefined, what);
  assert.ok(refused(lying, { state: "dead" }), "shattered");
  assert.ok(
    refused(mended, { state: "reassemble" }),
    "pulling itself together",
  );
  // Wyrmbone Pass has no graves to rise from.
  const pass = createWorld({ seed: 9, stage: 2, heroes: [{ seat: 0, kind: "brakka" }] }); // prettier-ignore
  assert.equal(decodeWorld(encodeWorld(foe(pass, 40, { state: "rise" }))), undefined); // prettier-ignore
  assert.ok(decodeWorld(encodeWorld(foe(pass, 40))));
});

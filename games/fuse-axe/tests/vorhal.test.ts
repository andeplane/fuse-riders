import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  DOWN,
  MAGIC,
  RIGHT,
  STAGES,
  STAGE_4,
  UP,
  botInput,
  createWorld,
  decodeWorld,
  encodeWorld,
  spawnEnemy,
  stageCleared,
  step,
  stepTick,
  toView,
  waveSpawns,
  type Enemy,
  type Hero,
  type HeroKind,
  type World,
} from "../src/engine/index.js";
import { REACT, REACT_SPREAD } from "../src/engine/bot.js";
import { next } from "../src/engine/rng.js";
import { summons } from "../src/engine/vorhal.js";
import * as T from "../src/engine/tuning.js";
import { SIGIL, VORHAL_STEPS, gravesPx } from "../src/engine/view-kit.js";
import { bossName } from "../src/render/hud.js";

const { px } = T;
const PLAN = STAGE_4;
const SLABS = PLAN.graves ?? [];
const full = (heroes = 1) => T.enemyMaxHp("vorhal", 0, heroes);
const hero = (world: World, index = 0) => world.heroes[index]!;
const vorhalOf = (world: World) =>
  world.enemies.find((each) => each.kind === "vorhal")!;
const bones = (world: World) =>
  world.enemies.filter((each) => each.kind === "bonewalker");
const patchHero = (world: World, index: number, change: Partial<Hero>) => ({
  ...world,
  heroes: world.heroes.map((h, i) => (i === index ? { ...h, ...change } : h)),
});
const patchVorhal = (world: World, change: Partial<Enemy>) => ({
  ...world,
  enemies: world.enemies.map((e) =>
    e.kind === "vorhal" ? { ...e, ...change } : e,
  ),
});
function run(world: World, steps: number, held: readonly number[] = []) {
  for (let index = 0; index < steps; index++) world = step(world, held);
  return world;
}
const kept = (world: World) =>
  assert.deepEqual(decodeWorld(structuredClone(encodeWorld(world))), world);

/**
 * The party in Vorhal's throne room, its wave being fought with every spawn in (so its extras for a bigger party are
 * gone), and Vorhal `dx` px along the road from the first hero, level with it, facing it, with `change` made to him.
 */
function throne(
  kinds: readonly HeroKind[],
  dx: number,
  change: Partial<Enemy> = {},
): World {
  const start = createWorld({
    seed: 7,
    stage: 4,
    heroes: kinds.map((kind, seat) => ({ seat, kind })),
  });
  const shift = PLAN.cameraEnd;
  const world = spawnEnemy(
    {
      ...start,
      camX: shift,
      heroes: start.heroes.map((h) => ({ ...h, x: h.x + shift })),
      wave: PLAN.waves.length,
      locked: true,
      spawned: waveSpawns(PLAN.waves.at(-1)!, kinds.length).length,
      impsSent: PLAN.imps.length,
    },
    "vorhal",
    start.heroes[0]!.x + shift + px(dx),
    start.heroes[0]!.y,
  );
  return patchVorhal(world, {
    facing: dx > 0 ? -1 : 1,
    thinkAt: 50,
    ...change,
  });
}

test("the throne room's wave is Vorhal, the stage's one boss; its slabs open only for his summons", () => {
  const { waves, cameraEnd } = PLAN;
  assert.equal(STAGES[3], PLAN);
  assert.deepEqual(
    waveSpawns(waves.at(-1)!, 1).map((each) => [each.kind, each.side]),
    [["vorhal", "right"]],
  );
  assert.ok(waves.slice(0, -1).every((w) => w.spawns.every((s) => !T.BOSS[s.kind]))); // prettier-ignore
  const raised = new Set(waves.flatMap((w) => w.spawns.map((s) => s.grave)));
  const throneSlabs = SLABS.filter((_, index) => !raised.has(index));
  assert.equal(throneSlabs.length, 3);
  assert.ok(throneSlabs.every((slab) => slab.x - T.ENEMY_HALF_W >= cameraEnd));
  assert.equal(gravesPx(4).length, SLABS.length);
});

test("Vorhal is big, tough and armoured: hit points by the party, a boss nobody throws, the bar named for him", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((n) => full(n)),
    [260, 325, 390, 455, 520],
  );
  assert.ok(T.BOSS.vorhal && !T.THROWABLE.vorhal);
  assert.ok(T.ENEMY_BODY.vorhal.height > T.ENEMY_HEIGHT);
  assert.equal(bossName("vorhal"), "VORHAL");
  // The throne room's wave: he walks in from beyond the road's end, and the bar shows him full.
  const start = createWorld({
    seed: 3,
    stage: 4,
    heroes: [{ seat: 0, kind: "gorm" }],
  });
  let world = step(
    {
      ...start,
      camX: PLAN.cameraEnd,
      wave: PLAN.waves.length - 1,
      heroes: start.heroes.map((h) => ({ ...h, x: h.x + PLAN.cameraEnd })),
      impsSent: PLAN.imps.length,
    },
    [],
  );
  assert.deepEqual(
    [vorhalOf(world).state, toView(world).boss],
    ["enter", { kind: "vorhal", hp: full(), maxHp: full() }],
  );
  world = run(world, 400);
  assert.ok(vorhalOf(world).x <= PLAN.length);
  kept(world);
});

test("the greatsword: a long wind-up, then two wide cuts in front, the first a blow and the second a knockdown, each landing once", () => {
  // Brakka lined up in front; Rhea at the edge of the cut's lane; Gorm just beyond it.
  let world = throne(["brakka", "rhea", "gorm"], 40);
  const v = vorhalOf(world);
  world = patchHero(world, 1, { x: v.x - px(30), y: v.y + T.CUT_LANE });
  world = patchHero(world, 2, { x: v.x - px(30), y: v.y - T.CUT_LANE - 1 });
  world = patchVorhal(world, { state: "windup", target: 1 });
  const hps = (w: World) => w.heroes.map((h) => h.hp);
  const { windup, damage } = T.VORHAL.calm;
  world = run(world, windup - 1);
  assert.deepEqual(hps(world), [60, 48, 72], "the wind-up is only a warning");
  world = step(world, []);
  assert.equal(vorhalOf(world).state, "cut1");
  assert.deepEqual(hps(world), [60 - damage, 48 - damage, 72]);
  assert.deepEqual([hero(world).state, hero(world, 2).state], ["hurt", "idle"]);
  kept(world);
  world = run(world, T.CUT_GAP + T.HITSTOP);
  assert.equal(vorhalOf(world).state, "cut2");
  const second = damage + T.CUT2_DAMAGE;
  assert.deepEqual(hps(world), [60 - damage - second, 48 - damage - second, 72]); // prettier-ignore
  assert.equal(hero(world).state, "knockdown");
  // Each cut lands once: nothing more to the end of the recovery.
  world = run(world, T.CUT_STEPS + T.VORHAL_RECOVER);
  assert.deepEqual(hps(world), [60 - damage - second, 48 - damage - second, 72]); // prettier-ignore
  assert.ok(["recover", "idle"].includes(vorhalOf(world).state));
  // A hero behind him is never cut, nor one who jumped over the blade.
  let behind = throne(["brakka"], -20, { state: "windup", facing: -1 });
  behind = run(behind, windup + T.CUT_GAP + 10);
  assert.equal(hero(behind).hp, 60);
});

test("the fire spell marks a sigil under each hero; its pillar burns whoever stays on it, once, and spares whoever steps off", () => {
  let world = throne(["brakka", "gorm"], 80, {
    state: "cast",
    timer: T.CAST_MARK - 1,
  });
  world = step(world, []);
  const marked = world.sigils;
  assert.ok(marked.length >= T.SIGILS && marked.length <= T.SIGILS + 1);
  const byPlace = (a: number[], b: number[]) => a[0]! - b[0]! || a[1]! - b[1]!;
  assert.deepEqual(
    marked.slice(0, 2).map(({ x, y, timer }) => [x, y, timer]).sort(byPlace), // prettier-ignore
    world.heroes.map((h) => [h.x, h.y, 0]).sort(byPlace),
  );
  for (const each of marked.slice(2)) {
    assert.ok(each.x >= world.camX && each.x <= world.camX + px(T.VIEW_W));
    assert.ok(each.y >= T.FLOOR_TOP && each.y <= T.FLOOR_BOTTOM);
  }
  assert.deepEqual(toView(world).sigils[0], {
    x: Math.floor(marked[0]!.x / T.SUB),
    y: Math.floor(marked[0]!.y / T.SUB),
    age: 0,
  });
  kept(world);
  // Brakka stands; Gorm walks up off his sigil.
  world = run(world, T.SIGIL_DELAY - 1, [0, UP]);
  assert.deepEqual(
    world.heroes.map((h) => h.hp),
    [60, 72],
  );
  world = step(world, [0, UP]);
  assert.deepEqual(
    world.heroes.map((h) => h.hp),
    [60 - T.PILLAR_DAMAGE, 72],
  );
  assert.equal(hero(world).state, "knockdown");
  kept(world);
  world = run(world, T.PILLAR_STEPS);
  assert.deepEqual(
    world.heroes.map((h) => h.hp),
    [60 - T.PILLAR_DAMAGE, 72],
  );
  assert.deepEqual(world.sigils, [], "burned out");
  // Enraged, he marks one more, up to four, the rest on the floor at random.
  const raging = run(
    throne(["rhea"], 80, {
      state: "cast",
      timer: T.CAST_MARK - 1,
      enraged: true,
      hp: full() / 2,
    }),
    1,
  );
  assert.ok(raging.sigils.length >= T.SIGILS + 1);
  assert.ok(raging.sigils.length <= T.SIGIL_MAX);
  kept(raging);
});

test("the fire spell goes round the party: in a party of five every seat is aimed at in some casts, and only the count are", () => {
  const spread = throne(["brakka", "rhea", "gorm", "brakka", "rhea"], 80, {
    state: "cast",
    timer: T.CAST_MARK - 1,
  });
  const party = {
    ...spread,
    heroes: spread.heroes.map((h, index) => ({
      ...h,
      x: spread.camX + px(40 + 50 * index),
      y: px(110 + 12 * index),
    })),
  };
  const aimed = new Set<number>();
  for (let rng = 1; rng <= 60; rng++) {
    const cast = step({ ...party, rng }, []);
    const under = cast.heroes.filter((h) =>
      cast.sigils.some((s) => s.x === h.x && s.y === h.y),
    );
    assert.ok(under.length >= T.SIGILS && under.length <= T.SIGILS + 1);
    assert.ok(cast.sigils.length <= T.SIGIL_MAX);
    for (const h of under) aimed.add(h.id);
  }
  assert.deepEqual([...aimed].sort(), party.heroes.map((h) => h.id).sort());
});

test("the summons raise bonewalkers from the slabs on screen, none where one still rises, within the world's room and his cap", () => {
  const summoning = (change: Partial<Enemy> = {}, world = throne(["gorm"], 80)) =>
    step(patchVorhal(world, { state: "summon", timer: T.SUMMON_AT - 1, ...change }), []); // prettier-ignore
  let world = summoning();
  const raised = bones(world);
  assert.equal(raised.length, T.SUMMONED);
  for (const bone of raised) {
    assert.equal(bone.timer, 0, "a wave's spawn rises the full RISE_STEPS");
    assert.deepEqual([bone.state, bone.tier, bone.hp], ["rise", 0, T.enemyMaxHp("bonewalker", 0, 1)]); // prettier-ignore
    assert.ok(SLABS.some((s) => s.x === bone.x && s.y === bone.y));
    assert.ok(bone.x >= world.camX);
  }
  kept(world);
  // Again while those still rise: only the slab left.
  world = summoning({}, run(world, 10));
  assert.equal(bones(world).length, T.SUMMONED + 1);
  assert.equal(summons(world), false, "his cap is reached");
  // Enraged, rust ones; and no more than the world has room for.
  assert.ok(bones(summoning({ enraged: true, hp: 1 })).every((b) => b.tier === 1)); // prettier-ignore
  let crowded = throne(["gorm"], 80);
  while (crowded.enemies.length < T.ENEMY_MAX - 1)
    crowded = spawnEnemy(crowded, "ravager", crowded.camX + px(160), px(140));
  crowded = summoning({}, crowded);
  assert.deepEqual([crowded.enemies.length, bones(crowded).length], [T.ENEMY_MAX, 1]); // prettier-ignore
  assert.equal(summons(crowded), false);
  kept(crowded);
  // On a screen with no slab he cannot summon at all.
  const bare = { ...throne(["gorm"], 80), stage: 1, camX: 0, wave: 0, locked: false }; // prettier-ignore
  assert.equal(summons(bare), false);
});

test("at half his hit points he roars, nothing landing on him, then fights on enraged and faster", () => {
  let world = throne(["rhea"], 30, {
    state: "idle",
    hp: full() / 2,
    thinkAt: 0,
  });
  world = step(world, []);
  assert.deepEqual([vorhalOf(world).state, vorhalOf(world).enraged], ["roar", true]); // prettier-ignore
  kept(world);
  // A slash, then a spell, while he roars: neither lands.
  world = patchHero(world, 0, { pots: 6, facing: 1, x: vorhalOf(world).x - px(20) }); // prettier-ignore
  world = run(step(world, [ATTACK]), 20);
  assert.equal(vorhalOf(world).hp, full() / 2);
  world = run(step(step(world, [MAGIC]), []), T.SPELLS.rhea.levels[5]!.hit);
  assert.deepEqual([vorhalOf(world).hp, vorhalOf(world).state], [full() / 2, "roar"]); // prettier-ignore
  world = run(world, T.ROAR_STEPS);
  assert.deepEqual(
    [vorhalOf(world).state !== "roar", vorhalOf(world).enraged],
    [true, true],
  );
  // Enraged he winds up faster.
  const fast = run(
    throne(["rhea"], 40, { state: "windup", enraged: true, hp: 10, target: 1 }),
    T.VORHAL.rage.windup,
  );
  assert.equal(vorhalOf(fast).state, "cut1");
  assert.ok(T.VORHAL.rage.windup < T.VORHAL.calm.windup);
});

test("a spell knocks him down but takes no more than a boss's share", () => {
  let world = throne(["rhea"], 60, { state: "walk", target: 1 });
  world = patchHero(world, 0, { pots: 6 });
  world = run(step(step(world, [MAGIC]), []), T.SPELLS.rhea.levels[5]!.hit);
  assert.equal(
    vorhalOf(world).hp,
    full() - Math.floor((full() * T.BOSS_SHARE) / T.SHARE),
  );
  assert.equal(vorhalOf(world).state, "knockdown");
});

test("cornered, he leaps over the party to the far side of the screen and lands facing it", () => {
  // His back to the screen's left edge and Brakka close in front: a draw under `VAULT_CHANCE` leaps.
  let world = throne(["brakka"], 40, { thinkAt: 0, state: "idle" });
  const v = vorhalOf(world);
  world = patchVorhal(world, { x: world.camX + px(30), facing: 1 });
  world = patchHero(world, 0, { x: world.camX + px(70), y: v.y });
  let rng = 1;
  while (next(rng).value % 256 >= T.VAULT_CHANCE) rng++;
  world = step({ ...world, rng }, []);
  assert.deepEqual([vorhalOf(world).state, vorhalOf(world).facing], ["leap", 1]); // prettier-ignore
  const goal = world.camX + px(T.VIEW_W) - T.VAULT_INSET;
  assert.equal(vorhalOf(world).goal, goal);
  world = run(world, 5);
  assert.ok(vorhalOf(world).z > 0);
  kept(world);
  world = run(world, T.VAULT_STEPS);
  const landed = vorhalOf(world);
  assert.deepEqual([landed.state, landed.z, landed.facing], ["idle", 0, -1]);
  assert.ok(Math.abs(landed.x - goal) < px(8), "on the far side");
  assert.equal(VORHAL_STEPS.leap, T.VAULT_STEPS);
});

test("when he falls his bonewalkers crumble and his sigils go out, and the stage is won", () => {
  let world = throne(["brakka"], 20, {
    state: "idle",
    hp: 1,
    enraged: true,
    facing: -1,
  });
  world = spawnEnemy(world, "bonewalker", world.camX + px(200), px(150));
  world = { ...world, sigils: [{ x: world.camX + px(250), y: px(130), timer: 3 }] }; // prettier-ignore
  world = patchHero(world, 0, { facing: 1 });
  world = run(step(world, [ATTACK]), 12);
  assert.equal(vorhalOf(world).hp, 0);
  assert.deepEqual(
    bones(world).map((b) => [b.state, b.hp]),
    [["dead", 0]],
  );
  assert.deepEqual(world.sigils, []);
  kept(world);
  world = run(world, T.DEAD_STEPS + 60);
  assert.ok(stageCleared(world));
});

test("a bot steps off a sigil before it erupts and out of the greatsword's lane once it sees the wind-up, and strikes him only when he is open", () => {
  const sigil = { x: 0, y: 0, timer: 10 };
  let world = throne(["brakka"], 90);
  world = { ...world, sigils: [{ ...sigil, x: hero(world).x, y: hero(world).y }] }; // prettier-ignore
  assert.ok([UP, DOWN].includes(botInput(world, 1)), "off the sigil");
  // Lined up in front of a wind-up it has seen: out of the lane, never a swing.
  const seen = REACT + REACT_SPREAD;
  const winding = throne(["brakka"], 30, { state: "windup", timer: seen, target: 1 }); // prettier-ignore
  const dodge = botInput(winding, 1);
  assert.ok((dodge & (UP | DOWN)) !== 0 && (dodge & ATTACK) === 0);
  // In reach of him standing guard it keeps off; while he recovers it strikes.
  const guard = throne(["brakka"], 20, { state: "idle" });
  assert.equal(botInput(guard, 1) & ATTACK, 0);
  const open = patchVorhal(guard, { state: "recover", timer: 2 });
  assert.equal(botInput(open, 1) & ATTACK, ATTACK);
  assert.equal(botInput(patchVorhal(guard, { facing: 1 }), 1) & ATTACK, ATTACK, "his back"); // prettier-ignore
});

test("three bots beat him; every world of the fight is a checkpoint, and a rollback mid-cast, mid-summon, mid-leap, mid-roar or enraged replays to the same world", () => {
  const start = createWorld({
    seed: 10,
    stage: 4,
    heroes: (["brakka", "rhea", "gorm"] as const).map((kind, seat) => ({ seat, kind })), // prettier-ignore
  });
  const trail: World[] = [
    {
      ...start,
      camX: PLAN.cameraEnd,
      wave: PLAN.waves.length - 1,
      heroes: start.heroes.map((h) => ({ ...h, x: h.x + PLAN.cameraEnd })),
      impsSent: PLAN.imps.length,
    },
  ];
  const play = (w: World) =>
    stepTick(
      w,
      w.heroes.map((h) => botInput(w, h.id)),
    );
  while (trail.length < 2400 && !stageCleared(trail.at(-1)!)) {
    trail.push(play(trail.at(-1)!));
    if (trail.length % 10 === 0) kept(trail.at(-1)!);
  }
  assert.ok(stageCleared(trail.at(-1)!), "Vorhal is beaten");
  const first = (found: (w: World, v: Enemy) => boolean) => {
    const cut = trail.findIndex((w) => {
      const v = w.enemies.find((e) => e.kind === "vorhal");
      return v !== undefined && found(w, v);
    });
    assert.ok(cut > 0, String(found));
    return cut;
  };
  const AHEAD = 200;
  for (const cut of [
    first((_, v) => v.state === "windup" && v.timer > 0),
    first((w) => w.sigils.some((s) => s.timer > 0)),
    first((_, v) => v.state === "summon" && v.timer > T.SUMMON_AT),
    first((_, v) => v.state === "roar" && v.timer > 0),
    first((_, v) => v.enraged && v.state === "cut1"),
    first((_, v) => v.state === "stagger" || v.state === "leap"),
  ]) {
    const until = Math.min(cut + AHEAD, trail.length - 1);
    for (const from of [
      trail[cut]!,
      decodeWorld(structuredClone(encodeWorld(trail[cut]!)))!,
    ]) {
      let world = from;
      for (let i = cut; i < until; i++) world = play(world);
      assert.deepEqual(world, trail[until]);
    }
  }
});

test("the checkpoint refuses Vorhal and his sigils where the rules never put them", () => {
  let world = throne(["brakka"], 40, { state: "cast", timer: 5 });
  world = spawnEnemy(world, "ravager", world.camX + px(200), px(140));
  world = { ...world, sigils: [{ x: world.camX + px(100), y: px(130), timer: 5 }] }; // prettier-ignore
  kept(world);
  const vIndex = world.enemies.findIndex((e) => e.kind === "vorhal");
  const refused = (change: (w: World) => World) =>
    decodeWorld(structuredClone(encodeWorld(change(world))));
  const enemy = (index: number, change: Partial<Enemy> | Record<string, unknown>) => (w: World) => ({
    ...w,
    enemies: w.enemies.map((e, i) => (i === index ? { ...e, ...change } : e)),
  }); // prettier-ignore
  const sigil = (change: Record<string, unknown>) => (w: World) => ({
    ...w,
    sigils: [{ ...w.sigils[0]!, ...change }],
  });
  for (const [what, change] of [
    ["Vorhal reeling", enemy(vIndex, { state: "hurt" })],
    ["Vorhal held", enemy(vIndex, { state: "held" })],
    ["Vorhal riding", enemy(vIndex, { state: "ride" })],
    ["Vorhal swinging a mace", enemy(vIndex, { state: "attack" })],
    ["Vorhal in the air, casting", enemy(vIndex, { z: px(10) })],
    ["Vorhal roaring calm", enemy(vIndex, { state: "roar" })],
    ["Vorhal enraged with more than half", enemy(vIndex, { enraged: true })],
    ["a ravager cutting", enemy(1 - vIndex, { state: "cut1" })],
    ["a ravager roaring", enemy(1 - vIndex, { state: "roar" })],
    ["a sigil burned out", sigil({ timer: T.SIGIL_LIFE })],
    ["a sigil off the road", sigil({ x: PLAN.length + 1 })],
    ["a sigil off the floor", sigil({ y: T.FLOOR_TOP - 1 })],
    ["a sigil's odd timer", sigil({ timer: 1.5 })],
    ["too many sigils", (w: World) => ({ ...w, sigils: Array(T.SIGIL_MAX + 1).fill(w.sigils[0]) })], // prettier-ignore
  ] as const)
    assert.equal(refused(change), undefined, what);
  // Enraged at half, roaring, in the air on a leap: as the rules put him.
  kept(enemy(vIndex, { enraged: true, hp: full() / 2, state: "roar" })(world));
  kept(enemy(vIndex, { state: "leap", z: px(20), vx: px(4) })(world));
  // A sigil at camp is refused.
  const camp = createWorld({ seed: 1, stage: 3, camp: true, heroes: [{ seat: 0, kind: "rhea" }] }); // prettier-ignore
  assert.equal(decodeWorld(encodeWorld({ ...camp, sigils: [{ x: px(100), y: px(130), timer: 0 }] })), undefined); // prettier-ignore
  assert.deepEqual(SIGIL, {
    delay: T.SIGIL_DELAY,
    burn: T.PILLAR_STEPS,
    half: T.PILLAR_HALF / T.SUB,
    lane: T.PILLAR_LANE / T.SUB,
  });
});

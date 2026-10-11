import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  JUMP,
  MAGIC,
  RIGHT,
  STAGE_2,
  botInput,
  createWorld,
  decodeWorld,
  encodeWorld,
  spawnEnemy,
  spawnMount,
  stageCleared,
  step,
  stepTick,
  toView,
  type Enemy,
  type Hero,
  type HeroKind,
  type Mount,
  type World,
} from "../src/engine/index.js";
import { hits } from "../src/engine/lancer.js";
import { steedOf } from "../src/engine/mount.js";
import * as T from "../src/engine/tuning.js";
import { DRAKE_STEPS, FLAME, flamePx } from "../src/engine/view-kit.js";
import { bossName } from "../src/render/hud.js";

const { px } = T;
const party = (...kinds: HeroKind[]) =>
  createWorld({ seed: 5, heroes: kinds.map((kind, seat) => ({ seat, kind })) });
const hero = (world: World, index = 0) => world.heroes[index]!;
const drake = (world: World) => world.mounts.find((m) => m.kind === "drake")!;
const captain = (world: World) =>
  world.enemies.find((e) => e.kind === "captain")!;
const patch = <K extends "heroes" | "enemies" | "mounts">(
  world: World,
  key: K,
  index: number,
  change: Partial<World[K][number]>,
): World => ({
  ...world,
  [key]: world[key].map((each, i) => (i === index ? { ...each, ...change } : each)), // prettier-ignore
});
function run(world: World, steps: number, held: readonly number[] = []) {
  for (let i = 0; i < steps; i++) world = step(world, held);
  return world;
}
function until(world: World, done: (w: World) => boolean, limit = 600) {
  for (let i = 0; i < limit && !done(world); i++) world = step(world, []);
  assert.ok(done(world), "never happened");
  return world;
}
const kept = (world: World) =>
  assert.deepEqual(decodeWorld(structuredClone(encodeWorld(world))), world);
/** An enemy of `kind` riding a drake `dx` px along the road and `dy` in depth from the first hero, facing it. */
function riding(world: World, dx: number, dy = 0, kind: "ravager" | "captain" = "ravager") {
  const { x, y } = hero(world);
  const next = spawnEnemy(world, kind, x + px(dx), y + px(dy), 2);
  const enemy = next.enemies.at(-1)!;
  return spawnMount(next, enemy.x, enemy.y, enemy.id, "drake");
} // prettier-ignore
const BOSS_HP = T.enemyMaxHp("captain", 2, 1);

test("the flame runs out from the drake's mouth, holds at its length and draws back, none while it inhales", () => {
  const { inhale, breathe } = DRAKE_STEPS;
  assert.equal(breathe, T.DRAKE_INHALE + T.FLAME_STEPS);
  assert.equal(T.flameAt(inhale - 1), 0);
  assert.equal(T.flameAt(inhale), T.BEAST_HALF_W + T.FLAME_SPEED);
  assert.equal(T.flameAt(breathe - 1), T.BEAST_HALF_W + T.FLAME_SPEED);
  assert.equal(T.flameAt(breathe), 0);
  const fronts = Array.from({ length: breathe }, (_, t) => T.flameAt(t));
  assert.equal(Math.max(...fronts), T.BEAST_HALF_W + T.FLAME_LENGTH);
  const peak = fronts.indexOf(Math.max(...fronts));
  fronts.slice(inhale).forEach((front, i, all) => {
    const before = all[i - 1] ?? 0;
    assert.ok(i + inhale <= peak ? front >= before : front <= before, `${i}`);
  });
  // The view's helper is the same in pixels, and never throws.
  assert.equal(flamePx(inhale + 5.7), T.flameAt(inhale + 5) / T.SUB);
  for (const odd of [Number.NaN, -3, Infinity, 1e9])
    assert.equal(flamePx(odd), 0);
  assert.equal(FLAME.mouth + FLAME.length, (T.BEAST_HALF_W + T.FLAME_LENGTH) / T.SUB); // prettier-ignore
});

test("an enemy's drake inhales in plain sight, then its flame burns each hero it reaches in its lane once, along its facing", () => {
  // Brakka 40 px in front of a ravager's drake, Gorm 80 px in front in its lane, Rhea 70 px in front just out of it.
  let world = riding(party("brakka", "rhea", "gorm"), 40);
  const { x, y } = hero(world);
  world = patch(world, "heroes", 1, { x: x - px(30), y: y + T.FLAME_LANE + 1 });
  world = patch(world, "heroes", 2, { x: x - px(40), y });
  world = until(step(world, []), (w) => drake(w).state === "breathe");
  assert.equal(drake(world).facing, -1);
  const hit: number[] = [];
  const hps = (w: World) => w.heroes.map((h) => h.hp);
  const full = hps(world);
  for (let i = 0; i < DRAKE_STEPS.breathe; i++) {
    const before = hps(world);
    world = step(world, []);
    const { anim, animStep } = toView(world).mounts[0]!;
    if (i + 1 < DRAKE_STEPS.inhale) {
      assert.deepEqual([anim, flamePx(animStep)], ["breathe", 0]);
      assert.deepEqual(hps(world), full, "nothing burns while it inhales");
    }
    hps(world).forEach((hp, h) => hp < before[h]! && hit.push(h, drake(world).timer)); // prettier-ignore
  }
  // Each in the lane burns once, as the flame's front reaches its body; Rhea, out of the lane, never.
  const reached = (ahead: number) =>
    Array.from({ length: DRAKE_STEPS.breathe }, (_, t) => t).find(
      (t) => T.flameAt(t) >= px(ahead) - T.HERO_HALF_W,
    );
  assert.deepEqual(hit, [0, reached(40), 2, reached(80)]);
  assert.deepEqual(hps(world), [full[0]! - T.FLAME_DAMAGE, full[1], full[2]! - T.FLAME_DAMAGE]); // prettier-ignore
  assert.ok(["knockdown", "down"].includes(hero(world).state));
  assert.ok(hero(world).x < x, "knocked along the drake's facing");
  // It stands open, then breathes again only once its cool-down is over.
  assert.equal(drake(world).state, "idle");
  assert.equal(drake(world).coolUntil, world.step + T.DRAKE_COOL);
  kept(world);
});

test("a hero riding a drake breathes fire at the enemies in front with Attack, each once a breath, never at a hero, then cools", () => {
  // Brakka climbs on a riderless drake beside him and turns it right: a ravager waits 40 px in front, Rhea 70 px on.
  let world = party("brakka", "rhea");
  const { x, y } = hero(world);
  world = spawnMount(world, x + px(10), y, 0, "drake");
  world = spawnEnemy(world, "ravager", x + px(50), y);
  world = patch(world, "enemies", 0, { thinkAt: 9999, facing: -1 });
  world = patch(world, "heroes", 1, { x: x + px(100), y });
  world = step(step(world, [JUMP]), [RIGHT]);
  assert.deepEqual([hero(world).state, drake(world).facing], ["ride", 1]);
  world = step(world, [ATTACK]);
  assert.equal(drake(world).state, "breathe");
  world = run(world, DRAKE_STEPS.breathe + 20);
  const foe = world.enemies[0]!;
  assert.equal(foe.hp, T.enemyMaxHp("ravager", 0, 2) - T.FLAME_DAMAGE);
  assert.ok(["knockdown", "down"].includes(foe.state));
  assert.equal(hero(world, 1).hp, T.HERO_HP.rhea, "Rhea is never burned");
  assert.equal(hero(world).damage, T.FLAME_DAMAGE);
  // Attack again before the cool-down is over does nothing; after it, the drake breathes again.
  const cool = drake(world).coolUntil;
  assert.ok(cool > world.step);
  world = step(world, [ATTACK]);
  assert.notEqual(drake(world).state, "breathe");
  world = run(world, cool - world.step);
  world = step(step(world, []), [ATTACK]);
  assert.equal(drake(world).state, "breathe");
  kept(world);
});

test("the lancer captain is a boss: hit points for the party, armour and poise in the saddle and on foot, a spell's cap, no throw", () => {
  for (let heroes = 1; heroes <= T.CAPACITY; heroes++)
    for (const tier of T.TIERS)
      assert.equal(
        T.enemyMaxHp("captain", tier, heroes),
        Math.trunc((T.ENEMY_HP.captain * 4 * (3 + heroes)) / 16),
      );
  assert.deepEqual([T.BOSS.captain, T.THROWABLE.captain], [true, false]);
  // Brakka's finisher out at the captain on his drake 30 px in front.
  const finisher = (world: World, poise = 0) => {
    const at = patch(world, "enemies", 0, { poise });
    const swing = T.COMBO.brakka[2];
    return step(patch(at, "heroes", 0, { state: "attack3", timer: swing.startup - 1 }), []); // prettier-ignore
  };
  const mounted = riding(party("brakka"), 30, 0, "captain");
  // His saddle takes it while his poise holds: he flashes and stays on, and the drake's wind-up is broken off.
  let world = finisher(mounted);
  assert.deepEqual([captain(world).state, captain(world).hp, captain(world).poise], ["ride", BOSS_HP - 12, 12]); // prettier-ignore
  assert.ok(toView(world).enemies[0]!.flash && toView(world).enemies[0]!.boss);
  assert.ok(["idle", "walk"].includes(drake(world).state));
  // A slash his armour takes without breaking off the drake's inhale: he flashes, and neither of them holds still.
  const slash = { state: "attack1" as const, timer: T.COMBO.brakka[0].startup - 1 }; // prettier-ignore
  const inhaling = patch(mounted, "mounts", 0, { state: "breathe", timer: 5 });
  world = step(patch(inhaling, "heroes", 0, slash), []);
  assert.deepEqual([drake(world).state, drake(world).timer, captain(world).poise], ["breathe", 6, 6]); // prettier-ignore
  assert.ok(world.step > captain(world).stopUntil);
  // Once a quarter of his hit points is gone since he last fell, a heavy blow knocks him off, and the drake panics.
  world = finisher(mounted, Math.ceil(BOSS_HP / T.POISE) - 12);
  assert.deepEqual([captain(world).state, drake(world).state, drake(world).rider], ["knockdown", "flee", 0]); // prettier-ignore
  kept(world);
  // On foot his armour staggers rather than reels from a heavy blow, and takes a slash without a stagger.
  const afoot = spawnEnemy(party("brakka"), "captain", hero(mounted).x + px(30), hero(mounted).y, 2); // prettier-ignore
  world = finisher(patch(afoot, "enemies", 0, { thinkAt: 9999 }));
  assert.deepEqual([captain(world).state, captain(world).hp], ["stagger", BOSS_HP - 12]); // prettier-ignore
  world = run(world, T.HITSTOP + T.STAGGER_STEPS);
  assert.notEqual(captain(world).state, "stagger");
  world = run(step(patch(afoot, "enemies", 0, { thinkAt: 9999 }), [ATTACK]), T.COMBO.brakka[0].startup); // prettier-ignore
  assert.deepEqual([captain(world).hp, captain(world).poise], [BOSS_HP - 6, 6]);
  assert.ok(!["hurt", "stagger"].includes(captain(world).state));
  // On foot he leaps at a hero far along the road, and his plunge lands harder than a lancer's, in a wider lane.
  let leap = spawnEnemy(party("gorm"), "captain", hero(afoot).x + px(120), hero(afoot).y, 2); // prettier-ignore
  leap = until(leap, (w) => captain(w).state === "plunge");
  assert.equal(hero(leap).hp, T.HERO_HP.gorm - T.CAPTAIN_PLUNGE.damage);
  assert.equal(hero(leap).state, "knockdown");
  const aside = { ...hero(leap), x: captain(leap).x + captain(leap).facing * px(20), y: captain(leap).y + px(9) }; // prettier-ignore
  assert.deepEqual([hits(captain(leap), aside), hits({ ...captain(leap), kind: "lancer" }, aside)], [true, false]); // prettier-ignore
  // Rhea's strongest spell takes no more than a boss's share, and knocks him off his drake.
  let rhea = riding(patch(party("rhea"), "heroes", 0, { pots: 6 }), 60, 0, "captain"); // prettier-ignore
  rhea = run(step(step(rhea, [MAGIC]), []), T.SPELLS.rhea.levels[5]!.hit);
  const full = T.enemyMaxHp("captain", 2, 1);
  assert.equal(captain(rhea).hp, full - Math.floor((full * T.BOSS_SHARE) / T.SHARE)); // prettier-ignore
  assert.deepEqual([captain(rhea).state, drake(rhea).rider], ["knockdown", 0]);
});

test("in the saddle the captain thrusts at a hero close in front now and then where his drake would breathe", () => {
  let lances = 0,
    breaths = 0;
  for (let seed = 1; seed <= 12; seed++) {
    let world = riding({ ...party("gorm"), rng: seed }, 30, 0, "captain");
    world = until(step(world, []), (w) => ["breathe", "lance"].includes(drake(w).state)); // prettier-ignore
    if (drake(world).state === "breathe") {
      breaths++;
      continue;
    }
    lances++;
    // The spear lands on its wind-up's last step, a thrust that does not knock down.
    world = run(world, T.LANCE_WINDUP - drake(world).timer);
    assert.equal(hero(world).hp, T.HERO_HP.gorm - T.CAPTAIN.damage);
    assert.equal(hero(world).state, "hurt");
    kept(world);
  }
  assert.ok(lances > 0 && breaths > lances, `${lances} lances, ${breaths} breaths`); // prettier-ignore
});

test("knocked off, the captain gets up, walks back to his drake and climbs on, once; knocked off again he fights on foot", () => {
  const knock = (world: World) => {
    const swing = T.COMBO.brakka[2];
    const at = patch(world, "enemies", 0, { poise: BOSS_HP });
    const swinging = { state: "attack3" as const, timer: swing.startup - 1, struck: [] }; // prettier-ignore
    return step(patch(at, "heroes", 0, swinging), []);
  };
  // Brakka, far up the floor out of everyone's way after his blow, leaves the captain to his drake.
  const away = (world: World) => patch(world, "heroes", 0, { y: T.FLOOR_TOP });
  let world = away(knock(riding(party("brakka"), 30, 0, "captain")));
  assert.equal(captain(world).state, "knockdown");
  world = until(world, (w) => captain(w).state === "walk" && captain(w).target === 0); // prettier-ignore
  kept(world);
  world = until(world, (w) => captain(w).state === "ride", 900);
  assert.deepEqual([captain(world).remounted, drake(world).rider], [true, captain(world).id]); // prettier-ignore
  assert.deepEqual([captain(world).x, captain(world).y], [drake(world).x, drake(world).y]); // prettier-ignore
  kept(world);
  // Off again, he never climbs back on, and the drake leaves in time.
  const { x, y } = captain(world);
  const again = { x: x - px(30), y, facing: 1, stopUntil: 0 } as const;
  world = away(knock(patch(world, "heroes", 0, again)));
  assert.equal(captain(world).state, "knockdown");
  for (let i = 0; i < T.STRAY_STEPS + 600 && world.mounts.length; i++) {
    world = step(world, []);
    assert.notEqual(captain(world).state, "ride");
  }
  assert.equal(world.mounts.length, 0);
});

test("Wyrmbone Pass ends with the lancer captain riding his drake out of the skull gate, his bar the boss's; beating him clears the stage", () => {
  const start = createWorld({ seed: 3, stage: 2, heroes: [{ seat: 0, kind: "gorm" }] }); // prettier-ignore
  const end = STAGE_2.waves.at(-1)!;
  let world: World = {
    ...patch(start, "heroes", 0, { x: end.at + px(100) }),
    camX: end.at,
    wave: STAGE_2.waves.length - 1,
  };
  world = until(step(world, []), (w) => w.mounts.length > 0);
  const [boss, steed] = [captain(world), drake(world)];
  assert.deepEqual([boss.state, steed.state, steed.rider], ["ride", "enter", boss.id]); // prettier-ignore
  assert.ok(steed.x > world.camX + px(T.VIEW_W));
  const view = toView(world);
  assert.deepEqual(view.boss, { kind: "captain", hp: BOSS_HP, maxHp: BOSS_HP });
  assert.equal(bossName(view.boss!.kind), "LANCER CAPTAIN");
  assert.equal(view.mounts[0]!.kind, "drake");
  // He falls: his riderless drake holds nothing, and the pass is won.
  const loose = { ...steed, rider: 0, state: "wander" } as const;
  world = step({ ...world, enemies: [], mounts: [loose] }, []);
  assert.ok(stageCleared(world));
  assert.equal(world.mounts.length, 1);
});

test("a bot steps out of a breath it sees coming, and a party of bots knocks the captain off and beats him on foot", () => {
  // A bot 60 px in front of a ravager's drake, lined up: out of reach of its blade, it steps out of the flame's lane.
  for (const kind of T.HERO_KINDS) {
    let world = riding(party(kind), 60),
      flamed = false;
    while (world.step < DRAKE_STEPS.breathe + 6) {
      world = stepTick(world, [botInput(world, 1)]);
      flamed ||= T.flameAt(drake(world).timer) > 0;
    }
    assert.ok(flamed && hero(world).hp === T.HERO_HP[kind], kind);
  }
  // Brakka alone, then the three together, against the captain on his drake.
  for (const kinds of [
    ["brakka"],
    ["brakka", "rhea", "gorm"],
  ] as HeroKind[][]) {
    let world = riding(party(...kinds), 90, 0, "captain");
    let afoot = false;
    for (let i = 0; i < 1500 && world.enemies.length; i++) {
      world = stepTick(
        world,
        world.heroes.map((h) => botInput(world, h.id)),
      );
      afoot ||= world.enemies.some((e) => e.kind === "captain" && e.state !== "ride"); // prettier-ignore
    }
    assert.deepEqual([world.enemies.length, afoot], [0, true], kinds.join());
    assert.ok(
      world.heroes.every((h) => h.lives > 0),
      kinds.join(),
    );
  }
});

test("a rollback or a checkpoint mid-breath, mid-thrust, mid-stagger, while the captain walks back to his drake and once he has, replays to the same world", () => {
  // A seeded stream on which the captain thrusts from the saddle as well as his drake breathing.
  const three = { ...party("brakka", "rhea", "gorm"), rng: 3 };
  let opening = riding(three, 90, 0, "captain");
  // A hero's drake too, for Rhea to breathe fire from a while.
  opening = spawnMount(opening, hero(opening, 1).x + px(10), hero(opening, 1).y, 0, "drake"); // prettier-ignore
  const held = (w: World, i: number) =>
    w.heroes.map((h) =>
      h.id !== 2 ? botInput(w, h.id)
      : i === 1 ? JUMP
      : i === 2 ? RIGHT
      : i === 3 ? ATTACK
      : i > 40 ? botInput(w, h.id)
      : 0,
    ); // prettier-ignore
  const trail = [opening];
  while (trail.length < 900 && trail.at(-1)!.enemies.length)
    trail.push(stepTick(trail.at(-1)!, held(trail.at(-1)!, trail.length)));
  const end = trail.at(-1)!;
  const first = (found: (w: World) => boolean) => {
    const cut = trail.findIndex(found);
    assert.ok(cut > 0, String(found));
    return cut;
  };
  const boss = (w: World) => w.enemies.find((e) => e.kind === "captain");
  const theirs = (w: World) => w.mounts.find((m: Mount) => m.rider === boss(w)?.id); // prettier-ignore
  for (const cut of [
    first((w) => w.mounts.some((m) => m.state === "breathe" && m.timer > T.DRAKE_INHALE && w.heroes.some((h: Hero) => h.id === m.rider))), // prettier-ignore
    first((w) => theirs(w)?.state === "breathe" && theirs(w)!.timer > 0),
    first((w) => theirs(w)?.state === "lance" && theirs(w)!.timer > 0),
    first((w) => boss(w)?.state === "stagger"),
    first((w) => boss(w)?.state === "walk" && !boss(w)!.target && !!steedOf(w, boss(w)!)), // prettier-ignore
    first((w) => boss(w)?.remounted === true && boss(w)!.state === "ride"),
  ])
    for (const from of [trail[cut]!, decodeWorld(encodeWorld(trail[cut]!))!]) {
      let world = from;
      for (let i = cut; i < trail.length - 1; i++)
        world = stepTick(world, held(world, i + 1));
      assert.deepEqual(world, end);
    }
  assert.ok(trail.some((w) => (boss(w) as Enemy | undefined)?.remounted));
});

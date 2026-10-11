import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  JUMP,
  MAGIC,
  RIGHT,
  createWorld,
  decodeWorld,
  encodeWorld,
  spawnEnemy,
  step,
  stepTick,
  toView,
  type Enemy,
  type Hero,
  type HeroKind,
  type Spell,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import * as Kit from "../src/engine/view-kit.js";
import { heroFrame } from "../src/render/art/animate.js";

const { px } = T;
const party = (...kinds: HeroKind[]): World =>
  createWorld({ seed: 3, heroes: kinds.map((kind, seat) => ({ seat, kind })) });
const hero = (world: World, index = 0) => world.heroes[index]!;
/** The world with hero `index` changed by `patch`. */
const heroAs = (world: World, patch: Partial<Hero>, index = 0): World => ({
  ...world,
  heroes: world.heroes.map((each, i) =>
    i === index ? { ...each, ...patch } : each,
  ),
});
/** The world with enemy `index` changed by `patch`. */
const enemyAs = (world: World, patch: Partial<Enemy>, index = 0): World => ({
  ...world,
  enemies: world.enemies.map((each, i) =>
    i === index ? { ...each, ...patch } : each,
  ),
});
/** One hero of `kind` holding `pots`. */
const armed = (kind: HeroKind, pots = T.MAX_POTS[kind]) =>
  heroAs(party(kind), { pots });
function run(world: World, steps: number, held: readonly number[] = []) {
  for (let index = 0; index < steps; index++) world = step(world, held);
  return world;
}
/** Seat `seat` holds Magic for `held` steps and lets go on the next, the step a cast begins. */
const hold = (world: World, held: number, seat = 0) =>
  step(
    run(
      world,
      held,
      Array.from({ length: seat + 1 }, (_, i) => (i === seat ? MAGIC : 0)),
    ),
    [],
  );
const level = (kind: HeroKind, at: number) => T.SPELLS[kind].levels[at - 1]!;
/** Ravagers standing either side of the first hero, on screen and in its lane. */
const flanked = (world: World): World =>
  spawnEnemy(
    spawnEnemy(world, "ravager", hero(world).x + px(60), hero(world).y),
    "ravager",
    hero(world).x - px(40),
    hero(world).y + px(10),
  );
const blowOf = (world: World, enemy: Enemy, share: number) =>
  Math.trunc(
    (T.enemyMaxHp(enemy.kind, enemy.tier, world.heroes.length) * share) /
      T.SHARE,
  );

test("each hero's spell has a level for every pot it can hold, Gorm's hits hardest at every level and none outlasts 2.5 s", () => {
  for (const kind of T.HERO_KINDS) {
    const { levels } = T.SPELLS[kind];
    assert.equal(levels.length, T.MAX_POTS[kind], kind);
    levels.forEach((each, index) => {
      assert.ok(each.hit > 0 && each.hit < each.steps, `${kind} ${index}`);
      assert.ok(each.steps >= 90 && each.steps <= 150, `${kind} ${index}`);
      assert.ok(index === 0 || each.share > levels[index - 1]!.share);
      if (kind !== "gorm")
        assert.ok(index > 2 || T.SPELLS.gorm.levels[index]!.share > each.share);
    });
    // The top level leaves a fresh enemy a blow from gone; the first is a panic button.
    assert.ok(levels.at(-1)!.share < T.SHARE && levels.at(-1)!.share >= 13);
  }
  assert.deepEqual(
    T.HERO_KINDS.map((kind) => T.SPELLS[kind].kind),
    T.SPELL_KINDS,
  );
  assert.ok(T.MAGIC_TAP < T.CHARGE_STEPS);
  assert.deepEqual(Kit.SPELL_STEPS.fire[5], { steps: 150, hit: 90 });
  assert.equal(Kit.SPELL_STEPS.earth.length, T.MAX_POTS.gorm);
});

test("a tap casts every pot held, a tap shorter than a tick too, and spends them", () => {
  for (const kind of T.HERO_KINDS) {
    const world = hold(armed(kind), 3);
    assert.equal(hero(world).state, "cast", kind);
    assert.deepEqual(world.spells, [
      { hero: 1, level: T.MAX_POTS[kind], born: world.step },
    ]);
    assert.deepEqual([hero(world).pots, hero(world).casts], [0, 1]);
  }
  // Fewer pots than the most: the tap casts the ones there are.
  assert.equal(hold(armed("brakka", 2), T.MAGIC_TAP).spells[0]!.level, 2);
  const tick = stepTick(armed("gorm", 2), [0], [MAGIC]);
  assert.deepEqual(
    [hero(tick).state, tick.spells[0]!.level, hero(tick).pots],
    ["cast", 2, 0],
  );
});

test("held, the level starts at 1 and rises one every CHARGE_STEPS past the tap, up to the pots held; letting go early keeps the rest", () => {
  let world = armed("rhea");
  const seen: number[] = [];
  for (let held = 1; held <= T.MAGIC_TAP + 7 * T.CHARGE_STEPS; held++) {
    world = step(world, [MAGIC]);
    const view = toView(world).heroes[0]!;
    assert.deepEqual([view.anim, view.pots], ["charge", 6]);
    seen.push(view.charge);
    assert.deepEqual([hero(world).vx, hero(world).vy], [0, 0]);
  }
  const at = (held: number) => seen[held - 1];
  assert.equal(at(1), 1);
  assert.equal(at(T.MAGIC_TAP + T.CHARGE_STEPS), 1);
  assert.equal(at(T.MAGIC_TAP + T.CHARGE_STEPS + 1), 2);
  assert.equal(at(T.MAGIC_TAP + 5 * T.CHARGE_STEPS + 1), 6);
  assert.equal(seen.at(-1), 6, "no higher than the pots held");
  // Let go as level 2 shows: two pots spent, four kept. Just past the tap: level 1.
  const two = hold(armed("rhea"), T.MAGIC_TAP + T.CHARGE_STEPS + 1);
  assert.deepEqual([two.spells[0]!.level, hero(two).pots], [2, 4]);
  const one = hold(armed("rhea"), T.MAGIC_TAP + 1);
  assert.deepEqual([one.spells[0]!.level, hero(one).pots], [1, 5]);
  // Three pots: the charge stops at three.
  const three = hold(armed("rhea", 3), T.MAGIC_TAP + 9 * T.CHARGE_STEPS);
  assert.deepEqual([three.spells[0]!.level, hero(three).pots], [3, 0]);
  assert.equal(toView(three).heroes[0]!.charge, 0);
});

test("Magic from a run stops to charge, and a press made while busy waits: let go by then, it casts every pot", () => {
  let running = run(armed("brakka"), 1, [RIGHT]);
  running = run(running, 1, []);
  running = run(running, 3, [RIGHT]);
  assert.equal(hero(running).state, "run");
  const charging = step(running, [RIGHT | MAGIC]);
  assert.deepEqual(
    [hero(charging).state, hero(charging).vx, hero(charging).x],
    ["charge", 0, hero(running).x],
  );
  // Magic tapped in a slash's recovery: the cast comes as the slash ends, every pot in it.
  let busy = step(armed("brakka"), [ATTACK]);
  busy = run(busy, T.COMBO.brakka[0].startup + T.COMBO.brakka[0].active + 4);
  busy = run(step(busy, [MAGIC]), 1);
  assert.equal(hero(busy).state, "attack1");
  busy = run(busy, T.BUFFER_STEPS);
  assert.deepEqual([hero(busy).state, busy.spells[0]?.level], ["cast", 4]);
});

test("no magic with no pots, in the air, reeling or down, and a hit breaks a charge with nothing spent", () => {
  const none = run(hold(armed("rhea", 0), 40), 30);
  assert.deepEqual([hero(none).state, none.spells], ["idle", []]);
  // Pressed in the air and held through the landing: nothing.
  let air = run(step(armed("rhea"), [JUMP]), 10);
  air = run(air, 60, [MAGIC]);
  air = run(air, 30);
  assert.deepEqual(
    [hero(air).state, air.spells, hero(air).pots],
    ["idle", [], 6],
  );
  for (const state of ["hurt", "knockdown", "down", "getup"] as const) {
    const struck = run(hold(heroAs(armed("gorm"), { state }), 3), 30);
    assert.deepEqual([struck.spells, hero(struck).pots], [[], 3], state);
  }
  // A ravager's mace lands on a charging hero: it reels, and letting go casts nothing.
  const fighter = T.RAVAGER[0];
  let mace = spawnEnemy(armed("gorm"), "ravager", px(84), px(138));
  mace = enemyAs(mace, {
    ...{ state: "windup", timer: fighter.windup - 1, facing: -1 },
    thinkAt: mace.step,
  });
  mace = step(heroAs(mace, { state: "charge", timer: 30, held: MAGIC }), [
    MAGIC,
  ]);
  assert.equal(hero(mace).state, "hurt");
  mace = run(mace, 40);
  assert.deepEqual([mace.spells, hero(mace).pots], [[], 3]);
});

test("every enemy stands frozen until the blow lands, which strikes each fighting one on screen as the hero and level say and knocks it away from the caster", () => {
  for (const kind of T.HERO_KINDS)
    for (let at = 1; at <= T.MAX_POTS[kind]; at++) {
      const { hit, share } = level(kind, at);
      const cast = hold(flanked(armed(kind, at)), 3);
      const frozen = run(cast, hit - 1, [RIGHT]);
      assert.deepEqual(frozen.enemies, cast.enemies, `${kind} ${at} frozen`);
      assert.equal(frozen.rng, cast.rng, "no enemy thinks");
      const blown = step(frozen, [RIGHT]);
      const caster = hero(blown);
      let taken = 0;
      blown.enemies.forEach((enemy, index) => {
        const before = cast.enemies[index]!,
          away = enemy.x > caster.x ? 1 : -1;
        assert.equal(enemy.state, "knockdown");
        assert.equal(enemy.hp, before.hp - blowOf(blown, before, share));
        assert.deepEqual([Math.sign(enemy.vx), enemy.facing], [away, -away]);
        taken += before.hp - enemy.hp;
      });
      assert.deepEqual(
        [caster.magicDamage, caster.damage, caster.knockdowns, caster.casts],
        [taken, taken, 2, 1],
        `${kind} ${at}`,
      );
      assert.ok(blown.fx.length >= 2, "a spark on each");
      // They fly, lie and get up, and fight on: one goes for the caster again.
      const after = run(blown, T.DOWN_STEPS + T.GETUP_STEPS + 120);
      assert.ok(
        after.enemies.some((e) => ["walk", "windup"].includes(e.state)),
      );
    }
});

test("the blow leaves alone an enemy off screen, a sack imp, one in a hero's hands, one already beaten, and every hero", () => {
  let world = party("brakka", "rhea");
  world = heroAs(world, { pots: 4 });
  world = spawnEnemy(world, "ravager", px(340), px(138));
  world = spawnEnemy(world, "imp", px(200), px(150));
  world = spawnEnemy(world, "ravager", px(160), px(127));
  world = spawnEnemy(world, "ravager", px(120), px(160));
  world = enemyAs(world, { state: "dead", hp: 0 }, 3);
  const { hit } = level("brakka", 4);
  // Rhea grabs the third enemy just before the blow lands, so it is still in her hands.
  let cast = run(hold(world, 3), hit - 4);
  const rhea = hero(cast, 1);
  cast = heroAs(cast, { state: "grab", timer: 0, x: px(146), y: px(127) }, 1);
  cast = enemyAs(cast, { state: "held", holder: rhea.id }, 2);
  const blown = run(cast, 4);
  const [far, imp, held, beaten] = blown.enemies as [
    Enemy,
    Enemy,
    Enemy,
    Enemy,
  ];
  // Off screen, it stood frozen with the rest, and walks on as the blow lands elsewhere.
  assert.deepEqual([far.state, far.hp], ["walk", world.enemies[0]!.hp]);
  assert.deepEqual(
    [imp.state, imp.pots, blown.items],
    ["walk", T.IMP_POTS, []],
  );
  assert.deepEqual([held.state, held.hp], ["held", world.enemies[2]!.hp]);
  assert.deepEqual([beaten.state, beaten.hp], ["dead", 0]);
  assert.deepEqual([hero(blown).magicDamage, hero(blown).knockdowns], [0, 0]);
  assert.equal(hero(blown, 1).hp, T.HERO_HP.rhea);
  assert.equal(hero(blown, 1).state, "grab");
});

test("the caster stands invulnerable through the spell, then is free again when it is gone", () => {
  const { steps, hit } = level("brakka", 1);
  const fighter = T.RAVAGER[0];
  // A spell past its blow, and a ravager in front about to land its mace.
  let world = run(armed("brakka", 0), hit + 2);
  world = spawnEnemy(world, "ravager", hero(world).x + px(20), hero(world).y);
  world = enemyAs(world, {
    ...{ state: "windup", timer: fighter.windup - 1, facing: -1 },
    thinkAt: world.step,
  });
  const casting = heroAs(world, { state: "cast", timer: hit + 1 });
  casting.spells = [{ hero: 1, level: 1, born: world.step - hit - 1 }];
  assert.ok(decodeWorld(encodeWorld(casting)), "a world the rules reach");
  const swung = step(casting, []);
  assert.equal(swung.enemies[0]!.state, "attack", "the mace swings");
  assert.deepEqual(
    [hero(swung).state, hero(swung).hp],
    ["cast", T.HERO_HP.brakka],
  );
  // The same mace on a hero standing idle lands.
  assert.equal(hero(step(world, [])).state, "hurt");
  // The spell plays out: the hero is idle with it gone, and swings at once.
  const done = run(swung, steps - hit - 3);
  assert.deepEqual([hero(done).state, done.spells.length], ["cast", 1]);
  const free = step(done, []);
  assert.deepEqual([hero(free).state, free.spells], ["idle", []]);
  assert.equal(hero(step(free, [ATTACK])).state, "attack1");
});

test("two heroes casting on one step both land, in id order: the first's blow may leave nothing for the second's", () => {
  let world = party("brakka", "brakka");
  world = heroAs(heroAs(world, { pots: 2 }), { pots: 2 }, 1);
  world = spawnEnemy(world, "ravager", px(150), px(138));
  world = spawnEnemy(world, "ravager", px(180), px(127));
  const full = world.enemies[0]!.hp;
  world = enemyAs(world, { hp: 3 });
  const cast = step(run(world, 3, [MAGIC, MAGIC]), []);
  assert.deepEqual(
    cast.spells.map((each: Spell) => [each.hero, each.level, each.born]),
    [
      [1, 2, cast.step],
      [2, 2, cast.step],
    ],
  );
  const blown = run(cast, level("brakka", 2).hit);
  const blow = blowOf(blown, blown.enemies[1]!, level("brakka", 2).share);
  assert.deepEqual(
    [hero(blown).magicDamage, hero(blown, 1).magicDamage],
    [3 + blow, blow],
  );
  assert.deepEqual(
    blown.enemies.map((each) => each.hp),
    [0, full - 2 * blow],
  );
  assert.deepEqual([hero(blown).knockdowns, hero(blown, 1).knockdowns], [2, 1]);
  const done = run(blown, level("brakka", 2).steps - level("brakka", 2).hit);
  assert.deepEqual(
    [done.spells, hero(done).state, hero(done, 1).state],
    [[], "idle", "idle"],
  );
});

test("the view shows the charge, the cast and each spell's kind, level and age; the frames borrow the finisher's", () => {
  const cast = run(hold(armed("gorm"), 3), 5);
  const view = toView(cast);
  assert.deepEqual(
    [view.heroes[0]!.anim, view.heroes[0]!.charge, view.heroes[0]!.pots],
    ["cast", 0, 0],
  );
  assert.deepEqual(view.spells, [{ hero: 1, kind: "earth", level: 3, age: 5 }]);
  assert.equal(heroFrame("gorm", "charge", 9), "windup3");
  assert.equal(heroFrame("gorm", "cast", 9), "strike3");
});

test("a world mid-charge and mid-spell survives the checkpoint whole and plays on identically; a corrupt spell or charge is refused", () => {
  const charging = run(flanked(armed("rhea")), 30, [MAGIC]);
  const spelled = run(hold(charging, 20), 10);
  for (const world of [charging, spelled]) {
    const back = decodeWorld(encodeWorld(world))!;
    assert.deepEqual(back, world);
    assert.deepEqual(run(back, 120, [RIGHT]), run(world, 120, [RIGHT]));
  }
  const refused = (what: string, world: World) =>
    assert.equal(decodeWorld(encodeWorld(world)), undefined, what);
  const spell = spelled.spells[0]!;
  const { steps } = level("rhea", spell.level);
  const spells = (list: Spell[]) => ({ ...spelled, spells: list });
  refused("a spell nobody casts", heroAs(spelled, { state: "idle" }));
  refused("a cast with no spell", spells([]));
  refused("a level Rhea lacks", spells([{ ...spell, level: 7 }]));
  refused("a level 0", spells([{ ...spell, level: 0 }]));
  refused(
    "a spell played out",
    spells([{ ...spell, born: spelled.step - steps }]),
  );
  refused(
    "a spell from the future",
    spells([{ ...spell, born: spelled.step + 1 }]),
  );
  refused("a spell of nobody's", spells([{ ...spell, hero: 9 }]));
  refused("two spells for one hero", spells([spell, spell]));
  refused("six spells", spells(Array<Spell>(6).fill(spell)));
  refused("a charge with no pots", heroAs(charging, { pots: 0 }));
  refused("more magic damage than damage", heroAs(spelled, { magicDamage: 1 }));
  refused(
    "a press waiting too long",
    heroAs(spelled, { magicBuf: T.BUFFER_STEPS + 1 }),
  );
  refused("a spell level as text", spells([{ ...spell, level: "1" as never }]));
  // Two casters: their spells run in the order they were cast.
  let pair = party("brakka", "gorm");
  pair = heroAs(heroAs(pair, { pots: 1 }), { pots: 1 }, 1);
  pair = step(run(pair, 2, [MAGIC, MAGIC]), []);
  assert.ok(decodeWorld(encodeWorld(pair)));
  refused("spells out of order", {
    ...pair,
    spells: [...pair.spells].reverse(),
  });
  const later = { ...pair.spells[1]!, born: pair.step - 1 };
  refused("a later cast first", { ...pair, spells: [pair.spells[0]!, later] });
});

test("the same inputs fold to the same magic, and a step leaves its input untouched", () => {
  const play = () => {
    let world = flanked(party("brakka", "rhea", "gorm"));
    world = heroAs(
      heroAs(heroAs(world, { pots: 4 }), { pots: 6 }, 1),
      { pots: 3 },
      2,
    );
    for (let index = 0; index < 400; index++) {
      const bits = index % 50 < 30 ? MAGIC : index % 4 < 2 ? ATTACK : 0;
      world = step(world, [bits, index % 90 < 50 ? MAGIC : RIGHT, bits]);
    }
    return world;
  };
  const a = play();
  assert.deepEqual(play(), a);
  assert.ok(a.heroes.every((each) => each.casts > 0));
  const before = JSON.stringify(a);
  step(a, [MAGIC, MAGIC, MAGIC]);
  assert.equal(JSON.stringify(a), before);
});

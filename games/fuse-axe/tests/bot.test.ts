import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  DOWN,
  LEFT,
  MAGIC,
  RIGHT,
  STAGE_1,
  UP,
  botInput,
  createWorld,
  decodeWorld,
  encodeWorld,
  sendImp,
  spawnEnemy,
  stepTick,
  type Enemy,
  type Hero,
  type HeroKind,
  type World,
} from "../src/engine/index.js";
import { REACT, REACT_SPREAD } from "../src/engine/bot.js";
import * as T from "../src/engine/tuning.js";

const { px } = T;
/** One log tick: the heroes `humans` names hold their bits, every other hero a bot's, following them. */
function tick(world: World, humans: Record<number, number> = {}): World {
  const ids = Object.keys(humans).map(Number),
    held: number[] = [];
  for (const hero of world.heroes)
    held[hero.seat] = humans[hero.id] ?? botInput(world, hero.id, ids);
  return stepTick(world, held);
}
/** Ticks until `done`, within `limit` ticks. */
function play(
  world: World,
  done: (world: World) => boolean,
  humans: Record<number, number> = {},
  limit = 2000,
): World {
  for (let index = 0; index < limit && !done(world); index++)
    world = tick(world, humans);
  assert.ok(done(world), "never happened");
  return world;
}
const party = (...kinds: HeroKind[]) =>
  createWorld({ seed: 7, heroes: kinds.map((kind, seat) => ({ seat, kind })) });
const first = (world: World): Hero => world.heroes[0]!;
const patch = (world: World, change: Partial<Hero>, index = 0): World => ({
  ...world,
  heroes: world.heroes.map((hero, at) =>
    at === index ? { ...hero, ...change } : hero,
  ),
});
/** A ravager (dx, dy) px from the first hero, with `change` made to it. */
function foe(
  world: World,
  dx: number,
  dy: number,
  change: Partial<Enemy> = {},
  tier: T.Tier = 0,
): World {
  const { x, y } = first(world);
  const next = spawnEnemy(world, "ravager", x + px(dx), y + px(dy), tier);
  next.enemies = next.enemies.map((each, index) =>
    index === next.enemies.length - 1 ? { ...each, ...change } : each,
  );
  return next;
}
/** A ravager `dx` px along the road, level with the first hero, `timer` steps into its wind-up facing the hero. */
const windup = (world: World, dx: number, timer: number, dy = 0) =>
  foe(world, dx, dy, {
    state: "windup",
    timer,
    target: 1,
    facing: dx < 0 ? 1 : -1,
  });
const SEEN = REACT + REACT_SPREAD;

test("a bot lines up in depth while it closes in, swings once in reach and lane, and lets go between presses", () => {
  const world = foe(party("brakka"), 60, 12);
  assert.equal(botInput(world, 1), RIGHT | DOWN);
  const lined = foe(party("brakka"), 20, 0);
  assert.equal(botInput(lined, 1), ATTACK);
  assert.equal(botInput(patch(lined, { held: ATTACK }), 1), 0);
  assert.equal(
    botInput(foe(party("brakka"), -20, 0), 1),
    ATTACK | LEFT,
    "it turns as it swings",
  );
  assert.equal(botInput(world, 9), 0, "no such hero");
  // Played out, it chains the combo to the finisher and knocks the ravager down.
  const states = new Set<string>();
  play(world, (each) => {
    states.add(first(each).state);
    return first(each).knockdowns > 0;
  });
  assert.ok(states.has("attack2") && states.has("attack3"), [...states].join());
});

test("a wind-up from behind is stepped out of in depth, and one in front is beaten to the blow", () => {
  const full = T.HERO_HP.brakka;
  const behind = windup(party("brakka"), -24, SEEN);
  assert.equal(botInput(behind, 1), UP);
  let world = play(behind, (w) => w.enemies[0]!.state === "attack");
  assert.equal(first(world).hp, full, "the mace missed");
  assert.ok(Math.abs(first(world).y - world.enemies[0]!.y) > T.LANE);
  const ahead = windup(party("brakka"), 24, SEEN);
  assert.equal(botInput(ahead, 1), ATTACK);
  world = ahead;
  for (let index = 0; index < 6; index++) world = tick(world);
  assert.equal(first(world).hp, full);
  assert.ok(first(world).damage > 0, "its blade landed first");
  // Too late to beat, it steps out instead.
  const late = windup(party("brakka"), 24, T.RAVAGER[0].windup - 4);
  assert.equal(botInput(late, 1) & ATTACK, 0);
  // Against the band's edge it goes the other way, and on along the road if that crosses the ravager's lane.
  const low = patch(party("brakka"), { y: T.FLOOR_BOTTOM });
  assert.equal(botInput(windup(low, -24, SEEN, -2), 1), UP | RIGHT);
  const high = patch(party("brakka"), { y: T.FLOOR_TOP });
  assert.equal(botInput(windup(high, -24, SEEN, 2), 1), DOWN | RIGHT);
  assert.equal(botInput(windup(high, -24, SEEN), 1), DOWN);
});

test("a wind-up is seen only after the bot's reaction time, and now and then not at all", () => {
  let missed = 0;
  for (let step = 100; step < 356; step++) {
    const at = (timer: number) =>
      botInput({ ...windup(party("rhea"), -24, timer), step }, 1);
    assert.equal(at(REACT - 1), ATTACK | LEFT, "not yet seen: it swings");
    if (at(SEEN) !== UP) missed++;
  }
  assert.ok(missed > 0 && missed < 64, `missed ${missed} of 256`);
});

test("a bot picks up a pot, and kicks a sack imp for its pots", () => {
  const solo = party("rhea"),
    { x, y } = first(solo);
  const pot = {
    id: 9,
    kind: "pot" as const,
    x: x + px(50),
    y: y + px(8),
    z: 0,
    vz: 0,
    born: 0,
  };
  const picked = play({ ...solo, items: [pot] }, (w) => first(w).pots > 0);
  assert.equal(picked.items.length, 0);
  assert.ok(picked.step < 60 * T.STEPS_PER_TICK);
  // A pot a hero nearer to it wants is left to that hero, and a full hero wants none.
  const pair = party("rhea", "gorm");
  const theirs = {
    ...patch(pair, { x: pot.x + px(4), y: pot.y }, 1),
    items: [pot],
  };
  assert.equal(botInput(theirs, 1), botInput({ ...theirs, items: [] }, 1));
  const guarded = foe({ ...solo, items: [pot] }, -30, 8);
  assert.equal(botInput(guarded, 1), LEFT | DOWN, "a ravager close by first");
  const full = patch({ ...solo, items: [pot] }, { pots: T.MAX_POTS.rhea });
  assert.equal(botInput(full, 1), botInput(solo, 1));
  const kicked = play(sendImp(party("brakka"), "right", px(138)), (w) =>
    w.heroes.some((hero) => hero.pots > 0),
  );
  assert.ok(
    kicked.enemies.some((each) => each.kind === "imp" && each.pots < 3),
  );
});

test("a bot taps Magic when surrounded or low on health, and the tap casts every pot", () => {
  const armed = patch(party("gorm"), { pots: 2 });
  const ringed = foe(foe(foe(armed, 30, 0), -30, 0), 50, 12);
  assert.equal(botInput(ringed, 1), MAGIC);
  const charging = tick(ringed);
  assert.equal(first(charging).state, "charge");
  const cast = tick(charging);
  assert.equal(first(cast).casts, 1);
  assert.equal(first(cast).pots, 0);
  assert.equal(cast.spells.length, 1);
  assert.equal(botInput(cast, 1), 0, "casting, it holds nothing");
  const low = foe(patch(party("rhea"), { pots: 1, hp: 10 }), 50, 0);
  assert.equal(botInput(low, 1), MAGIC);
  assert.equal(botInput(patch(low, { held: MAGIC }), 1), 0);
  assert.notEqual(botInput(patch(low, { pots: 0 }), 1), MAGIC);
  const playing = { ...low, spells: [{ hero: 1, level: 1, born: 0 }] };
  assert.notEqual(botInput(playing, 1), MAGIC, "not while a spell plays");
  assert.notEqual(
    botInput(patch(low, { hp: 40 }), 1),
    MAGIC,
    "one is no crowd",
  );
});

test("with no enemy about, bots lead the camera on, or follow the players' heroes without holding it back", () => {
  const led = play(
    party("brakka", "rhea"),
    (w) => w.camX === STAGE_1.waves[0]!.at,
  );
  for (const hero of led.heroes) assert.ok(hero.x - led.camX > px(40));
  // Behind a player standing still, the bot waits by them and the camera stays.
  let world = party("brakka", "gorm");
  for (let index = 0; index < 100; index++) world = tick(world, { 1: 0 });
  const [human, bot] = world.heroes as [Hero, Hero];
  assert.equal(world.camX, 0);
  assert.ok(bot.x < human.x && human.x - bot.x < px(48));
  // The player walks on to the first wave; the bot keeps up behind, and the camera gets there.
  world = play(world, (w) => w.camX === STAGE_1.waves[0]!.at, { 1: RIGHT });
  assert.ok(world.heroes[1]!.x < world.heroes[0]!.x);
  assert.ok(world.heroes[1]!.x > world.camX + px(24));
  // Far behind, it runs: press, let go, press.
  let far = patch(party("brakka", "gorm"), { x: px(300) });
  const states: string[] = [];
  for (let index = 0; index < 6; index++) {
    far = tick(far, { 1: 0 });
    states.push(far.heroes[1]!.state);
  }
  assert.ok(states.includes("run"), states.join());
  const stopped = play(far, (w) => w.heroes[1]!.state !== "run", { 1: 0 });
  assert.ok(stopped.heroes[0]!.x - stopped.heroes[1]!.x < px(48));
});

test("a bot never swings at a hero: huddled with the party and no enemy, it presses no Attack", () => {
  let world = party("brakka", "rhea", "gorm");
  world = {
    ...world,
    heroes: world.heroes.map((hero) => ({ ...hero, x: px(100), y: px(138) })),
  };
  for (let index = 0; index < 300; index++) {
    for (const hero of world.heroes.slice(1))
      assert.equal(botInput(world, hero.id, [1]) & ATTACK, 0);
    world = tick(world, { 1: 0 });
  }
  assert.equal(world.enemies.length, 0);
  for (const hero of world.heroes) assert.equal(hero.hp, T.HERO_HP[hero.kind]);
});

test("a party of bots clears the first wave", () => {
  const world = play(
    party("brakka", "rhea", "gorm"),
    (w) => w.wave === 1 && !w.locked,
  );
  assert.ok(world.heroes.every((hero) => hero.state !== "out"));
  assert.ok(world.heroes.reduce((sum, hero) => sum + hero.knockdowns, 0) > 0);
});

test("a bot is a pure function of the world: the same world gives the same bits, and a checkpoint replays it", () => {
  let world = party("brakka", "rhea", "gorm");
  for (let index = 0; index < 150; index++) world = tick(world);
  const before = JSON.stringify(encodeWorld(world)),
    bits = world.heroes.map((hero) => botInput(world, hero.id));
  assert.deepEqual(
    world.heroes.map((hero) => botInput(world, hero.id)),
    bits,
  );
  assert.equal(JSON.stringify(encodeWorld(world)), before, "untouched");
  const restored = decodeWorld(JSON.parse(before))!;
  assert.deepEqual(
    restored.heroes.map((hero) => botInput(restored, hero.id)),
    bits,
  );
  let straight = world,
    replayed = restored;
  for (let index = 0; index < 150; index++) {
    straight = tick(straight);
    replayed = tick(replayed);
  }
  assert.deepEqual(encodeWorld(replayed), encodeWorld(straight));
});

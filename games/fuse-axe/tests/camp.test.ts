import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  BOT,
  JOIN,
  LEAVE,
  SPECTATOR,
  type StreamEntries,
} from "fuse-netcode";
import {
  ATTACK,
  CAMP,
  MAGIC,
  RIGHT,
  botInput,
  campLeft,
  campOver,
  createWorld,
  decodeWorld,
  encodeWorld,
  seedOf,
  stageCleared,
  step,
  stepTick,
  toView,
  type Enemy,
  type Hero,
  type HeroKind,
  type World,
} from "../src/engine/index.js";
import { kick } from "../src/engine/imps.js";
import { CAMP_SPAWNS } from "../src/engine/world.js";
import * as T from "../src/engine/tuning.js";
import {
  CLEAR_TICKS,
  DEFAULT_SETTINGS,
  PLAY,
  createRoom,
  decode,
  encode,
  foldTick,
  hash,
  view,
  type Entry,
  type Room,
} from "../src/online/game.js";
import { cleared, wiped } from "./fixtures/stage.js";

const { px } = T;
const camp = (...kinds: HeroKind[]): World =>
  createWorld({
    seed: 7,
    camp: true,
    heroes: kinds.map((kind, seat) => ({ seat, kind })),
  });
const run = (world: World, steps: number, held: readonly number[] = []) => {
  for (let index = 0; index < steps; index++) world = step(world, held);
  return world;
};
const imps = (world: World): Enemy[] => world.enemies;
/** The world with hero `index` changed by `patch`. */
const heroAs = (world: World, patch: Partial<Hero>, index = 0): World => ({
  ...world,
  heroes: world.heroes.map((each, i) =>
    i === index ? { ...each, ...patch } : each,
  ),
});
const kept = (world: World) =>
  assert.deepEqual(decodeWorld(structuredClone(encodeWorld(world))), world);

test("camp is one screen at rest round a fire: no wave, never won, its heroes carrying what they bring", () => {
  const world = createWorld({
    seed: 3,
    stage: 1,
    camp: true,
    heroes: [
      { seat: 0, kind: "rhea", carry: { lives: 1, pots: 2, hp: 9 } },
      { seat: 4, kind: "gorm" },
    ],
  });
  assert.deepEqual(
    world.heroes.map((h) => [h.x, h.y, h.lives, h.pots, h.hp]),
    [
      [px(CAMP_SPAWNS[0]![0]), px(CAMP_SPAWNS[0]![1]), 1, 2, 9],
      [px(CAMP_SPAWNS[4]![0]), px(CAMP_SPAWNS[4]![1]), T.LIVES, 0, 72],
    ],
  );
  assert.deepEqual(
    [world.camp, stageCleared(world), campOver(world), campLeft(world)],
    [true, false, false, T.CAMP_STEPS],
  );
  assert.deepEqual([toView(world).camp, toView(world).waves], [true, 0]);
  kept(world);
  // Walking right the whole time moves no camera and begins no wave.
  const walked = run(world, 400, [RIGHT]);
  assert.deepEqual([walked.camX, walked.wave, walked.locked], [0, 0, false]);
  assert.equal(walked.heroes[0]!.x, px(T.VIEW_W) - T.HERO_MARGIN);
  kept(walked);
  // A stage's world is never camp, and has no camp clock.
  const stage = createWorld({ seed: 3, heroes: [{ seat: 0, kind: "rhea" }] });
  assert.deepEqual(
    [stage.camp, campOver(stage), campLeft(stage)],
    [false, false, 0],
  );
});

test("camp's imps sneak in by the clock from alternate edges, take nothing and leave; camp ends once they have gone", () => {
  let world = camp("brakka");
  const sent: [number, number][] = [];
  while (!campOver(world) && world.step < T.CAMP_STEPS) {
    const before = world.impsSent;
    world = step(world, []);
    if (world.impsSent > before) {
      const imp = world.enemies.at(-1)!;
      sent.push([world.step, imp.facing]);
      assert.ok(imp.x < 0 || imp.x > px(T.VIEW_W), "outside the screen's edge");
    }
    if (world.step % 150 === 0) kept(world);
  }
  assert.deepEqual(
    sent,
    CAMP.imps.map((cue) => [cue.step, cue.side === "left" ? 1 : -1]),
  );
  // Unkicked, every imp has crossed the clearing and gone, and camp is over before its clock runs out.
  assert.ok(campOver(world) && world.step < T.CAMP_STEPS);
  assert.deepEqual(
    [world.enemies, world.items, world.heroes[0]!.pots, campLeft(world)],
    [[], [], 0, 0],
  );
});

test("kicking a camp imp spills meat and pots in turn; meat heals up to full health, and a hero at full leaves it", () => {
  let world = run(camp("brakka", "gorm"), CAMP.imps[0]!.step!);
  const sent = imps(world)[0]!;
  assert.equal(sent.pots, CAMP.imps[0]!.pots);
  // Brakka, hurt, stands in the imp's path on screen and slashes it: meat pops out first.
  world = { ...world, enemies: [{ ...sent, x: px(200) }] };
  world = heroAs(world, {
    ...{ x: px(184), y: sent.y, facing: 1, hp: 40, state: "idle" },
  });
  world = run(step(world, [ATTACK]), 30);
  assert.deepEqual(
    [world.items.map((each) => each.kind), imps(world)[0]!.pots],
    [["meat"], 2],
  );
  // Its sack spills meat and pots in turn; a stage's imp only ever pots.
  const spill = (from: World) => {
    const into = structuredClone(from),
      imp = into.enemies[0]!;
    for (let pots = imp.pots; pots > 0; pots--) kick(into, imp, 1, false);
    return into.items.map((each) => each.kind);
  };
  assert.deepEqual(spill(world), ["meat", "pot", "meat"]);
  assert.deepEqual(spill({ ...world, camp: false }), ["meat", "pot", "pot"]);
  // A landed piece of meat by Brakka's feet heals it by `MEAT_HEAL`; another by Gorm's, at full health, stays.
  const meat = (x: number, y: number, id: number) => ({
    ...{ id, kind: "meat" as const, x, y, z: 0, vz: 0, born: world.step },
  });
  const [brakka, gorm] = world.heroes;
  const fed = step(
    {
      ...world,
      enemies: [],
      items: [
        meat(brakka!.x, brakka!.y, world.nextId),
        meat(gorm!.x, gorm!.y, world.nextId + 1),
      ],
      nextId: world.nextId + 2,
      heroes: world.heroes.map((h) => ({ ...h, state: "idle" as const })),
    },
    [],
  );
  assert.deepEqual(
    [fed.heroes[0]!.hp, fed.heroes[1]!.hp, fed.items.length],
    [40 + T.MEAT_HEAL, 72, 1],
  );
  kept(fed);
  // Never past full health.
  const full = step(
    heroAs(
      { ...fed, items: [meat(brakka!.x, brakka!.y, fed.nextId)] },
      {
        hp: 58,
      },
    ),
    [],
  );
  assert.deepEqual([full.heroes[0]!.hp, full.items.length], [60, 0]);
});

test("nothing at camp hurts a hero, and Magic casts nothing there: the pots are kept for the road", () => {
  let world = heroAs(camp("rhea", "brakka", "gorm"), { pots: 3 });
  let lowest = world.heroes.map((h) => h.hp);
  for (let tick = 0; !campOver(world) && tick < 500; tick++) {
    const held: number[] = [];
    for (const hero of world.heroes)
      held[hero.seat] = hero.seat === 0 ? MAGIC : botInput(world, hero.id);
    world = stepTick(world, held);
    lowest = world.heroes.map((h, i) => Math.min(lowest[i]!, h.hp));
    assert.deepEqual(world.spells, []);
  }
  assert.deepEqual(
    lowest,
    world.heroes.map((h) => T.HERO_HP[h.kind]),
  );
  assert.equal(world.heroes[0]!.pots, 3);
  assert.ok(world.heroes.every((h) => h.state !== "charge"));
});

test("the codec keeps camp to itself: meat only there, imps not before their step, no spell", () => {
  const at = run(camp("brakka"), CAMP.imps[0]!.step!);
  kept(at);
  const fields = (world: World) =>
    structuredClone(encodeWorld(world)) as unknown[];
  const broken: [string, (f: unknown[]) => void][] = [
    ["a flag that is no boolean", (f) => (f[17] = 1)],
    ["an imp sent early", (f) => (f[1] = CAMP.imps[0]!.step! - 3)],
    ["a stage's world with its imps", (f) => (f[17] = false)],
  ];
  for (const [what, change] of broken) {
    const raw = fields(at);
    change(raw);
    assert.equal(decodeWorld(raw), undefined, what);
  }
  const stage = createWorld({ seed: 1, heroes: [{ seat: 0, kind: "rhea" }] });
  const lying = (kind: "pot" | "meat"): World => ({
    ...stage,
    nextId: 3,
    items: [{ id: 2, kind, x: 0, y: px(140), z: 0, vz: 0, born: 0 }],
  });
  kept(lying("pot"));
  assert.equal(
    decodeWorld(encodeWorld(lying("meat"))),
    undefined,
    "meat on a stage's road",
  );
  // A hero casting at camp, its spell otherwise as one plays on the road.
  const casting = {
    ...heroAs(at, { state: "cast", timer: 0 }),
    spells: [{ hero: 1, level: 1, born: at.step }],
  };
  kept({ ...casting, camp: false, impsSent: 0, enemies: [] });
  assert.equal(decodeWorld(encodeWorld(casting)), undefined, "a spell at camp");
});

// ---- the room ----

type Bodies = Record<string, readonly unknown[][]>;
let seq = 0;
function fold(room: Room, bodies: Bodies = {}): void {
  const tick = room.tick + 1,
    streams = new Map<string, StreamEntries<Entry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation: 1,
      entries: list.map((body) => [++seq, tick, ...body] as Entry),
    });
  foldTick(room, "a", streams);
}
/** The room survives its checkpoint whole: the same hash, the same view. */
function restores(room: Room): void {
  const back = decode(structuredClone(encode(room)), room.tick);
  assert.ok(back, `a ${room.stage} room restores`);
  assert.equal(hash(back), hash(room));
  assert.deepEqual(view(back), view(room));
}
/** `a` (Rhea) and `b` (Brakka) seated, Wes watching, run `m1` past stage 1's tally into camp. */
function camped(bot = false): Room {
  const room = createRoom("m0", DEFAULT_SETTINGS);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "rhea", 1],
      [JOIN, "b", "Bo", 1, "brakka", 1],
      [SPECTATOR, "join", "w", "Wes", 1],
      ...(bot ? [[BOT, "add", "bot:1", "Ironhide", 2]] : []),
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  room.world = cleared({
    ...room.world!,
    heroes: room.world!.heroes.map((hero) => ({ ...hero, hp: 20 })),
  });
  for (let i = 0; i <= CLEAR_TICKS; i++) fold(room);
  assert.deepEqual([room.stage, room.world!.camp], ["between", true]);
  return room;
}

test("the room makes camp after a stage's tally: its heroes steer there, its clock counts down, and stage 2 follows", () => {
  const room = camped();
  assert.deepEqual(
    [room.round, room.until, room.held, room.world!.seed],
    [1, 0, {}, seedOf("m1:1:camp")],
  );
  assert.deepEqual(
    room.world!.heroes.map((h) => h.hp),
    [20, 20],
    "camp carries the stage's health",
  );
  restores(room);
  // Bo walks right at camp: its bits are held, and a watcher's or an old run's change nothing.
  const x = room.world!.heroes[1]!.x;
  fold(room, {
    b: [[PLAY, "m1", 1, RIGHT]],
    w: [[PLAY, "m1", 1, RIGHT]],
    a: [[PLAY, "m0", 1, RIGHT]],
  });
  assert.deepEqual(room.held, { b: RIGHT });
  assert.ok(room.world!.heroes[1]!.x > x);
  assert.equal(room.world!.heroes[0]!.x, px(CAMP_SPAWNS[0]![0]));
  restores(room);
  // Ada eats meat the room's imps would spill: health carried on to stage 2.
  room.world = {
    ...room.world!,
    nextId: room.world!.nextId + 1,
    items: [
      {
        ...{ id: room.world!.nextId, kind: "meat", z: 0, vz: 0 },
        ...{ x: room.world!.heroes[0]!.x, y: room.world!.heroes[0]!.y },
        born: room.world!.step,
      },
    ],
  };
  fold(room);
  assert.equal(room.world!.heroes[0]!.hp, 20 + T.MEAT_HEAL);
  const left = view(room).countdown;
  assert.equal(left, Math.ceil(campLeft(room.world!) / T.STEPS_PER_TICK));
  fold(room);
  assert.equal(view(room).countdown, left - 1);
  restores(room);
  for (let i = 0; i < T.CAMP_STEPS && room.world!.camp; i++) fold(room);
  assert.deepEqual(
    [room.stage, room.round, room.world!.camp, room.world!.seed],
    ["running", 2, false, seedOf("m1:2")],
  );
  assert.deepEqual(
    room.world!.heroes.map((h) => h.hp),
    [20 + T.MEAT_HEAL, 20],
  );
  assert.deepEqual(room.held, {}, "stage 2 starts with nothing held");
  restores(room);
});

test("camp runs out its clock with its imps still about, and a bot kicks them as a player would", () => {
  const room = camped(true);
  // Three ticks short of its clock, with every imp just come.
  room.world = { ...room.world!, step: T.CAMP_STEPS - 3 * T.STEPS_PER_TICK };
  fold(room);
  assert.equal(room.world!.enemies.length, CAMP.imps.length);
  fold(room);
  assert.deepEqual([room.world!.camp, view(room).countdown], [true, 1]);
  fold(room);
  assert.deepEqual([room.stage, room.round], ["running", 2]);
  // With a bot along, camp's imps get kicked and its items picked up.
  const kicked = camped(true);
  let spilled = 0;
  for (let i = 0; i < T.CAMP_STEPS && kicked.world!.camp; i++) {
    const before = kicked.world!.items.length;
    fold(kicked);
    if (kicked.world!.camp)
      spilled += Math.max(0, kicked.world!.items.length - before);
  }
  assert.ok(spilled > 0, "the bot kicked an imp");
});

test("a seat that leaves camp is given up: its hero stands idle, its bits go, and it is left behind; a newcomer playing it steers it", () => {
  const room = camped();
  fold(room, { b: [[PLAY, "m1", 1, RIGHT]] });
  assert.deepEqual(room.held, { b: RIGHT });
  fold(room, { a: [[LEAVE, "b"]] });
  assert.equal(room.seats.has("b"), false);
  assert.deepEqual(room.held, {}, "no bits held for a seat that has gone");
  const x = room.world!.heroes[1]!.x;
  fold(room);
  assert.equal(room.world!.heroes[1]!.x, x, "its hero stands idle");
  restores(room);
  // Cy takes the slot playing Brakka and steers it; Dee, playing Gorm in it instead, would not.
  const other = structuredClone(room);
  fold(room, { a: [[JOIN, "c", "Cy", 1, "brakka", 1]] });
  fold(room, { c: [[PLAY, "m1", 1, RIGHT]] });
  assert.ok(room.world!.heroes[1]!.x > x);
  assert.deepEqual(room.held, { c: RIGHT });
  restores(room);
  fold(other, { a: [[JOIN, "d", "Dee", 1, "gorm", 1]] });
  fold(other, { d: [[PLAY, "m1", 1, RIGHT]] });
  assert.deepEqual(
    [other.world!.heroes[1]!.x, other.held],
    [x, {}],
    "a newcomer playing another hero steers nothing",
  );
  restores(other);
  for (let i = 0; i < T.CAMP_STEPS && other.world!.camp; i++) fold(other);
  assert.deepEqual(
    other.world!.heroes.map((h) => [h.seat, h.kind]),
    [[0, "rhea"]],
    "the hero nobody plays stays behind",
  );
  // With every seat gone, camp ends in an empty lobby.
  const empty = camped();
  fold(empty, {
    a: [
      [LEAVE, "a"],
      [LEAVE, "b"],
    ],
  });
  for (let i = 0; i < T.CAMP_STEPS && empty.world?.camp; i++) fold(empty);
  assert.deepEqual(
    [empty.stage, empty.world, empty.tally],
    ["lobby", null, []],
  );
});

test("a defeated party never makes camp", () => {
  const room = createRoom("m0", DEFAULT_SETTINGS);
  fold(room, { a: [[JOIN, "a", "Ada", 0, "rhea", 1]] });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  room.continued = true;
  room.world = wiped(room.world!);
  fold(room);
  assert.deepEqual([room.stage, room.outcome], ["over", "defeat"]);
  for (let i = 0; i < CLEAR_TICKS + 5; i++) fold(room);
  assert.deepEqual([room.stage, room.world!.camp], ["over", false]);
});

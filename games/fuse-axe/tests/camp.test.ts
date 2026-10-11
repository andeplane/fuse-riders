import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, BOT, JOIN, LEAVE, SPECTATOR } from "fuse-netcode";
import type { StreamEntries } from "fuse-netcode";
import * as E from "../src/engine/index.js";
import type { Hero, HeroKind, World } from "../src/engine/index.js";
import { kick } from "../src/engine/imps.js";
import { CAMP_SPAWNS, newEnemy } from "../src/engine/world.js";
import * as T from "../src/engine/tuning.js";
import * as G from "../src/online/game.js";
import type { Entry, Room } from "../src/online/game.js";
import { cleared, wiped } from "./fixtures/stage.js";

const { CAMP, RIGHT, campLeft, campOver, createWorld, step } = E;
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
const heroAs = (world: World, patch: Partial<Hero>, index = 0): World => ({
  ...world,
  heroes: world.heroes.map((each, i) =>
    i === index ? { ...each, ...patch } : each,
  ),
});
/** The world with a landed piece of meat at hero `index`'s feet. */
const meatBy = (world: World, index = 0): World => {
  const { x, y } = world.heroes[index]!;
  const item = { id: world.nextId, kind: "meat" as const, x, y, z: 0, vz: 0 };
  return {
    ...world,
    nextId: world.nextId + 1,
    items: [...world.items, { ...item, born: world.step }],
  };
};
const kept = (world: World) =>
  assert.deepEqual(E.decodeWorld(structuredClone(E.encodeWorld(world))), world);

test("camp is one screen at rest round a fire: no wave, never won, its heroes carrying what they bring", () => {
  const world = createWorld({
    seed: 3,
    camp: true,
    heroes: [
      { seat: 0, kind: "rhea", carry: { lives: 1, pots: 2, hp: 9 } },
      { seat: 4, kind: "gorm" },
    ],
  });
  const [[x0, y0], [x4, y4]] = [CAMP_SPAWNS[0]!, CAMP_SPAWNS[4]!];
  assert.deepEqual(
    world.heroes.map((h) => [h.x, h.y, h.lives, h.pots, h.hp]),
    [
      [px(x0), px(y0), 1, 2, 9],
      [px(x4), px(y4), T.LIVES, 0, 72],
    ],
  );
  assert.deepEqual(
    [
      E.stageCleared(world),
      campOver(world),
      campLeft(world),
      E.toView(world).camp,
    ],
    [false, false, T.CAMP_STEPS, true],
  );
  const walked = run(world, 400, [RIGHT]);
  assert.deepEqual([walked.camX, walked.wave, walked.locked], [0, 0, false]);
  assert.equal(walked.heroes[0]!.x, px(T.VIEW_W) - T.HERO_MARGIN);
  kept(walked);
  const stage = createWorld({ seed: 3, heroes: [{ seat: 0, kind: "rhea" }] });
  assert.deepEqual([campOver(stage), campLeft(stage)], [false, 0], "a stage");
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
      assert.ok(imp.x < 0 || imp.x > px(T.VIEW_W), "outside the screen");
    }
    if (world.step % 150 === 0) kept(world);
  }
  const sides = CAMP.imps.map((cue) => [
    cue.step,
    cue.side === "left" ? 1 : -1,
  ]);
  assert.deepEqual(sent, sides);
  assert.ok(world.step < T.CAMP_STEPS, "over before its clock runs out");
  assert.deepEqual(
    [world.enemies, world.items, world.heroes[0]!.pots],
    [[], [], 0],
  );
});

test("kicking a camp imp spills meat and pots in turn; meat heals up to full health, and a hero at full leaves it", () => {
  let world = run(camp("brakka", "gorm"), CAMP.imps[0]!.step!);
  const sent = world.enemies[0]!;
  assert.equal(sent.pots, CAMP.imps[0]!.pots);
  // Brakka, hurt, stands in the imp's path on screen and slashes it: meat pops out first.
  world = { ...world, enemies: [{ ...sent, x: px(200) }] };
  world = heroAs(world, {
    x: px(184),
    y: sent.y,
    facing: 1,
    hp: 40,
    state: "idle",
  });
  world = run(step(world, [E.ATTACK]), 30);
  assert.deepEqual(
    [world.items.map((each) => each.kind), world.enemies[0]!.pots],
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
  // Meat by Brakka's feet heals it by `MEAT_HEAL`; meat by Gorm's, at full health, stays; none heals past full.
  const idle = {
    ...world,
    enemies: [],
    items: [],
    heroes: world.heroes.map((h) => ({ ...h, state: "idle" as const })),
  };
  const fed = step(meatBy(meatBy(idle), 1), []);
  assert.deepEqual(
    [fed.heroes.map((h) => h.hp), fed.items.length],
    [[40 + T.MEAT_HEAL, 72], 1],
  );
  kept(fed);
  const full = step(meatBy(heroAs({ ...fed, items: [] }, { hp: 58 })), []);
  assert.deepEqual([full.heroes[0]!.hp, full.items.length], [60, 0]);
});

test("nothing at camp hurts a hero, and Magic casts nothing there: the pots are kept for the road", () => {
  let world = heroAs(camp("rhea", "brakka", "gorm"), { pots: 3 });
  let lowest = world.heroes.map((h) => h.hp);
  for (let tick = 0; !campOver(world) && tick < 500; tick++) {
    const held = world.heroes.map((h) =>
      h.seat ? E.botInput(world, h.id) : E.MAGIC,
    );
    world = E.stepTick(world, held);
    lowest = world.heroes.map((h, i) => Math.min(lowest[i]!, h.hp));
    assert.deepEqual(world.spells, []);
  }
  assert.deepEqual(
    lowest,
    world.heroes.map((h) => T.HERO_HP[h.kind]),
  );
  assert.equal(world.heroes[0]!.pots, 3);
});

test("Magic from a run casts nothing at camp either, and the world stays one the checkpoint takes", () => {
  let world = heroAs(camp("brakka"), { pots: 3 });
  // A double tap to run, then Magic held and let go: on the road that charges and casts every pot.
  const presses = [RIGHT, RIGHT, 0, RIGHT, ...Array(6).fill(RIGHT)];
  for (const bits of [
    ...presses,
    ...Array(4).fill(RIGHT | E.MAGIC),
    RIGHT,
    0,
  ]) {
    world = step(world, [bits]);
    assert.deepEqual(world.spells, []);
    kept(world);
  }
  assert.notEqual(world.heroes[0]!.state, "cast");
  assert.equal(world.heroes[0]!.pots, 3);
  // The same on a stage's road does cast: it is camp that holds it back.
  let road = heroAs(
    createWorld({ seed: 7, heroes: [{ seat: 0, kind: "brakka" }] }),
    { pots: 3 },
  );
  for (const bits of [...presses, ...Array(4).fill(RIGHT | E.MAGIC), 0, 0])
    road = step(road, [bits]);
  assert.equal(road.heroes[0]!.casts, 1);
});

test("the codec keeps camp to itself: meat only there, imps not before their step, no spell", () => {
  const at = run(camp("brakka"), CAMP.imps[0]!.step!);
  kept(at);
  for (const [what, change] of [
    ["a flag that is no boolean", (f) => (f[17] = 1)],
    ["an imp sent early", (f) => (f[1] = CAMP.imps[0]!.step! - 3)],
    ["a stage's world with camp's imps", (f) => (f[17] = false)],
  ] as [string, (f: unknown[]) => void][]) {
    const raw = structuredClone(E.encodeWorld(at)) as unknown[];
    change(raw);
    assert.equal(E.decodeWorld(raw), undefined, what);
  }
  const stage = createWorld({ seed: 1, heroes: [{ seat: 0, kind: "rhea" }] });
  kept(meatBy({ ...stage, camp: true }));
  assert.equal(
    E.decodeWorld(E.encodeWorld(meatBy(stage))),
    undefined,
    "meat on a stage's road",
  );
  // A hero casting at camp, its spell as one plays on the road.
  const spell = { spells: [{ hero: 1, level: 1, born: at.step }] };
  const casting = { ...heroAs(at, { state: "cast", timer: 0 }), ...spell };
  kept({ ...casting, camp: false, impsSent: 0, enemies: [] });
  assert.equal(
    E.decodeWorld(E.encodeWorld(casting)),
    undefined,
    "a spell at camp",
  );
  // Nothing else is there to fight: a lancer is fine on the road, not at camp.
  const lancer = (world: World): World => {
    const into = structuredClone(world),
      enemy = newEnemy(into, "lancer", 0, px(100), px(130), 1);
    return { ...into, enemies: [...into.enemies, enemy] };
  };
  kept({ ...lancer(at), camp: false, impsSent: 0, enemies: [] });
  assert.equal(
    E.decodeWorld(E.encodeWorld(lancer(at))),
    undefined,
    "a lancer at camp",
  );
});

// ---- the room ----

let seq = 0;
function fold(room: Room, bodies: Record<string, unknown[][]> = {}): void {
  const tick = room.tick + 1,
    streams = new Map<string, StreamEntries<Entry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation: 1,
      entries: list.map((body) => [++seq, tick, ...body] as Entry),
    });
  G.foldTick(room, "a", streams);
}
const throughCamp = (room: Room) => {
  for (let i = 0; i < T.CAMP_STEPS && room.world?.camp; i++) fold(room);
};
/** The room survives its checkpoint whole: the same hash, the same view. */
function restores(room: Room): void {
  const back = G.decode(structuredClone(G.encode(room)), room.tick);
  assert.ok(back, `a ${room.stage} room restores`);
  assert.equal(G.hash(back), G.hash(room));
  assert.deepEqual(G.view(back), G.view(room));
}
/** `a` (Rhea) and `b` (Brakka) seated at 20 hp, Wes watching, run `m1` past stage 1's tally into camp. */
function camped(bot = false): Room {
  const room = G.createRoom("m0", G.DEFAULT_SETTINGS);
  const seats = [
    [JOIN, "a", "Ada", 0, "rhea", 1],
    [JOIN, "b", "Bo", 1, "brakka", 1],
  ];
  fold(room, { a: [...seats, [SPECTATOR, "join", "w", "Wes", 1]] });
  if (bot) fold(room, { a: [[BOT, "add", "bot:1", "Ironhide", 2]] });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  const world = room.world!;
  room.world = cleared({
    ...world,
    heroes: world.heroes.map((h) => ({ ...h, hp: 20 })),
  });
  for (let i = 0; i <= G.CLEAR_TICKS; i++) fold(room);
  assert.deepEqual([room.stage, room.world!.camp], ["between", true]);
  return room;
}

test("the room makes camp after a stage's tally: its heroes steer there, its clock counts down, and stage 2 follows", () => {
  const room = camped();
  assert.deepEqual(
    [
      room.round,
      room.until,
      room.held,
      room.world!.seed,
      room.world!.heroes.map((h) => h.hp),
    ],
    [1, 0, {}, E.seedOf("m1:1:camp"), [20, 20]],
  );
  restores(room);
  // Bo walks right at camp: its bits are held, and a watcher's or an old run's change nothing.
  const x = room.world!.heroes[1]!.x;
  const right = (matchId = "m1") => [[G.PLAY, matchId, 1, RIGHT]];
  fold(room, { b: right(), w: right(), a: right("m0") });
  assert.deepEqual(room.held, { b: RIGHT });
  assert.ok(room.world!.heroes[1]!.x > x);
  assert.equal(room.world!.heroes[0]!.x, px(CAMP_SPAWNS[0]![0]));
  restores(room);
  // Ada eats meat: health carried on to stage 2.
  room.world = meatBy(room.world!);
  fold(room);
  assert.equal(room.world!.heroes[0]!.hp, 20 + T.MEAT_HEAL);
  const left = G.view(room).countdown;
  assert.equal(left, Math.ceil(campLeft(room.world!) / T.STEPS_PER_TICK));
  fold(room);
  assert.equal(G.view(room).countdown, left - 1);
  restores(room);
  throughCamp(room);
  assert.deepEqual(
    [
      room.stage,
      room.round,
      room.world!.seed,
      room.world!.heroes.map((h) => h.hp),
      room.held,
    ],
    ["running", 2, E.seedOf("m1:2"), [20 + T.MEAT_HEAL, 20], {}],
  );
  restores(room);
});

test("camp runs out its clock with its imps still about, and a bot kicks them as a player would", () => {
  const room = camped(true);
  room.world = { ...room.world!, step: T.CAMP_STEPS - 3 * T.STEPS_PER_TICK };
  fold(room);
  assert.equal(room.world!.enemies.length, CAMP.imps.length, "every imp come");
  fold(room);
  assert.deepEqual([room.world!.camp, G.view(room).countdown], [true, 1]);
  fold(room);
  assert.deepEqual([room.stage, room.round], ["running", 2]);
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

test("controls are scoped to the stage they name: the cleared stage's steer its camp, never the next stage, and the next stage's never camp", () => {
  const room = camped();
  const camped1 = room.world!.heroes[1]!.x;
  // Stage 2's controls, logged early, mean nothing at camp.
  fold(room, { b: [[G.PLAY, "m1", 2, RIGHT]] });
  assert.deepEqual([room.held, room.world!.heroes[1]!.x], [{}, camped1]);
  fold(room, { b: [[G.PLAY, "m1", 1, RIGHT]] });
  assert.deepEqual(room.held, { b: RIGHT });
  throughCamp(room);
  assert.deepEqual(
    [room.stage, room.round, room.held],
    ["running", 2, {}],
    "what camp held does not carry into the stage",
  );
  // A camp control arriving late is not the new stage's.
  const first = room.world!.heroes[1]!.x;
  fold(room, { b: [[G.PLAY, "m1", 1, RIGHT]] });
  assert.deepEqual([room.held, room.world!.heroes[1]!.x], [{}, first]);
  fold(room, { b: [[G.PLAY, "m1", 2, RIGHT]] });
  assert.deepEqual(room.held, { b: RIGHT });
  // A vote to continue is for a countdown in play, never camp's.
  const other = camped();
  fold(other, { b: [[G.CONTINUE, "m1", 1]] });
  assert.deepEqual(
    [other.world!.camp, other.continued, other.until],
    [true, false, 0],
  );
});

test("a seat that leaves camp is given up: its hero stands idle, its bits go, and it is left behind; a newcomer playing it steers it", () => {
  const room = camped();
  fold(room, { b: [[G.PLAY, "m1", 1, RIGHT]] });
  fold(room, { a: [[LEAVE, "b"]] });
  assert.deepEqual([room.seats.has("b"), room.held], [false, {}]);
  const x = room.world!.heroes[1]!.x;
  fold(room);
  assert.equal(room.world!.heroes[1]!.x, x, "its hero stands idle");
  restores(room);
  // Cy takes the slot playing Brakka and steers it; Dee, playing Gorm in it instead, does not.
  const other = structuredClone(room);
  fold(room, { a: [[JOIN, "c", "Cy", 1, "brakka", 1]] });
  fold(room, { c: [[G.PLAY, "m1", 1, RIGHT]] });
  assert.ok(room.world!.heroes[1]!.x > x);
  assert.deepEqual(room.held, { c: RIGHT });
  restores(room);
  fold(other, { a: [[JOIN, "d", "Dee", 1, "gorm", 1]] });
  fold(other, { d: [[G.PLAY, "m1", 1, RIGHT]] });
  assert.deepEqual([other.world!.heroes[1]!.x, other.held], [x, {}]);
  restores(other);
  throughCamp(other);
  assert.deepEqual(
    other.world!.heroes.map((h) => [h.seat, h.kind]),
    [[0, "rhea"]],
  );
  // With every seat gone, camp ends in an empty lobby.
  const empty = camped();
  fold(empty, {
    a: [
      [LEAVE, "a"],
      [LEAVE, "b"],
    ],
  });
  throughCamp(empty);
  assert.deepEqual(
    [empty.stage, empty.world, empty.tally],
    ["lobby", null, []],
  );
});

test("a defeated party never makes camp", () => {
  const room = G.createRoom("m0", G.DEFAULT_SETTINGS);
  fold(room, { a: [[JOIN, "a", "Ada", 0, "rhea", 1]] });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  room.continued = true;
  room.world = wiped(room.world!);
  for (let i = 0; i < G.CLEAR_TICKS + 5; i++) fold(room);
  assert.deepEqual(
    [room.stage, room.outcome, room.world!.camp],
    ["over", "defeat", false],
  );
});

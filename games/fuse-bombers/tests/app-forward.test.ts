import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, BOT, JOIN, type StreamEntries } from "fuse-netcode";
import { RIGHT, isLoaded, type RoundView } from "../src/engine/index.js";
import {
  DEFAULT_SETTINGS,
  PLAY,
  PRESS,
  STEPS_PER_TICK,
  aheadOf,
  createRoom,
  foldTick,
  view,
  type Ahead,
  type Entry,
  type Room,
} from "../src/online/game.js";
import {
  createForward,
  createSmoother,
  stepsAhead,
} from "../src/app/forward.js";
import { OnlineSource } from "../src/app/online-source.js";

type Bodies = Record<string, readonly unknown[][]>;
let seq = 0;
const streamsOf = (bodies: Bodies, tick: number) => {
  const streams = new Map<string, StreamEntries<Entry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation: 1,
      entries: list.map((body) => [++seq, tick, ...body] as Entry),
    });
  return streams;
};
/** Folds one log tick of `bodies`, every stream at generation 1. */
const fold = (room: Room, bodies: Bodies = {}) =>
  foldTick(room, "a", streamsOf(bodies, room.tick + 1));
/** `a` (gunship 0) and `b` seated with a bot, into the first round's flight with `a` loaded. */
function flying(): Room {
  const room = createRoom("m0", DEFAULT_SETTINGS);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "gunship", 1],
      [JOIN, "b", "Bo", 1, "gunship", 1],
      [BOT, "add", "bot:1", "Baron Boom", 2],
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  while (room.tick < room.startAt + 3 || !isLoaded(room.world!.castles[0]!))
    fold(room);
  return room;
}
/** Entry bodies by how many ticks ahead of the room they are logged for (1 is the next tick to fold). */
type Logged = Record<number, Bodies>;
function source(room: Room, logged: Logged = {}): Ahead {
  const ahead = aheadOf(room, (tick) =>
    streamsOf(logged[tick - room.tick] ?? {}, tick),
  );
  assert.ok(ahead, "a round is being flown");
  return ahead;
}
const base = (room: Room): RoundView => view(room).world!;
const right = (room: Room): unknown[] => [
  PLAY,
  room.matchId,
  room.round,
  RIGHT,
];
const fire = (room: Room, step: number): unknown[] => [
  PRESS,
  room.matchId,
  room.round,
  1,
  step,
];
const key = (room: Room, revision = 0) =>
  `${revision}:${room.matchId}:${room.round}:${room.tick}`;
const places = (round: RoundView) => ({
  tick: round.tick,
  castles: round.castles.map(({ x, y, angle }) => ({ x, y, angle })),
  rockets: round.rockets.map(({ id, x, y }) => ({ id, x, y })),
});

test("a whole tick played forward is the tick the fold produces, and the room's round is left alone", () => {
  const room = flying(),
    forward = createForward(),
    logged = { 1: { a: [right(room), fire(room, 1)] } };
  const before = JSON.stringify(room.world);
  const one = forward(source(room, logged), base(room), key(room), 1),
    two = forward(source(room, logged), base(room), key(room), 2);
  assert.equal(JSON.stringify(room.world), before, "it works on a copy");
  fold(room, logged[1]);
  assert.deepEqual(places(one), places(room.world!));
  assert.ok(one.rockets.length > 0, "the rocket this device fired is drawn");
  // Two ticks ahead, while the fold is late, is the tick after that with the same bits held.
  fold(room);
  assert.deepEqual(places(two), places(room.world!));
});

test("a press shows on the local gunship at once, part of the way into the tick", () => {
  const room = flying(),
    forward = createForward();
  const still = forward(source(room), base(room), key(room), 2 / 3),
    held = forward(
      source(room, { 1: { a: [right(room)] } }),
      base(room),
      key(room),
      2 / 3,
    );
  assert.ok(
    held.castles[0]!.x > still.castles[0]!.x,
    "the gunship holding right is already flying right",
  );
  assert.equal(held.castles[1]!.x, still.castles[1]!.x);
  assert.equal(held.tick, room.world!.tick + 2);
  // Half a step further is drawn between two whole steps.
  const between = forward(
    source(room, { 1: { a: [right(room)] } }),
    base(room),
    key(room),
    2.5 / 3,
  );
  assert.equal(between.tick, room.world!.tick + 2.5);
  assert.ok(between.castles[0]!.x > held.castles[0]!.x);
  // Nothing ahead of the fold is the folded frame itself.
  const frame = base(room);
  assert.equal(forward(source(room), frame, key(room), 0), frame);
  // A fire press lands on the step it was made on, as the fold will have it.
  const tap = source(room, { 1: { a: [fire(room, 1)] } });
  assert.deepEqual(
    tap.ticks[0]!.map((step) => step[0]! & 16),
    [0, 16, 0],
  );
});

test("the forward run never shows the end of a round, a hit or a crater the room has not folded", () => {
  const room = flying(),
    world = room.world!;
  // Only `a` is left standing: the next step decides the round.
  for (const castle of world.castles)
    if (castle.id !== 0) [castle.alive, castle.hp] = [false, 0];
  const frame = base(room);
  const drawn = createForward()(source(room), frame, key(room), 1);
  assert.equal(drawn.result, null);
  assert.equal(drawn.phase, frame.phase);
  assert.equal(
    drawn.tick,
    frame.tick,
    "the run stops before the deciding step",
  );
  fold(room);
  assert.ok(room.world!.result, "the fold decides it this tick");

  // What counts is the folded round's: hull, shield, terrain and who is alive, whatever the run did to them.
  const next = flying(),
    target = next.world!.castles[1]!;
  // A rocket about to strike gunship 1.
  next.world!.rockets.push({
    id: 9_999,
    owner: 0,
    x: target.x - 30,
    y: target.y,
    vx: 900,
    vy: 0,
    power: 1,
    mega: false,
    bomb: false,
    ghost: false,
    gates: [],
    age: 5,
  });
  const before = base(next),
    after = createForward()(source(next), before, key(next), 1);
  fold(next);
  assert.ok(
    next.world!.castles[1]!.hp < target.maxHp ||
      next.world!.castles[1]!.shieldHp < before.castles[1]!.shieldHp,
    "the fold lands the hit",
  );
  assert.equal(after.castles[1]!.hp, before.castles[1]!.hp);
  assert.equal(after.castles[1]!.shieldHp, before.castles[1]!.shieldHp);
  assert.equal(after.terrain, before.terrain);
  assert.ok(
    after.rockets.some((rocket) => rocket.id === 9_999),
    "the rocket stays, where the run last had it, until the room folds its end",
  );
});

test("the countdown is not played forward", () => {
  const room = createRoom("m0", DEFAULT_SETTINGS);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "gunship", 1],
      [JOIN, "b", "Bo", 1, "gunship", 1],
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  const waiting = source(room);
  assert.deepEqual(
    waiting.ticks.map((tick) => tick.length),
    [0, 0],
  );
  const frame = base(room);
  assert.equal(createForward()(waiting, frame, key(room), 1.5), frame);
  assert.equal(stepsAhead(0.5, [0, STEPS_PER_TICK]), 0);
  assert.equal(stepsAhead(1.5, [0, STEPS_PER_TICK]), 1.5);
  assert.equal(stepsAhead(1.5, [3, 3]), 4.5);
});

test("a step is run once per folded round, revision and inputs, however many frames draw it", () => {
  const room = flying(),
    forward = createForward(),
    frame = base(room);
  const first = forward(source(room), frame, key(room), 1 / 3);
  // The same whole step on a later frame is the same view: nothing was stepped again.
  assert.equal(forward(source(room), frame, key(room), 1 / 3), first);
  forward(source(room), frame, key(room), 2 / 3);
  assert.equal(forward(source(room), frame, key(room), 1 / 3), first);
  // New controls, or a rollback that replaced the round, play it again.
  const pressed = forward(
    source(room, { 1: { a: [right(room)] } }),
    frame,
    key(room),
    1 / 3,
  );
  assert.notEqual(pressed, first);
  assert.notEqual(
    forward(
      source(room, { 1: { a: [right(room)] } }),
      frame,
      key(room, 1),
      1 / 3,
    ),
    pressed,
  );
});

test("the smoother hides a correction to the other gunships and never touches the local one", () => {
  const room = flying(),
    frame = base(room),
    smoother = createSmoother();
  let now = 0;
  const marks = (
    revision: number,
    tick: number,
    folded: number[] = [0, 0, 0],
    next: number[] = folded,
  ) => ({ revision, game: "m1:1", tick, folded, next: [next, next] });
  const show = (round: RoundView, ...args: Parameters<typeof marks>) =>
    smoother.apply(round, marks(...args), (now += 16), 0);
  for (let i = 0; i < 3; i++) show(frame, 0, 10);
  const move = (round: RoundView, by: number): RoundView => ({
    ...round,
    castles: round.castles.map((castle) => ({ ...castle, x: castle.x + by })),
  });
  // A rollback moved everyone 40 px: the local gunship snaps, the others start from where they were.
  const moved = move(frame, 40),
    after = show(moved, 1, 10);
  assert.equal(after.castles[0]!.x, moved.castles[0]!.x);
  assert.ok(Math.abs(after.castles[1]!.x - frame.castles[1]!.x) < 1e-6);
  let last = after;
  for (let i = 0; i < 30; i++) last = show(moved, 1, 10);
  assert.equal(last, moved, "a settled picture is passed through");
  // A new tick whose entries are the ones drawn changes nothing, wherever the gunships went.
  const on = move(moved, 9);
  assert.equal(show(on, 1, 11), on);
  // One where gunship 1's pilot did something else than was drawn is eased; the others are shown as they are.
  const turned = move(on, 20),
    hidden = show(turned, 1, 12, [0, RIGHT, 0], [0, 0, 0]);
  assert.ok(
    hidden.castles[1]!.x < turned.castles[1]!.x &&
      hidden.castles[1]!.x >= on.castles[1]!.x,
    "the gunship is eased towards where its pilot's controls put it",
  );
  assert.equal(hidden.castles[2]!.x, turned.castles[2]!.x);
  assert.equal(hidden.castles[0]!.x, turned.castles[0]!.x);
  // A new round starts from the picture as it is.
  const fresh = smoother.apply(
    frame,
    { ...marks(2, 1), game: "m1:2" },
    (now += 16),
    0,
  );
  assert.equal(fresh, frame);
});

test("the online source draws the picture at the clock when it is handed one, and the blended frames otherwise", () => {
  const room = flying();
  const newer = { ...view(room), matchId: room.matchId, managerId: "a" },
    timing = { newer, tick: newer.tick, lead: 0.5 },
    ahead = { ...newer.world!, tick: newer.world!.tick + 1.5 };
  let lead: RoundView | undefined = ahead;
  const online = new OnlineSource(
    () => timing,
    () => "a",
    newer.world!,
    () => lead,
  );
  assert.equal(online.view, ahead);
  lead = undefined;
  assert.equal(online.peek(), newer.world, "a look ahead of the next frame");
  assert.equal(online.view, ahead, "which draws nothing");
  online.advance();
  assert.equal(online.view, newer.world);
});

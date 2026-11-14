import test from "node:test";
import assert from "node:assert/strict";
import type { StreamEntries } from "fuse-netcode";
import {
  INPUT_RIGHT,
  TIME_LIMIT,
  viewOf,
  type RoundView,
} from "../src/engine/index.js";
import {
  PLAY,
  PRESS,
  STEPS_PER_TICK,
  aheadOf,
  type Ahead,
  type Entry,
  type Room,
} from "../src/online/game.js";
import {
  createForward,
  createSmoother,
  stepsAhead,
  type Picture,
} from "../src/app/forward.js";
import { fold, started, toPlay, type Bodies } from "./fixtures/room.js";

/** Entry bodies by how many ticks ahead of the room they are logged for (1 is the next tick to fold). */
type Logged = Record<number, Bodies>;
/** What the screen plays forward from, with `logged` in the streams. */
function source(room: Room, logged: Logged = {}): Ahead {
  let seq = 0;
  const ahead = aheadOf(room, (tick) => {
    const streams = new Map<string, StreamEntries<Entry>>();
    for (const [id, list] of Object.entries(logged[tick - room.tick] ?? {}))
      streams.set(id, {
        generation: 1,
        entries: list.map((body) => [++seq, tick, ...body] as Entry),
      });
    return streams;
  });
  assert.ok(ahead, "a game is being played");
  return ahead;
}
/** A game a few ticks into play: `a` flies slot 0, `b` slot 1, bots the rest. */
function playing(): Room {
  const room = started();
  toPlay(room);
  for (let i = 0; i < 4; i++) fold(room);
  return room;
}
const right = (room: Room): unknown[] => [
  PLAY,
  room.matchId,
  room.round,
  INPUT_RIGHT,
];
const places = (view: RoundView) =>
  view.units.map(({ x, y, dead }) => ({ x, y, dead }));
const key = (room: Room, revision = 0) =>
  `${revision}:${room.matchId}:${room.round}:${room.tick}`;

test("a whole tick played forward is the tick the fold produces, and the room's round is left alone", () => {
  const room = playing(),
    forward = createForward();
  const before = JSON.stringify(room);
  const one = forward(source(room, { 1: { a: [right(room)] } }), key(room), 1);
  const two = forward(source(room, { 1: { a: [right(room)] } }), key(room), 2);
  assert.equal(JSON.stringify(room), before, "the forward run works on copies");
  fold(room, { a: [right(room)] });
  assert.equal(one.alpha, 1);
  assert.equal(one.current.step, room.world!.step);
  assert.deepEqual(places(one.current), places(viewOf(room.world!)));
  // Two ticks ahead, while the fold is late, is the tick after that with the same bits held.
  fold(room);
  assert.deepEqual(places(two.current), places(viewOf(room.world!)));
});

test("a press shows on the local unit at once, part of the way into the tick", () => {
  const room = playing(),
    forward = createForward();
  const still = forward(source(room), key(room), 2 / 3),
    held = forward(source(room, { 1: { a: [right(room)] } }), key(room), 2 / 3);
  assert.ok(
    held.current.units[0]!.x > still.current.units[0]!.x,
    "the unit holding right is already moving right",
  );
  assert.equal(held.current.units[1]!.x, still.current.units[1]!.x);
  assert.equal(held.current.step, room.world!.step + 2);
  // Half a step further is drawn between two whole steps.
  const between = forward(
    source(room, { 1: { a: [right(room)] } }),
    key(room),
    2.5 / 3,
  );
  assert.equal(between.previous, held.current);
  assert.equal(between.current.step, room.world!.step + 3);
  assert.ok(Math.abs(between.alpha - 0.5) < 1e-6);
  // Nothing ahead of the fold is the folded round itself.
  const now = forward(source(room), key(room), 0);
  assert.deepEqual(places(now.current), places(viewOf(room.world!)));
  // A tap of the button lands on the step it was made on, as the fold will have it.
  const tap = source(room, {
    1: { a: [[PRESS, room.matchId, room.round, 1, 1]] },
  });
  assert.deepEqual(
    tap.ticks[0]!.map((step) => step[0]!.pressed),
    [false, true, false],
  );
});

test("the forward run never shows a victory or a change of who is alive that the room has not folded", () => {
  const room = playing(),
    world = room.world!;
  // One step of play is left: the step after it decides the game on the clock.
  world.step = TIME_LIMIT - 1;
  const forward = createForward();
  const drawn = forward(source(room), key(room), 1);
  assert.equal(drawn.current.step, TIME_LIMIT);
  assert.equal(drawn.current.winner, null);
  fold(room);
  assert.ok(room.world!.winner, "the fold decides it this tick");
  // Once decided, there is nothing to play forward.
  assert.equal(
    aheadOf(room, () => new Map()),
    undefined,
  );

  // A unit about to respawn stays dead on the screen until the room has folded the respawn.
  const next = playing(),
    unit = next.world!.units[3]!;
  unit.dead = true;
  unit.respawn = 1;
  const view = createForward()(source(next), key(next), 1);
  assert.equal(view.current.units[3]!.dead, true);
  assert.deepEqual(view.current.eggs, viewOf(next.world!).eggs);
  fold(next);
  assert.equal(next.world!.units[3]!.dead, false);
});

test("the countdown is not played forward", () => {
  const room = started();
  const waiting = source(room);
  assert.deepEqual(
    waiting.ticks.map((tick) => tick.length),
    [0, 0],
  );
  const drawn = createForward()(waiting, key(room), 1.5);
  assert.equal(drawn.current.step, room.world!.step);
  // The last tick of the countdown plays only what lies past it.
  toPlay(room);
  fold(room);
  assert.equal(stepsAhead(0.5, [0, STEPS_PER_TICK]), 0);
  assert.equal(stepsAhead(1.5, [0, STEPS_PER_TICK]), 1.5);
  assert.equal(stepsAhead(1.5, [3, 3]), 4.5);
});

test("a step is run once per folded round, revision and inputs, however many frames draw it", () => {
  const room = playing(),
    forward = createForward();
  const first = forward(source(room), key(room), 0.4);
  // The same whole step on later frames is the same view: nothing was stepped again.
  assert.equal(forward(source(room), key(room), 0.6).previous, first.previous);
  assert.equal(forward(source(room), key(room), 0.5).current, first.current);
  // New controls, or a rollback that replaced the round, play it again.
  const pressed = forward(
    source(room, { 1: { a: [right(room)] } }),
    key(room),
    0.4,
  );
  assert.notEqual(pressed.previous, first.previous);
  assert.notEqual(
    forward(source(room, { 1: { a: [right(room)] } }), key(room, 1), 0.4)
      .previous,
    pressed.previous,
  );
});

test("the smoother hides a correction to the other units and never touches the local one", () => {
  const room = playing(),
    base = viewOf(room.world!),
    smoother = createSmoother();
  let now = 0;
  const still: Picture = { previous: base, current: base, alpha: 1 };
  const marks = (
    revision: number,
    tick: number,
    folded: number[] = [0, 0, 0, 0, 0, 0],
    next: number[] = folded,
  ) => ({ revision, game: "m1:1", tick, folded, next: [next, next] });
  const show = (picture: Picture, ...args: Parameters<typeof marks>) =>
    smoother.apply(picture, marks(...args), (now += 16), 0);
  for (let i = 0; i < 3; i++) show(still, 0, 10);
  const move = (view: RoundView, by: number): RoundView => ({
    ...view,
    units: view.units.map((unit) => ({ ...unit, x: unit.x + by })),
  });
  // A rollback moved everyone 12 px: the local unit snaps, the others start from where they were.
  const moved = move(base, 12),
    jumped: Picture = { previous: moved, current: moved, alpha: 1 };
  const after = show(jumped, 1, 10);
  assert.equal(after.current.units[0]!.x, moved.units[0]!.x);
  assert.ok(Math.abs(after.current.units[1]!.x - base.units[1]!.x) < 1e-6);
  let last = after;
  for (let i = 0; i < 30; i++) last = show(jumped, 1, 10);
  assert.equal(last.current.units[1]!.x, moved.units[1]!.x);
  assert.equal(last, jumped, "a settled picture is passed through");
  // A new tick whose entries are the ones drawn changes nothing, wherever the units went.
  const on = move(moved, 9),
    stepped: Picture = { previous: on, current: on, alpha: 1 };
  assert.equal(show(stepped, 1, 11).current.units[1]!.x, on.units[1]!.x);
  // One where slot 1's pilot did something else than was drawn is eased; the other units are shown as they are.
  const turned = move(on, 20),
    wrong: Picture = { previous: turned, current: turned, alpha: 1 };
  const hidden = show(
    wrong,
    1,
    12,
    [0, INPUT_RIGHT, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
  );
  assert.ok(
    hidden.current.units[1]!.x < turned.units[1]!.x &&
      hidden.current.units[1]!.x >= on.units[1]!.x,
    "the unit is eased towards where its pilot's controls put it",
  );
  assert.equal(hidden.current.units[2]!.x, turned.units[2]!.x);
  assert.equal(hidden.current.units[0]!.x, turned.units[0]!.x);
  // A new game starts from the picture as it is.
  const fresh = smoother.apply(
    still,
    { ...marks(2, 1), game: "m1:2" },
    (now += 16),
    0,
  );
  assert.equal(fresh, still);
});

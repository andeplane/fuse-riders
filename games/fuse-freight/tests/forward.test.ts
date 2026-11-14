import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, BOT, JOIN, type StreamEntries } from "fuse-netcode";
import {
  COUNTDOWN_STEPS,
  DEFAULT_SETTINGS,
  LEFT,
  RIGHT,
  STEPS_PER_TICK,
  botInput,
  copyWorld,
  stepWorld,
  toView,
  type World,
  type WorldView,
} from "../src/engine/index.js";
import { DOCKS } from "../src/engine/arena.js";
import {
  PLAY,
  createRoom,
  foldTick,
  type Entry,
  type Room,
} from "../src/online/game.js";
import {
  TWIN_PX,
  createCueLatch,
  createSmoother,
  forward,
  forwardInputs,
  memoBot,
  type ForwardInputs,
} from "../src/app/forward.js";
import { EAST, at, cart, held, place, playing } from "./fixtures/world.js";

const holding = (bits: Record<string, number>): ForwardInputs => ({
  held: (_, train) => bits[train.id] ?? 0,
});

/** One log tick as the fold runs it. */
function tick(world: World, bits: Record<string, number> = {}): void {
  for (let i = 0; i < STEPS_PER_TICK; i++) stepWorld(world, held(bits));
}

type Bodies = Record<string, readonly unknown[][]>;
let seq = 0;
function fold(room: Room, bodies: Bodies = {}): void {
  const tickNo = room.tick + 1,
    streams = new Map<string, StreamEntries<Entry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation: 1,
      entries: list.map((body) => [++seq, tickNo, ...body] as Entry),
    });
  foldTick(room, "a", streams);
}
/** `a` and `b` seated, a bot in slot 2, and the round under way. */
function started(): Room {
  const room = createRoom("m0", DEFAULT_SETTINGS);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "train", 1],
      [JOIN, "b", "Bo", 1, "train", 1],
      [BOT, "add", "bot:1", "Loco Lola", 2],
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  while (room.world!.step < COUNTDOWN_STEPS) fold(room);
  return room;
}
const outcome = (world: World): string =>
  world.trains.map((t) => `${t.score}/${t.cargo.length}`).join();

test("a whole tick played forward is the tick the fold produces, and the room's world is left alone", () => {
  const world = playing(2);
  tick(world, { t0: RIGHT });
  const before = JSON.stringify(world);
  const drawn = forward(world, 1, holding({ t0: RIGHT }));
  assert.equal(JSON.stringify(world), before, "the run works on a copy");
  tick(world, { t0: RIGHT });
  assert.deepEqual(drawn, toView(world));
  // Two ticks ahead, while the fold is late, is the tick after that.
  const two = forward(world, 2, holding({ t0: RIGHT }));
  tick(world, { t0: RIGHT });
  tick(world, { t0: RIGHT });
  assert.deepEqual(two, toView(world));
});

test("with the room's seats, the forward run draws what the fold then makes of the same controls", () => {
  const room = started();
  let compared = 0;
  for (let i = 0; i < 60 && room.stage === "running"; i++) {
    // `a` changes what it holds every few ticks and logs it for the tick being folded; `b` keeps what it logged.
    const live = [0, LEFT, 0, RIGHT][(i >> 1) % 4]!;
    const world = room.world!,
      was = outcome(world);
    const drawn = forward(world, 1, forwardInputs(room, "a", live, botInput));
    fold(room, {
      a: [[PLAY, room.matchId, room.round, live]],
      ...(i === 0 ? { b: [[PLAY, room.matchId, room.round, RIGHT]] } : {}),
    });
    const now = room.world!;
    // The first tick is the one where `b`'s controls changed under the forward run; a tick that scores or cuts is held back.
    if (i === 0 || now !== world || now.phase !== "play") continue;
    if (
      now.trains.some(
        (t, index) =>
          `${t.score}` !== was.split(",")[index]!.split("/")[0] ||
          t.cargo.length < Number(was.split(",")[index]!.split("/")[1]),
      )
    )
      continue;
    assert.deepEqual(drawn, toView(now), `tick ${i}`);
    compared++;
  }
  assert.ok(compared > 40, `compared ${compared} ticks`);
});

test("a turn shows on the local train at once, part of the way into the tick", () => {
  const world = playing(2);
  place(world, "t0", 300, 300, EAST);
  place(world, "t1", 300, 500, EAST);
  tick(world);
  const still = forward(world, 1 / 3, holding({})),
    turned = forward(world, 1 / 3, holding({ t0: RIGHT }));
  assert.equal(still.trains[0]!.hy, 0);
  assert.ok(turned.trains[0]!.hy > 0, "the train is already turning right");
  assert.equal(turned.trains[0]!.steer, 1);
  assert.deepEqual(turned.trains[1], still.trains[1]);
  // A third of a tick is one of its three steps; a fraction of a step is blended.
  const one = copyWorld(world);
  stepWorld(one, held({ t0: RIGHT }));
  assert.deepEqual(turned, toView(one));
  const two = copyWorld(one);
  stepWorld(two, held({ t0: RIGHT }));
  const between = forward(world, 0.5, holding({ t0: RIGHT }));
  assert.ok(
    between.trains[0]!.hy > toView(one).trains[0]!.hy &&
      between.trains[0]!.hy < toView(two).trains[0]!.hy,
  );
  assert.deepEqual(forward(world, 0, holding({ t0: RIGHT })), toView(world));
});

test("the forward run never shows a delivery or the whistle before the room has folded it, but does show a pick-up", () => {
  // A train with three wagons a step short of its dock.
  const world = playing(1);
  const dock = DOCKS[0]!;
  const y = at((dock.top + dock.bottom) / 2);
  place(world, "t0", at(dock.right) + 60, y, 512, 3);
  let before = copyWorld(world);
  for (let i = 0; i < 60 && world.trains[0]!.score === 0; i++) {
    before = copyWorld(world);
    tick(world);
  }
  assert.equal(world.trains[0]!.score, 3, "the fold banks them this tick");
  for (const ahead of [1, 1.5, 2]) {
    const drawn = forward(before, ahead, holding({}));
    assert.equal(drawn.trains[0]!.score, 0);
    assert.equal(drawn.trains[0]!.wagons.length, 3);
    assert.ok(drawn.step >= before.step && drawn.step < world.step);
  }
  // The whistle is not guessed.
  const late = playing(1);
  late.step = COUNTDOWN_STEPS + late.length - 2;
  const shown = forward(late, 2, holding({}));
  assert.equal(shown.phase, "play");
  assert.equal(shown.step, late.step + 1);
  // A cart on the train's nose is coupled in the picture straight away.
  const near = playing(1);
  place(near, "t0", 300, 300, EAST);
  cart(near, 316, 300);
  const picked = forward(near, 1, holding({}));
  assert.equal(picked.trains[0]!.wagons.length, 1);
  assert.equal(picked.carts.length, 0);
});

test("a bot is asked once per folded world and revision, however many frames draw it", () => {
  let asked = 0;
  const memo = memoBot(() => {
    asked++;
    return RIGHT;
  });
  const world = playing(2);
  const inputs = (revision: number): ForwardInputs => ({
    held: (copy, train) =>
      train.id === "t1" ? memo(revision)(copy, train) : 0,
  });
  for (let frame = 1; frame < 5; frame++)
    forward(world, 0.2 * frame, inputs(0));
  assert.equal(asked, 1);
  // Late-fold frames play into a second tick: one more answer, not one per frame.
  for (let frame = 0; frame < 5; frame++)
    forward(world, 1.2 + 0.1 * frame, inputs(0));
  assert.equal(asked, 2);
  // A rollback replaced the world at the same step: its answer is asked for again.
  forward(world, 0.5, inputs(1));
  assert.equal(asked, 3);
  tick(world);
  forward(world, 0.5, inputs(1));
  assert.equal(asked, 4);
});

test("an effect the forward run showed is not shown again when the room folds it a step or a few pixels away", () => {
  const latch = createCueLatch();
  const base = toView(playing(2));
  const fx = (
    id: number,
    step: number,
    x: number,
    kind: WorldView["fx"][number]["kind"] = "bump",
    slot = 1,
  ) => ({ id, at: step, kind, x, y: 200, slot, data: 0, other: -1 });
  const withFx = (...list: WorldView["fx"]): WorldView => ({
    ...base,
    fx: list,
  });
  assert.equal(latch(base), base, "an untouched view is passed through");
  const predicted = withFx(fx(1, 200, 300));
  assert.equal(latch(predicted), predicted);
  // The next run takes it back, and the room folds it two steps later and a little to the side, in another cell of
  // the scene's key: the scene never sees the second one.
  assert.deepEqual(latch(withFx()).fx, []);
  const folded = withFx(fx(7, 203, 300 + TWIN_PX - 2));
  assert.deepEqual(latch(folded).fx, []);
  assert.deepEqual(latch(folded).fx, [], "nor on any later frame");
  // The one first shown stays, and so do effects that are something else: another kind, seat, place or moment.
  const others = [
    fx(8, 203, 300, "wall"),
    fx(9, 203, 300, "bump", 0),
    fx(10, 203, 300 + TWIN_PX * 3),
    fx(11, 240, 300),
  ];
  assert.deepEqual(latch(withFx(fx(1, 200, 300), ...others)).fx, [
    fx(1, 200, 300),
    ...others,
  ]);
  // A new round starts clean.
  const next = { ...withFx(fx(1, 203, 310)), seed: base.seed + 1 };
  assert.equal(latch(next), next);
});

test("the smoother hides a correction to another train, wagons and all, and never touches the local one", () => {
  const world = playing(2);
  place(world, "t0", 300, 300, EAST, 2);
  place(world, "t1", 300, 500, EAST, 2);
  const smoother = createSmoother();
  let now = 0;
  const show = (view = toView(world), revision = 0, logged = {}) =>
    smoother.apply(view, revision, view.step, logged, (now += 16), "t0");
  for (let i = 0; i < 3; i++) show();
  const base = toView(world);
  const shifted = (view: WorldView, dy: number, step = 0): WorldView => ({
    ...view,
    step: view.step + step,
    trains: view.trains.map((t) => ({
      ...t,
      y: t.y + dy,
      wagons: t.wagons.map((w) => ({ ...w, y: w.y + dy })),
    })),
  });
  // A rollback moved everyone 20 px: the local train snaps, the other starts from where it was.
  const moved = shifted(base, 20);
  const after = show(moved, 1);
  assert.deepEqual(after.trains[0], moved.trains[0]);
  assert.ok(Math.abs(after.trains[1]!.y - base.trains[1]!.y) < 1e-6);
  assert.ok(
    Math.abs(after.trains[1]!.wagons[1]!.y - base.trains[1]!.wagons[1]!.y) <
      1e-6,
    "its wagons stay coupled to it",
  );
  let last = after;
  for (let i = 0; i < 30; i++) last = show(moved, 1);
  assert.deepEqual(last.trains[1], moved.trains[1]);
  // A new tick where the other driver drove as drawn changes nothing; one where their controls changed is absorbed.
  const next = shifted(moved, 9, 3);
  assert.equal(show(next, 1).trains[1]!.y, next.trains[1]!.y);
  const turned = shifted(next, 30, 3);
  const hidden = show(turned, 1, { t1: RIGHT });
  assert.ok(
    hidden.trains[1]!.y < turned.trains[1]!.y &&
      hidden.trains[1]!.y >= next.trains[1]!.y,
    "the other train is eased towards where its new controls put it",
  );
  assert.equal(hidden.trains[0]!.y, turned.trains[0]!.y);
  // A new round starts again.
  const fresh = { ...shifted(base, -60), seed: base.seed + 1 };
  assert.equal(show(fresh, 3).trains[1]!.y, fresh.trains[1]!.y);
});

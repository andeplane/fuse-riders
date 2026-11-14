import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, BOT, JOIN, type StreamEntries } from "fuse-netcode";
import {
  COUNTDOWN_STEPS,
  DEFAULT_SETTINGS,
  DOWN,
  RIGHT,
  STEPS_PER_TICK,
  UP,
  botInput,
  copyWorld,
  stepWorld,
  toView,
  type World,
  type WorldView,
} from "../src/engine/index.js";
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
import { HOVER, held, playing } from "./fixtures/world.js";

const holding = (
  bits: Record<string, number>,
  steps = STEPS_PER_TICK,
): ForwardInputs => ({
  held: (_, chopper) => bits[chopper.id] ?? 0,
  steps: () => steps,
});

/** One log tick as the fold runs it. */
function tick(world: World, bits: Record<string, number> = {}): void {
  for (let i = 0; i < STEPS_PER_TICK; i++) stepWorld(world, held(bits));
}

type Bodies = Record<string, readonly unknown[][]>;
let seq = 0;
function fold(room: Room, bodies: Bodies = {}): void {
  const at = room.tick + 1,
    streams = new Map<string, StreamEntries<Entry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation: 1,
      entries: list.map((body) => [++seq, at, ...body] as Entry),
    });
  foldTick(room, "a", streams);
}
/** `a` and `b` seated, a bot in slot 2, and the round under way. */
function started(): Room {
  const room = createRoom("m0", { ...DEFAULT_SETTINGS, lift: "thrust" });
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "fox", 1],
      [JOIN, "b", "Bo", 1, "fox", 1],
      [BOT, "add", "bot:1", "Rotor Rex", 2],
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  while (room.world!.step < COUNTDOWN_STEPS) fold(room);
  return room;
}

test("a whole tick played forward is the tick the fold produces, and the room's world is left alone", () => {
  const world = playing(2, HOVER);
  tick(world, { c0: UP });
  const before = JSON.stringify(world);
  const drawn = forward(world, 1, holding({ c0: UP }));
  assert.equal(JSON.stringify(world), before, "the run works on a copy");
  tick(world, { c0: UP });
  assert.deepEqual(drawn, toView(world));
  // Two ticks ahead, while the fold is late, is the tick after that.
  const two = forward(world, 2, holding({ c0: UP }));
  tick(world, { c0: UP });
  tick(world, { c0: UP });
  assert.deepEqual(two, toView(world));
});

test("with the room's seats, the forward run draws what the fold then makes of the same controls", () => {
  const room = started();
  let compared = 0;
  for (let i = 0; i < 40 && room.stage === "running"; i++) {
    // `a` changes what it holds every few ticks and logs it for the tick being folded; `b` keeps what it logged.
    const live = [0, UP, RIGHT, DOWN][(i >> 1) % 4]!;
    const world = room.world!,
      flying = world.choppers.map((c) => c.alive && !c.exited).join();
    const drawn = forward(world, 1, forwardInputs(room, "a", live, botInput));
    fold(room, {
      a: [[PLAY, room.matchId, room.round, live]],
      ...(i === 0 ? { b: [[PLAY, room.matchId, room.round, RIGHT]] } : {}),
    });
    const now = room.world!;
    // The first tick is the one where `b`'s controls changed under the forward run; a tick that downs a chopper is held back.
    if (
      i === 0 ||
      now !== world ||
      now.phase !== "play" ||
      now.choppers.map((c) => c.alive && !c.exited).join() !== flying
    )
      continue;
    assert.deepEqual(drawn, toView(now), `tick ${i}`);
    compared++;
  }
  assert.ok(compared > 20, `compared ${compared} ticks`);
});

test("a press shows on the local chopper at once, part of the way into the tick", () => {
  const world = playing(2, HOVER);
  tick(world);
  const still = forward(world, 1 / 3, holding({})),
    pressed = forward(world, 1 / 3, holding({ c0: UP }));
  assert.ok(
    pressed.choppers[0]!.y < still.choppers[0]!.y,
    "the chopper holding up is already climbing",
  );
  assert.equal(pressed.choppers[0]!.lifting, true);
  assert.equal(pressed.choppers[1]!.y, still.choppers[1]!.y);
  // A third of a tick is one of its three steps; a fraction of a step is blended.
  const one = copyWorld(world);
  stepWorld(one, held({ c0: UP }));
  assert.deepEqual(pressed, toView(one));
  const two = copyWorld(one);
  stepWorld(two, held({ c0: UP }));
  const between = forward(world, 0.5, holding({ c0: UP }));
  assert.ok(
    between.choppers[0]!.y < toView(one).choppers[0]!.y &&
      between.choppers[0]!.y > toView(two).choppers[0]!.y,
  );
  assert.deepEqual(forward(world, 0, holding({ c0: UP })), toView(world));
});

test("the forward run never shows a crash, or the round it ends, before the room has folded it", () => {
  // Classic lift with nobody climbing: every chopper falls to the floor.
  const world = playing(3);
  let before = copyWorld(world);
  for (let i = 0; i < 400 && world.choppers.every((c) => c.alive); i++) {
    before = copyWorld(world);
    tick(world);
  }
  assert.ok(
    world.choppers.some((c) => !c.alive),
    "the fold crashes one this tick",
  );
  for (const ahead of [1, 1.5, 2]) {
    const drawn = forward(before, ahead, holding({}));
    assert.ok(drawn.choppers.every((c) => c.state === "flying"));
    assert.equal(drawn.phase, "play");
    assert.equal(drawn.winner, null);
    assert.ok(drawn.step >= before.step && drawn.step < world.step);
  }
  // The end of the countdown is not guessed either.
  const counting = playing(1);
  counting.phase = "countdown";
  counting.step = COUNTDOWN_STEPS - 2;
  const held0 = forward(counting, 2, holding({}));
  assert.equal(held0.phase, "countdown");
  assert.equal(held0.step, COUNTDOWN_STEPS - 1);
});

test("a fast tick plays all its steps, and a bot is asked again every three of them", () => {
  const world = playing(2, HOVER);
  const steps: number[] = [];
  const inputs: ForwardInputs = {
    held: (copy, chopper) => {
      if (chopper.id === "c1") steps.push(copy.step);
      return chopper.id === "c1" ? UP : 0;
    },
    steps: () => STEPS_PER_TICK * 3,
  };
  const drawn = forward(world, 1, inputs);
  assert.deepEqual(steps, [world.step, world.step + 3, world.step + 6]);
  for (let i = 0; i < 9; i++) stepWorld(world, held({ c1: UP }));
  assert.deepEqual(drawn, toView(world));
});

test("a bot is asked once per folded world and revision, however many frames draw it", () => {
  let asked = 0;
  const memo = memoBot(() => {
    asked++;
    return UP;
  });
  const world = playing(2, HOVER);
  const inputs = (revision: number): ForwardInputs => ({
    held: (copy, chopper) =>
      chopper.id === "c1" ? memo(revision)(copy, chopper) : 0,
    steps: () => STEPS_PER_TICK,
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
  const base = toView(playing(2, HOVER));
  const fx = (
    id: number,
    at: number,
    x: number,
    kind: WorldView["fx"][number]["kind"] = "bump",
    slot = 1,
  ) => ({ id, at, kind, x, y: 200, slot, data: 0 });
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
    fx(8, 203, 300, "hit"),
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

test("the smoother hides a correction to another chopper, and never touches the local one", () => {
  const world = playing(2, HOVER);
  tick(world);
  const smoother = createSmoother();
  let now = 0;
  const show = (view = toView(world), revision = 0, logged = {}) =>
    smoother.apply(view, revision, view.step, logged, (now += 16), "c0");
  for (let i = 0; i < 3; i++) show();
  const base = toView(world);
  const shifted = (view: WorldView, dy: number, step = 0): WorldView => ({
    ...view,
    step: view.step + step,
    choppers: view.choppers.map((c) => ({ ...c, y: c.y + dy })),
  });
  // A rollback moved everyone 20 px: the local chopper snaps, the other starts from where it was.
  const moved = shifted(base, 20);
  const after = show(moved, 1);
  assert.equal(after.choppers[0]!.y, moved.choppers[0]!.y);
  assert.ok(Math.abs(after.choppers[1]!.y - base.choppers[1]!.y) < 1e-6);
  let last = after;
  for (let i = 0; i < 30; i++) last = show(moved, 1);
  assert.equal(last.choppers[1]!.y, moved.choppers[1]!.y);
  // A new tick where the other pilot flew as drawn changes nothing; one where their controls changed is absorbed.
  const next = shifted(moved, 9, 3);
  assert.equal(show(next, 1).choppers[1]!.y, next.choppers[1]!.y);
  const turned = shifted(next, 30, 3);
  const hidden = show(turned, 1, { c1: UP });
  assert.ok(
    hidden.choppers[1]!.y < turned.choppers[1]!.y &&
      hidden.choppers[1]!.y >= next.choppers[1]!.y,
    "the other chopper is eased towards where its new controls put it",
  );
  assert.equal(hidden.choppers[0]!.y, turned.choppers[0]!.y);
  // A chopper that is down is drawn where it fell, and a new round starts again.
  const down = {
    ...shifted(turned, 40, 3),
    choppers: shifted(turned, 40, 3).choppers.map((c) => ({
      ...c,
      state: "crashed" as const,
    })),
  };
  assert.equal(show(down, 2).choppers[1]!.y, down.choppers[1]!.y);
  const fresh = { ...shifted(base, -60), seed: base.seed + 1 };
  assert.equal(show(fresh, 3).choppers[1]!.y, fresh.choppers[1]!.y);
});

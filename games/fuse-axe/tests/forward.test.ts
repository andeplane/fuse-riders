import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, BOT, JOIN, type StreamEntries } from "fuse-netcode";
import {
  RIGHT,
  STEPS_PER_TICK,
  botInput,
  campLeft,
  createWorld,
  toView,
  type World,
} from "../src/engine/index.js";
import {
  DEFAULT_SETTINGS,
  PLAY,
  createRoom,
  foldTick,
  type Entry,
  type Room,
} from "../src/online/game.js";
import {
  createSmoother,
  forward,
  forwardInputs,
  loggedBits,
  memoBot,
} from "../src/app/forward.js";

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
/** `a` (Rhea) and `b` (Brakka) seated, a bot in slot 2, and run `m1` a few ticks in. */
function started(): Room {
  const room = createRoom("m0", DEFAULT_SETTINGS);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "rhea", 1],
      [JOIN, "b", "Bo", 1, "brakka", 1],
      [BOT, "add", "bot:1", "Ironhide", 2],
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  for (let i = 0; i < 5; i++) fold(room);
  return room;
}
const play = (bits: number) => [PLAY, "m1", 1, bits];
const heroAt = (
  view: { heroes: { seat: number; x: number }[] },
  seat: number,
) => view.heroes.find((hero) => hero.seat === seat)!;

test("a whole tick played forward is the tick the fold produces, the bot included, and the room is left alone", () => {
  const room = started();
  fold(room, { a: [play(RIGHT)] });
  const before = JSON.stringify([room.world, room.held]);
  const inputs = forwardInputs(room, "a", RIGHT, botInput);
  const one = forward(room.world!, 1, inputs),
    two = forward(room.world!, 2, inputs);
  assert.equal(JSON.stringify([room.world, room.held]), before);
  fold(room);
  assert.deepEqual(one, toView(room.world!));
  fold(room);
  assert.deepEqual(two, toView(room.world!));
});

test("a press shows on this device's hero at once; the others hold what they logged", () => {
  const room = started();
  fold(room, { b: [play(RIGHT)] });
  const world = room.world!,
    part = 2 / STEPS_PER_TICK;
  const still = forward(world, part, forwardInputs(room, "a", 0, botInput)),
    pressed = forward(world, part, forwardInputs(room, "a", RIGHT, botInput));
  assert.equal(still.step, world.step + 2);
  assert.equal(heroAt(still, 0).x, heroAt(toView(world), 0).x);
  assert.ok(heroAt(pressed, 0).x > heroAt(still, 0).x, "walking at once");
  assert.ok(
    heroAt(still, 1).x > heroAt(toView(world), 1).x,
    "the other hero walks on with the bits it logged",
  );
  assert.equal(heroAt(pressed, 1).x, heroAt(still, 1).x);
  assert.deepEqual(loggedBits(room, world), [0, RIGHT, 0]);
  // Part of a step is a blend of the steps either side, on whole pixels.
  const between = forward(
    world,
    2.5 / STEPS_PER_TICK,
    forwardInputs(room, "a", RIGHT, botInput),
  );
  assert.equal(between.step, world.step + 3);
  assert.ok(Number.isInteger(heroAt(between, 0).x));
  assert.ok(heroAt(between, 0).x >= heroAt(pressed, 0).x);
});

test("camp breaking up is shown when the room folds it, never on a guess", () => {
  const camp: World = createWorld({
    seed: 3,
    heroes: [{ seat: 0, kind: "rhea" }],
    camp: true,
  });
  // Two steps of camp's clock left: the third step of a forward run would end it.
  const world = { ...camp, step: camp.step + campLeft(camp) - 2 };
  assert.equal(campLeft(world), 2);
  const drawn = forward(world, 2, { held: () => [0] });
  assert.equal(drawn.step, world.step + 1);
});

test("a bot is asked once per hero, step and revision", () => {
  const room = started();
  let asked = 0;
  const bot = memoBot((world, id, humans) => {
    asked++;
    return botInput(world, id, humans);
  });
  forward(room.world!, 0.4, forwardInputs(room, "a", 0, bot(1)));
  forward(room.world!, 0.8, forwardInputs(room, "a", 0, bot(1)));
  assert.equal(asked, 1);
  forward(room.world!, 0.8, forwardInputs(room, "a", 0, bot(2)));
  assert.equal(asked, 2, "a rollback replaced the world: ask again");
});

test("a correction to another hero is spread over a few frames, with its beast; this device's own never is", () => {
  const room = started(),
    base = toView(room.world!),
    smoother = createSmoother();
  const at = (x: number, mine: number) => ({
    ...base,
    heroes: base.heroes.map((hero) =>
      hero.seat === 0
        ? { ...hero, x: mine }
        : hero.seat === 1
          ? { ...hero, x }
          : hero,
    ),
    mounts: [
      {
        id: 900,
        kind: "clawbeak" as const,
        x,
        y: heroAt(base, 1).x,
        z: 0,
        facing: 1 as const,
        anim: "idle" as const,
        animStep: 0,
        rider: { kind: "hero" as const, id: base.heroes[1]!.id },
      },
    ],
  });
  const key = "m1:1:false";
  smoother.apply(at(100, 40), key, 1, 10, [], 0, 0);
  smoother.apply(at(102, 40), key, 1, 10, [], 16, 0);
  const jumped = smoother.apply(at(124, 70), key, 2, 10, [], 32, 0);
  assert.equal(heroAt(jumped, 0).x, 70, "the local hero follows the hands");
  assert.equal(heroAt(jumped, 1).x, 104, "the other carries on as drawn");
  assert.equal(jumped.mounts[0]!.x, 104, "and its beast with it");
  let last = jumped;
  for (let ms = 48; ms < 600; ms += 16)
    last = smoother.apply(at(124, 70), key, 2, 10, [], ms, 0);
  assert.equal(heroAt(last, 1).x, 124, "and ends where the room has it");
  // No rollback and no change of controls: the picture's own motion, shown as it is.
  assert.equal(
    heroAt(smoother.apply(at(140, 70), key, 2, 10, [], 616, 0), 1).x,
    140,
  );
  // A new tick on which that hero's seat logged other bits is a wrong guess too.
  smoother.apply(at(142, 70), key, 2, 10, [], 632, 0);
  const turned = smoother.apply(at(130, 70), key, 2, 13, [0, RIGHT], 648, 0);
  assert.ok(heroAt(turned, 1).x > 140);
});

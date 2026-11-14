import test from "node:test";
import assert from "node:assert/strict";
import {
  BALL_SPEED,
  COUNTDOWN,
  SUBSTEPS,
  control,
  createArena,
  type ArenaState,
  type Control,
  type Steering,
} from "../src/engine/state.js";
import { step } from "../src/engine/step.js";
import { createRoom, foldTick } from "../src/online/game.js";
import {
  createSmoother,
  forward,
  forwardInputs,
  type ForwardInputs,
} from "../src/app/forward.js";

const A = "a",
  B = "b";
const steer = (s: Steering, launch = false): Control => ({
  steer: s,
  radial: 0,
  launch,
});
const playing = (bots = false): ArenaState => {
  const arena = createArena([
    { id: A, name: "A", slot: 0, bot: false },
    { id: B, name: "B", slot: 1, bot: bots },
  ]);
  arena.tick = COUNTDOWN;
  arena.formationStep = COUNTDOWN * SUBSTEPS;
  arena.phase = "playing";
  return arena;
};
/** Player A holds `live`; everyone else keeps what the arena has for them. */
const holding = (live: Control): ForwardInputs => ({
  control: (_, base) => (base.id === A ? live : undefined),
});
/** One log tick as the fold runs it. */
function tick(arena: ArenaState, a: Control): void {
  control(arena, A, a);
  step(arena);
}
const paddle = (arena: ArenaState, id = A) =>
  arena.bases.find((base) => base.id === id)!;

test("a whole tick played forward is the tick the fold produces, and the room's arena is left alone", () => {
  const arena = playing();
  tick(arena, steer(1));
  const before = JSON.stringify(arena);
  const drawn = forward(arena, 1, holding(steer(1)));
  assert.equal(JSON.stringify(arena), before, "the forward run uses a copy");
  tick(arena, steer(1));
  assert.deepEqual(drawn, arena);
  // Two ticks ahead, while the fold is late, is the tick after that.
  const two = forward(arena, 2, holding(steer(1)));
  tick(arena, steer(1));
  tick(arena, steer(1));
  assert.deepEqual(two, arena);
});

test("a press shows on the local paddle at once, part of the way into the tick, and on nobody else's", () => {
  const arena = playing();
  tick(arena, steer(0));
  const still = forward(arena, 0.5, holding(steer(0))),
    pressed = forward(arena, 0.5, holding(steer(1)));
  assert.notEqual(paddle(pressed).angle, paddle(still).angle);
  assert.equal(paddle(pressed, B).angle, paddle(still, B).angle);
  // Half a tick is half of the way to where the fold will put the paddle.
  const whole = forward(arena, 1, holding(steer(1)));
  const turned = (to: ArenaState) => paddle(to).angle - paddle(arena).angle;
  assert.ok(Math.abs(turned(pressed) - turned(whole) / 2) < 1e-9);
  assert.deepEqual(forward(arena, 0, holding(steer(1))), arena);
});

test("a launch the room has not folded yet already flies on the screen", () => {
  const arena = playing();
  const held = forward(arena, 1, holding(steer(0))),
    launched = forward(arena, 1, holding(steer(0, true)));
  assert.equal(held.balls[0]!.held, A);
  assert.equal(launched.balls[0]!.held, null);
  assert.equal(arena.balls[0]!.held, A, "the room still holds the ball");
});

test("the forward run never shows a lost core or the end of the round before the room folds it", () => {
  const arena = playing();
  // B's own ball, loose, a step short of B's core.
  const core = paddle(arena, B),
    ball = arena.balls[1]!;
  Object.assign(ball, {
    held: null,
    x: core.x - 30,
    y: core.y,
    vx: BALL_SPEED,
    vy: 0,
  });
  for (const block of core.blocks) block.alive = false;
  const folded = structuredClone(arena);
  tick(folded, steer(0));
  assert.equal(paddle(folded, B).alive, false, "the fold loses the core");
  assert.equal(folded.phase, "over");
  const drawn = forward(arena, 1, holding(steer(0)));
  assert.equal(paddle(drawn, B).alive, true);
  assert.equal(drawn.phase, "playing");
  assert.deepEqual(drawn.balls, arena.balls, "the picture waits before it");
});

test("a block the forward run breaks stays drawn until the room folds the break", () => {
  const arena = playing();
  const core = paddle(arena, B),
    target = core.blocks.findIndex((block) => block.alive),
    block = core.blocks[target]!;
  Object.assign(arena.balls[0]!, {
    held: null,
    x: core.x + block.x - 25,
    y: core.y + block.y,
    vx: BALL_SPEED,
    vy: 0,
  });
  const folded = structuredClone(arena);
  tick(folded, steer(0));
  assert.equal(
    paddle(folded, B).blocks[target]!.alive,
    false,
    "the fold breaks it",
  );
  const drawn = forward(arena, 1, holding(steer(0)));
  assert.equal(paddle(drawn, B).blocks[target]!.alive, true);
  assert.deepEqual(
    drawn.balls[0],
    folded.balls[0],
    "the ball bounced all the same",
  );
});

test("bots answer as the fold asks them, absent players hold nothing, and others keep what they logged", () => {
  const room = createRoom("m1", { display: false, mapId: "classic" });
  room.seats.set(A, {
    id: A,
    name: "A",
    slot: 0,
    bot: false,
    connected: true,
    avatarId: "fox",
    generation: 1,
  });
  room.seats.set(B, {
    id: B,
    name: "B",
    slot: 1,
    bot: true,
    connected: false,
    avatarId: "robot",
  });
  room.stage = "running";
  room.arena = playing(true);
  const drawn = forward(
    room.arena,
    1,
    forwardInputs((id) => !!room.seats.get(id)?.connected, A, steer(-1)),
  );
  // The fold, given the same press as a logged entry for the tick.
  foldTick(
    room,
    A,
    new Map([
      [
        A,
        {
          generation: 1,
          entries: [[1, 1, 0, "m1", -1, 0, false]],
        },
      ],
    ]),
  );
  assert.deepEqual(drawn, room.arena);
  // A person who left holds nothing, whatever the arena last had for them; one still there keeps turning.
  const arena = playing();
  paddle(arena, B).steer = 1;
  const stays = forward(
      arena,
      1,
      forwardInputs(() => true, A, steer(0)),
    ),
    gone = forward(
      arena,
      1,
      forwardInputs((id) => id === A, A, steer(0)),
    );
  assert.notEqual(paddle(stays, B).angle, paddle(arena, B).angle);
  assert.equal(paddle(gone, B).angle, paddle(arena, B).angle);
});

test("the smoother hides a correction to another paddle and a ball, and never touches the local paddle", () => {
  const folded = playing();
  Object.assign(folded.balls[1]!, { held: null, x: 500, y: 500 });
  const smoother = createSmoother();
  let now = 0;
  const show = (arena: ArenaState, revision = 0, from = folded) =>
    smoother.apply(
      structuredClone(arena),
      revision,
      from,
      "m1",
      (now += 16),
      A,
    );
  for (let i = 0; i < 3; i++) show(folded);
  // A rollback turned both paddles and moved the loose ball.
  const moved = structuredClone(folded);
  for (const base of moved.bases) base.angle += 0.2;
  moved.balls[1]!.x += 20;
  const after = show(moved, 1);
  assert.equal(paddle(after).angle, paddle(moved).angle, "mine snaps");
  const gap = (a: ArenaState, b: ArenaState) =>
    Math.abs(
      Math.atan2(
        Math.sin(paddle(a, B).angle - paddle(b, B).angle),
        Math.cos(paddle(a, B).angle - paddle(b, B).angle),
      ),
    );
  assert.ok(gap(after, folded) < 1e-6, "theirs starts from where it was");
  assert.ok(Math.abs(after.balls[1]!.x - folded.balls[1]!.x) < 1e-6);
  // The ball their paddle holds rides the paddle as drawn.
  const tip = (arena: ArenaState) =>
    Math.hypot(
      arena.balls[0]!.x - paddle(arena, A).x,
      arena.balls[0]!.y - paddle(arena, A).y,
    );
  assert.ok(Math.abs(tip(after) - tip(moved)) < 1e-6);
  let last = after;
  for (let i = 0; i < 40; i++) last = show(moved, 1);
  assert.ok(gap(last, moved) < 1e-9, "and ends where the room has it");
  assert.equal(last.balls[1]!.x, moved.balls[1]!.x);
  // A new tick where they turned as drawn changes nothing; one where their logged controls changed is absorbed.
  const next = structuredClone(moved);
  next.tick++;
  assert.ok(gap(show(next, 1, next), next) < 1e-9);
  const turned = structuredClone(next);
  turned.tick++;
  paddle(turned, B).steer = 1;
  paddle(turned, B).angle += 0.3;
  const hidden = show(turned, 1, turned);
  assert.ok(
    gap(hidden, turned) > 0.05 && gap(hidden, next) < gap(turned, next),
    "their paddle is eased towards where the new controls put it",
  );
  // A new round is a fresh placement, shown as it is.
  const fresh = structuredClone(turned);
  paddle(fresh, B).angle += 0.3;
  assert.ok(
    gap(smoother.apply(fresh, 2, fresh, "m2", (now += 16), A), fresh) < 1e-9,
  );
});

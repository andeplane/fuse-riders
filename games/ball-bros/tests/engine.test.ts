import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { block, circle, paddle } from "../src/engine/collision.js";
import {
  createArena,
  control,
  BALL_SPEED,
  COUNTDOWN,
  LIMIT,
  type ArenaState,
} from "../src/engine/state.js";
import { botControl } from "../src/engine/bots.js";
import { step } from "../src/engine/step.js";
import { decodeArena, encodeArena } from "../src/engine/codec.js";

const players = Array.from({ length: 5 }, (_, slot) => ({
  id: `p${slot}`,
  name: `Player ${slot}`,
  slot,
  bot: true,
}));
const playing = (count = 2): ArenaState => {
  const s = createArena(players.slice(0, count));
  s.tick = COUNTDOWN;
  s.phase = "playing";
  return s;
};

test("sweeps hit thin blocks, reject padded false corners and reflect enclosing walls", () => {
  assert.equal(
    block({ x: -100, y: 0, vx: 10000, vy: 0 }, 0, 0, 0.02)?.t,
    0.0088,
  );
  assert.equal(block({ x: -12, y: -11, vx: 1, vy: 0 }, 0, 0, 0.1), undefined);
  assert.ok(block({ x: -20, y: -9, vx: 100, vy: 0 }, 0, 0, 1));
  assert.equal(
    circle({ x: 0, y: 0, vx: 100, vy: 0 }, 0, 0, 10, 1, true)?.nx,
    -1,
  );
  assert.equal(
    circle({ x: -20, y: 20, vx: 100, vy: 0 }, 0, 0, 10, 1),
    undefined,
  );
  assert.equal(circle({ x: 0, y: 0, vx: 0, vy: 0 }, 0, 0, 10, 1), undefined);
});

test("curved paddles include endpoints, inner faces and motion into a stationary ball", () => {
  assert.ok(paddle({ x: 100, y: 0, vx: -340, vy: 0 }, 0, 0, 0, 0, 0.1));
  assert.ok(paddle({ x: 50, y: 0, vx: 340, vy: 0 }, 0, 0, 0, 0, 0.1));
  assert.equal(
    paddle({ x: 100, y: 0, vx: 340, vy: 0 }, 0, 0, 0, 0, 0.1),
    undefined,
  );
  assert.ok(
    paddle(
      { x: 77 * Math.cos(0.8), y: 77 * Math.sin(0.8), vx: 0, vy: 0 },
      0,
      0,
      0,
      3.2,
      0.1,
    ),
  );
  assert.equal(
    paddle({ x: 77, y: 0, vx: 0, vy: 0 }, 0, 0, 0, 0, 0.1),
    undefined,
  );
});

test("countdown, steering, manual launch and automatic launch have separate rules", () => {
  const s = createArena(players);
  const before = s.bases[0]!.angle;
  control(s, "p0", { steer: 1, launch: true });
  step(s);
  assert.notEqual(s.bases[0]!.angle, before);
  assert.ok(s.balls.every((b) => b.held));
  while (s.tick < COUNTDOWN) step(s);
  control(s, "p0", { steer: 0, launch: true });
  assert.ok(step(s).some((e) => e.kind === "launch"));
  assert.equal(s.balls[0]!.held, null);
  while (s.tick < COUNTDOWN + 60) step(s);
  assert.ok(s.balls.every((b) => b.held === null));
});

test("paddle return transfers ownership without changing ball speed", () => {
  const s = playing(),
    base = s.bases[0]!,
    ball = s.balls[0]!;
  base.angle = 0;
  Object.assign(ball, {
    x: base.x + 90,
    y: base.y,
    vx: -BALL_SPEED,
    vy: 0,
    held: null,
    owner: "p1",
  });
  assert.ok(step(s).some((e) => e.kind === "paddle"));
  assert.equal(ball.owner, "p0");
  assert.ok(ball.vx > 0);
  assert.ok(Math.abs(Math.hypot(ball.vx, ball.vy) - BALL_SPEED) < 1e-7);
});

test("block damage, self-hits, elimination cleanup and simultaneous final losses", () => {
  const s = playing(),
    base = s.bases[0]!,
    ball = s.balls[0]!;
  base.angle = Math.PI;
  Object.assign(ball, {
    x: base.x + 74,
    y: base.y,
    vx: -BALL_SPEED,
    vy: 0,
    held: null,
  });
  for (let i = 0; i < 8; i++) step(s);
  assert.ok(base.blocks.some((b) => !b.alive));
  base.blocks.forEach((b) => (b.alive = false));
  Object.assign(ball, {
    x: base.x + 24,
    y: base.y,
    vx: -BALL_SPEED,
    vy: 0,
    owner: base.id,
  });
  step(s);
  assert.equal(base.alive, false);
  assert.equal(ball.owner, null);
  assert.equal(s.winner, "p1");
  assert.deepEqual(step(s), []);

  const both = playing();
  both.bases.forEach((b, i) => {
    b.blocks.forEach((k) => (k.alive = false));
    Object.assign(both.balls[i]!, {
      x: b.x + 24,
      y: b.y,
      vx: -BALL_SPEED,
      vy: 0,
      held: null,
    });
  });
  step(both);
  assert.equal(both.phase, "over");
  assert.equal(both.winner, null);
});

test("hard timeout draws and never advances again", () => {
  const s = playing(5);
  s.tick = COUNTDOWN + LIMIT - 1;
  step(s);
  assert.equal(s.phase, "over");
  assert.equal(s.winner, null);
  const frozen = structuredClone(s);
  step(s);
  assert.deepEqual(s, frozen);
});

test("five ordinary-input bots complete a bounded, deterministic round with recoverable checkpoints", () => {
  const s = createArena(players),
    hashes = createHash("sha256");
  while (s.phase !== "over") {
    for (const base of s.bases) control(s, base.id, botControl(s, base));
    step(s);
    assert.ok(
      s.balls.every(
        (b) =>
          Number.isFinite(b.x) && Math.hypot(b.x - 500, b.y - 500) <= 464.01,
      ),
    );
    if (s.tick % 20 === 0 || s.bases.filter((b) => b.alive).length <= 1) {
      assert.deepEqual(
        decodeArena(encodeArena(s)),
        s,
        `checkpoint at ${s.tick}`,
      );
      hashes.update(JSON.stringify(encodeArena(s)));
    }
  }
  assert.ok(s.tick <= COUNTDOWN + LIMIT);
  assert.ok(s.bases.some((b) => b.saves > 0));
  assert.ok(s.bases.some((b) => !b.alive));
  // ball-bros-1: five-bot full-round replay, sampled once per second and at elimination.
  assert.equal(
    hashes.digest("hex"),
    "1a646ade53149427aa5779f41edf3cc0579976b7c30b402a19dc9a3e0ea78007",
  );
});

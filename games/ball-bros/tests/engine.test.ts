import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { block, circle, paddle, wall } from "../src/engine/collision.js";
import {
  createArena,
  control,
  BALL_SPEED,
  COUNTDOWN,
  LIMIT,
  PADDLE,
  PADDLE_MIN,
  PADDLE_MAX,
  insideArena,
  paddleHalf,
  paddleMotion,
  SUBSTEPS,
  type Steering,
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
  s.formationStep = COUNTDOWN * SUBSTEPS;
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
  assert.ok(paddle({ x: PADDLE + 23, y: 0, vx: -340, vy: 0 }, 0, 0, 0, 0, 0.1));
  assert.ok(paddle({ x: PADDLE - 27, y: 0, vx: 340, vy: 0 }, 0, 0, 0, 0, 0.1));
  assert.equal(
    paddle({ x: PADDLE + 23, y: 0, vx: 340, vy: 0 }, 0, 0, 0, 0, 0.1),
    undefined,
  );
  assert.ok(
    paddle(
      { x: PADDLE * Math.cos(0.8), y: PADDLE * Math.sin(0.8), vx: 0, vy: 0 },
      0,
      0,
      0,
      3.2,
      0.1,
    ),
  );
  assert.equal(
    paddle({ x: PADDLE, y: 0, vx: 0, vy: 0 }, 0, 0, 0, 0, 0.1),
    undefined,
  );
});

test("octagon banks reflect from flat and diagonal faces and contain corner ricochets", () => {
  assert.deepEqual(wall({ x: 950, y: 500, vx: 340, vy: 0 }, 0.1), {
    t: 14 / 340,
    nx: -1,
    ny: -0,
  });
  const diagonal = wall({ x: 820, y: 820, vx: 240, vy: 240 }, 0.1)!;
  assert.ok(diagonal && Math.abs(diagonal.nx + Math.SQRT1_2) < 1e-12);
  const s = playing(5);
  s.bases.forEach((b) => {
    b.blocks.forEach((k) => (k.alive = false));
    b.angle = Math.PI;
  });
  const ball = s.balls[0]!;
  Object.assign(ball, { x: 950, y: 687, vx: BALL_SPEED, vy: 0, held: null });
  assert.ok(step(s).some((e) => e.kind === "wall"));
  assert.ok(insideArena(ball.x, ball.y));
  assert.ok(Math.abs(Math.hypot(ball.vx, ball.vy) - BALL_SPEED) < 1e-8);
  // The new corner bays extend beyond the old circle, but not beyond the cut corners.
  assert.equal(insideArena(950, 680), true);
  assert.equal(insideArena(950, 950), false);
});

test("radial reach clamps, keeps held balls attached and leaves every base clear of the walls", () => {
  const s = createArena(players);
  assert.ok(
    s.bases.every(
      (b) => b.blocks.length === 48 && Math.hypot(b.x - 500, b.y - 500) > 320,
    ),
  );
  control(s, "p0", { steer: 1, radial: 1, launch: false });
  for (let i = 0; i < 10; i++) step(s);
  assert.equal(s.bases[0]!.radius, PADDLE_MAX);
  const base = s.bases[0]!,
    ball = s.balls[0]!;
  assert.ok(
    Math.abs(Math.hypot(ball.x - base.x, ball.y - base.y) - base.radius - 13) <
      1e-8,
  );
  assert.ok(
    Math.abs(ball.x - base.x - Math.cos(base.angle) * (base.radius + 13)) <
      1e-8,
  );
  assert.ok(
    Math.abs(ball.y - base.y - Math.sin(base.angle) * (base.radius + 13)) <
      1e-8,
  );
  control(s, "p0", { steer: 0, radial: -1, launch: false });
  for (let i = 0; i < 10; i++) step(s);
  assert.equal(base.radius, PADDLE_MIN);
  assert.ok(paddleHalf(PADDLE_MIN) > paddleHalf(PADDLE_MAX));
  assert.ok(
    Math.abs(
      paddleHalf(PADDLE_MIN) * PADDLE_MIN - paddleHalf(PADDLE_MAX) * PADDLE_MAX,
    ) < 1e-10,
  );
  for (const b of s.bases)
    for (let a = 0; a < Math.PI * 2; a += 0.1)
      assert.ok(
        insideArena(
          b.x + Math.cos(a) * (PADDLE_MAX + 13),
          b.y + Math.sin(a) * (PADDLE_MAX + 13),
        ),
      );
  assert.deepEqual(decodeArena(encodeArena(s)), s);
});

test("moving radius catches stationary balls from either side and ignores receding faces", () => {
  assert.ok(paddle({ x: 120, y: 0, vx: 0, vy: 0 }, 0, 0, 0, 0, 0.1, 104, 90));
  assert.ok(paddle({ x: 88, y: 0, vx: 0, vy: 0 }, 0, 0, 0, 0, 0.1, 104, -90));
  assert.equal(
    paddle({ x: 120, y: 0, vx: 0, vy: 0 }, 0, 0, 0, 0, 0.1, 104, -90),
    undefined,
  );
});

test("an extending paddle returns a grazing ball once without trapping it or changing speed", () => {
  const s = playing();
  const base = s.bases[0]!,
    ball = s.balls[0]!;
  base.angle = 0;
  base.radial = 1;
  Object.assign(ball, {
    x: base.x + PADDLE + 11,
    y: base.y,
    vx: 20,
    vy: Math.sqrt(BALL_SPEED ** 2 - 20 ** 2),
    held: null,
    owner: "p1",
  });
  let contacts = 0;
  for (let i = 0; i < 5; i++) {
    contacts += step(s).filter((e) => e.kind === "paddle").length;
    assert.ok(Math.hypot(ball.x - base.x, ball.y - base.y) > base.radius + 11);
    assert.ok(Math.abs(Math.hypot(ball.vx, ball.vy) - BALL_SPEED) < 1e-8);
  }
  assert.equal(contacts, 1);
  assert.equal(ball.owner, base.id);
});

test("combined reach and orbit at rounded tips cannot outrun or repeatedly trap a ball", () => {
  for (const steer of [-1, 1] as Steering[])
    for (const radial of [-1, 0, 1] as Steering[])
      for (const radius of [PADDLE_MIN, PADDLE, PADDLE_MAX]) {
        const s = playing();
        const base = s.bases[0]!,
          ball = s.balls[0]!;
        Object.assign(base, { angle: 0, steer, radial, radius });
        const motion = paddleMotion(base);
        const a = steer * paddleHalf(radius),
          dx = Math.cos(a),
          dy = Math.sin(a);
        const nx = -dy * steer,
          ny = dx * steer;
        Object.assign(ball, {
          x: base.x + dx * radius + nx * 11,
          y: base.y + dy * radius + ny * 11,
          vx: nx * 20 + dx * Math.sqrt(BALL_SPEED ** 2 - 400),
          vy: ny * 20 + dy * Math.sqrt(BALL_SPEED ** 2 - 400),
          held: null,
        });
        const speed = Math.hypot(
          motion.radialSpeed,
          Math.abs(motion.omega) * Math.max(radius, motion.radius) +
            Math.abs(motion.radialSpeed) *
              paddleHalf(Math.min(radius, motion.radius)),
        );
        assert.ok(speed <= 300.00001);
        const hits = step(s).filter((e) => e.kind === "paddle");
        assert.equal(
          hits.length,
          1,
          `tip: steer ${steer}, radial ${radial}, radius ${radius}`,
        );
        assert.ok(Math.abs(Math.hypot(ball.vx, ball.vy) - BALL_SPEED) < 1e-8);
      }
});

test("countdown, steering, manual launch and automatic launch have separate rules", () => {
  const s = createArena(players);
  const before = s.bases[0]!.angle;
  control(s, "p0", { steer: 1, radial: 0, launch: true });
  step(s);
  assert.notEqual(s.bases[0]!.angle, before);
  assert.ok(s.balls.every((b) => b.held));
  while (s.tick < COUNTDOWN) step(s);
  control(s, "p0", { steer: 0, radial: 0, launch: true });
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
    x: base.x + PADDLE + 13,
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
    x: base.x + 80,
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
      s.balls.every((b) => Number.isFinite(b.x) && insideArena(b.x, b.y)),
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
  // ball-bros-6: authoritative arena map state, sampled once per second.
  assert.equal(
    hashes.digest("hex"),
    "83f62467a23798a0c606a7c046e3ec78f75a9bb13b1db0d8c97c97653afd61bb",
  );
});

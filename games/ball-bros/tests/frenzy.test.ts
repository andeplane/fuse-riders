import test from "node:test";
import assert from "node:assert/strict";
import {
  BALL_RADIUS,
  BALL_SPEED,
  COUNTDOWN,
  CORE,
  DT,
  FORMATION_OMEGA,
  FORMATION_START,
  FRENZY,
  FRENZY_BALL_INTERVAL,
  LIMIT,
  MAX_BALLS,
  PADDLE_MAX,
  PADDLE_THICK,
  SUBSTEPS,
  createArena,
  formationPosition,
  insideArena,
  placeFormation,
  control,
  type ArenaState,
} from "../src/engine/state.js";
import { step } from "../src/engine/step.js";
import { decodeArena, encodeArena } from "../src/engine/codec.js";
import { botControl } from "../src/engine/bots.js";
import { explode } from "../src/engine/powers.js";
import { view } from "../src/engine/view.js";
import { present } from "../src/app/presenter.js";

const players = Array.from({ length: 5 }, (_, slot) => ({
  id: `p${slot}`,
  name: `Player ${slot}`,
  slot,
  bot: true,
}));
const TAU = Math.PI * 2;

function atTick(tick: number, count = 2): ArenaState {
  const state = createArena(players.slice(0, count));
  state.tick = tick;
  state.formationStep = tick * SUBSTEPS;
  state.phase = "playing";
  placeFormation(state);
  for (const ball of state.balls) {
    const base = state.bases.find((candidate) => candidate.id === ball.held)!;
    ball.x = base.x + Math.cos(base.angle) * (base.radius + 13);
    ball.y = base.y + Math.sin(base.angle) * (base.radius + 13);
    ball.heldUntil = tick + 40;
  }
  return state;
}

test("the rotating formation follows the inset octagon without overlapping defenses", () => {
  const turn = Math.ceil(TAU / (FORMATION_OMEGA * DT));
  for (let count = 2; count <= 5; count++) {
    for (let offset = 0; offset <= turn; offset += 29) {
      const centers = Array.from({ length: count }, (_, index) =>
        formationPosition(count, index, FORMATION_START + offset),
      );
      for (const center of centers)
        for (let angle = 0; angle < TAU; angle += 0.08)
          assert.ok(
            insideArena(
              center.x + Math.cos(angle) * (PADDLE_MAX + 13),
              center.y + Math.sin(angle) * (PADDLE_MAX + 13),
            ),
          );
      const next = formationPosition(count, 0, FORMATION_START + offset + 1);
      assert.ok(
        Math.hypot(next.x - centers[0]!.x, next.y - centers[0]!.y) / DT < 20,
      );
      for (let i = 0; i < centers.length; i++)
        for (let j = i + 1; j < centers.length; j++)
          assert.ok(
            Math.hypot(
              centers[i]!.x - centers[j]!.x,
              centers[i]!.y - centers[j]!.y,
            ) >
              2 * (PADDLE_MAX + 13),
          );
    }
  }
});

test("Frenzy starts on its exact tick, moves held defenses and adds bounded neutral balls", () => {
  const state = atTick(FRENZY - 2),
    before = { x: state.bases[0]!.x, y: state.bases[0]!.y };
  step(state);
  assert.deepEqual({ x: state.bases[0]!.x, y: state.bases[0]!.y }, before);
  const events = step(state);
  assert.equal(state.tick, FRENZY);
  assert.notDeepEqual({ x: state.bases[0]!.x, y: state.bases[0]!.y }, before);
  assert.ok(events.some((event) => event.kind === "frenzy"));
  const pressure = state.balls.at(-1)!;
  assert.equal(state.balls.length, 3);
  assert.equal(pressure.owner, null);
  assert.equal(pressure.held, null);
  assert.ok(Math.abs(Math.hypot(pressure.vx, pressure.vy) - BALL_SPEED) < 1e-8);
  const held = state.balls[0]!,
    base = state.bases[0]!;
  assert.equal(held.held, base.id);
  assert.ok(
    Math.abs(Math.hypot(held.x - base.x, held.y - base.y) - base.radius - 13) <
      1e-8,
  );

  state.tick = FRENZY + FRENZY_BALL_INTERVAL - 1;
  state.formationStep = state.tick * SUBSTEPS;
  placeFormation(state);
  step(state);
  assert.equal(state.balls.length, 4);
  while (state.balls.length < MAX_BALLS)
    state.balls.push({ ...pressure, id: state.balls.length });
  state.tick += FRENZY_BALL_INTERVAL - 1;
  state.formationStep = state.tick * SUBSTEPS;
  placeFormation(state);
  step(state);
  assert.equal(state.balls.length, MAX_BALLS);
});

function translatedContact(kind: "core" | "paddle", ahead: boolean) {
  const state = atTick(FRENZY - 1),
    base = state.bases[0]!,
    ball = state.balls[1]!,
    end = formationPosition(2, 0, state.formationStep + SUBSTEPS),
    dx = end.x - base.x,
    dy = end.y - base.y,
    magnitude = Math.hypot(dx, dy),
    nx = dx / magnitude,
    ny = dy / magnitude;
  base.blocks.forEach((block) => (block.alive = false));
  if (kind === "core") base.stunUntil = FRENZY + 2;
  else base.angle = Math.atan2(ny, nx);
  const radius =
    kind === "core"
      ? CORE + BALL_RADIUS
      : base.radius + PADDLE_THICK + BALL_RADIUS;
  Object.assign(ball, {
    x: base.x + nx * radius * (ahead ? 1 : -1) + nx * (ahead ? 0.25 : -0.25),
    y: base.y + ny * radius * (ahead ? 1 : -1) + ny * (ahead ? 0.25 : -0.25),
    vx: 0,
    vy: 0,
    held: null,
    owner: kind === "paddle" ? null : "p1",
  });
  return { state, base, ball };
}

test("translated cores and paddles sweep into balls and ignore balls they move away from", () => {
  const core = translatedContact("core", true);
  step(core.state);
  assert.equal(core.base.alive, false);
  assert.ok(core.state.formationStep < core.state.tick * SUBSTEPS);
  assert.deepEqual(decodeArena(encodeArena(core.state)), core.state);

  const away = translatedContact("core", false);
  step(away.state);
  assert.equal(away.base.alive, true);

  const paddle = translatedContact("paddle", true);
  const events = step(paddle.state);
  assert.ok(events.some((event) => event.kind === "paddle"));
  assert.equal(paddle.ball.owner, paddle.base.id);
  assert.ok(Number.isFinite(paddle.ball.vx) && Number.isFinite(paddle.ball.vy));
  assert.ok(
    Math.abs(Math.hypot(paddle.ball.vx, paddle.ball.vy) - BALL_SPEED) < 1e-8,
  );
});

test("a translating armor block sweeps a stationary ball before the core", () => {
  const state = atTick(FRENZY - 1),
    base = state.bases[0]!,
    ball = state.balls[1]!,
    end = formationPosition(2, 0, state.formationStep + SUBSTEPS),
    dx = end.x - base.x,
    dy = end.y - base.y,
    magnitude = Math.hypot(dx, dy),
    nx = dx / magnitude,
    ny = dy / magnitude,
    target = base.blocks.reduce((best, block) =>
      block.x * nx + block.y * ny > best.x * nx + best.y * ny ? block : best,
    );
  base.stunUntil = FRENZY + 2;
  Object.assign(ball, {
    x: base.x + target.x + nx * (6 + BALL_RADIUS + 0.25),
    y: base.y + target.y + ny * (6 + BALL_RADIUS + 0.25),
    vx: 0,
    vy: 0,
    held: null,
    owner: null,
  });
  assert.ok(step(state).some((event) => event.kind === "block"));
  assert.equal(target.alive, false);
  assert.equal(base.alive, true);
  assert.ok(Math.abs(Math.hypot(ball.vx, ball.vy) - BALL_SPEED) < 1e-8);
});

test("bomb splash uses each moving base's impact-time center", () => {
  const state = atTick(FRENZY),
    base = state.bases[1]!,
    block = base.blocks[0]!,
    ball = state.balls[0]!,
    shifted = { x: base.x + 50, y: base.y };
  ball.held = null;
  ball.bomb = true;
  ball.x = shifted.x + block.x;
  ball.y = shifted.y + block.y;
  explode(state, ball, [], undefined, new Map([[base.id, shifted]]));
  assert.equal(block.alive, false);
});

test("a Frenzy checkpoint resumes to the same outcomes and HUD warning is authoritative", () => {
  const state = atTick(FRENZY - 101, 5);
  let hud = present(view(state.tick, "match", state), "p0")!;
  assert.equal(hud.toast, "SPACE TO LAUNCH");
  for (const ball of state.balls) {
    ball.held = null;
    ball.vx = BALL_SPEED;
    ball.vy = 0;
  }
  step(state);
  hud = present(view(state.tick, "match", state), "p0")!;
  assert.match(hud.toast, /FUSE FRENZY IN 5/);
  for (let i = 0; i < 100; i++) {
    for (const base of state.bases)
      control(state, base.id, botControl(state, base));
    step(state);
  }
  hud = present(view(state.tick, "match", state), "p0")!;
  assert.match(hud.toast, /BASES ON THE MOVE/);
  const restored = decodeArena(encodeArena(state))!;
  assert.ok(restored);
  const malformed = encodeArena(state);
  malformed[1] = state.formationStep - 1;
  assert.equal(decodeArena(malformed), undefined);
  for (let i = 0; i < 240 && state.phase !== "over"; i++) {
    for (const world of [state, restored]) {
      for (const base of world.bases)
        control(world, base.id, botControl(world, base));
      step(world);
    }
    assert.deepEqual(restored, state);
  }
});

test("timeout checkpoints require the final simulation substep", () => {
  const state = atTick(COUNTDOWN + LIMIT);
  state.phase = "over";
  state.winner = null;
  assert.deepEqual(decodeArena(encodeArena(state)), state);

  state.formationStep--;
  placeFormation(state);
  assert.equal(decodeArena(encodeArena(state)), undefined);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  DISMOUNT_SPEED,
  EAT_STEPS,
  EAT_STEPS_SPEED,
  MAPS,
  MOUNT_WAIT,
  S,
  SNAIL_ACCEL,
  SNAIL_SPEED,
  TICK_HZ,
  UNIT,
  speedy,
  stepRound,
  viewOf,
} from "../src/engine/index.js";
import { resolveCombat } from "../src/engine/combat.js";
import { goalDir, mealSteps } from "../src/engine/snail.js";
import {
  bare,
  controls,
  ofType,
  put,
  run,
  stand,
  unitOf,
} from "./engine-kit.js";

const MAP = MAPS[1];
const TRACK = MAP.snail.y;
const START = MAP.snail.start;
const HOP = (): ReturnType<typeof controls> =>
  controls({ 2: { pressed: true, held: true } });
/** Team 0 rides left, team 1 right. */
const PUSH = (): ReturnType<typeof controls> =>
  controls({ 2: { left: true }, 3: { right: true }, 5: { right: true } });

test("a Worker standing wholly on the snail mounts it, and it crawls toward the rider's goal at 0.8 u/s only while the rider holds that way", () => {
  assert.equal(SNAIL_SPEED, Math.round((0.8 * UNIT) / TICK_HZ));
  const state = bare();
  const worker = stand(state, 2, START + 6, TRACK);
  stepRound(state, []);
  assert.deepEqual(state.events, [{ type: "snailMount", slot: 2 }]);
  assert.equal(worker.riding, true);
  assert.equal(state.snail.rider, 2);
  assert.equal(state.snail.facing, -1);
  assert.equal(goalDir(0), -1);
  assert.equal(goalDir(1), 1);
  const from = state.snail.x;
  // Not holding, or holding the wrong way: it stays.
  run(state, 20);
  run(state, 20, () => controls({ 2: { right: true } }));
  assert.equal(state.snail.x, from);
  // It picks up speed at 2.6 u/s² and then holds 0.8 u/s (8.8 px/s).
  stepRound(state, PUSH());
  assert.equal(state.snail.vx, -SNAIL_ACCEL);
  run(state, 30, PUSH);
  assert.equal(state.snail.vx, -SNAIL_SPEED);
  const cruising = state.snail.x;
  run(state, 60, PUSH);
  assert.equal(state.snail.x, cruising - 60 * SNAIL_SPEED);
  assert.ok(Math.abs((cruising - state.snail.x) / S - 8.8) < 0.1);
  assert.equal(worker.x, state.snail.x);
  // Letting go stops it dead.
  stepRound(state, []);
  assert.equal(state.snail.vx, 0);
});

test("the other team rides it the other way, and a speed rider is 1.3 times as fast", () => {
  const state = bare();
  stand(state, 3, START, TRACK, { speed: true });
  stepRound(state, []);
  run(state, 40, PUSH);
  const from = state.snail.x;
  run(state, 20, PUSH);
  assert.equal(state.snail.x, from + 20 * speedy(SNAIL_SPEED, true));
  assert.equal(speedy(SNAIL_SPEED, true), Math.trunc((SNAIL_SPEED * 13) / 10));
  assert.equal(state.snail.facing, 1);
});

test("a Worker half off the snail, in the air, in a gate or just dismounted does not mount; a carrier does, keeping its berry", () => {
  const state = bare();
  stand(state, 2, START + 12, TRACK);
  put(state, 4, START, TRACK - 30);
  stepRound(state, []);
  assert.equal(state.snail.rider, -1);
  assert.equal(state.snail.vx, 0);
  const waiting = bare();
  const carrier = stand(waiting, 2, START, TRACK, {
    mountWait: 5,
    carrying: true,
  });
  run(waiting, 4);
  assert.equal(waiting.snail.rider, -1);
  run(waiting, 2);
  assert.equal(waiting.snail.rider, 2);
  assert.equal(carrier.carrying, true);
});

test("the button hops off the snail at 45 degrees, and nothing is banked: the enemy can ride it back", () => {
  const state = bare();
  const worker = stand(state, 2, START, TRACK);
  run(state, 240, PUSH);
  const reached = state.snail.x;
  assert.ok(reached < START * S);
  stepRound(state, HOP());
  assert.equal(worker.riding, false);
  assert.equal(state.snail.rider, -1);
  // Back the way it came, unless a direction is held.
  assert.deepEqual([worker.vx, worker.vy], [DISMOUNT_SPEED, -DISMOUNT_SPEED]);
  assert.equal(worker.mountWait, MOUNT_WAIT);
  assert.equal(state.snail.x, reached);
  worker.x = 100 * S;
  stand(state, 3, reached / S, TRACK);
  run(state, 120, PUSH);
  assert.equal(state.snail.rider, 3);
  assert.ok(state.snail.x > reached);
  const held = bare();
  const rider = stand(held, 2, START, TRACK);
  stepRound(held, []);
  stepRound(held, controls({ 2: { pressed: true, left: true } }));
  assert.equal(rider.vx, -DISMOUNT_SPEED);
  assert.equal(rider.facing, -1);
  const right = bare();
  const other = stand(right, 3, START, TRACK);
  stepRound(right, []);
  stepRound(right, controls({ 3: { pressed: true } }));
  assert.equal(other.vx, -DISMOUNT_SPEED);
});

test("the snail catches an enemy Worker at its mouth, halts for a 5 s meal and then kills it; the rider cannot hop off meanwhile", () => {
  assert.deepEqual([EAT_STEPS, EAT_STEPS_SPEED], [300, 210]);
  const state = bare();
  const rider = stand(state, 2, START, TRACK);
  stepRound(state, []);
  const victim = stand(state, 3, state.snail.x / S - 14, TRACK, {
    carrying: true,
    invuln: 50,
  });
  stepRound(state, PUSH());
  assert.deepEqual(
    state.events.map((event) => event.type),
    ["berryDrop", "snailCatch"],
  );
  assert.deepEqual(ofType(state.events, "snailCatch"), [
    { type: "snailCatch", victim: 3, rider: 2 },
  ]);
  assert.equal(victim.eaten, true);
  assert.equal(victim.invuln, 0);
  assert.equal(state.snail.victim, 3);
  assert.equal(state.snail.eat, EAT_STEPS);
  assert.equal(viewOf(state).snail.eating, 0);
  state.loose.length = 0;
  const halted = state.snail.x;
  const mouth = victim.x;
  // The eaten Worker cannot move or jump, and the rider's button does nothing.
  const during = run(state, EAT_STEPS - 1, () =>
    controls({
      2: { left: true, pressed: true },
      3: { right: true, pressed: true },
    }),
  );
  assert.deepEqual(during, []);
  assert.equal(rider.riding, true);
  assert.equal(state.snail.x, halted);
  assert.equal(victim.x, mouth);
  assert.ok(viewOf(state).snail.eating > 0.99);
  stepRound(state, []);
  assert.deepEqual(state.events, [
    { type: "snailEat", victim: 3, rider: 2 },
    { type: "kill", victim: 3, killer: 2 },
  ]);
  assert.equal(victim.dead, true);
  assert.equal(victim.eaten, false);
  assert.equal(state.snail.victim, -1);
  run(state, 2, PUSH);
  assert.ok(state.snail.x < halted);
});

test("a speed rider's snail eats in 3.5 s, and teammates, Warriors and Workers that just got away are not eaten", () => {
  const state = bare();
  const rider = stand(state, 2, START, TRACK, { speed: true });
  stepRound(state, []);
  assert.equal(mealSteps(rider), EAT_STEPS_SPEED);
  assert.equal(mealSteps(undefined), EAT_STEPS);
  const at = state.snail.x / S - 14;
  stand(state, 4, at, TRACK, { mountWait: 1000 });
  stand(state, 3, at, TRACK, { kind: "warrior", invuln: 1000 });
  stand(state, 5, at, TRACK, { mountWait: 1000 });
  stepRound(state, []);
  assert.equal(state.snail.victim, -1);
  unitOf(state, 5).mountWait = 0;
  stepRound(state, []);
  assert.equal(state.snail.victim, 5);
  assert.equal(state.snail.eat, EAT_STEPS_SPEED);
});

test("killing the rider frees the Worker in the snail's mouth, in front of the head and safe from it for a moment", () => {
  const state = bare();
  const rider = stand(state, 2, START, TRACK);
  stepRound(state, []);
  const meal = stand(state, 3, state.snail.x / S - 14, TRACK);
  run(state, 20);
  assert.equal(meal.eaten, true);
  // The meal itself is out of combat.
  put(state, 5, state.snail.x / S + 9, TRACK, {
    kind: "warrior",
    attack: 3,
    dashing: true,
    facing: -1,
  });
  state.events = [];
  resolveCombat(state);
  assert.deepEqual(
    state.events.map((event) => event.type),
    ["snailFree", "kill"],
  );
  assert.equal(rider.dead, true);
  assert.equal(rider.riding, false);
  assert.equal(state.snail.rider, -1);
  assert.equal(state.snail.victim, -1);
  assert.equal(meal.eaten, false);
  assert.equal(meal.mountWait, MOUNT_WAIT);
  assert.ok(meal.x < state.snail.x);
  assert.ok(meal.ground >= 0);
  // With no rider there is nobody to free.
  put(state, 5, 100, 100, { dead: true, respawn: 1000 });
  assert.deepEqual(run(state, 3), []);
});

test("riding the snail to its goal is a snail victory", () => {
  const state = bare();
  state.snail.x = MAP.snail.goals[1] * S - 2 * SNAIL_SPEED;
  stand(state, 5, state.snail.x / S, TRACK);
  const events = run(state, 40, PUSH);
  assert.deepEqual(ofType(events, "victory"), [
    { type: "victory", team: 1, kind: "snail" },
  ]);
  assert.deepEqual(state.winner, { team: 1, kind: "snail" });
});

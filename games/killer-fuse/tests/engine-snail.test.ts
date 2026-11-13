import test from "node:test";
import assert from "node:assert/strict";
import {
  EAT_STEPS,
  FREED_INVULN,
  MAPS,
  MOUNT_WAIT,
  S,
  SNAIL_SPEED,
  SPEED_DEN,
  SPEED_NUM,
  speedy,
  stepRound,
} from "../src/engine/index.js";
import { goalDir } from "../src/engine/snail.js";
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

test("a Worker who touches the snail on the floor mounts it and rides it toward its own goal at 5.6 px/s", () => {
  const state = bare();
  const worker = stand(state, 2, START + 6, TRACK);
  stepRound(state, []);
  assert.deepEqual(state.events, [{ type: "snailMount", slot: 2 }]);
  assert.equal(worker.riding, true);
  assert.equal(state.snail.rider, 2);
  assert.equal(state.snail.facing, -1);
  const from = state.snail.x;
  run(state, 60);
  assert.equal(state.snail.x, from - 60 * SNAIL_SPEED);
  assert.ok(Math.abs((from - state.snail.x) / S - 5.6) < 0.1);
  assert.equal(worker.x, state.snail.x);
  assert.equal(goalDir(0), -1);
  assert.equal(goalDir(1), 1);
});

test("the other team rides it the other way, and a speed rider is 1.35 times as fast", () => {
  const state = bare();
  stand(state, 3, START, TRACK, { speed: true });
  stepRound(state, []);
  const from = state.snail.x;
  run(state, 20);
  assert.equal(state.snail.x, from + 20 * speedy(SNAIL_SPEED, true));
  assert.equal(state.snail.facing, 1);
});

test("a Worker carrying a berry, in the air or just dismounted does not mount", () => {
  const state = bare();
  stand(state, 2, START, TRACK, { carrying: true });
  put(state, 4, START, TRACK - 30);
  stepRound(state, []);
  assert.equal(state.snail.rider, -1);
  const waiting = bare();
  stand(waiting, 2, START, TRACK, { mountWait: 5 });
  run(waiting, 4);
  assert.equal(waiting.snail.rider, -1);
  run(waiting, 2);
  assert.equal(waiting.snail.rider, 2);
});

test("the button hops off the snail, and nothing is banked: the enemy can ride it back", () => {
  const state = bare();
  const worker = stand(state, 2, START, TRACK);
  run(state, 120);
  const reached = state.snail.x;
  assert.ok(reached < START * S);
  stepRound(state, HOP());
  assert.equal(worker.riding, false);
  assert.equal(state.snail.rider, -1);
  assert.ok(worker.vy < 0);
  assert.equal(worker.mountWait, MOUNT_WAIT);
  assert.equal(state.snail.x, reached);
  worker.x = 100 * S;
  stand(state, 3, reached / S, TRACK);
  run(state, 60);
  assert.equal(state.snail.rider, 3);
  assert.ok(state.snail.x > reached);
});

test("the snail catches an enemy Worker in front of its mouth, halts for the meal and then kills it", () => {
  const state = bare();
  stand(state, 2, START, TRACK);
  stepRound(state, []);
  const victim = stand(state, 3, state.snail.x / S - 14, TRACK);
  stepRound(state, []);
  assert.equal(victim.eaten, true);
  assert.equal(state.snail.victim, 3);
  assert.equal(state.snail.eat, EAT_STEPS);
  const halted = state.snail.x;
  // The eaten Worker cannot move, jump or be anything but eaten.
  const during = run(state, EAT_STEPS - 1, () =>
    controls({ 3: { right: true, pressed: true } }),
  );
  assert.deepEqual(during, []);
  assert.equal(state.snail.x, halted);
  assert.equal(victim.x, (halted / S - 14) * S);
  stepRound(state, []);
  assert.deepEqual(state.events, [
    { type: "snailEat", victim: 3, rider: 2 },
    { type: "kill", victim: 3, killer: 2 },
  ]);
  assert.equal(victim.dead, true);
  assert.equal(victim.eaten, false);
  assert.equal(state.snail.victim, -1);
  stepRound(state, []);
  assert.ok(state.snail.x < halted);
});

test("a speed rider's snail eats 1.35 times faster, and teammates and Warriors are not eaten", () => {
  const state = bare();
  stand(state, 2, START, TRACK, { speed: true });
  stepRound(state, []);
  stand(state, 4, state.snail.x / S - 14, TRACK, { mountWait: 1000 });
  stepRound(state, []);
  assert.equal(state.snail.victim, -1);
  unitOf(state, 4).x = 60 * S;
  stand(state, 3, state.snail.x / S - 14, TRACK);
  stepRound(state, []);
  assert.equal(
    state.snail.eat,
    Math.trunc((EAT_STEPS * SPEED_DEN) / SPEED_NUM),
  );
});

test("hopping off or losing the rider frees the Worker in the snail's mouth", () => {
  const state = bare();
  stand(state, 2, START, TRACK);
  stepRound(state, []);
  const victim = stand(state, 3, state.snail.x / S - 14, TRACK);
  run(state, 20);
  assert.equal(victim.eaten, true);
  stepRound(state, HOP());
  assert.deepEqual(state.events, [{ type: "snailFree", victim: 3 }]);
  assert.equal(victim.eaten, false);
  assert.equal(victim.invuln, FREED_INVULN);
  assert.equal(victim.mountWait, MOUNT_WAIT);
  assert.equal(state.snail.victim, -1);

  const killed = bare();
  const rider = stand(killed, 2, START, TRACK);
  stepRound(killed, []);
  const meal = stand(killed, 3, killed.snail.x / S - 14, TRACK);
  run(killed, 20);
  put(killed, 1, killed.snail.x / S, TRACK - 4);
  stepRound(killed, []);
  assert.deepEqual(
    killed.events.map((event) => event.type),
    ["snailFree", "kill"],
  );
  assert.equal(rider.dead, true);
  assert.equal(rider.riding, false);
  assert.equal(killed.snail.rider, -1);
  assert.equal(meal.eaten, false);
});

test("riding the snail to its goal is a snail victory", () => {
  const state = bare();
  state.snail.x = MAP.snail.goals[1] * S - 2 * SNAIL_SPEED;
  stand(state, 5, state.snail.x / S, TRACK);
  const events = run(state, 3);
  assert.deepEqual(ofType(events, "victory"), [
    { type: "victory", team: 1, kind: "snail" },
  ]);
  assert.deepEqual(state.winner, { team: 1, kind: "snail" });
});

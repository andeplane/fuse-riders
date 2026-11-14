import test from "node:test";
import assert from "node:assert/strict";
import {
  S,
  TICK_HZ,
  TIME_LIMIT,
  arenaOf,
  createRound,
  hashRound,
  stepRound,
  timedOut,
  viewOf,
  type Round,
} from "../src/engine/index.js";
import { firstTeam } from "../src/engine/units.js";
import { ALL_HUMANS, ofType } from "./engine-kit.js";

/** A round nobody touches, one step short of the limit. */
function lastStep(seed = 7): Round {
  const state = createRound({ seed, humans: ALL_HUMANS });
  state.step = TIME_LIMIT - 1;
  return state;
}

test("the clock counts down five minutes in whole seconds and the last step of play is still played", () => {
  const state = createRound({ seed: 7, humans: ALL_HUMANS });
  assert.equal(TIME_LIMIT, 300 * TICK_HZ);
  assert.equal(viewOf(state).timeLeft, 300);
  stepRound(state, []);
  assert.equal(viewOf(state).timeLeft, 300);
  state.step = TIME_LIMIT - TICK_HZ;
  assert.equal(viewOf(state).timeLeft, 1);
  state.step = TIME_LIMIT - 1;
  assert.equal(viewOf(state).timeLeft, 1);
  stepRound(state, []);
  assert.equal(state.step, TIME_LIMIT);
  assert.equal(state.winner, null);
  assert.equal(timedOut(state), false);
  assert.deepEqual([viewOf(state).timeLeft, viewOf(state).timeUp], [0, false]);
});

test("time up: more Queen eggs wins before anything else, and the round then stays frozen", () => {
  const state = lastStep();
  state.eggs = [1, 2];
  state.holes[0]!.fill(true, 0, 5);
  state.snail.x = arenaOf(1).snail.goals[0] + 20 * S;
  stepRound(state, []);
  assert.equal(state.winner, null);
  stepRound(state, []);
  assert.deepEqual(state.winner, { team: 1, kind: "military" });
  assert.deepEqual(state.events, [
    { type: "victory", team: 1, kind: "military" },
  ]);
  assert.equal(state.step, TIME_LIMIT + 1);
  assert.equal(timedOut(state), true);
  const view = viewOf(state);
  assert.deepEqual([view.timeLeft, view.timeUp], [0, true]);
  const frozen = hashRound(state);
  stepRound(state, []);
  assert.equal(hashRound(state), frozen);
  assert.deepEqual(state.events, []);
});

test("time up with eggs level: more berries banked wins, whatever the snail did", () => {
  const state = lastStep();
  state.holes[0]![3] = true;
  state.holes[0]![7] = true;
  state.holes[1]![0] = true;
  state.snail.x = arenaOf(1).snail.goals[1] - 20 * S;
  stepRound(state, []);
  stepRound(state, []);
  assert.deepEqual(state.winner, { team: 0, kind: "economy" });
  assert.equal(viewOf(state).timeUp, true);
});

test("time up with eggs and berries level: the team the snail is closer to wins", () => {
  for (const team of [0, 1]) {
    const state = lastStep();
    state.snail.x = arenaOf(1).snail.start + (team === 0 ? -S : S);
    stepRound(state, []);
    stepRound(state, []);
    assert.deepEqual(state.winner, { team, kind: "snail" });
    assert.deepEqual(ofType(state.events, "victory"), [
      { type: "victory", team, kind: "snail" },
    ]);
  }
});

test("time up in a dead heat: the seed's coin decides, for either team over a few seeds", () => {
  const winners = new Set<number>();
  for (let seed = 1; seed <= 12; seed += 1) {
    const state = lastStep(seed);
    stepRound(state, []);
    assert.equal(state.snail.x, arenaOf(1).snail.start);
    stepRound(state, []);
    assert.deepEqual(state.winner, { team: firstTeam(state), kind: "snail" });
    winners.add(firstTeam(state));
    const again = lastStep(seed);
    stepRound(again, []);
    stepRound(again, []);
    assert.equal(hashRound(again), hashRound(state));
  }
  assert.deepEqual([...winners].sort(), [0, 1]);
});

test("a victory on the very last step of play is a victory, not the clock's", () => {
  const state = lastStep();
  state.eggs = [3, 0];
  stepRound(state, []);
  assert.deepEqual(state.winner, { team: 0, kind: "military" });
  assert.equal(state.step, TIME_LIMIT);
  assert.equal(timedOut(state), false);
  assert.equal(viewOf(state).timeUp, false);
});

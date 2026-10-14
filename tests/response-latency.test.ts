import test from "node:test";
import assert from "node:assert/strict";
import {
  responseLatencies,
  withinLatencyBudget,
  type ControlSample,
  type SteeringInput,
} from "../scripts/lib/response-latency.js";
const sample = (epochAt: number, left: boolean, round = 1): ControlSample => ({
  epochAt,
  matchId: "m",
  round,
  phase: "playing",
  players: [{ id: "a", alive: true, heldMotion: { left, right: false } }],
});
const input = (epochAt: number, left: boolean): SteeringInput => ({
  epochAt,
  left,
  right: false,
  matchId: "m",
  round: 1,
  sent: true,
  steeringChanged: true,
});
test("latency matches applied press and release controls, rather than arbitrary motion", () => {
  const result = responseLatencies(
    [input(10, true), input(100, false)],
    [sample(0, false)],
    [sample(0, false), sample(20, false), sample(50, true), sample(130, false)],
    "a",
  );
  assert.deepEqual(result, {
    press: [40],
    release: [30],
    eligible: 2,
    timedOut: 0,
  });
});

test("an always-neutral observer cannot falsely acknowledge release of a missed press", () => {
  assert.deepEqual(
    responseLatencies(
      [input(10, true), input(100, false)],
      [sample(0, false)],
      [sample(0, false), sample(50, false), sample(110, false)],
      "a",
    ),
    { press: [], release: [], eligible: 2, timedOut: 2 },
  );
});
test("a benchmark needs real observations and enforces the unrounded timeout ratio", () => {
  const good = {
    playingRider: true,
    ownInputs: 4,
    eligible: 20,
    timedOut: 0,
    p95: 100,
  };
  assert.equal(withinLatencyBudget(good), true);
  assert.equal(
    withinLatencyBudget({ ...good, ownInputs: 0, eligible: 0, p95: null }),
    false,
  );
  assert.equal(
    withinLatencyBudget({ ...good, ownInputs: 1, eligible: 1, timedOut: 1 }),
    false,
  );
  assert.equal(withinLatencyBudget({ ...good, timedOut: 5 }), false);
  assert.equal(withinLatencyBudget({ ...good, p95: 700 }), false);
  assert.equal(
    withinLatencyBudget({ ...good, playingRider: false, ownInputs: 0 }),
    true,
  );
});
test("missing, late, superseded and foreign-round responses count as timeouts", () => {
  assert.deepEqual(
    responseLatencies(
      [input(10, true), input(100, false)],
      [sample(0, false)],
      [sample(20, true, 2), sample(150, true), sample(2200, false)],
      "a",
    ),
    { press: [], release: [], eligible: 2, timedOut: 2 },
  );
});
test("unaccepted inputs, unchanged controls and inputs outside live play are ineligible", () => {
  assert.equal(
    responseLatencies(
      [
        { ...input(10, true), sent: false },
        { ...input(20, true), steeringChanged: false },
      ],
      [sample(0, false)],
      [],
      "a",
    ).eligible,
    0,
  );
  assert.equal(
    responseLatencies(
      [input(10, true)],
      [{ ...sample(0, false), phase: "lobby" }],
      [],
      "a",
    ).eligible,
    0,
  );
});

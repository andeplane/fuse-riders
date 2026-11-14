import test from "node:test";
import assert from "node:assert/strict";
import {
  MAPS,
  S,
  SNAIL_ACCEL,
  stepRound,
  type Round,
} from "../src/engine/index.js";
import { firstTeam } from "../src/engine/units.js";
import { bare, controls, ofType, put, stand } from "./engine-kit.js";

const MAP = MAPS[1];
const FLOOR = 265;
const SWING = { kind: "warrior", attack: 3, dashing: true } as const;

/** Winds the round to the step before one whose coin falls for `team`. */
function beforeCoin(state: Round, team: number): void {
  for (state.step = 1; firstTeam(state) !== team; state.step += 1);
  state.step -= 1;
}

/** Team 1's Queen, on her last egg, meets team 0's sword this step. */
function lastEgg(state: Round): void {
  state.eggs[1] = 1;
  stand(state, 1, 330, FLOOR, { invuln: 0 });
  put(state, 2, 322, FLOOR, { ...SWING, facing: 1 });
}

/** A loose berry drops into the one open hole of `team`'s hive this step. */
function lastHole(state: Round, team: 0 | 1): void {
  const holes = state.holes[team];
  assert.ok(holes);
  holes.fill(true);
  holes[4] = false;
  const target = MAP.holes[team][4];
  assert.ok(target);
  state.loose.push({
    x: target.x * S,
    y: (target.y + 2) * S,
    vx: 0,
    vy: 0,
    resting: false,
    wait: 0,
    by: 3,
  });
}

test("a last-egg kill and a last-hole fill on the same step: the step's coin decides, whatever the kinds", () => {
  for (const coin of [0, 1]) {
    const state = bare();
    beforeCoin(state, coin);
    lastEgg(state);
    lastHole(state, 1);
    stepRound(state, []);
    assert.equal(ofType(state.events, "queenKill").length, 1);
    assert.equal(ofType(state.events, "berryKickIn").length, 1);
    assert.deepEqual(
      state.winner,
      coin === 0 ? { team: 0, kind: "military" } : { team: 1, kind: "economy" },
    );
    assert.deepEqual(state.events.at(-1), {
      type: "victory",
      ...state.winner,
    });
  }
});

test("one team taking two victories on one step wins by military before economy", () => {
  for (const coin of [0, 1]) {
    const state = bare();
    beforeCoin(state, coin);
    lastEgg(state);
    lastHole(state, 0);
    stepRound(state, []);
    assert.deepEqual(state.winner, { team: 0, kind: "military" });
  }
});

test("the snail's arrival against a last-hole fill on the same step goes to the coin too", () => {
  for (const coin of [0, 1]) {
    const state = bare();
    beforeCoin(state, coin);
    const goal = MAP.snail.goals[1] * S;
    state.snail.x = goal - Math.trunc(SNAIL_ACCEL / 2);
    stand(state, 5, state.snail.x / S, MAP.snail.y);
    lastHole(state, 0);
    stepRound(state, controls({ 5: { right: true } }));
    assert.deepEqual(
      state.events.map((event) => event.type),
      ["snailMount", "berryKickIn", "victory"],
    );
    assert.deepEqual(
      state.winner,
      coin === 0 ? { team: 0, kind: "economy" } : { team: 1, kind: "snail" },
    );
  }
});

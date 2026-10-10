import test from "node:test";
import assert from "node:assert/strict";
import { RoundRunner } from "../src/app/round-runner.js";
import { FIRE, LEFT, RIGHT } from "../src/engine/index.js";

const STEP_MS = 1000 / 60;

test("the runner steps the engine at 60 Hz from frame times and carries the remainder", () => {
  const runner = new RoundRunner({ seed: 1, seats: [null, null] });
  runner.advance(STEP_MS * 2.5);
  assert.equal(runner.view.tick, 2);
  runner.advance(STEP_MS * 0.6);
  assert.equal(runner.view.tick, 3);
  runner.advance(10_000); // a stalled tab does not fast-forward the whole gap
  assert.ok(runner.view.tick <= 3 + 6);
});

test("humans steer with held directions and fire only on latched presses; the engine plays the bot seats", () => {
  const asked: number[] = [];
  let humanPresses = 0;
  const runner = new RoundRunner({
    seed: 2,
    seats: [null, "hard"],
    input: {
      takePresses: (slots) => {
        assert.equal(slots, 2);
        return [++humanPresses === 90, false];
      },
      // Fire is held all along (through the countdown, say): only the latched press fires.
      heldBits: (slot) => {
        asked.push(slot);
        return RIGHT | FIRE;
      },
    },
  });
  const x = runner.view.castles[0]?.x ?? 0;
  const fired: number[] = [];
  for (let i = 0; i < 100; i++)
    for (const event of runner.advance(STEP_MS))
      if (event.type === "fired") fired.push(event.castleId);
  assert.ok(asked.length >= 100 && asked.every((slot) => slot === 0));
  assert.deepEqual(runner.view.config.bots, [{ id: 1, difficulty: "hard" }]);
  assert.deepEqual(
    fired.filter((id) => id === 0),
    [0],
  );
  assert.ok((runner.view.castles[0]?.x ?? 0) > x + 100, "flew right");
});

test("real bots fire, the result is recorded as the round ends, and the next round follows", () => {
  const runner = new RoundRunner({
    seed: 3,
    seats: ["hard", "easy"],
    tuning: { castleHp: [0, 0, 12, 12, 12, 12, 12], fuseTime: 20 },
    aftermath: 0.5,
  });
  const first = runner.view;
  const fired = new Set<number>();
  let recordedAtEnd = false;
  for (let i = 0; i < 60 * 200 && runner.view === first; i++)
    for (const event of runner.advance(STEP_MS)) {
      if (event.type === "fired") fired.add(event.castleId);
      if (event.type === "round-over")
        recordedAtEnd = runner.match.history.length === 1;
    }
  assert.deepEqual([...fired].sort(), [0, 1], "both bots fired");
  assert.ok(recordedAtEnd, "the match saw the result as the round ended");
  assert.notEqual(runner.view, first, "a new round started");
  assert.equal(runner.view.tick, 1);
  assert.equal(runner.view.config.bots?.length, 2, "the bots play on");
  assert.equal(runner.match.history.length, 1);
});

test("with an infinite aftermath the runner holds a finished round until nextRound()", () => {
  const runner = new RoundRunner({
    seed: 4,
    seats: ["hard", "hard"],
    tuning: { castleHp: [0, 0, 8, 8, 8, 8, 8], fuseTime: 10 },
    aftermath: Infinity,
    winsToWin: 1,
  });
  const first = runner.view;
  for (let i = 0; i < 60 * 300 && !first.result; i++) runner.advance(STEP_MS);
  for (let i = 0; i < 600; i++) runner.advance(STEP_MS);
  assert.ok(first.result, "the round ended");
  assert.equal(runner.view, first, "still the finished round");
  const winner = first.result.winner;
  assert.equal(runner.match.winner, winner);
  runner.nextRound();
  assert.notEqual(runner.view, first);
  if (winner !== null)
    assert.equal(runner.match.history.length, 0, "a decided match restarts");
});

test("a NaN, infinite or negative frame time counts as no time and does not freeze the loop", () => {
  const runner = new RoundRunner({ seed: 4, seats: [null, null] });
  runner.advance(STEP_MS * 1.5);
  assert.equal(runner.view.tick, 1);
  for (const bad of [NaN, Infinity, -Infinity, -STEP_MS * 3]) {
    runner.advance(bad);
    assert.equal(runner.view.tick, 1, `${bad} advances nothing`);
  }
  runner.advance(STEP_MS * 0.6); // the half step carried from before still counts
  assert.equal(runner.view.tick, 2);
  runner.advance(STEP_MS);
  assert.equal(runner.view.tick, 3);
});

test("one advance never spans two rounds: the next round starts on the following frame", () => {
  let frame: number[] = [];
  const runner: RoundRunner = new RoundRunner({
    seed: 5,
    seats: [null, "hard"],
    // The human's input is asked for once a step: note the tick it is asked on.
    input: {
      takePresses: () => [],
      heldBits: () => (frame.push(runner.view.tick), 0),
    },
    tuning: { castleHp: [0, 0, 12, 12, 12, 12, 12], fuseTime: 20 },
    aftermath: 0.5,
  });
  let current = runner.view;
  let restarts = 0;
  for (let i = 0; i < 60 * 40 && restarts < 2; i++) {
    frame = [];
    const events = runner.advance(STEP_MS * 6); // the most steps one frame runs
    const ticks = frame;
    for (let k = 1; k < ticks.length; k++)
      assert.ok(ticks[k]! > ticks[k - 1]!, `frame ${i} spans a restart`);
    for (const event of events)
      assert.ok(ticks.includes(event.tick), `${event.type} is from this frame`);
    if (runner.view === current) continue;
    restarts++;
    current = runner.view;
    // Every step of this frame ran in the new round, so its events are new-round events.
    assert.equal(ticks[0], 0);
    assert.equal(runner.view.tick, ticks.length);
  }
  assert.equal(restarts, 2, "rounds finished and restarted");
});

test("a bots-only round fast-forwards once the humans are out, unless a human ghost keeps flying or firing", () => {
  let steer = 0;
  const runner = new RoundRunner({
    seed: 6,
    seats: [null, "hard", "hard", "hard"],
    input: { takePresses: () => [false], heldBits: () => steer },
    // Steady sudden-death bombs and the bots wear everyone down; with this seed the human, who does not fly,
    // falls first and the bots play on.
    tuning: {
      fuseTime: 1,
      castleHp: [0, 0, 60, 60, 60, 60, 60],
      bombIntervalStart: 0.3,
      bombIntervalMin: 0.3,
      damageRampTime: 1e6,
    },
  });
  const round = runner.view;
  for (let i = 0; i < 60 * 180 && round.castles[0]?.alive; i++) {
    runner.advance(STEP_MS);
    assert.equal(runner.speed, 1, "1× while the human's castle stands");
  }
  assert.ok(!round.castles[0]?.alive && !round.result, "the human is out");
  const out = round.tick;
  while (round.tick - out < 60 * 4.5) runner.advance(STEP_MS);
  assert.equal(runner.speed, 1, "a moment to notice the ghost");
  while (round.tick - out < 60 * 9 && !round.result) runner.advance(STEP_MS);
  assert.equal(runner.speed, 2, "then the bots finish at double speed");
  steer = LEFT;
  runner.advance(STEP_MS);
  steer = 0;
  for (let i = 0; i < 20; i++) runner.advance(STEP_MS);
  assert.equal(runner.speed, 1, "a human ghost flying brings back 1×");
  assert.ok(!runner.botsOnly);
});

test("matches without humans never fast-forward", () => {
  const runner = new RoundRunner({
    seed: 7,
    seats: ["hard", "hard", "hard"],
  });
  for (let i = 0; i < 60 * 60; i++) runner.advance(STEP_MS);
  assert.equal(runner.speed, 1);
});

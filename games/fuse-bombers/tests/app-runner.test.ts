import test from "node:test";
import assert from "node:assert/strict";
import { createBotPlayer, type Bot } from "../src/app/bot.js";
import { RoundRunner } from "../src/app/round-runner.js";

const STEP_MS = 1000 / 60;
const idle: Bot = () => false;

test("the runner steps the engine at 60 Hz from frame times and carries the remainder", () => {
  const runner = new RoundRunner({ seed: 1, controllers: [idle, idle] });
  runner.advance(STEP_MS * 2.5);
  assert.equal(runner.view.tick, 2);
  runner.advance(STEP_MS * 0.6);
  assert.equal(runner.view.tick, 3);
  runner.advance(10_000); // a stalled tab does not fast-forward the whole gap
  assert.ok(runner.view.tick <= 3 + 6);
});

test("the runner asks bots per step and takes human presses from the input source", () => {
  const asked: number[] = [];
  const bot: Bot = (view, id) => {
    asked.push(id);
    return view.tick === 80;
  };
  let humanPresses = 0;
  const runner = new RoundRunner({
    seed: 2,
    controllers: [null, bot],
    input: {
      takePresses: (slots) => {
        assert.equal(slots, 2);
        return [++humanPresses === 90, false];
      },
    },
  });
  const fired: number[] = [];
  for (let i = 0; i < 100; i++)
    for (const event of runner.advance(STEP_MS))
      if (event.type === "fired") fired.push(event.castleId);
  assert.ok(asked.length >= 100 && asked.every((id) => id === 1));
  assert.deepEqual(fired, [1, 0]);
});

test("real bots fire, the result is recorded as the round ends, and the next round follows", () => {
  const runner = new RoundRunner({
    seed: 3,
    controllers: [createBotPlayer("hard", 0, 1), createBotPlayer("easy", 1, 2)],
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
  assert.equal(runner.match.history.length, 1);
});

test("with an infinite aftermath the runner holds a finished round until nextRound()", () => {
  const runner = new RoundRunner({
    seed: 4,
    controllers: [createBotPlayer("hard", 0, 1), createBotPlayer("hard", 1, 2)],
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
  const runner = new RoundRunner({ seed: 4, controllers: [idle, idle] });
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
  const watcher: Bot = (view) => {
    frame.push(view.tick);
    return false;
  };
  const runner = new RoundRunner({
    seed: 5,
    controllers: [watcher, createBotPlayer("hard", 1, 1)],
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

test("a bots-only round fast-forwards once the humans are out, unless a human ghost keeps pressing", () => {
  let press = false;
  const runner = new RoundRunner({
    seed: 6,
    controllers: [null, 1, 2, 3].map((id) =>
      id === null ? null : createBotPlayer("hard", id, id),
    ),
    input: { takePresses: () => [press] },
  });
  const round = runner.view;
  // The idle human never presses, so the bots knock its castle out sooner or later.
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
  press = true;
  runner.advance(STEP_MS);
  press = false;
  for (let i = 0; i < 20; i++) runner.advance(STEP_MS);
  assert.equal(runner.speed, 1, "a human ghost pressing brings back 1×");
  assert.ok(!runner.botsOnly);
});

test("matches without humans never fast-forward", () => {
  const runner = new RoundRunner({
    seed: 7,
    controllers: [0, 1, 2].map((id) => createBotPlayer("hard", id, id)),
  });
  for (let i = 0; i < 60 * 60; i++) runner.advance(STEP_MS);
  assert.equal(runner.speed, 1);
});

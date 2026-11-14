import test from "node:test";
import assert from "node:assert/strict";
import { MAX_PLAYERS } from "../src/engine/index.js";
import {
  LINGER_TICKS,
  LOOP_TICKS,
  STEPS_PER_ADVANCE,
  createAttractMatch,
} from "../src/app/attract-match.js";

const DEMO = { seed: 4242, botLevel: "medium" } as const;

test("the menu demo plays a real six-bot round, three engine steps a tick", () => {
  const demo = createAttractMatch(DEMO);
  assert.equal(demo.tick(), 0);
  assert.equal(demo.view().step, 0);
  assert.equal(demo.view().units.length, MAX_PLAYERS);
  demo.advance();
  assert.equal(demo.tick(), 1);
  assert.equal(demo.view().step, STEPS_PER_ADVANCE);
  assert.equal(demo.previous().step, 0);
  // The six units are driven by the engine's own bots: nobody is held still by an absent player.
  const spawns = demo.view().units.map((unit) => `${unit.x}:${unit.y}`);
  for (let tick = 0; tick < 120; tick++) demo.advance();
  const moved = demo
    .view()
    .units.filter((unit, slot) => `${unit.x}:${unit.y}` !== spawns[slot]);
  assert.equal(moved.length, MAX_PLAYERS, "every seat is played by a bot");
});

test("the demo is seeded, so two of them stay in step", () => {
  const a = createAttractMatch(DEMO),
    b = createAttractMatch(DEMO);
  for (let tick = 0; tick < 60; tick++) {
    a.advance();
    b.advance();
  }
  assert.deepEqual(a.view(), b.view());
  const other = createAttractMatch({ ...DEMO, seed: DEMO.seed + 1 });
  for (let tick = 0; tick < 60; tick++) other.advance();
  assert.notDeepEqual(other.view(), a.view(), "a different seed plays apart");
});

test("warmup opens the menu on play already under way", () => {
  const demo = createAttractMatch({ ...DEMO, warmupTicks: 50 });
  assert.equal(demo.tick(), 50);
  assert.equal(demo.view().step, 50 * STEPS_PER_ADVANCE);
});

test("a round that runs long is replaced, so history cannot grow without bound", () => {
  const demo = createAttractMatch({ ...DEMO, warmupTicks: LOOP_TICKS });
  assert.equal(demo.rounds(), 1);
  assert.equal(demo.tick(), LOOP_TICKS);
  demo.advance();
  assert.equal(demo.rounds(), 2, "a fresh round took its place");
  assert.equal(demo.tick(), 0);
  assert.equal(demo.view().step, 0, "the renderer is told a round began");
  assert.equal(demo.view().winner, null);
});

test("a decided round lingers for a moment and then starts another", () => {
  // Seed 7's first demo round is decided (a snail victory) well inside the loop interval.
  const demo = createAttractMatch({ seed: 7, botLevel: "medium" });
  let guard = 0;
  while (!demo.view().winner && guard++ < LOOP_TICKS) demo.advance();
  assert.ok(demo.view().winner, "the demo round reaches a victory");
  const won = demo.rounds();
  assert.equal(won, 1, "the victory came before the loop interval");
  for (let tick = 0; tick < LINGER_TICKS - 1; tick++) demo.advance();
  assert.equal(demo.rounds(), won, "the winning moment stays on screen");
  demo.advance();
  demo.advance();
  assert.equal(demo.rounds(), won + 1);
  assert.equal(demo.view().winner, null);
});

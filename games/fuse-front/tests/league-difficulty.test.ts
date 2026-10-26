import test from "node:test";
import assert from "node:assert/strict";
import { both } from "./fixtures/league.js";

/**
 * Difficulty on Neon Duel, Brick against Brick: hard, normal and easy against each other from both sides, every
 * match inside v3 M7's pace bound. The profiles differ in how often they think, how exactly they time a last hit,
 * when they fall back, what they weigh in a fight and how far they look (`bot.ts`), never in what they may see.
 * About a minute of CPU.
 */
test("on Neon Duel hard and normal bots beat easy ones from both sides, and hard beats normal", (t) => {
  const { won, lines, unfinished } = both("neon-duel", 1, [
    ["hard", "easy"],
    ["normal", "easy"],
    ["hard", "normal"],
  ]);
  for (const line of lines) t.diagnostic(line);
  assert.deepEqual(unfinished, []);
  assert.deepEqual(won.slice(0, 2), [2, 2]);
  assert.ok(won[2]! >= 1, `hard won ${won[2]} of 2 against normal`);
});

import test from "node:test";
import assert from "node:assert/strict";
import type { Difficulty, HeroKind } from "../src/engine/index.js";
import { LIMIT_MINUTES, play } from "./fixtures/league.js";

/**
 * The bot league on Neon Duel, the 1v1 lane map: each difficulty against itself, hard against easy from both sides,
 * and each other hero against Brick, all play to a result, each match's length reported. Bots read no RNG and the
 * rules draw none, so a match is fixed by its seats and heroes. The 15–20 minute target is v3 M7's; the bound leaves
 * headroom over what M2 measured (rules fuse-front-14: 10.7 to 17.5 minutes). About a minute of CPU.
 */
const matches: [string, Difficulty[], Record<number, HeroKind>?][] = [
  ["easy v easy", ["easy", "easy"]],
  ["normal v normal", ["normal", "normal"]],
  ["hard v hard", ["hard", "hard"]],
  ["hard v easy", ["hard", "easy"]],
  ["easy v hard", ["easy", "hard"]],
];
for (const kind of ["vix", "rivet", "tally"] as const)
  matches.push([`${kind} v brick`, ["normal", "normal"], { 0: kind }]);

test(`every 1v1 bot pairing on Neon Duel ends with a winner inside ${LIMIT_MINUTES} minutes`, (t) => {
  const unfinished = matches.flatMap(([label, bots, kinds]) => {
    const [winner, minutes] = play("neon-duel", bots, kinds);
    t.diagnostic(`${label}: team ${winner} in ${minutes.toFixed(1)} min`);
    return winner === 0 || winner === 1 ? [] : [`${label}: ${winner}`];
  });
  assert.deepEqual(unfinished, []);
});

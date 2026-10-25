import test from "node:test";
import assert from "node:assert/strict";
import { both, play, sides } from "./fixtures/league.js";

/**
 * The bot league on the team lane maps, each team the same heroes (Brick, Vix and Rivet by seat): a normal mirror,
 * then hard, normal and easy against each other from both sides, every match to a winner, its length reported.
 * Measured with M5's MOBA bots (rules fuse-front-20) over mirrored lineups: Twin Wilds 2v2 runs 9–23 minutes and
 * Crown Jungle 3v3 12–30 (M4's mirrors: 16.9 and 19.2). About two minutes of CPU, so it has its own file.
 */
const MAPS = [
  { id: "twin-wilds", size: 2 },
  { id: "crown-jungle", size: 3 },
];

for (const { id, size } of MAPS)
  test(`${size}v${size} bots on ${id}: every match ends, and the harder side wins`, (t) => {
    const [winner, minutes] = play(id, sides(size, "normal", "normal"));
    t.diagnostic(
      `${id} normal mirror: team ${winner} in ${minutes.toFixed(1)} min`,
    );
    assert.ok(winner === 0 || winner === 1, `${winner}`);
    const { won, lines, unfinished } = both(id, size, [
      ["hard", "easy"],
      ["normal", "easy"],
      ["hard", "normal"],
    ]);
    for (const line of lines) t.diagnostic(line);
    assert.deepEqual(unfinished, []);
    // Hard and normal beat easy from both sides; hard beats normal from at least one.
    assert.deepEqual(won.slice(0, 2), [2, 2]);
    assert.ok(won[2]! >= 1, `hard won ${won[2]} of 2 against normal`);
  });

import test from "node:test";
import assert from "node:assert/strict";
import { play } from "./fixtures/league.js";

/**
 * The bot league on the team lane maps: an even match of normal bots at each map's own size ends with a winner, its
 * length reported. Measured (rules fuse-front-14): Twin Wilds 2v2 21.9 minutes, Crown Jungle 3v3 14.2; with M4's
 * progression (fuse-front-19) 16.9 and 19.2. About a minute and a half of CPU, so it has its own file.
 */
const MATCHES = [
  { id: "twin-wilds", size: 2 },
  { id: "crown-jungle", size: 3 },
];

for (const { id, size } of MATCHES)
  test(`${size}v${size} normal bots on ${id} end with a winner`, (t) => {
    const [winner, minutes] = play(id, Array(2 * size).fill("normal"));
    t.diagnostic(`team ${winner} in ${minutes.toFixed(1)} min`);
    assert.ok(winner === 0 || winner === 1, `${winner}`);
  });

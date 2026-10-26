import test from "node:test";
import assert from "node:assert/strict";
import type { HeroKind } from "../src/engine/index.js";
import {
  LONGEST,
  MEDIAN,
  SHORTEST,
  both,
  median,
  paced,
  play,
  sides,
} from "./fixtures/league.js";

/**
 * The bot league on the team lane maps: normal against normal for three lineups (each team Brick, Vix and Rivet by
 * seat, then a cross lineup from both sides), then hard, normal and easy against each other from both sides, every
 * match to a winner inside v3 M7's pace bound (10–28 minutes) and the normal matches' median in 14–21. Measured with
 * M7's tuning (rules fuse-front-21) over 16 Twin Wilds and 9 Crown Jungle normal lineups: 2v2 13.8–19.1 minutes
 * (median 17.1), 3v3 14.7–19.4 (median 17.6). A mismatch ends sooner, 10–12 minutes for hard against easy. About
 * three minutes of CPU, so it has its own file.
 */
const MAPS: { id: string; size: number; cross: HeroKind[][] }[] = [
  {
    id: "twin-wilds",
    size: 2,
    cross: [
      ["brick", "vix"],
      ["rivet", "tally"],
    ],
  },
  {
    id: "crown-jungle",
    size: 3,
    cross: [
      ["brick", "vix", "rivet"],
      ["tally", "brick", "vix"],
    ],
  },
];

/** Team 0's heroes `a` and team 1's `b`, by seat: seats 0, 2, 4 and 1, 3, 5. */
const lineup = (a: HeroKind[], b: HeroKind[]) =>
  Object.fromEntries(
    a.flatMap((kind, i) => [
      [2 * i, kind],
      [2 * i + 1, b[i]!],
    ]),
  ) as Record<number, HeroKind>;

for (const { id, size, cross } of MAPS)
  test(`${size}v${size} bots on ${id}: every match ends in ${SHORTEST}–${LONGEST} minutes, and the harder side wins`, (t) => {
    const [a, b] = cross as [HeroKind[], HeroKind[]];
    const normal: number[] = [];
    for (const kinds of [{}, lineup(a, b), lineup(b, a)]) {
      const [winner, length] = play(id, sides(size, "normal", "normal"), kinds);
      t.diagnostic(
        `${id} normal ${JSON.stringify(kinds)}: team ${winner} in ${length.toFixed(1)} min`,
      );
      assert.ok(winner === 0 || winner === 1, `${winner}`);
      assert.ok(paced(length), `${length}`);
      normal.push(length);
    }
    const middle = median(normal);
    assert.ok(middle >= MEDIAN[0] && middle <= MEDIAN[1], `median ${middle}`);
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

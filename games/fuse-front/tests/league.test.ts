import test from "node:test";
import assert from "node:assert/strict";
import { HERO_KINDS } from "../src/engine/index.js";
import {
  LONGEST,
  MEDIAN,
  SHORTEST,
  median,
  paced,
  play,
} from "./fixtures/league.js";

/**
 * The bot league on Neon Duel, the 1v1 lane map: every hero against every hero (mirrors too) with normal bots, each
 * match's winner and length reported, then the wins by hero and by side. Bots read no RNG and the rules draw none, so
 * a match is fixed by its seats and heroes. v3 M7's tuning (rules fuse-front-21) is the contract: every match ends in
 * 10–28 minutes with the median in 14–21, every hero holds 3 items or more at minute 15, and every hero wins 2 to 4
 * of its 6 cross pairings (Vix won all six before M7). About two minutes of CPU.
 */
test(`every 1v1 hero pairing on Neon Duel ends in ${SHORTEST}–${LONGEST} minutes, each hero winning 2–4 of 6`, (t) => {
  const wins = Object.fromEntries(HERO_KINDS.map((kind) => [kind, 0]));
  const sides = [0, 0];
  const minutes: number[] = [];
  const unfinished: string[] = [];
  for (const a of HERO_KINDS)
    for (const b of HERO_KINDS) {
      const [winner, length, items] = play("neon-duel", ["normal", "normal"], {
        0: a,
        1: b,
      });
      minutes.push(length);
      t.diagnostic(
        `${a} v ${b}: team ${winner} in ${length.toFixed(1)} min, items at 15 ${items.join("/")}`,
      );
      if (winner === 0 || winner === 1) {
        sides[winner]!++;
        if (a !== b) wins[winner === 0 ? a : b]!++;
      }
      // Every bot shops its build at its fort (`bot-shop.ts`), 3 items or more by minute 15.
      if (
        (winner !== 0 && winner !== 1) ||
        !paced(length) ||
        items.some((count) => count < 3)
      )
        unfinished.push(`${a} v ${b}: ${winner} in ${length}, items ${items}`);
    }
  const middle = median(minutes);
  t.diagnostic(
    `cross-pairing wins of 6: ${HERO_KINDS.map((k) => `${k} ${wins[k]}`).join(", ")}; by side ${sides.join("/")}; median ${middle.toFixed(1)} min`,
  );
  assert.deepEqual(unfinished, []);
  assert.ok(middle >= MEDIAN[0] && middle <= MEDIAN[1], `median ${middle}`);
  for (const kind of HERO_KINDS)
    assert.ok(wins[kind]! >= 2 && wins[kind]! <= 4, `${kind} ${wins[kind]}`);
});

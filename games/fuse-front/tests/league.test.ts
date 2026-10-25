import test from "node:test";
import assert from "node:assert/strict";
import { HERO_KINDS } from "../src/engine/index.js";
import { LIMIT_MINUTES, play } from "./fixtures/league.js";

/**
 * The bot league on Neon Duel, the 1v1 lane map: every hero against every hero (mirrors too) with normal bots, each
 * match's winner and length reported, then the wins by hero and by side. Bots read no RNG and the rules draw none, so
 * a match is fixed by its seats and heroes. Measured with M5's MOBA bots (rules fuse-front-20): 10–33 min, mirrors
 * the longest, since a bot now defends its towers and rarely dies (M4's 9–22 min bots never retreated); the 15–20
 * minute target is v3 M7's. Vix wins every cross pairing: her 7-tile gun outranges the other heroes' 5. About two
 * minutes of CPU.
 */
test(`every 1v1 hero pairing on Neon Duel ends with a winner inside ${LIMIT_MINUTES} minutes`, (t) => {
  const wins = Object.fromEntries(HERO_KINDS.map((kind) => [kind, 0]));
  const sides = [0, 0];
  const unfinished: string[] = [];
  for (const a of HERO_KINDS)
    for (const b of HERO_KINDS) {
      const [winner, minutes, items] = play("neon-duel", ["normal", "normal"], {
        0: a,
        1: b,
      });
      t.diagnostic(
        `${a} v ${b}: team ${winner} in ${minutes.toFixed(1)} min, items ${items.join("/")}`,
      );
      if (winner === 0 || winner === 1) {
        sides[winner]!++;
        if (a !== b) wins[winner === 0 ? a : b]!++;
      }
      // Every bot shops its build at its fort (`bot-shop.ts`).
      if ((winner !== 0 && winner !== 1) || items.some((count) => count === 0))
        unfinished.push(`${a} v ${b}: ${winner}, items ${items}`);
    }
  t.diagnostic(
    `cross-pairing wins of 6: ${HERO_KINDS.map((k) => `${k} ${wins[k]}`).join(", ")}; by side ${sides.join("/")}`,
  );
  assert.deepEqual(unfinished, []);
});

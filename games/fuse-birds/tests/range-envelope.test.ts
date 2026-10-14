import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidateVector,
  createMatch,
  traceShot,
  UNIT,
  WINDS,
} from "fuse-birds-game";

test("Pebble reaches both far edges across the live footing height domain in every wind", () => {
  const s = createMatch("range-envelope", 1, [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ]);
  s.terrain.bits.fill(0); // Range test, deliberately independent of later tactical cover.
  // Generated footing is >=335; birds stand six cells above it. Destruction only removes cells.
  // 698 is the last whole-cell bird center above the initial water hazard.
  for (const y of [329, 380, 450, 525, 600, 650, 698])
    for (const ty of [329, 380, 450, 525, 600, 650, 698])
      for (const wind of WINDS)
        for (const direction of [-1, 1]) {
          const a = {
            ...s.players[0]!,
            x: (direction > 0 ? 5 : 1531) * UNIT,
            y: y * UNIT,
          };
          const b = {
            ...s.players[1]!,
            x: (direction > 0 ? 1531 : 5) * UNIT,
            y: ty * UNIT,
          };
          let hit = false;
          for (let candidate = 0; candidate < 201 && !hit; candidate++) {
            const v = candidateVector(a, b, wind, candidate);
            if (v) hit = traceShot(s.terrain, [a, b], a, v, wind, b.id).hit;
          }
          assert.ok(
            hit,
            `unreachable: y=${y} targetY=${ty} wind=${wind} direction=${direction}`,
          );
        }
});
test("vertically aligned opponents remain reachable above and below in every wind", () => {
  const s = createMatch("vertical-range", 1, [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ]);
  s.terrain.bits.fill(0);
  for (const x of [10, 768, 1526])
    for (const y of [329, 500, 698])
      for (const ty of [329, 500, 698])
        for (const wind of WINDS) {
          if (y === ty) continue;
          const from = { ...s.players[0]!, x: x * UNIT, y: y * UNIT },
            to = { ...s.players[1]!, x: x * UNIT, y: ty * UNIT };
          let hit = false;
          for (let c = 0; c < 201 && !hit; c++) {
            const v = candidateVector(from, to, wind, c);
            if (v)
              hit = traceShot(s.terrain, [from, to], from, v, wind, to.id).hit;
          }
          assert.ok(
            hit,
            `vertical miss at x=${x} y=${y} targetY=${ty} wind=${wind}`,
          );
        }
});

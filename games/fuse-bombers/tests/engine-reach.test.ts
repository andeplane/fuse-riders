import test from "node:test";
import assert from "node:assert/strict";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  createRound,
  resolveTuning,
  step,
  type RoundState,
} from "../src/engine/index.js";
import { arcFor, DEG } from "../src/engine/geometry.js";
import {
  everyPairReachable,
  findHitAngle,
  traceShot,
} from "../src/engine/reach.js";
import type { Terrain } from "../src/engine/types.js";

function flatTerrain(y: number): Terrain {
  const surface = new Float64Array(ARENA_WIDTH).fill(y);
  return {
    width: ARENA_WIDTH,
    height: ARENA_HEIGHT,
    surface,
    bedrock: ARENA_HEIGHT - 28,
    version: 0,
  };
}

/** An angle in the shooter's current arc that hits the target, checked against the real state. */
function hitAngle(s: RoundState, shooter: number, target: number) {
  const alive = s.castles.filter((c) => c.alive);
  const from = alive.findIndex((c) => c.id === shooter);
  const to = alive.findIndex((c) => c.id === target);
  const c = s.castles[shooter];
  assert.ok(c && from >= 0 && to >= 0);
  const angle = findHitAngle(s.terrain, s.tuning, alive, from, to, [
    c.arcMin,
    c.arcMax,
  ]);
  if (angle === null) return null;
  assert.ok(angle >= c.arcMin && angle <= c.arcMax);
  return angle;
}

test("every castle can hit every other castle, at spawn and once the arcs narrow to a duel", () => {
  for (let n = 2; n <= 6; n++) {
    for (let seed = 1; seed <= 20; seed++) {
      const s = createRound({ seed, playerCount: n });
      for (const a of s.castles) {
        for (const b of s.castles) {
          if (a === b) continue;
          const where = `${n}p seed ${seed}: castle ${a.id} -> ${b.id}`;
          assert.notEqual(hitAngle(s, a.id, b.id), null, `${where} at spawn`);
          // Everyone else is gone: let the engine narrow the arcs, then aim again.
          const duel = structuredClone(s);
          for (const c of duel.castles)
            c.alive = c.id === a.id || c.id === b.id;
          step(duel);
          assert.equal(
            duel.castles[a.id]?.facing,
            b.x < a.x ? "left" : "right",
          );
          assert.notEqual(hitAngle(duel, a.id, b.id), null, `${where} duel`);
        }
      }
    }
  }
});

test("findHitAngle finds the ballistic angle on flat ground and respects blockers", () => {
  const t = resolveTuning();
  const terrain = flatTerrain(700);
  const castles = [
    { x: 200, y: 700 },
    { x: 1200, y: 700 },
  ];
  const angle = findHitAngle(terrain, t, castles, 0, 1, arcFor("right", t));
  assert.ok(angle !== null);
  assert.equal(traceShot(terrain, t, castles, 0, angle).hit, 1);
  const back = findHitAngle(terrain, t, castles, 1, 0, arcFor("left", t));
  assert.ok(back !== null && back > Math.PI / 2);
  // An arc that only points away from the target never hits it.
  assert.equal(
    findHitAngle(terrain, t, castles, 0, 1, arcFor("left", t)),
    null,
  );

  // A wall taller than any lob can clear blocks everything.
  const walled = flatTerrain(700);
  for (let x = 650; x < 750; x++) walled.surface[x] = -2000;
  assert.equal(
    findHitAngle(walled, t, castles, 0, 1, arcFor("right", t)),
    null,
  );
  assert.equal(everyPairReachable(walled, t, castles), false);
  assert.equal(everyPairReachable(terrain, t, castles), true);
});

test("neighbours right behind a peak are reachable with the steep end of the arc", () => {
  const t = resolveTuning();
  const terrain = flatTerrain(700);
  // A 250 px peak half-way between castles only 280 px apart (a crowded 6-player arena).
  for (let x = 0; x < ARENA_WIDTH; x++)
    terrain.surface[x] = 700 - 250 * Math.exp(-(((x - 440) / 45) ** 2));
  const castles = [
    { x: 300, y: 700 },
    { x: 580, y: 700 },
  ];
  const angle = findHitAngle(terrain, t, castles, 0, 1, arcFor("right", t));
  assert.ok(angle !== null && angle > 80 * DEG, `angle ${angle}`);
  const narrow = resolveTuning({ narrowArcDeg: [8, 82] });
  assert.equal(
    findHitAngle(terrain, narrow, castles, 0, 1, arcFor("right", narrow)),
    null,
    "the old 82° cap could not reach",
  );
});

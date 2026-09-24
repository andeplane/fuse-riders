import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorld,
  DEFAULT_TUNING,
  S,
  type World,
} from "../src/engine/world.js";
import { step } from "../src/engine/step.js";
import { stepCombat, strike } from "../src/engine/combat.js";
import { decodeWorld } from "../src/engine/codec.js";

function split(w: World, id: number): void {
  const b = w.combat.balls.find((b) => b.id === id)!;
  w.hook = {
    phase: "flying",
    x: b.x,
    y: b.y,
    vx: 20 * S,
    vy: 0,
    life: 60,
    distance: 0,
    platform: -1,
  };
  assert.equal(strike(w, S, 0), true);
}
for (const map of ["belfry", "crossroads"] as const)
  for (const experiment of ["ricochet", "surge"] as const)
    test(`${map}/${experiment}: long replay, every-tick checkpoint, split conservation and depletion`, () => {
      const a = createWorld({ ...DEFAULT_TUNING, map, experiment });
      let b = structuredClone(a);
      let minX = Infinity,
        maxX = 0,
        minY = Infinity,
        maxY = 0;
      for (let i = 0; i < 3600; i++) {
        step(a);
        step(b);
        if ([600, 1200, 1800, 2200, 2500, 2800, 3200].includes(i)) {
          split(a, a.combat.balls[0]!.id);
          split(b, b.combat.balls[0]!.id);
        }
        assert.deepEqual(a, b);
        const restored = decodeWorld(a);
        assert.ok(
          restored,
          `valid tick ${i}: ${JSON.stringify(a.combat.balls)}`,
        );
        if (i % 29 === 0) b = restored;
        assert.ok(a.combat.balls.length <= 4);
        for (const ball of a.combat.balls) {
          minX = Math.min(minX, ball.x / S);
          maxX = Math.max(maxX, ball.x / S);
          minY = Math.min(minY, ball.y / S);
          maxY = Math.max(maxY, ball.y / S);
        }
      }
      assert.ok(maxX - minX > 800, "travels across the arena");
      assert.ok(maxY - minY > 500, "uses arena height");
      assert.equal(a.combat.hits, 7);
      assert.equal(a.combat.balls.length, 0);
    });

test("solid top, side, underside and bottom boundary rebound without tunnelling", () => {
  const w = createWorld({
    ...DEFAULT_TUNING,
    map: "crossroads",
    experiment: "surge",
  });
  const b = w.combat.balls[0]!;
  for (const [x, y, vx, vy, axis, sign] of [
    [750, 168, 4, 12, "vy", -1],
    [608, 224, 4, 0, "vx", -1],
    [750, 280, 4, -11, "vy", 1],
    [40, 828, -4, 12, "vy", -1],
    [1558, 100, 4, 0, "vx", -1],
  ] as const) {
    Object.assign(b, { x: x * S, y: y * S, vx: vx * S, vy: vy * S });
    stepCombat(w);
    assert.equal(Math.sign(b[axis]), sign, `${x},${y} ${axis}`);
  }
});

test("split at a platform edge fits children; forged geometry, speed, ancestry and hit totals are rejected", () => {
  const w = createWorld({
    ...DEFAULT_TUNING,
    map: "crossroads",
    experiment: "surge",
  });
  w.tick = 1;
  Object.assign(w.combat.balls[0]!, { x: 750 * S, y: 170 * S - 1 });
  split(w, 1);
  assert.ok(decodeWorld(w));
  for (const corrupt of [
    (v: World) => {
      v.combat.balls[0]!.y = 220 * S;
    },
    (v: World) => {
      v.combat.balls[0]!.vx = 100 * S;
    },
    (v: World) => {
      v.combat.balls.push({ ...v.combat.balls[0]! });
    },
    (v: World) => {
      v.combat.hits = 7;
    },
    (v: World) => {
      v.combat.balls[0]!.id = 1;
      v.combat.balls[0]!.tier = 2;
    },
  ]) {
    const bad = structuredClone(w);
    corrupt(bad);
    assert.equal(decodeWorld(bad), undefined);
  }
});

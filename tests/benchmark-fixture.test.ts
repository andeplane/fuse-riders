import test from "node:test";
import assert from "node:assert/strict";
import { visualFixture } from "../scripts/lib/benchmark-fixture.js";
import {
  trailPaths,
  trailTip,
} from "../games/fuse-riders/src/render/phaser/trails.js";
import { TrailHistory } from "../games/fuse-riders/src/render/phaser/trail-history.js";
import type { TrailSegment } from "../games/fuse-riders/src/engine/view.js";

const LIFETIME = 160;
const same = (a: TrailSegment, b: TrailSegment): boolean =>
  a.x1 === b.x1 &&
  a.y1 === b.y1 &&
  a.x2 === b.x2 &&
  a.y2 === b.y2 &&
  a.createdTick === b.createdTick &&
  a.expiresAtTick === b.expiresAtTick;

test("the fixture is a pure, seedless function of the tick", () => {
  assert.deepEqual(visualFixture(137.5), visualFixture(137.5));
  assert.deepEqual(visualFixture(40), visualFixture(40));
});

test("every rider carries a base-power trail of one unbroken path", () => {
  const world = visualFixture(500);
  assert.equal(world.players.length, 5);
  for (const rider of world.players) {
    assert.equal(rider.trail.length, LIFETIME);
    // A trail the renderer can draw as one ribbon: no hole, so no accidental extra end caps.
    assert.equal(trailPaths(rider.trail).length, 1);
    assert.equal(rider.trail.at(-1)!.createdTick, 500);
    for (const [i, segment] of rider.trail.entries()) {
      assert.equal(segment.createdTick, 500 - LIFETIME + i + 1);
      assert.equal(segment.expiresAtTick, segment.createdTick + LIFETIME);
      // The head is the segment about to go: still alive on the tick being drawn, gone on the next.
      assert.ok(segment.expiresAtTick > 500);
    }
  }
});

test("an established segment never moves: a tick appends at the tail and expires at the head", () => {
  for (const tick of [40, 200, 733]) {
    const before = visualFixture(tick),
      after = visualFixture(tick + 1);
    for (const [p, rider] of before.players.entries()) {
      const next = after.players[p]!;
      assert.equal(next.trail.length, rider.trail.length);
      // Everything but the expired head is the same geometry, one index earlier.
      for (let i = 1; i < rider.trail.length; i++)
        assert.ok(
          same(rider.trail[i]!, next.trail[i - 1]!),
          `rider ${p} segment ${i} moved between ticks`,
        );
      assert.ok(!next.trail.some((s) => same(s, rider.trail[0]!)));
      assert.equal(next.trail.at(-1)!.createdTick, tick + 1);
    }
  }
});

test("a rider never outruns its own speed, so a fractional tip stays legal", () => {
  // Negative ticks too: the benchmark starts at 0, so the first frames carry a trail laid before it.
  for (let tick = -400; tick < 400; tick += 37)
    for (const rider of visualFixture(tick).players)
      for (const segment of rider.trail)
        assert.ok(
          Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1) <=
            rider.speed,
          "a segment is longer than the rider's step",
        );
});

test("riders lap inside the boundary", () => {
  const { width, height, boundaryInset } = visualFixture(0);
  for (let tick = -400; tick < 900; tick += 13)
    for (const rider of visualFixture(tick).players)
      for (const { x, y } of rider.trail.flatMap((s) => [
        { x: s.x1, y: s.y1 },
        { x: s.x2, y: s.y2 },
      ])) {
        assert.ok(x > boundaryInset && x < width - boundaryInset);
        assert.ok(y > boundaryInset && y < height - boundaryInset);
      }
});

test("a fractional tick keeps the world of the tick it floors to and moves only the head", () => {
  const world = visualFixture(300),
    between = visualFixture(300.5);
  assert.equal(between.tick, 300.5);
  for (const [p, rider] of world.players.entries()) {
    const shown = between.players[p]!;
    assert.equal(shown.trail.length, rider.trail.length);
    for (const [i, segment] of rider.trail.entries())
      assert.ok(same(segment, shown.trail[i]!));
    assert.notEqual(shown.x, rider.x);
    // Halfway to where the next tick puts it, which is what `interpolateWorld` does.
    const next = visualFixture(301).players[p]!;
    assert.ok(Math.abs(shown.x - (rider.x + next.x) / 2) < 1e-9);
    assert.ok(Math.abs(shown.y - (rider.y + next.y) / 2) < 1e-9);
  }
});

test("the tip is drawn between ticks and not on one", () => {
  const world = visualFixture(300);
  for (const rider of world.players)
    assert.equal(trailTip(rider, world.tick, world.phase).length, 2);
  for (const fraction of [0.25, 0.5, 0.75, 0.99]) {
    const between = visualFixture(300 + fraction);
    for (const rider of between.players) {
      const tip = trailTip(rider, between.tick, between.phase);
      assert.equal(tip.length, 3, `no tip at +${fraction}`);
      assert.deepEqual(tip[2], { x: rider.x, y: rider.y });
    }
  }
});

test("the moving tip does not disturb the established history a cache holds", () => {
  const cache = new TrailHistory();
  const rules = visualFixture(0).rules;
  let builds = 0;
  // Three frames a tick, each with the tip somewhere else: what 60 Hz of rendering does to a 20 Hz world.
  // One rebuild per tick, never per frame — the fixture leaves an established history there to reuse.
  for (let frame = 0; frame < 90; frame++) {
    const world = visualFixture(200 + frame / 3);
    if (
      cache.update(world.players, "match:1:neon-pixel", world.tick, rules)
        .changed
    )
      builds++;
  }
  assert.equal(builds, 30);
});

test("the discrete world is the tick it floors to, not the tick being drawn", () => {
  const on = visualFixture(300),
    between = visualFixture(300.5),
    next = visualFixture(301);
  // Bursts and pickups are the floored tick's outright: nothing expires a fifth of the way into a tick.
  assert.deepEqual(between.blasts, on.blasts);
  assert.deepEqual(between.pickups, on.pickups);
  // And they do move on a real tick, so the equality above is a claim and not an accident.
  assert.notDeepEqual(next.pickups, on.pickups);
  for (const [i, bomb] of on.bombs.entries()) {
    const shown = between.bombs[i]!;
    for (const field of [
      "launchedTick",
      "landsAtTick",
      "explodeAtTick",
    ] as const) {
      assert.equal(shown[field], bomb[field]);
      assert.ok(Number.isInteger(shown[field]));
      assert.notEqual(next.bombs[i]![field], bomb[field]);
    }
    // A shell in flight does move between ticks, as presentation interpolates one.
    assert.notEqual(shown.x, bomb.x);
  }
});

test("a heading swings the short way round the seam at \u00b1\u03c0", () => {
  const seam: { tick: number; p: number }[] = [];
  for (let tick = 0; tick < 400; tick++) {
    const on = visualFixture(tick),
      next = visualFixture(tick + 1);
    for (const [p, rider] of on.players.entries())
      if (Math.abs(next.players[p]!.angle - rider.angle) > Math.PI)
        seam.push({ tick, p });
  }
  // The fixture must actually cross the seam, or this test proves nothing.
  assert.ok(seam.length > 0, "no rider heading crossed the seam");
  for (const { tick, p } of seam) {
    const before = visualFixture(tick).players[p]!.angle;
    for (const fraction of [0.25, 0.5, 0.75]) {
      const shown = visualFixture(tick + fraction).players[p]!.angle;
      const swung = Math.atan2(
        Math.sin(shown - before),
        Math.cos(shown - before),
      );
      // One tick of lap, not most of a turn the other way, which is what a raw lerp across the seam gives.
      assert.ok(
        Math.abs(swung) < 0.1,
        `rider ${p} swung ${swung.toFixed(3)} rad at tick ${tick}+${fraction}`,
      );
    }
  }
});

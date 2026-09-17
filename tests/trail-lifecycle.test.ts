import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceTrail,
  boundTrail,
  cutTrail,
  detachTrail,
  erodeTrailPiece,
  MAX_TRAIL_SEGMENTS,
} from "../src/shared/trail-lifecycle.js";
import { cutTrailHole } from "../src/shared/gun.js";
import { clipTrailSegment } from "../src/shared/trail-clipping.js";
import type { TrailSegment } from "../src/shared/protocol.js";

const line = (
  x1: number,
  x2: number,
  createdTick = 1,
  y = 100,
): TrailSegment => ({ x1, x2, y1: y, y2: y, createdTick, expiresAtTick: 81 });
const allocator = () => {
  let next = 1;
  return () => next++;
};
const length = (trail: readonly TrailSegment[]) =>
  trail.reduce((n, s) => n + Math.hypot(s.x2 - s.x1, s.y2 - s.y1), 0);

test("pause includes the exact boundary, then consumes equal distance at each end until gone", () => {
  const trail = detachTrail([line(100, 400)], 10, allocator());
  assert.deepEqual(trail[0]!.detached, { id: 1, decayStartTick: 30 });
  for (let tick = 11; tick <= 30; tick++)
    assert.deepEqual(advanceTrail(trail, tick), trail);
  let current = advanceTrail(trail, 31);
  assert.equal(current[0]!.x1, 101.875);
  assert.equal(current[0]!.x2, 398.125);
  for (let tick = 32; tick < 110; tick++) current = advanceTrail(current, tick);
  assert.equal(
    length(current),
    3.75,
    "300-unit piece lasts four seconds after the one-second pause",
  );
  assert.deepEqual(advanceTrail(current, 110), []);
});

test("erosion follows bends, removes multiple/zero segments, is segmentation-independent and pure", () => {
  const curve = [
    line(0, 3),
    line(3, 10, 2),
    { ...line(10, 10, 3), y2: 110 },
    line(10, 10, 4, 110),
  ];
  const copy = structuredClone(curve);
  const shrunk = erodeTrailPiece(curve, 7.5);
  assert.equal(length(shrunk), 5);
  assert.equal(shrunk[0]!.x1, 7.5);
  assert.equal(shrunk.at(-1)!.y2, 102.5);
  assert.deepEqual(curve, copy);
  assert.deepEqual(erodeTrailPiece([line(1, 1)], 0), []);
  assert.deepEqual(erodeTrailPiece([line(1, 6)], 3.75), []);
  assert.deepEqual(erodeTrailPiece([line(1, 8.5)], 3.75), []);
  const coarse = erodeTrailPiece([line(0, 30)], 3.75);
  const fine = erodeTrailPiece(
    [line(0, 5), line(5, 10, 2), line(10, 30, 3)],
    3.75,
  );
  assert.equal(length(coarse), length(fine));
  assert.equal(coarse[0]!.x1, fine[0]!.x1);
  assert.equal(coarse[0]!.x2, fine.at(-1)!.x2);
});

test("a gun split detaches only the older half; repeat cuts and death never refresh its clock", () => {
  const allocate = allocator();
  const trail = cutTrail(
    [line(100, 400)],
    10,
    (s) => cutTrailHole(s, 250, 100, 25),
    allocate,
  );
  assert.equal(trail.length, 2);
  assert.equal(trail[0]!.x2, 225);
  assert.equal(trail[1]!.x1, 275);
  assert.equal(trail[0]!.detached?.decayStartTick, 30);
  assert.equal(trail[1]!.detached, undefined);
  const recut = cutTrail(
    trail,
    40,
    (s) => cutTrailHole(s, 160, 100, 10),
    allocate,
  );
  assert.equal(recut.length, 3);
  assert.equal(recut[0]!.detached?.decayStartTick, 30);
  assert.equal(recut[1]!.detached?.decayStartTick, 30);
  assert.notEqual(recut[0]!.detached?.id, recut[1]!.detached?.id);
  const dead = detachTrail(recut, 45, allocate);
  assert.deepEqual(dead.slice(0, 2), recut.slice(0, 2));
  assert.equal(dead[2]!.detached?.decayStartTick, 65);
});

test("complete removal, head cuts, simultaneous holes and single survivors keep history order", () => {
  const input = Array.from({ length: 5 }, (_, i) =>
    line(i * 10, (i + 1) * 10, i + 1),
  );
  const allocate = allocator();
  const cut = cutTrail(
    input,
    10,
    (s) => ([2, 4].includes(s.createdTick) ? [] : [s]),
    allocate,
  );
  assert.deepEqual(
    cut.map((s) => s.createdTick),
    [1, 3, 5],
  );
  assert.ok(cut[0]!.detached);
  assert.ok(cut[1]!.detached);
  assert.equal(cut[2]!.detached, undefined);
  assert.deepEqual(
    cutTrail(input, 10, () => [], allocate),
    [],
  );
  assert.ok(
    cutTrail(
      input,
      10,
      (s) => (s.createdTick === 5 ? [] : [s]),
      allocate,
    ).every((s) => s.detached),
  );
  assert.deepEqual(
    cutTrail(input, 10, (s) => [s], allocate),
    input,
  );
});

test("clipping uses destructive continuity even when original segments touch at a crossing", () => {
  const input = [
    line(50, 100),
    line(100, 150, 2),
    line(150, 100, 3),
    line(100, 80, 4),
  ];
  const cut = cutTrail(
    input,
    10,
    (s) => {
      const kept = clipTrailSegment(s, {
        minX: 0,
        minY: 0,
        maxX: 125,
        maxY: 200,
      });
      return kept ? [kept] : [];
    },
    allocator(),
  );
  assert.equal(cut.length, 4);
  assert.ok(cut[0]!.detached);
  assert.ok(cut[1]!.detached);
  assert.equal(cut[2]!.detached, undefined);
  assert.equal(cut[3]!.detached, undefined);
  assert.equal(
    cut[1]!.x2,
    cut[2]!.x1,
    "touching endpoints do not reconnect a cut",
  );
});

test("portal gaps preserve active lifetime but detach as separate runs without consuming empty space", () => {
  const input = [line(100, 200), line(800, 900, 2)];
  assert.deepEqual(
    cutTrail(input, 10, (s) => [s], allocator()),
    input,
  );
  const dead = detachTrail(input, 10, allocator());
  assert.notEqual(dead[0]!.detached?.id, dead[1]!.detached?.id);
  const shrunk = advanceTrail(dead, 31);
  assert.equal(length(shrunk), 192.5);
  assert.equal(shrunk[1]!.x1, 801.875);
  const severed = cutTrail(
    input,
    10,
    (s) => cutTrailHole(s, 850, 100, 10),
    allocator(),
  );
  assert.ok(severed[0]!.detached);
  assert.ok(severed[1]!.detached);
  assert.equal(severed[2]!.detached, undefined);
});

test("active expiry is independent of debris age and saturation preserves active capacity", () => {
  const detached = detachTrail([line(100, 400)], 10, allocator())[0]!;
  assert.equal(advanceTrail([detached, line(500, 600)], 90).length, 1);
  const active = line(500, 600);
  const capped = boundTrail([
    ...Array.from({ length: MAX_TRAIL_SEGMENTS }, () => detached),
    active,
  ]);
  assert.equal(capped.length, MAX_TRAIL_SEGMENTS);
  assert.equal(capped.at(-1), active);
  assert.deepEqual(boundTrail([active]), [active]);
});

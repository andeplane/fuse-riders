import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HOMING_FLIGHT_STEPS, HOMING_TURN_CAP_RADIANS, createHomingFlightPath,
  createVolleyFlightPaths, volleyAngles,
} from '../src/shared/launch-modifiers.ts';

const bounds = { minX: 20, maxX: 1580, minY: 20, maxY: 880 };

test('creates the reviewed triple-shot fan', () => {
  assert.deepEqual(volleyAngles(1), [0.78, 1, 1.22]);
  const paths = createVolleyFlightPaths({ x: 800, y: 450 }, 0, 120, bounds);
  assert.equal(paths.length, 3);
  assert.ok(paths.every(path => path.length === HOMING_FLIGHT_STEPS + 1));
});

test('creates deterministic seven-point homing path with capped turns', () => {
  const path = createHomingFlightPath({ x: 300, y: 300, angle: 0 }, { x: 300, y: 700 }, 400, bounds);
  assert.equal(path.length, 7);
  for (let i = 1; i < path.length; i += 1) {
    const delta = Math.atan2(Math.sin(path[i]!.angle - path[i - 1]!.angle), Math.cos(path[i]!.angle - path[i - 1]!.angle));
    assert.ok(Math.abs(delta) <= HOMING_TURN_CAP_RADIANS + 1e-12);
    assert.ok(path[i]!.x >= bounds.minX && path[i]!.x <= bounds.maxX);
    assert.ok(path[i]!.y >= bounds.minY && path[i]!.y <= bounds.maxY);
  }
  assert.deepEqual(path, createHomingFlightPath({ x: 300, y: 300, angle: 0 }, { x: 300, y: 700 }, 400, bounds));
});

test('homing composes with the triple fan and clamps to safe bounds', () => {
  const paths = createVolleyFlightPaths({ x: 21, y: 21 }, 0, 4000, bounds, { x: 5000, y: 5000 });
  assert.equal(paths.length, 3);
  assert.ok(paths.flat().every(point => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY));
});

test('rejects invalid geometry without mutating inputs', () => {
  const start = { x: 10, y: 10, angle: 0 };
  const target = { x: 20, y: 20 };
  assert.throws(() => createHomingFlightPath(start, target, -1, bounds));
  assert.deepEqual(start, { x: 10, y: 10, angle: 0 });
  assert.deepEqual(target, { x: 20, y: 20 });
});

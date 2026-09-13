import assert from 'node:assert/strict';
import test from 'node:test';
import { createPortalPair, findPortalTransit, type PortalPair, type PortalTransitOptions } from '../src/shared/portal.ts';

const bounds = { minX: 20, minY: 20, maxX: 1580, maxY: 880 };
const pair: PortalPair = { id: 'p', gates: [{ x: 200, y: 200 }, { x: 1000, y: 600 }], expiresAtTick: 200 };
const transit = (overrides: Partial<PortalTransitOptions> = {}) => findPortalTransit({
  pair, tick: 30, from: { x: 150, y: 200 }, to: { x: 250, y: 200 }, heading: 0.75,
  cooldownUntilTick: 0, bounds, riderRadius: 7, isSafeExit: () => true, ...overrides,
});

test('seeded placement respects gate plus rider clearance, lifetime and separation', () => {
  const values = [0, 0, 1, 1];
  const checked: unknown[] = [];
  const result = createPortalPair({ id: 'new', tick: 45, bounds, riderRadius: 7,
    random: () => values.shift()!, isSafe: (point, radius) => { checked.push([point, radius]); return true; } });
  assert.deepEqual(result, { id: 'new', gates: [{ x: 51, y: 51 }, { x: 1549, y: 849 }], expiresAtTick: 245 });
  assert.deepEqual(checked, [[{ x: 51, y: 51 }, 31], [{ x: 1549, y: 849 }, 31]]);
});

test('placement remains bounded for unsafe or insufficiently separated sites', () => {
  for (const safe of [false, true]) {
    let draws = 0;
    let checks = 0;
    assert.equal(createPortalPair({ id: 'p', tick: 0, bounds, riderRadius: 7,
      random: () => { draws++; return 0.5; }, isSafe: () => { checks++; return safe; } }), undefined);
    assert.equal(draws, 48);
    assert.equal(checks, 24);
  }
});

test('impossible dimensions do not consume random samples', () => {
  for (const [maxX, maxY] of [[21, 880], [1580, 21], [100, 100]]) {
    assert.equal(createPortalPair({ id: 'p', tick: 0, bounds: { ...bounds, maxX, maxY }, riderRadius: 7,
      random: () => { throw new Error('should not draw'); }, isSafe: () => true }), undefined);
  }
});

test('placement can use later partners when the first candidate is trapped', () => {
  const values = [0.5, 0.5, 0, 0, 1, 1];
  const result = createPortalPair({ id: 'p', tick: 0,
    bounds: { minX: 0, minY: 0, maxX: 462, maxY: 62 }, riderRadius: 7,
    random: () => values.shift()!, isSafe: () => true });
  assert.deepEqual(result?.gates, [{ x: 31, y: 31 }, { x: 431, y: 31 }]);
});

test('swept entry works when both movement endpoints lie outside and preserves heading', () => {
  assert.deepEqual(transit(), { entryGateIndex: 0, entryPoint: { x: 169, y: 200 }, exitPoint: { x: 1000, y: 600 },
    heading: 0.75, cooldownUntilTick: 45, graceUntilTick: 40 });
  assert.deepEqual(pair.gates, [{ x: 200, y: 200 }, { x: 1000, y: 600 }]);
});

test('either gate links to the other and earliest swept gate wins', () => {
  assert.equal(transit({ from: { x: 1050, y: 600 }, to: { x: 1000, y: 600 } })?.entryGateIndex, 1);
  assert.deepEqual(transit({ from: { x: 1050, y: 600 }, to: { x: 1000, y: 600 } })?.exitPoint, pair.gates[0]);
  const aligned = { ...pair, gates: [{ x: 200, y: 200 }, { x: 1000, y: 200 }] as const };
  assert.equal(transit({ pair: aligned, from: { x: 1100, y: 200 }, to: { x: 100, y: 200 } })?.entryGateIndex, 1);
});

test('cooldown is strict, independent of replacement; expired and absent pairs do nothing', () => {
  assert.equal(transit({ cooldownUntilTick: 31 }), undefined);
  assert.ok(transit({ cooldownUntilTick: 30 }));
  assert.equal(transit({ pair: { ...pair, id: 'replacement' }, cooldownUntilTick: 31 }), undefined);
  assert.equal(transit({ tick: 200 }), undefined);
  assert.equal(transit({ pair: undefined }), undefined);
});

test('no fresh entry while inside, stationary, moving away, missing or short of a gate', () => {
  for (const [from, to] of [
    [{ x: 200, y: 200 }, { x: 210, y: 200 }],
    [{ x: 150, y: 200 }, { x: 150, y: 200 }],
    [{ x: 150, y: 200 }, { x: 100, y: 200 }],
    [{ x: 150, y: 100 }, { x: 250, y: 100 }],
    [{ x: 150, y: 200 }, { x: 160, y: 200 }],
  ]) assert.equal(transit({ from, to }), undefined);
  assert.equal(transit({ from: pair.gates[1], to: { x: 1008, y: 600 }, tick: 50, cooldownUntilTick: 45 }), undefined);
});

test('unsafe exit ignores transit and safe callback receives clamped center and rider radius', () => {
  assert.equal(transit({ isSafeExit: () => false }), undefined);
  const checks: unknown[] = [];
  const result = transit({ bounds: { minX: 20, minY: 20, maxX: 900, maxY: 500 },
    isSafeExit: (point, radius) => { checks.push([point, radius]); return true; } });
  assert.deepEqual(result?.exitPoint, { x: 893, y: 493 });
  assert.deepEqual(checks, [[{ x: 893, y: 493 }, 7]]);
  assert.deepEqual(transit({ bounds: { minX: 1100, minY: 700, maxX: 1580, maxY: 880 } })?.exitPoint, { x: 1107, y: 707 });
  assert.equal(transit({ bounds: { ...bounds, maxX: 21 } }), undefined);
  assert.equal(transit({ bounds: { ...bounds, maxY: 21 } }), undefined);
});

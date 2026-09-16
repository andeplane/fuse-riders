import assert from 'node:assert/strict';
import test from 'node:test';
import { clipTrailSegment } from '../src/shared/trail-clipping.ts';
import {
  addPlayer, createGame, startMatch, step, COUNTDOWN_TICKS,
  INITIAL_BOUNDARY_INSET, OVERTIME_START_TICK, RIDER_RADIUS, TRAIL_LIFETIME_TICKS,
} from '../src/shared/game.ts';
import type { TrailSegment } from '../src/shared/protocol.ts';

const bounds = { minX: 10, minY: 20, maxX: 90, maxY: 80 };
const segment = (x1: number, y1: number, x2: number, y2: number): TrailSegment =>
  ({ x1, y1, x2, y2, createdTick: 12, expiresAtTick: 9999 });

test('trail clipping preserves contained geometry identity and timestamps', () => {
  for (const trail of [segment(20, 30, 80, 70), segment(10, 20, 90, 80), segment(10, 20, 10, 20)]) {
    assert.equal(clipTrailSegment(trail, bounds), trail);
  }
});

test('trail clipping trims crossings on every edge in both directions', () => {
  for (const [input, expected] of [
    [segment(0, 50, 100, 50), segment(10, 50, 90, 50)],
    [segment(100, 50, 0, 50), segment(90, 50, 10, 50)],
    [segment(50, 0, 50, 100), segment(50, 20, 50, 80)],
    [segment(50, 100, 50, 0), segment(50, 80, 50, 20)],
    [segment(0, 10, 100, 110), segment(10, 20, 70, 80)],
    [segment(0, 50, 50, 50), segment(10, 50, 50, 50)],
    [segment(50, 50, 100, 50), segment(50, 50, 90, 50)],
  ]) assert.deepEqual(clipTrailSegment(input!, bounds), expected);
});

test('trail clipping keeps closed tangent edges and corner contacts', () => {
  assert.deepEqual(clipTrailSegment(segment(0, 20, 100, 20), bounds), segment(10, 20, 90, 20));
  assert.deepEqual(clipTrailSegment(segment(10, 0, 10, 100), bounds), segment(10, 20, 10, 80));
  assert.deepEqual(clipTrailSegment(segment(0, 30, 20, 10), bounds), segment(10, 20, 10, 20));
});

test('trail clipping removes exterior points, parallel lines and disjoint diagonal segments', () => {
  for (const trail of [
    segment(9, 30, 9, 70), segment(91, 30, 91, 70), segment(20, 19, 80, 19),
    segment(20, 81, 80, 81), segment(9, 50, 9, 50), segment(50, 81, 50, 81),
    segment(0, 0, 5, 5), segment(100, 100, 110, 110), segment(0, 21, 11, 0),
  ]) assert.equal(clipTrailSegment(trail, bounds), undefined);
});

function overtimeArena() {
  const state = createGame('shrinking-trails', 123);
  for (let slot = 0; slot < 3; slot++) addPlayer(state, { id: `p${slot}`, name: `P${slot}`, slot, color: '#fff' });
  startMatch(state);
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick++) step(state, new Map());
  state.tick = state.roundStartedTick! + OVERTIME_START_TICK;
  state.nextPickupSpawnTick = state.tick + 100;
  for (const [slot, player] of [...state.players.values()].entries()) Object.assign(player, { x: 200 + slot * 500, y: 200 + slot * 200, angle: 0, trail: [] });
  return state;
}

test('overtime trims dead and living trails before collision and snapshot, retaining disconnected pieces', () => {
  const state = overtimeArena(); const rider = state.players.get('p0')!;
  const owner = state.players.get('p1')!;
  Object.assign(rider, { x: INITIAL_BOUNDARY_INSET + .5 + RIDER_RADIUS, y: 440, angle: Math.PI / 2 });
  owner.alive = false;
  owner.trail = [segment(20, 400, 20, 500), segment(0, 100, 100, 100), segment(1500, 100, 1600, 100)];
  const result = step(state, new Map());
  assert.equal(rider.alive, true, 'closed-field trail must not kill an inside rider');
  assert.equal(state.boundaryInset, 20.5);
  assert.deepEqual(owner.trail, [segment(20.5, 100, 100, 100), segment(1500, 100, 1579.5, 100)]);
  assert.deepEqual(result.snapshot.players.find(player => player.id === 'p1')!.trail, owner.trail);
  step(state, new Map());
  assert.equal(owner.trail[0]!.x1, 21);
  assert.equal(owner.trail[1]!.x2, 1579);
});

test('star, shield and portal grace bounce trails cannot start outside the newly closed field', () => {
  for (const defense of ['star', 'shield', 'portal'] as const) {
    const state = overtimeArena(); const player = state.players.get('p0')!;
    Object.assign(player, { x: 20, y: 400, angle: Math.PI });
    if (defense === 'star') player.invulnerableUntilTick = state.tick + 10;
    if (defense === 'shield') player.shielded = true;
    if (defense === 'portal') player.portalGraceUntilTick = state.tick + 10;
    step(state, new Map());
    assert.equal(player.alive, true, defense);
    assert.equal(player.x, state.boundaryInset + RIDER_RADIUS, defense);
    const trail = player.trail.at(-1)!;
    assert.equal(trail.x1, state.boundaryInset, defense);
    assert.equal(trail.x2, player.x, defense);
    assert.equal(trail.createdTick, state.tick);
    assert.equal(trail.expiresAtTick, state.tick + TRAIL_LIFETIME_TICKS);
  }
});

test('overtime clipping preserves portal entry and exit discontinuity', () => {
  const state = overtimeArena(); const player = state.players.get('p0')!;
  Object.assign(player, { x: 185, y: 200, angle: 0 });
  state.portalPairs = [{ id: 'pair', gates: [{ x: 200, y: 200, halfLength: 100 }, { x: 1000, y: 300, halfLength: 100 }], expiresAtTick: state.tick + 100 }];
  step(state, new Map());
  assert.equal(player.x, 1012);
  assert.equal(player.trail.at(-1)!.x2, 189);
  step(state, new Map());
  assert.equal(player.trail.length, 2);
  assert.equal(player.trail[0]!.x2, 189);
  assert.equal(player.trail[1]!.x1, 1012);
  assert.equal(player.trail[1]!.x2, 1019.5);
});

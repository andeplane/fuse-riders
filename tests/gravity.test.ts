import assert from 'node:assert/strict';
import test from 'node:test';
import { GRAVITY_BEND, GRAVITY_FIELD_TICKS, GRAVITY_MAX_HOLES_PER_PICKUP, GRAVITY_MAX_RADIUS, GRAVITY_MIN_RADIUS, INITIAL_BOUNDARY_INSET, MAX_GRAVITY_FIELDS, SLOT_COLORS,
  addPlayer, createGame, eliminatePlayer, gravityBend, riderMotionStep, startMatch, startNextRound, step, toSnapshot, type GameState } from '../src/shared/game.js';
import { controllerSnapshot } from '../src/server/index.js';

function playing(seed = 5): GameState {
  const state = createGame('gravity', seed);
  for (let slot = 0; slot < 2; slot += 1) addPlayer(state, { id: `p${slot}`, name: `P${slot}`, slot, color: SLOT_COLORS[slot]! });
  startMatch(state);
  while (state.phase === 'countdown') step(state, new Map());
  state.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  for (const player of state.players.values()) Object.assign(player, { x: 300, y: 200 + player.slot * 400, angle: 0, trail: [] });
  return state;
}
const hole = (state: GameState, x: number, y: number, radius: number, ticks = GRAVITY_FIELD_TICKS) =>
  state.gravityFields.push({ x, y, radius, expiresAtTick: state.tick + ticks });
const collect = (state: GameState, id = 'p0') => {
  const rider = state.players.get(id)!;
  state.pickups.push({ id: state.nextPickupId++, type: 'gravity', x: rider.x + 3, y: rider.y, expiresAtTick: state.tick + 100 });
  step(state, new Map());
};

test('the pickup opens one to three black holes of bounded size inside the walls, for eight seconds', () => {
  const counts = new Set<number>();
  for (let seed = 1; seed <= 40; seed += 1) {
    const state = playing(seed);
    collect(state);
    const fields = state.gravityFields;
    assert.ok(fields.length >= 1 && fields.length <= GRAVITY_MAX_HOLES_PER_PICKUP, `seed ${seed} opened ${fields.length}`);
    counts.add(fields.length);
    for (const field of fields) {
      assert.ok(field.radius >= GRAVITY_MIN_RADIUS && field.radius <= GRAVITY_MAX_RADIUS);
      assert.ok(field.x >= state.boundaryInset && field.x <= state.width - state.boundaryInset);
      assert.ok(field.y >= state.boundaryInset && field.y <= state.height - state.boundaryInset);
      assert.equal(field.expiresAtTick, state.tick + GRAVITY_FIELD_TICKS);
    }
    assert.equal(toSnapshot(state).gravityFields.length, fields.length, 'the holes reach the snapshot');
  }
  assert.deepEqual([...counts].sort(), [1, 2, 3], 'every count turns up across seeds');
});
test('the same seed opens the same holes, so replicas agree', () => {
  const a = playing(9), b = playing(9);
  collect(a); collect(b);
  assert.ok(a.gravityFields.length > 0);
  assert.deepEqual(a.gravityFields, b.gravityFields);
  assert.equal(a.randomState, b.randomState);
});
test('more pickups add holes up to the cap, retiring the oldest first', () => {
  const state = playing();
  for (let index = 0; index < MAX_GRAVITY_FIELDS; index += 1) hole(state, 100 + index, 100, 120);
  collect(state);
  assert.equal(state.gravityFields.length, MAX_GRAVITY_FIELDS);
  assert.ok(state.gravityFields[0]!.x > 100, 'the oldest hole made room');
});
test('a rider crossing a hole follows the curve: its heading swings toward the centre and its speed is untouched', () => {
  const state = playing(), control = playing();
  hole(state, 500, 330, 250);
  const rider = state.players.get('p0')!, free = control.players.get('p0')!;
  for (let tick = 0; tick < 20; tick += 1) {
    const fromX = rider.x, fromY = rider.y;
    step(state, new Map()); step(control, new Map());
    const { distance } = riderMotionStep(rider, state.tick, state.roundStartedTick);
    assert.ok(Math.abs(Math.hypot(rider.x - fromX, rider.y - fromY) - distance) < 1e-9, 'curved space bends the path, it does not drag');
  }
  assert.equal(free.angle, 0, 'the control rider rode straight');
  assert.ok(rider.angle > 0.1 && rider.angle < Math.PI, 'the heading turned toward the hole below');
  assert.ok(rider.y > free.y, 'and the path followed it');
});
test('a rider outside every radius is untouched', () => {
  const state = playing(), control = playing();
  hole(state, 300, 800, 150);
  for (let tick = 0; tick < 10; tick += 1) { step(state, new Map()); step(control, new Map()); }
  assert.deepEqual([state.players.get('p0')!.x, state.players.get('p0')!.y, state.players.get('p0')!.angle],
    [control.players.get('p0')!.x, control.players.get('p0')!.y, control.players.get('p0')!.angle]);
});
test('the bend is strongest near the centre, zero at the rim, zero head-on, and mirrors left to right', () => {
  const turn = 0.1, pose = { x: 0, y: 0, angle: 0 };
  const near = gravityBend([{ x: 0, y: 20, radius: 200 }], pose, turn), far = gravityBend([{ x: 0, y: 150, radius: 200 }], pose, turn);
  assert.ok(near > far && far > 0);
  assert.equal(gravityBend([{ x: 0, y: 200, radius: 200 }], pose, turn), 0, 'the rim');
  assert.equal(gravityBend([{ x: 50, y: 0, radius: 200 }], pose, turn), 0, 'riding straight at the centre');
  assert.equal(gravityBend([{ x: 0, y: -20, radius: 200 }], pose, turn), -near);
  assert.equal(gravityBend([], pose, turn), 0);
});
test('however many holes overlap, the bend stays under the rider\'s own steering, so nobody is trapped in orbit', () => {
  const turn = 0.1, pose = { x: 0, y: 0, angle: 0 };
  for (const count of [1, 2, 4, 8]) {
    const bend = gravityBend(Array.from({ length: count }, () => ({ x: 0, y: 1, radius: 300 })), pose, turn);
    assert.ok(bend <= GRAVITY_BEND * turn + 1e-12 && bend < turn, `${count} holes bent ${bend}`);
  }
  // Steering flat out against a hole still turns the rider away from it.
  const state = playing();
  const rider = state.players.get('p0')!;
  hole(state, rider.x, rider.y + 5, 300); hole(state, rider.x, rider.y + 5, 300);
  step(state, new Map([['p0', { left: true, right: false, bomb: false }]]) as never);
  assert.ok(rider.angle > Math.PI, 'a left turn won against two holes on the right');
});
test('a hole expires exactly', () => {
  const state = playing();
  hole(state, 800, 400, 150, 3);
  for (let tick = 0; tick < 2; tick += 1) { step(state, new Map()); assert.equal(state.gravityFields.length, 1); }
  step(state, new Map());
  assert.deepEqual(state.gravityFields, [], 'gone on the tick it expires');
});
test('a hole caught by the closing wall is moved back inside', () => {
  const state = playing();
  // boundaryInset is recomputed from roundStartedTick on every playing tick, so overtime has to be staged through it.
  state.roundStartedTick = state.tick - 2000;
  hole(state, 10, 400, 180);
  step(state, new Map());
  const field = state.gravityFields[0]!;
  assert.ok(state.boundaryInset > INITIAL_BOUNDARY_INSET, 'the wall actually closed, or the clamp is unexercised');
  assert.ok(field.x >= state.boundaryInset, `the hole stayed at ${field.x}, outside the wall at ${state.boundaryInset}`);
});
test('holes do not outlive their round', () => {
  const state = playing();
  hole(state, 800, 400, 150, 100_000);
  eliminatePlayer(state, 'p1');
  for (let tick = 0; tick < 400 && !(state.phase === 'roundOver' && state.tick >= (state.phaseEndsAtTick ?? 0)); tick += 1) step(state, new Map());
  assert.equal(state.gravityFields.length, 1, 'still there while the round winds down');
  startNextRound(state);
  assert.deepEqual(state.gravityFields, []);
});
// Online phones simulate the world themselves, so only the LAN controller snapshot strips the geometry it cannot draw.
test('a LAN phone is never sent the hole geometry it cannot draw', () => {
  const state = playing();
  hole(state, 400, 400, 120);
  const full = toSnapshot(state);
  assert.equal(full.gravityFields.length, 1, 'the fixture carries a hole, so the strip below is not vacuous');
  assert.deepEqual(controllerSnapshot(full).gravityFields, [], 'the LAN server strips it');
});

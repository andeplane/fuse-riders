import assert from 'node:assert/strict';
import test from 'node:test';
import { BLAST_LEVEL_RANGE, BOMB_BLAST_RANGE, COUNTDOWN_TICKS, GRAVITY_FIELD_TICKS, SLOT_COLORS, addPlayer, createGame, startMatch, step, toSnapshot, type GameState } from '../src/shared/game.js';
import { BOMB_FLIGHT_TICKS } from '../src/shared/bomb-launch.js';
import { INITIAL_BOUNDARY_INSET, RIDER_SPEED, TICK_HZ, GRAVITY_PULL_PER_TICK } from '../src/shared/game.js';
import { controllerSnapshot } from '../src/server/index.js';

const flightPath = (x: number, y: number) => Array.from({ length: BOMB_FLIGHT_TICKS + 1 }, () => ({ x, y, angle: 0 }));
function playing(seed = 5): GameState {
  const state = createGame('gravity', seed);
  for (let slot = 0; slot < 2; slot += 1) addPlayer(state, { id: `p${slot}`, name: `P${slot}`, slot, color: SLOT_COLORS[slot]! });
  startMatch(state);
  while (state.phase === 'countdown') step(state, new Map());
  state.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  for (const player of state.players.values()) Object.assign(player, { x: 300, y: 200 + player.slot * 400, angle: 0, trail: [] });
  return state;
}
/** A bomb already due this tick, so the field opens on the next step. */
const dueBomb = (state: GameState, x: number, y: number, gravity: boolean, blastRange = BOMB_BLAST_RANGE) =>
  state.bombs.set(1, { id: 1, ownerId: 'p1', launchX: x, launchY: y, x, y, placedTick: 0, launchedTick: 0, landsAtTick: 0,
    explodeAtTick: state.tick, blastRange, flightPath: flightPath(x, y), ...(gravity ? { gravity: true } : {}) });

test('a gravity bomb leaves a field for four seconds; an ordinary one leaves none', () => {
  const state = playing();
  dueBomb(state, 900, 200, true);
  step(state, new Map());
  assert.equal(state.gravityFields.length, 1, 'the blast opened a field');
  const field = state.gravityFields[0]!;
  assert.equal(field.expiresAtTick, state.tick + GRAVITY_FIELD_TICKS);
  assert.equal(toSnapshot(state).gravityFields.length, 1, 'the field reaches the snapshot');
  const plain = playing();
  dueBomb(plain, 900, 200, false);
  step(plain, new Map());
  assert.deepEqual(plain.gravityFields, []);
});
test('the field drags a rider toward its centre without ever holding it still', () => {
  const state = playing(), control = playing();
  state.gravityFields.push({ bombId: 1, ownerId: 'p1', x: 300, y: 260, radius: 200, expiresAtTick: state.tick + GRAVITY_FIELD_TICKS });
  const rider = state.players.get('p0')!, free = control.players.get('p0')!;
  for (let tick = 0; tick < 20; tick += 1) {
    const before = rider.x;
    step(state, new Map()); step(control, new Map());
    assert.ok(rider.x > before, 'a dragged rider still advances every tick');
  }
  assert.ok(rider.y > free.y, 'it has been pulled toward the centre');
  assert.ok(rider.x < free.x, 'and has lost ground doing so');
});
test('a field expires exactly, and the arena is clear of fields once it does', () => {
  const state = playing();
  state.gravityFields.push({ bombId: 1, ownerId: 'p1', x: 800, y: 400, radius: 150, expiresAtTick: state.tick + 3 });
  for (let tick = 0; tick < 2; tick += 1) { step(state, new Map()); assert.equal(state.gravityFields.length, 1); }
  step(state, new Map());
  assert.deepEqual(state.gravityFields, [], 'gone on the tick it expires');
});
test('blast level widens the field the same way it widens the blast', () => {
  for (const level of [0, 1, 2] as const) {
    const state = playing();
    dueBomb(state, 900, 200, true, BOMB_BLAST_RANGE + level * BLAST_LEVEL_RANGE);
    step(state, new Map());
    assert.equal(state.gravityFields[0]!.radius, BOMB_BLAST_RANGE + level * BLAST_LEVEL_RANGE, `level ${level}`);
  }
});
test('a rider outside the radius is untouched, so the pull is local', () => {
  const state = playing(), control = playing();
  state.gravityFields.push({ bombId: 1, ownerId: 'p1', x: 300, y: 1200, radius: 100, expiresAtTick: state.tick + GRAVITY_FIELD_TICKS });
  for (let tick = 0; tick < 10; tick += 1) { step(state, new Map()); step(control, new Map()); }
  assert.equal(state.players.get('p0')!.x, control.players.get('p0')!.x);
  assert.equal(state.players.get('p0')!.y, control.players.get('p0')!.y);
});

const inputsFor = (id: string, intent: Record<string, unknown>) => new Map([[id, { left: false, right: false, bomb: false, ...intent }]]) as never;
const MOVE_PER_TICK = RIDER_SPEED / TICK_HZ;
const travelled = (state: GameState, id: string) => {
  const rider = state.players.get(id)!, fromX = rider.x, fromY = rider.y;
  step(state, new Map());
  return Math.hypot(rider.x - fromX, rider.y - fromY);
};

test('a rider steering away is slowed but never held: net travel stays above the cap, however many fields overlap', () => {
  // The cap applies to the summed drag, so the floor is (1 - GRAVITY_PULL_PER_TICK) of a tick's travel whatever the stack.
  const floor = MOVE_PER_TICK * (1 - GRAVITY_PULL_PER_TICK);
  for (const fields of [1, 2, 4, 8]) {
    const state = playing();
    const rider = state.players.get('p0')!;
    for (let index = 0; index < fields; index += 1) {
      state.gravityFields.push({ bombId: index + 1, ownerId: 'p1', x: rider.x - 1, y: rider.y, radius: 200, expiresAtTick: state.tick + GRAVITY_FIELD_TICKS });
    }
    const moved = travelled(state, 'p0');
    assert.ok(moved >= floor - 1e-9, `${fields} fields dragged a rider to ${moved}, below the ${floor} floor`);
  }
});
test('the pull falls off with distance: dead centre drags hardest, the rim not at all', () => {
  const near = playing(), far = playing(), rim = playing(), control = playing();
  const place = (state: GameState, x: number, y: number) => {
    state.gravityFields.push({ bombId: 1, ownerId: 'p1', x, y, radius: 200, expiresAtTick: state.tick + GRAVITY_FIELD_TICKS });
  };
  const start = control.players.get('p0')!;
  place(near, start.x, start.y + 10); place(far, start.x, start.y + 150);
  // The pull is evaluated at the advanced pose, which is exactly where the unpulled control rider lands, so placing
  // the rim field 200 from there puts the rider at away === radius. Measured from the pre-step pose it sits at
  // 200.14, just outside. This pins the boundary as specification; it does not distinguish `>=` from `>`, since the
  // falloff term is already zero at the rim either way.
  step(control, new Map());
  const landed = control.players.get('p0')!;
  place(rim, landed.x, landed.y + 200);
  for (const state of [near, far, rim]) step(state, new Map());
  const drift = (state: GameState) => state.players.get('p0')!.y - landed.y;
  assert.ok(drift(near) > drift(far), 'closer to the centre pulls harder');
  assert.ok(drift(far) > 0, 'inside the radius still pulls');
  assert.equal(drift(rim), 0, 'a rider exactly at the rim is untouched');
});
test('one armed pickup opens one field, even when the launch is a volley', () => {
  const state = playing();
  const rider = state.players.get('p0')!;
  Object.assign(rider, { x: 500, y: 500, angle: 0, gravityArmed: true, tripleShotArmed: true, bombReadyAtTick: state.tick });
  step(state, inputsFor('p0', { bomb: true, bombCommands: [{ action: 'press' }] }));
  step(state, inputsFor('p0', { bombCommands: [{ action: 'release' }] }));
  const bombs = [...state.bombs.values()];
  assert.equal(bombs.length, 3, 'a triple volley launched');
  assert.equal(bombs.filter(bomb => bomb.gravity).length, 1, 'exactly one bomb carries the field');
  assert.equal(state.players.get('p0')!.gravityArmed, false, 'the pickup was consumed');
});
test('a target bomb leaves the pickup armed for an ordinary launch', () => {
  const state = playing();
  const rider = state.players.get('p0')!;
  Object.assign(rider, { x: 500, y: 500, angle: 0, gravityArmed: true, targetBombArmed: true, bombReadyAtTick: state.tick });
  step(state, inputsFor('p0', { bomb: true, bombCommands: [{ action: 'press' }], aim: { x: .5, y: .5 } }));
  step(state, inputsFor('p0', { bombCommands: [{ action: 'release' }], aim: { x: .5, y: .5 } }));
  assert.deepEqual([...state.bombs.values()].filter(bomb => bomb.gravity), [], 'a placed, instant blast does not open a field');
  assert.equal(state.players.get('p0')!.gravityArmed, true, 'so the pickup is still there for the next throw');
});
test('a field caught by the closing wall is pulled back inside, so it cannot drag a rider out', () => {
  const state = playing();
  // Overtime has to be staged the way the simulation computes it: boundaryInset is recomputed from roundStartedTick
  // on every playing tick, so poking the inset directly is overwritten before the clamp ever runs. Staged this way
  // the clamp reaches the live wall (~420) where the previous ordering reached last tick's (20), so this pins which.
  state.roundStartedTick = state.tick - 2000;
  state.gravityFields.push({ bombId: 1, ownerId: 'p1', x: 10, y: 400, radius: 180, expiresAtTick: state.tick + GRAVITY_FIELD_TICKS });
  step(state, new Map());
  const field = state.gravityFields[0]!;
  assert.ok(state.boundaryInset > INITIAL_BOUNDARY_INSET, 'the wall actually closed, or the clamp is unexercised');
  assert.ok(field.x >= state.boundaryInset, `the field stayed at ${field.x}, outside the wall at ${state.boundaryInset}`);
});
// Online phones simulate the world themselves, so only the LAN controller snapshot strips the field geometry it cannot draw.
test('a LAN phone is never sent the field geometry it cannot draw', () => {
  const state = playing();
  state.gravityFields.push({ bombId: 0, ownerId: 'p1', x: 400, y: 400, radius: 90, expiresAtTick: state.tick + GRAVITY_FIELD_TICKS });
  const full = toSnapshot(state);
  assert.equal(full.gravityFields.length, 1, 'the fixture carries a field, so the strips below are not vacuous');
  assert.deepEqual(controllerSnapshot(full).gravityFields, [], 'the LAN server strips it');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { BLAST_LEVEL_RANGE, BOMB_BLAST_RANGE, COUNTDOWN_TICKS, GRAVITY_FIELD_TICKS, SLOT_COLORS, addPlayer, createGame, startMatch, step, toSnapshot, type GameState } from '../src/shared/game.js';
import { BOMB_FLIGHT_TICKS } from '../src/shared/bomb-launch.js';

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

import assert from 'node:assert/strict';
import test from 'node:test';
import { COUNTDOWN_TICKS, RIDER_RADIUS, SLOT_COLORS, addPlayer, createGame, startMatch, step, type GameState } from '../src/shared/game.js';

/** Two riders in the playing phase, clear of walls, trails and pickups. `order` decides who is added first. */
function pair(order: readonly [number, number] = [0, 1]): GameState {
  const state = createGame('rider-collision', 5);
  for (const slot of order) addPlayer(state, { id: `p${slot}`, name: `P${slot}`, slot, color: SLOT_COLORS[slot]! });
  startMatch(state);
  for (let tick = 0; tick < COUNTDOWN_TICKS + 1 && state.phase === 'countdown'; tick += 1) step(state, new Map());
  state.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  return state;
}
const place = (state: GameState, id: string, x: number, y: number, angle: number) =>
  Object.assign(state.players.get(id)!, { x, y, angle, trail: [] });
const eliminated = (result: ReturnType<typeof step>) =>
  result.events.filter(event => event.type === 'playerEliminated').map(event => event.playerId).sort();

test('riders holding a steady gap survive, though their paths pass closer than their bodies ever do', () => {
  const state = pair();
  // 20 apart, both heading right at 7.5 a tick: the centres stay 20 apart at every instant, but the two path
  // segments come within 12.5 -- under the 14-unit body threshold. That gap is what used to kill both (#186).
  place(state, 'p0', 500, 350, 0);
  place(state, 'p1', 520, 350, 0);
  const result = step(state, new Map());
  assert.deepEqual(eliminated(result), [], 'neither rider was ever within 14 units of the other');
  assert.ok(state.players.get('p0')!.alive && state.players.get('p1')!.alive);
});

test('a real head-on still kills both, so the fix does not hand out immunity', () => {
  const state = pair();
  place(state, 'p0', 500, 350, 0);
  place(state, 'p1', 520, 350, Math.PI);
  const result = step(state, new Map());
  assert.deepEqual(eliminated(result), ['p0', 'p1']);
  assert.ok([...state.matchStats.values()].every(entry => entry.deathsByCause.rider === 1));
});

test('riders already overlapping when the tick begins both die, whatever they do next', () => {
  const state = pair();
  place(state, 'p0', 500, 350, 0);
  place(state, 'p1', 500 + RIDER_RADIUS, 350, 0);
  assert.deepEqual(eliminated(step(state, new Map())), ['p0', 'p1']);
});

test('the verdict does not depend on which rider was added first', () => {
  for (const order of [[0, 1], [1, 0]] as const) {
    const survive = pair(order);
    place(survive, 'p0', 500, 350, 0);
    place(survive, 'p1', 520, 350, 0);
    assert.deepEqual(eliminated(step(survive, new Map())), [], `order ${order} changed the near miss`);
    const collide = pair(order);
    place(collide, 'p0', 500, 350, 0);
    place(collide, 'p1', 520, 350, Math.PI);
    assert.deepEqual(eliminated(step(collide, new Map())), ['p0', 'p1'], `order ${order} changed the head-on`);
  }
});

// The three below exist because each kills a mutation the cases above let through. Without them the body radius
// could be halved, the search could ignore the back half of the tick, or contact could be invented from before it.
test('riders whose bodies overlap for the whole tick die, which is what pins the body width itself', () => {
  const state = pair();
  // 10 apart with matched velocity: never closing, but 10 is inside 2 * RIDER_RADIUS, so they are always touching.
  place(state, 'p0', 500, 350, 0);
  place(state, 'p1', 510, 350, 0);
  assert.deepEqual(eliminated(step(state, new Map())), ['p0', 'p1'], 'a pair inside two body radii must die');
});

test('contact reached only at the very end of the tick still kills', () => {
  const state = pair();
  // Closing 15 a tick from 23.5 apart: they are 8.5 apart exactly at t = 1, and never closer beforehand. A search
  // that gave up half way through the tick would call this a miss.
  place(state, 'p0', 500, 350, 0);
  place(state, 'p1', 523.5, 350, Math.PI);
  assert.deepEqual(eliminated(step(state, new Map())), ['p0', 'p1'], 'the whole tick is searched, not its first half');
});

test('riders riding apart survive, so contact cannot be borrowed from before the tick began', () => {
  const state = pair();
  // Back to back at 15 apart, each leaving: the gap only grows. Extending the search before t = 0 would find the
  // overlap they had a moment earlier and kill them for it.
  place(state, 'p0', 500, 350, Math.PI);
  place(state, 'p1', 515, 350, 0);
  assert.deepEqual(eliminated(step(state, new Map())), [], 'separating riders were never in contact during this tick');
});

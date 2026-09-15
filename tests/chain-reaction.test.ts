import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNTDOWN_TICKS, SLOT_COLORS, addPlayer, createGame, startMatch, step, type GameState } from '../src/shared/game.js';
import { BOMB_FLIGHT_TICKS } from '../src/shared/bomb-launch.js';
import { defaultRoomSettings, parseRoomSettings } from '../src/shared/room-settings.js';

const flightPath = (x: number, y: number) => Array.from({ length: BOMB_FLIGHT_TICKS + 1 }, () => ({ x, y, angle: 0 }));
/** Two bombs side by side: the first is due this tick, the second sits inside its blast with a fuse far in the future. */
function twoBombs(chainReaction: boolean, fuse = 500): GameState {
  const state = createGame('chain', 7);
  for (let slot = 0; slot < 2; slot += 1) addPlayer(state, { id: `p${slot}`, name: `Player ${slot + 1}`, slot, color: SLOT_COLORS[slot]! });
  state.settings = { ...defaultRoomSettings(), chainReaction };
  startMatch(state);
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick += 1) step(state, new Map());
  for (const [id, x] of [['p0', 1000], ['p1', 1200]] as const) { const player = state.players.get(id)!; player.x = x; player.y = 700; }
  const common = { launchX: 500, launchY: 450, placedTick: 0, launchedTick: 0, landsAtTick: 0, blastRange: 150 };
  state.bombs.set(1, { ...common, id: 1, ownerId: 'p0', x: 500, y: 450, explodeAtTick: state.tick, flightPath: flightPath(500, 450) });
  state.bombs.set(2, { ...common, id: 2, ownerId: 'p1', x: 560, y: 450, explodeAtTick: state.tick + fuse, flightPath: flightPath(560, 450) });
  return state;
}
const explosions = (result: ReturnType<typeof step>) => result.events.filter(event => event.type === 'explosion').map(event => (event as { bombId: number }).bombId);

test('a bomb caught in the blast goes with it while chaining is on', () => {
  const state = twoBombs(true);
  assert.deepEqual(explosions(step(state, new Map())), [1, 2]);
  assert.equal(state.bombs.size, 0);
});
test('with chaining off the caught bomb keeps its own fuse', () => {
  const state = twoBombs(false);
  assert.deepEqual(explosions(step(state, new Map())), [1]);
  assert.equal(state.bombs.has(2), true, 'the second bomb survives its neighbour');
  // Nor does it catch on a blast that is still on the field a tick later.
  assert.deepEqual(explosions(step(state, new Map())), []);
  assert.equal(state.bombs.has(2), true);
});
test('with chaining off a caught bomb still fires on its own fuse, it is not stranded', () => {
  const state = twoBombs(false, 3);
  assert.deepEqual(explosions(step(state, new Map())), [1]);
  assert.deepEqual(explosions(step(state, new Map())), [], 'it does not go with its neighbour');
  assert.deepEqual(explosions(step(state, new Map())), [2], 'its own fuse still fires');
  assert.equal(state.bombs.size, 0);
});
test('a game with no settings at all still chains, as it did before the toggle', () => {
  const state = twoBombs(true);
  state.settings = undefined;
  assert.deepEqual(explosions(step(state, new Map())), [1, 2]);
});
test('settings saved before the toggle keep chaining, and a non-boolean is refused', () => {
  const { chainReaction, ...older } = defaultRoomSettings();
  assert.equal(chainReaction, true, 'the default is on');
  assert.equal(parseRoomSettings(older)?.chainReaction, true, 'an older payload defaults to on');
  assert.equal(parseRoomSettings({ ...defaultRoomSettings(), chainReaction: false })?.chainReaction, false, 'off survives a round trip');
  assert.equal(parseRoomSettings({ ...defaultRoomSettings(), chainReaction: 'yes' }), undefined);
});

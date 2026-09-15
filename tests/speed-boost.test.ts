import assert from 'node:assert/strict';
import test from 'node:test';
import { BOOST_DURATION_TICKS, BOOST_SPEED, addPlayer, createGame, eliminatePlayer, startMatch, startNextRound, step, toSnapshot } from '../src/shared/game.js';

function playing(seed = 11) {
  const game = createGame('boost', seed);
  for (let slot = 0; slot < 3; slot += 1) addPlayer(game, { id: `p${slot}`, name: `P${slot}`, slot, color: '#fff' });
  startMatch(game);
  while (game.phase === 'countdown') step(game, new Map());
  // One rider per row: these tests run for whole seconds, and a rider crossing another's line would end the measurement early.
  for (const player of game.players.values()) Object.assign(player, { x: 200, y: 150 + player.slot * 250, angle: 0, trail: [] });
  return game;
}
const travelled = (game: ReturnType<typeof playing>, id: string) => {
  const before = game.players.get(id)!.x;
  step(game, new Map());
  return game.players.get(id)!.x - before;
};

test('the boost pickup carries a rider a quarter faster until its deadline, then hands the speed back', () => {
  const game = playing(); const control = playing();
  const rider = game.players.get('p0')!;
  game.pickups.push({ id: 1, type: 'boost', x: rider.x + 3, y: rider.y, expiresAtTick: game.tick + 100 });
  // Movement resolves before pickups are collected, so touching a boost does not speed up the tick you reach it on.
  assert.ok(Math.abs(travelled(game, 'p0') - travelled(control, 'p0')) < 1e-9, 'the tick you collect on is ordinary speed');
  assert.equal(rider.boostUntilTick, game.tick + BOOST_DURATION_TICKS, 'the deadline is absolute, three seconds out');
  const boosted = travelled(game, 'p0'), plain = travelled(control, 'p0');
  assert.ok(Math.abs(boosted - plain * BOOST_SPEED) < 1e-9, `boosted ${boosted} should be ${BOOST_SPEED}x of ${plain}`);
  assert.equal(toSnapshot(game).players.find(player => player.id === 'p0')!.boostUntilTick, rider.boostUntilTick);
  while (game.tick <= rider.boostUntilTick) { step(game, new Map()); step(control, new Map()); }
  assert.ok(Math.abs(travelled(game, 'p0') - travelled(control, 'p0')) < 1e-9, 'ordinary speed again once the deadline has passed');
  assert.equal(game.players.get('p0')!.alive, true, 'the measurement ran on a living rider throughout');
});
test('a second boost refreshes the deadline rather than stacking, and leaves rivals alone', () => {
  const game = playing();
  const rider = game.players.get('p0')!;
  game.pickups.push({ id: 1, type: 'boost', x: rider.x + 3, y: rider.y, expiresAtTick: game.tick + 100 });
  step(game, new Map());
  const first = rider.boostUntilTick;
  for (let tick = 0; tick < 10; tick += 1) step(game, new Map());
  game.pickups.push({ id: 2, type: 'boost', x: rider.x + 3, y: rider.y, expiresAtTick: game.tick + 100 });
  step(game, new Map());
  assert.equal(rider.boostUntilTick, game.tick + BOOST_DURATION_TICKS, 'refreshed from the second pickup, not added to the first');
  assert.ok(rider.boostUntilTick > first && rider.boostUntilTick < first + BOOST_DURATION_TICKS, 'a refresh is not a stack');
  for (const other of ['p1', 'p2']) assert.equal(game.players.get(other)!.boostUntilTick, 0, 'a boost is the collector\'s alone');
});
test('a boost does not survive the round that granted it', () => {
  const game = playing();
  const rider = game.players.get('p0')!;
  game.pickups.push({ id: 1, type: 'boost', x: rider.x + 3, y: rider.y, expiresAtTick: game.tick + 100 });
  step(game, new Map());
  assert.ok(rider.boostUntilTick > game.tick);
  for (const id of ['p1', 'p2']) eliminatePlayer(game, id);
  while (game.phase === 'playing') step(game, new Map()); // the round ends inside step, not on elimination
  game.tick = game.phaseEndsAtTick!;
  startNextRound(game);
  assert.equal(game.players.get('p0')!.boostUntilTick, 0);
});

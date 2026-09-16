import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BOOST_DURATION_TICKS, BOOST_SPEED, MAX_SPEED_EFFECT_STACK, NITRO_DURATION_TICKS, NITRO_SPEED, SNAIL_DURATION_TICKS, SNAIL_SPEED,
  SLOT_COLORS, addPlayer, createGame, eliminatePlayer, riderMotionStep, riderSpeedMultiplier, startMatch, startNextRound, step, toSnapshot, type GameState, type PickupType,
} from '../src/shared/game.js';
import { decodeGameState, encodeGameState } from '../src/online/checkpoint.js';
import { speedEffectLabel } from '../src/client/power-indicator.js';
import { POWERUP_GUIDE } from '../src/client/powerup-guide.js';

// Nitro and Snail are the stacking speed pickups: every collection is its own five-second deadline, so unlike the
// refreshing boost, two Nitros run at four times speed until the first expires, and a Snail cancels a Nitro one for one.
function playing(seed = 11) {
  const game = createGame('stack', seed);
  for (let slot = 0; slot < 3; slot += 1) addPlayer(game, { id: `p${slot}`, name: `P${slot}`, slot, color: SLOT_COLORS[slot]! });
  startMatch(game);
  while (game.phase === 'countdown') step(game, new Map());
  game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER; // a random drop landing in one game and not the other would skew the comparison
  // One rider per row, far from the walls: these tests run for whole seconds at up to four times speed.
  for (const player of game.players.values()) Object.assign(player, { x: 100, y: 150 + player.slot * 250, angle: 0, trail: [] });
  return game;
}
/** Wraps riders nearing the far wall back to the start: a Nitro rider covers the arena in under three seconds. */
const wrap = (game: GameState) => { for (const player of game.players.values()) if (player.x > 1200) Object.assign(player, { x: 100, trail: [] }); };
const travelled = (game: GameState, id: string) => {
  wrap(game);
  const before = game.players.get(id)!.x;
  step(game, new Map());
  return game.players.get(id)!.x - before;
};
const both = (game: GameState, control: GameState) => { wrap(game); wrap(control); step(game, new Map()); step(control, new Map()); };
/** Drops a pickup on a rider's nose, so the next step collects it. */
const drop = (game: GameState, id: string, type: PickupType) => {
  const rider = game.players.get(id)!;
  game.pickups.push({ id: game.nextPickupId++, type, x: rider.x + 3, y: rider.y, expiresAtTick: game.tick + 100 });
};
/** Advances both games one tick and returns the ratio of the rider's stride to the untouched control's. */
const ratio = (game: GameState, control: GameState, id: string) => {
  const stride = travelled(game, id), plain = travelled(control, id);
  assert.ok(plain > 0, 'the control rider moved');
  return stride / plain;
};
const close = (actual: number, expected: number, why: string) => assert.ok(Math.abs(actual - expected) < 1e-9, `${why}: ${actual} should be ${expected}`);

test('Nitro doubles the collector for five seconds, on distance alone, then hands the speed back', () => {
  const game = playing(), control = playing();
  const rider = game.players.get('p0')!;
  drop(game, 'p0', 'nitro');
  // Movement resolves before pickups are collected, so touching Nitro does not speed up the tick you reach it on.
  close(ratio(game, control, 'p0'), 1, 'the tick you collect on is ordinary speed');
  assert.deepEqual(rider.nitroUntilTicks, [game.tick + NITRO_DURATION_TICKS], 'one absolute deadline, five seconds out');
  assert.equal(NITRO_DURATION_TICKS, 100);
  close(ratio(game, control, 'p0'), NITRO_SPEED, 'the next tick is at double speed');
  const { turn } = riderMotionStep(rider, game.tick, game.roundStartedTick), plainTurn = riderMotionStep(control.players.get('p0')!, control.tick, control.roundStartedTick).turn;
  close(turn, plainTurn, 'steering is unchanged, so a fast rider turns wide');
  while (game.tick < rider.nitroUntilTicks[0]! - 2) both(game, control);
  close(ratio(game, control, 'p0'), NITRO_SPEED, 'the last tick under the deadline is still doubled');
  const deadline = rider.nitroUntilTicks[0]!;
  close(ratio(game, control, 'p0'), 1, 'the deadline tick itself is ordinary speed again');
  assert.equal(game.tick, deadline);
  assert.deepEqual(rider.nitroUntilTicks, [], 'a spent deadline leaves the state, so replicas never carry stale ones');
  for (const other of ['p1', 'p2']) assert.deepEqual(game.players.get(other)!.nitroUntilTicks, [], 'Nitro is the collector\'s alone');
  assert.equal(rider.alive, true, 'the measurement ran on a living rider throughout');
});

test('two Nitros stack to four times speed until the first expires, then two, then one', () => {
  const game = playing(), control = playing();
  const rider = game.players.get('p0')!;
  drop(game, 'p0', 'nitro'); both(game, control);
  const first = rider.nitroUntilTicks[0]!;
  for (let tick = 0; tick < 20; tick += 1) both(game, control);
  drop(game, 'p0', 'nitro'); both(game, control);
  assert.deepEqual(rider.nitroUntilTicks, [first, game.tick + NITRO_DURATION_TICKS], 'the second is its own deadline, not a refresh of the first');
  close(ratio(game, control, 'p0'), NITRO_SPEED * NITRO_SPEED, 'two Nitros multiply to four times');
  while (game.tick < first) both(game, control);
  assert.deepEqual(rider.nitroUntilTicks, [first + 21], 'only the later deadline remains once the first is spent');
  close(ratio(game, control, 'p0'), NITRO_SPEED, 'back to double speed on the second alone');
  while (game.tick < rider.nitroUntilTicks[0]!) both(game, control);
  close(ratio(game, control, 'p0'), 1, 'and to ordinary speed once both are spent');
});

test('Snail halves every living rival for five seconds and leaves the collector alone', () => {
  const game = playing(), control = playing();
  eliminatePlayer(game, 'p2'); eliminatePlayer(control, 'p2'); // a dead rider is not a rival, and must not carry the effect into its next round
  drop(game, 'p0', 'snail'); step(game, new Map()); step(control, new Map());
  const collector = game.players.get('p0')!, rival = game.players.get('p1')!;
  assert.deepEqual(collector.snailUntilTicks, [], 'the collector is never slowed by their own Snail');
  assert.deepEqual(rival.snailUntilTicks, [game.tick + SNAIL_DURATION_TICKS]);
  assert.deepEqual(game.players.get('p2')!.snailUntilTicks, [], 'the eliminated rider was not a target');
  assert.equal(SNAIL_DURATION_TICKS, 100);
  close(ratio(game, control, 'p0'), 1, 'the collector keeps ordinary speed');
  const before = rival.x; step(game, new Map()); const slowed = rival.x - before;
  const plainBefore = control.players.get('p1')!.x; step(control, new Map()); const plain = control.players.get('p1')!.x - plainBefore;
  close(slowed / plain, SNAIL_SPEED, 'the rival crawls at half speed');
  while (game.tick < rival.snailUntilTicks[0]!) both(game, control);
  close(ratio(game, control, 'p1'), 1, 'the rival is back to ordinary speed on the deadline tick');
});

test('Snails stack on a rival, and a Snail cancels a Nitro one for one, with the boost multiplying on top', () => {
  const game = playing(), control = playing();
  drop(game, 'p0', 'snail'); drop(game, 'p0', 'snail'); step(game, new Map()); step(control, new Map());
  const rival = game.players.get('p1')!;
  assert.equal(rival.snailUntilTicks.length, 2, 'both Snails from one tick land as two deadlines');
  close(ratio(game, control, 'p1'), SNAIL_SPEED * SNAIL_SPEED, 'two Snails leave a rival at a quarter speed');
  // Now the rival collects one Nitro: one of the two Snails is cancelled and the other still halves.
  drop(game, 'p1', 'nitro'); step(game, new Map()); step(control, new Map());
  close(ratio(game, control, 'p1'), SNAIL_SPEED, 'one Nitro cancels one of two Snails');
  drop(game, 'p1', 'nitro'); step(game, new Map()); step(control, new Map());
  close(ratio(game, control, 'p1'), 1, 'two Nitros against two Snails is exactly ordinary speed');
  drop(game, 'p1', 'boost'); step(game, new Map()); step(control, new Map());
  assert.equal(rival.boostUntilTick, game.tick + BOOST_DURATION_TICKS);
  close(ratio(game, control, 'p1'), BOOST_SPEED, 'the boost is one more factor in the same product');
  assert.equal(riderSpeedMultiplier({ boostUntilTick: 0, nitroUntilTicks: [10, 10, 10], snailUntilTicks: [10] }, 5), 4, 'three Nitros and a Snail multiply to four');
  assert.equal(riderSpeedMultiplier({ boostUntilTick: 0, nitroUntilTicks: [5], snailUntilTicks: [6] }, 5), SNAIL_SPEED, 'a deadline equal to the tick has expired; a later one has not');
});

test('speed deadlines stay sorted, are bounded, and are cleared by a new round', () => {
  const game = playing();
  const rider = game.players.get('p0')!;
  // Collect out of order by hand-setting an earlier deadline, then collecting a later one: the list stays ascending, so
  // the earliest to expire is first on every replica regardless of collection order.
  const late = game.tick + 500; rider.nitroUntilTicks = [late];
  drop(game, 'p0', 'nitro'); step(game, new Map());
  assert.deepEqual(rider.nitroUntilTicks, [game.tick + NITRO_DURATION_TICKS, late]);
  // A full stack of Nitros cancelled by a full stack of Snails, so the rider still moves at ordinary speed and survives.
  rider.nitroUntilTicks = Array.from({ length: MAX_SPEED_EFFECT_STACK }, () => game.tick + 500);
  rider.snailUntilTicks = [...rider.nitroUntilTicks];
  assert.equal(riderSpeedMultiplier(rider, game.tick), 1);
  drop(game, 'p0', 'nitro'); step(game, new Map());
  assert.equal(rider.nitroUntilTicks.length, MAX_SPEED_EFFECT_STACK, 'a full stack drops the extra rather than growing without bound');
  assert.equal(game.pickups.length, 0, 'the pickup was still consumed');
  drop(game, 'p0', 'snail'); step(game, new Map());
  assert.ok(game.players.get('p1')!.snailUntilTicks.length === 1 && rider.nitroUntilTicks.length === MAX_SPEED_EFFECT_STACK);
  const shown = toSnapshot(game).players;
  assert.deepEqual(shown.find(player => player.id === 'p0')!.nitroUntilTicks, rider.nitroUntilTicks, 'the snapshot carries every deadline for the HUD and prediction');
  assert.deepEqual(shown.find(player => player.id === 'p1')!.snailUntilTicks, game.players.get('p1')!.snailUntilTicks);
  for (const id of ['p1', 'p2']) eliminatePlayer(game, id);
  while (game.phase === 'playing') step(game, new Map()); // the round ends inside step, not on elimination
  game.tick = game.phaseEndsAtTick!;
  startNextRound(game);
  for (const player of game.players.values()) { assert.deepEqual(player.nitroUntilTicks, []); assert.deepEqual(player.snailUntilTicks, []); }
});

test('checkpoints carry the deadlines exactly and reject lists past the stack bound or holding non-integers', () => {
  const game = playing();
  drop(game, 'p0', 'nitro'); drop(game, 'p0', 'snail'); step(game, new Map());
  const restored = decodeGameState(encodeGameState(game));
  assert.ok(restored);
  assert.deepEqual(restored.players.get('p0')!.nitroUntilTicks, game.players.get('p0')!.nitroUntilTicks);
  assert.deepEqual(restored.players.get('p1')!.snailUntilTicks, game.players.get('p1')!.snailUntilTicks);
  const corrupt = (change: (player: Record<string, unknown>) => void) => {
    const data = JSON.parse(encodeGameState(game)) as { players: { $map: [string, Record<string, unknown>][] } };
    change(data.players.$map[0]![1]); return decodeGameState(JSON.stringify(data));
  };
  assert.equal(corrupt(player => { player.nitroUntilTicks = Array.from({ length: MAX_SPEED_EFFECT_STACK + 1 }, () => 5); }), undefined, 'more deadlines than the stack bound');
  assert.equal(corrupt(player => { player.snailUntilTicks = [1.5]; }), undefined, 'a fractional deadline');
  assert.equal(corrupt(player => { player.snailUntilTicks = 7; }), undefined, 'a deadline that is not a list');
  assert.ok(corrupt(player => { player.nitroUntilTicks = []; }), 'an empty list is the ordinary case');
});

test('the phone chip shows the stacked factor and the longest time left, and the guide explains stacking', () => {
  assert.equal(speedEffectLabel('NITRO', NITRO_SPEED, [], 100), 'NITRO · --');
  assert.equal(speedEffectLabel('NITRO', NITRO_SPEED, [100, 40], 100), 'NITRO · --', 'a deadline on this tick has expired');
  assert.equal(speedEffectLabel('NITRO', NITRO_SPEED, [164, 130], 100), 'NITRO · ×4 · 3.2s');
  assert.equal(speedEffectLabel('SLOWED', SNAIL_SPEED, [150], 100), 'SLOWED · ×0.5 · 2.5s');
  const guide = (type: string) => POWERUP_GUIDE.find(entry => entry.type === type)!;
  assert.equal(guide('nitro').name, 'NITRO'); assert.match(guide('nitro').description, /2× speed for 5s.*stacks.*4×/);
  assert.equal(guide('snail').name, 'SNAIL'); assert.match(guide('snail').description, /rivals crawl at 0\.5× speed for 5s.*cancels a Nitro/);
  assert.ok(guide('nitro').spawnsByDefault && guide('snail').spawnsByDefault, 'both are in the default drop table');
});

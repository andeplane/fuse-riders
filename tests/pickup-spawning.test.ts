import test from 'node:test';
import assert from 'node:assert/strict';
import { addPlayer, createGame, startMatch, step, eliminatePlayer, COUNTDOWN_TICKS, SLOT_COLORS, type InputIntent } from '../src/shared/game.js';
import { BOT_ID_PREFIX } from '../src/shared/bot-controller.js';
import { pickupPacing } from '../src/shared/power-progression.js';
import { decodeGameState, encodeGameState } from '../src/online/checkpoint.js';

function playing(count: number) {
  const game = createGame('pickup-pacing', 8192);
  // Mixed humans/bots use the same spawning rules. No bot controller runs in this scheduling fixture.
  for (let i = 0; i < count; i++) addPlayer(game, { id: i === 0 ? 'human' : `${BOT_ID_PREFIX}${i}`, name: `Rider ${i}`, slot: i, color: SLOT_COLORS[i]! });
  startMatch(game);
  for (let i = 0; i < COUNTDOWN_TICKS; i++) step(game, new Map());
  // Keep riders alive and away from the pickup fixture during the scheduling checks.
  for (const [i, player] of [...game.players.values()].entries()) Object.assign(player, { x: 300 + i * 250, y: 600, angle: 0, trail: [], invulnerableUntilTick: 10000 });
  const inputs = new Map<string, InputIntent>([...game.players.keys()].map(id => [id, { left: true, right: false, bomb: false }]));
  return { game, inputs };
}

test('two through five living riders spawn one pickup per scheduled tick, never a batch', () => {
  for (const count of [2, 3, 4, 5]) {
    const { game, inputs } = playing(count);
    const start = game.tick, interval = pickupPacing(count).interval;
    assert.equal(game.nextPickupSpawnTick, start + interval, 'initial delay uses the population too');
    const issuedAt: number[] = [];
    for (let i = 0; i < 80; i++) {
      const previousId = game.nextPickupId;
      step(game, inputs);
      assert.ok(game.nextPickupId - previousId <= 1, 'at most one new pickup on a tick');
      if (game.nextPickupId !== previousId) issuedAt.push(game.tick - start);
    }
    assert.deepEqual(issuedAt, Array.from({ length: Math.floor(80 / interval) }, (_, i) => (i + 1) * interval));
  }
});

test('waiting riders do not affect spawning; overdue schedules issue one pickup and replay identically', () => {
  const { game, inputs } = playing(2);
  addPlayer(game, { id: 'waiting', name: 'Waiting', slot: 2, color: SLOT_COLORS[2]! });
  assert.equal(game.players.get('waiting')!.alive, false);
  game.nextPickupSpawnTick = 0;
  const restored = decodeGameState(encodeGameState(game)); assert.ok(restored);
  const firstId = game.nextPickupId;
  step(game, inputs); step(restored, inputs);
  assert.equal(game.nextPickupId, firstId + 1);
  assert.equal(game.nextPickupSpawnTick, game.tick + pickupPacing(2).interval);
  for (let i = 0; i < 60; i++) { step(game, inputs); step(restored, inputs); }
  assert.equal(encodeGameState(restored), encodeGameState(game));
});

test('elimination lowers the rate and cap without removing existing drops; spawning resumes below the cap', () => {
  const { game, inputs } = playing(5);
  game.pickups = Array.from({ length: pickupPacing(5).cap }, (_, i) => ({ id: game.nextPickupId++, type: 'power', x: 100 + i * 65, y: 100, expiresAtTick: Number.MAX_SAFE_INTEGER }));
  const ids = game.pickups.map(p => p.id);
  for (const id of [...game.players.keys()].slice(2)) eliminatePlayer(game, id);
  game.nextPickupSpawnTick = game.tick + 1;
  const nextId = game.nextPickupId;
  step(game, inputs);
  assert.deepEqual(game.pickups.map(p => p.id), ids, 'existing drops survive the cap reduction');
  assert.equal(game.nextPickupId, nextId);
  assert.equal(game.nextPickupSpawnTick, game.tick + pickupPacing(2).interval);
  const collector = game.players.get('human')!;
  for (const pickup of game.pickups.slice(0, 13)) { pickup.x = collector.x; pickup.y = collector.y; }
  for (let i = 0; i < pickupPacing(2).interval; i++) step(game, inputs);
  assert.equal(game.pickups.length, pickupPacing(2).cap);
  assert.equal(game.nextPickupId, nextId + 1, 'seven remaining drops allow exactly one new drop');
});

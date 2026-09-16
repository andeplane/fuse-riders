import test from 'node:test';
import assert from 'node:assert/strict';
import { POWER_TUNING as tuning, MAX_POWER_PICKUPS, MAX_BOARD_PICKUPS, powerBlastRadius, powerReloadTicks } from '../src/shared/power-progression.js';
import { BOMB_FUSE_TICKS, COUNTDOWN_TICKS, SLOT_COLORS, addPlayer, createGame, startMatch, step, toSnapshot, type InputIntent } from '../src/shared/game.js';
import { decodeGameState, encodeGameState } from '../src/online/checkpoint.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import { reloadRemaining } from '../src/client/reload-ring.js';

function playing() {
  const game = createGame('power-test', 725);
  for (let slot = 0; slot < 2; slot++) addPlayer(game, { id: `p${slot}`, name: `P${slot}`, slot, color: SLOT_COLORS[slot]! });
  startMatch(game); for (let i = 0; i < COUNTDOWN_TICKS; i++) step(game, new Map());
  Object.assign(game.players.get('p0')!, { x: 400, y: 400, angle: 0, trail: [] });
  Object.assign(game.players.get('p1')!, { x: 1200, y: 700, angle: Math.PI, trail: [] });
  game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  return game;
}
const fire = new Map<string, InputIntent>([['p0', { left: false, right: false, bomb: false, bombCommands: [{ action: 'press' }, { action: 'release' }] }]]);

test('every pickup improves blast strength with diminishing returns and bounded reload', () => {
  assert.equal(powerBlastRadius(0), tuning.baseBlastRadius);
  assert.equal(powerReloadTicks(0), tuning.baseReloadTicks);
  assert.equal(powerBlastRadius(tuning.halfStrengthPickups), 135);
  assert.equal(powerReloadTicks(tuning.halfStrengthPickups), 63);
  let previousGain = Infinity;
  for (let count = 1; count <= 100; count++) {
    const gain = powerBlastRadius(count) - powerBlastRadius(count - 1);
    assert.ok(gain > 0 && gain < previousGain, `pickup ${count} adds a smaller positive blast gain`);
    assert.ok(powerReloadTicks(count) <= powerReloadTicks(count - 1));
    previousGain = gain;
  }
  assert.ok(powerReloadTicks(1) < tuning.baseReloadTicks, 'the very first pickup improves reload');
  assert.ok(powerBlastRadius(MAX_POWER_PICKUPS) < tuning.maxBlastRadius);
  assert.ok(powerReloadTicks(MAX_POWER_PICKUPS) >= tuning.minReloadTicks);
  assert.ok(tuning.minReloadTicks > BOMB_FUSE_TICKS);
});

test('each pickup improves a shot; reload finishes at the upgraded deadline', () => {
  for (const count of [1, 2, 3, 4, 5, tuning.halfStrengthPickups]) {
    const game = playing(), player = game.players.get('p0')!;
    player.powerPickups = count;
    step(game, fire);
    const firstBombId = game.nextBombId;
    const bomb = [...game.bombs.values()][0]!;
    assert.equal(bomb.blastRange, powerBlastRadius(count));
    assert.equal(bomb.explodeAtTick - bomb.launchedTick, BOMB_FUSE_TICKS);
    const ticks = powerReloadTicks(count);
    const snapshot = { ...toSnapshot(game), tick: game.tick, round: game.round };
    assert.equal(reloadRemaining(snapshot.players[0]!, snapshot), 1);
    for (let i = 0; i < ticks - 1; i++) step(game, fire);
    assert.equal(game.nextBombId, firstBombId, 'early presses cannot fire');
    assert.equal(player.bombReadyAtTick, game.tick + 1);
    step(game, fire);
    assert.equal(game.nextBombId, firstBombId + 1, 'fires exactly at readiness');
  }
});

test('power and a running reload restore and replay exactly; the ring uses the launch duration', () => {
  const game = playing(), player = game.players.get('p0')!;
  player.powerPickups = 4;
  step(game, fire);
  game.pickups = [{ id: game.nextPickupId++, type: 'power', x: player.x, y: player.y, expiresAtTick: game.tick + 100 }];
  step(game, new Map());
  assert.equal(player.powerPickups, 5);
  const snapshot = { ...toSnapshot(game), tick: game.tick, round: game.round };
  assert.equal(reloadRemaining(snapshot.players[0]!, snapshot), (powerReloadTicks(4) - 1) / powerReloadTicks(4));
  const restored = decodeGameState(encodeGameState(game)); assert.ok(restored);
  for (let i = 0; i < 20; i++) { step(game, new Map()); step(restored, new Map()); }
  assert.equal(encodeGameState(restored), encodeGameState(game));
});

test('checkpoint accepts a full board and rejects malformed progression', () => {
  const game = playing();
  game.pickups = Array.from({ length: MAX_BOARD_PICKUPS }, (_, i) => ({ id: i + 1, type: 'power', x: 100 + i * 30, y: 100, expiresAtTick: game.tick + 100 }));
  game.nextPickupId = MAX_BOARD_PICKUPS + 2;
  assert.ok(decodeGameState(encodeGameState(game)));
  game.pickups.push({ id: MAX_BOARD_PICKUPS + 1, type: 'power', x: 100, y: 200, expiresAtTick: game.tick + 100 });
  assert.equal(decodeGameState(encodeGameState(game)), undefined);
  game.pickups = [];
  const player = game.players.get('p0')!;
  for (const invalid of [-1, .5, MAX_POWER_PICKUPS + 1, NaN]) {
    player.powerPickups = invalid;
    assert.equal(decodeGameState(encodeGameState(game)), undefined);
  }
  player.powerPickups = 0;
  for (const invalid of [0, .5, tuning.baseReloadTicks + 1]) {
    player.reloadDurationTicks = invalid;
    assert.equal(decodeGameState(encodeGameState(game)), undefined);
  }
});

test('abundant spawning still respects a room with all drops disabled', () => {
  const game = playing(); game.settings = { ...defaultRoomSettings(), weights: {} };
  game.nextPickupSpawnTick = game.tick;
  for (let i = 0; i < 100; i++) step(game, new Map());
  assert.equal(game.pickups.length, 0);
});

test('a newly joined lobby rider can be restored before any round initializes it', () => {
  const game = createGame('power-lobby');
  addPlayer(game, { id: 'p0', name: 'P0', slot: 0, color: SLOT_COLORS[0]! });
  assert.equal(game.players.get('p0')!.reloadDurationTicks, tuning.baseReloadTicks);
  const restored = decodeGameState(encodeGameState(game)); assert.ok(restored);
  assert.equal(encodeGameState(restored), encodeGameState(game));
});

test('several pickups collected together all improve a shot on the same tick', () => {
  const game = playing(), player = game.players.get('p0')!;
  const count = 11;
  game.pickups = Array.from({ length: count }, () => ({ id: game.nextPickupId++, type: 'power', x: player.x, y: player.y, expiresAtTick: game.tick + 100 }));
  step(game, fire);
  assert.equal(player.powerPickups, count);
  assert.equal([...game.bombs.values()][0]!.blastRange, powerBlastRadius(count));
  assert.equal(player.reloadDurationTicks, powerReloadTicks(count));
  assert.equal(game.matchStats.get(player.id)!.powerPickups, count);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNTDOWN_TICKS, SLOT_COLORS, addPlayer, createGame, startMatch, startNextRound, step, toSnapshot, type InputIntent, type PickupType } from '../src/shared/game.js';
import { MAX_EXTRA_BOMBS, MAX_VOLLEY_BOMBS, volleyAngles } from '../src/shared/launch-modifiers.js';
import { powerBlastRadius, powerReloadTicks } from '../src/shared/power-progression.js';
import { decodeGameState, encodeGameState } from '../src/online/checkpoint.js';
import { PICKUP_WEIGHTS } from '../src/shared/pickup-weights.js';
import { powerLabel } from '../src/client/power-indicator.js';

function playing() {
  const game = createGame('extra-bomb', 725);
  for (let slot = 0; slot < 2; slot++) addPlayer(game, { id: `p${slot}`, name: `P${slot}`, slot, color: SLOT_COLORS[slot]! });
  startMatch(game); for (let i = 0; i < COUNTDOWN_TICKS; i++) step(game, new Map());
  Object.assign(game.players.get('p0')!, { x: 400, y: 400, angle: 0, trail: [], invulnerableUntilTick: 10000 });
  Object.assign(game.players.get('p1')!, { x: 1200, y: 700, angle: Math.PI, trail: [], invulnerableUntilTick: 10000 });
  game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  return game;
}
const commands = (...actions: ('press' | 'release' | 'cancel')[]) => new Map<string, InputIntent>([['p0', {
  left: false, right: false, bomb: false, bombCommands: actions.map(action => ({ action })),
}]]);
const fire = commands('press', 'release');
function collect(game: ReturnType<typeof playing>, ...types: PickupType[]) {
  const rider = game.players.get('p0')!;
  game.pickups = types.map(type => ({ id: game.nextPickupId++, type, x: rider.x, y: rider.y, expiresAtTick: game.tick + 100 }));
}

test('each pickup adds one bomb, every subsequent shot retains it, and a new round resets it', () => {
  const game = playing(), rider = game.players.get('p0')!;
  assert.equal(rider.extraBombs, 0);
  for (let upgrades = 1; upgrades <= 3; upgrades++) {
    collect(game, 'extraBomb'); step(game, fire);
    assert.equal(rider.extraBombs, upgrades);
    assert.equal(game.bombs.size, upgrades + 1);
    assert.equal(toSnapshot(game).players[0]!.extraBombs, upgrades);
    const ids = game.nextBombId;
    step(game, fire); assert.equal(game.nextBombId, ids, 'upgrade does not permit independent launches during reload');
    while (game.tick < rider.bombReadyAtTick) step(game, new Map());
    step(game, fire);
    assert.equal(game.bombs.size, upgrades + 1, 'second shot still has the upgrade');
    while (game.tick < rider.bombReadyAtTick) step(game, new Map());
  }
  game.phase = 'roundOver'; game.phaseEndsAtTick = game.tick;
  startNextRound(game);
  assert.equal(game.phase, 'countdown'); assert.equal(rider.extraBombs, 0);
});

test('collection while charging is immediate; cancellation preserves upgrades; cap bounds volleys', () => {
  const game = playing(), rider = game.players.get('p0')!;
  step(game, commands('press'));
  collect(game, 'extraBomb', 'extraBomb'); step(game, commands('cancel'));
  assert.equal(rider.extraBombs, 2); assert.equal(game.bombs.size, 0);
  step(game, commands('press'));
  collect(game, 'extraBomb'); step(game, commands('release'));
  assert.equal(game.bombs.size, 4);
  const capped = playing(); collect(capped, ...Array<PickupType>(MAX_EXTRA_BOMBS + 2).fill('extraBomb'), 'five');
  step(capped, fire);
  assert.equal(capped.players.get('p0')!.extraBombs, MAX_EXTRA_BOMBS);
  assert.equal(capped.bombs.size, MAX_VOLLEY_BOMBS);
  assert.ok(decodeGameState(encodeGameState(capped)));
});

test('even and large volleys stay symmetric, distinct and within the Five fan', () => {
  for (let count = 1; count <= MAX_VOLLEY_BOMBS; count++) {
    const angles = volleyAngles(0, count);
    assert.equal(angles.length, count); assert.equal(new Set(angles).size, count);
    assert.ok(angles.every(angle => Math.abs(angle) <= .44 + 1e-12));
    for (let i = 0; i < count; i++) assert.ok(Math.abs(angles[i]! + angles[count - 1 - i]!) < 1e-12);
  }
  assert.deepEqual(volleyAngles(0, 2), [-.11, .11]);
  for (const count of [0, -1, 1.5, NaN, Infinity, MAX_VOLLEY_BOMBS + 1]) assert.throws(() => volleyAngles(0, count));
});

test('Triple/Five add their temporary bonus; Power applies to upgraded volleys', () => {
  for (const temporary of ['triple', 'five'] as const) {
    const game = playing(), rider = game.players.get('p0')!;
    collect(game, 'extraBomb', 'extraBomb', 'power', temporary); step(game, fire);
    const bombs = [...game.bombs.values()];
    assert.equal(bombs.length, temporary === 'triple' ? 5 : 7);
    assert.ok(bombs.every(bomb => bomb.blastRange === powerBlastRadius(1)));
    assert.equal(rider.reloadDurationTicks, powerReloadTicks(1));
    assert.equal(rider.tripleShotArmed, false); assert.equal(rider.fiveShotArmed, false);
    assert.equal(rider.extraBombs, 2);
  }
});

test('Shell and Gun fan out with the volley and spend it; Target fires one and preserves it', () => {
  for (const special of ['target', 'shell', 'gun'] as const) {
    const game = playing(), rider = game.players.get('p0')!;
    collect(game, 'extraBomb', 'extraBomb', 'triple', special);
    const events = step(game, fire);
    const projectile = special !== 'target';
    assert.equal(events.events.filter(event => event.type === 'bombPlaced').length, projectile ? 5 : 1);
    assert.equal(rider.extraBombs, 2); assert.equal(rider.tripleShotArmed, !projectile);
    // Shells deliberately remain in flight and do not block the next ordinary shot.
    while (game.tick < rider.bombReadyAtTick) step(game, new Map());
    const followup = step(game, fire);
    assert.equal(followup.events.filter(event => event.type === 'bombPlaced').length, projectile ? 3 : 5);
  }
});

test('checkpoint recovery replays upgraded launches and explosions exactly', () => {
  const game = playing(); collect(game, 'extraBomb', 'extraBomb', 'extraBomb', 'gravity'); step(game, commands('press'));
  const restored = decodeGameState(encodeGameState(game)); assert.ok(restored);
  for (let tick = 0; tick < 150; tick++) {
    const inputs = tick === 0 || tick === 90 ? commands('release') : tick === 80 ? commands('press') : new Map<string, InputIntent>();
    assert.deepEqual(step(restored, inputs), step(game, inputs));
    assert.equal(encodeGameState(restored), encodeGameState(game));
  }
});

test('checkpoint rejects corrupt or missing counts, and default drop rate is about four percent', () => {
  const game = playing(), rider = game.players.get('p0')!;
  for (const invalid of [-1, .5, MAX_EXTRA_BOMBS + 1, NaN]) {
    rider.extraBombs = invalid; assert.equal(decodeGameState(encodeGameState(game)), undefined);
  }
  rider.extraBombs = 0;
  const valid = encodeGameState(game);
  assert.equal(decodeGameState(valid.replace(/"extraBombs":0,/g, '')), undefined);
  assert.ok(decodeGameState(valid));
  const total = PICKUP_WEIGHTS.reduce((sum, row) => sum + row.weight, 0);
  const share = PICKUP_WEIGHTS.find(row => row.type === 'extraBomb')!.weight / total;
  assert.ok(share > .03 && share < .05);
  assert.equal(powerLabel(3, 2), '◆ 3 · B×3');
});

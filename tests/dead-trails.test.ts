import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeGameState, encodeGameState } from '../src/online/checkpoint.js';
import { BotController } from '../src/shared/bot-controller.js';
import {
  COUNTDOWN_TICKS, SLOT_COLORS, TRAIL_LIFETIME_TICKS,
  addPlayer, createGame, eliminatePlayer, startMatch, startNextRound, step,
  type GameState, type InputIntent,
} from '../src/shared/game.js';

const neutral: InputIntent = { left: false, right: false, bomb: false };
function fixture() {
  const game = createGame('dead-trails', 42);
  for (let slot = 0; slot < 4; slot++) addPlayer(game, { id: `p${slot}`, name: `P${slot}`, slot, color: SLOT_COLORS[slot]! });
  startMatch(game);
  for (let i = 0; i < COUNTDOWN_TICKS; i++) step(game, new Map());
  game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  const dead = game.players.get('p0')!, survivor = game.players.get('p1')!;
  Object.assign(dead, { x: 500, y: 450, angle: 0 });
  Object.assign(survivor, { x: 1100, y: 650, angle: 0 });
  Object.assign(game.players.get('p2')!, { x: 1100, y: 750, angle: 0 });
  Object.assign(game.players.get('p3')!, { x: 1300, y: 750, angle: 0 });
  for (const player of game.players.values()) player.trail = [];
  dead.trail = [{ x1: 200, y1: 200, x2: 300, y2: 200, createdTick: 0, expiresAtTick: game.tick + 3 }];
  return { game, dead, survivor };
}

function advanceWithSurvivors(game: GameState, ticks: number) {
  for (const player of game.players.values()) if (player.alive) player.invulnerableUntilTick = game.tick + ticks + 100;
  for (let i = 0; i < ticks; i++) {
    step(game, new Map());
    assert.equal(game.phase, 'playing', 'two survivors keep the round running');
  }
}

for (const cause of ['leave', 'wall', 'trail', 'rider', 'bomb', 'target'] as const) {
  test(`${cause} elimination keeps the remaining trail fixed past its original lifetime and clears it next round`, () => {
    const { game, dead, survivor } = fixture();
    let input = new Map<string, InputIntent>();
    if (cause === 'leave') eliminatePlayer(game, dead.id);
    if (cause === 'wall') Object.assign(dead, { x: game.boundaryInset + 1, angle: Math.PI });
    if (cause === 'trail') survivor.trail = [{ x1: 510, y1: 400, x2: 510, y2: 500, createdTick: game.tick, expiresAtTick: game.tick + 100 }];
    if (cause === 'rider') Object.assign(survivor, { x: 510, y: 450, angle: Math.PI });
    if (cause === 'bomb') {
      game.bombs.set(1, { id: 1, ownerId: survivor.id, x: 500, y: 450, launchX: 500, launchY: 450,
        launchedTick: game.tick, placedTick: game.tick, landsAtTick: game.tick, explodeAtTick: game.tick + 1,
        blastRange: 90, flightPath: [{ x: 500, y: 450, angle: 0 }] });
      game.nextBombId = 2;
    }
    if (cause === 'target') {
      survivor.targetBombArmed = true;
      input = new Map([[survivor.id, { ...neutral, bombCommands: [{ action: 'press' }, { action: 'release', aim: { x: 500 / game.width, y: 450 / game.height } }] }]]);
    }
    step(game, input);
    assert.equal(dead.alive, false);
    assert.ok(dead.trail.length > 0);
    if (cause === 'trail' || cause === 'rider') assert.equal(dead.trail.at(-1)!.x2, dead.x, 'fatal contact segment is kept');
    const trail = structuredClone(dead.trail), pose = { x: dead.x, y: dead.y, angle: dead.angle };
    advanceWithSurvivors(game, TRAIL_LIFETIME_TICKS + 10);
    assert.deepEqual(dead.trail, trail, 'no tail decay or new trail after death');
    assert.deepEqual({ x: dead.x, y: dead.y, angle: dead.angle }, pose);
    const restored = decodeGameState(encodeGameState(game));
    assert.ok(restored, 'persistent trails survive checkpoint validation');
    for (let i = 0; i < 10; i++) assert.deepEqual(step(restored, new Map()), step(game, new Map()), 'restored replay agrees');
    assert.equal(encodeGameState(restored), encodeGameState(game));
    for (const player of game.players.values()) if (player.alive && player.id !== 'p2') eliminatePlayer(game, player.id);
    step(game, new Map());
    assert.equal(game.phase, 'roundOver');
    while (game.tick < game.phaseEndsAtTick!) step(game, new Map());
    assert.deepEqual(dead.trail, trail, 'round-over presentation also retains the trail');
    startNextRound(game);
    assert.deepEqual(dead.trail, []);
    assert.equal(dead.alive, true);
  });
}

test('an old dead trail still kills crossing riders and is avoided by bots', () => {
  const { game, dead, survivor } = fixture();
  eliminatePlayer(game, dead.id);
  advanceWithSurvivors(game, TRAIL_LIFETIME_TICKS + 10);
  Object.assign(survivor, { x: 250, y: 160, angle: Math.PI / 2, invulnerableUntilTick: 0, trail: [] });
  const input = new BotController({ random: () => .25 }).input(game, survivor.id);
  assert.ok(input.left || input.right, 'bots see the persistent obstacle');
  survivor.y = 193;
  const result = step(game, new Map());
  assert.equal(survivor.alive, false);
  assert.ok(result.events.some(event => event.type === 'playerEliminated' && event.playerId === survivor.id && event.cause === 'trail'));
});

test('explosions can still destroy a dead trail after its original expiry', () => {
  const { game, dead, survivor } = fixture();
  eliminatePlayer(game, dead.id);
  advanceWithSurvivors(game, TRAIL_LIFETIME_TICKS + 10);
  survivor.targetBombArmed = true;
  step(game, new Map([[survivor.id, { ...neutral, bombCommands: [{ action: 'press' }, { action: 'release', aim: { x: 250 / game.width, y: 200 / game.height } }] }]]));
  assert.deepEqual(dead.trail, []);
});

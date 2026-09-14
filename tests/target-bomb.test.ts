import assert from 'node:assert/strict';
import test from 'node:test';
import { addPlayer, createGame, startMatch, step, COUNTDOWN_TICKS, BOMB_FUSE_TICKS, BOMB_COOLDOWN_TICKS, BOMB_BLAST_RANGE, BLAST_LEVEL_RANGE, RIDER_RADIUS, toSnapshot, eliminatePlayer, startNextRound, type InputIntent } from '../src/shared/game.ts';
import { BombInputBuffer } from '../src/server/bomb-input.ts';
function fixture() {
  const game = createGame('target');
  for (let i = 0; i < 2; i++) addPlayer(game, { id: `p${i}`, name: `P${i}`, slot: i, color: '#fff' });
  startMatch(game); for (let i = 0; i < COUNTDOWN_TICKS; i++) step(game, new Map());
  const player = game.players.get('p0')!; player.x = 500; player.y = 450; player.angle = 0;
  const other = game.players.get('p1')!; other.x = 1200; other.y = 700;
  const input = (intent: Partial<InputIntent>) => step(game, new Map([['p0', { left: false, right: false, bomb: false, ...intent }]]));
  return { game, player, input };
}
test('target collection arms one normal-strength bomb and preserves volley upgrades', () => {
  const { game, player, input } = fixture();
  game.pickups.push({ id: 99, type: 'target', x: player.x, y: player.y, expiresAtTick: game.tick + 30 }); input({});
  assert.equal(player.targetBombArmed, true); assert.equal(game.matchStats.get('p0')!.targetPickups, 1);
  player.fiveShotArmed = true; player.tripleShotArmed = true; player.blastLevel = 2;
  input({ bomb: true, bombCommands: [{ action: 'press', aim: { x: .25, y: .5 } }] });
  assert.deepEqual(player.bombTarget, { x: 400, y: 450 });
  const snapshot = toSnapshot(game); snapshot.players[0]!.bombTarget!.x = 10; assert.equal(player.bombTarget!.x, 400);
  input({ bomb: true, aim: { x: .75, y: .25 } }); assert.deepEqual(player.bombTarget, { x: 1200, y: 225 });
  input({ bombCommands: [{ action: 'release', aim: { x: .8, y: .2 } }] });
  assert.equal(game.bombs.size, 0); const blast = game.blasts[0]!;
  assert.equal(blast.circle.x, 1280); assert.equal(blast.circle.y, 180);
  assert.equal(blast.circle.radius, (BOMB_BLAST_RANGE + 2 * BLAST_LEVEL_RANGE) * .7);
  assert.equal(player.bombReadyAtTick, game.tick + BOMB_COOLDOWN_TICKS); assert.equal(player.targetBombArmed, false); assert.equal(player.bombTarget, undefined);
  assert.equal(player.fiveShotArmed, true); assert.equal(player.tripleShotArmed, true);
});
test('targeting requires pickup and clamps to the current safe field', () => {
  const { game, player, input } = fixture();
  input({ bomb: true, bombCommands: [{ action: 'press', aim: { x: 0, y: 1 } }], aim: { x: 0, y: 1 } }); assert.equal(player.bombTarget, undefined);
  input({ bombCommands: [{ action: 'cancel' }] }); player.targetBombArmed = true;
  input({ bomb: true, bombCommands: [{ action: 'press' }] }); assert.deepEqual(player.bombTarget, { x: player.x + 100, y: player.y });
  game.tick = game.roundStartedTick! + 1200 + 160;
  input({ bombCommands: [{ action: 'release', aim: { x: 0, y: 1 } }] });
  const bomb = game.blasts[0]!.circle; assert.ok(game.boundaryInset >= 100); assert.equal(bomb.x, game.boundaryInset + RIDER_RADIUS); assert.equal(bomb.y, game.height - game.boundaryInset - RIDER_RADIUS);
});
test('cancel, rejected release and death clear preview without consuming; next round resets', () => {
  const { game, player, input } = fixture(); player.targetBombArmed = true;
  input({ bombCommands: [{ action: 'release' }] }); assert.equal(player.targetBombArmed, true);
  input({ bomb: true, bombCommands: [{ action: 'press' }] }); input({ bombCommands: [{ action: 'cancel' }] }); assert.equal(player.bombTarget, undefined); assert.equal(player.targetBombArmed, true);
  player.bombReadyAtTick = game.tick + 10; input({ bombCommands: [{ action: 'press' }, { action: 'release' }] }); assert.equal(game.bombs.size, 0); assert.equal(player.targetBombArmed, true);
  player.bombReadyAtTick = 0; input({ bomb: true, bombCommands: [{ action: 'press' }] }); eliminatePlayer(game, 'p0'); assert.equal(player.bombTarget, undefined); assert.equal(player.targetBombArmed, true);
  input({}); game.tick = game.phaseEndsAtTick!; startNextRound(game); assert.equal(player.targetBombArmed, false);
});
test('queued release uses its own aim rather than a later packet in the same server tick', () => {
  const { game, player, input } = fixture(); player.targetBombArmed = true;
  const buffer = new BombInputBuffer(); buffer.accept(true, 'press', { x: .1, y: .1 }); buffer.accept(false, 'release', { x: .2, y: .2 }); buffer.accept(true, 'press', { x: .9, y: .9 });
  input({ bomb: true, aim: { x: .9, y: .9 }, bombCommands: buffer.drainCommands() });
  assert.equal(game.blasts[0]!.circle.x, 320); assert.equal(game.blasts[0]!.circle.y, 180);
});

test('Target detonates on the release tick, with damage and protection resolved immediately', () => {
  for (const protection of ['none', 'star', 'shield'] as const) {
    const { game, player, input } = fixture(); player.targetBombArmed = true;
    const victim = game.players.get('p1')!; victim.trail = []; victim.angle = 0;
    if (protection === 'star') victim.invulnerableUntilTick = game.tick + 50;
    if (protection === 'shield') victim.shielded = true;
    const released = input({ bombCommands: [{ action: 'press', aim: { x: .75, y: 700 / 900 } }, { action: 'release', aim: { x: .75, y: 700 / 900 } }] });
    assert.equal(game.bombs.size, 0);
    assert.equal(victim.alive, protection !== 'none');
    assert.equal(released.events.filter(event => event.type === 'explosion').length, 1);
    if (protection === 'shield') assert.equal(victim.shielded, false);
  }
});
test('instant Target blast chains nearby bombs in the same tick', () => {
  const { game, player, input } = fixture(); player.targetBombArmed = true;
  game.bombs.set(99, { id: 99, ownerId: 'p1', x: 800, y: 225, launchX: 800, launchY: 225,
    launchedTick: 0, placedTick: 0, landsAtTick: 0, explodeAtTick: game.tick + 100,
    blastRange: 90, flightPath: [{ x: 800, y: 225, angle: 0 }] });
  const result = input({ bombCommands: [{ action: 'press' }, { action: 'release', aim: { x: .5, y: .25 } }] });
  assert.equal(game.bombs.size, 0);
  assert.equal(result.events.filter(event => event.type === 'explosion').length, 2);
});

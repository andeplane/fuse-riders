import test from 'node:test';
import assert from 'node:assert/strict';
import { interpolateWorld, presentWorld } from '../src/online/prediction.js';
import { World } from '../src/online/rollback.js';
import { ACTION, JOIN } from '../src/shared/input-log.js';
import { createRoomState } from '../src/shared/apply-tick.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import { COUNTDOWN_TICKS, riderMotionStep } from '../src/shared/game.js';
import { advanceRiderPose } from '../src/shared/rider-motion.js';
import { bombPreviewDistance } from '../src/client/bomb-preview.js';

function frames() {
  const world = new World(createRoomState('m', defaultRoomSettings()), 'h', 'h');
  const log = world.stream('h', 1); world.stream('p', 1);
  log.append(1, [JOIN, 'h', 'Host', 0, 'fox', 1]); log.append(1, [JOIN, 'p', 'P', 1, 'cat', 1]); log.append(2, [ACTION, 'start', 'm']);
  world.streams.get('p')!.through = 200; log.through = 200; world.advance(COUNTDOWN_TICKS + 4);
  const [newer, older] = world.view(); return { older: older!, newer };
}

test('interpolation uses coherent past state and fractional ticks without portal chords or dead riders', () => {
  const { older, newer } = frames();
  const mid = interpolateWorld(older, newer, .5);
  assert.equal(mid.tick, older.tick + .5); assert.equal(mid.phase, 'playing');
  const before = older.players[0]!, after = newer.players[0]!, shown = mid.players[0]!;
  assert.ok(Math.abs(shown.x - (before.x + after.x) / 2) < 1e-9); assert.ok(Math.abs(shown.y - (before.y + after.y) / 2) < 1e-9);
  assert.deepEqual(interpolateWorld(older, newer, 1), newer); assert.deepEqual(interpolateWorld(undefined, newer, .5), newer);
  const jumped = { ...newer, players: newer.players.map(p => ({ ...p, portalCooldownUntilTick: 99 })) };
  assert.deepEqual(interpolateWorld(older, jumped, .5).players[0], older.players[0], 'a portal transit shows the pre-transit pose');
  assert.deepEqual(interpolateWorld({ ...older, round: 2 }, newer, .5), newer);
  const dead = { ...newer, players: newer.players.map(p => ({ ...p, alive: false })) };
  assert.deepEqual(interpolateWorld(older, dead, .5).players[0], older.players[0]);
  const shell = { ...older, bombs: [{ ...older.bombs[0] ?? { id: 1, ownerId: 'h', launchX: 0, launchY: 0, x: 100, y: 100, launchedTick: 1, landsAtTick: 9, explodeAtTick: 9, blastRange: 1, flightPath: [] }, shell: { vx: 10, vy: 0 } }] };
  const moved = { ...newer, bombs: [{ ...shell.bombs[0]!, x: 110 }] };
  assert.equal(interpolateWorld(shell, moved, .5).bombs[0]!.x, 105); assert.equal(interpolateWorld(shell, { ...moved, bombs: [{ ...moved.bombs[0]!, shell: { vx: -10, vy: 0 } }] }, .5).bombs[0]!.x, 100, 'a bounced shell is not chorded');
});

test('presentation leads the local rider by its held controls and marks its presentation tick for the charge preview', () => {
  const { older, newer } = frames();
  const plain = presentWorld(older, newer, newer.tick - .25);
  assert.equal(plain.tick, newer.tick - .25); assert.equal(plain.players[0]!.presentationTick, undefined);
  const led = presentWorld(older, newer, newer.tick, { id: 'h', controls: { left: true, right: false }, lead: 1 });
  const rider = led.players.find(p => p.id === 'h')!, base = newer.players.find(p => p.id === 'h')!;
  const expected = advanceRiderPose({ x: base.x, y: base.y, angle: base.angle, drunkHeadingOffset: 0 }, { left: true, right: false }, { ...riderMotionStep(base, newer.tick + 1, newer.roundStartedTick), drunkHeadingOffset: 0 });
  assert.deepEqual({ x: rider.x, y: rider.y, angle: rider.angle }, { x: expected.x, y: expected.y, angle: expected.angle });
  assert.equal(rider.presentationTick, newer.tick + 1); assert.equal(rider.trail.length, base.trail.length + 1, 'a cosmetic trail segment bridges the lead');
  assert.deepEqual(led.players.find(p => p.id === 'p'), newer.players.find(p => p.id === 'p'), 'remote riders are shown as simulated');
  const charging = { ...newer, players: newer.players.map(p => ({ ...p, bombChargeStartedTick: newer.tick - 3 })) };
  const preview = presentWorld(older, charging, charging.tick, { id: 'h', controls: { left: false, right: false }, lead: .5 }).players.find(p => p.id === 'h')!;
  assert.equal(bombPreviewDistance(preview.presentationTick! - preview.bombChargeStartedTick!), bombPreviewDistance(3.5));
  assert.equal(presentWorld(older, newer, newer.tick, { id: 'h', controls: { left: true, right: false }, lead: 0 }).players[0]!.presentationTick, undefined, 'no lead, no cosmetic step');
  assert.equal(presentWorld(older, { ...newer, phase: 'roundOver' }, newer.tick, { id: 'h', controls: { left: true, right: false }, lead: 1 }).players[0]!.presentationTick, undefined, 'only during play');
  assert.deepEqual(presentWorld(older, newer, newer.tick, { id: 'ghost', controls: { left: true, right: false }, lead: 1 }), newer);
});

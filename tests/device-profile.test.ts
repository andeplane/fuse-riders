import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDeviceProfile, deviceLabel, isDeviceProfile, sameDeviceProfile, targetBombAvailable, unknownDevice, type DeviceProfile } from '../src/shared/device-profile.js';
import { addPlayer, createGame, startMatch, step, returnToLobby, toSnapshot, SLOT_COLORS } from '../src/shared/game.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import { DEVICE, JOIN, PRESENCE, isEntry, type Entry } from '../src/shared/input-log.js';
import { applyTick, createRoomState } from '../src/shared/apply-tick.js';
import { BotController } from '../src/shared/bot-controller.js';
import { parseClientMessage } from '../src/shared/protocol.js';
import { decodeGameState, encodeGameState } from '../src/online/checkpoint.js';
import { World } from '../src/online/rollback.js';
import { SnapshotAssembler, decodeSnapshot, encodeSnapshot } from '../src/online/snapshot.js';

const phone: DeviceProfile = { device: 'phone', input: 'touch' };
const keyboard: DeviceProfile = { device: 'desktop', input: 'keyboard' };
const rider = (id: string, deviceProfile = phone, connected = true) => ({ id, deviceProfile, connected });
test('device inference distinguishes phones, tablets and touch desktops; keyboard remains separate from hardware', () => {
  for (const ua of ['iPhone OS', 'iPod OS', 'Android 15; Pixel Mobile']) assert.deepEqual(detectDeviceProfile(ua, 5, true), phone);
  for (const ua of ['iPad OS', 'Android 15; Tablet', 'Macintosh Safari']) assert.deepEqual(detectDeviceProfile(ua, 5, true), { device: 'tablet', input: 'touch' });
  for (const ua of ['Windows NT Chrome', 'Macintosh Safari', 'Linux Firefox']) assert.deepEqual(detectDeviceProfile(ua, 0, false), keyboard);
  assert.deepEqual(detectDeviceProfile('Windows NT Chrome', 10, true), keyboard, 'a touchscreen laptop is not a phone');
  assert.deepEqual(detectDeviceProfile('iPhone OS', 0, true), phone);
  assert.deepEqual(detectDeviceProfile('iPad OS', 0, false), { device: 'tablet', input: 'unknown' });
  assert.deepEqual(detectDeviceProfile('', 5, true), unknownDevice());
  assert.equal(sameDeviceProfile(phone, { ...phone, input: 'keyboard' }), false);
  assert.equal(sameDeviceProfile(phone, keyboard), false);
  assert.equal(sameDeviceProfile(phone, { ...phone }), true);
  assert.equal(deviceLabel(phone), 'Phone · touch'); assert.equal(deviceLabel(keyboard), 'Desktop · keyboard');
  assert.equal(deviceLabel({ device: 'tablet', input: 'unknown' }), 'Tablet · unknown input');
  assert.equal(deviceLabel(), 'Unknown device'); assert.equal(deviceLabel(unknownDevice()), 'Unknown device');
});
test('availability includes every connected human seat and excludes bots, disconnected riders and unseated TVs', () => {
  assert.equal(targetBombAvailable([]), false);
  assert.equal(targetBombAvailable([rider('bot:1')]), false);
  assert.equal(targetBombAvailable([rider('human'), rider('bot:1', unknownDevice()), rider('offline', keyboard, false)]), true);
  for (const deviceProfile of [keyboard, unknownDevice(), { device: 'tablet', input: 'touch' }, { device: 'phone', input: 'keyboard' }] as DeviceProfile[]) {
    assert.equal(targetBombAvailable([rider('phone'), rider('second', deviceProfile)]), false);
  }
  assert.equal(targetBombAvailable([{ id: 'missing', connected: true }]), false);
});
test('profiles are strictly validated at LAN, log and checkpoint boundaries', () => {
  for (const profile of [phone, keyboard, unknownDevice()]) {
    assert.equal(isDeviceProfile(profile), true);
    assert.ok(parseClientMessage(JSON.stringify({ type: 'join', name: 'P', deviceProfile: profile })));
    assert.ok(parseClientMessage(JSON.stringify({ type: 'deviceProfile', profile })));
    assert.ok(isEntry([1, 1, DEVICE, profile.device, profile.input]));
  }
  for (const profile of [null, [], {}, { ...phone, extra: true }, { ...phone, device: 'watch' }, { ...phone, input: 'gamepad' }]) {
    assert.equal(isDeviceProfile(profile), false);
    assert.equal(parseClientMessage(JSON.stringify({ type: 'join', name: 'P', deviceProfile: profile })), null);
    assert.equal(parseClientMessage(JSON.stringify({ type: 'deviceProfile', profile })), null);
  }
  assert.equal(parseClientMessage(JSON.stringify({ type: 'deviceProfile', profile: phone, id: 'other' })), null);
  for (const entry of [[1, 1, DEVICE, 'phone'], [1, 1, DEVICE, 'phone', 'touch', 'extra'], [1, 1, DEVICE, 'watch', 'touch']]) assert.equal(isEntry(entry), false);
  const game = createGame('valid'); addPlayer(game, { id: 'p', name: 'P', slot: 0, color: SLOT_COLORS[0], deviceProfile: phone });
  assert.deepEqual(decodeGameState(encodeGameState(game))!.players.get('p')!.deviceProfile, phone);
  assert.equal(decodeGameState(encodeGameState(game).replace('"device":"phone"', '"device":"watch"')), undefined);
});
function gameForDrops() {
  const game = createGame('drops'); game.settings = { ...defaultRoomSettings(), weights: { target: 1 } };
  for (let slot = 0; slot < 2; slot++) addPlayer(game, { id: `p${slot}`, name: `P${slot}`, slot, color: SLOT_COLORS[slot]!, deviceProfile: phone });
  startMatch(game); while (game.phase === 'countdown') step(game, new Map());
  game.nextPickupSpawnTick = game.tick + 1;
  return game;
}
test('Target drops require phones even with target-only settings, and configured weights survive roster changes', () => {
  const game = gameForDrops(); step(game, new Map()); assert.equal(game.pickups[0]?.type, 'target');
  const player = game.players.get('p0')!; player.targetBombArmed = true; player.bombChargeStartedTick = game.tick; player.bombTarget = { x: 800, y: 500 };
  game.players.get('p1')!.deviceProfile = keyboard;
  step(game, new Map([['p0', { left: false, right: false, bomb: false, bombCommands: [{ action: 'release' }] }]]));
  assert.equal(game.pickups.length, 0); assert.equal(player.targetBombArmed, false); assert.equal(player.bombTarget, undefined);
  assert.equal(player.bombChargeStartedTick, undefined); assert.equal(game.bombs.size, 0, 'cancelled target cannot turn into a forward shot');
  game.nextPickupSpawnTick = game.tick + 1; step(game, new Map()); assert.equal(game.pickups.length, 0);
  assert.equal(game.settings!.weights.target, 1);
  game.players.get('p1')!.deviceProfile = phone; game.nextPickupSpawnTick = game.tick + 1;
  step(game, new Map()); assert.equal(game.pickups[0]?.type, 'target');
  const snapshot = toSnapshot(game); snapshot.players[0]!.deviceProfile!.input = 'keyboard'; assert.equal(player.deviceProfile.input, 'touch');
  returnToLobby(game, 'next'); assert.deepEqual(game.players.get('p0')!.deviceProfile, phone);
});
test('profile entries belong to the member generation; old-generation reports cannot authorize a returned keyboard rider', () => {
  const state = createRoomState('room', defaultRoomSettings()), bots = new BotController();
  applyTick(state, 'host', new Map([['host', { generation: 1, entries: [[1, 1, JOIN, 'host', 'Host', 0, 'fox', 1], [2, 1, DEVICE, 'phone', 'touch']] as Entry[] }]]), bots);
  assert.equal(targetBombAvailable(state.game.players.values()), true);
  applyTick(state, 'host', new Map([['host', { generation: 2, entries: [[1, 2, PRESENCE, 'host', true, 2]] as Entry[], retired: [{ generation: 1, entries: [[3, 2, DEVICE, 'phone', 'touch']] as Entry[] }] }]]), bots);
  assert.deepEqual(state.game.players.get('host')!.deviceProfile, unknownDevice());
  applyTick(state, 'host', new Map([['host', { generation: 2, entries: [[2, 3, DEVICE, 'desktop', 'keyboard']] as Entry[] }]]), bots);
  assert.deepEqual(state.game.players.get('host')!.deviceProfile, keyboard);
  assert.equal(targetBombAvailable(state.game.players.values()), false);
});
test('late and duplicate profile entries replay to the same world and survive snapshot recovery', () => {
  const settings = defaultRoomSettings(); const a = new World(createRoomState('room', settings), 'host', 'host');
  const b = new World(createRoomState('room', settings), 'host', 'host');
  for (const world of [a, b]) { world.stream('host', 1); world.receive('host', [[1, 1, JOIN, 'host', 'Host', 0, 'fox', 1]], 1, 1, 1); world.advance(1); }
  const report: Entry = [2, 2, DEVICE, 'phone', 'touch'];
  a.receive('host', [report], 2, 4, 4); a.advance(4);
  b.advance(4); b.receive('host', [report], 2, 4, 4); b.receive('host', [report], 2, 4, 4);
  assert.deepEqual(a.state, b.state);
  const assembler = new SnapshotAssembler(12); let decoded;
  for (const chunk of encodeSnapshot(a, 12)) { const result = assembler.accept(chunk); if (result) decoded = decodeSnapshot(result.bytes, 12); }
  assert.deepEqual(decoded!.state.game.players.get('host')!.deviceProfile, phone);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION, AIM, AVATAR, BOT, CANCEL, JOIN, LEAVE, PRESENCE, PRESS, RELEASE, SETTINGS, STEER, dequantizeAim, foldPlayerEntries, isEntry, isManagementKind, neutralControls, quantizeAim, type Entry } from '../src/shared/input-log.js';
import { BotController } from '../src/shared/bot-controller.js';
import { RULES, actingCreator, applyTick, canonicalRoomState, createRoomState, freeSlot, hashRoomState, hashText, type RoomState, type StreamEntries } from '../src/shared/apply-tick.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import { COUNTDOWN_TICKS, ROUND_OVER_TICKS, eliminatePlayer } from '../src/shared/game.js';

const settings = defaultRoomSettings();
const entry = (seq: number, tick: number, ...body: unknown[]): Entry => [seq, tick, ...body] as Entry;
const streams = (...items: [id: string, entries: Entry[], generation?: number][]): Map<string, StreamEntries> => new Map(items.map(([id, entries, generation]) => [id, { generation: generation ?? 1, entries }]));
function room(): { state: RoomState; bots: BotController; tick: (streams?: Map<string, StreamEntries>) => ReturnType<typeof applyTick>; seq: Record<string, number>; at: (id: string, ...body: unknown[]) => Entry } {
  const state = createRoomState('room', settings), bots = new BotController(), seq: Record<string, number> = {};
  return { state, bots, seq, tick: (input = new Map()) => applyTick(state, 'creator', input, bots), at: (id, ...body) => entry(seq[id] = (seq[id] ?? 0) + 1, state.game.tick + 1, ...body) };
}
function playing() {
  const r = room();
  r.tick(streams(['creator', [r.at('creator', JOIN, 'creator', 'Creator', 0, 'fox', 1), r.at('creator', JOIN, 'guest', 'Guest', 1, 'cat', 1)]]));
  r.tick(streams(['creator', [r.at('creator', ACTION, 'start', 'match-1')]]));
  for (let i = 0; i < COUNTDOWN_TICKS; i++) r.tick();
  assert.equal(r.state.game.phase, 'playing');
  return r;
}

test('entry validation accepts every kind and rejects malformed shapes, bounds and unknown kinds', () => {
  const valid: Entry[] = [entry(1, 1, STEER, 3), entry(2, 1, AIM, 0, 65535), entry(3, 2, PRESS, 1), entry(4, 2, RELEASE, 1), entry(5, 3, RELEASE, 2, 10, 20), entry(6, 3, CANCEL, 2), entry(7, 3, AVATAR, 'fox'),
    entry(8, 4, JOIN, 'abc', 'Name', 4, 'robot', 0), entry(9, 4, LEAVE, 'abc'), entry(10, 4, PRESENCE, 'abc', false, 3), entry(11, 4, SETTINGS, settings), entry(12, 4, ACTION, 'lobby', 'm'), entry(13, 4, BOT, 'add', 'bot:1', 'AI Ada', 2), entry(14, 4, BOT, 'remove', 'bot:1')];
  for (const item of valid) assert.equal(isEntry(item), true, JSON.stringify(item));
  const invalid = [[0, 1, STEER, 0], [1, 0, STEER, 0], [1, 1, STEER, 4], [1, 1, STEER], [1, 1, AIM, 65536, 0], [1, 1, PRESS, 0], [1, 1, RELEASE, 1, 5], [1, 1, AVATAR, 'nope'], [1, 1, JOIN, '', 'Name', 0, 'fox', 1], [1, 1, JOIN, 'abc', '   ', 0, 'fox', 1], [1, 1, JOIN, 'abc', 'Name', 5, 'fox', 1],
    [1, 1, PRESENCE, 'abc', 'yes', 1], [1, 1, SETTINGS, { ...settings, length: 0 }], [1, 1, ACTION, 'pause', 'm'], [1, 1, BOT, 'add', 'bot:1', 'AI', 9], [1, 1, BOT, 'remove'], [1, 1, 99, 1], [1.5, 1, STEER, 0], [-0, 1, STEER, 0], 'nope', null, [1, 1, STEER, 0, 0, 0, 0, 0, 0]];
  for (const item of invalid) assert.equal(isEntry(item), false, JSON.stringify(item));
  assert.equal(isManagementKind(JOIN), true); assert.equal(isManagementKind(STEER), false);
  assert.deepEqual(quantizeAim({ x: 0.5, y: 2 }), [32768, 65535]); assert.deepEqual(quantizeAim({ x: NaN, y: -1 }), [0, 0]);
  assert.deepEqual(dequantizeAim(65535, 0), { x: 1, y: 0 });
});

test('the gesture fold mirrors the LAN bomb buffer: press, replacement, matching release with aim, cancel, mismatch', () => {
  const held = neutralControls();
  assert.deepEqual(foldPlayerEntries(held, [entry(1, 1, STEER, 1), entry(2, 1, AIM, 65535, 0)]), { left: true, right: false, bomb: false, aim: { x: 1, y: 0 } });
  assert.deepEqual(foldPlayerEntries(held, [entry(3, 2, PRESS, 1)]), { left: true, right: false, bomb: true, aim: { x: 1, y: 0 }, bombCommands: [{ action: 'press', aim: { x: 1, y: 0 } }] });
  assert.deepEqual(foldPlayerEntries(held, [entry(4, 3, PRESS, 2)]).bombCommands, [{ action: 'cancel' }, { action: 'press', aim: { x: 1, y: 0 } }]);
  assert.deepEqual(foldPlayerEntries(held, [entry(5, 4, RELEASE, 1)]).bombCommands, undefined, 'a stale gesture id is a no-op');
  assert.deepEqual(foldPlayerEntries(held, [entry(6, 5, RELEASE, 2, 0, 65535)]), { left: true, right: false, bomb: false, bombCommands: [{ action: 'release', aim: { x: 0, y: 1 } }] });
  assert.deepEqual(foldPlayerEntries(held, [entry(7, 6, PRESS, 2)]).bombCommands, undefined, 'gesture ids must increase');
  assert.deepEqual(foldPlayerEntries(held, [entry(8, 7, PRESS, 3), entry(9, 7, CANCEL, 3), entry(10, 7, STEER, 0)]), { left: false, right: false, bomb: false, bombCommands: [{ action: 'press' }, { action: 'cancel' }] });
  assert.deepEqual(foldPlayerEntries(held, [entry(11, 8, CANCEL, 3), entry(12, 8, AVATAR, 'fox')]), { left: false, right: false, bomb: false });
});

test('management entries join, seat, start, change settings, add and remove bots, leave and return to the lobby', () => {
  const r = playing();
  assert.deepEqual([...r.state.game.players.keys()], ['creator', 'guest']); assert.equal(r.state.game.players.get('guest')!.avatarId, 'cat');
  r.tick(streams(['creator', [r.at('creator', SETTINGS, { ...settings, length: 1, match: 'rounds' })]]));
  assert.equal(r.state.settings.length, 1); assert.equal(r.state.game.settings!.length, 3, 'format stays fixed during a match');
  r.tick(streams(['creator', [r.at('creator', BOT, 'add', 'bot:1', 'AI Hopper', 2)]]));
  assert.equal(r.state.game.players.get('bot:1')!.connected, true); assert.equal(r.state.bots.has('bot:1'), true); assert.equal(freeSlot(r.state.game), 3);
  r.tick(streams(['creator', [r.at('creator', BOT, 'remove', 'bot:1')]])); assert.equal(r.state.game.players.has('bot:1'), true, 'bots leave only between rounds');
  r.tick(streams(['creator', [r.at('creator', LEAVE, 'guest')]])); assert.equal(r.state.game.players.get('guest')!.connected, false, 'mid-round leave keeps the seat');
  r.tick(streams(['creator', [r.at('creator', ACTION, 'lobby', 'match-2')]]));
  assert.equal(r.state.game.phase, 'lobby'); assert.equal(r.state.game.matchId, 'match-2'); assert.ok(r.state.game.tick > COUNTDOWN_TICKS, 'ticks stay monotonic across lobby resets');
  assert.deepEqual([...r.state.game.players.keys()], ['creator', 'bot:1'], 'disconnected riders are dropped by the lobby reset');
  r.tick(streams(['creator', [r.at('creator', BOT, 'remove', 'bot:1'), r.at('creator', ACTION, 'start', 'match-3')]]));
  assert.equal(r.state.game.players.has('bot:1'), false); assert.equal(r.state.game.phase, 'lobby', 'a start without two riders is ignored, not thrown');
  r.tick(streams(['creator', [r.at('creator', JOIN, 'guest', 'Guest', 1, 'cat', 2), r.at('creator', ACTION, 'start', 'match-3')]]));
  assert.equal(r.state.game.phase, 'countdown'); assert.equal(r.state.game.settings!.length, 1);
});

test('player entries steer and fire only for connected seats of the current generation; avatar entries apply anywhere', () => {
  const r = playing(); const guest = r.state.game.players.get('guest')!;
  const before = guest.angle;
  r.tick(streams(['guest', [r.at('guest', STEER, 1)]])); assert.notEqual(guest.angle, before);
  const turned = guest.angle; r.tick(); assert.notEqual(guest.angle, turned, 'held steering persists without entries');
  r.tick(streams(['guest', [r.at('guest', PRESS, 1)]])); assert.equal(guest.bombChargeStartedTick, r.state.game.tick);
  r.tick(streams(['guest', [r.at('guest', RELEASE, 1)]])); assert.equal(guest.bombChargeStartedTick, undefined); assert.equal(r.state.game.bombs.size, 1);
  r.tick(streams(['guest', [r.at('guest', AVATAR, 'robot')]], ['stranger', [entry(1, r.state.game.tick + 1, STEER, 3)]])); assert.equal(guest.avatarId, 'robot');
  r.tick(streams(['creator', [r.at('creator', PRESENCE, 'guest', false, 1)]]));
  assert.equal(guest.connected, false); const heading = guest.angle; r.tick(); r.tick(); assert.equal(guest.angle, heading, 'a disconnected rider holds a neutral heading');
  r.tick(streams(['creator', [r.at('creator', PRESENCE, 'guest', true, 2)]], ['guest', [r.at('guest', STEER, 2)]]));
  const resumed = guest.angle; r.tick(streams(['guest', [r.at('guest', STEER, 2)], 1])); assert.equal(guest.angle, resumed, 'entries from an old generation are ignored');
  r.tick(streams(['guest', [r.at('guest', STEER, 2)], 2])); assert.notEqual(guest.angle, resumed);
});

test('management entries from a non-creator are ignored unless the creator is disconnected and the sender is the lowest connected rider', () => {
  const r = playing();
  r.tick(streams(['guest', [r.at('guest', ACTION, 'lobby', 'hijack')]])); assert.equal(r.state.game.phase, 'playing');
  assert.equal(actingCreator(r.state, 'creator'), undefined);
  r.tick(streams(['creator', [r.at('creator', JOIN, 'zed', 'Zed', 2, 'fox', 1), r.at('creator', PRESENCE, 'creator', false, 1)]]));
  assert.equal(actingCreator(r.state, 'creator'), 'guest');
  r.tick(streams(['zed', [r.at('zed', ACTION, 'lobby', 'zed')]])); assert.equal(r.state.game.phase, 'playing', 'only the lowest connected rider acts');
  r.tick(streams(['guest', [r.at('guest', SETTINGS, { ...settings, length: 5 })]])); assert.equal(r.state.settings.length, 5, 'the acting creator manages the room');
  r.tick(streams(['creator', [r.at('creator', PRESENCE, 'creator', true, 2)]], ['guest', [r.at('guest', SETTINGS, { ...settings, length: 7 })]]));
  assert.equal(r.state.settings.length, 5, 'the creator returning revokes delegation in the same tick');
  r.tick(streams(['creator', [r.at('creator', PRESENCE, 'creator', false, 2)]]));
  r.tick(streams(['guest', [r.at('guest', ACTION, 'lobby', 'delegated')]])); assert.equal(r.state.game.phase, 'lobby'); assert.equal(r.state.game.matchId, 'delegated');
  assert.equal(r.state.game.players.has('creator'), false, 'a lobby reset drops the absent creator; it rejoins through its own join entry');
  r.tick(streams(['creator', [r.at('creator', JOIN, 'creator', 'Creator', 0, 'fox', 3)]])); assert.equal(actingCreator(r.state, 'creator'), undefined);
});

test('round progression prunes disconnected riders, applies pending powerup weights and needs two connected riders', () => {
  const r = playing();
  r.tick(streams(['creator', [r.at('creator', JOIN, 'third', 'Third', 2, 'fox', 1), r.at('creator', SETTINGS, { ...settings, weights: { shell: 1 }, length: 9 })]]));
  assert.equal(r.state.game.players.get('third')!.alive, false);
  eliminatePlayer(r.state.game, 'guest'); r.tick(); assert.equal(r.state.game.phase, 'roundOver');
  r.tick(streams(['creator', [r.at('creator', PRESENCE, 'guest', false, 1)]]));
  for (let i = 0; i < ROUND_OVER_TICKS; i++) r.tick();
  assert.equal(r.state.game.phase, 'countdown'); assert.equal(r.state.game.round, 2); assert.equal(r.state.game.players.has('guest'), false);
  assert.deepEqual(r.state.game.settings!.weights, { shell: 1 }); assert.equal(r.state.game.settings!.length, 3);
  eliminatePlayer(r.state.game, 'third'); for (let i = 0; i < COUNTDOWN_TICKS; i++) r.tick(); eliminatePlayer(r.state.game, 'third'); r.tick();
  r.tick(streams(['creator', [r.at('creator', PRESENCE, 'third', false, 1)]]));
  for (let i = 0; i < ROUND_OVER_TICKS + 2; i++) r.tick();
  assert.equal(r.state.game.phase, 'roundOver', 'one connected rider cannot start the next round'); assert.equal(r.state.game.players.size, 1);
  assert.equal(r.state.game.players.get('creator')!.bombChargeStartedTick, undefined);
});

test('bots are simulated on every replica and the same log always folds to the same hash', () => {
  const build = () => { const r = room(); r.tick(streams(['creator', [r.at('creator', JOIN, 'creator', 'Creator', 0, 'fox', 1), r.at('creator', BOT, 'add', 'bot:1', 'AI Turing', 1, ), r.at('creator', BOT, 'add', 'bot:2', 'AI Hopper', 2)]])); r.tick(streams(['creator', [r.at('creator', ACTION, 'start', 'm')]])); for (let i = 0; i < 400; i++) r.tick(); return r.state; };
  const a = build(), b = build();
  assert.equal(hashRoomState(a), hashRoomState(b)); assert.equal(canonicalRoomState(a), canonicalRoomState(b));
  assert.ok([...a.game.matchStats.values()].some(stats => stats.distanceUnits > 0), 'bots moved');
  assert.match(hashText('x'), /^[0-9a-f]{16}$/); assert.notEqual(hashText('a'), hashText('b')); assert.equal(RULES, 'fuse-p2p-1');
  const reordered = createRoomState('room', settings); reordered.game.players = new Map([...a.game.players].reverse()); reordered.game.tick = a.game.tick;
  assert.notEqual(hashRoomState(reordered), hashRoomState(a));
  const shuffled = structuredClone(a); shuffled.game.players = new Map([...a.game.players].reverse()); assert.equal(hashRoomState(shuffled), hashRoomState(a), 'map order never matters');
});

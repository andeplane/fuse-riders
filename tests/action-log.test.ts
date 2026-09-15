import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTick, canonical, cloneState, createReplayState, edgesFrom, replayHash, validEntry, type EntryBody, type LogEntry, type ReplayState } from '../src/shared/action-log.js';
import { createGame } from '../src/shared/game.js';
import { BombInputBuffer } from '../src/shared/bomb-input.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';

const HOST = 'host';
export function fresh(): ReplayState { return createReplayState(createGame('match-1'), defaultRoomSettings()); }
let seq = 0;
export const entry = (tick: number, ...body: EntryBody): LogEntry => [++seq, tick, ...body] as LogEntry;
/** Applies entries keyed by member at the next tick. */
export function tick(state: ReplayState, entries: Record<string, EntryBody[]> = {}) {
  const map = new Map<string, LogEntry[]>();
  for (const [id, bodies] of Object.entries(entries)) map.set(id, bodies.map(body => entry(state.game.tick + 1, ...body)));
  return applyTick(state, state.game.tick + 1, HOST, map);
}
export function lobby(): ReplayState {
  const state = fresh();
  tick(state, { [HOST]: [[10, HOST, 'Host', 0, null], [10, 'guest', 'Guest', 1, 'robot']] });
  return state;
}
export function playing(): ReplayState {
  const state = lobby();
  tick(state, { [HOST]: [[14, 'start', 'match-1']] });
  while (state.game.phase === 'countdown') tick(state);
  return state;
}

test('entries are validated by kind, arity and bounds', () => {
  for (const good of [[1, 1, 0, 3], [1, 5, 1, 0.5, 1], [2, 5, 2, 7], [3, 5, 3, 7, null, null], [3, 5, 3, 7, 0.1, 0.9], [4, 5, 4, 7], [5, 5, 5, 'robot'], [6, 1, 10, 'm', 'Name', 4, null], [7, 1, 11, 'm'], [8, 1, 12, 'm', false], [9, 1, 13, defaultRoomSettings()], [10, 1, 14, 'lobby', 'next']]) assert.ok(validEntry(good), JSON.stringify(good));
  for (const bad of [null, [], [0, 1, 0, 1], [1, 0, 0, 1], [1, -1, 0, 1], [1, 1, 0, 4], [1, 0, 1, -0, 0], [1, 0, 1, 2, 0], [1, 0, 3, 1, 0.5, null], [1, 0, 5, 'nope'], [1, 0, 10, '', 'Name', 0, null], [1, 0, 10, 'm', ' ', 0, null], [1, 0, 10, 'm', 'Name', 5, null], [1, 0, 12, 'm', 'yes'], [1, 0, 13, { bad: true }], [1, 0, 14, 'kick', 'x'], [1, 0, 9]]) assert.equal(validEntry(bad), false, JSON.stringify(bad));
});
test('join, presence, leave and settings fold with guards instead of throws', () => {
  const state = lobby();
  assert.deepEqual([...state.game.players.keys()], [HOST, 'guest']);
  tick(state, { [HOST]: [[10, 'third', 'Third', 1, null]] }); assert.equal(state.game.players.size, 2, 'an occupied slot is a no-op');
  tick(state, { [HOST]: [[10, 'guest', 'Guest', 1, null]] }); assert.equal(state.game.players.get('guest')!.connected, true, 'a known member rejoins');
  tick(state, { [HOST]: [[12, 'guest', false]] }); assert.equal(state.game.players.get('guest')!.connected, false);
  tick(state, { [HOST]: [[12, 'ghost', false], [11, 'ghost']] }); assert.equal(state.game.players.size, 2, 'unknown members are ignored');
  tick(state, { [HOST]: [[13, { ...defaultRoomSettings(), length: 1 }]] }); assert.equal(state.game.settings!.length, 1, 'lobby settings apply at once');
  tick(state, { [HOST]: [[14, 'start', 'match-1']] }); assert.equal(state.game.phase, 'lobby', 'one connected player cannot start');
  assert.equal(state.game.players.has('guest'), false, 'a failed start between rounds still prunes disconnected riders, as before');
  tick(state, { [HOST]: [[10, 'guest', 'Guest', 1, null], [14, 'start', 'match-1']] }); assert.equal(state.game.phase, 'countdown');
  tick(state, { [HOST]: [[11, 'guest']] }); assert.equal(state.game.players.size, 2, 'leave mid-match is a no-op');
  tick(state, { guest: [[10, 'x', 'X', 3, null]] }); assert.equal(state.game.players.size, 2, 'management from a non-creator stream is ignored');
  tick(state, { [HOST]: [[14, 'lobby', 'match-2']] }); assert.equal(state.game.phase, 'lobby'); assert.equal(state.game.matchId, 'match-2');
  assert.equal(state.game.tick > 0, true, 'return to lobby keeps the transport tick');
});
test('settings entries validate aim time and replay applies it only at the next round', () => {
  for (const bombChargeTicks of [2, 8, 40]) assert.ok(validEntry([1, 1, 13, { ...defaultRoomSettings(), bombChargeTicks }]), String(bombChargeTicks));
  for (const bombChargeTicks of [0, 1, 41, 2.5, '8', null, Number.NaN]) assert.equal(validEntry([1, 1, 13, { ...defaultRoomSettings(), bombChargeTicks }]), false, String(bombChargeTicks));
  const state = playing();
  tick(state, { [HOST]: [[13, { ...defaultRoomSettings(), bombChargeTicks: 24 }]] });
  assert.equal(state.pending.bombChargeTicks, 24); assert.equal(state.game.settings!.bombChargeTicks, 8, 'mid-round settings stay pending');
  const guest = state.game.players.get('guest')!; guest.invulnerableUntilTick = 1e9; state.game.players.get(HOST)!.invulnerableUntilTick = 1e9;
  guest.x = 400; guest.y = 450; guest.angle = 0;
  tick(state, { guest: [[2, 1]] }); for (let i = 0; i < 7; i++) tick(state);
  tick(state, { guest: [[3, 1, null, null]] });
  const bomb = [...state.game.bombs.values()].find(b => b.ownerId === 'guest')!;
  assert.ok(Math.abs(Math.hypot(bomb.x - bomb.launchX, bomb.y - bomb.launchY) - 400) < 1e-8, 'an 8-tick hold reaches full range under the still-active default');
  state.game.players.get(HOST)!.invulnerableUntilTick = 0; state.game.players.get(HOST)!.alive = false;
  const round = state.game.round;
  for (let i = 0; i < 400 && state.game.round === round; i++) tick(state);
  assert.equal(state.game.round, round + 1); assert.equal(state.game.settings!.bombChargeTicks, 24, 'the next round adopts the pending aim time');
  const copy = cloneState(state); copy.pending = { ...copy.pending, bombChargeTicks: 12 }; assert.notEqual(replayHash(copy), replayHash(state), 'pending aim time is part of the replica hash');
});
test('press, release and cancel fold through one shared bomb buffer per stream', () => {
  const state = playing();
  for (const player of state.game.players.values()) player.invulnerableUntilTick = 1e9; // bounce off walls so the round outlasts the cooldown
  tick(state, { guest: [[2, 1]] }); assert.notEqual(state.game.players.get('guest')!.bombChargeStartedTick, undefined);
  for (let i = 0; i < 5; i++) tick(state);
  tick(state, { guest: [[3, 9, null, null]] }); assert.notEqual(state.game.players.get('guest')!.bombChargeStartedTick, undefined, 'a mismatched release is a no-op');
  tick(state, { guest: [[3, 1, null, null]] }); assert.equal(state.game.players.get('guest')!.bombChargeStartedTick, undefined); assert.equal([...state.game.bombs.values()].filter(b => b.ownerId === 'guest').length, 1);
  for (let i = 0; i < 90; i++) tick(state);
  tick(state, { guest: [[2, 2]] }); tick(state, { guest: [[2, 3]] }); assert.notEqual(state.game.players.get('guest')!.bombChargeStartedTick, undefined, 'a second press while active cancels then presses');
  tick(state, { guest: [[4, 3]] }); assert.equal(state.game.players.get('guest')!.bombChargeStartedTick, undefined);
  const tap = tick(state, { guest: [[2, 4], [3, 4, 0.5, 0.5]] }); assert.ok(tap.some(e => e.type === 'bombPlaced' && e.playerId === 'guest'), 'a same-tick tap fires');
  tick(state, { guest: [[0, 1]] }); assert.equal(state.streams.get('guest')!.flags, 1);
  tick(state, { guest: [[5, 'robot']] }); assert.equal(state.game.players.get('guest')!.avatarId, 'robot');
});
test('a phase change and presence loss clear charges but keep held steering', () => {
  const state = lobby();
  tick(state, { guest: [[0, 2]] });
  tick(state, { [HOST]: [[14, 'start', 'match-1']] });
  assert.equal(state.streams.get('guest')!.flags, 2);
  while (state.game.phase === 'countdown') tick(state);
  tick(state, { guest: [[2, 1]] }); assert.notEqual(state.game.players.get('guest')!.bombChargeStartedTick, undefined);
  tick(state, { [HOST]: [[12, 'guest', false]] }); assert.equal(state.game.players.get('guest')!.bombChargeStartedTick, undefined); assert.equal(state.streams.get('guest')!.flags, 0);
});
test('clone and hash cover streams, pending settings and the bomb latch', () => {
  const state = playing(); tick(state, { guest: [[2, 1], [1, 0.25, 0.75]] });
  const copy = cloneState(state);
  assert.equal(replayHash(copy), replayHash(state)); assert.equal(canonical(copy.streams), canonical(state.streams));
  tick(copy); assert.notEqual(replayHash(copy), replayHash(state));
  copy.streams.get('guest')!.bombs = new BombInputBuffer(); assert.notEqual(canonical(copy.streams), canonical(state.streams));
  assert.equal(canonical(-0) === canonical(0), false);
});
test('edgesFrom turns an intent into the minimal entries', () => {
  let gesture = 0; const next = () => ++gesture;
  assert.deepEqual(edgesFrom({ flags: 0 }, { left: true, right: false, bomb: false }, next), [[0, 1]]);
  assert.deepEqual(edgesFrom({ flags: 1 }, { left: true, right: false, bomb: true, bombCommands: [{ action: 'press' }] }, next), [[2, 1]]);
  assert.deepEqual(edgesFrom({ flags: 1, gesture: 1 }, { left: true, right: false, bomb: false, aim: { x: 0.5, y: 0.5 }, bombCommands: [{ action: 'release', aim: { x: 0.5, y: 0.5 } }] }, next), [[1, 0.5, 0.5], [3, 1, 0.5, 0.5]]);
  assert.deepEqual(edgesFrom({ flags: 1, aim: { x: 0.5, y: 0.5 }, gesture: 2 }, { left: true, right: false, bomb: false, aim: { x: 0.5, y: 0.5 }, bombCommands: [{ action: 'cancel' }] }, next), [[4, 2]]);
  assert.deepEqual(edgesFrom({ flags: 1 }, { left: true, right: false, bomb: false, bombCommands: [{ action: 'release' }] }, next), [], 'a release without a gesture is nothing');
});
test('applyTick refuses a non-contiguous tick', () => { const state = lobby(); assert.throws(() => applyTick(state, state.game.tick + 2, HOST, new Map()), /expected tick/); });

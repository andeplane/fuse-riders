import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSession } from '../src/online/host-session.js';
import { CHECKPOINT_VERSION, MAX_CHECKPOINT_BYTES, MAX_CHECKPOINT_TRAILS } from '../src/online/checkpoint.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import { createPortalPair } from '../src/shared/portal.js';

const session = () => new HostSession('host', defaultRoomSettings(), { token: () => 'test-match' });
const playing = () => {
  const s = session();
  s.command('host', { type: 'join', name: 'Host' }); s.command('guest', { type: 'join', name: 'Guest' });
  s.command('host', { type: 'action', action: 'start' });
  for (let tick = 0; tick < 60; tick++) s.advance();
  return s;
};
function object(value: unknown): Record<string, unknown> { assert.ok(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>; }
function list(value: unknown): unknown[] { assert.ok(Array.isArray(value)); return value; }
function mapped(value: unknown): unknown[][] { return list(object(value).$map).map(list); }
function corrupt(s: HostSession, change: (data: Record<string, unknown>, game: Record<string, unknown>) => void): string {
  const data = object(JSON.parse(s.checkpoint())); change(data, object(data.game)); return JSON.stringify(data);
}
function rejectedWithoutMutation(raw: string): void {
  const healthy = playing(); const before = healthy.checkpoint(); const game = healthy.game; const settings = healthy.settings;
  assert.equal(healthy.restore(raw), false); assert.equal(healthy.game, game); assert.equal(healthy.settings, settings); assert.equal(healthy.checkpoint(), before);
}

test('checkpoint restore is atomic on the malformed sequences regression', () => {
  rejectedWithoutMutation(corrupt(playing(), (data, game) => { game.tick = 999; data.sequences = null; }));
});

test('checkpoint restores exact physics, pending preferences and neutral disconnected identities', () => {
  const source = playing(); source.command('guest', { type: 'input', left: false, right: false, bomb: false }); source.command('guest', { type: 'input', left: true, right: false, bomb: true, bombAction: 'press' }); source.advance();
  assert.notEqual(source.game.players.get('guest')?.bombChargeStartedTick, undefined);
  source.settings = { ...source.settings, length: 9, bombChargeTicks: 24 };
  const destination = session(); assert.equal(destination.restore(source.checkpoint()), true);
  assert.equal(destination.game.tick, source.game.tick); assert.equal(destination.settings.length, 9); assert.equal(destination.game.settings?.length, 3);
  assert.equal(destination.settings.bombChargeTicks,24);assert.equal(destination.snapshot().bombChargeTicks,8);
  for (const p of destination.game.players.values()) { assert.equal(p.connected, false); assert.equal(p.bombChargeStartedTick, undefined); assert.equal(p.bombTarget, undefined); }
  assert.equal(destination.command('guest', { type: 'join', name: 'Guest' }), undefined); destination.advance();
  assert.equal(destination.game.players.get('guest')?.connected, true);
  destination.advance(); assert.equal(destination.game.bombs.size, 0);
});

test('checkpoint rejects missing required game maps and nested fields', () => {
  for (const key of ['settings','players','bombs','pickups','leaderboard','roundParticipants','matchStats','randomState','roundScored']) rejectedWithoutMutation(corrupt(playing(), (_data, game) => { delete game[key]; }));
  for (const key of ['trail','alive','drunkHeadingOffset','shielded','avatarId']) rejectedWithoutMutation(corrupt(playing(), (_data, game) => { delete object(mapped(game.players)[0][1])[key]; }));
  for (const key of ['deathsByCause','currentRoundSurvivalTicks','distanceUnits']) rejectedWithoutMutation(corrupt(playing(), (_data, game) => { delete object(mapped(game.matchStats)[0][1])[key]; }));
});

test('checkpoint carries highlight moments and shell bounces and rejects malformed ones', () => {
  const source = playing();
  const tick = source.game.tick;
  source.game.moments.push({ kind: 'cutOff', round: 1, tick, elapsed: 1, playerId: 'host', targetIds: ['guest'], value: 5 }, { kind: 'ownGoal', round: 1, tick, elapsed: 1, playerId: 'guest', targetIds: [], value: 1 });
  const restored = session();
  assert.equal(restored.restore(source.checkpoint()), true);
  assert.deepEqual(restored.game.moments, source.game.moments);
  const first = (game: Record<string, unknown>) => object(list(game.moments)[0]);
  rejectedWithoutMutation(corrupt(source, (_data, game) => { delete game.moments; }));
  rejectedWithoutMutation(corrupt(source, (_data, game) => { first(game).kind = 'closeCall'; }));
  rejectedWithoutMutation(corrupt(source, (_data, game) => { first(game).tick = tick + 1; }));
  rejectedWithoutMutation(corrupt(source, (_data, game) => { first(game).elapsed = tick + 1; }));
  rejectedWithoutMutation(corrupt(source, (_data, game) => { first(game).round = 2; }));
  rejectedWithoutMutation(corrupt(source, (_data, game) => { first(game).playerId = 'nobody'; }));
  rejectedWithoutMutation(corrupt(source, (_data, game) => { first(game).targetIds = ['nobody']; }));
  rejectedWithoutMutation(corrupt(source, (_data, game) => { first(game).targetIds = ['host']; }));
  rejectedWithoutMutation(corrupt(source, (_data, game) => { first(game).targetIds = ['guest', 'guest']; }));
  rejectedWithoutMutation(corrupt(source, (_data, game) => { first(game).value = 1.5; }));
  rejectedWithoutMutation(corrupt(source, (_data, game) => { first(game).extra = true; }));
  rejectedWithoutMutation(corrupt(source, (_data, game) => { const moments = list(game.moments); moments.push(...Array.from({ length: 8 }, () => ({ ...moments[0] as object }))); }));
  const shooter = playing();
  shooter.game.players.get('host')!.shellArmed = true;
  shooter.command('host', { type: 'input', left: false, right: false, bomb: false });
  shooter.command('host', { type: 'input', left: false, right: false, bomb: true, bombAction: 'press' }); shooter.advance();
  shooter.command('host', { type: 'input', left: false, right: false, bomb: false, bombAction: 'release' }); shooter.advance();
  // The host spawns facing east 773 units from the wall; at 22.5 units a tick the shell has bounced well within two seconds.
  for (let i = 0; i < 40; i++) shooter.advance();
  const shell = [...shooter.game.bombs.values()].find(bomb => bomb.shell)!;
  assert.ok((shell.shell!.bounces ?? 0) >= 1, 'a shell that has been flying for two seconds has hit the wall');
  const bounced = session();
  assert.equal(bounced.restore(shooter.checkpoint()), true);
  assert.equal(bounced.game.bombs.get(shell.id)!.shell!.bounces, shell.shell!.bounces);
  rejectedWithoutMutation(corrupt(shooter, (_data, game) => { object(object(mapped(game.bombs)[0][1]).shell).bounces = -1; }));
  rejectedWithoutMutation(corrupt(shooter, (_data, game) => { object(object(mapped(game.bombs)[0][1]).shell).bounces = 1.5; }));
});

test('checkpoint rejects schema incompatibility, foreign host and unsafe shape extensions', () => {
  rejectedWithoutMutation(corrupt(playing(), data => { data.compatibility='fuse-simulation-1'; }));
  rejectedWithoutMutation(corrupt(playing(), (_data,game) => { object(game.settings).bombChargeTicks=0; }));
  for (const [key, value] of [['version', 1], ['version', CHECKPOINT_VERSION + 1], ['compatibility', 'future-build'], ['host', 'other-host'], ['unknown', true]]) rejectedWithoutMutation(corrupt(playing(), data => { data[String(key)] = value; }));
  rejectedWithoutMutation('{broken'); rejectedWithoutMutation('null');
  rejectedWithoutMutation(corrupt(playing(), (_data, game) => { game['con' + 'structor'] = 'bad'; }));
});

test('checkpoint rejects invalid sequences, duplicate map keys and cross references', () => {
  for (const sequences of [[['guest', -2]], [['guest', 0.1]], [['guest', 1], ['guest', 2]], [['missing', 1]]]) rejectedWithoutMutation(corrupt(playing(), data => { data.sequences = sequences; }));
  rejectedWithoutMutation(corrupt(playing(), (_data, game) => { const entries = mapped(game.players); object(game.players).$map = [...entries, entries[0]]; }));
  rejectedWithoutMutation(corrupt(playing(), (_data, game) => { object(mapped(game.players)[0][1]).id = 'wrong-key'; }));
  rejectedWithoutMutation(corrupt(playing(), (_data, game) => { const p = mapped(game.players); object(p[1][1]).slot = object(p[0][1]).slot; }));
  rejectedWithoutMutation(corrupt(playing(), (_data, game) => { game.roundWinnerId = 'unknown'; }));
});

test('checkpoint rejects nonfinite values, excessive bytes/depth and oversized nested trails', () => {
  for (const value of [NaN, Infinity, -Infinity, -1, 1.5]) rejectedWithoutMutation(corrupt(playing(), (_data, game) => { game.tick = value; }));
  rejectedWithoutMutation(corrupt(playing(), (_data, game) => { object(mapped(game.players)[0][1]).x = Infinity; }));
  rejectedWithoutMutation(' '.repeat(MAX_CHECKPOINT_BYTES + 1));
  rejectedWithoutMutation(corrupt(playing(), data => { let deep: unknown = 0; for (let i = 0; i < 20; i++) deep = { next: deep }; data.extra = deep; }));
  rejectedWithoutMutation(corrupt(playing(), (_data, game) => { object(mapped(game.players)[0][1]).trail = Array.from({ length: MAX_CHECKPOINT_TRAILS + 1 }, () => ({ x1: 1, y1: 1, x2: 2, y2: 2, createdTick: 1, expiresAtTick: 161 })); }));
  rejectedWithoutMutation(corrupt(playing(), (_data, game) => { object(mapped(game.players)[0][1]).trail = [{ x1: 1, y1: 1, x2: 2, y2: 2, createdTick: 99, expiresAtTick: 2 }]; }));
});

test('real countdown, playing and round transitions produce restorable bounded checkpoints', () => {
  const source = playing();
  for (let tick = 0; tick < 2000; tick++) { source.advance(); if (tick % 17 === 0) { const restored = session(); assert.equal(restored.restore(source.checkpoint()), true, `phase ${source.game.phase}, tick ${source.game.tick}`); const expected = structuredClone(source.game); for (const p of expected.players.values()) { p.connected = false; p.bombChargeStartedTick = undefined; p.bombTarget = undefined; } const serialize = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => item instanceof Map ? { $map: [...item] } : item); assert.equal(serialize(restored.game), serialize(expected)); } }
});

test('checkpoint validates bombs, shell lifetime sentinel, pickups and portal geometry', () => {
  const source = playing();
  const p = source.game.players.get('host')!; p.shellArmed = true;
  source.command('host', { type: 'input', left: false, right: false, bomb: false });
  source.command('host', { type: 'input', left: false, right: false, bomb: true, bombAction: 'press' }); source.advance();
  source.command('host', { type: 'input', left: false, right: false, bomb: false, bombAction: 'release' }); source.advance();
  assert.equal(source.game.bombs.size, 1); assert.equal(session().restore(source.checkpoint()), true);
  rejectedWithoutMutation(corrupt(source, (_data, game) => { object(mapped(game.bombs)[0][1]).ownerId = 'unknown'; }));
  rejectedWithoutMutation(corrupt(source, (_data, game) => { object(object(mapped(game.bombs)[0][1]).shell).vx = Infinity; }));
  const gates = (index: number) => createPortalPair({ id: `portal-${index}`, tick: source.game.tick, bounds: { minX: 20, minY: 20, maxX: 1580, maxY: 880 }, riderRadius: 7, random: (() => { let n = index; return () => (++n % 3) / 3; })(), isSafe: () => true })!;
  source.game.portalPairs = [gates(0), gates(1)];
  assert.equal(source.game.portalPairs.length, 2); assert.equal(session().restore(source.checkpoint()), true);
  rejectedWithoutMutation(corrupt(source, (_data, game) => { object(list(object(list(game.portalPairs)[1]).gates)[0]).halfLength = 999; }));
  // Exit safety exempts the pair in use by id, so duplicate ids would exempt a foreign wall.
  rejectedWithoutMutation(corrupt(source, (_data, game) => { object(list(game.portalPairs)[1]).id = 'portal-0'; }));
  rejectedWithoutMutation(corrupt(source, (_data, game) => { object(list(game.portalPairs)[1]).expiresAtTick = 0; }));
  rejectedWithoutMutation(corrupt(source, (_data, game) => { const list_ = game.portalPairs as unknown[]; list_.push(list_[0], list_[1], list_[0]); }));
});


test('checkpoint rejects oversized history, malformed maps and missing participant statistics', () => {
  rejectedWithoutMutation(corrupt(playing(), (_data, game) => { object(game.bombs).$map = [[1]]; }));
  rejectedWithoutMutation(corrupt(playing(), (_data, game) => { object(game.bombs).extra = 1; }));
  rejectedWithoutMutation(corrupt(playing(), (_data, game) => { const sample = mapped(game.leaderboard)[0][1]; object(game.leaderboard).$map = Array.from({ length: 129 }, (_, i) => [`id-${i}`, { ...object(sample), id: `id-${i}` }]); }));
  rejectedWithoutMutation(corrupt(playing(), (_data, game) => { object(game.matchStats).$map = []; }));
  rejectedWithoutMutation(corrupt(playing(), (_data, game) => { object(mapped(game.roundParticipants)[0][1]).eliminatedAtTick = 999999; }));
  rejectedWithoutMutation(corrupt(playing(), (_data, game) => { game.phase = 'unknown'; }));
});

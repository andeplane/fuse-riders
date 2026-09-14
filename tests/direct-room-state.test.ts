import test from 'node:test';
import assert from 'node:assert/strict';
import { addPlayer, createGame, SLOT_COLORS, startMatch, step, toSnapshot } from '../src/shared/game.js';
import { DIRECT_RULES, type DirectState } from '../src/shared/direct-input.js';
import { replayHash } from '../src/shared/action-log.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import { catalog, catalogView, deriveTransition, initialWorld, isCatalog, isPlan, isPreparation, isThinView, isView, lobbyGame, manager, neutral, ownersFor, prepareWorld, thinSnapshot, transitionBytes, type RoomPlan } from '../src/online/direct-room-state.js';
import { packBootstrap, RollbackWorld } from '../src/online/rollback-world.js';
import { packMessage, unpackMessage } from '../src/online/action-replication.js';

function fixture(playing = false) {
  const game = createGame('room-state', 42); game.settings = defaultRoomSettings();
  for (let slot = 0; slot < 2; slot++) addPlayer(game, { id: `p${slot}`, name: `Rider ${slot}`, slot, color: SLOT_COLORS[slot] });
  if (playing) { startMatch(game); for (let i = 0; i < 65; i++) step(game, new Map()); }
  const state: DirectState = { game, held: new Map(), gestures: new Map() };
  const world = RollbackWorld.open(packBootstrap(1, state, [[0, 0], [1, 0]]), 1)!;
  const plan: RoomPlan = { type: 'directPlan', rules: DIRECT_RULES, revision: 2, initialize: false, incarnation: 'room', epoch: 1, source: 'p0', coordinator: 'p0', settings: defaultRoomSettings(), members: [0, 1].map(i => ({ id: `p${i}`, connection: `c${i}`, view: true, display: false })) };
  return { game, state, world, plan };
}

test('initial room preparation accepts tick-stamped snapshots and rejects unknown snapshot fields', () => {
  const { plan } = fixture();
  const value = catalog(createGame('empty'), plan.settings), world = initialWorld(value, 1);
  const payload = transitionBytes(world, []), derived = deriveTransition(payload, 2)!;
  const status = thinSnapshot(catalogView(value));
  const header = { type: 'directPrepare', revision: 2, alias: 2, bytes: payload.length, hash: derived.hash, matchId: value.matchId, tick: 0, round: 1, status, lobby: value, owners: [] };
  assert.equal(isView(status), true); assert.equal(isPreparation(header, plan), true);
  assert.equal(isView({ ...status, extra: true }), false);
  for (const tick of [-1, 1.5, 2 ** 32, NaN]) assert.equal(isView({ ...status, tick }), false);
  assert.equal(isView({ ...status, round: 0 }), false);
  assert.equal(isView(null), false);
  assert.equal(isPreparation({ ...header, bytes: 2_000_001 }, plan), false);
});

test('lifecycle changes reproduce validated management operations with neutral input state', () => {
  const { game, state, plan } = fixture(true);
  state.held.set(0, { at: game.tick, flags: 5, aim: [.5, .5] }); state.gestures.set(0, { active: 1, latest: 1 });
  game.players.get('p0')!.bombChargeStartedTick = game.tick; game.players.get('p0')!.bombTarget = { x: .5, y: .5 };
  const world = RollbackWorld.open(packBootstrap(1, state, [[0, 1], [1, 0]]), 1)!;
  const clean = neutral(state), session = manager('p0', clean.game, plan.settings);
  assert.equal(session.command('p0', { type: 'action', action: 'lobby' }), undefined);
  const before = replayHash(world.state), payload = transitionBytes(world, session.journal.since(0)!);
  const derived = deriveTransition(payload, 2, world)!;
  assert.equal(derived.state.game.phase, 'lobby');
  assert.equal(derived.state.game.matchId, session.game.matchId);
  const expected: DirectState = { game: session.game, held: new Map(), gestures: new Map() };
  assert.equal(replayHash(derived.state), replayHash(expected));
  assert.equal(derived.state.held.size, 0); assert.equal(derived.state.gestures.size, 0);
  assert.equal(derived.state.game.players.get('p0')!.bombChargeStartedTick, undefined);
  assert.equal(derived.state.game.players.get('p0')!.bombTarget, undefined);
  assert.equal(replayHash(world.state), before);
  assert.ok(RollbackWorld.open(derived.bootstrap, 2));
});

test('lifecycle checkpoint validation fences the actual old state and leaves healthy state untouched', () => {
  const { world, state } = fixture(true), original = replayHash(world.state);
  const different = structuredClone(state); different.game.players.get('p0')!.x += 1;
  const conflict = RollbackWorld.open(packBootstrap(1, different, [[0, 0], [1, 0]]), 1)!;
  assert.equal(deriveTransition(transitionBytes(conflict, []), 2, world), undefined);
  const newer = structuredClone(state); step(newer.game, new Map());
  const fence = RollbackWorld.open(packBootstrap(1, newer, [[0, 0], [1, 0]]), 1)!;
  assert.equal(deriveTransition(transitionBytes(world, []), 2, fence), undefined);
  const raw = unpackMessage(transitionBytes(world, [])) as unknown[];
  for (const payload of [packMessage(null), packMessage([0, raw[1], []]), packMessage([1, raw[1], [[0, state.game.tick + 1, []]]]), packMessage([1, raw[1], [[99]]]), packMessage([1, raw[1], Array.from({ length: 65 }, () => [3, 'p0', true])]), packMessage([1, raw[1], [[6, 'unknown', 'cat']]]), new Uint8Array(2_000_001), new Uint8Array([0xc1])]) assert.equal(deriveTransition(payload, 2), undefined);
  assert.equal(deriveTransition(transitionBytes(world, []), 0), undefined);
  assert.equal(replayHash(world.state), original);
});

test('controller status contains no world geometry and cannot change stream ownership', () => {
  const { game, plan, world } = fixture(true), view = { ...toSnapshot(game), tick: game.tick, round: game.round };
  const status = thinSnapshot(view, 'p1');
  assert.equal(isThinView(status, 'p1'), true); assert.equal(isThinView(view, 'p1'), false);
  assert.equal(status.players.find(p => p.id === 'p0')!.x, 0);
  assert.equal(status.players.find(p => p.id === 'p1')!.x, game.players.get('p1')!.x);
  assert.equal(isThinView(status), false);
  const derived = deriveTransition(transitionBytes(world, []), 2)!;
  const header = { type: 'directPrepare', revision: 2, alias: 2, bytes: 100, hash: derived.hash, matchId: game.matchId, tick: game.tick, round: game.round, status: thinSnapshot(view), owners: ownersFor(game, plan) };
  assert.equal(isPreparation(header, plan), true);
  assert.equal(isPreparation({ ...header, owners: [[0, 'p1'], [1, 'p0']] }, plan), false);
  assert.equal(isPreparation({ ...header, owners: [[0, 'p0'], [0, 'p1']] }, plan), false);
});

test('room catalogs and delegation validate identities and mode-specific simulator ownership', () => {
  const { game, plan } = fixture(); const value = catalog(game, plan.settings);
  assert.equal(isCatalog(value), true); assert.deepEqual(catalog(lobbyGame(value), plan.settings), value);
  assert.equal(isCatalog({ ...value, players: [value.players[0], value.players[0]] }), false);
  assert.throws(() => lobbyGame({ ...value, seed: -1 }), /Invalid lobby/);
  assert.equal(isPlan(plan), true);
  for (const broken of [{ ...plan, rules: 'old' }, { ...plan, members: [plan.members[0], plan.members[0]] }, { ...plan, source: 'gone' }, { ...plan, coordinator: null }, { ...plan, settings: { ...plan.settings, mode: 'shared' } }]) assert.equal(isPlan(broken), false);
  const shared: RoomPlan = { ...plan, coordinator: null, settings: { ...plan.settings, mode: 'shared' }, members: plan.members.map(m => ({ ...m, view: false })) };
  assert.equal(isPlan(shared), true);
  game.players.get('p1')!.connected = false;
  assert.deepEqual(ownersFor(game, plan), [[0, 'p0'], [1, 'p0']]);
});


test('played lobby catalog reconstructs the exact nonzero-tick checkpoint and ordered historical scores', () => {
  const { game, state, plan } = fixture(true);
  game.leaderboard.get('p0')!.totalScoreUnits = 1; game.leaderboard.get('p1')!.totalScoreUnits = 50;
  game.leaderboard.set('departed', { id: 'departed', name: 'Past rider', totalScoreUnits: 100, roundsPlayed: 1, roundWins: 1, matchWins: 0 });
  const session = manager('p0', state.game, plan.settings);
  assert.equal(session.command('p0', { type: 'action', action: 'lobby' }), undefined);
  const value = catalog(session.game, plan.settings);
  assert.equal(value.tick, 65); assert.deepEqual(value.leaderboard.map(p => p.id), ['p0', 'p1', 'departed']);
  const reconstructed = initialWorld(value, 2);
  const expected: DirectState = { game: session.game, held: new Map(), gestures: new Map() };
  assert.equal(replayHash(reconstructed.state), replayHash(expected));
  assert.equal(isCatalog({ ...value, leaderboard: [...value.leaderboard, { id: 'invalid' }] }), false);
});


test('full-view preparation rejects a valid checkpoint paired with a different phase, round or status', () => {
  const { world, plan, game } = fixture(true), payload = transitionBytes(world, []), derived = deriveTransition(payload, 2)!;
  const header = { type: 'directPrepare' as const, revision: 2, alias: 2, bytes: payload.length, hash: derived.hash, matchId: game.matchId, tick: game.tick, round: game.round, status: thinSnapshot({ ...toSnapshot(game), tick: game.tick, round: game.round }), owners: ownersFor(game, plan) };
  assert.ok(prepareWorld(payload, header, plan, world));
  assert.equal(prepareWorld(payload, { ...header, round: 2, status: { ...header.status, round: 2 } }, plan, world), undefined);
  assert.equal(prepareWorld(payload, { ...header, status: { ...header.status, boundaryInset: 21 } }, plan, world), undefined);
  assert.equal(prepareWorld(payload, { ...header, status: { ...header.status, phase: 'lobby' }, lobby: catalog(game, plan.settings) }, plan, world), undefined);
  assert.equal(prepareWorld(payload, { ...header, bytes: payload.length + 1 }, plan, world), undefined);
});

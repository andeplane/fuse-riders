import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeGameState, encodeGameState, MAX_CHECKPOINT_TRAILS } from '../src/online/checkpoint.js';
import { BOMB_BLAST_RANGE, COUNTDOWN_TICKS, GRAVITY_FIELD_TICKS, SLOT_COLORS, addPlayer, createGame, startMatch, step, type GameState } from '../src/shared/game.js';
import { BOMB_FLIGHT_TICKS } from '../src/shared/bomb-launch.js';
import { MAX_PORTAL_PAIRS, createPortalPair } from '../src/shared/portal.js';

// The replica state a joiner installs comes from any peer, so decodeGameState is an untrusted boundary: every shape and
// cross-reference guard here is what keeps a corrupt or hostile snapshot from replacing a healthy world.
function playing(): GameState {
  const game = createGame('checkpoint');
  addPlayer(game, { id: 'p0', name: 'P0', slot: 0, color: SLOT_COLORS[0]!, connected: true }); addPlayer(game, { id: 'p1', name: 'P1', slot: 1, color: SLOT_COLORS[1]!, connected: true });
  startMatch(game); for (let i = 0; i < COUNTDOWN_TICKS + 60; i++) step(game, new Map());
  return game;
}
const object = (value: unknown): Record<string, unknown> => { assert.ok(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>; };
const list = (value: unknown): unknown[] => { assert.ok(Array.isArray(value)); return value; };
const mapped = (value: unknown): unknown[][] => list(object(value).$map).map(list);
const corrupt = (game: GameState, change: (data: Record<string, unknown>) => void) => { const data = object(JSON.parse(encodeGameState(game))); change(data); return decodeGameState(JSON.stringify(data)); };
const rejected = (game: GameState, change: (data: Record<string, unknown>) => void, why: string) => assert.equal(corrupt(game, change), undefined, why);
const withBomb = (game: GameState) => {
  const { x, y } = game.players.get('p1')!;
  game.bombs.set(1, { id: 1, ownerId: 'p1', launchX: x, launchY: y, x, y, placedTick: game.tick, launchedTick: game.tick, landsAtTick: game.tick + BOMB_FLIGHT_TICKS, explodeAtTick: game.tick + 40, blastRange: BOMB_BLAST_RANGE, flightPath: Array.from({ length: BOMB_FLIGHT_TICKS + 1 }, () => ({ x, y, angle: 0 })), shell: { vx: 10, vy: 0 } });
  game.nextBombId = 2; return game;
};
const gates = (game: GameState, index: number) => createPortalPair({ id: `portal-${index}`, tick: game.tick, bounds: { minX: 20, minY: 20, maxX: 1580, maxY: 880 }, riderRadius: 7, random: (() => { let n = index; return () => (++n % 3) / 3; })(), isSafe: () => true })!;

test('a well-formed playing state with a bomb, a gravity field and two portal pairs round-trips exactly', () => {
  const game = withBomb(playing());
  game.gravityFields.push({ bombId: 1, ownerId: 'p1', x: 400, y: 400, radius: 90, expiresAtTick: game.tick + GRAVITY_FIELD_TICKS });
  game.portalPairs = [gates(game, 0), gates(game, 1)];
  const restored = decodeGameState(encodeGameState(game)); assert.ok(restored, 'the control fixture is valid, so every rejection below is a guard talking');
  assert.equal(encodeGameState(restored), encodeGameState(game));
});

test('bombs, gravity fields and portal pairs must name issued bombs, seated owners, live ticks and sane geometry', () => {
  const game = withBomb(playing());
  rejected(game, data => { object(mapped(data.bombs)[0]![1]).ownerId = 'ghost'; }, 'a bomb from nobody');
  rejected(game, data => { object(object(mapped(data.bombs)[0]![1]).shell).vx = 1e9; }, 'a shell faster than the guard allows');
  rejected(game, data => { object(mapped(data.bombs)[0]![1]).flightPath = []; object(mapped(data.bombs)[0]![1]).x = 'here'; }, 'a position that is not a number');
  const field = (over: Record<string, unknown> = {}) => ({ bombId: 1, ownerId: 'p1', x: 400, y: 400, radius: 90, expiresAtTick: game.tick + GRAVITY_FIELD_TICKS, ...over });
  assert.ok(corrupt(game, data => { list(data.gravityFields).push(field()); }), 'a field naming the issued bomb restores');
  rejected(game, data => { list(data.gravityFields).push(field({ bombId: 2 })); }, 'a field naming an unissued bomb');
  rejected(game, data => { list(data.gravityFields).push(field(), field()); }, 'the same bomb twice');
  rejected(game, data => { list(data.gravityFields).push(field({ ownerId: 'ghost' })); }, 'a field from nobody');
  rejected(game, data => { list(data.gravityFields).push(field({ expiresAtTick: game.tick })); }, 'a field already expired');
  const withPortals = playing(); withPortals.portalPairs = [gates(withPortals, 0), gates(withPortals, 1)];
  rejected(withPortals, data => { object(list(object(list(data.portalPairs)[1]).gates)[0]).halfLength = 999; }, 'a gate longer than any wall');
  rejected(withPortals, data => { object(list(data.portalPairs)[1]).id = 'portal-0'; }, 'duplicate pair ids would exempt a foreign wall from exit safety');
  rejected(withPortals, data => { object(list(data.portalPairs)[1]).expiresAtTick = 0; }, 'an expired pair');
  rejected(withPortals, data => { const pairs = list(data.portalPairs); while (pairs.length <= MAX_PORTAL_PAIRS) pairs.push({ ...object(pairs[0]), id: `extra-${pairs.length}` }); }, 'more pairs than the cap');
});

test('players, trails, history and statistics are bounded and internally consistent', () => {
  const game = playing();
  for (const key of ['players', 'bombs', 'pickups', 'leaderboard', 'roundParticipants', 'matchStats', 'randomState', 'roundScored', 'gravityFields', 'portalPairs']) rejected(game, data => { delete data[key]; }, `missing ${key}`);
  for (const key of ['trail', 'alive', 'drunkHeadingOffset', 'shielded', 'avatarId', 'gravityArmed', 'boostUntilTick']) rejected(game, data => { delete object(mapped(data.players)[0]![1])[key]; }, `player without ${key}`);
  for (const key of ['deathsByCause', 'currentRoundSurvivalTicks', 'distanceUnits']) rejected(game, data => { delete object(mapped(data.matchStats)[0]![1])[key]; }, `stats without ${key}`);
  rejected(game, data => { object(mapped(data.players)[0]![1]).trail = Array.from({ length: MAX_CHECKPOINT_TRAILS + 1 }, () => ({ x1: 1, y1: 1, x2: 2, y2: 2, createdTick: 1, expiresAtTick: 161 })); }, 'more trail than the cap');
  rejected(game, data => { object(mapped(data.players)[0]![1]).trail = [{ x1: 1, y1: 1, x2: 2, y2: 2, createdTick: 99, expiresAtTick: 2 }]; }, 'a trail that expires before it was drawn');
  rejected(game, data => { object(mapped(data.players)[0]![1]).id = 'wrong-key'; }, 'a player keyed under another id');
  rejected(game, data => { const players = mapped(data.players); object(data.players).$map = [...players, players[0]!]; }, 'duplicate map keys');
  for (const tick of [1.5, -1, 'now']) rejected(game, data => { data.tick = tick; }, `tick ${String(tick)}`);
  rejected(game, data => { object(mapped(data.players)[0]![1]).x = 1e6; }, 'a rider far outside the arena');
  rejected(game, data => { let deep: unknown = 0; for (let i = 0; i < 20; i++) deep = { next: deep }; object(mapped(data.players)[0]![1]).bombTarget = deep; }, 'nesting past the decoder budget');
  rejected(game, data => { const sample = mapped(data.leaderboard)[0]![1]; object(data.leaderboard).$map = Array.from({ length: 129 }, (_, i) => [`id-${i}`, { ...object(sample), id: `id-${i}` }]); }, 'history beyond the cap');
  rejected(game, data => { object(data.matchStats).$map = []; }, 'seated riders without statistics');
  rejected(game, data => { object(mapped(data.roundParticipants)[0]![1]).eliminatedAtTick = 999999; }, 'an elimination in the future');
  rejected(game, data => { object(data.bombs).$map = [[1]]; }, 'a malformed map entry');
  rejected(game, data => { object(data.bombs).extra = 1; }, 'a map with extra keys');
});

test('every phase of a long match encodes to a state that decodes back to itself', () => {
  const game = playing();
  for (let tick = 0; tick < 2000; tick++) {
    step(game, new Map());
    if (tick % 17 === 0) { const restored = decodeGameState(encodeGameState(game)); assert.ok(restored, `phase ${game.phase}, tick ${game.tick}`); assert.equal(encodeGameState(restored), encodeGameState(game)); }
  }
});

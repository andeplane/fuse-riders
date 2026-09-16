import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POINT_UNIT, applyRoundScores, rankRound, sortedLeaderboard,
  type SessionLeaderboardEntry,
} from '../src/shared/leaderboard.ts';

const p = (id: string, eliminatedAtTick?: number) => ({ id, name: id.toUpperCase(), eliminatedAtTick });

test('awards five-player placement points', () => {
  const result = rankRound([p('a', 40), p('b', 30), p('c', 20), p('d', 10), p('e')]);
  assert.deepEqual(result.map(x => [x.playerId, x.place, x.scoreUnits]), [
    ['e', 1, 5 * POINT_UNIT], ['a', 2, 3 * POINT_UNIT], ['b', 3, 2 * POINT_UNIT],
    ['c', 4, POINT_UNIT], ['d', 5, 0],
  ]);
});

test('two participants award two points for a win and zero for first death', () => {
  const result = rankRound([p('a', 10), p('b')]);
  assert.deepEqual(result.map(x => x.scoreUnits), [2 * POINT_UNIT, 0]);
});

test('simultaneous deaths only count strictly earlier deaths', () => {
  const result = rankRound([p('a', 10), p('b', 10), p('c')]);
  assert.deepEqual(result.map(x => [x.playerId, x.place, x.scoreUnits]), [
    ['c', 1, 3 * POINT_UNIT], ['a', 2, 0], ['b', 2, 0],
  ]);
  const allDraw = rankRound([p('a', 20), p('b', 20), p('c', 20), p('d', 20), p('e', 20)]);
  assert.ok(allDraw.every(x => x.scoreUnits === 0));
});

test('does not mutate participants and rejects invalid groups', () => {
  const input = [p('a', 1), p('b')];
  const before = structuredClone(input);
  rankRound(input);
  assert.deepEqual(input, before);
  assert.throws(() => rankRound([]));
  assert.throws(() => rankRound([p('a')]));
  assert.throws(() => rankRound([p('a'), p('a')]));
  assert.throws(() => rankRound([p('a'), p('b'), p('c'), p('d'), p('e'), p('f')]));
});

test('timeout survivors earn survival points without a win bonus', () => {
  const placements = rankRound([p('a'), p('b'), p('c', 40), p('d', 20)]);
  assert.deepEqual(placements.map(x => [x.playerId, x.place, x.scoreUnits]), [
    ['a', 1, 2 * POINT_UNIT],
    ['b', 1, 2 * POINT_UNIT],
    ['c', 3, POINT_UNIT],
    ['d', 4, 0],
  ]);
  assert.equal(placements.reduce((sum, placement) => sum + placement.scoreUnits, 0), 5 * POINT_UNIT);
});

test('score application validates the complete result before mutating totals', () => {
  const entries = new Map<string, SessionLeaderboardEntry>();
  const valid = rankRound([p('a', 10), p('b')]);
  assert.throws(() => applyRoundScores(entries, [...valid, valid[0]!], 'b'));
  assert.equal(entries.size, 0);
  assert.throws(() => applyRoundScores(entries, valid, 'missing'));
  assert.equal(entries.size, 0);
  assert.throws(() => applyRoundScores(entries, valid, 'b', 'a'));
  assert.equal(entries.size, 0);
  assert.throws(() => applyRoundScores(entries, [{ ...valid[0]!, scoreUnits: Number.NaN }], valid[0]!.playerId));
  assert.equal(entries.size, 0);
});

test('accumulates repeated matches and preserves departures', () => {
  const entries = new Map<string, SessionLeaderboardEntry>();
  const first = rankRound([p('a', 10), p('b')]);
  applyRoundScores(entries, first, 'b', 'b');
  applyRoundScores(entries, first, 'b');
  assert.deepEqual(entries.get('b'), { id: 'b', name: 'B', totalScoreUnits: 4 * POINT_UNIT, roundsPlayed: 2, roundWins: 2, matchWins: 1 });
  assert.equal(entries.get('a')?.roundsPlayed, 2);
  entries.delete('a');
  assert.ok(entries.get('b'));
});

test('returns copies in score order with deterministic tie break', () => {
  const entries = new Map<string, SessionLeaderboardEntry>([
    ['z', { id: 'z', name: 'Z', totalScoreUnits: 120, roundsPlayed: 1, roundWins: 0, matchWins: 2 }],
    ['a', { id: 'a', name: 'A', totalScoreUnits: 120, roundsPlayed: 1, roundWins: 0, matchWins: 2 }],
  ]);
  const sorted = sortedLeaderboard(entries);
  assert.deepEqual(sorted.map(e => e.id), ['a', 'z']);
  sorted[0]!.name = 'changed';
  assert.equal(entries.get('a')!.name, 'A');
});

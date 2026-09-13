import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginMatchParticipant,
  finalizeMatchStatsRound,
  recordBombExploded,
  recordBombPlaced,
  recordDeath,
  recordEarlyExit,
  recordPickup,
  recordPortalTransit,
  recordSurvivalTick,
  snapshotMatchStats,
  type MatchStatsState,
} from '../src/shared/match-stats.js';

const identity = (id: string, slot: number) => ({ id, name: id.toUpperCase(), slot, color: `color-${slot}` });

test('records authoritative actions and returns detached snapshots', () => {
  const stats: MatchStatsState = new Map();
  beginMatchParticipant(stats, identity('a', 0));
  beginMatchParticipant(stats, identity('b', 1));
  recordSurvivalTick(stats, 'a', 7.5, true, true);
  recordBombPlaced(stats, 'a');
  recordBombExploded(stats, 'a');
  recordPickup(stats, 'a', 'blast');
  recordPickup(stats, 'a', 'star');
  recordPickup(stats, 'a', 'beer');
  recordPickup(stats, 'a', 'triple');
  recordPickup(stats, 'a', 'five');
  recordPickup(stats, 'a', 'orbitShield');
  recordPickup(stats, 'a', 'portal');
  recordPortalTransit(stats, 'a');
  recordDeath(stats, 'b', 'explosion', 'a');
  recordEarlyExit(stats, 'b');
  finalizeMatchStatsRound(stats, ['a', 'b'], 'a');

  const snapshot = snapshotMatchStats(stats);
  assert.deepEqual(snapshot[0], {
    playerId: 'a', name: 'A', slot: 0, color: 'color-0', roundsPlayed: 1, roundWins: 1,
    roundsDrawn: 0, matchPlacement: 1, survivalTicks: 1, longestSurvivalTicks: 1,
    distanceUnits: 7.5, bombsPlaced: 1, bombsExploded: 1, eliminations: 1,
    deathsByCause: { wall: 0, trail: 0, explosion: 0, rider: 0 }, pickupsCollected: 7,
    blastPickups: 1, starPickups: 1, beerPickups: 1, inkPickups: 0, triplePickups: 1, fivePickups: 1,
    shieldPickups: 1, portalPickups: 1, portalTransits: 1, invulnerableTicks: 1, wallBounces: 1, earlyExits: 0,
  });
  assert.equal(snapshot[1]!.deathsByCause.explosion, 1);
  snapshot[1]!.deathsByCause.explosion = 99;
  assert.equal(stats.get('b')!.deathsByCause.explosion, 1);
});

test('tracks round draws, longest survival and competition-ranked win ties', () => {
  const stats: MatchStatsState = new Map();
  for (let slot = 0; slot < 4; slot += 1) beginMatchParticipant(stats, identity(String(slot), slot));
  recordSurvivalTick(stats, '0', 1, false, false);
  finalizeMatchStatsRound(stats, ['0', '1', '2', '3']);
  beginMatchParticipant(stats, { ...identity('0', 3), name: 'Renamed', color: 'new' });
  beginMatchParticipant(stats, identity('1', 1));
  beginMatchParticipant(stats, identity('2', 2));
  beginMatchParticipant(stats, identity('3', 0));
  recordSurvivalTick(stats, '0', 1, false, false);
  recordSurvivalTick(stats, '0', 1, false, false);
  finalizeMatchStatsRound(stats, ['0', '1', '2', '3'], '0');
  beginMatchParticipant(stats, identity('1', 1));
  finalizeMatchStatsRound(stats, ['0', '1', '2', '3'], '1');

  const snapshot = snapshotMatchStats(stats);
  assert.deepEqual(snapshot.map(({ playerId, matchPlacement }) => [playerId, matchPlacement]), [
    ['1', 1], ['0', 1], ['3', 3], ['2', 3],
  ]);
  const zero = snapshot.find((entry) => entry.playerId === '0')!;
  assert.equal(zero.name, 'Renamed');
  assert.equal(zero.longestSurvivalTicks, 2);
  assert.equal(zero.roundsDrawn, 1);
});

test('validates references, distances and round membership', () => {
  const stats: MatchStatsState = new Map();
  beginMatchParticipant(stats, identity('a', 0));
  assert.throws(() => recordSurvivalTick(stats, 'a', -1, false, false), /distanceUnits/);
  assert.throws(() => recordSurvivalTick(stats, 'a', Number.NaN, false, false), /distanceUnits/);
  assert.throws(() => recordBombPlaced(stats, 'missing'), /unknown match participant/);
  assert.throws(() => recordBombExploded(stats, 'missing'), /unknown match participant/);
  assert.throws(() => recordPickup(stats, 'missing', 'star'), /unknown match participant/);
  assert.throws(() => recordDeath(stats, 'a', 'wall', 'missing'), /unknown match participant/);
  assert.throws(() => recordEarlyExit(stats, 'missing'), /unknown match participant/);
  assert.throws(() => finalizeMatchStatsRound(stats, ['a', 'a']), /unique ids/);
  assert.throws(() => finalizeMatchStatsRound(stats, ['a'], 'missing'), /winner must be/);
});

test('never credits self deaths and updates an existing participant identity', () => {
  const stats: MatchStatsState = new Map();
  beginMatchParticipant(stats, identity('a', 0));
  recordDeath(stats, 'a', 'trail', 'a');
  beginMatchParticipant(stats, { id: 'a', name: 'New', slot: 2, color: 'pink' });
  const entry = snapshotMatchStats(stats)[0]!;
  assert.equal(entry.eliminations, 0);
  assert.equal(entry.deathsByCause.trail, 1);
  assert.deepEqual([entry.name, entry.slot, entry.color], ['New', 2, 'pink']);
});

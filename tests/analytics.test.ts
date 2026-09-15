import assert from 'node:assert/strict';
import test from 'node:test';
import { analyticsEnabled, matchEndedProps, matchStartKey } from '../src/online/analytics.js';
import { BOT_ID_PREFIX } from '../src/shared/bot-controller.js';
import type { MatchPlayerStats } from '../src/shared/match-stats.js';

function rider(overrides: Partial<MatchPlayerStats> & { playerId: string; slot: number; matchPlacement: number }): MatchPlayerStats {
  return {
    name: overrides.playerId.toUpperCase(), color: `#00000${overrides.slot}`, roundsPlayed: 0, roundWins: 0, roundsDrawn: 0,
    survivalTicks: 0, longestSurvivalTicks: 0, distanceUnits: 0, bombsPlaced: 0, bombsExploded: 0, eliminations: 0,
    deathsByCause: { wall: 0, trail: 0, explosion: 0, rider: 0 }, pickupsCollected: 0, blastPickups: 0, starPickups: 0,
    beerPickups: 0, inkPickups: 0, triplePickups: 0, fivePickups: 0, targetPickups: 0, shieldPickups: 0, portalPickups: 0,
    portalTransits: 0, invulnerableTicks: 0, wallBounces: 0, earlyExits: 0,
    ...overrides,
  };
}

test('analytics stays off on a LAN or dev address and obeys the explicit override either way', () => {
  assert.equal(analyticsEnabled('', '5173'), false, 'a port means local dev or LAN play');
  assert.equal(analyticsEnabled('', ''), true, 'the deployed site has no port');
  assert.equal(analyticsEnabled('?analytics=1', '5173'), true, 'forced on to verify a build');
  assert.equal(analyticsEnabled('?analytics=0', ''), false, 'forced off beats every other rule');
  assert.equal(analyticsEnabled('?analytics=0&analytics=1', ''), false, 'the first value decides, so off cannot be smuggled past');
  assert.equal(analyticsEnabled('?room=AB42', '8080'), false);
});

test('a finished match reports the arena shape and this device rider own line', () => {
  const stats = [
    rider({ playerId: 'me', slot: 0, matchPlacement: 1, roundsPlayed: 3, roundWins: 2, eliminations: 4, pickupsCollected: 7, bombsPlaced: 9, bombsExploded: 6, distanceUnits: 512.4, survivalTicks: 130, deathsByCause: { wall: 1, trail: 2, explosion: 0, rider: 3 } }),
    rider({ playerId: `${BOT_ID_PREFIX}1`, slot: 1, matchPlacement: 2, roundsPlayed: 3 }),
    rider({ playerId: `${BOT_ID_PREFIX}2`, slot: 2, matchPlacement: 3, roundsPlayed: 2 }),
  ];
  assert.deepEqual(matchEndedProps(stats, 'me'), {
    playerCount: 3, botCount: 2, humanCount: 1, rounds: 3, played: true,
    placement: 1, won: true, roundWins: 2, eliminations: 4, pickups: 7, bombsPlaced: 9, bombsExploded: 6,
    distance: 512, survivalSeconds: 7,
    deathsWall: 1, deathsTrail: 2, deathsExplosion: 0, deathsRider: 3,
  });
});

test('a shared-TV display reports the match it watched without inventing a rider line', () => {
  const stats = [rider({ playerId: 'a', slot: 0, matchPlacement: 1, roundsPlayed: 5 }), rider({ playerId: 'b', slot: 1, matchPlacement: 2, roundsPlayed: 4 })];
  assert.deepEqual(matchEndedProps(stats, ''), { playerCount: 2, botCount: 0, humanCount: 2, rounds: 5, played: false });
  assert.deepEqual(matchEndedProps([], 'me'), { playerCount: 0, botCount: 0, humanCount: 0, rounds: 0, played: false });
});

test('a runner-up is not recorded as a winner', () => {
  const stats = [rider({ playerId: 'me', slot: 0, matchPlacement: 2, roundsPlayed: 3, roundWins: 1 })];
  const props = matchEndedProps(stats, 'me');
  assert.equal(props.won, false);
  assert.equal(props.placement, 2);
});

test('a match start is the first round of a match id, not a countdown', () => {
  // Every round opens with its own countdown, so rounds 2+ must not read as a new match.
  assert.equal(matchStartKey('m1', 'countdown', 1), 'm1:1');
  assert.equal(matchStartKey('m1', 'countdown', 2), undefined);
  assert.equal(matchStartKey('m1', 'countdown', 5), undefined);
  // Solo never passes through the lobby: LocalRuntime seats its bots and starts before the first snapshot,
  // so the very first phase the UI sees is already the round-1 countdown and must still count as a start.
  assert.equal(matchStartKey('solo-match', 'countdown', 1), 'solo-match:1');
  // A rematch takes a fresh match id back to round 1, so it keys apart from the match before it.
  assert.notEqual(matchStartKey('m2', 'countdown', 1), matchStartKey('m1', 'countdown', 1));
  for (const phase of ['lobby', 'playing', 'roundOver', 'matchOver']) {
    assert.equal(matchStartKey('m1', phase, 1), undefined, `${phase} does not begin a match`);
  }
});

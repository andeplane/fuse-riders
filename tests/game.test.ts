import assert from 'node:assert/strict';
import test from 'node:test';
import { POINT_UNIT } from '../src/shared/leaderboard.ts';
import { DRUNK_DURATION_TICKS, drunkAngularVelocity } from '../src/shared/drunk.ts';
import {
  BOMB_FLIGHT_TICKS,
  BOMB_MAX_CHARGE_TICKS,
  BOMB_MAX_LAUNCH_DISTANCE,
  BOMB_MIN_LAUNCH_DISTANCE,
} from '../src/shared/bomb-launch.ts';

import {
  BOMB_COOLDOWN_TICKS,
  BOMB_FUSE_TICKS,
  BOMB_BLAST_RANGE,
  BLAST_LEVEL_RANGE,
  BLAST_VISIBLE_TICKS,
  COUNTDOWN_TICKS,
  INITIAL_BOUNDARY_INSET,
  MAX_ACTIVE_PICKUPS,
  OVERTIME_INSET_PER_TICK,
  OVERTIME_START_TICK,
  PICKUP_LIFETIME_TICKS,
  PICKUP_SPAWN_INTERVAL_TICKS,
  ROUND_DRAW_TICK,
  SELF_TRAIL_GRACE_TICKS,
  SLOT_COLORS,
  STAR_DURATION_TICKS,
  TRAIL_LIFETIME_TICKS,
  addPlayer,
  createGame,
  eliminatePlayer,
  removePlayer,
  resetMatch,
  setPlayerConnected,
  startMatch,
  startNextRound,
  step,
  toSnapshot,
  type GameState,
  type InputIntent,
} from '../src/shared/game.ts';

const neutral: InputIntent = { left: false, right: false, bomb: false };
const fixedFlightPath = (x: number, y: number) => Array.from({ length: BOMB_FLIGHT_TICKS + 1 }, () => ({ x, y, angle: 0 }));

function gameWithPlayers(count = 2, matchId = 'match', seed?: number): GameState {
  const state = createGame(matchId, seed);
  for (let slot = 0; slot < count; slot += 1) {
    addPlayer(state, {
      id: `p${slot}`,
      name: `Player ${slot + 1}`,
      slot,
      color: SLOT_COLORS[slot]!,
    });
  }
  return state;
}

function enterPlaying(state: GameState): void {
  startMatch(state);
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick += 1) step(state, new Map());
  assert.equal(state.phase, 'playing');
}

function inputs(...pairs: Array<[string, Partial<InputIntent>]>): Map<string, InputIntent> {
  return new Map(pairs.map(([id, value]) => [id, { ...neutral, ...value }]));
}

test('spawns two through five players evenly on a circle with clockwise tangent headings', () => {
  for (let count = 2; count <= 5; count += 1) {
    const state = gameWithPlayers(count);
    startMatch(state);
    const players = [...state.players.values()].sort((a, b) => a.slot - b.slot);
    const expectedRadius = 0.28 * Math.min(state.width, state.height);
    players.forEach((player, index) => {
      const radial = Math.atan2(player.y - state.height / 2, player.x - state.width / 2);
      assert.ok(Math.abs(Math.hypot(player.x - state.width / 2, player.y - state.height / 2) - expectedRadius) < 1e-8);
      const expectedSpawn = -Math.PI / 2 + index * Math.PI * 2 / count;
      assert.ok(Math.abs(Math.atan2(Math.sin(radial - expectedSpawn), Math.cos(radial - expectedSpawn))) < 1e-8);
      assert.ok(Math.abs(Math.atan2(Math.sin(player.angle - expectedSpawn - Math.PI / 2), Math.cos(player.angle - expectedSpawn - Math.PI / 2))) < 1e-8);
    });
  }
});

test('replaying the same accepted inputs produces the same snapshots and events', () => {
  const first = gameWithPlayers(3, 'same');
  const second = gameWithPlayers(3, 'same');
  startMatch(first);
  startMatch(second);
  for (let tick = 0; tick < 150; tick += 1) {
    const current = inputs(
      ['p0', { left: tick % 24 < 7, bomb: tick === 70 }],
      ['p1', { right: tick % 31 < 5, bomb: tick === 80 }],
      ['p2', { left: tick % 40 > 34 }],
    );
    assert.deepEqual(step(first, current), step(second, current));
  }
  assert.deepEqual(toSnapshot(first), toSnapshot(second));
});

test('trail segments remain active through T+159 and expire exactly at T+160', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  const owner = state.players.get('p0')!;
  const createdTick = state.tick - TRAIL_LIFETIME_TICKS + 2;
  owner.trail = [{
    x1: 50,
    y1: 50,
    x2: 60,
    y2: 50,
    createdTick,
    expiresAtTick: createdTick + TRAIL_LIFETIME_TICKS,
  }];
  step(state, new Map());
  assert.ok(owner.trail.some((segment) => segment.x1 === 50));
  step(state, new Map());
  assert.ok(!owner.trail.some((segment) => segment.x1 === 50));
});

test('a due blast removes an intersecting segment before trail collision', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  const rider = state.players.get('p0')!;
  const owner = state.players.get('p1')!;
  rider.x = 500;
  rider.y = 350;
  rider.angle = 0;
  owner.x = 900;
  owner.y = 600;
  owner.angle = 0;
  owner.trail = [{
    x1: 504,
    y1: 350,
    x2: 700,
    y2: 350,
    createdTick: state.tick - SELF_TRAIL_GRACE_TICKS,
    expiresAtTick: state.tick + 100,
  }];
  state.bombs.set(99, {
    id: 99,
    ownerId: 'p1',
    launchX: 700,
    launchY: 350,
    x: 700,
    y: 350,
    placedTick: state.tick - BOMB_FUSE_TICKS,
    launchedTick: state.tick - BOMB_FUSE_TICKS,
    landsAtTick: state.tick - BOMB_FUSE_TICKS + BOMB_FLIGHT_TICKS,
    flightPath: fixedFlightPath(700, 350),
    explodeAtTick: state.tick + 1,
    blastRange: 150,
  });

  const result = step(state, new Map());
  assert.equal(rider.alive, true, 'the newly cleared crossing is safe on the same tick');
  assert.equal(owner.trail.some((segment) => segment.x1 === 504), false);
  assert.ok(result.events.some((event) => event.type === 'explosion' && event.bombId === 99));
});

test('swept movement collides with an old trail even when the endpoint has crossed it', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  const rider = state.players.get('p0')!;
  const owner = state.players.get('p1')!;
  rider.x = 500;
  rider.y = 350;
  rider.angle = 0;
  owner.x = 900;
  owner.y = 600;
  owner.trail = [{
    x1: 503,
    y1: 300,
    x2: 503,
    y2: 400,
    createdTick: state.tick - SELF_TRAIL_GRACE_TICKS,
    expiresAtTick: state.tick + 100,
  }];
  const result = step(state, new Map());
  assert.equal(rider.alive, false);
  assert.equal(state.matchStats.get('p0')!.survivalTicks, 2, 'the countdown transition tick and fatal tick both simulate movement');
  assert.equal(state.matchStats.get('p0')!.distanceUnits, 15);
  assert.equal(state.matchStats.get('p0')!.deathsByCause.trail, 1);
  assert.equal(state.matchStats.get('p1')!.eliminations, 1);
  assert.equal(state.roundParticipants.get('p0')!.eliminatedAtTick, state.tick);
  assert.ok(result.events.some((event) => event.type === 'playerEliminated' && event.playerId === 'p0' && event.cause === 'trail'));
});

test('recent self trail is ignored but becomes lethal at the exact grace boundary', () => {
  const recent = gameWithPlayers();
  enterPlaying(recent);
  const player = recent.players.get('p0')!;
  const other = recent.players.get('p1')!;
  player.x = 500; player.y = 350; player.angle = 0;
  other.x = 900; other.y = 600;
  player.trail = [{ x1: 503, y1: 300, x2: 503, y2: 400, createdTick: recent.tick - SELF_TRAIL_GRACE_TICKS + 2, expiresAtTick: recent.tick + 100 }];
  step(recent, new Map());
  assert.equal(player.alive, true);

  const old = gameWithPlayers();
  enterPlaying(old);
  const oldPlayer = old.players.get('p0')!;
  oldPlayer.x = 500; oldPlayer.y = 350; oldPlayer.angle = 0;
  old.players.get('p1')!.x = 900; old.players.get('p1')!.y = 600;
  oldPlayer.trail = [{ x1: 503, y1: 300, x2: 503, y2: 400, createdTick: old.tick - SELF_TRAIL_GRACE_TICKS + 1, expiresAtTick: old.tick + 100 }];
  step(old, new Map());
  assert.equal(oldPlayer.alive, false);
});

test('head-on swept rider collision eliminates both and produces a draw', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  const left = state.players.get('p0')!;
  const right = state.players.get('p1')!;
  left.x = 500; left.y = 350; left.angle = 0; left.trail = [];
  right.x = 520; right.y = 350; right.angle = Math.PI; right.trail = [];
  const result = step(state, new Map());
  assert.equal(left.alive, false);
  assert.equal(right.alive, false);
  assert.equal(state.roundParticipants.get('p0')!.eliminatedAtTick, state.tick);
  assert.equal(state.roundParticipants.get('p1')!.eliminatedAtTick, state.tick);
  assert.equal(state.phase, 'roundOver');
  assert.equal(state.roundWinnerId, undefined);
  assert.deepEqual(result.events.filter((event) => event.type === 'playerEliminated').map((event) => event.playerId).sort(), ['p0', 'p1']);
  assert.ok(result.events.some((event) => event.type === 'roundEnded' && event.winnerId === undefined));
  assert.deepEqual(result.events.map((event) => event.type), ['playerEliminated', 'playerEliminated', 'roundEnded']);
  assert.ok(state.roundPlacements.every((placement) => placement.place === 1 && placement.scoreUnits === 4 * POINT_UNIT));
  assert.equal(state.matchStats.get('p0')!.eliminations, 1);
  assert.equal(state.matchStats.get('p1')!.eliminations, 1);
  assert.ok([...state.matchStats.values()].every((entry) => entry.roundsDrawn === 1 && entry.deathsByCause.rider === 1));
});

test('bomb input charges, launches on release, caps one live bomb, chains once, and observes cooldown', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  const owner = state.players.get('p0')!;
  const other = state.players.get('p1')!;
  owner.x = 500; owner.y = 350; owner.angle = 0;
  other.x = 900; other.y = 600;
  let result = step(state, inputs(['p0', { bomb: true, bombActions: ['press'] }]));
  assert.equal(state.bombs.size, 0);
  assert.equal(owner.bombChargeStartedTick, state.tick);
  result = step(state, inputs(['p0', { bomb: true }]));
  assert.equal(state.bombs.size, 0, 'held input without an edge only continues charging');
  result = step(state, inputs(['p0', { bomb: false, bombActions: ['release'] }]));
  assert.equal(state.bombs.size, 1);
  const firstBomb = [...state.bombs.values()][0]!;
  assert.equal(firstBomb.explodeAtTick, state.tick + BOMB_FUSE_TICKS);
  assert.equal(firstBomb.landsAtTick, state.tick + BOMB_FLIGHT_TICKS);
  assert.equal(firstBomb.launchX, owner.x);
  assert.equal(firstBomb.x - firstBomb.launchX, BOMB_MIN_LAUNCH_DISTANCE + 2 * (BOMB_MAX_LAUNCH_DISTANCE - BOMB_MIN_LAUNCH_DISTANCE) / BOMB_MAX_CHARGE_TICKS);
  assert.equal(owner.bombReadyAtTick, state.tick + BOMB_COOLDOWN_TICKS);
  assert.equal(result.events.filter((event) => event.type === 'bombPlaced').length, 1);

  result = step(state, inputs(['p0', { bomb: true, bombActions: ['press'] }]));
  assert.equal(state.bombs.size, 1);
  assert.equal(result.events.filter((event) => event.type === 'bombPlaced').length, 0);

  state.bombs.set(77, {
    id: 77,
    ownerId: 'p1',
    launchX: firstBomb.x + 100,
    launchY: firstBomb.y,
    x: firstBomb.x + 100,
    y: firstBomb.y,
    placedTick: state.tick,
    launchedTick: state.tick,
    landsAtTick: state.tick,
    flightPath: fixedFlightPath(firstBomb.x + 100, firstBomb.y),
    explodeAtTick: state.tick + 999,
    blastRange: 150,
  });
  firstBomb.explodeAtTick = state.tick + 1;
  firstBomb.landsAtTick = state.tick;
  result = step(state, inputs(['p0', { bomb: false }]));
  assert.deepEqual(result.events.filter((event) => event.type === 'explosion').map((event) => event.bombId), [firstBomb.id, 77]);
  assert.equal(state.bombs.size, 0);
  assert.equal(state.matchStats.get('p0')!.bombsPlaced, 1);
  assert.equal(state.matchStats.get('p0')!.bombsExploded, 1);
  assert.equal(state.matchStats.get('p1')!.bombsExploded, 1);

  result = step(state, inputs(['p0', { bomb: true, bombActions: ['press', 'release'] }]));
  assert.equal(result.events.filter((event) => event.type === 'bombPlaced').length, 0, 'cooldown rejects a fresh edge');
});

test('quick bomb action bursts launch at minimum range and cancel paths never launch', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  const owner = state.players.get('p0')!;
  owner.x = 500; owner.y = 450; owner.angle = 0;
  state.players.get('p1')!.x = 1200; state.players.get('p1')!.y = 700;
  step(state, inputs(['p0', { bomb: false, bombActions: ['release'] }]));
  assert.equal(state.bombs.size, 0, 'release without accepted charge is ignored');
  const launched = step(state, inputs(['p0', { bomb: false, bombActions: ['press', 'release'] }]));
  const bomb = [...state.bombs.values()][0]!;
  assert.equal(bomb.x - bomb.launchX, BOMB_MIN_LAUNCH_DISTANCE);
  assert.equal(launched.events.filter((event) => event.type === 'bombPlaced').length, 1);
  assert.equal(toSnapshot(state).bombs[0]!.launchedTick, state.tick);

  state.bombs.clear();
  owner.bombReadyAtTick = state.tick;
  step(state, inputs(['p0', { bomb: true, bombActions: ['press'] }]));
  assert.equal(toSnapshot(state).players.find((player) => player.id === owner.id)!.bombChargeStartedTick, state.tick);
  step(state, inputs(['p0', { bomb: false, bombActions: ['cancel', 'release'] }]));
  assert.equal(state.bombs.size, 0);
  assert.equal(owner.bombChargeStartedTick, undefined);

  step(state, inputs(['p0', { bomb: true, bombActions: ['press'] }]));
  eliminatePlayer(state, owner.id);
  assert.equal(owner.bombChargeStartedTick, undefined);
});

test('charged launches cap and clamp to the active safe interior', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  const owner = state.players.get('p0')!;
  owner.x = state.width - state.boundaryInset - 50; owner.y = 450; owner.angle = 0;
  state.players.get('p1')!.x = 800; state.players.get('p1')!.y = 700;
  owner.bombChargeStartedTick = state.tick - BOMB_MAX_CHARGE_TICKS - 100;
  step(state, inputs(['p0', { bomb: false, bombActions: ['release'] }]));
  const bomb = [...state.bombs.values()][0]!;
  assert.equal(bomb.x, state.width - state.boundaryInset - 7);
  assert.ok(bomb.x - bomb.launchX < BOMB_MAX_LAUNCH_DISTANCE, 'boundary clamp shortens the flight endpoint');
  assert.equal(bomb.landsAtTick - bomb.launchedTick, BOMB_FLIGHT_TICKS);
});

test('a flying bomb cannot explode or chain-trigger before landing', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  state.players.get('p0')!.x = 1000; state.players.get('p0')!.y = 700;
  state.players.get('p1')!.x = 1200; state.players.get('p1')!.y = 700;
  state.bombs.set(1, { id: 1, ownerId: 'p0', launchX: 500, launchY: 450, x: 600, y: 450, placedTick: state.tick, launchedTick: state.tick, landsAtTick: state.tick + 5, explodeAtTick: state.tick + 1, blastRange: 150, flightPath: fixedFlightPath(600, 450) });
  state.bombs.set(2, { id: 2, ownerId: 'p1', launchX: 500, launchY: 450, x: 500, y: 450, placedTick: 0, launchedTick: 0, landsAtTick: 0, explodeAtTick: state.tick + 1, blastRange: 150, flightPath: fixedFlightPath(500, 450) });
  const result = step(state, new Map());
  assert.deepEqual(result.events.filter((event) => event.type === 'explosion').map((event) => event.bombId), [2]);
  assert.equal(state.bombs.has(1), true);
});

test('Triple Shot releases one deterministic straight three-bomb volley', () => {
  const state = gameWithPlayers(3, 'modifier-launch', 99);
  enterPlaying(state);
  const owner = state.players.get('p0')!;
  owner.x = 500; owner.y = 450; owner.angle = 0;
  owner.tripleShotArmed = true;
  state.players.get('p1')!.x = 850; state.players.get('p1')!.y = 600;
  state.players.get('p2')!.x = 1300; state.players.get('p2')!.y = 700;
  const result = step(state, inputs(['p0', { bomb: false, bombActions: ['press', 'release'] }]));
  const bombs = [...state.bombs.values()];
  assert.equal(bombs.length, 3);
  assert.equal(result.events.filter((event) => event.type === 'bombPlaced').length, 3);
  assert.ok(bombs.every((bomb) => bomb.flightPath.length === 7));
  assert.notEqual(bombs[0]!.flightPath[1]!.y, bombs[2]!.flightPath[1]!.y);
  assert.equal(owner.tripleShotArmed, false);
  assert.equal(state.matchStats.get('p0')!.bombsPlaced, 3);
  assert.equal(owner.bombReadyAtTick, state.tick + BOMB_COOLDOWN_TICKS);
  const snapshot = toSnapshot(state).bombs;
  snapshot[0]!.flightPath[0]!.x = -1;
  assert.notEqual(toSnapshot(state).bombs[0]!.flightPath[0]!.x, -1);
});

test('invalid release and cancellation preserve launch modifiers', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  const owner = state.players.get('p0')!;
  owner.tripleShotArmed = true;
  step(state, inputs(['p0', { bomb: false, bombActions: ['release'] }]));
  step(state, inputs(['p0', { bomb: true, bombActions: ['press'] }]));
  step(state, inputs(['p0', { bomb: false, bombActions: ['cancel'] }]));
  assert.equal(state.bombs.size, 0);
  assert.equal(owner.tripleShotArmed, true);
});

test('round wins score once, first to three ends the match, and rematch resets wins and scope', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  for (let win = 1; win <= 3; win += 1) {
    eliminatePlayer(state, 'p1');
    const result = step(state, new Map());
    assert.equal(state.players.get('p0')!.roundWins, win);
    assert.equal(result.events.filter((event) => event.type === 'roundEnded').length, 1);
    if (win < 3) {
      assert.equal(state.phase, 'roundOver');
      state.tick = state.phaseEndsAtTick!;
      startNextRound(state);
      for (let tick = 0; tick < COUNTDOWN_TICKS; tick += 1) step(state, new Map());
    }
  }
  assert.equal(state.phase, 'matchOver');
  assert.equal(state.matchWinnerId, 'p0');
  const matchStats = toSnapshot(state).matchStats;
  assert.equal(matchStats.length, 2);
  assert.deepEqual(matchStats.map((entry) => [entry.playerId, entry.roundWins, entry.roundsPlayed, entry.matchPlacement]), [
    ['p0', 3, 3, 1], ['p1', 0, 3, 2],
  ]);
  assert.deepEqual(state.leaderboard.get('p0'), {
    id: 'p0', name: 'Player 1', totalScoreUnits: 15 * POINT_UNIT,
    roundsPlayed: 3, roundWins: 3, matchWins: 1,
  });
  assert.deepEqual(state.leaderboard.get('p1'), {
    id: 'p1', name: 'Player 2', totalScoreUnits: 9 * POINT_UNIT,
    roundsPlayed: 3, roundWins: 0, matchWins: 0,
  });
  resetMatch(state, 'rematch');
  assert.equal(state.matchId, 'rematch');
  assert.equal(state.round, 1);
  assert.ok([...state.players.values()].every((player) => player.roundWins === 0));
  assert.equal(state.leaderboard.get('p0')!.matchWins, 1, 'session totals survive resetMatch');
  assert.ok([...state.matchStats.values()].every((entry) => entry.roundsPlayed === 0), 'new match starts fresh stats');
  assert.deepEqual(toSnapshot(state).matchStats, [], 'stats table is exposed only at match over');
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick += 1) step(state, new Map());
  eliminatePlayer(state, 'p1');
  step(state, new Map());
  assert.equal(state.leaderboard.get('p0')!.roundsPlayed, 4);
  assert.equal(state.leaderboard.get('p0')!.totalScoreUnits, 20 * POINT_UNIT);
});

test('overtime inset updates before collision and a 90-second unresolved round draws', () => {
  const shrinking = gameWithPlayers();
  enterPlaying(shrinking);
  shrinking.roundStartedTick = shrinking.tick - OVERTIME_START_TICK;
  step(shrinking, new Map());
  assert.equal(shrinking.boundaryInset, INITIAL_BOUNDARY_INSET + OVERTIME_INSET_PER_TICK);

  const timeout = gameWithPlayers();
  enterPlaying(timeout);
  timeout.players.get('p0')!.x = 600; timeout.players.get('p0')!.y = 450;
  timeout.players.get('p1')!.x = 1000; timeout.players.get('p1')!.y = 450;
  timeout.roundStartedTick = timeout.tick - ROUND_DRAW_TICK + 1;
  const result = step(timeout, new Map());
  assert.equal(timeout.phase, 'roundOver');
  assert.equal(timeout.roundWinnerId, undefined);
  assert.ok(result.events.some((event) => event.type === 'roundEnded' && event.winnerId === undefined));
  assert.ok(timeout.roundPlacements.every((placement) => placement.place === 1 && placement.scoreUnits === 4 * POINT_UNIT));
  assert.ok([...timeout.leaderboard.values()].every((entry) => entry.totalScoreUnits === 4 * POINT_UNIT && entry.roundsPlayed === 1));
});

test('lifecycle commands enforce phase, capacity, identity, and connected-player guards', () => {
  assert.throws(() => createGame(''), /matchId/);
  const state = createGame('guards');
  assert.throws(() => startMatch(state), /requires 2-5/);
  addPlayer(state, { id: 'a', name: 'A', slot: 0, color: SLOT_COLORS[0] });
  assert.throws(() => addPlayer(state, { id: 'a', name: 'again', slot: 1, color: SLOT_COLORS[1] }), /duplicate/);
  assert.throws(() => addPlayer(state, { id: 'bad', name: 'bad', slot: 7, color: 'red' }), /invalid slot/);
  assert.throws(() => addPlayer(state, { id: 'same-slot', name: 'bad', slot: 0, color: 'red' }), /occupied/);
  addPlayer(state, { id: 'b', name: 'B', slot: 1, color: SLOT_COLORS[1] });
  setPlayerConnected(state, 'b', false);
  assert.equal(toSnapshot(state).players.find((player) => player.id === 'b')!.connected, false);
  assert.throws(() => startMatch(state), /requires 2-5/);
  setPlayerConnected(state, 'b', true);
  assert.throws(() => setPlayerConnected(state, 'missing', true), /unknown player/);
  startMatch(state);
  assert.throws(() => removePlayer(state, 'a'), /invalid during countdown/);
  assert.throws(() => startMatch(state), /invalid during countdown/);
});

test('wall and explosion causes are authoritative, clipped, and blast visuals expire exactly', () => {
  const wall = gameWithPlayers();
  enterPlaying(wall);
  const doomed = wall.players.get('p0')!;
  doomed.x = wall.boundaryInset + 7.1;
  doomed.y = 300;
  doomed.angle = Math.PI;
  wall.players.get('p1')!.x = 900;
  wall.players.get('p1')!.y = 600;
  const wallResult = step(wall, new Map());
  assert.ok(wallResult.events.some((event) => event.type === 'playerEliminated' && event.playerId === 'p0' && event.cause === 'wall'));
  assert.equal(wall.roundParticipants.get('p0')!.eliminatedAtTick, wall.tick);
  assert.equal(wall.matchStats.get('p0')!.deathsByCause.wall, 1);

  const explosion = gameWithPlayers();
  enterPlaying(explosion);
  const target = explosion.players.get('p0')!;
  target.x = 30; target.y = 350; target.angle = 0;
  explosion.players.get('p1')!.x = 900;
  explosion.players.get('p1')!.y = 600;
  explosion.bombs.set(10, { id: 10, ownerId: 'p1', launchX: 30, launchY: 350, x: 30, y: 350, placedTick: 0, launchedTick: 0, landsAtTick: 0, explodeAtTick: explosion.tick + 1, blastRange: 150, flightPath: fixedFlightPath(30, 350) });
  const blastResult = step(explosion, new Map());
  assert.ok(blastResult.events.some((event) => event.type === 'playerEliminated' && event.playerId === 'p0' && event.cause === 'explosion'));
  assert.equal(explosion.roundParticipants.get('p0')!.eliminatedAtTick, explosion.tick);
  assert.equal(explosion.matchStats.get('p0')!.deathsByCause.explosion, 1);
  assert.equal(explosion.matchStats.get('p1')!.eliminations, 1);
  assert.deepEqual(explosion.blasts[0]!.circle, { x: 30, y: 350, radius: 150 });
  for (let age = 1; age <= BLAST_VISIBLE_TICKS; age += 1) {
    step(explosion, new Map());
    assert.equal(explosion.blasts.length, age < BLAST_VISIBLE_TICKS ? 1 : 0);
  }
});

test('a finished match can replace every seat and start a clean rematch without restarting the server', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  state.players.get('p0')!.roundWins = 2;
  eliminatePlayer(state, 'p1');
  step(state, new Map());
  assert.equal(state.phase, 'matchOver');

  removePlayer(state, 'p0');
  removePlayer(state, 'p1');
  addPlayer(state, { id: 'new-a', name: 'New A', slot: 0, color: SLOT_COLORS[0] });
  addPlayer(state, { id: 'new-b', name: 'New B', slot: 1, color: SLOT_COLORS[1] });
  resetMatch(state, 'replacement-match');

  assert.equal(state.phase, 'countdown');
  assert.equal(state.matchId, 'replacement-match');
  assert.deepEqual([...state.players.keys()].sort(), ['new-a', 'new-b']);
  assert.ok([...state.players.values()].every((player) => player.roundWins === 0 && player.alive));
});

test('the larger arena and seeded pickup schedule replay deterministically', () => {
  const first = gameWithPlayers(2, 'seeded-a', 123456);
  const second = gameWithPlayers(2, 'seeded-b', 123456);
  assert.equal(first.width, 1600);
  assert.equal(first.height, 900);
  startMatch(first);
  startMatch(second);
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick += 1) {
    step(first, new Map());
    step(second, new Map());
  }
  assert.equal(first.nextPickupSpawnTick, first.tick + PICKUP_SPAWN_INTERVAL_TICKS);
  first.nextPickupSpawnTick = first.tick + 1;
  second.nextPickupSpawnTick = second.tick + 1;
  step(first, new Map());
  step(second, new Map());
  assert.equal(first.pickups.length, 1);
  assert.deepEqual(first.pickups, second.pickups);
  assert.equal(first.randomState, second.randomState);
});

test('blast pickups cap at level two and affect bombs placed on the collection tick', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  const player = state.players.get('p0')!;
  player.x = 500; player.y = 450; player.angle = 0;
  state.players.get('p1')!.x = 1200; state.players.get('p1')!.y = 700;
  state.pickups = [
    { id: 1, type: 'blast', x: 503, y: 450, expiresAtTick: state.tick + 100 },
    { id: 2, type: 'blast', x: 506, y: 450, expiresAtTick: state.tick + 100 },
    { id: 3, type: 'blast', x: 507, y: 450, expiresAtTick: state.tick + 100 },
  ];
  step(state, inputs(['p0', { bomb: false, bombActions: ['press', 'release'] }]));
  assert.equal(player.blastLevel, 2);
  assert.equal(state.pickups.length, 0);
  assert.equal([...state.bombs.values()][0]!.blastRange, BOMB_BLAST_RANGE + 2 * BLAST_LEVEL_RANGE);
});

test('a star collected on the swept path rescues and reflects a wall hit, then expires sharply', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  const player = state.players.get('p0')!;
  const other = state.players.get('p1')!;
  player.x = state.boundaryInset + 7.1; player.y = 450; player.angle = Math.PI;
  other.x = 1200; other.y = 700;
  state.pickups = [{ id: 1, type: 'star', x: player.x, y: player.y, expiresAtTick: state.tick + 100 }];
  step(state, new Map());
  assert.equal(player.alive, true);
  assert.equal(state.roundParticipants.get('p0')!.eliminatedAtTick, undefined);
  assert.equal(player.x, state.boundaryInset + 7);
  assert.ok(Math.abs(player.angle) < 1e-8);
  assert.equal(player.invulnerableUntilTick, state.tick + STAR_DURATION_TICKS);
  assert.equal(state.matchStats.get('p0')!.starPickups, 1);
  assert.equal(state.matchStats.get('p0')!.pickupsCollected, 1);
  assert.equal(state.matchStats.get('p0')!.invulnerableTicks, 1);
  assert.equal(state.matchStats.get('p0')!.wallBounces, 1);

  player.invulnerableUntilTick = state.tick + 1;
  other.trail = [{ x1: player.x + 3, y1: 400, x2: player.x + 3, y2: 500, createdTick: 0, expiresAtTick: state.tick + 100 }];
  step(state, new Map());
  assert.equal(player.alive, false, 'the first unprotected sweep checks a trail containing the rider');
});

test('star head contact kills only a normal rider while two stars pass through', () => {
  const asymmetric = gameWithPlayers();
  enterPlaying(asymmetric);
  const star = asymmetric.players.get('p0')!;
  const normal = asymmetric.players.get('p1')!;
  star.x = 500; star.y = 450; star.angle = 0; star.invulnerableUntilTick = asymmetric.tick + 2;
  normal.x = 520; normal.y = 450; normal.angle = Math.PI;
  step(asymmetric, new Map());
  assert.equal(star.alive, true);
  assert.equal(normal.alive, false);

  const both = gameWithPlayers();
  enterPlaying(both);
  const first = both.players.get('p0')!;
  const second = both.players.get('p1')!;
  first.x = 500; first.y = 450; first.angle = 0; first.invulnerableUntilTick = both.tick + 2;
  second.x = 520; second.y = 450; second.angle = Math.PI; second.invulnerableUntilTick = both.tick + 2;
  step(both, new Map());
  assert.equal(first.alive, true);
  assert.equal(second.alive, true);
});

test('pickup expiry, active cap, and impossible safe interior stay bounded', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  state.pickups = Array.from({ length: MAX_ACTIVE_PICKUPS }, (_, index) => ({
    id: index + 1,
    type: 'blast' as const,
    x: 700 + index * 40,
    y: 450,
    expiresAtTick: state.tick + (index === 0 ? 1 : PICKUP_LIFETIME_TICKS),
  }));
  state.nextPickupSpawnTick = state.tick + 1;
  step(state, new Map());
  assert.equal(state.pickups.length, 3, 'one expiry allows at most one scheduled replacement');

  state.pickups = [];
  state.width = 100;
  state.height = 100;
  state.nextPickupSpawnTick = state.tick + 1;
  step(state, new Map());
  assert.equal(state.pickups.length, 0, 'an empty safe rectangle skips instead of looping');
});

test('beer pickup debuffs every other living rider, refreshes, and keeps the collector unchanged', () => {
  const state = gameWithPlayers(3, 'beer-match', 2468);
  enterPlaying(state);
  const collector = state.players.get('p0')!;
  const target = state.players.get('p1')!;
  const other = state.players.get('p2')!;
  collector.x = 500; collector.y = 450; collector.angle = 0; collector.drunkUntilTick = state.tick + 12;
  target.x = 900; target.y = 300; target.angle = 0; target.drunkUntilTick = state.tick + 5;
  other.x = 1100; other.y = 700; other.angle = 0;
  state.pickups = [{ id: 1, type: 'beer', x: 503, y: 450, expiresAtTick: state.tick + 100 }];

  step(state, new Map());
  assert.equal(collector.drunkUntilTick, state.tick + 11, 'collection does not cure or replace the collector existing debuff');
  assert.equal(target.drunkUntilTick, state.tick + DRUNK_DURATION_TICKS);
  assert.equal(other.drunkUntilTick, state.tick + DRUNK_DURATION_TICKS);
  assert.equal(state.matchStats.get('p0')!.beerPickups, 1);
  assert.equal(state.matchStats.get('p0')!.pickupsCollected, 1);

  const angleBefore = target.angle;
  const expectedNoise = drunkAngularVelocity(state.seed, target.id, state.tick + 1) / 20;
  step(state, inputs(['p1', { left: true }]));
  const expectedAngle = ((angleBefore - 2.8 / 20 + expectedNoise) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  assert.ok(Math.abs(target.angle - expectedAngle) < 1e-10, 'normal steering and deterministic wobble are added');

  state.pickups = [{ id: 2, type: 'beer', x: collector.x + 3, y: collector.y, expiresAtTick: state.tick + 100 }];
  step(state, new Map());
  assert.equal(target.drunkUntilTick, state.tick + DRUNK_DURATION_TICKS, 'a second beer refreshes without stacking');
});

test('drunk wobble expires at the strict tick boundary and resets between rounds', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  const player = state.players.get('p0')!;
  state.players.get('p1')!.x = 1200; state.players.get('p1')!.y = 700;
  player.x = 500; player.y = 450; player.angle = 0; player.drunkUntilTick = state.tick + 1;
  step(state, new Map());
  assert.equal(player.angle, 0, 'drunkUntilTick equal to the current tick is expired');
  player.drunkUntilTick = state.tick + 50;
  eliminatePlayer(state, 'p1');
  step(state, new Map());
  state.tick = state.phaseEndsAtTick!;
  startNextRound(state);
  assert.equal(player.drunkUntilTick, 0);
  assert.equal(toSnapshot(state).players.find((candidate) => candidate.id === player.id)!.drunkUntilTick, 0);
});

test('modifier pickups arm one use, refresh without stacking, and reset between rounds', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  const player = state.players.get('p0')!;
  player.x = 500; player.y = 450; player.angle = 0;
  state.players.get('p1')!.x = 1200; state.players.get('p1')!.y = 700;
  state.pickups = (['triple', 'orbitShield'] as const).map((type, index) => ({
    id: index + 1, type, x: 502 + index * 2, y: 450, expiresAtTick: state.tick + 100,
  }));
  step(state, new Map());
  assert.equal(player.tripleShotArmed, true);
  assert.equal(player.shielded, true);
  assert.deepEqual(
    [state.matchStats.get('p0')!.triplePickups, state.matchStats.get('p0')!.shieldPickups],
    [1, 1],
  );
  state.pickups = [{ id: 9, type: 'triple', x: player.x + 2, y: player.y, expiresAtTick: state.tick + 10 }];
  step(state, new Map());
  assert.equal(player.tripleShotArmed, true);

  eliminatePlayer(state, 'p1');
  step(state, new Map());
  state.tick = state.phaseEndsAtTick!;
  startNextRound(state);
  assert.equal(player.tripleShotArmed, false);
  assert.equal(player.shielded, false);
  assert.equal(player.shieldGraceUntilTick, 0);
});

test('orbit shields absorb a whole clustered hazard tick and grace protects until strict expiry', () => {
  const state = gameWithPlayers(3);
  enterPlaying(state);
  const shield = state.players.get('p0')!;
  const collider = state.players.get('p1')!;
  const bomber = state.players.get('p2')!;
  shield.x = 500; shield.y = 450; shield.angle = 0; shield.shielded = true;
  collider.x = 520; collider.y = 450; collider.angle = Math.PI;
  bomber.x = 1200; bomber.y = 700;
  state.bombs.set(90, { id: 90, ownerId: 'p2', launchX: 500, launchY: 450, x: 500, y: 450, placedTick: 0, launchedTick: 0, landsAtTick: 0, explodeAtTick: state.tick + 1, blastRange: 150, flightPath: fixedFlightPath(500, 450) });
  step(state, new Map());
  assert.equal(shield.alive, true);
  assert.equal(shield.shielded, false);
  assert.equal(shield.shieldGraceUntilTick, state.tick + 10);

  collider.trail = [{ x1: shield.x + 3, y1: 400, x2: shield.x + 3, y2: 500, createdTick: 0, expiresAtTick: state.tick + 100 }];
  step(state, new Map());
  assert.equal(shield.alive, true, 'grace blocks the trail after the clustered break tick');
  shield.shieldGraceUntilTick = state.tick + 1;
  step(state, new Map());
  assert.equal(shield.alive, false, 'grace is expired when untilTick equals the current tick');
});

test('two shields both break on contact while Star preserves its stored shield', () => {
  const both = gameWithPlayers();
  enterPlaying(both);
  const first = both.players.get('p0')!;
  const second = both.players.get('p1')!;
  first.x = 500; first.y = 450; first.angle = 0; first.shielded = true;
  second.x = 520; second.y = 450; second.angle = Math.PI; second.shielded = true;
  step(both, new Map());
  assert.equal(first.alive, true); assert.equal(second.alive, true);
  assert.equal(first.shielded, false); assert.equal(second.shielded, false);

  const star = gameWithPlayers();
  enterPlaying(star);
  const protectedPlayer = star.players.get('p0')!;
  const normal = star.players.get('p1')!;
  protectedPlayer.x = 500; protectedPlayer.y = 450; protectedPlayer.angle = 0;
  protectedPlayer.shielded = true; protectedPlayer.invulnerableUntilTick = star.tick + 2;
  normal.x = 520; normal.y = 450; normal.angle = Math.PI;
  step(star, new Map());
  assert.equal(protectedPlayer.alive, true);
  assert.equal(protectedPlayer.shielded, true);
  assert.equal(normal.alive, false);
});

test('shield break reflects an outward wall sweep and records the bounce', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  const player = state.players.get('p0')!;
  player.x = state.boundaryInset + 7.1; player.y = 450; player.angle = Math.PI; player.shielded = true;
  state.players.get('p1')!.x = 1200; state.players.get('p1')!.y = 700;
  step(state, new Map());
  assert.equal(player.alive, true);
  assert.equal(player.x, state.boundaryInset + 7);
  assert.ok(Math.abs(player.angle) < 1e-8);
  assert.equal(state.matchStats.get('p0')!.wallBounces, 1);
});

test('countdown leave is stamped, scored once, and a later join receives no prior-round award', () => {
  const state = gameWithPlayers();
  startMatch(state);
  eliminatePlayer(state, 'p1');
  assert.equal(state.roundParticipants.get('p1')!.eliminatedAtTick, 0);
  assert.equal(state.matchStats.get('p1')!.earlyExits, 1);
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick += 1) step(state, new Map());
  assert.equal(state.phase, 'roundOver');
  assert.deepEqual(state.roundPlacements.map((placement) => [placement.playerId, placement.place, placement.scoreUnits]), [
    ['p0', 1, 5 * POINT_UNIT],
    ['p1', 2, 3 * POINT_UNIT],
  ]);
  const totalAfterRound = state.leaderboard.get('p0')!.totalScoreUnits;
  step(state, new Map());
  assert.equal(state.leaderboard.get('p0')!.totalScoreUnits, totalAfterRound, 'round-over ticks cannot score twice');

  addPlayer(state, { id: 'late', name: 'Late', slot: 2, color: SLOT_COLORS[2] });
  assert.equal(state.leaderboard.get('late')!.roundsPlayed, 0);
  assert.ok(!state.roundPlacements.some((placement) => placement.playerId === 'late'));
  removePlayer(state, 'p1');
  assert.ok(state.leaderboard.has('p1'), 'seat departure preserves session history');
  assert.ok(toSnapshot(state).leaderboard.some((entry) => entry.id === 'p1'));
});

test('overlapping blast owners receive no speculative elimination credit', () => {
  const state = gameWithPlayers(3);
  enterPlaying(state);
  const target = state.players.get('p0')!;
  target.x = 500; target.y = 450; target.angle = 0;
  state.players.get('p1')!.x = 1200; state.players.get('p1')!.y = 200;
  state.players.get('p2')!.x = 1200; state.players.get('p2')!.y = 700;
  for (const [id, ownerId] of [[41, 'p1'], [42, 'p2']] as const) {
    state.bombs.set(id, { id, ownerId, launchX: 500, launchY: 450, x: 500, y: 450, placedTick: 0, launchedTick: 0, landsAtTick: 0, explodeAtTick: state.tick + 1, blastRange: 150, flightPath: fixedFlightPath(500, 450) });
  }
  step(state, new Map());
  assert.equal(state.matchStats.get('p0')!.deathsByCause.explosion, 1);
  assert.equal(state.matchStats.get('p1')!.bombsExploded, 1);
  assert.equal(state.matchStats.get('p2')!.bombsExploded, 1);
  assert.equal(state.matchStats.get('p1')!.eliminations, 0);
  assert.equal(state.matchStats.get('p2')!.eliminations, 0);
});

test('match-over recap is frozen and deeply detached from engine state', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  state.players.get('p0')!.roundWins = 2;
  eliminatePlayer(state, 'p1');
  step(state, new Map());
  const before = toSnapshot(state).matchStats;
  eliminatePlayer(state, 'p0');
  setPlayerConnected(state, 'p0', false);
  const after = toSnapshot(state).matchStats;
  assert.deepEqual(after, before);
  assert.equal(state.players.get('p0')!.alive, true);
  after[0]!.deathsByCause.wall = 99;
  assert.notEqual(toSnapshot(state).matchStats[0]!.deathsByCause.wall, 99);
});

test('Five Shot survives Triple collection and cancellation, then launches five with one cooldown', () => {
  const state = gameWithPlayers(); enterPlaying(state);
  const player = state.players.get('p0')!;
  player.x = 500; player.y = 450; player.angle = 0;
  state.players.get('p1')!.x = 1200; state.players.get('p1')!.y = 700;
  for (const type of ['five', 'triple'] as const) {
    state.pickups = [{ id: 1, type, x: player.x + 2, y: player.y, expiresAtTick: state.tick + 50 }];
    step(state, new Map());
  }
  assert.equal(toSnapshot(state).players[0]!.fiveShotArmed, true);
  assert.equal(state.matchStats.get('p0')!.fivePickups, 1);
  step(state, inputs(['p0', { bomb: false, bombActions: ['press', 'cancel', 'release'] }]));
  assert.equal(player.fiveShotArmed, true);
  assert.equal(state.bombs.size, 0);
  step(state, inputs(['p0', { bomb: false, bombActions: ['press', 'release'] }]));
  const bombs = [...state.bombs.values()];
  assert.equal(bombs.length, 5);
  assert.deepEqual(bombs.map(b => b.flightPath[0]!.angle), [-.44, -.22, 0, .22, .44]);
  assert.ok(bombs.every(b => b.landsAtTick === bombs[0]!.landsAtTick && b.explodeAtTick === bombs[0]!.explodeAtTick));
  assert.equal(player.bombReadyAtTick, state.tick + BOMB_COOLDOWN_TICKS);
  assert.equal(player.fiveShotArmed, false); assert.equal(player.tripleShotArmed, false);
  player.fiveShotArmed = true;
  step(state, inputs(['p0', { bomb: false, bombActions: ['press', 'release'] }]));
  assert.equal(state.bombs.size, 5); assert.equal(player.fiveShotArmed, true);
  eliminatePlayer(state, 'p1'); step(state, new Map()); state.tick = state.phaseEndsAtTick!; startNextRound(state);
  assert.equal(player.fiveShotArmed, false);
});

test('radial blast hits diagonal riders, clears diagonal trails and chains diagonal bombs', () => {
  const state = gameWithPlayers(3); enterPlaying(state);
  const rider = state.players.get('p0')!; rider.x = 590; rider.y = 590; rider.angle = 0;
  state.players.get('p1')!.x = 1200; state.players.get('p1')!.y = 750;
  const distant = state.players.get('p2')!; distant.x = 1000; distant.y = 300;
  distant.trail = [{ x1: 560, y1: 560, x2: 580, y2: 580, createdTick: 0, expiresAtTick: 999 }];
  for (const [id, x, y] of [[1, 500, 500], [2, 400, 400], [3, 350, 650]] as const) state.bombs.set(id, {
    id, ownerId: 'p1', launchX: x, launchY: y, x, y, placedTick: 0, launchedTick: 0, landsAtTick: 0,
    explodeAtTick: id === 1 ? state.tick + 1 : state.tick + 100, blastRange: 150, flightPath: fixedFlightPath(x, y),
  });
  const result = step(state, new Map());
  assert.equal(rider.alive, false);
  assert.deepEqual(result.events.filter(e => e.type === 'explosion').map(e => e.bombId), [1, 2]);
  assert.equal(state.bombs.has(3), true, 'outside the disk despite being inside the square');
  assert.ok(distant.trail.every(t => t.x1 !== 560));
});

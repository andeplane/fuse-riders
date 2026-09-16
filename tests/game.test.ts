import { pickupPacing, powerBlastRadius, powerReloadTicks } from '../src/shared/power-progression.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { POINT_UNIT } from '../src/shared/leaderboard.ts';
import { defaultRoomSettings } from '../src/shared/room-settings.ts';
import { DRUNK_DURATION_TICKS, drunkHeadingOffset } from '../src/shared/drunk.ts';
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
  BLAST_VISIBLE_TICKS,
  COUNTDOWN_TICKS,
  INITIAL_BOUNDARY_INSET,
  OVERTIME_INSET_PER_TICK,
  OVERTIME_START_TICK,
  PICKUP_LIFETIME_TICKS,
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
  assert.deepEqual(first.moments, second.moments);
});

test('trail segments remain active until their expiry tick', () => {
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

test('swept movement stops at first contact with an old trail', () => {
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
    x1: 510,
    y1: 300,
    x2: 510,
    y2: 400,
    createdTick: state.tick - SELF_TRAIL_GRACE_TICKS,
    expiresAtTick: state.tick + 100,
  }];
  const result = step(state, new Map());
  assert.equal(rider.alive, false);
  assert.equal(state.matchStats.get('p0')!.survivalTicks, 2, 'the countdown transition tick and fatal tick both simulate movement');
  assert.ok(Math.abs(rider.x - 504) < 1e-6);
  assert.ok(Math.abs(state.matchStats.get('p0')!.distanceUnits - 11.5) < 1e-6);
  assert.equal(rider.trail.at(-1)!.x2, rider.x, 'the fatal trail reaches the impact pose');
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

test('following riders survive when their swept paths are close but their bodies stay apart in time', () => {
  for (const reversed of [false, true]) {
    for (const boosted of [false, true]) {
      const state = gameWithPlayers();
      enterPlaying(state);
      const behind = reversed ? 'p1' : 'p0';
      const ahead = reversed ? 'p0' : 'p1';
      for (const [id, x] of [[behind, 500], [ahead, 520]] as const) {
        Object.assign(state.players.get(id)!, {
          x, y: 350, angle: 0, trail: [], boostUntilTick: boosted ? state.tick + 10 : 0,
        });
      }
      const result = step(state, new Map());
      assert.ok([...state.players.values()].every(player => player.alive));
      assert.equal(state.players.get(ahead)!.x - state.players.get(behind)!.x, 20);
      assert.equal(result.events.some(event => event.type === 'playerEliminated'), false);
      assert.equal(state.phase, 'playing');
    }
  }
});

test('a rider crossing behind another hits only the existing trail, without killing its owner', () => {
  for (const reversed of [false, true]) {
    const state = gameWithPlayers();
    enterPlaying(state);
    const owner = state.players.get(reversed ? 'p1' : 'p0')!;
    const crossing = state.players.get(reversed ? 'p0' : 'p1')!;
    Object.assign(owner, { x: 500, y: 350, angle: 0, trail: [{
      x1: 480, y1: 350, x2: 500, y2: 350, createdTick: state.tick, expiresAtTick: state.tick + 100,
    }] });
    Object.assign(crossing, { x: 490, y: 338, angle: Math.PI / 2, trail: [] });
    const result = step(state, new Map());
    assert.equal(owner.alive, true);
    assert.equal(crossing.alive, false);
    assert.equal(state.roundWinnerId, owner.id);
    assert.deepEqual(result.events.filter(event => event.type === 'playerEliminated'), [
      { type: 'playerEliminated', playerId: crossing.id, cause: 'trail' },
    ]);
    assert.equal(state.matchStats.get(owner.id)!.eliminations, 1);
  }
});

test('rider body contact includes tangency but excludes a near miss', () => {
  for (const separation of [6, 6.001]) {
    const state = gameWithPlayers();
    enterPlaying(state);
    Object.assign(state.players.get('p0')!, { x: 500, y: 350, angle: 0, trail: [] });
    Object.assign(state.players.get('p1')!, { x: 507.5, y: 350 + separation, angle: Math.PI, trail: [] });
    step(state, new Map());
    assert.ok([...state.players.values()].every(player => player.alive === (separation > 6)));
  }
});

test('trail-width heads can skim a trail, while exact edge contact still kills', () => {
  for (const gap of [6, 6.001, 9]) {
    const state = gameWithPlayers();
    enterPlaying(state);
    const rider = state.players.get('p0')!;
    const other = state.players.get('p1')!;
    Object.assign(rider, { x: 500, y: 350 + gap, angle: 0, trail: [] });
    Object.assign(other, { x: 900, y: 600, trail: [{
      x1: 450, y1: 350, x2: 600, y2: 350, createdTick: state.tick, expiresAtTick: state.tick + 100,
    }] });
    step(state, new Map());
    assert.equal(rider.alive, gap > 6);
    if (gap === 6) {
      assert.equal(rider.x, 500, 'contact at tick start does not advance the corpse');
      assert.equal(rider.trail.length, 0, 'zero travel does not leave a zero-length segment');
    }
  }
});

test('fatal trail ends at the nearest contact regardless of trail array order', () => {
  for (const positions of [[511, 513], [513, 511]]) {
    const state = gameWithPlayers();
    enterPlaying(state);
    const rider = state.players.get('p0')!;
    Object.assign(rider, { x: 500, y: 350, angle: 0, trail: [] });
    Object.assign(state.players.get('p1')!, { x: 900, y: 600, trail: positions.map(x => ({
      x1: x, y1: 300, x2: x, y2: 400, createdTick: state.tick, expiresAtTick: state.tick + 100,
    })) });
    const { snapshot } = step(state, new Map());
    const dead = snapshot.players.find(player => player.id === rider.id)!;
    assert.equal(dead.alive, false);
    assert.ok(Math.abs(dead.x - 505) < 1e-6);
    assert.equal(dead.y, 350);
    assert.deepEqual(dead.trail, [{ x1: 500, y1: 350, x2: dead.x, y2: 350,
      createdTick: state.tick, expiresAtTick: state.tick + TRAIL_LIFETIME_TICKS, detached: { id: 1, decayStartTick: state.tick + 20 } }]);
  }
});

test('a crash at a rounded trail endpoint records the contact instead of the previous tick', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  const rider = state.players.get('p0')!;
  Object.assign(rider, { x: 500, y: 350, angle: 0, trail: [] });
  Object.assign(state.players.get('p1')!, { x: 900, y: 600, trail: [{
    x1: 510, y1: 353, x2: 510, y2: 400, createdTick: state.tick, expiresAtTick: state.tick + 100,
  }] });
  step(state, new Map());
  assert.equal(rider.alive, false);
  assert.ok(Math.abs(Math.hypot(rider.x - 510, rider.y - 353) - 6) < 1e-6);
  assert.equal(rider.trail.at(-1)!.x2, rider.x);
});

// The tangency case above pins how wide contact is. This one pins that it is measured at matching times, which
// nothing else still catches: once #202 narrowed contact to the trail head, the older following-riders case cleared
// the threshold on the old path-vs-path comparison too, so reverting to it no longer fails anything. These two ride
// abreast 6.5 apart -- never touching -- but their paths lie along the same line, so a path-against-path test reads
// them as zero apart and kills both. Written out rather than derived from RIDER_CONTACT_RADIUS: a distance that
// follows the constant cannot notice the constant moving.
test('riders abreast just outside contact survive, though their paths overlap in space', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  const left = state.players.get('p0')!;
  const right = state.players.get('p1')!;
  left.x = 500; left.y = 350; left.angle = 0; left.trail = [];
  right.x = 506.5; right.y = 350; right.angle = 0; right.trail = [];
  const result = step(state, new Map());
  assert.deepEqual(result.events.filter((event) => event.type === 'playerEliminated'), [], 'a 6.5 gap is outside the 6-unit contact width at every instant');
  assert.ok(left.alive && right.alive);
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
  assert.ok(Math.abs(left.x - 507) < 1e-6);
  assert.ok(Math.abs(right.x - 513) < 1e-6);
  assert.equal(left.trail.at(-1)!.x2, left.x);
  assert.equal(right.trail.at(-1)!.x2, right.x);
  assert.equal(state.roundParticipants.get('p0')!.eliminatedAtTick, state.tick);
  assert.equal(state.roundParticipants.get('p1')!.eliminatedAtTick, state.tick);
  assert.equal(state.phase, 'roundOver');
  assert.equal(state.roundWinnerId, undefined);
  assert.deepEqual(result.events.filter((event) => event.type === 'playerEliminated').map((event) => event.playerId).sort(), ['p0', 'p1']);
  assert.ok(result.events.some((event) => event.type === 'roundEnded' && event.winnerId === undefined));
  // Everybody dying to each other is a highlight moment: it is announced before the round ends (ADR 043/044).
  assert.deepEqual(result.events.map((event) => event.type), ['playerEliminated', 'playerEliminated', 'moment', 'roundEnded']);
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
  let result = step(state, inputs(['p0', { bomb: true, bombCommands: [{ action: 'press' }] }]));
  assert.equal(state.bombs.size, 0);
  assert.equal(owner.bombChargeStartedTick, state.tick);
  result = step(state, inputs(['p0', { bomb: true }]));
  assert.equal(state.bombs.size, 0, 'held input without an edge only continues charging');
  result = step(state, inputs(['p0', { bomb: false, bombCommands: [{ action: 'release' }] }]));
  assert.equal(state.bombs.size, 1);
  const firstBomb = [...state.bombs.values()][0]!;
  assert.equal(firstBomb.blastRange, 90, 'base radius is 60% of the original 150');
  assert.equal(firstBomb.explodeAtTick, state.tick + BOMB_FUSE_TICKS);
  assert.equal(firstBomb.landsAtTick, state.tick + BOMB_FLIGHT_TICKS);
  assert.equal(firstBomb.launchX, owner.x);
  assert.equal(firstBomb.x - firstBomb.launchX, BOMB_MIN_LAUNCH_DISTANCE + 2 * (BOMB_MAX_LAUNCH_DISTANCE - BOMB_MIN_LAUNCH_DISTANCE) / BOMB_MAX_CHARGE_TICKS);
  assert.equal(owner.bombReadyAtTick, state.tick + BOMB_COOLDOWN_TICKS);
  assert.equal(result.events.filter((event) => event.type === 'bombPlaced').length, 1);

  result = step(state, inputs(['p0', { bomb: true, bombCommands: [{ action: 'press' }] }]));
  assert.equal(state.bombs.size, 1);
  assert.equal(result.events.filter((event) => event.type === 'bombPlaced').length, 0);

  state.bombs.set(77, {
    id: 77,
    ownerId: 'p1',
    launchX: firstBomb.x + BOMB_BLAST_RANGE / 2,
    launchY: firstBomb.y,
    x: firstBomb.x + BOMB_BLAST_RANGE / 2,
    y: firstBomb.y,
    placedTick: state.tick,
    launchedTick: state.tick,
    landsAtTick: state.tick,
    flightPath: fixedFlightPath(firstBomb.x + BOMB_BLAST_RANGE / 2, firstBomb.y),
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

  result = step(state, inputs(['p0', { bomb: true, bombCommands: [{ action: 'press' }, { action: 'release' }] }]));
  assert.equal(result.events.filter((event) => event.type === 'bombPlaced').length, 0, 'cooldown rejects a fresh edge');
});

test('quick bomb action bursts launch at minimum range and cancel paths never launch', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  const owner = state.players.get('p0')!;
  owner.x = 500; owner.y = 450; owner.angle = 0;
  state.players.get('p1')!.x = 1200; state.players.get('p1')!.y = 700;
  step(state, inputs(['p0', { bomb: false, bombCommands: [{ action: 'release' }] }]));
  assert.equal(state.bombs.size, 0, 'release without accepted charge is ignored');
  const launched = step(state, inputs(['p0', { bomb: false, bombCommands: [{ action: 'press' }, { action: 'release' }] }]));
  const bomb = [...state.bombs.values()][0]!;
  assert.equal(bomb.x - bomb.launchX, BOMB_MIN_LAUNCH_DISTANCE);
  assert.equal(launched.events.filter((event) => event.type === 'bombPlaced').length, 1);
  assert.equal(toSnapshot(state).bombs[0]!.launchedTick, state.tick);

  state.bombs.clear();
  owner.bombReadyAtTick = state.tick;
  step(state, inputs(['p0', { bomb: true, bombCommands: [{ action: 'press' }] }]));
  assert.equal(toSnapshot(state).players.find((player) => player.id === owner.id)!.bombChargeStartedTick, state.tick);
  step(state, inputs(['p0', { bomb: false, bombCommands: [{ action: 'cancel' }, { action: 'release' }] }]));
  assert.equal(state.bombs.size, 0);
  assert.equal(owner.bombChargeStartedTick, undefined);

  step(state, inputs(['p0', { bomb: true, bombCommands: [{ action: 'press' }] }]));
  eliminatePlayer(state, owner.id);
  assert.equal(owner.bombChargeStartedTick, undefined);
});

test('bomb uses the configured aim time while steering and follows the release heading', () => {
  for (const [bombChargeTicks, distance] of [[undefined, 400], [24, 200], [2, 400]] as const) {
    const state = gameWithPlayers();
    if (bombChargeTicks !== undefined) state.settings = { ...defaultRoomSettings(), bombChargeTicks, aimBounce: false };
    enterPlaying(state);
    const owner = state.players.get('p0')!;
    owner.x = 500; owner.y = 300; owner.angle = 0;
    state.players.get('p1')!.x = 1200; state.players.get('p1')!.y = 700;
    step(state, inputs(['p0', { bomb: true, bombCommands: [{ action: 'press' }] }]));
    const startedTick = state.tick;
    for (let tick = 1; tick < 8; tick++) {
      step(state, inputs(['p0', { right: true, bomb: true }]));
      assert.equal(state.bombs.size, 0, 'steering while charging must not launch');
    }
    step(state, inputs(['p0', { right: true, bombCommands: [{ action: 'release' }] }]));
    const bomb = [...state.bombs.values()][0]!;
    assert.equal(state.tick - startedTick, 8);
    assert.ok(owner.angle > 0, 'rider keeps steering throughout the charge');
    assert.ok(Math.abs(Math.hypot(bomb.x - bomb.launchX, bomb.y - bomb.launchY) - distance) < 1e-8);
    assert.ok(Math.abs(bomb.x - (owner.x + Math.cos(owner.angle) * distance)) < 1e-8);
    assert.ok(Math.abs(bomb.y - (owner.y + Math.sin(owner.angle) * distance)) < 1e-8);
    assert.equal(toSnapshot(state).bombChargeTicks, bombChargeTicks ?? 8);
    assert.equal(owner.bombChargeStartedTick, undefined);
  }
});

test('charged launches cap and clamp to the active safe interior', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  const owner = state.players.get('p0')!;
  owner.x = state.width - state.boundaryInset - 50; owner.y = 450; owner.angle = 0;
  state.players.get('p1')!.x = 800; state.players.get('p1')!.y = 700;
  owner.bombChargeStartedTick = state.tick - BOMB_MAX_CHARGE_TICKS - 100;
  step(state, inputs(['p0', { bomb: false, bombCommands: [{ action: 'release' }] }]));
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
  const result = step(state, inputs(['p0', { bomb: false, bombCommands: [{ action: 'press' }, { action: 'release' }] }]));
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
  step(state, inputs(['p0', { bomb: false, bombCommands: [{ action: 'release' }] }]));
  step(state, inputs(['p0', { bomb: true, bombCommands: [{ action: 'press' }] }]));
  step(state, inputs(['p0', { bomb: false, bombCommands: [{ action: 'cancel' }] }]));
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
  assert.equal(first.nextPickupSpawnTick, first.tick + pickupPacing(2).interval);
  first.nextPickupSpawnTick = first.tick + 1;
  second.nextPickupSpawnTick = second.tick + 1;
  step(first, new Map());
  step(second, new Map());
  assert.equal(first.pickups.length, 1);
  assert.deepEqual(first.pickups, second.pickups);
  assert.equal(first.randomState, second.randomState);
});

test('first Power pickup applies both weapon upgrades on the collection tick', () => {
  const state = gameWithPlayers(); enterPlaying(state);
  const player = state.players.get('p0')!;
  Object.assign(player, { x: 500, y: 450, angle: 0, powerPickups: 0 });
  Object.assign(state.players.get('p1')!, { x: 1200, y: 700 });
  state.pickups = [{ id: 1, type: 'power', x: 503, y: 450, expiresAtTick: state.tick + 100 }];
  step(state, inputs(['p0', { bomb: false, bombCommands: [{ action: 'press' }, { action: 'release' }] }]));
  assert.equal(player.powerPickups, 1);
  assert.equal(state.pickups.length, 0);
  const bomb = [...state.bombs.values()][0]!;
  assert.equal(bomb.blastRange, powerBlastRadius(player.powerPickups));
  assert.ok(bomb.blastRange > BOMB_BLAST_RANGE);
  assert.equal(player.bombReadyAtTick, state.tick + powerReloadTicks(player.powerPickups));
  assert.ok(player.reloadDurationTicks < BOMB_COOLDOWN_TICKS);
  assert.equal(bomb.explodeAtTick - bomb.launchedTick, BOMB_FUSE_TICKS);
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
  state.pickups = Array.from({ length: pickupPacing(2).cap }, (_, index) => ({
    id: index + 1,
    type: 'power' as const,
    x: 700 + index * 40,
    y: 450,
    expiresAtTick: state.tick + (index === 0 ? 1 : PICKUP_LIFETIME_TICKS),
  }));
  state.nextPickupSpawnTick = state.tick + 1;
  step(state, new Map());
  assert.equal(state.pickups.length, pickupPacing(2).cap, 'a scheduled replacement respects the living-rider cap');

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

  const startedTick = target.drunkStartedTick;
  const angleBefore = target.angle;
  const expectedNoise = drunkHeadingOffset(state.seed, target.id, state.tick + 1, target.drunkStartedTick, target.drunkUntilTick) - target.drunkHeadingOffset;
  step(state, inputs(['p1', { left: true }]));
  const expectedAngle = ((angleBefore - 2.8 / 20 + expectedNoise) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  assert.ok(Math.abs(target.angle - expectedAngle) < 1e-10, 'normal steering and deterministic wobble are added');

  state.pickups = [{ id: 2, type: 'beer', x: collector.x + 3, y: collector.y, expiresAtTick: state.tick + 100 }];
  step(state, new Map());
  assert.equal(target.drunkUntilTick, state.tick + DRUNK_DURATION_TICKS, 'a second beer refreshes without stacking');
  assert.equal(target.drunkStartedTick, startedTick, 'refresh preserves the sway phase');
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
  assert.equal(player.drunkStartedTick, 0);
  assert.equal(player.drunkHeadingOffset, 0);
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
  step(state, inputs(['p0', { bomb: false, bombCommands: [{ action: 'press' }, { action: 'cancel' }, { action: 'release' }] }]));
  assert.equal(player.fiveShotArmed, true);
  assert.equal(state.bombs.size, 0);
  step(state, inputs(['p0', { bomb: false, bombCommands: [{ action: 'press' }, { action: 'release' }] }]));
  const bombs = [...state.bombs.values()];
  assert.equal(bombs.length, 5);
  assert.deepEqual(bombs.map(b => b.flightPath[0]!.angle), [-.44, -.22, 0, .22, .44]);
  assert.ok(bombs.every(b => b.landsAtTick === bombs[0]!.landsAtTick && b.explodeAtTick === bombs[0]!.explodeAtTick));
  assert.equal(player.bombReadyAtTick, state.tick + BOMB_COOLDOWN_TICKS);
  assert.equal(player.fiveShotArmed, false); assert.equal(player.tripleShotArmed, false);
  player.fiveShotArmed = true;
  step(state, inputs(['p0', { bomb: false, bombCommands: [{ action: 'press' }, { action: 'release' }] }]));
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

test('bomb landing hits a rider before detonation, respecting star and shield', () => {
  for (const protection of ['none', 'star', 'shield'] as const) {
    const state = gameWithPlayers(3); enterPlaying(state);
    const victim = state.players.get('p1')!;
    victim.x = 1055; victim.y = 450; victim.angle = 0;
    victim.invulnerableUntilTick = protection === 'star' ? state.tick + 20 : 0;
    victim.shielded = protection === 'shield';
    const owner = state.players.get('p0')!; owner.x = 500; owner.y = 450;
    state.players.get('p2')!.x = 1200; state.players.get('p2')!.y = 700;
    for (const player of state.players.values()) player.trail = [];
    state.bombs.set(99, { id: 99, ownerId: 'p0', launchX: 500, launchY: 450, x: 1100, y: 450,
      placedTick: state.tick, launchedTick: state.tick, landsAtTick: state.tick + 6, explodeAtTick: state.tick + 40,
      blastRange: 90, flightPath: Array.from({ length: 7 }, (_, i) => ({ x: 500 + i * 100, y: 450, angle: 0 })) });
    for (let tick = 0; tick < 5; tick++) step(state, new Map());
    assert.equal(victim.alive, true, 'flight is harmless');
    step(state, new Map());
    assert.equal(victim.alive, protection !== 'none');
    assert.equal(owner.alive, true, 'owner is not struck by their own launch');
    assert.equal(state.blasts.length, 0, 'impact damage precedes the explosion');
    assert.equal(state.bombs.has(99), true, 'bomb keeps its fuse after the hit');
    if (protection === 'shield') assert.equal(victim.shielded, false);
  }
});

test('a bomb landing inside an active blast chains immediately', () => {
  const state = gameWithPlayers(3); enterPlaying(state);
  state.blasts.push({ bombId: 98, ownerId: 'p0', circle: { x: 800, y: 450, radius: 90 }, expiresAtTick: state.tick + 8 });
  state.bombs.set(99, { id: 99, ownerId: 'p1', launchX: 800, launchY: 450, x: 800, y: 450,
    placedTick: state.tick, launchedTick: state.tick, landsAtTick: state.tick + 1, explodeAtTick: state.tick + 40,
    blastRange: 90, flightPath: fixedFlightPath(800, 450) });
  step(state, new Map());
  assert.equal(state.bombs.has(99), false);
  assert.equal(state.blasts.filter(blast => blast.bombId === 99).length, 1);
});

test('blast preview is harmless before the fuse, both in flight and after landing', () => {
  for (const airborne of [false, true]) {
    const state = gameWithPlayers(3); enterPlaying(state);
    const rider = state.players.get('p1')!;
    rider.x = 600; rider.y = 500; rider.angle = 0;
    state.players.get('p0')!.x = 200; state.players.get('p0')!.y = 200;
    state.players.get('p2')!.x = 1200; state.players.get('p2')!.y = 700;
    for (const player of state.players.values()) player.trail = [];
    state.bombs.set(99, { id: 99, ownerId: 'p0', launchX: 500, launchY: 450, x: 600, y: 450,
      placedTick: state.tick, launchedTick: state.tick, landsAtTick: state.tick + (airborne ? 6 : 0),
      explodeAtTick: state.tick + 40, blastRange: 140,
      flightPath: Array.from({ length: 7 }, (_, i) => ({ x: 500 + i * 100 / 6, y: 450, angle: 0 })) });
    for (let tick = 0; tick < 8; tick++) step(state, new Map());
    assert.equal(rider.alive, true, 'inside the large preview but outside the physical bomb');
    assert.equal(state.blasts.length, 0);
    state.bombs.get(99)!.explodeAtTick = state.tick + 1;
    step(state, new Map());
    assert.equal(rider.alive, false, 'radius becomes lethal only when bomb detonates');
  }
});

test('bomb skips riders along flight and only snipes at its landing position', () => {
  const state = gameWithPlayers(4); enterPlaying(state);
  for (const player of state.players.values()) { player.trail = []; player.angle = 0; }
  Object.assign(state.players.get('p0')!, { x: 200, y: 200 });
  Object.assign(state.players.get('p1')!, { x: 540, y: 450 });
  Object.assign(state.players.get('p2')!, { x: 900, y: 700 });
  Object.assign(state.players.get('p3')!, { x: 600, y: 500 });
  state.bombs.set(99, { id: 99, ownerId: 'p0', launchX: 500, launchY: 450, x: 600, y: 450,
    placedTick: state.tick, launchedTick: state.tick, landsAtTick: state.tick + 6, explodeAtTick: state.tick + 40,
    blastRange: 140, flightPath: [{ x: 500, y: 450, angle: 0 }, ...fixedFlightPath(600, 450)] });
  step(state, new Map());
  assert.equal(state.players.get('p1')!.alive, true, 'crossing the flight path is harmless');
  state.tick += 4;
  Object.assign(state.players.get('p1')!, { x: 400, y: 450, trail: [] });
  Object.assign(state.players.get('p2')!, { x: 592.5, y: 450, trail: [] });
  step(state, new Map());
  assert.equal(state.players.get('p1')!.alive, true);
  assert.equal(state.players.get('p2')!.alive, false, 'physical landing contact snipes');
  assert.equal(state.players.get('p3')!.alive, true, 'large preview is still harmless');
  assert.equal(state.bombs.get(99)!.x, 600); assert.equal(state.blasts.length, 0);
});

test('landing step never uses blast radius for contact damage', () => {
  for (const offset of [30, 50, 100, 135]) {
    const state = gameWithPlayers(3); enterPlaying(state);
    for (const player of state.players.values()) player.trail = [];
    Object.assign(state.players.get('p0')!, { x: 200, y: 200, angle: 0 });
    Object.assign(state.players.get('p1')!, { x: 600, y: 450 + offset, angle: 0 });
    Object.assign(state.players.get('p2')!, { x: 1200, y: 700, angle: 0 });
    state.bombs.set(99, { id: 99, ownerId: 'p0', launchX: 500, launchY: 450, x: 600, y: 450,
      placedTick: state.tick - 5, launchedTick: state.tick - 5, landsAtTick: state.tick + 1,
      explodeAtTick: state.tick + 35, blastRange: 140,
      flightPath: Array.from({ length: 7 }, (_, i) => ({ x: 500 + i * 100 / 6, y: 450, angle: 0 })) });
    step(state, new Map());
    assert.equal(state.players.get('p1')!.alive, true, `landing preview at offset ${offset} is harmless`);
    assert.equal(state.blasts.length, 0);
  }
});

test('shell persists beyond five seconds and permits another shot after cooldown', () => {
  const state = gameWithPlayers(3); enterPlaying(state);
  const owner = state.players.get('p0')!; owner.x = 500; owner.y = 450; owner.angle = 0;
  state.pickups = [{ id: 999, type: 'shell', x: owner.x, y: owner.y, expiresAtTick: state.tick + 50 }];
  step(state, new Map()); assert.equal(owner.shellArmed, true);
  owner.fiveShotArmed = true; owner.targetBombArmed = true;
  step(state, inputs(['p0', { bomb: true, bombCommands: [{ action: 'press' }] }]));
  step(state, inputs(['p0', { bomb: false, bombCommands: [{ action: 'release' }] }]));
  assert.equal(state.bombs.size, 1);
  const shell = [...state.bombs.values()][0]!;
  assert.ok(shell.shell); assert.equal(shell.explodeAtTick, Number.MAX_SAFE_INTEGER);
  assert.equal(owner.shellArmed, false); assert.equal(owner.fiveShotArmed, true); assert.equal(owner.targetBombArmed, true);
  const snap = toSnapshot(state).bombs[0]!; assert.equal(snap.shell!.vx, 450);
  snap.shell!.vx = -2; assert.equal(shell.shell!.vx, 450);
  shell.x = 800; shell.y = 700;
  state.tick += 200;
  shell.explodeAtTick = state.tick - 1;
  shell.landsAtTick = state.tick - 1;
  step(state, new Map());
  assert.ok(state.bombs.has(shell.id)); assert.equal(state.blasts.length, 0);
  step(state, inputs(['p0', { bomb: true, bombCommands: [{ action: 'press' }] }]));
  assert.notEqual(owner.bombChargeStartedTick, undefined);
  owner.targetBombArmed = false;
  step(state, inputs(['p0', { bomb: false, bombCommands: [{ action: 'release' }] }]));
  assert.equal(state.bombs.size, 6);
});
test('shell body hits once, shield absorbs it, and no blast radius is produced', () => {
  for (const shield of [false, true]) {
    const state = gameWithPlayers(3); enterPlaying(state);
    Object.assign(state.players.get('p0')!, { x: 200, y: 200 });
    Object.assign(state.players.get('p1')!, { x: 535, y: 450, angle: 0, shielded: shield });
    Object.assign(state.players.get('p2')!, { x: 1200, y: 700 });
    for (const player of state.players.values()) player.trail = [];
    state.bombs.set(99, { id: 99, ownerId: 'p0', launchX: 500, launchY: 450, x: 500, y: 450,
      placedTick: state.tick, launchedTick: state.tick - 1, landsAtTick: state.tick + 100,
      explodeAtTick: state.tick + 100, blastRange: 0, flightPath: [], shell: { vx: 450, vy: 0 } });
    step(state, new Map());
    assert.equal(state.players.get('p1')!.alive, shield); assert.equal(state.bombs.size, 0);
    assert.equal(state.players.get('p1')!.shielded, false); assert.equal(state.blasts.length, 0);
  }
});

test('Gun pickup fires one bullet at twice rider speed and cuts a traversable trail gap', () => {
  const state = gameWithPlayers(3); enterPlaying(state);
  const owner = state.players.get('p0')!; Object.assign(owner, { x: 500, y: 450, angle: 0, trail: [] });
  Object.assign(state.players.get('p1')!, { x: 1000, y: 700, trail: [] });
  Object.assign(state.players.get('p2')!, { x: 1200, y: 200, trail: [] });
  state.pickups = [{ id: 999, type: 'gun', x: owner.x, y: owner.y, expiresAtTick: state.tick + 50 }];
  step(state, new Map()); assert.equal(owner.gunArmed, true);
  owner.fiveShotArmed = true;
  step(state, inputs(['p0', { bomb: true, bombCommands: [{ action: 'press' }] }]));
  step(state, inputs(['p0', { bomb: false, bombCommands: [{ action: 'release' }] }]));
  const bullet = [...state.bombs.values()][0]!;
  assert.equal(bullet.shell!.gun, true); assert.equal(bullet.shell!.vx, 300);
  assert.equal(owner.gunArmed, false); assert.equal(owner.fiveShotArmed, true);
  state.players.get('p1')!.trail = [{ x1: bullet.x + 15, x2: bullet.x + 15, y1: 300, y2: 600, createdTick: state.tick, expiresAtTick: state.tick + 100 }];
  step(state, new Map());
  assert.equal(state.bombs.size, 0); assert.equal(state.blasts.length, 1);
  const pieces = state.players.get('p1')!.trail.filter(t => t.y1 < 600 && t.y2 > 300);
  assert.ok(pieces.some(t => t.y2 === 400)); assert.ok(pieces.some(t => t.y1 === 500));
  assert.equal(owner.alive, false);
});
test('gun head and wall impacts explode', () => {
  for (const wall of [false, true]) {
    const state = gameWithPlayers(3); enterPlaying(state);
    for (const player of state.players.values()) player.trail = [];
    Object.assign(state.players.get('p0')!, { x: 200, y: 200 });
    Object.assign(state.players.get('p1')!, { x: 518, y: 450, angle: 0 });
    Object.assign(state.players.get('p2')!, { x: 1200, y: 700 });
    const x = wall ? state.width - state.boundaryInset - 5 : 500;
    state.bombs.set(99, { id: 99, ownerId: 'p0', x, y: 450, launchX: x, launchY: 450, placedTick: state.tick,
      launchedTick: state.tick - 1, landsAtTick: state.tick + 60, explodeAtTick: state.tick + 60,
      blastRange: 0, flightPath: [], shell: { vx: 300, vy: 0, gun: true } });
    step(state, new Map()); assert.equal(state.bombs.size, 0); assert.equal(state.blasts.length, 1);
    assert.equal(state.players.get('p1')!.alive, wall);
  }
});

test('power changes only future shots, preserves fuse timing and resets next round', () => {
  const state = gameWithPlayers(3); enterPlaying(state);
  const owner = state.players.get('p0')!; Object.assign(owner, { x: 400, y: 450, angle: 0, trail: [] });
  const other = state.players.get('p1')!; Object.assign(other, { x: 1000, y: 700, angle: 0, trail: [] });
  const deadline = state.tick + BOMB_FUSE_TICKS;
  owner.bombReadyAtTick = state.tick + BOMB_COOLDOWN_TICKS;
  const reloadDeadline = owner.bombReadyAtTick;
  state.bombs.set(99, { id: 99, ownerId: owner.id, x: 700, y: 200, launchX: 700, launchY: 200,
    launchedTick: state.tick, placedTick: state.tick, landsAtTick: state.tick, explodeAtTick: deadline,
    blastRange: BOMB_BLAST_RANGE, flightPath: fixedFlightPath(700, 200) });
  for (let count = 1; count <= 6; count++) {
    state.pickups = [{ id: 100 + count, type: 'power', x: owner.x, y: owner.y, expiresAtTick: state.tick + 50 }];
    step(state, new Map()); assert.equal(owner.powerPickups, count);
    assert.equal(state.bombs.get(99)!.explodeAtTick, deadline);
    assert.equal(state.bombs.get(99)!.blastRange, BOMB_BLAST_RANGE);
    assert.equal(owner.bombReadyAtTick, reloadDeadline, 'collecting does not rewrite a running reload');
    assert.equal(owner.reloadDurationTicks, BOMB_COOLDOWN_TICKS);
    assert.ok(powerBlastRadius(count) > powerBlastRadius(count - 1));
    assert.ok(powerReloadTicks(count) < BOMB_COOLDOWN_TICKS);
  }
  state.bombs.clear(); owner.bombReadyAtTick = state.tick; owner.tripleShotArmed = true;
  step(state, inputs(['p0', { bomb: true, bombCommands: [{ action: 'press' }] }], ['p1', { bomb: true, bombCommands: [{ action: 'press' }] }]));
  step(state, inputs(['p0', { bomb: false, bombCommands: [{ action: 'release' }] }], ['p1', { bomb: false, bombCommands: [{ action: 'release' }] }]));
  const bombs = [...state.bombs.values()];
  assert.equal(bombs.filter(bomb => bomb.ownerId === owner.id).length, 3);
  assert.ok(bombs.every(bomb => bomb.explodeAtTick - bomb.launchedTick === BOMB_FUSE_TICKS));
  assert.ok(bombs.filter(bomb => bomb.ownerId === owner.id).every(bomb => bomb.blastRange === powerBlastRadius(owner.powerPickups)));
  assert.equal(bombs.find(bomb => bomb.ownerId === other.id)!.blastRange, BOMB_BLAST_RANGE);
  assert.equal(toSnapshot(state).players.find(player => player.id === owner.id)!.powerPickups, 6);
  eliminatePlayer(state, 'p1'); eliminatePlayer(state, 'p2'); step(state, new Map());
  state.tick = state.phaseEndsAtTick!; startNextRound(state);
  assert.equal(owner.powerPickups, 0); assert.equal(owner.reloadDurationTicks, BOMB_COOLDOWN_TICKS);
});

test('live shell bounces off a rider trail without damage or resetting its lifetime', () => {
  const state = gameWithPlayers(3); enterPlaying(state);
  Object.assign(state.players.get('p0')!, { x: 200, y: 200, trail: [] });
  Object.assign(state.players.get('p1')!, { x: 1200, y: 700, trail: [] });
  Object.assign(state.players.get('p2')!, { x: 1000, y: 300, trail: [] });
  const tail = { x1: 536, y1: 300, x2: 536, y2: 600, createdTick: state.tick, expiresAtTick: state.tick + 150 };
  state.players.get('p1')!.trail = [tail];
  const expires = state.tick + 90;
  state.bombs.set(99, { id: 99, ownerId: 'p0', x: 500, y: 450, launchX: 500, launchY: 450,
    launchedTick: state.tick - 10, placedTick: state.tick - 10, landsAtTick: expires, explodeAtTick: expires,
    blastRange: 0, flightPath: [], shell: { vx: 450, vy: 0 } });
  step(state, new Map());
  const shell = state.bombs.get(99)!;
  assert.equal(shell.shell!.vx, -450); assert.ok(shell.x < 519);
  assert.equal(shell.explodeAtTick, expires);
  assert.deepEqual(state.players.get('p1')!.trail.find(segment => segment.x1 === 536), tail);
  assert.equal(state.blasts.length, 0);
});

test('gun explodes against the trail directly behind a rider and kills the rider', () => {
  const state = gameWithPlayers(3); enterPlaying(state);
  Object.assign(state.players.get('p0')!, { x: 200, y: 200, trail: [] });
  Object.assign(state.players.get('p1')!, { x: 525, y: 450, angle: 0, trail: [{ x1: 480, y1: 450, x2: 525, y2: 450, createdTick: state.tick, expiresAtTick: state.tick + 100 }] });
  Object.assign(state.players.get('p2')!, { x: 1200, y: 700, trail: [] });
  state.bombs.set(99, { id: 99, ownerId: 'p0', x: 500, y: 450, launchX: 500, launchY: 450, placedTick: state.tick,
    launchedTick: state.tick - 10, landsAtTick: state.tick + 60, explodeAtTick: state.tick + 60,
    blastRange: 0, flightPath: [], shell: { vx: 300, vy: 0, gun: true } });
  const result = step(state, new Map());
  assert.equal(state.players.get('p1')!.alive, false);
  assert.equal(state.blasts.length, 1);
  assert.ok(result.events.some(event => event.type === 'explosion'));
});

test('a blast clears trails whether it came from a landed bomb or a gun projectile hitting a rider', () => {
  // Regression for #26: gun-on-rider blasts are appended after the first explosion pass,
  // so the trail-clearing filter has to run once the shell sweep has finished.
  for (const source of ['bomb', 'gun'] as const) {
    const state = gameWithPlayers(3);
    enterPlaying(state);
    Object.assign(state.players.get('p0')!, { x: 200, y: 200, angle: 0, trail: [] });
    Object.assign(state.players.get('p1')!, { x: 900, y: 450, angle: 0, trail: [] });
    Object.assign(state.players.get('p2')!, { x: 1200, y: 800, angle: 0, trail: [{
      x1: 905, y1: 470, x2: 905, y2: 480, createdTick: state.tick, expiresAtTick: state.tick + 100,
    }] });
    const shared = { id: 99, ownerId: 'p0', placedTick: state.tick, flightPath: [] };
    if (source === 'bomb') {
      // A landed bomb sitting on the detonation point, due this tick.
      state.bombs.set(99, { ...shared, x: 900, y: 450, launchX: 900, launchY: 450,
        launchedTick: state.tick - 10, landsAtTick: state.tick - 1, explodeAtTick: state.tick, blastRange: 32 });
    } else {
      // A gun projectile already overlapping p1, so it detonates on the rider at (900, 450).
      state.bombs.set(99, { ...shared, x: 890, y: 450, launchX: 890, launchY: 450,
        launchedTick: state.tick - 10, landsAtTick: state.tick + 60, explodeAtTick: state.tick + 60,
        blastRange: 0, shell: { vx: 300, vy: 0, gun: true } });
    }

    const result = step(state, new Map());
    assert.ok(result.events.some((event) => event.type === 'explosion' && event.bombId === 99), `${source} explodes`);
    assert.deepEqual(state.blasts.map((blast) => [blast.circle.x, blast.circle.y, blast.circle.radius]),
      [[900, 450, 32]], `${source} blast geometry`);
    assert.equal(state.players.get('p2')!.trail.some((segment) => segment.y1 === 470), false,
      `${source} blast burns the trail`);
  }
});

test('a fixed-rounds match ends on the standings leader even when another rider wins the final round', () => {
  // Regression for #19: the standings leader is not the final round's winner, which used to
  // throw inside applyRoundScores after partially mutating the state.
  const state = gameWithPlayers();
  state.settings = { ...defaultRoomSettings(), match: 'rounds', length: 3 };
  enterPlaying(state);
  for (const loser of ['p1', 'p1', 'p0'] as const) {
    eliminatePlayer(state, loser);
    const result = step(state, new Map());
    assert.equal(result.events.filter((event) => event.type === 'roundEnded').length, 1);
    if (state.phase !== 'roundOver') break;
    state.tick = state.phaseEndsAtTick!;
    startNextRound(state);
    for (let tick = 0; tick < COUNTDOWN_TICKS; tick += 1) step(state, new Map());
  }

  assert.equal(state.phase, 'matchOver');
  assert.equal(state.matchWinnerId, 'p0');
  assert.equal(state.roundWinnerId, 'p1', 'the final round still belongs to its survivor');
  assert.deepEqual(state.leaderboard.get('p0'), {
    id: 'p0', name: 'Player 1', totalScoreUnits: 13 * POINT_UNIT,
    roundsPlayed: 3, roundWins: 2, matchWins: 1,
  });
  assert.deepEqual(state.leaderboard.get('p1'), {
    id: 'p1', name: 'Player 2', totalScoreUnits: 11 * POINT_UNIT,
    roundsPlayed: 3, roundWins: 1, matchWins: 0,
  });
  // The state must stay usable: a crashed resolveRound used to re-throw on every later step.
  assert.doesNotThrow(() => { for (let tick = 0; tick < 5; tick += 1) step(state, new Map()); });
  assert.equal(state.phase, 'matchOver');
  assert.equal(toSnapshot(state).matchWinnerId, 'p0');
});

test('a drawn final round still awards the fixed-rounds match to the standings leader', () => {
  const state = gameWithPlayers();
  state.settings = { ...defaultRoomSettings(), match: 'rounds', length: 2 };
  enterPlaying(state);
  eliminatePlayer(state, 'p1');
  step(state, new Map());
  assert.equal(state.phase, 'roundOver');
  state.tick = state.phaseEndsAtTick!;
  startNextRound(state);
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick += 1) step(state, new Map());
  Object.assign(state.players.get('p0')!, { x: 600, y: 450, angle: 0, trail: [] });
  Object.assign(state.players.get('p1')!, { x: 1000, y: 450, angle: 0, trail: [] });
  state.roundStartedTick = state.tick - ROUND_DRAW_TICK + 1;
  const result = step(state, new Map());

  assert.equal(state.phase, 'matchOver');
  assert.equal(state.matchWinnerId, 'p0');
  assert.equal(state.roundWinnerId, undefined);
  assert.ok(result.events.some((event) => event.type === 'roundEnded' && event.winnerId === undefined));
  assert.ok(result.events.some((event) => event.type === 'matchEnded' && event.winnerId === 'p0'));
  assert.deepEqual(state.leaderboard.get('p0'), {
    id: 'p0', name: 'Player 1', totalScoreUnits: 9 * POINT_UNIT,
    roundsPlayed: 2, roundWins: 1, matchWins: 1,
  });
  assert.deepEqual(state.leaderboard.get('p1'), {
    id: 'p1', name: 'Player 2', totalScoreUnits: 7 * POINT_UNIT,
    roundsPlayed: 2, roundWins: 0, matchWins: 0,
  });
});

test('a fixed-rounds leader who also wins the final round is credited exactly once', () => {
  const state = gameWithPlayers();
  state.settings = { ...defaultRoomSettings(), match: 'rounds', length: 2 };
  enterPlaying(state);
  for (let round = 1; round <= 2; round += 1) {
    eliminatePlayer(state, 'p1');
    step(state, new Map());
    if (state.phase !== 'roundOver') break;
    state.tick = state.phaseEndsAtTick!;
    startNextRound(state);
    for (let tick = 0; tick < COUNTDOWN_TICKS; tick += 1) step(state, new Map());
  }

  assert.equal(state.phase, 'matchOver');
  assert.equal(state.matchWinnerId, 'p0');
  assert.deepEqual(state.leaderboard.get('p0'), {
    id: 'p0', name: 'Player 1', totalScoreUnits: 10 * POINT_UNIT,
    roundsPlayed: 2, roundWins: 2, matchWins: 1,
  });
  assert.equal(state.leaderboard.get('p1')!.matchWins, 0);
});

test('a fixed-rounds match tied at the final round ends without a match winner', () => {
  const state = gameWithPlayers();
  state.settings = { ...defaultRoomSettings(), match: 'rounds', length: 2 };
  enterPlaying(state);
  eliminatePlayer(state, 'p1');
  step(state, new Map());
  state.tick = state.phaseEndsAtTick!;
  startNextRound(state);
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick += 1) step(state, new Map());
  eliminatePlayer(state, 'p0');
  const result = step(state, new Map());

  assert.equal(state.phase, 'matchOver');
  assert.equal(state.matchWinnerId, undefined);
  assert.ok(result.events.some((event) => event.type === 'matchEnded' && event.winnerId === undefined));
  assert.ok([...state.leaderboard.values()].every((entry) => entry.matchWins === 0 && entry.roundWins === 1));
});

// The preview reads this flag off the snapshot, so if it stops tracking the room's setting every rider aims with a
// clamped ramp while the simulation still bounces, and the marker lies about where the bomb lands. The ramp maths and
// the settings parser are both well covered; this is the wire hop between them, which nothing else exercises (#182).
test('the snapshot carries the room aim-bounce flag, in both directions and without settings', () => {
  const state = createGame('aim-bounce-wire');
  assert.equal(toSnapshot(state).aimBounce, false, 'a game with no settings yet must not claim the room bounces');
  // defaultRoomSettings() already bounces, so the true case has to come from the settings object to mean anything.
  state.settings = { ...defaultRoomSettings(), aimBounce: true };
  assert.equal(toSnapshot(state).aimBounce, true, 'a room with bouncing on must reach the preview');
  state.settings = { ...defaultRoomSettings(), aimBounce: false };
  assert.equal(toSnapshot(state).aimBounce, false, 'a host who turned bouncing off must reach the preview');
});

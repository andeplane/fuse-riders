import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BOMB_COOLDOWN_TICKS,
  BOMB_FUSE_TICKS,
  BLAST_VISIBLE_TICKS,
  COUNTDOWN_TICKS,
  INITIAL_BOUNDARY_INSET,
  OVERTIME_INSET_PER_TICK,
  OVERTIME_START_TICK,
  ROUND_DRAW_TICK,
  SELF_TRAIL_GRACE_TICKS,
  SLOT_COLORS,
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

function gameWithPlayers(count = 2, matchId = 'match'): GameState {
  const state = createGame(matchId);
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
    x: 700,
    y: 350,
    placedTick: state.tick - BOMB_FUSE_TICKS,
    explodeAtTick: state.tick + 1,
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
  assert.equal(state.phase, 'roundOver');
  assert.equal(state.roundWinnerId, undefined);
  assert.deepEqual(result.events.filter((event) => event.type === 'playerEliminated').map((event) => event.playerId).sort(), ['p0', 'p1']);
  assert.ok(result.events.some((event) => event.type === 'roundEnded' && event.winnerId === undefined));
});

test('bomb input is edge-triggered, capped at one live bomb, chained once, and observes cooldown', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  const owner = state.players.get('p0')!;
  const other = state.players.get('p1')!;
  owner.x = 500; owner.y = 350; owner.angle = 0;
  other.x = 900; other.y = 600;
  let result = step(state, inputs(['p0', { bomb: true }]));
  assert.equal(state.bombs.size, 1);
  const firstBomb = [...state.bombs.values()][0]!;
  assert.equal(firstBomb.explodeAtTick, state.tick + BOMB_FUSE_TICKS);
  assert.equal(owner.bombReadyAtTick, state.tick + BOMB_COOLDOWN_TICKS);
  assert.equal(result.events.filter((event) => event.type === 'bombPlaced').length, 1);

  result = step(state, inputs(['p0', { bomb: true }]));
  assert.equal(state.bombs.size, 1);
  assert.equal(result.events.filter((event) => event.type === 'bombPlaced').length, 0);

  state.bombs.set(77, {
    id: 77,
    ownerId: 'p1',
    x: firstBomb.x + 100,
    y: firstBomb.y,
    placedTick: state.tick,
    explodeAtTick: state.tick + 999,
  });
  firstBomb.explodeAtTick = state.tick + 1;
  result = step(state, inputs(['p0', { bomb: false }]));
  assert.deepEqual(result.events.filter((event) => event.type === 'explosion').map((event) => event.bombId), [firstBomb.id, 77]);
  assert.equal(state.bombs.size, 0);

  result = step(state, inputs(['p0', { bomb: true }]));
  assert.equal(result.events.filter((event) => event.type === 'bombPlaced').length, 0, 'cooldown rejects a fresh edge');
});

test('round wins score once, first to five ends the match, and rematch resets wins and scope', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  for (let win = 1; win <= 5; win += 1) {
    eliminatePlayer(state, 'p1');
    const result = step(state, new Map());
    assert.equal(state.players.get('p0')!.roundWins, win);
    assert.equal(result.events.filter((event) => event.type === 'roundEnded').length, 1);
    if (win < 5) {
      assert.equal(state.phase, 'roundOver');
      state.tick = state.phaseEndsAtTick!;
      startNextRound(state);
      for (let tick = 0; tick < COUNTDOWN_TICKS; tick += 1) step(state, new Map());
    }
  }
  assert.equal(state.phase, 'matchOver');
  assert.equal(state.matchWinnerId, 'p0');
  resetMatch(state, 'rematch');
  assert.equal(state.matchId, 'rematch');
  assert.equal(state.round, 1);
  assert.ok([...state.players.values()].every((player) => player.roundWins === 0));
});

test('overtime inset updates before collision and a 90-second unresolved round draws', () => {
  const shrinking = gameWithPlayers();
  enterPlaying(shrinking);
  shrinking.roundStartedTick = shrinking.tick - OVERTIME_START_TICK;
  step(shrinking, new Map());
  assert.equal(shrinking.boundaryInset, INITIAL_BOUNDARY_INSET + OVERTIME_INSET_PER_TICK);

  const timeout = gameWithPlayers();
  enterPlaying(timeout);
  timeout.players.get('p0')!.x = 400; timeout.players.get('p0')!.y = 250;
  timeout.players.get('p1')!.x = 800; timeout.players.get('p1')!.y = 450;
  timeout.roundStartedTick = timeout.tick - ROUND_DRAW_TICK + 1;
  const result = step(timeout, new Map());
  assert.equal(timeout.phase, 'roundOver');
  assert.equal(timeout.roundWinnerId, undefined);
  assert.ok(result.events.some((event) => event.type === 'roundEnded' && event.winnerId === undefined));
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

  const explosion = gameWithPlayers();
  enterPlaying(explosion);
  const target = explosion.players.get('p0')!;
  target.x = 30; target.y = 350; target.angle = 0;
  explosion.players.get('p1')!.x = 900;
  explosion.players.get('p1')!.y = 600;
  explosion.bombs.set(10, { id: 10, ownerId: 'p1', x: 30, y: 350, placedTick: 0, explodeAtTick: explosion.tick + 1 });
  const blastResult = step(explosion, new Map());
  assert.ok(blastResult.events.some((event) => event.type === 'playerEliminated' && event.playerId === 'p0' && event.cause === 'explosion'));
  assert.equal(explosion.blasts[0]!.rects[0]!.x, explosion.boundaryInset, 'cross is clipped to the active boundary');
  for (let age = 1; age <= BLAST_VISIBLE_TICKS; age += 1) {
    step(explosion, new Map());
    assert.equal(explosion.blasts.length, age < BLAST_VISIBLE_TICKS ? 1 : 0);
  }
});

test('a finished match can replace every seat and start a clean rematch without restarting the server', () => {
  const state = gameWithPlayers();
  enterPlaying(state);
  state.players.get('p0')!.roundWins = 4;
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

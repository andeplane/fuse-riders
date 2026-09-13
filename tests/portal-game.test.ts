import assert from 'node:assert/strict';
import test from 'node:test';
import { addPlayer, createGame, startMatch, startNextRound, step, toSnapshot, COUNTDOWN_TICKS } from '../src/shared/game.ts';
import { controllerSnapshot } from '../src/server/index.ts';

function arena() {
  const state = createGame('portal', 123);
  for (let slot = 0; slot < 3; slot++) addPlayer(state, { id: `p${slot}`, name: `P${slot}`, slot, color: '#fff' });
  startMatch(state);
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick++) step(state, new Map());
  for (const [index, player] of [...state.players.values()].entries()) Object.assign(player, { x: 165 + index * 500, y: 200 + index * 200, angle: 0, trail: [] });
  state.portalPair = { id: 'pair', gates: [{ x: 200, y: 200 }, { x: 1000, y: 300 }], expiresAtTick: state.tick + 200 };
  return state;
}

test('portal transits survivors, breaks trail, preserves heading/charge, counts actual movement', () => {
  const state = arena();
  const player = state.players.get('p0')!;
  player.bombChargeStartedTick = state.tick;
  const beforeDistance = state.matchStats.get('p0')!.distanceUnits;
  step(state, new Map());
  assert.equal(player.x, 1000); assert.equal(player.y, 300); assert.equal(player.angle, 0);
  assert.equal(player.trail.at(-1)!.x2, 169);
  assert.equal(player.portalCooldownUntilTick, state.tick + 15);
  assert.equal(player.portalGraceUntilTick, state.tick + 10);
  assert.equal(state.matchStats.get('p0')!.portalTransits, 1);
  assert.equal(state.matchStats.get('p0')!.distanceUnits - beforeDistance, 4);
  assert.equal(player.bombChargeStartedTick, state.tick - 1);
  step(state, new Map());
  assert.equal(player.trail.at(-1)!.x1, 1000);
  assert.equal(player.x, 1007.5);
});

test('entry collision is resolved before transit, and shield remains independent', () => {
  for (const shielded of [false, true]) {
    const state = arena(); const player = state.players.get('p0')!; player.shielded = shielded;
    state.players.get('p1')!.trail.push({ x1: 168, y1: 100, x2: 168, y2: 250, createdTick: 0, expiresAtTick: 500 });
    step(state, new Map());
    assert.equal(player.alive, shielded);
    assert.equal(state.matchStats.get('p0')!.portalTransits, shielded ? 1 : 0);
    assert.equal(player.shielded, false);
  }
});

test('unsafe exit defers teleport for rider, pending trail, trail, bomb and blast hazards', () => {
  for (const hazard of ['rider', 'pending', 'trail', 'bomb', 'flight', 'blast'] as const) {
    const state = arena(); const other = state.players.get('p1')!;
    if (hazard === 'rider') Object.assign(other, { x: 999, y: 300 });
    if (hazard === 'pending') Object.assign(other, { x: 995, y: 307, angle: Math.PI });
    if (hazard === 'trail') other.trail.push({ x1: 990, y1: 300, x2: 1010, y2: 300, createdTick: 0, expiresAtTick: 500 });
    if (hazard === 'bomb' || hazard === 'flight') state.bombs.set(1, {
      id: 1, ownerId: 'p1', x: hazard === 'bomb' ? 1000 : 1200, y: 300, launchX: 1000, launchY: 300,
      launchedTick: state.tick, landsAtTick: state.tick + 6, placedTick: state.tick, explodeAtTick: 500,
      blastRange: 150, flightPath: [{ x: 1000, y: 300, angle: 0 }],
    });
    if (hazard === 'blast') state.blasts.push({ bombId: 99, ownerId: 'p1', rects: [{ x: 990, y: 290, width: 20, height: 20 }], expiresAtTick: 500 });
    step(state, new Map());
    assert.equal(state.players.get('p0')!.x, 172.5, hazard);
    assert.equal(state.matchStats.get('p0')!.portalTransits, 0, hazard);
  }
});

test('portal grace is defensive for both riders, protects trails/walls and does not consume shield', () => {
  const state = arena(); const player = state.players.get('p0')!; const other = state.players.get('p1')!;
  state.portalPair = undefined;
  player.portalGraceUntilTick = state.tick + 10; player.shielded = true;
  Object.assign(other, { x: 180, y: 200, angle: Math.PI });
  step(state, new Map());
  assert.equal(player.alive, true); assert.equal(other.alive, true); assert.equal(player.shielded, true);
  Object.assign(player, { x: 28, y: 400, angle: Math.PI });
  step(state, new Map());
  assert.equal(player.alive, true); assert.equal(player.x, 27);
});

test('portal expiry, snapshot copying, compact geometry omission and round reset', () => {
  const state = arena(); const snapshot = toSnapshot(state);
  snapshot.portalPair!.gates[0].x = -10;
  assert.equal(state.portalPair!.gates[0].x, 200);
  assert.equal('portalPair' in controllerSnapshot(toSnapshot(state)), false);
  state.portalPair!.expiresAtTick = state.tick + 1;
  step(state, new Map()); assert.equal(state.portalPair, undefined);
  const player = state.players.get('p0')!; player.portalCooldownUntilTick = 900; player.portalGraceUntilTick = 900;
  state.phase = 'roundOver'; startNextRound(state);
  assert.equal(player.portalCooldownUntilTick, 0); assert.equal(player.portalGraceUntilTick, 0);
  assert.equal(state.portalPair, undefined);
});

test('portal pickup creates deterministic pair, records stats, replaces pair without clearing cooldown', () => {
  const states = [arena(), arena()];
  for (const state of states) {
    const player = state.players.get('p0')!; player.portalCooldownUntilTick = 200;
    state.pickups.push({ id: 50, type: 'portal', x: 170, y: 200, expiresAtTick: 500 });
    step(state, new Map());
    assert.equal(state.pickups.length, 0); assert.notEqual(state.portalPair!.id, 'pair');
    assert.equal(player.portalCooldownUntilTick, 200);
    assert.equal(state.matchStats.get('p0')!.portalPickups, 1);
    state.phase = 'matchOver';
    assert.equal(toSnapshot(state).matchStats[0]!.portalPickups, 1);
  }
  assert.deepEqual(states[0]!.portalPair, states[1]!.portalPair);
});

test('impossible placement leaves pickup and old pair unconsumed', () => {
  const state = arena();
  state.width = 350; state.height = 350;
  state.pickups.push({ id: 50, type: 'portal', x: 170, y: 200, expiresAtTick: 500 });
  step(state, new Map());
  assert.equal(state.pickups.length, 1);
  assert.equal(state.portalPair!.id, 'pair');
  assert.equal(state.matchStats.get('p0')!.portalPickups, 0);
});

test('reverse transit respects cooldown at its exact deadline after replacement', () => {
  const state = arena(); const player = state.players.get('p0')!;
  Object.assign(player, { x: 965, y: 300, portalCooldownUntilTick: state.tick + 2 });
  state.portalPair!.id = 'replacement';
  step(state, new Map());
  assert.equal(player.x, 972.5);
  player.x = 965;
  player.trail = [];
  step(state, new Map());
  assert.equal(player.x, 200); assert.equal(player.y, 200);
  assert.equal(state.matchStats.get('p0')!.portalTransits, 1);
});

test('portal defensive grace expires exactly at the authoritative tick', () => {
  for (const remaining of [1, 2]) {
    const state = arena(); const player = state.players.get('p0')!;
    state.portalPair = undefined;
    player.portalGraceUntilTick = state.tick + remaining;
    state.players.get('p1')!.trail.push({ x1: 168, y1: 100, x2: 168, y2: 250, createdTick: 0, expiresAtTick: 500 });
    step(state, new Map());
    assert.equal(player.alive, remaining === 2);
  }
});

test('concurrent riders reserve one linked exit in stable slot order without overlapping', () => {
  const state = arena();
  const first = state.players.get('p0')!;
  const second = state.players.get('p1')!;
  Object.assign(first, { x: 168, y: 185, angle: 0 });
  Object.assign(second, { x: 168, y: 215, angle: 0 });
  step(state, new Map());
  assert.equal(first.alive, true); assert.equal(second.alive, true);
  assert.equal(state.matchStats.get('p0')!.portalTransits, 1);
  assert.equal(state.matchStats.get('p1')!.portalTransits, 0);
  assert.deepEqual({ x: first.x, y: first.y }, { x: 1000, y: 300 });
  assert.deepEqual({ x: second.x, y: second.y }, { x: 175.5, y: 215 });
  assert.ok(Math.hypot(first.x - second.x, first.y - second.y) > 14);
});

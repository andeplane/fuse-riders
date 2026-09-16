import test from 'node:test';
import assert from 'node:assert/strict';
import { addPlayer, createGame, startMatch, startNextRound, step, toSnapshot, SLOT_COLORS, riderMotionStep, TRAIL_WIDTH, RIDER_CONTACT_RADIUS, COUNTDOWN_TICKS, type GameState, type InputIntent } from '../src/shared/game.js';
import { decodeGameState, encodeGameState } from '../src/online/checkpoint.js';
import { presentWorld } from '../src/online/prediction.js';
import { powerLabel } from '../src/client/power-indicator.js';

function playing() {
  const game = createGame('grip', 725);
  for (let slot = 0; slot < 3; slot++) addPlayer(game, { id: `p${slot}`, name: `P${slot}`, slot, color: SLOT_COLORS[slot]! });
  startMatch(game);
  while (game.phase === 'countdown') step(game, new Map());
  game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  for (const p of game.players.values()) Object.assign(p, { x: 400, y: 200 + p.slot * 250, angle: 0, trail: [] });
  return game;
}
function drop(game: GameState, playerId = 'p0') {
  const player = game.players.get(playerId)!;
  const id = game.nextPickupId++;
  game.pickups.push({ id, type: 'grip', x: player.x + 3, y: player.y, expiresAtTick: game.tick + 100 });
  return id;
}
const steering = (right: boolean): InputIntent => ({ left: !right, right, bomb: false });

test('GRIP increases left/right steering by 75% from the next tick without changing travel speed; neutral and cancelled steering stay straight', () => {
  for (const right of [false, true]) {
    const game = playing(), p = game.players.get('p0')!;
    const input = new Map([['p0', steering(right)]]);
    drop(game); step(game, input);
    assert.equal(p.grip, true);
    const plain = riderMotionStep({ boostUntilTick: 0, nitroUntilTicks: [], snailUntilTicks: [], grip: false }, game.tick, game.roundStartedTick).turn;
    const turn = right ? plain : Math.PI * 2 - plain;
    assert.ok(Math.abs(p.angle - turn) < 1e-12, 'collection tick uses ordinary steering');
    const before = { ...p };
    step(game, input);
    const ungripped = riderMotionStep({ boostUntilTick: 0, nitroUntilTicks: [], snailUntilTicks: [], grip: false }, game.tick, game.roundStartedTick);
    assert.ok(Math.abs(Math.abs(p.angle - before.angle) - 1.75 * ungripped.turn) < 1e-12);
    assert.ok(Math.abs(Math.hypot(p.x - before.x, p.y - before.y) - ungripped.distance) < 1e-12);
    for (const controls of [{ left: false, right: false, bomb: false }, { left: true, right: true, bomb: false }]) {
      const angle = p.angle; step(game, new Map([['p0', controls]])); assert.equal(p.angle, angle);
    }
    assert.equal(toSnapshot(game).players[0]!.grip, true);
    assert.equal(game.players.get('p1')!.grip, false);
  }
});

test('repeat GRIP drops remain available, including same-tick duplicates and a nearer ineligible rider', () => {
  const game = playing(), p = game.players.get('p0')!;
  const first = drop(game), second = drop(game);
  const { events } = step(game, new Map());
  assert.equal(p.grip, true);
  assert.deepEqual(game.pickups.map(p => p.id), [second]);
  assert.equal(events.filter(e => e.type === 'pickupCollected' && e.pickupId === first).length, 1);
  assert.equal(events.filter(e => e.type === 'pickupCollected' && e.pickupId === second).length, 0);
  const count = game.matchStats.get(p.id)!.pickupsCollected;
  step(game, new Map());
  assert.equal(game.matchStats.get(p.id)!.pickupsCollected, count);
  assert.equal(game.pickups[0]!.id, second);
  // Both riders touch the next drop; the upgraded rider is closest, but cannot steal/block it.
  const rival = game.players.get('p1')!;
  Object.assign(rival, { x: p.x, y: p.y + 16, angle: 0, trail: [] });
  game.pickups = []; const contested = drop(game);
  const { events: contestedEvents } = step(game, new Map());
  assert.ok(p.alive && rival.alive);
  assert.equal(rival.grip, true);
  assert.ok(contestedEvents.some(e => e.type === 'pickupCollected' && e.pickupId === contested && e.playerId === rival.id));
  assert.equal(game.matchStats.get(p.id)!.pickupsCollected, count);
  assert.equal(game.pickups.length, 0);
});

test('a new round resets steering and lets the same rider collect GRIP again', () => {
  const game = playing(), p = game.players.get('p0')!;
  drop(game); step(game, new Map()); assert.equal(p.grip, true);
  game.phase = 'roundOver'; game.phaseEndsAtTick = game.tick; startNextRound(game);
  assert.equal(p.grip, false);
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick++) step(game, new Map());
  drop(game); step(game, new Map()); assert.equal(p.grip, true);
});

test('GRIP takes the inside of a live rival’s 180-degree turn with real trail/rider collisions in either direction', () => {
  for (const right of [true, false]) {
    const game = playing(), inner = game.players.get('p0')!, outer = game.players.get('p1')!;
    drop(game); step(game, new Map());
    const sign = right ? 1 : -1;
    Object.assign(outer, { x: 500, y: 400, angle: 0, trail: [] });
    Object.assign(inner, { x: 500, y: 400 + sign * 20, angle: 0, trail: [] });
    const innerStart = inner.y, outerStart = outer.y;
    // Thirteen upgraded ticks turn through 182.5 degrees; twenty-two normal ticks turn through 176.5.
    for (let tick = 0; tick < 22; tick++) {
      const input = new Map([['p1', steering(right)]]);
      if (tick < 13) input.set('p0', steering(right));
      step(game, input);
      assert.ok(inner.alive && outer.alive, `both riders survive tick ${tick + 1}`);
      if (tick === 12) {
        const diameter = Math.abs(inner.y - innerStart);
        assert.ok(diameter > 58 && diameter < 64, `tight U-turn spans ${diameter}`);
      }
    }
    const outerDiameter = Math.abs(outer.y - outerStart);
    assert.ok(outerDiameter > 104 && outerDiameter < 110);
    assert.ok((outer.y - inner.y) * sign > TRAIL_WIDTH / 2 + RIDER_CONTACT_RADIUS, 'clearance remains after the maneuver');
    assert.ok(inner.x < outer.x - 50, 'inner rider exits the turn ahead');
  }
});

test('checkpoint restore preserves GRIP steering and pickup eligibility; corrupt flags are rejected', () => {
  const game = playing(); drop(game); step(game, new Map()); drop(game);
  const restored = decodeGameState(encodeGameState(game)); assert.ok(restored);
  for (let tick = 0; tick < 12; tick++) {
    const input = new Map([['p0', steering(true)]]);
    assert.deepEqual(step(restored, input), step(game, input));
    assert.equal(encodeGameState(restored), encodeGameState(game));
  }
  for (const value of ['"yes"', '1', 'null', '{}']) {
    assert.equal(decodeGameState(encodeGameState(game).replace('"grip":true', `"grip":${value}`)), undefined);
  }
});

test('local presentation uses the upgraded steering and the HUD reports GRIP', () => {
  const game = playing(); drop(game); step(game, new Map());
  const snapshot = { ...toSnapshot(game), tick: game.tick, round: game.round };
  const shown = presentWorld(undefined, snapshot, snapshot.tick, { id: 'p0', controls: steering(true), lead: 1 });
  step(game, new Map([['p0', steering(true)]]));
  const p = game.players.get('p0')!, view = shown.players[0]!;
  assert.deepEqual([view.x, view.y, view.angle], [p.x, p.y, p.angle]);
  assert.equal(powerLabel(3, 1, true), '◆ 3 · B×2 · GRIP');
  assert.equal(powerLabel(3, 1, false), '◆ 3 · B×2');
});

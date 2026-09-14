import test from 'node:test';
import assert from 'node:assert/strict';
import { addPlayer, createGame, SLOT_COLORS, startMatch, step, toSnapshot } from '../src/shared/game.js';
import type { ViewSnapshot } from '../src/client/snapshot-stream.js';
import { DirectPresentation, interpolateDirect } from '../src/online/direct-presentation.js';

function frames(): ViewSnapshot[] {
  const game = createGame('presentation', 42);
  for (let slot = 0; slot < 2; slot++) addPlayer(game, { id: `p${slot}`, name: `Rider ${slot}`, slot, color: SLOT_COLORS[slot] });
  startMatch(game); for (let i = 0; i < 65; i++) step(game, new Map());
  const output = [{ ...toSnapshot(game), tick: game.tick, round: game.round }];
  for (let i = 0; i < 3; i++) { step(game, new Map()); output.push({ ...toSnapshot(game), tick: game.tick, round: game.round }); }
  return output;
}

test('interpolation supplies only earlier discrete world geometry and the actual partial rider trail', () => {
  const [a, b] = frames(), before = structuredClone([a, b]);
  const view = interpolateDirect(a, b, a.tick + .5);
  assert.equal(view.players[0].x, (a.players[0].x + b.players[0].x) / 2);
  assert.equal(view.players[0].trail.at(-1)!.x2, view.players[0].x);
  assert.equal(view.players[0].trail.at(-1)!.y2, view.players[0].y);
  assert.deepEqual(view.pickups, a.pickups); assert.deepEqual(view.blasts, a.blasts);
  assert.deepEqual([a, b], before);
  assert.equal(interpolateDirect(a, b, a.tick), a); assert.equal(interpolateDirect(a, b, b.tick), b);
});

test('phase, portal and death discontinuities never expose a future pose or invent a trail chord', () => {
  const [a, b] = frames();
  for (const next of [{ ...b, phase: 'roundOver' as const }, { ...b, round: b.round + 1 }, { ...b, players: b.players.map(p => ({ ...p, x: p.x + 300, portalCooldownUntilTick: b.tick + 10 })) }, { ...b, players: b.players.map(p => ({ ...p, alive: false })) }]) {
    const view = interpolateDirect(a, next, a.tick + .5);
    assert.equal(view.players[0].x, a.players[0].x); assert.deepEqual(view.players[0].trail, a.players[0].trail);
    assert.equal(interpolateDirect(a, next, b.tick), next);
  }
  const noTrail = { ...b, players: b.players.map(p => ({ ...p, trail: [] })) };
  assert.deepEqual(interpolateDirect(a, noTrail, a.tick + .5).players[0].trail, a.players[0].trail);
});

test('adaptive delay is bounded, grows on late executable input and cannot move playback backward', () => {
  const renderer = new DirectPresentation(), history = frames(); let last = -Infinity;
  renderer.render(history, 68.9, 0);
  for (let at = 100; at <= 1000; at += 100) {
    renderer.observe(1, [60], 68);
    const view = renderer.render(history, 68.9, at)!;
    assert.ok(view.tick >= last); last = view.tick;
    assert.ok(renderer.diagnostics.delayMs >= 50 && renderer.diagnostics.delayMs <= 100);
  }
  assert.equal(renderer.diagnostics.delayMs, 100);
  assert.equal(renderer.render([], 1, 1), undefined); assert.equal(renderer.render(history, NaN, 1), undefined);
  assert.equal(renderer.render(history, 70, NaN), undefined);
});

test('quiet traffic retains adverse evidence; only fresh action samples reduce delay, with bounded retention', () => {
  const renderer = new DirectPresentation(), history = frames(); renderer.observe(1, [1], 68); renderer.render(history, 68.9, 0);
  for (let at = 100; at <= 5000; at += 100) renderer.render(history, 68.9, at);
  assert.equal(renderer.diagnostics.delayMs, 100);
  renderer.observe(1, [], 68); renderer.observe(9, [68], 68); renderer.observe(1, [68], NaN);
  assert.equal(renderer.diagnostics.samples, 1);
  renderer.observe(1, Array(40).fill(70), 68); assert.equal(renderer.diagnostics.samples, 32);
  renderer.render(history, 68.9, 5100); assert.ok(renderer.diagnostics.delayMs > 98);
  for (let at = 5200; at <= 10000; at += 100) renderer.render(history, 68.9, at);
  assert.equal(renderer.diagnostics.delayMs, 50);
});

test('replacement history corrects the same previously presented tick; a new segment starts clean', () => {
  const renderer = new DirectPresentation(), history = frames(); renderer.render(history, 68, 0);
  const revised = history.map(f => ({ ...f, players: f.players.map(p => ({ ...p, x: p.x + 5 })) }));
  renderer.render(revised, 68, 16); assert.equal(renderer.diagnostics.correctionDistance, 5);
  renderer.render(revised, 68.5, 32); assert.ok(renderer.diagnostics.correctionDistance < 1e-8);
  const next = new DirectPresentation(); assert.equal(next.diagnostics.samples, 0); assert.equal(next.diagnostics.delayMs, 75);
  assert.equal(next.render([history[0]], 64, 0), history[0]);
  assert.equal(new DirectPresentation().render(history, 100, 0), history.at(-1));
});

test('shell interpolation rejects multiple bounces even when the final velocity matches the initial velocity', () => {
  const [a, b] = frames();
  const shell = { id: 1, ownerId: 'p0', launchX: 100, launchY: 100, x: 100, y: 100, launchedTick: a.tick, landsAtTick: a.tick, flightPath: [], explodeAtTick: a.tick + 20, blastRange: 100, shell: { vx: 450, vy: 0 } };
  const older = { ...a, bombs: [shell] }, straight = { ...b, bombs: [{ ...shell, x: 122.5 }] };
  assert.equal(interpolateDirect(older, straight, a.tick + .5).bombs[0].x, 111.25);
  const bounced = { ...b, bombs: [{ ...shell, x: 102.5 }] };
  assert.equal(interpolateDirect(older, bounced, a.tick + .5).bombs[0].x, 100);
  assert.equal(interpolateDirect(older, bounced, b.tick).bombs[0].x, 102.5);
});

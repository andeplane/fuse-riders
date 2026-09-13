import assert from 'node:assert/strict';
import test from 'node:test';
import { ControllerInputState, type ControllerInputMessage } from '../src/client/controller-state.js';
import { renderedSnapshot, type SnapshotFrame } from '../src/client/render-snapshot.js';
import { SnapshotStream } from '../src/client/snapshot-stream.js';
import type { GameSnapshot } from '../src/shared/protocol.js';

function snapshot(): GameSnapshot {
  return { phase: 'lobby', width: 1600, height: 900, boundaryInset: 20, players: [], bombs: [], blasts: [], pickups: [], leaderboard: [], roundPlacements: [], matchStats: [] };
}

function playingFrame(tick: number, receivedAt: number, x: number, alive = true): SnapshotFrame {
  return {
    matchId: 'match', round: 1, receivedAt,
    snapshot: {
      ...snapshot(), phase: 'playing', tick, round: 1, roundStartedTick: 0,
      players: [{ id: 'p1', name: 'One', slot: 0, color: '#00d9ff', connected: true, x, y: 100, angle: 0, alive, roundWins: 0, bombReadyAtTick: 0, trail: [], blastLevel: 0, invulnerableUntilTick: 0, drunkUntilTick: 0, tripleShotArmed: false, fiveShotArmed: false,  shielded: false, shieldGraceUntilTick: 0, portalCooldownUntilTick: 0, portalGraceUntilTick: 0 }],
    },
  };
}

test('visual projection uses authoritative tick spacing during packet bursts', () => {
  const frames = [playingFrame(10, 100, 100), playingFrame(12, 101, 115)];
  const projected = renderedSnapshot(frames, 151)!;
  assert.equal(projected.players[0]!.x, 122.5, 'two-tick velocity projects at most one 7.5-unit step');
});

test('visual projection freezes after 50 ms and never projects death or non-playing phases', () => {
  const frames = [playingFrame(10, 100, 100), playingFrame(11, 150, 107.5)];
  assert.equal(renderedSnapshot(frames, 1_000)!.players[0]!.x, 115);
  const dead = [frames[0]!, playingFrame(11, 150, 107.5, false)];
  assert.equal(renderedSnapshot(dead, 200)!.players[0]!.x, 107.5);
  const lobby = playingFrame(11, 150, 107.5); lobby.snapshot.phase = 'lobby';
  assert.equal(renderedSnapshot([frames[0]!, lobby], 200), lobby.snapshot);
});

test('visual projection does not cross round, match, membership or timestamp boundaries', () => {
  assert.equal(renderedSnapshot([], 0), undefined);
  const first = playingFrame(10, 100, 100);
  assert.equal(renderedSnapshot([first], 200), first.snapshot);
  const next = playingFrame(11, 150, 107.5);
  for (const altered of [
    { ...next, matchId: 'another' },
    { ...next, round: 2 },
    playingFrame(10, 150, 107.5),
  ]) assert.equal(renderedSnapshot([first, altered], 200), altered.snapshot);
  assert.equal(renderedSnapshot([first, next], 150), next.snapshot);
  const countdown = { ...first, snapshot: { ...first.snapshot, phase: 'countdown' as const } };
  assert.equal(renderedSnapshot([countdown, next], 200), next.snapshot);
  for (const previous of [
    { ...first, snapshot: { ...first.snapshot, players: [] } },
    playingFrame(10, 100, 100, false),
  ]) assert.equal(renderedSnapshot([previous, next], 200)!.players[0], next.snapshot.players[0]);
});

test('visual projection snaps a portal transit and resumes on the next ordinary movement pair', () => {
  const before = playingFrame(10, 100, 100);
  const transitBase = playingFrame(11, 150, 600);
  const transit: SnapshotFrame = { ...transitBase, snapshot: { ...transitBase.snapshot, players: transitBase.snapshot.players.map((player) => ({ ...player, portalCooldownUntilTick: 26 })) } };
  assert.equal(renderedSnapshot([before, transit], 200)!.players[0]!.x, 600, 'teleport displacement is never extrapolated');
  const afterBase = playingFrame(12, 200, 607.5);
  const after: SnapshotFrame = { ...afterBase, snapshot: { ...afterBase.snapshot, players: afterBase.snapshot.players.map((player) => ({ ...player, portalCooldownUntilTick: 26 })) } };
  assert.equal(renderedSnapshot([transit, after], 250)!.players[0]!.x, 615, 'normal projection resumes after the transit frame');
});

test('multitouch retains a control until its final pointer releases', () => {
  const messages: ControllerInputMessage[] = [];
  const state = new ControllerInputState({ send: (message) => { messages.push(message); return true; } });
  state.setNextSequence(7);
  state.pointerDown(1, 'left');
  state.pointerDown(2, 'left');
  state.pointerDown(3, 'right');
  state.pointerRelease(1);
  state.pointerRelease(2);
  assert.deepEqual(messages, [
    { type: 'input', seq: 7, left: true, right: false, bomb: false },
    { type: 'input', seq: 8, left: true, right: true, bomb: false },
    { type: 'input', seq: 9, left: false, right: true, bomb: false },
  ]);
});

test('fast bomb tap and cancellation always send the falling edge', () => {
  const messages: ControllerInputMessage[] = [];
  const state = new ControllerInputState({ send: (message) => { messages.push(message); return true; } });
  state.pointerDown(20, 'bomb');
  state.pointerRelease(20);
  state.pointerDown(21, 'bomb');
  state.clear();
  assert.deepEqual(messages.map(({ bomb }) => bomb), [true, false, true, false]);
  assert.deepEqual(messages.map(({ bombAction }) => bombAction), ['press', 'release', 'press', 'cancel']);
  assert.deepEqual(messages.map(({ seq }) => seq), [0, 1, 2, 3]);
});

test('pointer cancellation never launches and lost capture after release is a no-op', () => {
  const messages: ControllerInputMessage[] = [];
  const state = new ControllerInputState({ send: (message) => { messages.push(message); return true; } });
  state.pointerDown(7, 'bomb');
  state.resend();
  state.pointerCancel(7);
  assert.equal(state.pointerCancel(7), false);
  state.pointerDown(8, 'bomb');
  state.pointerRelease(8);
  assert.equal(state.pointerCancel(8), false);
  assert.deepEqual(messages.map(({ bombAction }) => bombAction), ['press', undefined, 'cancel', 'press', 'release']);
});

test('reconnect can force a neutral sample to rearm bomb edges', () => {
  const messages: ControllerInputMessage[] = [];
  const state = new ControllerInputState({ send: (message) => { messages.push(message); return true; } });
  state.setNextSequence(42);
  state.clear(true, true);
  assert.deepEqual(messages, [{ type: 'input', seq: 42, left: false, right: false, bomb: false }]);
});

test('held-state resend advances sequence while idle resend stays silent', () => {
  const messages: ControllerInputMessage[] = [];
  const state = new ControllerInputState({ send: (message) => { messages.push(message); return true; } });
  assert.equal(state.resend(), false);
  state.pointerDown(1, 'right');
  assert.equal(state.isHeld('right'), true);
  assert.equal(state.resend(), true);
  state.clear(false);
  assert.equal(state.isHeld('right'), false);
  assert.equal(state.hasHeld(), false);
  assert.equal(state.resend(), false);
  assert.deepEqual(messages, [
    { type: 'input', seq: 0, left: false, right: true, bomb: false },
    { type: 'input', seq: 1, left: false, right: true, bomb: false },
  ]);
});

test('snapshot acceptance handles opaque match ids without lexicographic ordering', () => {
  const stream = new SnapshotStream();
  assert.ok(stream.accept({ matchId: 'ffff', round: 1, tick: 30, state: snapshot() }));
  assert.deepEqual(stream.scope, { matchId: 'ffff', round: 1, tick: 30 });
  assert.ok(stream.accept({ matchId: 'ffff', round: 1, tick: 30, state: snapshot() }), 'same-tick resync is accepted');
  assert.equal(stream.accept({ matchId: 'ffff', round: 1, tick: 29, state: snapshot() }), undefined);
  assert.deepEqual(stream.scope, { matchId: 'ffff', round: 1, tick: 30 }, 'rejected frame cannot rewind scope');
  assert.ok(stream.accept({ matchId: '0000', round: 1, tick: 1, state: snapshot() }));
  assert.deepEqual(stream.scope, { matchId: '0000', round: 1, tick: 1 });
  assert.equal(stream.accept({ matchId: 'ffff', round: 99, tick: 999, state: snapshot() }), undefined);
});

test('snapshot acceptance rejects an older round in the active match', () => {
  const stream = new SnapshotStream();
  assert.ok(stream.accept({ matchId: 'match', round: 2, tick: 100, state: snapshot() }));
  assert.equal(stream.accept({ matchId: 'match', round: 1, tick: 101, state: snapshot() }), undefined);
  assert.ok(stream.accept({ matchId: 'match', round: 3, tick: 1, state: snapshot() }));
});

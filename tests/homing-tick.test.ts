import assert from 'node:assert/strict';
import test from 'node:test';
import { addPlayer, createGame, startMatch, step, COUNTDOWN_TICKS } from '../src/shared/game.ts';

test('Homing Spark captures committed same-tick target position in either slot order', () => {
  for (const launcherSlot of [0, 1]) {
    const state = createGame('homing-tick');
    addPlayer(state, { id: 'launcher', name: 'Launcher', slot: launcherSlot, color: '#fff' });
    addPlayer(state, { id: 'target', name: 'Target', slot: 1 - launcherSlot, color: '#000' });
    startMatch(state);
    for (let tick = 0; tick < COUNTDOWN_TICKS; tick++) step(state, new Map());
    const launcher = state.players.get('launcher')!;
    const target = state.players.get('target')!;
    Object.assign(launcher, { x: 500, y: 400, angle: 0, homingArmed: true, trail: [] });
    Object.assign(target, { x: 800, y: 400, angle: Math.PI / 2, trail: [] });
    step(state, new Map([['launcher', { left: false, right: false, bomb: false, bombActions: ['press', 'release'] }]]));
    const bomb = [...state.bombs.values()][0]!;
    assert.equal(bomb.homingTargetX, target.x);
    assert.equal(bomb.homingTargetY, target.y);
    assert.equal(target.y, 407.5);
  }
});

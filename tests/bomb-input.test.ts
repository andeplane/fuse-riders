import assert from 'node:assert/strict';
import test from 'node:test';
import { BombInputBuffer, MAX_PENDING_BOMB_ACTIONS } from '../src/server/bomb-input.js';

test('ordered bomb edges survive a between-tick tap, while held resends do not repeat presses', () => {
  const buffer = new BombInputBuffer();
  buffer.accept(true, 'press'); buffer.accept(true); buffer.accept(true, 'press');
  buffer.accept(false, 'release'); buffer.accept(false, 'release');
  assert.deepEqual(buffer.drain(), ['press', 'release']);
  assert.deepEqual(buffer.drain(), []);
});

test('interruption discards even a queued release and requires a neutral handshake', () => {
  const buffer = new BombInputBuffer();
  buffer.accept(true, 'press'); buffer.accept(false, 'release'); buffer.cancel(true);
  buffer.accept(true, 'press');
  assert.deepEqual(buffer.drain(), ['cancel']);
  buffer.accept(false); buffer.accept(true, 'press');
  assert.deepEqual(buffer.drain(), ['cancel', 'press']);
  buffer.accept(false, 'cancel');
  assert.deepEqual(buffer.drain(), ['cancel']);
  buffer.accept(true, 'press'); buffer.accept(false);
  assert.deepEqual(buffer.drain(), ['cancel'], 'unmarked neutral input cannot launch');
});

test('overflow cancels the bounded queue and a later fresh press can recover', () => {
  const buffer = new BombInputBuffer();
  for (let index = 0; index < MAX_PENDING_BOMB_ACTIONS / 2; index++) {
    buffer.accept(true, 'press'); buffer.accept(false, 'release');
  }
  buffer.accept(true, 'press');
  assert.deepEqual(buffer.drain(), ['cancel']);
  buffer.accept(false, 'release');
  assert.deepEqual(buffer.drain(), []);
  buffer.accept(true, 'press');
  assert.deepEqual(buffer.drain(), ['press']);
});

test('target input preserves per-release aim despite later packets and caller mutation', () => {
  const buffer = new BombInputBuffer();
  const first = { x: .1, y: .2 };
  buffer.accept(true, 'press', first); first.x = 1;
  buffer.accept(true, undefined, { x: .3, y: .4 });
  buffer.accept(false, 'release', { x: .5, y: .6 });
  buffer.accept(true, 'press', { x: .7, y: .8 });
  assert.deepEqual(buffer.drainCommands(), [
    { action: 'press', aim: { x: .1, y: .2 } }, { action: 'release', aim: { x: .5, y: .6 } }, { action: 'press', aim: { x: .7, y: .8 } },
  ]);
  buffer.accept(false, 'release'); assert.deepEqual(buffer.drainCommands(), [{ action: 'release', aim: { x: .7, y: .8 } }]);
  buffer.accept(true, 'press'); assert.deepEqual(buffer.drainCommands(), [{ action: 'press' }]);
  buffer.cancel(); assert.deepEqual(buffer.drainCommands(), [{ action: 'cancel' }]);
});

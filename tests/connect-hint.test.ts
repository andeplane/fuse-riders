import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectHint } from '../src/online/connect-hint.js';

test('connect hint escalates from progress to the network advice', () => {
  assert.equal(connectHint('Connecting…', 0), 'Warming up the arena…');
  assert.equal(connectHint('Connecting…', 7000), 'Still reaching the host…');
  assert.match(connectHint('Connecting…', 21000), /different network/);
  assert.match(connectHint('ICE failed — likely symmetric NAT/CGNAT on one side', 1000), /different network/);
});

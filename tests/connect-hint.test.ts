import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectHint } from '../src/online/connect-hint.js';

test('connect hint escalates from progress to the network advice', () => {
  assert.equal(connectHint('Connecting…', 0), 'Warming up the arena…');
  assert.equal(connectHint('Connecting…', 7000), 'Still reaching the host…');
  assert.match(connectHint('Connecting…', 21000), /different network/);
  assert.match(connectHint('ICE failed — likely symmetric NAT/CGNAT on one side', 1000), /different network/);
});

test('a status that already says what to do wins over the network guess', () => {
  for (const status of ['Game protocol changed — reload this page', 'This host tab was replaced — use the newer tab', 'Saved game is incompatible or damaged — a fresh lobby is ready'])
    assert.equal(connectHint(status, 60000), status);
});

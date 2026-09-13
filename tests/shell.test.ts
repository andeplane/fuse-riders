import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceShell } from '../src/shared/shell.js';
const bounds = { left: 0, right: 100, top: 0, bottom: 100 };
test('shell reflects remaining travel and exposes the true collision path', () => {
  const shell = { x: 95, y: 50, vx: 400, vy: 0 };
  const path = advanceShell(shell, bounds);
  assert.deepEqual(shell, { x: 85, y: 50, vx: -400, vy: 0 });
  assert.deepEqual(path.map(p => [p.x, p.y, p.t]), [[95,50,0],[100,50,.25],[85,50,1]]);
});
test('corners reflect both axes and shrinking bounds clamp safely', () => {
  const shell = { x: 95, y: 95, vx: 400, vy: 400 };
  advanceShell(shell, bounds);
  assert.deepEqual(shell, { x: 85, y: 85, vx: -400, vy: -400 });
  shell.x = 120; shell.vx = 400; advanceShell(shell, bounds);
  assert.equal(shell.x, 80); assert.equal(shell.vx, -400);
});

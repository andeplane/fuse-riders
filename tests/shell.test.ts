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

test('shell ricochets off a tail without crossing it and keeps its speed', () => {
  const shell = { x: 30, y: 50, vx: 400, vy: 0 };
  const trail = { x1: 60, y1: 10, x2: 60, y2: 90 };
  const path = advanceShell(shell, bounds, [trail]);
  assert.ok(Math.abs(shell.x - 36) < .00001); assert.equal(shell.vx, -400);
  assert.ok(path.every(point => point.x <= 43 + .00001));
  assert.deepEqual(trail, { x1: 60, y1: 10, x2: 60, y2: 90 });
  advanceShell(shell, bounds, [trail]); assert.ok(shell.x < 36, 'does not stick on repeated contact');
});
test('diagonal tails and exposed endpoints reflect instead of tunnelling', () => {
  const diagonal = { x: 40, y: 30, vx: 400, vy: 0 };
  advanceShell(diagonal, bounds, [{ x1: 50, y1: 0, x2: 90, y2: 40 }]);
  assert.ok(Math.abs(Math.hypot(diagonal.vx, diagonal.vy) - 400) < 1e-8);
  assert.ok(Math.abs(diagonal.vy) > 300);
  const end = { x: 30, y: 50, vx: 400, vy: 0 };
  advanceShell(end, bounds, [{ x1: 60, y1: 60, x2: 60, y2: 90 }]);
  assert.ok(end.vy < 0, 'round endpoint deflects the shell');
});

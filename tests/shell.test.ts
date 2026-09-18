import test from "node:test";
import assert from "node:assert/strict";
import { advanceShell } from "../src/shared/shell.js";
const bounds = { left: 0, right: 100, top: 0, bottom: 100 };
test("shell reflects remaining travel and exposes the true collision path", () => {
  const shell = { x: 95, y: 50, vx: 400, vy: 0 };
  const path = advanceShell(shell, bounds);
  assert.deepEqual(shell, { x: 85, y: 50, vx: -400, vy: 0 });
  assert.deepEqual(
    path.map((p) => [p.x, p.y, p.t]),
    [
      [95, 50, 0],
      [100, 50, 0.25],
      [85, 50, 1],
    ],
  );
});
test("a carried bounce count grows on wall, corner and trail contact and is never invented", () => {
  const wall = { x: 95, y: 50, vx: 400, vy: 0, bounces: 0 };
  advanceShell(wall, bounds);
  assert.equal(wall.bounces, 1);
  const corner = { x: 95, y: 95, vx: 400, vy: 400, bounces: 3 };
  advanceShell(corner, bounds);
  assert.equal(corner.bounces, 5);
  const trail = { x: 30, y: 50, vx: 400, vy: 0, bounces: 0 };
  advanceShell(trail, bounds, [{ x1: 60, y1: 10, x2: 60, y2: 90 }]);
  assert.equal(trail.bounces, 1);
  const straight = { x: 10, y: 50, vx: 400, vy: 0, bounces: 0 };
  advanceShell(straight, bounds);
  assert.equal(straight.bounces, 0);
  const uncounted: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    bounces?: number;
  } = { x: 95, y: 50, vx: 400, vy: 0 };
  advanceShell(uncounted, bounds);
  assert.equal(
    "bounces" in uncounted,
    false,
    "a projection without the field never gains one",
  );
});
test("corners reflect both axes and shrinking bounds clamp safely", () => {
  const shell = { x: 95, y: 95, vx: 400, vy: 400 };
  advanceShell(shell, bounds);
  assert.deepEqual(shell, { x: 85, y: 85, vx: -400, vy: -400 });
  shell.x = 120;
  shell.vx = 400;
  advanceShell(shell, bounds);
  assert.equal(shell.x, 80);
  assert.equal(shell.vx, -400);
});

test("shell ricochets off a tail without crossing it and keeps its speed", () => {
  const shell = { x: 30, y: 50, vx: 400, vy: 0 };
  const trail = { x1: 60, y1: 10, x2: 60, y2: 90 };
  const path = advanceShell(shell, bounds, [trail]);
  assert.ok(Math.abs(shell.x - 36) < 0.00001);
  assert.equal(shell.vx, -400);
  assert.ok(path.every((point) => point.x <= 43 + 0.00001));
  assert.deepEqual(trail, { x1: 60, y1: 10, x2: 60, y2: 90 });
  advanceShell(shell, bounds, [trail]);
  assert.ok(shell.x < 36, "does not stick on repeated contact");
});
test("diagonal tails and exposed endpoints reflect instead of tunnelling", () => {
  const diagonal = { x: 40, y: 30, vx: 400, vy: 0 };
  advanceShell(diagonal, bounds, [{ x1: 50, y1: 0, x2: 90, y2: 40 }]);
  assert.ok(Math.abs(Math.hypot(diagonal.vx, diagonal.vy) - 400) < 1e-8);
  assert.ok(Math.abs(diagonal.vy) > 300);
  const end = { x: 30, y: 50, vx: 400, vy: 0 };
  advanceShell(end, bounds, [{ x1: 60, y1: 60, x2: 60, y2: 90 }]);
  assert.ok(end.vy < 0, "round endpoint deflects the shell");
});

test("solid surfaces use their own radius, not trail width, for circle and rectangle contact", () => {
  const arena = { left: 0, right: 1000, top: 0, bottom: 1000 };
  const rock = { x1: 500, y1: 500, x2: 500, y2: 500, radius: 50 };
  const shell = { x: 430, y: 500, vx: 450, vy: 0, bounces: 0 };
  const path = advanceShell(shell, arena, [rock], 100);
  assert.ok(
    Math.abs(path[1]!.x - 436) < 1e-9,
    "rock radius 50 plus shell radius 14",
  );
  assert.equal(shell.bounces, 1);
  assert.equal(shell.vx, -450);
  const corner = { x: 540, y: 550, vx: 450, vy: 0, bounces: 0 };
  advanceShell(corner, arena, [rock]);
  assert.equal(corner.bounces, 0, "the square corner around a rock is empty");
  const wall = { x1: 500, y1: 400, x2: 500, y2: 600, radius: 0 };
  const shot = { x: 480, y: 500, vx: 450, vy: 0, bounces: 0 };
  const contact = advanceShell(shot, arena, [wall], 100);
  assert.equal(contact[1]!.x, 486, "a solid wall has no trail thickness");
  assert.equal(shot.bounces, 1);
});

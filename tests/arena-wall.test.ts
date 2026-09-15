import assert from 'node:assert/strict';
import test from 'node:test';
import { TRAIL_STUD_SPACING, pixelWall, smoothWallRect, trailStuds } from '../src/client/arena-wall.js';
import { themes } from '../src/client/themes.js';

test('the two themes still describe different arena walls', () => {
  // #68 flattened both renderers to one thin rim; if these ever match again, the modes look identical.
  assert.notEqual(themes['neon-pixel'].rendering.pixelated, themes['clean-neon'].rendering.pixelated);
  assert.notEqual(themes['neon-pixel'].rendering.gridSize, themes['clean-neon'].rendering.gridSize);
});

test('pixel bricks line all four edges inside the boundary', () => {
  const w = 1200, h = 700, inset = 24;
  const { bricks, brackets, studs } = pixelWall(w, h, inset);
  assert.ok(bricks.length > 4, 'expected a brick run per edge');
  assert.equal(brackets.length, 4);
  assert.equal(studs.length, 4);
  for (const brick of bricks) {
    assert.ok(brick.width > 1 && brick.height > 1, 'degenerate bricks are dropped');
    assert.ok(brick.x >= 0 && brick.y >= 0, `brick off the canvas: ${JSON.stringify(brick)}`);
    assert.ok(brick.x + brick.width <= w && brick.y + brick.height <= h, `brick past the canvas: ${JSON.stringify(brick)}`);
  }
  // Every brick sits in the boundary band, never over the playfield the riders use.
  const playfield = { x1: inset, y1: inset, x2: w - inset, y2: h - inset };
  for (const brick of bricks) {
    const inside = brick.x + brick.width > playfield.x1 && brick.x < playfield.x2 &&
      brick.y + brick.height > playfield.y1 && brick.y < playfield.y2;
    assert.equal(inside, false, `brick overlaps the playfield: ${JSON.stringify(brick)}`);
  }
});

test('a tiny board still yields drawable geometry', () => {
  const wall = pixelWall(90, 60, 6);
  for (const brick of wall.bricks) assert.ok(brick.width > 1 && brick.height > 1);
  const rect = smoothWallRect(90, 60, 6);
  assert.ok(rect.width > 0 && rect.height > 0);
});

test('the smooth wall sits outside the rim', () => {
  const rect = smoothWallRect(1200, 700, 24);
  assert.ok(rect.x < 24 && rect.y < 24);
  assert.equal(rect.width, 1200 - rect.x * 2);
});

test('trail studs keep even spacing across segment seams', () => {
  // Three touching 10-unit segments: spacing must not restart at each seam.
  const path = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }];
  const studs = trailStuds(path, 5);
  assert.deepEqual(studs.map(s => s.x), [0, 5, 10, 15, 20, 25, 30]);
  assert.ok(studs.every(s => s.y === 0));
});

test('trail studs ignore zero-length and single-point paths', () => {
  assert.deepEqual(trailStuds([{ x: 4, y: 4 }]), []);
  assert.deepEqual(trailStuds([{ x: 4, y: 4 }, { x: 4, y: 4 }]), []);
  assert.equal(trailStuds([{ x: 0, y: 0 }, { x: TRAIL_STUD_SPACING * 3, y: 0 }]).length, 4);
});

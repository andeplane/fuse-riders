import test from "node:test";
import assert from "node:assert/strict";
import {
  crossViews,
  quarterTurnView,
  uprightOffset,
} from "../src/render/arena-views.js";

test("rotated crossed cameras tile odd-sized backing pixels and preserve each quarter", () => {
  const views = crossViews(1600, 900, 1001, 563);
  const turned = views.map((view) => quarterTurnView(view, 563, 563 / 900));
  assert.equal(
    turned.reduce((area, view) => area + view.width * view.height, 0),
    1001 * 563,
  );
  for (const [index, view] of turned.entries()) {
    const original = views[index]!;
    assert.equal(view.x + view.width, 563 - original.y);
    assert.equal(view.y, original.x);
    // A point at the centre of each source view must land at the centre of the rotated viewport.
    const x = original.scrollX + original.width / 2 / (1001 / 1600);
    const y = original.scrollY + original.height / 2 / (563 / 900);
    assert.ok(
      Math.abs(-(y - view.scrollY) * (563 / 900) - view.width / 2) < 1e-8,
    );
    assert.ok(
      Math.abs((x - view.scrollX) * (1001 / 1600) - view.height / 2) < 1e-8,
    );
  }
});

test("upright labels preserve their above/right offsets after a clockwise world rotation", () => {
  assert.deepEqual(uprightOffset(200, 300, 20, -30, false), { x: 220, y: 270 });
  const point = uprightOffset(200, 300, 20, -30, true);
  assert.deepEqual(point, { x: 170, y: 280 });
  assert.deepEqual(
    { x: -(point.y - 300), y: point.x - 200 },
    { x: 20, y: -30 },
  );
});

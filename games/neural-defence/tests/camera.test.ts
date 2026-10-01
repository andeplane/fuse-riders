import test from "node:test";
import assert from "node:assert/strict";
import {
  createCameraModel,
  EDGE_ZONE,
  MAX_SCALE,
  SCREEN_EDGE,
  edgeAxes,
  scrollDirection,
  type PanDirection,
} from "../src/render/camera.js";

const world = { width: 768, height: 648 };
const insets = { top: 52, right: 12, bottom: 154, left: 12 };

test("large arenas start at readable unit scale on desktop and phones", () => {
  for (const size of [
    { width: 1840, height: 1030 },
    { width: 390, height: 844 },
  ]) {
    const camera = createCameraModel(
      { width: 1500, height: 1100 },
      size,
      insets,
    );
    const scale = size.width / camera.view().width;
    assert.ok(scale >= 1.1, "a 72-unit brain must remain at least 79px wide");
    camera.zoom(0.001);
    assert.ok(size.width / camera.view().width >= 1.1 - 1e-9);
    assert.ok(camera.view().width <= 1500 + 1e-9);
    assert.ok(camera.view().height <= 1100 + 1e-9);
  }
});

test("zoom-out and resize keep the battlefield filling desktop and phone viewports", () => {
  for (const size of [
    { width: 1440, height: 900 },
    { width: 900, height: 1100 },
  ]) {
    const camera = createCameraModel(world, size, insets);
    const initial = camera.view();
    assert.ok(initial.width <= world.width + 0.001);
    assert.ok(initial.height <= world.height + 0.001);
    assert.ok(
      Math.abs(initial.width / initial.height - size.width / size.height) <
        1e-8,
    );
    camera.zoom(0.0001);
    assert.ok(camera.view().width <= world.width + 0.001);
    assert.ok(camera.view().height <= world.height + 0.001);
    for (const next of [
      { width: 390, height: 700 },
      { width: 1840, height: 800 },
      { width: 568, height: 180 },
    ]) {
      camera.resize(next);
      camera.zoom(0.0001);
      assert.ok(camera.view().width <= world.width + 0.001);
      assert.ok(camera.view().height <= world.height + 0.001);
      assert.ok(next.width / camera.view().width >= 1.1);
    }
  }
});

test("zoom preserves the map point beneath the pointer and panning is bounded", () => {
  const size = { width: 900, height: 700 };
  const camera = createCameraModel(world, size, insets);
  const anchor = { x: 450, y: 350 };
  const before = camera.view();
  const point = {
    x: before.x + (anchor.x * before.width) / size.width,
    y: before.y + (anchor.y * before.height) / size.height,
  };
  camera.zoom(2, anchor);
  const after = camera.view();
  assert.equal(after.x + (anchor.x * after.width) / size.width, point.x);
  assert.equal(after.y + (anchor.y * after.height) / size.height, point.y);
  camera.pan(1e9, -1e9);
  const bounded = camera.view();
  assert.ok(bounded.x > -world.width && bounded.y < world.height);
  camera.zoom(NaN);
  assert.deepEqual(camera.view(), bounded);
});

test("keyboard-selected edge cells remain accessible above the bottom HUD after resize", () => {
  const camera = createCameraModel(world, { width: 1440, height: 900 }, insets);
  camera.resize({ width: 900, height: 1100 });
  const target = { x: 720, y: 610 };
  camera.ensureVisible(target);
  const view = camera.view();
  const scale = 900 / view.width;
  assert.ok((target.x - view.x) * scale < 900 - insets.right);
  assert.ok((target.y - view.y) * scale < 1100 - insets.bottom);
  camera.resize({ width: 1200, height: 800 });
  camera.ensureVisible(target);
  const resized = camera.view();
  assert.ok(
    ((target.y - resized.y) * 1200) / resized.width <=
      800 - insets.bottom + 0.001,
  );
});

test("zoom-in stops at a scale that still shows the battle around a building", () => {
  const camera = createCameraModel(
    { width: 1500, height: 1200 },
    { width: 1200, height: 800 },
    { top: 0, right: 0, bottom: 0, left: 0 },
  );
  camera.zoom(1000, { x: 600, y: 400 });
  assert.equal(1200 / camera.view().width, MAX_SCALE);
  camera.zoom(0.5, { x: 600, y: 400 });
  assert.equal(1200 / camera.view().width, MAX_SCALE / 2);
});

test("held arrows and the board's edges choose a unit scroll direction", () => {
  const size = { width: 800, height: 600 };
  const board = { left: 0, top: 0, ...size };
  const held = (...d: PanDirection[]) => new Set<PanDirection>(d);
  const edge = (x: number, y: number) => edgeAxes({ x, y }, board, null);
  assert.equal(scrollDirection(held()), null);
  assert.equal(scrollDirection(held(), edge(400, 300)), null);
  assert.deepEqual(scrollDirection(held("right")), { x: 1, y: 0 });
  assert.equal(scrollDirection(held("left", "right")), null);
  const diagonal = scrollDirection(held("up", "left"))!;
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-9);
  assert.ok(diagonal.x < 0 && diagonal.y < 0);
  assert.deepEqual(scrollDirection(held(), edge(EDGE_ZONE - 1, 300)), {
    x: -1,
    y: 0,
  });
  assert.deepEqual(scrollDirection(held(), edge(400, size.height - 2)), {
    x: 0,
    y: 1,
  });
  assert.deepEqual(edgeAxes(null, board, size), { x: 0, y: 0 });
});

test("edge scrolling reaches every side of the screen, over the HUD too", () => {
  // A 1280×800 window: top bar to y 56, command dock from y 616, board between.
  const screen = { width: 1280, height: 800 };
  const board = { left: 12, top: 56, width: 1256, height: 560 };
  const at = (x: number, y: number) => edgeAxes({ x, y }, board, screen);
  // The last pixel row and column, and the first, over the top bar and dock.
  assert.deepEqual(at(640, 0), { x: 0, y: -1 }, "top bar, top pixel row");
  assert.deepEqual(at(640, 799), { x: 0, y: 1 }, "dock, last pixel row");
  assert.deepEqual(at(0, 700), { x: -1, y: 0 }, "dock, first column");
  assert.deepEqual(at(1279, 30), { x: 1, y: 0 }, "top bar, last column");
  assert.deepEqual(at(1279, 799), { x: 1, y: 1 }, "bottom-right corner");
  assert.deepEqual(at(1279.5, 800), { x: 1, y: 1 }, "fractional and past the edge");
  assert.deepEqual(
    at(640, screen.height - SCREEN_EDGE),
    { x: 0, y: 1 },
    "the whole outer band counts",
  );
  // Inside the HUD away from the outer pixels, the camera stays put, so
  // buttons near the board can be used.
  assert.deepEqual(at(640, 30), { x: 0, y: 0 }, "top bar");
  assert.deepEqual(at(640, 700), { x: 0, y: 0 }, "dock");
  assert.deepEqual(at(640, 799 - SCREEN_EDGE), { x: 0, y: 0 });
  // The board's own edges still scroll before the screen's.
  assert.deepEqual(at(640, board.top + 2), { x: 0, y: -1 });
  assert.deepEqual(at(640, board.top + board.height - 2), { x: 0, y: 1 });
  assert.deepEqual(at(board.left + 2, 300), { x: -1, y: 0 });
  assert.deepEqual(at(640, 300), { x: 0, y: 0 });
});

test("scrolling moves the view the same way and stops at the map's edge", () => {
  const camera = createCameraModel(
    { width: 3000, height: 2000 },
    { width: 1200, height: 800 },
    { top: 0, right: 0, bottom: 0, left: 0 },
  );
  camera.focus({ x: 1500, y: 1000 });
  const before = camera.view();
  camera.scroll(100, 50);
  const after = camera.view();
  assert.ok(after.x > before.x && after.y > before.y);
  camera.scroll(1e6, 1e6);
  const edge = camera.view();
  camera.scroll(1e6, 1e6);
  assert.deepEqual(camera.view(), edge, "clamped at the far corner");
});

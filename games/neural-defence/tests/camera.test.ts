import test from "node:test";
import assert from "node:assert/strict";
import { createCameraModel } from "../src/render/camera.js";

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
    assert.ok(size.width / camera.view().width >= 0.8);
  }
});

test("RTS camera fills the viewport by default; Fit reveals the entire map above the dock", () => {
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
    camera.fit();
    const fitted = camera.view();
    const scale = size.width / fitted.width;
    assert.ok(-fitted.x * scale >= insets.left - 0.001);
    assert.ok(-fitted.y * scale >= insets.top - 0.001);
    assert.ok(
      (world.width - fitted.x) * scale <= size.width - insets.right + 0.001,
    );
    assert.ok(
      (world.height - fitted.y) * scale <= size.height - insets.bottom + 0.001,
    );
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
  camera.fit();
  camera.resize({ width: 1200, height: 800 });
  const fit = camera.view();
  assert.ok(
    ((world.height - fit.y) * 1200) / fit.width <= 800 - insets.bottom + 0.001,
  );
});

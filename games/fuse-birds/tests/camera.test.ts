import { test } from "node:test";
import assert from "node:assert/strict";
import {
  constrainCamera,
  edgeMarker,
  fitScale,
  followShot,
  screenToWorld,
  zoomAt,
} from "../src/render/camera.js";
const map = { width: 1536, height: 768 },
  viewport = { width: 1000, height: 600 };
test("zoomed edge markers preserve direction and safe screen margins", () => {
  const camera = { x: 768, y: 384, zoom: 3 };
  assert.equal(
    edgeMarker({ x: 768, y: 384 }, camera, map, viewport),
    undefined,
  );
  for (const [point, arrow] of [
    [{ x: 10, y: 384 }, "←"],
    [{ x: 1530, y: 384 }, "→"],
    [{ x: 768, y: 0 }, "↑"],
    [{ x: 768, y: 760 }, "↓"],
  ] as const) {
    const marker = edgeMarker(point, camera, map, viewport)!;
    assert.equal(marker.arrow, arrow);
    const scale = fitScale(map, viewport) * camera.zoom;
    const x = viewport.width / 2 + (marker.x - camera.x) * scale;
    const y = viewport.height / 2 + (marker.y - camera.y) * scale;
    assert.ok(x >= 69 && x <= viewport.width - 69);
    assert.ok(y >= 27 && y <= viewport.height - 27);
  }
});
test("shared TV always contains the whole map regardless of local camera", () => {
  const camera = constrainCamera({ x: 1, y: 2, zoom: 5 }, map, viewport, true);
  assert.deepEqual(camera, { x: 768, y: 384, zoom: 1 });
  assert.equal(fitScale(map, viewport), 1000 / 1536);
  const top = screenToWorld({ x: 0, y: 0 }, camera, map, viewport);
  assert.equal(top.x, 0);
  assert.ok(top.y < 0);
});
test("shot following eases toward fragments and widens the view without magnifying it", () => {
  const initial = { x: 768, y: 384, zoom: 4 };
  assert.equal(followShot(initial, [], map, viewport, 16), initial);
  const single = followShot(initial, [{ x: 1000, y: 300 }], map, viewport, 16);
  assert.ok(single.x > initial.x && single.x < 1000);
  assert.equal(single.zoom, 4);
  assert.deepEqual(
    followShot(initial, [{ x: 1000, y: 300 }], map, viewport, 0),
    initial,
  );
  const spread = [
    { x: 200, y: 200 },
    { x: 1300, y: 500 },
    { x: 700, y: 400 },
  ];
  let camera = initial;
  for (let frame = 0; frame < 90; frame++)
    camera = followShot(camera, spread, map, viewport, 16);
  const topLeft = screenToWorld({ x: 0, y: 0 }, camera, map, viewport);
  const bottomRight = screenToWorld(
    { x: viewport.width, y: viewport.height },
    camera,
    map,
    viewport,
  );
  for (const point of spread) {
    assert.ok(point.x > topLeft.x && point.x < bottomRight.x);
    assert.ok(point.y > topLeft.y && point.y < bottomRight.y);
  }
  assert.ok(camera.zoom < initial.zoom);
  const overview = { x: 768, y: 384, zoom: 1 };
  assert.deepEqual(followShot(overview, spread, map, viewport, 1000), overview);
});
test("zoom keeps the aim location under the cursor and clamps map edges", () => {
  const camera = { x: 768, y: 384, zoom: 2 },
    point = { x: 560, y: 330 };
  const before = screenToWorld(point, camera, map, viewport),
    next = zoomAt(camera, 4, point, map, viewport);
  const after = screenToWorld(point, next, map, viewport);
  assert.ok(
    Math.abs(after.x - before.x) < 1e-9 && Math.abs(after.y - before.y) < 1e-9,
  );
  const edge = constrainCamera({ x: -100, y: 9999, zoom: 9 }, map, viewport);
  assert.equal(edge.zoom, 5);
  assert.ok(edge.x > 0 && edge.y < map.height);
  assert.equal(zoomAt(camera, 0.1, point, map, viewport).zoom, 1);
});

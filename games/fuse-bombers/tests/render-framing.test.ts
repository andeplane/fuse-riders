import test from "node:test";
import assert from "node:assert/strict";
import {
  createCamera,
  snapCamera,
  visibleRect,
  zoomLimits,
  type CameraPose,
} from "../src/render/camera.js";
import {
  framingPoints,
  GHOST_WEIGHT,
  HUD_SCALE,
  hudScale,
  MARKER_MIN_SCALE,
  minScreenScale,
  shipMarkers,
  SKY,
  skyRect,
  type ShipPoint,
} from "../src/render/framing.js";

const SCREEN = { width: 1600, height: 900 };
const REGION = { width: 1600, height: 796 };
const WORLD = { width: 4800, height: 2700 };
const ship = (id: number, x: number, y: number, ghost = false): ShipPoint =>
  ghost ? { id, x, y, ghost, weight: GHOST_WEIGHT } : { id, x, y, ghost };

test("the shared screen frames living gunships at weight 1 and ghosts at a lower weight, never wrecks", () => {
  const castles = [
    { id: 0, x: 100, y: 200, alive: true },
    { id: 1, x: 300, y: 400, alive: false },
    { id: 2, x: 500, y: 600, alive: true },
  ];
  const ghosts = [{ owner: 1, x: 900, y: 50 }];
  const points = framingPoints({ castles, ghosts });
  assert.deepEqual(points, [
    { id: 0, x: 100, y: 200, ghost: false },
    { id: 2, x: 500, y: 600, ghost: false },
    { id: 1, x: 900, y: 50, weight: GHOST_WEIGHT, ghost: true },
  ]);
  assert.ok(GHOST_WEIGHT > 0 && GHOST_WEIGHT < 1);
});

test("framed gunships get no markers; a ghost the frame leaves out gets an edge arrow in HUD coordinates", () => {
  const camera = createCamera({ view: REGION, world: WORLD });
  const ships = [
    ship(0, 1000, 1200),
    ship(1, 1400, 1300),
    ship(2, 4700, 200, true),
  ];
  const pose = snapCamera(camera, { points: ships });
  const view = visibleRect(pose, REGION);
  assert.ok(view.x + view.width < 4700, "the ghost is outside the frame");
  const markers = shipMarkers(ships, pose, REGION, 52);
  assert.equal(markers.length, 1);
  const [m] = markers;
  assert.ok(m && m.id === 2 && m.ghost);
  // Up and to the right, inside the region, which starts 52 px below the HUD's top.
  assert.ok(m.x > REGION.width / 2 && m.x <= REGION.width - 30);
  assert.ok(m.y >= 52 + 30 && m.y <= 52 + REGION.height - 30);
  assert.ok(m.angle < 0 && m.angle > -Math.PI / 2, `angle ${m.angle}`);
});

test("an arrow is full size just off the edge and shrinks with distance to a floor", () => {
  const pose: CameraPose = { centerX: 800, centerY: 450, zoom: 1 };
  const view = { width: 1600, height: 900 };
  const [near, far, farther] = shipMarkers(
    [ship(0, 1610, 450), ship(1, 3000, 450), ship(2, 9000, 450)],
    pose,
    view,
  );
  assert.ok(near && far && farther);
  assert.ok(Math.abs(near.scale - 1) < 0.01, `near ${near.scale}`);
  assert.ok(far.scale < near.scale && far.scale > MARKER_MIN_SCALE);
  assert.equal(farther.scale, MARKER_MIN_SCALE);
  for (const m of [near, far, farther]) {
    assert.equal(m.x, 1600 - 30);
    assert.equal(m.y, 450);
    assert.equal(m.angle, 0);
  }
});

test("the sky covers the screen and a shake's margin at every zoom and anywhere in the world", () => {
  const { min, max } = zoomLimits(
    createCamera({ view: REGION, world: WORLD }).settings,
  );
  for (const zoom of [min, (min + max) / 2, max])
    for (const centerX of [0, 1200, 2400, 4800])
      for (const centerY of [0, 1350, 2700]) {
        const pose = { centerX, centerY, zoom };
        const sky = skyRect(pose, SCREEN, WORLD, min, max);
        const [halfW, halfH] = [
          (SCREEN.width / 2 + SKY.margin) / zoom,
          (SCREEN.height / 2 + SKY.margin) / zoom,
        ];
        const eps = 1e-6;
        assert.ok(sky.x - sky.width / 2 <= centerX - halfW + eps);
        assert.ok(sky.x + sky.width / 2 >= centerX + halfW - eps);
        assert.ok(sky.y - sky.height / 2 <= centerY - halfH + eps);
        assert.ok(sky.y + sky.height / 2 >= centerY + halfH - eps);
      }
});

test("the sky slides against the camera and grows as it zooms in", () => {
  const [min, max] = [0.3, 0.9];
  const at = (centerX: number, zoom: number) =>
    skyRect({ centerX, centerY: 1350, zoom }, SCREEN, WORLD, min, max);
  const middle = at(2400, min);
  assert.equal(middle.x, 2400);
  assert.equal(middle.y, 1350);
  // Panned right, the sky lags behind: its centre sits left of the camera's, by at most the parallax.
  const right = at(4800, min);
  assert.ok(right.x < 4800);
  assert.ok((4800 - right.x) * min <= SKY.parallax * (1 + SKY.grow) + 1e-9);
  // Screen size grows with zoom, by at most `SKY.grow`.
  const screenWidth = (zoom: number) => at(2400, zoom).width * zoom;
  assert.ok(screenWidth(max) > screenWidth(min));
  assert.ok(
    Math.abs(screenWidth(max) / screenWidth(min) - (1 + SKY.grow)) < 1e-9,
  );
  // A degenerate world or zoom range keeps the sky finite instead of throwing it to NaN.
  const pose = { centerX: 0, centerY: 0, zoom: min };
  const odd = skyRect(pose, SCREEN, { width: 0, height: 0 }, min, min);
  assert.ok([odd.x, odd.y, odd.width, odd.height].every(Number.isFinite));
});

test("marks over ships shrink with the zoom to a floor and are full size zoomed in", () => {
  assert.equal(hudScale(1), 1);
  assert.equal(hudScale(HUD_SCALE.fullZoom), 1);
  assert.equal(hudScale(0.05), HUD_SCALE.min);
  assert.equal(hudScale(Number.NaN), 1);
  assert.ok(Math.abs(hudScale(0.48) - 0.8) < 1e-9);
  let last = 0;
  for (let zoom = 0.1; zoom <= 1; zoom += 0.05) {
    const k = hudScale(zoom);
    assert.ok(k >= last && k >= HUD_SCALE.min && k <= 1);
    last = k;
  }
});

test("small things keep a minimum on-screen size and are never shrunk", () => {
  assert.equal(minScreenScale(46, 1, 26), 1);
  assert.equal(minScreenScale(46, 0.3, 13), 1);
  assert.ok(Math.abs(minScreenScale(46, 0.3, 26) * 46 * 0.3 - 26) < 1e-9);
  for (const zoom of [0, Number.NaN])
    assert.equal(minScreenScale(46, zoom, 26), 1);
  assert.equal(minScreenScale(0, 0.3, 26), 1);
});

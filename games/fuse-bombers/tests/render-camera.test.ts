import test from "node:test";
import assert from "node:assert/strict";
import {
  CAMERA_DEFAULTS as DEFAULTS,
  cameraTarget,
  createCamera,
  offscreenMarkers,
  snapCamera,
  updateCamera,
  visibleRect,
  zoomLimits,
  type CameraInput,
  type CameraOptions,
  type CameraPoint,
  type CameraPose,
} from "../src/render/camera.js";

const VIEW = { width: 1600, height: 900 };
const PHONE = { width: 390, height: 844 };
const WORLD = { width: 4800, height: 2700 };
const WHOLE = { centerX: 2400, centerY: 1350, zoom: 1 / 3 };
const EPS = 1e-6;
const camera = (extra: Partial<CameraOptions> = {}) =>
  createCamera({ view: VIEW, world: WORLD, ...extra });
const NO_DEAD_ZONE = { deadZone: 0, zoomDeadZone: 0 };
const ships = (...xy: [number, number][]) => ({
  points: xy.map(([x, y]) => ({ x, y })),
});

/** Inside the world on each axis, or centred on one the view is wider than. */
function assertInWorld(pose: CameraPose, view = VIEW): void {
  const r = visibleRect(pose, view);
  const axis = (lo: number, size: number, world: number) =>
    size >= world
      ? Math.abs(lo + size / 2 - world / 2) < EPS
      : lo >= -EPS && lo + size <= world + EPS;
  assert.ok(axis(r.x, r.width, WORLD.width), `x ${r.x}+${r.width}`);
  assert.ok(axis(r.y, r.height, WORLD.height), `y ${r.y}+${r.height}`);
}

/** The view shows `p` and `pad` around it, as far as the world goes. */
function assertShows(pose: CameraPose, p: CameraPoint, pad = 0, view = VIEW) {
  const r = visibleRect(pose, view);
  assert.ok(r.x <= Math.max(0, p.x - pad) + EPS, `left of ${p.x}`);
  assert.ok(r.x + r.width >= Math.min(WORLD.width, p.x + pad) - EPS);
  assert.ok(r.y <= Math.max(0, p.y - pad) + EPS, `above ${p.y}`);
  assert.ok(r.y + r.height >= Math.min(WORLD.height, p.y + pad) - EPS);
}

test("the target frames every gunship with padding, inside the world, on any view shape", () => {
  let seed = 7; // Park–Miller, so the cases are the same on every run
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const view of [VIEW, PHONE, { width: 1000, height: 1000 }]) {
    const cam = createCamera({ view, world: WORLD });
    const { min, max } = zoomLimits(cam.settings);
    for (let i = 0; i < 300; i++) {
      const xy = (): [number, number] => [random() * 4800, random() * 2700];
      const { points } = ships(...Array.from({ length: 1 + (i % 6) }, xy));
      const pose = cameraTarget(cam, { points });
      assert.ok(pose.zoom >= min - EPS && pose.zoom <= max + EPS);
      for (const p of points) assertShows(pose, p, DEFAULTS.padding, view);
      assertInWorld(pose, view);
    }
  }
});

test("zoom stays between one old arena and the whole world", () => {
  const cam = camera();
  assert.deepEqual(zoomLimits(cam.settings), { min: 1 / 3, max: 1 });
  const rect = (input: CameraInput, c = cam) =>
    visibleRect(cameraTarget(c, input), c.settings.view);
  const one = { x: 1200, y: 550, width: 1600, height: 900 };
  assert.deepEqual(rect(ships([2000, 1000])), one);
  assert.deepEqual(cameraTarget(cam, ships([0, 0], [4800, 2700])), WHOLE);
  // A ship by the edge slides the view inward rather than past the world.
  assert.deepEqual(rect(ships([30, 2690])), { ...one, x: 0, y: 1800 });
  // A portrait phone keeps one arena's area at its closest.
  const phone = createCamera({ view: PHONE, world: WORLD });
  const r = rect(ships([2000, 1000]), phone);
  assert.ok(Math.abs(r.width * r.height - 1600 * 900) < 1e-3);
});

test("no points, or none usable, show the whole world without NaN", () => {
  for (const points of [[], [{ x: NaN, y: 3 }], [{ x: 1, y: 1, weight: 0 }]]) {
    const cam = camera();
    assert.deepEqual(cameraTarget(cam, { points }), WHOLE);
    const focus = { x: Infinity, y: 0 };
    assert.deepEqual(cameraTarget(cam, { points, focus }), WHOLE);
    for (const dt of [1 / 60, NaN, -1, Infinity]) {
      const input = { points, focus: { x: 9, y: 9, vx: NaN } };
      const pose = updateCamera(cam, input, dt);
      assert.ok([pose.centerX, pose.centerY, pose.zoom].every(Number.isFinite));
    }
  }
});

test("a ghost's lower weight pulls the frame only part of the way to it", () => {
  const cam = camera();
  const right = (...points: CameraPoint[]) => {
    const r = visibleRect(cameraTarget(cam, { points }), VIEW);
    return r.x + r.width;
  };
  const ship = { x: 1000, y: 1000 };
  const alone = right(ship);
  const ghost = right(ship, { x: 3000, y: 1000, weight: 0.5 });
  const full = right(ship, { x: 3000, y: 1000 });
  assert.ok(alone < ghost && ghost < 3000);
  assert.ok(full >= 3000 + DEFAULTS.padding - EPS);
});

test("the pose converges on a still target without overshoot, in centre and log zoom", () => {
  const cam = camera(NO_DEAD_ZONE);
  const input = ships([3600, 800], [3900, 1000]);
  const goal = cameraTarget(cam, input);
  const gap = (p: CameraPose) => [
    Math.abs(p.centerX - goal.centerX),
    Math.abs(p.centerY - goal.centerY),
    Math.abs(Math.log(p.zoom / goal.zoom)),
  ];
  let last = gap(cam.pose);
  for (let i = 0; i < 600; i++) {
    const now = gap(updateCamera(cam, input, 1 / 60));
    now.forEach((g, k) => assert.ok(g <= last[k]! + 1e-9, `${k} at ${i}`));
    last = now;
  }
  assert.ok(Math.max(...last) < 1e-3, String(last));
});

test("zooming out is faster than zooming in", () => {
  const share = (from: CameraInput, to: CameraInput) => {
    const cam = camera(NO_DEAD_ZONE);
    const start = snapCamera(cam, from).zoom;
    const end = cameraTarget(cam, to).zoom;
    for (let i = 0; i < 6; i++) updateCamera(cam, to, 1 / 60);
    return Math.log(cam.pose.zoom / start) / Math.log(end / start);
  };
  const [one, two] = [ships([2400, 1350]), ships([1800, 1350], [3000, 1350])];
  const [out, zoomIn] = [share(one, two), share(two, one)];
  assert.ok(out > 2 * zoomIn && zoomIn > 0, `${out} vs ${zoomIn}`);
});

test("a gunship flying off is never lost, even through frame hitches", () => {
  const cam = camera();
  const parked = ships([2300, 1300], [2600, 1400]).points;
  // A ghost's top speed toward the top-left corner, with a 0.4 s hitch now and then.
  let t = 0;
  for (let i = 0; t < 8.5; i++) {
    const dt = i % 97 === 0 ? 0.4 : 1 / 60;
    t += dt;
    const points = [...parked, { x: 2450 - 260 * t, y: 1350 - 150 * t }];
    if (i === 0) snapCamera(cam, { points });
    const pose = updateCamera(cam, { points }, dt);
    for (const p of points) assertShows(pose, p);
    assertInWorld(pose);
  }
  // A respawn across the map is in view, with the margin, on the very next frame.
  snapCamera(cam, { points: parked });
  const jump = ships([2300, 1300], [4600, 2500]);
  const pose = updateCamera(cam, jump, 1 / 60);
  for (const p of jump.points) assertShows(pose, p, DEFAULTS.keepMargin);
});

test("the dead zone holds the camera still while a hull bobs", () => {
  const cam = camera();
  const at = (bob: number) => ships([2000, 1200 + bob], [2900, 1500]);
  const start = snapCamera(cam, at(0));
  for (let i = 0; i < 120; i++) {
    assert.deepEqual(updateCamera(cam, at(i % 2 ? 3 : -3), 1 / 60), start);
  }
  assert.notDeepEqual(updateCamera(cam, at(60), 1 / 60), start);
});

test("long or invalid frame times are clamped; the same frames give the same poses", () => {
  const [a, b] = [camera(), camera()];
  const input = ships([4000, 600]);
  const once = updateCamera(a, input, Infinity);
  assert.deepEqual(once, updateCamera(b, input, DEFAULTS.maxDt));
  for (const dt of [NaN, -0.5, 0]) {
    assert.deepEqual(updateCamera(a, input, dt), once);
  }
});

test("a personal device follows its gunship with look-ahead and keeps the nearest opponents", () => {
  const cam = camera();
  const focus = { x: 1000, y: 1350, vx: 200, vy: 0 };
  const near = { x: 1600, y: 1250 };
  const far = { x: 4500, y: 300 };
  const pose = cameraTarget(cam, { focus, points: [far, near] });
  assertShows(pose, focus, DEFAULTS.padding);
  assertShows(pose, near, DEFAULTS.padding);
  const r = visibleRect(pose, VIEW);
  assert.ok(r.x + r.width < far.x && pose.zoom >= 0.5);
  const ahead = cameraTarget(cam, { focus, points: [] }).centerX;
  const back = { focus: { ...focus, vx: -200 }, points: [] };
  assert.ok(ahead > focus.x && ahead > cameraTarget(cam, back).centerX);
  // Looping past the opponents far faster than a gunship flies, it stays on screen.
  for (let i = 0; i < 900; i++) {
    const [c, s] = [Math.cos(i / 120), Math.sin(i / 120)];
    const [x, y] = [2400 + 1900 * c, 1350 + 1100 * s];
    const ship = { x, y, vx: -950 * s, vy: 550 * c };
    const input = { focus: ship, points: [far, near] };
    if (i === 0) snapCamera(cam, input);
    const now = updateCamera(cam, input, 1 / 60);
    assertShows(now, ship);
    assertInWorld(now);
  }
  // And a respawn across the map is in view on the very next frame.
  const jumped = { x: 4500, y: 2500 };
  const next = updateCamera(cam, { focus: jumped, points: [] }, 1 / 60);
  assertShows(next, jumped, DEFAULTS.keepMargin);
});

test("off-screen markers sit on the matching edge or corner and point at the ship", () => {
  const pose = { centerX: 2400, centerY: 1350, zoom: 1 }; // shows 1600..3200 × 900..1800
  const ship = (x: number, y: number) => ({ x, y, color: 0xff00ff });
  const cases: [ReturnType<typeof ship>, number, number, number][] = [
    [ship(1000, 1350), 28, 450, Math.PI],
    [ship(4000, 1350), 1572, 450, 0],
    [ship(2400, 100), 800, 28, -Math.PI / 2],
    [ship(2400, 2600), 800, 872, Math.PI / 2],
    [ship(3500, 2500), 1572, 872, Math.atan2(1600 - 872, 1900 - 1572)],
    [ship(100, 100), 28, 28, Math.atan2(-800 - 28, -1500 - 28)],
  ];
  const onScreen = [ship(2400, 1350), ship(1600, 900), ship(NaN, 0)];
  const points = [...onScreen, ...cases.map(([p]) => p)];
  const markers = offscreenMarkers(pose, VIEW, points);
  assert.equal(markers.length, cases.length);
  cases.forEach(([p, x, y, angle], i) => {
    const m = markers[i]!;
    assert.deepEqual([m.point, m.x, m.y], [p, x, y]);
    assert.ok(Math.abs(m.angle - angle) < 1e-12, `${m.angle} vs ${angle}`);
  });
});

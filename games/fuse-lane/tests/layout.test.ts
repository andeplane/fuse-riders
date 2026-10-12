import test from "node:test";
import assert from "node:assert/strict";
import {
  CITY,
  PLACES,
  STREETS,
  doorOf,
  nextStep,
  type MapPoint,
} from "../src/game/index.js";
import {
  boardView,
  bounds,
  centreOn,
  clampCamera,
  easeCamera,
  inside,
  placeAt,
  route,
  standPoint,
  standingPoints,
  stepPoint,
  streetDirection,
  toMap,
  toScreen,
  walkerAt,
  type BoardView,
} from "../src/app/layout.js";

const PHONE = { top: 70, bottom: 76, left: 0, right: 0 };
const DESKTOP = { top: 84, bottom: 6, left: 0, right: 0 };
const SCREENS: [string, number, number, typeof PHONE][] = [
  ["phone", 390, 844, PHONE],
  ["small phone", 360, 640, PHONE],
  ["phone on its side", 844, 390, DESKTOP],
  ["desktop", 1440, 900, DESKTOP],
  ["laptop", 1280, 720, DESKTOP],
  ["tablet", 768, 1024, DESKTOP],
  ["ultrawide", 2560, 1080, DESKTOP],
];
const views = (): [string, BoardView][] =>
  SCREENS.map(([name, w, h, insets]) => [
    name,
    boardView(w, h, CITY.map, insets),
  ]);
const centre = (shape: readonly MapPoint[]): MapPoint => {
  const box = bounds(shape);
  return [box.x + box.w / 2, box.y + box.h / 2];
};
const near = (a: MapPoint, b: MapPoint, eps = 1e-6) =>
  Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;

test("the map covers every screen, centred, with no empty edge; a tall phone pans sideways", () => {
  for (const [name, view] of views()) {
    assert.ok(view.mapWidth >= view.width - 1e-6, `${name}: fills the width`);
    assert.ok(view.mapHeight >= view.height - 1e-6, `${name}: and the height`);
    assert.ok(
      Math.abs(view.mapWidth - view.width) < 1e-6 ||
        Math.abs(view.mapHeight - view.height) < 1e-6,
      `${name}: one side fits exactly`,
    );
    assert.equal(view.minX, Math.min(0, view.width - view.mapWidth));
    assert.equal(view.minY, Math.min(0, view.height - view.mapHeight));
    // Any camera at all is pulled back over the map.
    for (const wild of [
      { x: 500, y: 500 },
      { x: -9999, y: -9999 },
      { x: -9999, y: 9999 },
    ]) {
      const camera = clampCamera(view, wild);
      assert.ok(camera.x <= 0 && camera.y <= 0, name);
      assert.ok(camera.x + view.mapWidth >= view.width - 1e-6, name);
      assert.ok(camera.y + view.mapHeight >= view.height - 1e-6, name);
    }
  }
  const phone = boardView(390, 844, CITY.map, PHONE);
  assert.ok(phone.compact);
  assert.equal(phone.mapHeight, 844, "as tall as the screen");
  assert.ok(phone.minX < -600, "and a long way to pan sideways");
  assert.equal(phone.minY, 0);
  const desktop = boardView(1440, 900, CITY.map, DESKTOP);
  assert.ok(!desktop.compact);
  assert.equal(desktop.mapWidth, 1440);
  assert.equal(desktop.minX, 0);
  assert.ok(desktop.minY < 0 && desktop.minY > -100, "a little up and down");
});

test("panels open in the middle of the free screen: full width on a tall phone, a centred card elsewhere", () => {
  for (const [name, view] of views()) {
    const { panel, free } = view;
    assert.ok(panel.x >= free.x && panel.y >= free.y, name);
    assert.ok(panel.x + panel.w <= free.x + free.w + 1, name);
    assert.ok(panel.y + panel.h <= free.y + free.h + 1, name);
  }
  const phone = boardView(390, 844, CITY.map, PHONE);
  assert.equal(phone.free.y, 70);
  assert.equal(phone.free.h, 844 - 70 - 76);
  assert.equal(phone.panel.w, 390 - 16);
  const desktop = boardView(1440, 900, CITY.map, DESKTOP);
  assert.ok(desktop.panel.w >= 520 && desktop.panel.w <= 880);
  assert.ok(
    Math.abs(desktop.panel.x + desktop.panel.w / 2 - 720) <= 1,
    "centred",
  );
  // A phone on its side: the panel takes the width, for the little height there is.
  const side = boardView(844, 390, CITY.map, DESKTOP);
  assert.ok(!side.compact);
  assert.equal(side.panel.w, 844 - 24);
  assert.ok(side.minY < 0, "it pans up and down");
  // A tiny screen still gets a board and a panel.
  const tiny = boardView(0, 0);
  assert.equal(tiny.width, 1);
  assert.ok(tiny.panel.w >= 1 && tiny.panel.h >= 1);
});

test("screen and map points convert both ways, and centring puts a point mid-screen when the map allows", () => {
  const phone = boardView(390, 844, CITY.map, PHONE);
  const square: MapPoint = [768, 512];
  const camera = centreOn(phone, square);
  const middle = toScreen(phone, camera, square);
  assert.ok(Math.abs(middle.x - 195) < 1e-6);
  assert.ok(near(toMap(phone, camera, middle.x, middle.y), square));
  // At the map's edge the camera stops: the corner stays on screen's corner.
  const corner = centreOn(phone, [0, 0]);
  assert.deepEqual(corner, { x: 0, y: 0 });
  const far = centreOn(phone, [CITY.map.width, CITY.map.height]);
  assert.equal(far.x, phone.minX);
});

test("the camera eases toward its target, frame-rate independent, and settles exactly", () => {
  const from = { x: 0, y: 0 },
    to = { x: -100, y: -40 };
  const one = easeCamera(from, to, 0.1);
  const two = easeCamera(easeCamera(from, to, 0.05), to, 0.05);
  assert.ok(Math.abs(one.x - two.x) < 1e-9 && Math.abs(one.y - two.y) < 1e-9);
  assert.ok(one.x < 0 && one.x > -100);
  assert.deepEqual(easeCamera(from, to, 0), from);
  assert.deepEqual(easeCamera(from, to, -1), from);
  let camera = from;
  for (let k = 0; k < 120; k++) camera = easeCamera(camera, to, 1 / 60);
  assert.deepEqual(camera, to);
});

test("a tap on a building or on its label finds that place, also after panning; a tap on open water none", () => {
  CITY.places.forEach((place, index) => {
    assert.equal(placeAt(centre(place.tap)), index, `${place.id}'s middle`);
    assert.equal(
      placeAt(place.label, { w: 30, h: 10 }),
      index,
      `${place.id}'s label`,
    );
  });
  // The tap targets do not overlap: each building's middle is inside its own outline only.
  CITY.places.forEach((place, index) => {
    const at = centre(place.tap);
    CITY.places.forEach((other, k) => {
      if (k !== index)
        assert.ok(!inside(other.tap, at), `${place.id} in ${other.id}`);
    });
  });
  // The open bay in the bottom left.
  assert.equal(placeAt([120, 960]), -1);
  // Per-place label sizes: a label is hit only within its own box.
  const sizes = CITY.places.map(() => ({ w: 40, h: 9 }));
  const [lx, ly] = CITY.places[0]!.label;
  assert.equal(placeAt([lx + 39, ly], sizes), 0);
  // After panning a phone to the docks, a tap on screen still lands on the building drawn there.
  const phone = boardView(390, 844, CITY.map, PHONE);
  const docks = PLACES.findIndex((place) => place.id === "docks");
  const target = centre(CITY.places[docks]!.tap);
  const camera = centreOn(phone, target);
  const on = toScreen(phone, camera, target);
  assert.ok(on.x > 0 && on.x < 390, "the docks are on screen");
  assert.equal(placeAt(toMap(phone, camera, on.x, on.y)), docks);
  const square: MapPoint[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  assert.ok(inside(square, [5, 5]));
  assert.ok(!inside(square, [15, 5]));
});

test("walkers follow the streets between frames, and stand still when the route is unknown", () => {
  const home = doorOf(0),
    place = 1;
  const a = home,
    b = nextStep(nextStep(home, place), place);
  assert.deepEqual(route(a, b, place), [a, nextStep(a, place), b]);
  assert.equal(route(a, home, place, 0)?.length, 1);
  assert.equal(route(a, doorOf(5), place, 3), undefined);
  const start = walkerAt(a, b, place, 0),
    middle = walkerAt(a, b, place, 0.5),
    end = walkerAt(a, b, place, 1);
  assert.ok(near(start.at, stepPoint(a)));
  assert.ok(near(middle.at, stepPoint(nextStep(a, place))));
  assert.ok(near(end.at, stepPoint(b)));
  // Roomshare to KeyNest is west: the walker faces left; back home it faces right.
  assert.equal(middle.facing, -1);
  assert.equal(walkerAt(b, a, 0, 0.5).facing, 1);
  // No destination, the same step, or a jump (a new week): standing at the newer step.
  assert.deepEqual(walkerAt(a, b, -1, 0.5), { at: stepPoint(b), facing: 0 });
  assert.deepEqual(walkerAt(b, b, place, 0.5), {
    at: stepPoint(b),
    facing: 0,
  });
  assert.deepEqual(walkerAt(doorOf(7), a, place, 0.5), {
    at: stepPoint(a),
    facing: 0,
  });
  // A fraction out of range is clamped.
  assert.ok(near(walkerAt(a, b, place, 9).at, stepPoint(b)));
  assert.ok(near(stepPoint(-5), stepPoint(STREETS.start)));
});

test("players at one door stand side by side along the street; walkers on one spot too", () => {
  const spacing = 20;
  const door = doorOf(3);
  const stand = standPoint(3);
  const dx = stand[0] - stepPoint(door)[0],
    dy = stand[1] - stepPoint(door)[1];
  assert.ok(Math.sqrt(dx * dx + dy * dy) <= 22.0001, "near the door");
  const points = standingPoints(
    [
      { at: stepPoint(door), step: door, inside: 3 },
      { at: stepPoint(door), step: door, inside: 3 },
      { at: stepPoint(40), step: 40, inside: -1 },
      { at: stepPoint(40), step: 40, inside: -1 },
      { at: stepPoint(90), step: 90, inside: -1 },
    ],
    spacing,
  );
  const gap = (p: MapPoint, q: MapPoint) =>
    Math.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2);
  assert.ok(Math.abs(gap(points[0]!, points[1]!) - spacing) < 1e-6);
  assert.ok(Math.abs(gap(points[2]!, points[3]!) - spacing) < 1e-6);
  assert.ok(near(points[4]!, stepPoint(90)), "alone, right on the street");
  const mid: MapPoint = [
    (points[0]![0] + points[1]![0]) / 2,
    (points[0]![1] + points[1]![1]) / 2,
  ];
  assert.ok(near(mid, stand), "the pair is centred on the stand point");
  // Directions are unit vectors pointing right (or down).
  for (let step = 0; step < STREETS.size; step += 17) {
    const [x, y] = streetDirection(step);
    assert.ok(Math.abs(x * x + y * y - 1) < 1e-9);
    assert.ok(x > 0 || (x === 0 && y > 0));
  }
  assert.deepEqual(
    streetDirection(0, { ...STREETS, neighbours: [[]] }),
    [1, 0],
  );
});

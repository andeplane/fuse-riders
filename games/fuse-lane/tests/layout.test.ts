import test from "node:test";
import assert from "node:assert/strict";
import { PLACES, RING } from "../src/game/index.js";
import {
  MIN_LOTS,
  assignLots,
  doorPoint,
  geometry,
  lotBox,
  lotRing,
  nearestT,
  placeAt,
  ringBetween,
  ringToT,
  streetPoint,
  walkPoint,
  type Geometry,
  type Rect,
} from "../src/app/layout.js";

const RINGS = PLACES.map((place) => place.ring);
const PHONE = { top: 70, bottom: 76, left: 0, right: 0 };
const DESKTOP = { top: 84, bottom: 6, left: 0, right: 0 };
const SCREENS: [string, number, number, typeof PHONE][] = [
  ["phone", 390, 844, PHONE],
  ["small phone", 360, 640, PHONE],
  ["desktop", 1440, 900, DESKTOP],
  ["laptop", 1280, 720, DESKTOP],
  ["tablet", 768, 1024, DESKTOP],
  ["landscape phone", 844, 390, { top: 60, bottom: 6, left: 0, right: 0 }],
];

const inside = (outer: Rect, inner: Rect, slack = 0.5) =>
  inner.x >= outer.x - slack &&
  inner.y >= outer.y - slack &&
  inner.x + inner.w <= outer.x + outer.w + slack &&
  inner.y + inner.h <= outer.y + outer.h + slack;
const overlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.w - 0.5 &&
  b.x < a.x + a.w - 0.5 &&
  a.y < b.y + b.h - 0.5 &&
  b.y < a.y + a.h - 0.5;

for (const [name, width, height, insets] of SCREENS)
  test(`the board fits a ${name} (${width}x${height})`, () => {
    const g = geometry(width, height, RINGS, insets);
    const screen = { x: 0, y: 0, w: width, h: height };
    assert.ok(g.lots.length >= MIN_LOTS, "every place and some parks");
    // Every place has its own lot, on the screen and clear of the HUD's top and bottom bands.
    assert.equal(new Set(g.placeLot).size, PLACES.length);
    const boxes = g.placeLot.map((lot) => lotBox(g, g.lots[lot]!));
    for (const box of boxes) {
      assert.ok(inside(screen, box, 1), `lot ${JSON.stringify(box)} on screen`);
      assert.ok(box.y + box.h * 0.1 >= insets.top - 1, "below the top HUD");
      assert.ok(
        box.y + box.h <= height - insets.bottom + g.size * 0.1,
        "above the bottom HUD",
      );
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        assert.ok(!overlap(boxes[i]!, boxes[j]!), "no building hides another");
    // The street loops inside the ring of lots, the park inside the street, the panel on screen.
    assert.ok(g.left < g.right && g.top < g.bottom);
    assert.ok(g.park.w > 0 && g.park.h > 0);
    assert.ok(g.park.x > g.left && g.park.x + g.park.w < g.right);
    assert.ok(inside(screen, g.panel), "panel on screen");
    assert.ok(g.panel.y >= insets.top - 0.5, "panel below the HUD");
    for (const box of boxes)
      assert.ok(!overlap(box, g.park), "no lot in the park");
  });

test("a tall phone gets a tall loop and a full-width panel; a wide screen a wide loop", () => {
  const phone = geometry(390, 844, RINGS, PHONE);
  assert.equal(phone.compact, true);
  assert.ok(phone.bottom - phone.top > 1.5 * (phone.right - phone.left));
  assert.equal(phone.panel.x, 8);
  assert.equal(phone.panel.w, 390 - 16);
  assert.ok(phone.size >= 80, `phone buildings are big (${phone.size})`);
  const desk = geometry(1440, 900, RINGS, DESKTOP);
  assert.equal(desk.compact, false);
  assert.ok(desk.right - desk.left > 1.5 * (desk.bottom - desk.top));
  assert.ok(desk.panel.w >= 520 && desk.panel.w <= 880);
  // Centred on the park.
  assert.ok(
    Math.abs(
      desk.panel.x + desk.panel.w / 2 - (desk.park.x + desk.park.w / 2),
    ) <= 1,
  );
});

test("places keep their order around the loop", () => {
  for (const [, width, height, insets] of SCREENS) {
    const g = geometry(width, height, RINGS, insets);
    const order = PLACES.map((place, index) => ({ ring: place.ring, index }))
      .sort((a, b) => a.ring - b.ring)
      .map(({ index }) => g.lots[g.placeLot[index]!]!.t);
    // Street positions rise with ring position, wrapping at most once.
    let wraps = 0;
    for (let i = 0; i < order.length; i++)
      if (order[(i + 1) % order.length]! < order[i]!) wraps++;
    assert.equal(wraps, 1);
  }
});

test("each place's ring position lands at its building, and walking is continuous", () => {
  const g = geometry(390, 844, RINGS, PHONE);
  PLACES.forEach((place, index) => {
    const t = ringToT(g, place.ring),
      lot = g.lots[g.placeLot[index]!]!;
    assert.ok(Math.abs(t - lot.t) < 1e-9, `${place.id} at its lot`);
    const door = doorPoint(g, index),
      walker = walkPoint(g, place.ring);
    // The walker stands across the street from the door.
    assert.ok(
      Math.hypot(door.x - walker.x, door.y - walker.y) < g.road + 2 * g.walk,
    );
  });
  // Small steps move a walker a little: no jumps anywhere on the loop.
  let last = walkPoint(g, 0);
  for (let ring = 0.25; ring <= RING; ring += 0.25) {
    const next = walkPoint(g, ring);
    assert.ok(Math.hypot(next.x - last.x, next.y - last.y) < g.size * 0.6);
    last = next;
  }
});

test("a tap on a building finds that place, a tap on the road finds none", () => {
  const g: Geometry = geometry(1440, 900, RINGS, DESKTOP);
  PLACES.forEach((_, index) => {
    const lot = g.lots[g.placeLot[index]!]!;
    assert.equal(placeAt(g, lot.x, lot.y), index);
  });
  const road = streetPoint(g, 0.3);
  assert.equal(placeAt(g, road.x, road.y), -1);
  assert.equal(
    placeAt(g, g.park.x + g.park.w / 2, g.park.y + g.park.h / 2),
    -1,
  );
});

test("the street path: points on the rounded rectangle, normals pointing out", () => {
  const g = { left: 100, top: 100, right: 500, bottom: 300, radius: 40 };
  const start = streetPoint(g, 0);
  assert.deepEqual([start.x, start.y, start.nx, start.ny], [140, 100, 0, -1]);
  const right = streetPoint(g, 0.25);
  assert.ok(right.nx > 0.99 || right.ny !== 0);
  const out = streetPoint(g, 0.6, 10),
    centre = streetPoint(g, 0.6);
  assert.ok(
    Math.abs(Math.hypot(out.x - centre.x, out.y - centre.y) - 10) < 1e-9,
  );
  // Wrapping and negative positions.
  assert.deepEqual(streetPoint(g, 1.25), streetPoint(g, 0.25));
  assert.deepEqual(streetPoint(g, -0.75), streetPoint(g, 0.25));
  // Nearest point: a point just above the top edge.
  assert.ok(Math.abs(nearestT(g, { x: 140, y: 90 })) < 0.01);
  // The corners are arcs.
  const corner = streetPoint(g, 0.4);
  assert.ok(corner.x >= g.left && corner.x <= g.right);
});

test("lot ring and lot assignment", () => {
  const lots = lotRing(0, 0, 300, 200, 100);
  assert.equal(lots.length, 4 + 1 + 4 + 1);
  assert.deepEqual(lots[0], { x: 0, y: 0, side: "top" });
  assert.equal(lots.filter((lot) => lot.side === "right").length, 1);
  // Three places on six lots: each takes the nearest lot, in order.
  const assigned = assignLots(
    [0, 85, 120],
    [0, 0.1, 0.3, 0.5, 0.7, 0.9].map((t) => ({ t })),
  );
  assert.deepEqual(assigned, [0, 3, 4]);
  assert.throws(() => assignLots([1, 2, 3], [{ t: 0 }]), /need at least/);
});

test("ring helpers wrap the short way", () => {
  assert.equal(ringBetween(10, 20, 0.5), 15);
  assert.equal(ringBetween(165, 5, 0.5), 0);
  assert.equal(ringBetween(5, 165, 0.5), 0);
  assert.equal(ringBetween(5, 165, 2), 165);
  const g = geometry(390, 844, RINGS, PHONE);
  assert.ok(Math.abs(ringToT(g, RING + 7) - ringToT(g, 7)) < 1e-12);
  assert.ok(Math.abs(ringToT(g, -3) - ringToT(g, RING - 3)) < 1e-12);
});

test("a tiny screen still gets a board", () => {
  const g = geometry(120, 90, RINGS);
  assert.equal(g.width, 120);
  assert.equal(new Set(g.placeLot).size, PLACES.length);
});

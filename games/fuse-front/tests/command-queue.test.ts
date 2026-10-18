import test from "node:test";
import assert from "node:assert/strict";
import {
  SPELL_INFO,
  centreOf,
  step,
  viewOf,
  type World,
} from "../src/engine/index.js";
import { keyAction } from "../src/app/hud-state.js";
import {
  IDLE,
  clickIntent,
  modeAfter,
  pressSpell,
  type Mode,
} from "../src/app/targeting.js";
import { ROUTE_HEX, routeMarks } from "../src/render/route.js";
import { tiny } from "./fixtures/maps.js";
import { addUnit, arena } from "./fixtures/heroes.js";

const map = tiny();
const view = (world: World) => viewOf(map, world);
const [LEFT, RIGHT] = [0, 2];

test("with Shift (or QUEUE) every click order is queued, and a left click on a factory still opens it", () => {
  const world = arena("vix");
  const grunt = addUnit(world, 1, "grunt", 9, 6);
  const v = view(world);
  const shift = (mode: Mode, x: number, y: number, button = RIGHT) =>
    clickIntent(v, 0, mode, { x, y }, button, 7, true);
  assert.deepEqual(shift(IDLE, 3, 6), {
    kind: "move",
    x: 3,
    y: 6,
    queued: true,
  });
  assert.deepEqual(shift(IDLE, 9, 6), {
    kind: "attack",
    of: 0,
    id: grunt.id,
    queued: true,
  });
  assert.deepEqual(shift(IDLE, 3, 6, LEFT), { kind: "factory", id: 7 });
  const armed: Mode = { kind: "attackMove" };
  const amove = shift(armed, 5, 5, LEFT);
  assert.deepEqual(amove, { kind: "attackMove", x: 5, y: 5, queued: true });
  assert.deepEqual(modeAfter(armed, amove), armed, "stays armed for the next");
  const plain = clickIntent(v, 0, armed, { x: 5, y: 5 }, LEFT);
  assert.deepEqual(plain, { kind: "attackMove", x: 5, y: 5 });
  assert.deepEqual(modeAfter(armed, plain), IDLE);
  // Sticky Mine (point) aimed in reach, queued; Shift + Q still reads as Q.
  assert.deepEqual(keyAction("Q"), { kind: "cast", slot: 0 });
  const aim: Mode = { kind: "aim", slot: 2 };
  assert.deepEqual(shift(aim, 5, 6, LEFT), {
    kind: "cast",
    slot: 2,
    x: 5,
    y: 6,
    queued: true,
  });
  assert.deepEqual(modeAfter(aim, shift(aim, 5, 6, LEFT)), IDLE);
});

test("a queued spell measures its reach from the route's end, and need not be ready yet", () => {
  // Vix walks to the west edge with a queued move east; Sticky Mine is aimed past where she stands now.
  let world = arena("vix");
  world = step(map, world, [
    { seat: 0, type: "move", x: 2, y: 6 },
    { seat: 0, type: "move", x: 12, y: 6, queued: true },
    // A cast on the way leaves her where the last move did, not at its aim tile.
    { seat: 0, type: "cast", slot: 2, x: 3, y: 6, queued: true },
  ]);
  const v = view(world);
  const range = SPELL_INFO.vix[2]!.range;
  const tile = { x: 11, y: 6 };
  const hero = v.heroes[0]!;
  assert.ok(
    Math.hypot(centreOf(11) - hero.x, centreOf(6) - hero.y) > range * 1.2,
    "beyond reach of the hero now",
  );
  const aim: Mode = { kind: "aim", slot: 2 };
  assert.deepEqual(clickIntent(v, 0, aim, tile, LEFT), { kind: "none" });
  assert.equal(
    clickIntent(v, 0, aim, tile, LEFT, undefined, true).kind,
    "cast",
  );
  // A spell on cooldown arms when queued, and a queued self spell casts.
  assert.deepEqual(pressSpell(v, 0, IDLE, 2, false), { mode: IDLE });
  const armed = pressSpell(v, 0, IDLE, 2, false, true).mode;
  assert.deepEqual(armed, { ...aim, queued: true });
  // Armed with Shift, the click queues even after Shift is let go.
  assert.equal(clickIntent(v, 0, armed, tile, LEFT).kind, "cast");
  assert.equal(
    (clickIntent(v, 0, armed, tile, LEFT) as { queued?: true }).queued,
    true,
  );
  assert.ok(pressSpell(v, 0, IDLE, 1, false, true).cast, "Cloak, queued");
});

test("the route draws nothing until something is queued, then a leg and a mark per order, fading along it", () => {
  let world = step(map, arena("brick"), [
    { seat: 0, type: "move", x: 2, y: 2 },
  ]);
  const hero = () => view(world).heroes[0]!;
  assert.deepEqual(routeMarks(hero().route, hero().x, hero().y), []);
  const foe = addUnit(world, 1, "sentry", 11, 8, 400);
  world = step(map, world, [
    { seat: 0, type: "attackMove", x: 9, y: 2, queued: true },
    { seat: 0, type: "attack", of: 0, id: foe.id, queued: true },
    { seat: 0, type: "cast", slot: 0, x: 0, y: 0, queued: true },
  ]);
  const { route, x, y } = hero();
  const marks = routeMarks(route, x, y);
  assert.deepEqual(
    marks.map((m) => m.kind),
    ["move", "attackMove", "attack", "cast"],
  );
  assert.deepEqual([marks[0]!.fromX, marks[0]!.fromY], [x, y], "from the hero");
  for (let i = 1; i < marks.length; i++) {
    assert.deepEqual(
      [marks[i]!.fromX, marks[i]!.fromY],
      [marks[i - 1]!.x, marks[i - 1]!.y],
      "each leg starts at the last waypoint",
    );
    assert.ok(marks[i]!.fade < marks[i - 1]!.fade);
  }
  assert.equal(new Set(marks.map((m) => m.hex)).size, 4, "a colour per kind");
  assert.equal(marks[2]!.hex, ROUTE_HEX.attack);
  assert.deepEqual([marks[2]!.x, marks[2]!.y], [centreOf(11), centreOf(8)]);
});

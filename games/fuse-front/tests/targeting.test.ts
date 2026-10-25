import test from "node:test";
import assert from "node:assert/strict";
import {
  SPELL_INFO,
  SUB,
  TILE_PX,
  centreOf,
  step,
  viewOf,
  type World,
} from "../src/engine/index.js";
import { keyAction } from "../src/app/hud-state.js";
import {
  IDLE,
  clickIntent,
  modeFor,
  overlayOf,
  pinchZoom,
  pressSpell,
  spellTargets,
  spellTooltip,
  targetPanel,
  type Mode,
  zoomAnchor,
} from "../src/app/targeting.js";
import { PULSE_MS, TargetPulse } from "../src/render/renderer.js";
import { tiny, TINY } from "./fixtures/maps.js";
import { addUnit, arena } from "./fixtures/heroes.js";

const map = tiny();
const view = (world: World) => viewOf(map, world);
const LEFT = 0,
  RIGHT = 2;

test("a right click attacks the enemy under it and moves on open ground; a left click does too", () => {
  const world = arena("brick");
  const grunt = addUnit(world, 1, "grunt", 9, 6);
  const friend = addUnit(world, 0, "grunt", 3, 6);
  const v = view(world);
  const click = (x: number, y: number, button = RIGHT) =>
    clickIntent(v, 0, IDLE, { x, y }, button);
  assert.deepEqual(click(9, 6), { kind: "attack", of: 0, id: grunt.id });
  assert.deepEqual(
    click(10, 6),
    { kind: "attack", of: 0, id: grunt.id },
    "a tile off",
  );
  assert.deepEqual(click(3, 6), { kind: "move", x: 3, y: 6 }, "a friend");
  assert.deepEqual(click(12, 1), { kind: "attack", of: 2, id: TINY.fort1 });
  assert.deepEqual(
    click(6, 6),
    { kind: "move", x: 6, y: 6 },
    "a neutral turret",
  );
  assert.deepEqual(click(9, 6, LEFT), { kind: "attack", of: 0, id: grunt.id });
  assert.equal(friend.owner, 0);
  // A watcher (no seat) only ever moves, which the runtime then ignores.
  assert.equal(clickIntent(v, -1, IDLE, { x: 9, y: 6 }, RIGHT).kind, "move");
});

test("a wheel or pinch zoom anchors at the pointer and stops following, unless the pointer is on the followed hero", () => {
  const v = view(arena("brick"));
  const hero = v.heroes.find((h) => h.seat === 0)!;
  const tile = (x: number, y: number) => ({
    x: Math.floor(x / (SUB * TILE_PX)),
    y: Math.floor(y / (SUB * TILE_PX)),
  });
  const own = tile(hero.x, hero.y);
  assert.equal(zoomAnchor(v, 0, true, own, 40, 30), undefined, "on the hero");
  assert.deepEqual(zoomAnchor(v, 0, false, own, 40, 30), {
    x: 40,
    y: 30,
    world: v,
  });
  const ground = { x: (own.x + 6) % v.width, y: own.y };
  assert.deepEqual(zoomAnchor(v, 0, true, ground, 5, 6), {
    x: 5,
    y: 6,
    world: v,
  });
  assert.ok(zoomAnchor(v, 1, true, own, 5, 6), "someone else's hero");
  assert.ok(zoomAnchor(v, 0, true, undefined, 5, 6), "off the map");
  // A pinch zooms by how far the fingers spread and about their midpoint.
  const a = { x: 100, y: 100 },
    b = { x: 200, y: 100 };
  assert.deepEqual(pinchZoom(a, b, { x: 50, y: 100 }, { x: 250, y: 140 }), {
    factor: Math.hypot(200, 40) / 100,
    x: 150,
    y: 120,
  });
  assert.equal(pinchZoom(a, a, a, b), undefined, "no spread to compare");
});

test("A arms an attack-move: a left click sends it, a right click cancels", () => {
  assert.deepEqual(keyAction("a"), { kind: "attackMove" });
  const v = view(arena("brick"));
  const armed: Mode = { kind: "attackMove" };
  assert.deepEqual(clickIntent(v, 0, armed, { x: 9, y: 6 }, LEFT), {
    kind: "attackMove",
    x: 9,
    y: 6,
  });
  assert.deepEqual(clickIntent(v, 0, armed, { x: 9, y: 6 }, RIGHT), {
    kind: "cancel",
  });
});

test("a self spell casts at once; an aimed one arms aiming, and pressing it again disarms", () => {
  const v = view(arena("vix"));
  // Vix: Snipe (unit), Cloak (self), Sticky Mine (point).
  assert.deepEqual(pressSpell(v, 0, IDLE, 1, true), {
    mode: IDLE,
    cast: { x: 4, y: 6 },
  });
  const aiming = pressSpell(v, 0, IDLE, 2, true).mode;
  assert.deepEqual(aiming, { kind: "aim", slot: 2 });
  assert.deepEqual(pressSpell(v, 0, aiming, 2, true).mode, IDLE);
  assert.deepEqual(pressSpell(v, 0, aiming, 0, true).mode, {
    kind: "aim",
    slot: 0,
  });
  assert.deepEqual(
    pressSpell(v, 0, IDLE, 2, false),
    { mode: IDLE },
    "not ready",
  );
});

test("aiming: a point spell casts on a tile in reach and waits on one beyond; a unit spell needs a valid target", () => {
  const world = arena("vix");
  const grunt = addUnit(world, 1, "grunt", 9, 6);
  addUnit(world, 0, "grunt", 5, 7);
  const v = view(world);
  const mine: Mode = { kind: "aim", slot: 2 };
  assert.deepEqual(clickIntent(v, 0, mine, { x: 7, y: 6 }, LEFT), {
    kind: "cast",
    slot: 2,
    x: 7,
    y: 6,
  });
  assert.deepEqual(clickIntent(v, 0, mine, { x: 9, y: 6 }, LEFT), {
    kind: "none",
  });
  assert.deepEqual(clickIntent(v, 0, mine, { x: 7, y: 6 }, RIGHT), {
    kind: "cancel",
  });
  const snipe: Mode = { kind: "aim", slot: 0 };
  assert.deepEqual(clickIntent(v, 0, snipe, { x: 9, y: 7 }, LEFT), {
    kind: "cast",
    slot: 0,
    x: 9,
    y: 7,
    target: { of: 0, id: grunt.id },
  });
  assert.deepEqual(
    clickIntent(v, 0, snipe, { x: 5, y: 7 }, LEFT),
    { kind: "none" },
    "a friend",
  );
  assert.deepEqual(
    spellTargets(v, 0, 0).map((b) => b.id),
    [grunt.id],
  );
});

test("the overlay shows the range around the hero and the area under the cursor, and marks valid targets", () => {
  const world = arena("vix");
  const grunt = addUnit(world, 1, "grunt", 9, 6);
  const v = view(world);
  const mine = overlayOf(v, 0, { kind: "aim", slot: 2 }, { x: 6, y: 6 });
  const spell = SPELL_INFO.vix[2]!;
  assert.deepEqual(mine, {
    range: spell.range,
    area: spell.radius,
    cursor: { x: centreOf(6), y: centreOf(6) },
    marks: [],
  });
  const snipe = overlayOf(v, 0, { kind: "aim", slot: 0 }, undefined);
  assert.equal(snipe.range, SPELL_INFO.vix[0]!.range);
  assert.deepEqual(
    snipe.marks.map((m) => [m.x, m.y]),
    [[grunt.x, grunt.y]],
  );
  // Idle, the overlay marks only the enemy under the cursor.
  assert.equal(overlayOf(v, 0, IDLE, { x: 9, y: 6 }).marks.length, 1);
  assert.equal(overlayOf(v, 0, IDLE, { x: 3, y: 3 }).marks.length, 0);
});

test("a spell's tooltip names it, says what it does and lists its numbers", () => {
  assert.deepEqual(spellTooltip(SPELL_INFO.vix[0]!), {
    name: "SNIPE",
    desc: SPELL_INFO.vix[0]!.desc,
    stats: "35 energy · 8s cooldown · range 12 tiles · radius 3 tiles",
    aim: "unit target",
  });
  assert.equal(
    spellTooltip(SPELL_INFO.brick[3]!).stats,
    "100 energy · 90s cooldown · instant · unlocks at level 6",
  );
  assert.equal(
    spellTooltip(SPELL_INFO.brick[2]!).stats,
    "Passive · radius 6 tiles",
  );
  assert.deepEqual(
    [SPELL_INFO.brick[3]!, SPELL_INFO.brick[2]!, SPELL_INFO.tally[0]!].map(
      (spell) => spellTooltip(spell).aim,
    ),
    ["instant", "passive", "ground target"],
  );
});

test("the target panel shows what the hero shoots, chosen or picked, and nothing when it shoots nothing", () => {
  const world = arena("brick");
  assert.equal(targetPanel(view(world), 0), null);
  addUnit(world, 1, "lightTank", 7, 6, 325);
  assert.deepEqual(targetPanel(view(world), 0), {
    name: "LIGHT TANK",
    hp: 0.5,
    team: 1,
    chosen: false,
    kind: "lightTank",
  });
  Object.assign(world.heroes[0]!, { focusOf: 2, focus: TINY.fort1 });
  const fort = targetPanel(view(world), 0)!;
  assert.deepEqual([fort.name, fort.chosen, fort.hp], ["FORT", true, 1]);
});

test("a new chosen target pulses once, fading over PULSE_MS", () => {
  const pulse = new TargetPulse();
  const fort = { of: "building", id: 4, chosen: true };
  assert.equal(pulse.of(null, 0), 0);
  assert.equal(pulse.of(fort, 1000), 1);
  assert.equal(pulse.of(fort, 1000 + PULSE_MS / 2), 0.5);
  assert.equal(pulse.of(fort, 1000 + PULSE_MS), 0);
  assert.equal(
    pulse.of({ ...fort, chosen: false }, 2000),
    0,
    "picked, not chosen",
  );
  assert.equal(pulse.of(fort, 3000), 1, "chosen again");
});

test("aiming ends with the hero, and a cloaked hero or an enemy factory is never attacked", () => {
  const world = arena("vix", 1, "vix");
  const aim: Mode = { kind: "aim", slot: 2 };
  assert.equal(modeFor(view(world), 0, aim), aim);
  assert.equal(modeFor(view(world), -1, aim), IDLE, "watching");
  assert.equal(modeFor(undefined, 0, aim), IDLE, "between matches");
  world.heroes[0]!.hp = 0;
  assert.equal(modeFor(view(world), 0, aim), IDLE, "dead");
  const live = arena("brick", 1, "vix");
  const foe = { hp: 300, respawn: 0, x: centreOf(9), y: centreOf(6) };
  Object.assign(live.heroes[1]!, foe);
  const at = (x: number, y: number) =>
    clickIntent(view(live), 0, IDLE, { x, y }, RIGHT).kind;
  assert.equal(at(9, 6), "attack");
  live.heroes[1]!.cloak = 5;
  assert.equal(at(9, 6), "move", "cloaked");
  const site = map.sites[TINY.robotFactory]!;
  live.sectors[site.sector] = 1;
  assert.equal(at(site.x, site.y), "move", "a factory is taken, not shot");
});

test("REPAIR BEAM's marks are the engine's: a hurt friendly factory is one, and the cast heals it", () => {
  const world = arena("rivet");
  const site = map.sites[TINY.robotFactory]!;
  world.sectors[site.sector] = 0;
  const factory = world.buildings.find((b) => b.id === TINY.robotFactory)!;
  factory.hp -= 100;
  const marks = spellTargets(view(world), 0, 0).map((b) => [b.of, b.id]);
  assert.deepEqual(marks, [[2, TINY.robotFactory]]);
  const aim: Mode = { kind: "aim", slot: 0 };
  const intent = clickIntent(view(world), 0, aim, site, LEFT);
  assert.ok(intent.kind === "cast" && intent.target);
  const { slot, x, y, target } = intent;
  const healed = step(map, world, [
    { seat: 0, type: "cast", slot, x, y, ...target },
  ]);
  const after = healed.buildings.find((b) => b.id === TINY.robotFactory)!;
  assert.ok(after.hp > factory.hp);
});

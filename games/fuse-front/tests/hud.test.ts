import test from "node:test";
import assert from "node:assert/strict";
import {
  KITS,
  STEPS_PER_SECOND,
  SUB,
  TILE_PX,
  UNITS,
  UNIT_CAP,
  clockRate,
  createWorld,
  levelXp,
  maxHp,
  viewOf,
  type World,
} from "../src/engine/index.js";
import { mapById } from "../src/online/maps.js";

const MAP = mapById("dust-basin");
import {
  createHud,
  deriveHud,
  factoriesOf,
  factoryAt,
  factoryPanel,
  heroTile,
  keyAction,
  ZOOM_STEP,
} from "../src/app/hud-state.js";
import { cameraBox, centreOn } from "../src/render/camera.js";
import { minimapBase, paintMinimap } from "../src/render/minimap.js";
import { Img } from "../src/render/pixel/image.js";

const fresh = (): World => createWorld(MAP, [0, 1], 1);

test("the HUD derives cooldown seconds, the locked ultimate, bars and the stance", () => {
  const world = fresh();
  const hero = world.heroes[0]!;
  hero.spells[0] = Math.round(2.5 * STEPS_PER_SECOND);
  hero.xp = levelXp(2) + 25;
  world.step = 75 * STEPS_PER_SECOND;
  const hud = deriveHud(createHud(), viewOf(MAP, world), 0);
  const [q, w, e, r] = hud.spells;
  assert.equal(q!.seconds, 3, "2.5 s left reads 3");
  assert.ok(q!.shade > 0 && q!.shade < 1);
  assert.equal(w!.ready, hero.energy >= KITS.brick[1]!.energy);
  assert.equal(e!.ready, false, "a passive is never cast");
  assert.deepEqual([r!.locked, r!.ultimate, r!.ready], [true, true, false]);
  assert.equal(hud.level, 2);
  assert.equal(hud.xp, 25 / (levelXp(3) - levelXp(2)));
  assert.equal(hud.hp, hero.hp / maxHp(2));
  assert.equal(hud.hpNow, Math.ceil(hero.hp), "the bar's number");
  assert.equal(hud.energyNow, Math.floor(hero.energy));
  assert.equal(hud.stance, world.players[0]!.stance);
  assert.equal(hud.time, "1:15");
  hero.xp = levelXp(6);
  assert.equal(deriveHud(hud, viewOf(MAP, world), 0).spells[3]!.locked, false);
  hero.hp = 0;
  hero.respawn = STEPS_PER_SECOND * 4;
  const dead = deriveHud(hud, viewOf(MAP, world), 0);
  assert.equal(dead.respawn, 4);
  assert.equal(dead.hpNow, 0);
  assert.ok(dead.spells.every((s) => !s.ready));
});

test("the HUD names the slots from the seat's own hero's kit", () => {
  const world = createWorld(MAP, [0, 1], 1, { 0: "rivet", 1: "tally" });
  const hud = deriveHud(createHud(), viewOf(MAP, world), 0);
  assert.equal(hud.kind, "rivet");
  assert.deepEqual(
    hud.spells.map((s) => s.name),
    KITS.rivet.map((s) => s.name),
  );
  const tally = deriveHud(hud, viewOf(MAP, world), 1);
  assert.deepEqual(
    tally.spells.map((s) => [s.effect, s.passive]),
    KITS.tally.map((s) => [s.effect, s.passive]),
  );
  assert.equal(tally.hp, 1, "full on its own kind's hit points");
});

test("the sector meter counts red, neutral and blue, and the clock follows this team", () => {
  const world = fresh();
  world.sectors.fill(-1);
  [world.sectors[0], world.sectors[1], world.sectors[2]] = [0, 0, 1];
  const view = viewOf(MAP, world);
  const out = createHud();
  const [spells, q] = [out.spells, out.spells[0]];
  const red = deriveHud(out, view, 0);
  const counts = [red.red, red.neutral, red.blue];
  assert.deepEqual(counts, [2, world.sectors.length - 3, 1]);
  assert.equal(red.clock, clockRate(2));
  // Deriving fills the same record and slots rather than allocating new ones.
  assert.ok(red === out && out.spells === spells && out.spells[0] === q);
  assert.equal(deriveHud(out, view, 1).clock, clockRate(1));
});

test("the factory panel lists choices, the current order, progress and ETA, and pauses at the cap", () => {
  const world = fresh();
  const view = viewOf(MAP, world);
  const mine = factoriesOf(view, 0);
  assert.ok(mine.length > 0 && mine.every((b) => b.kind.endsWith("Factory")));
  const robot = mine.find((b) => b.kind === "robotFactory")!;
  assert.equal(
    factoryAt(view, { x: robot.x, y: robot.y - 1 }, 0)?.id,
    robot.id,
  );
  assert.equal(factoryAt(view, robot, 1), undefined, "not another seat's");
  const building = world.buildings.find((b) => b.id === robot.id)!;
  building.order = "torch";
  building.progress = (UNITS.torch.build * 100) / 2;
  let sectors = 0;
  for (const owner of world.sectors)
    if (owner >= 0 && owner % 2 === 0) sectors++;
  const panel = factoryPanel(viewOf(MAP, world), robot.id, 0)!;
  assert.deepEqual(panel.choices, ["grunt", "torch"]);
  assert.deepEqual([panel.order, panel.progress], ["torch", 500]);
  const left = Math.ceil((UNITS.torch.build * 100) / 2 / clockRate(sectors));
  assert.equal(panel.eta, Math.ceil(left / STEPS_PER_SECOND));
  assert.equal(panel.paused, false);
  assert.equal(factoryPanel(viewOf(MAP, world), robot.id, 1), undefined);
  const unit = { kind: "grunt", owner: 0, x: 0, y: 0, hp: 1 } as const;
  for (let id = 0; id < UNIT_CAP; id++)
    world.units.push({ ...unit, id } as World["units"][0]);
  assert.equal(factoryPanel(viewOf(MAP, world), robot.id, 0)!.paused, true);
});

test("keys map to casts, stances, recentre and close; spells aim at the hero's tile", () => {
  assert.deepEqual(keyAction("q"), { kind: "cast", slot: 0 });
  assert.deepEqual(keyAction("R"), { kind: "cast", slot: 3 });
  assert.deepEqual(keyAction("2"), { kind: "stance", stance: "hold" });
  assert.deepEqual(keyAction(" "), { kind: "recentre" });
  assert.deepEqual(keyAction("Escape"), { kind: "close" });
  assert.equal(keyAction("4"), undefined);
  assert.equal(keyAction("y"), undefined);
  // Camera keys: F follows like Space, Z/+ zoom in and X/- out a step, Home and Tab jump.
  assert.deepEqual(keyAction("F"), { kind: "recentre" });
  for (const key of ["z", "Z", "+", "="])
    assert.deepEqual(keyAction(key), { kind: "zoom", factor: ZOOM_STEP });
  for (const key of ["x", "-"])
    assert.deepEqual(keyAction(key), { kind: "zoom", factor: 1 / ZOOM_STEP });
  assert.deepEqual(keyAction("Home"), { kind: "home" });
  assert.deepEqual(keyAction("Tab"), { kind: "fight" });
  const world = fresh();
  const hero = world.heroes[0]!;
  const tile = (sub: number) => Math.floor(sub / SUB / TILE_PX);
  assert.deepEqual(heroTile(viewOf(MAP, world), 0), {
    x: tile(hero.x),
    y: tile(hero.y),
  });
  hero.hp = 0;
  assert.equal(heroTile(viewOf(MAP, world), 0), undefined);
});

test("a minimap click centres the camera, clamped, and the camera box is in map fractions", () => {
  const view = { w: 200, h: 100, scale: 2 };
  assert.deepEqual(centreOn(0.5, 0.5, view, 800, 400), { x: 300, y: 150 });
  assert.deepEqual(centreOn(0, 0, view, 800, 400), { x: 0, y: 0 });
  assert.deepEqual(centreOn(1, 1, view, 800, 400), { x: 600, y: 300 });
  const box = cameraBox({ x: 400, y: 100 }, view, 800, 400);
  assert.deepEqual(box, { x: 0.5, y: 0.25, w: 0.25, h: 0.25 });
});

test("the minimap is one pixel per tile, tinted by the owning team", () => {
  const world = fresh();
  world.sectors.fill(-1);
  world.sectors[0] = 1;
  const view = viewOf(MAP, world);
  const base = minimapBase(view);
  assert.deepEqual([base.w, base.h], [MAP.width, MAP.height]);
  const out = paintMinimap(new Img(base.w, base.h), base, view);
  // A sector-0 tile clear of buildings (heroes stand at forts), so only the tint changes it.
  const far = (i: number, b: { x: number; y: number }) =>
    Math.abs((i % view.width) - b.x) + Math.abs(((i / view.width) | 0) - b.y) >
    6;
  const at = view.sectorOf.findIndex(
    (s, i) => s === 0 && view.buildings.every((b) => far(i, b)),
  );
  const px = (img: Img) => [...img.d.slice(at * 4, at * 4 + 3)];
  assert.ok(px(out)[2]! > px(base)[2]!, "blue-held ground reads bluer");
});

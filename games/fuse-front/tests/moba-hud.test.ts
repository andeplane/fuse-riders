/** v3 M6's HUD: structure and camp views, wave upgrades, minimap marks and structure pings. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  NEUTRAL,
  SUB,
  TILE_PX,
  createWorld,
  step,
  viewOf,
  type CombatEvent,
  type World,
  type WorldView,
} from "../src/engine/index.js";
import { mapById } from "../src/online/maps.js";
import { upgradesOf } from "../src/app/hud-state.js";
import { PING_GAP, Radar } from "../src/app/radar.js";
import {
  campTip,
  minimapBase,
  minimapMarks,
  paintMinimap,
} from "../src/render/minimap.js";
import { Img } from "../src/render/pixel/image.js";

const MAP = mapById("neon-duel");
const TILE = SUB * TILE_PX;
const fresh = (): World => step(MAP, createWorld(MAP, [0, 1], 1));
const lane = (v: WorldView, team: number, tier: number) =>
  v.buildings.find((b) => b.lane === 0 && b.team === team && b.tier === tier)!;
const raze = (world: World, id: number) =>
  (world.buildings.find((b) => b.id === id)!.hp = 0);

test("a lane structure is shielded while the one in front stands, and the fort while every gate does", () => {
  const world = fresh();
  let v = viewOf(MAP, world);
  const [outer, inner, gate] = [lane(v, 1, 0), lane(v, 1, 1), lane(v, 1, 2)];
  const fort = () =>
    v.buildings.find((b) => b.kind === "fort" && b.team === 1)!;
  assert.deepEqual(
    [outer.shielded, inner.shielded, gate.shielded],
    [false, true, true],
  );
  assert.equal(fort().shielded, true);
  for (const b of [outer, inner, gate]) raze(world, b.id);
  v = viewOf(MAP, world);
  assert.equal(fort().shielded, false, "no gate stands");
});

test("camps read guarded, then a respawn countdown once their guards fall", () => {
  const world = fresh();
  let v = viewOf(MAP, world);
  assert.ok(v.camps.length > 0 && v.campRespawn.every((t) => t === 0));
  const camp = v.camps[0]!;
  assert.equal(campTip(v, camp), "Jungle camp: guarded");
  world.units = world.units.filter((u) => u.owner !== NEUTRAL);
  v = viewOf(MAP, step(MAP, world));
  assert.ok(v.campRespawn.every((t) => t > 0));
  assert.match(campTip(v, { x: camp.x + 2, y: camp.y })!, /back in \d+s/);
  assert.equal(campTip(v, { x: -10, y: -10 }), undefined);
});

test("a held jungle factory shows its wave upgrade for its team only", () => {
  const world = fresh();
  const factory = viewOf(MAP, world).buildings.find((b) =>
    b.kind.endsWith("Factory"),
  )!;
  assert.deepEqual(
    upgradesOf(viewOf(MAP, world), 0),
    [],
    "a neutral sector gives none",
  );
  world.sectors[factory.sector] = 0;
  const [up] = upgradesOf(viewOf(MAP, world), 0);
  assert.equal(up?.id, factory.id);
  assert.match(
    up!.badge,
    factory.kind === "robotFactory" ? /^\+TORCH MID$/ : /^\+TANK MID$/,
  );
  assert.match(up!.tip, /mid wave/);
  assert.deepEqual(upgradesOf(viewOf(MAP, world), 1), []);
  assert.deepEqual(
    upgradesOf(viewOf(MAP, world), -1),
    [],
    "a watcher has none",
  );
});

test("the minimap marks structures (hollow once razed), camps, units and heroes, this seat's highlighted", () => {
  const world = fresh();
  const outer = lane(viewOf(MAP, world), 1, 0);
  raze(world, outer.id);
  const marks = minimapMarks(viewOf(MAP, world), 0);
  const of = (kind: string) => marks.filter((m) => m.kind === kind);
  const slots = MAP.lanes.length * 2 * 3;
  assert.equal(of("structure").length, slots, "two towers and a gate a side");
  assert.deepEqual(
    of("structure").filter((m) => m.down),
    [
      {
        kind: "structure",
        x: outer.x,
        y: outer.y,
        team: 1,
        down: true,
        self: false,
      },
    ],
  );
  assert.equal(of("fort").length, 2);
  assert.equal(of("camp").length, MAP.camps.length);
  assert.equal(of("unit").length, 0, "camp guards are the camps' marks");
  assert.deepEqual(
    of("hero").map((m) => m.self),
    [true, false],
  );
  // Painted: a standing tower is solid in its team's colour, a razed one only an outline around open ground.
  const view = viewOf(MAP, world);
  const base = minimapBase(view);
  const img = paintMinimap(new Img(base.w, base.h), base, view, 0);
  const rgb = (x: number, y: number) => [...img.sample(x, y)].slice(0, 3);
  const standing = lane(view, 1, 1);
  assert.deepEqual(rgb(standing.x, standing.y), [140, 190, 255]);
  assert.deepEqual(rgb(outer.x - 1, outer.y), [140, 190, 255]);
  assert.notDeepEqual(rgb(outer.x, outer.y), [140, 190, 255], "hollow");
});

const shot = (
  from: number,
  of: "unit" | "hero" | "building",
  id: number,
  x = 0,
  y = 0,
): CombatEvent => ({
  type: "shot",
  from: { of: "hero", id: from, x, y },
  to: { of, id, x, y },
  damage: 10,
});

test("a tower or the fort of ours under fire pings once per gap, deduped; the enemy's does not", () => {
  const v = viewOf(MAP, fresh());
  const radar = new Radar();
  const ours = lane(v, 0, 0),
    fort = v.buildings.find((b) => b.kind === "fort" && b.team === 0)!;
  const fire = (s: number, id: number, seat = 0) =>
    radar.event(
      "m",
      { step: s, event: shot(1, "building", id, TILE, TILE) },
      v,
      seat,
    );
  assert.deepEqual(fire(10, ours.id), {
    x: ours.x + 0.5,
    y: ours.y + 0.5,
    kind: "tower",
  });
  assert.equal(fire(10, ours.id), undefined, "a repeat");
  assert.equal(fire(20, ours.id), undefined, "within the gap");
  assert.equal(fire(10 + PING_GAP, ours.id)?.kind, "tower");
  assert.equal(fire(30, fort.id)?.kind, "fort");
  assert.equal(fire(40, ours.id, 1), undefined, "not the other side's");
  assert.equal(fire(50, fort.id, -1), undefined, "nor a watcher's");
  const factory = v.buildings.find((b) => b.kind.endsWith("Factory"))!;
  const held = { ...v, buildings: [{ ...factory, team: 0, owner: 0 }] };
  const shotAt = { step: 60, event: shot(1, "building", factory.id) };
  assert.equal(radar.event("m", shotAt, held, 0), undefined, "nor a factory");
});

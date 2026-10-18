import test from "node:test";
import assert from "node:assert/strict";
import {
  SUB,
  TILE_PX,
  createWorld,
  viewOf,
  type CombatEvent,
  type WorldView,
} from "../src/engine/index.js";
import { mapById } from "../src/online/maps.js";
import { PING_GAP, Radar, homeOf, minimapTile } from "../src/app/radar.js";

const TILE = SUB * TILE_PX;
const MAP = mapById("iron-delta");
const view = (): WorldView => viewOf(MAP, createWorld(MAP, [0, 1], 1));
const shot = (x: number, y: number): CombatEvent => ({
  type: "shot",
  from: { of: "unit", id: 1, x: x * TILE, y: y * TILE },
  to: { of: "unit", id: 2, x: x * TILE, y: y * TILE },
  damage: 1,
});

test("a minimap point maps to the tile under it, kept on the map", () => {
  assert.deepEqual(minimapTile(0, 0, 256, 192), { x: 0, y: 0 });
  assert.deepEqual(minimapTile(0.5, 0.25, 256, 192), { x: 128, y: 48 });
  assert.deepEqual(minimapTile(1, 1, 256, 192), { x: 255, y: 191 });
  assert.deepEqual(minimapTile(-0.2, 1.3, 256, 192), { x: 0, y: 191 });
});

test("Home finds this side's living fort; a watcher has none", () => {
  const world = view();
  const red = homeOf(world, 0)!,
    blue = homeOf(world, 1)!;
  const fort = (team: number) =>
    world.buildings.find((b) => b.kind === "fort" && b.team === team)!;
  assert.deepEqual(red, { x: fort(0).x + 0.5, y: fort(0).y + 0.5 });
  assert.deepEqual(blue, { x: fort(1).x + 0.5, y: fort(1).y + 0.5 });
  assert.equal(homeOf(world, -1), undefined);
});

test("a flag of ours under fire pings once per gap, however often rollback repeats the shot", () => {
  const world = view();
  const flag = { ...world.flags[0]!, owner: 0, team: 0 };
  const ours = { ...world, flags: [flag, ...world.flags.slice(1)] };
  const radar = new Radar();
  radar.watch(ours);
  const at = shot(flag.x + 2, flag.y + 1);
  const ping = radar.event("m", { step: 10, event: at }, ours, 0);
  assert.deepEqual(ping, { x: flag.x + 0.5, y: flag.y + 0.5, kind: "attack" });
  assert.equal(radar.event("m", { step: 10, event: at }, ours, 0), undefined);
  const again = shot(flag.x, flag.y);
  assert.equal(
    radar.event("m", { step: 20, event: again }, ours, 0),
    undefined,
  );
  assert.ok(radar.event("m", { step: 10 + PING_GAP, event: again }, ours, 0));
  // The other side sees no ping for a flag that is not its own, nor does a shot far from any flag ping.
  assert.equal(
    radar.event("m", { step: 30, event: shot(flag.x, flag.y + 1) }, ours, 1),
    undefined,
  );
});

test("a capture pings only when the enemy takes a flag that was ours", () => {
  const world = view();
  const flag = world.flags[0]!;
  const radar = new Radar();
  const owned = (team: number) => ({
    ...world,
    flags: [{ ...flag, owner: team, team }, ...world.flags.slice(1)],
  });
  radar.watch(owned(0));
  const taken = { type: "capture", sector: flag.sector, seat: 1 } as const;
  assert.deepEqual(radar.event("m", { step: 5, event: taken }, owned(1), 0), {
    x: flag.x + 0.5,
    y: flag.y + 0.5,
    kind: "lost",
  });
  // The world showing the capture may be watched before its event arrives: still a loss.
  const late = new Radar();
  late.watch(owned(0));
  late.watch(owned(1));
  const lost = late.event("m", { step: 5, event: taken }, owned(1), 0);
  assert.equal(lost?.kind, "lost");
  // Blue taking it again from neutral is no loss of ours, and blue sees no ping for its own capture.
  radar.watch(owned(-1));
  assert.equal(
    radar.event("m", { step: 9, event: taken }, owned(1), 0),
    undefined,
  );
  assert.equal(
    radar.event("m", { step: 10, event: taken }, owned(1), 1),
    undefined,
  );
});

test("Tab finds the newest fight near our side and centres on its cluster", () => {
  const world = view();
  const radar = new Radar();
  assert.equal(radar.fight(world, 0), undefined);
  const hero = world.heroes.find((h) => h.team === 0)!;
  const hx = hero.x / TILE,
    hy = hero.y / TILE;
  radar.event("m", { step: 1, event: shot(hx + 1, hy) }, world, 0);
  radar.event("m", { step: 2, event: shot(hx + 3, hy) }, world, 0);
  // A newer shot far from every red body does not steal Tab.
  radar.event("m", { step: 3, event: shot(hx + 60, hy + 40) }, world, 0);
  const spot = radar.fight(world, 0)!;
  assert.ok(Math.abs(spot.x - (hx + 2)) < 1e-9 && Math.abs(spot.y - hy) < 1e-9);
  // Watching, Tab follows the newest shot of all.
  assert.deepEqual(radar.fight(world, -1), { x: hx + 60, y: hy + 40 });
});

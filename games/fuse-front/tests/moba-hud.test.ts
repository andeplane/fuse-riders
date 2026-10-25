/** v3 M6's HUD: structure and camp views, upgrades, the scoreboard, minimap marks and the feed's pop-ups and notices. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  GOLD,
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
import { MatchFeed } from "../src/app/feed.js";
import { PING_GAP, Radar } from "../src/app/radar.js";
import { scoreOf } from "../src/app/scoreboard.js";
import type { SlotView } from "../src/app/model.js";
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
const SLOTS: SlotView[] = [0, 1].map((slot) => ({
  slot,
  team: slot,
  name: slot ? "Bot" : "Ann",
  bot: slot === 1,
  difficulty: "normal",
  self: slot === 0,
  hero: "brick",
  picked: false,
}));

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

test("the scoreboard counts razed enemy towers, held jungle, levels, items, gold and the tally", () => {
  const world = fresh();
  const v0 = viewOf(MAP, world);
  raze(world, lane(v0, 1, 0).id);
  const jungle = v0.flags.find(
    (f) =>
      !v0.buildings.some((b) => b.kind === "fort" && b.sector === f.sector),
  )!;
  world.sectors[jungle.sector] = 1;
  const hero = world.heroes[0]!;
  hero.items = [0, ...hero.items.slice(1)];
  const tally = (seat: number) => ({
    kills: seat,
    deaths: 1 - seat,
    assists: 2,
  });
  const score = scoreOf(viewOf(MAP, world), SLOTS, tally);
  assert.deepEqual(
    [score.towers, score.jungle],
    [
      [1, 0],
      [0, 1],
    ],
  );
  const [you, bot] = score.rows;
  assert.deepEqual(
    [you!.name, you!.self, you!.kills, you!.deaths, you!.assists],
    ["You", true, 0, 1, 2],
  );
  assert.equal(bot!.name, "AI normal");
  assert.equal(you!.gold, world.heroes[0]!.gold);
  assert.ok(you!.items[0]!.length > 0 && you!.items[1] === "");
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
const death = (
  id: number,
  owner: number,
  kind: "torch" | "sentry" = "torch",
): CombatEvent => ({
  type: "death",
  id,
  kind,
  owner,
  x: 5 * TILE,
  y: 6 * TILE,
});

test("a last hit pops its gold once, however often rollback delivers it; a friend's unit or a miss pops none", () => {
  const v = viewOf(MAP, fresh());
  const feed = new MatchFeed();
  const at = (s: number, event: CombatEvent) =>
    feed.event("m", { step: s, event }, v, 0);
  at(10, shot(0, "unit", 7));
  assert.deepEqual(at(10, death(7, 1)).float, {
    text: `+${GOLD.lastHit.torch}`,
    x: 5 * TILE,
    y: 6 * TILE,
  });
  assert.deepEqual(at(10, death(7, 1)), {}, "a repeat is dropped");
  at(11, shot(0, "unit", 8));
  assert.deepEqual(
    at(12, death(8, 1)),
    {},
    "another step's death was someone else's blow",
  );
  at(13, shot(0, "unit", 9));
  assert.equal(
    at(13, death(9, NEUTRAL, "sentry")).float?.text,
    `+${GOLD.guard}`,
  );
  at(14, shot(0, "unit", 3));
  assert.deepEqual(at(14, death(3, 0)), {}, "not our own");
});

test("hero deaths tally kills, deaths and assists, notify this seat, and reset with the match", () => {
  // Seats 0 and 2 (red) against 1: 2 hits 1, then 0 kills it with 2 close by.
  const world = createWorld(mapById("twin-wilds"), [0, 1, 2, 3], 1);
  const v = viewOf(mapById("twin-wilds"), world);
  const near = v.heroes.find((h) => h.seat === 2)!;
  const feed = new MatchFeed();
  const at = (s: number, event: CombatEvent, seat = 0) =>
    feed.event("m", { step: s, event }, v, seat);
  at(5, shot(2, "hero", 1));
  const kill: CombatEvent = {
    type: "heroDeath",
    seat: 1,
    killer: 0,
    x: near.x,
    y: near.y,
  };
  assert.deepEqual(at(9, kill).notice, { text: "KILL · BRICK", good: true });
  assert.deepEqual(
    [feed.tally(0).kills, feed.tally(1).deaths, feed.tally(2).assists],
    [1, 1, 1],
  );
  const back: CombatEvent = {
    type: "heroDeath",
    seat: 2,
    killer: 1,
    x: 0,
    y: 0,
  };
  assert.match(
    feed.event("m", { step: 20, event: back }, v, 2).notice!.text,
    /^Destroyed by /,
  );
  at(5 + GOLD.assistWindow + 40, shot(2, "hero", 3));
  const late: CombatEvent = {
    type: "heroDeath",
    seat: 3,
    killer: 0,
    x: near.x,
    y: near.y,
  };
  assert.equal(
    feed.event("m", { step: 9 + GOLD.assistWindow * 3, event: late }, v, 2)
      .notice,
    undefined,
  );
  assert.equal(feed.tally(2).assists, 1, "a hit past the window is no assist");
  feed.event("next", { step: 1, event: shot(0, "unit", 1) }, v, 0);
  assert.deepEqual(feed.tally(0), { kills: 0, deaths: 0, assists: 0 });
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

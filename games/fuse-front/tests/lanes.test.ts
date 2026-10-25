import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  LANE_SLOT_REACH,
  createWorld,
  loadMap,
  traceLine,
  viewOf,
  type Lane,
  type MapFile,
  type Tile,
} from "../src/engine/index.js";
import { connectivityFault, formatMap } from "../tools/mapgen/generate.js";
import { generateLanes, laneWalkSeconds } from "../tools/mapgen/lanes.js";
import { LANE_TEMPLATES } from "../tools/mapgen/templates.js";
import { tiny, tinyFile } from "./fixtures/maps.js";

const generated = new Map(
  Object.entries(LANE_TEMPLATES).map(([id, t]) => [id, generateLanes(t)]),
);
const loaded = new Map([...generated].map(([id, file]) => [id, loadMap(file)]));
/** A fresh copy of the 2v2 lane map's file to break. */
const twin = (): MapFile =>
  JSON.parse(JSON.stringify(generated.get("twin-wilds"))) as MapFile;

test("the lane generator is deterministic, and the committed lane maps are what it generates", () => {
  for (const [id, template] of Object.entries(LANE_TEMPLATES)) {
    const text = formatMap(generated.get(id)!);
    assert.equal(formatMap(generateLanes(template)), text, id);
    const other = generateLanes({ ...template, seed: template.seed + 1 });
    assert.notDeepEqual(other.terrain, generated.get(id)!.terrain, id);
    const committed = readFileSync(
      new URL(`../maps/${id}.json`, import.meta.url),
      "utf8",
    );
    assert.equal(committed, text, `maps/${id}.json: run tools/mapgen.ts`);
    assert.deepEqual(JSON.parse(text), generated.get(id), "round-trips");
  }
});

test("lane maps: 1 or 3 lanes, a jungle sector per non-home flag with a camp and a factory, everything joined", () => {
  for (const [id, template] of Object.entries(LANE_TEMPLATES)) {
    const map = loaded.get(id)!;
    assert.equal(map.width, template.size);
    assert.equal(generated.get(id)!.forts.length, template.players);
    assert.deepEqual(
      map.lanes.map((lane) => lane.name),
      template.lanes === 1 ? ["mid"] : ["top", "mid", "bot"],
    );
    const homes = map.sectorKinds.filter((kind) => kind === "home").length;
    assert.equal(homes, template.players, id);
    assert.equal(map.flags.length - homes, template.jungle, id);
    assert.equal(map.camps.length, template.jungle, id);
    for (const lane of map.lanes)
      for (const side of lane.sides) assert.equal(side.towers.length, 2);
    assert.equal(connectivityFault(map), undefined, id);
    // The river: water, crossed by a ford where mid crosses it.
    assert.ok(map.terrain.join("").includes("~"));
  }
  const three = loaded.get("crown-jungle")!;
  assert.ok(three.terrain.join("").includes("="), "top and bot bridge it");
});

test("a grunt walks each lane end to end in about 60–90 s", () => {
  for (const [id, map] of loaded)
    for (const lane of map.lanes) {
      const seconds = laneWalkSeconds(map, lane);
      assert.ok(
        seconds > 45 && seconds < 110,
        `${id} ${lane.name}: ${seconds}`,
      );
    }
});

/** The 2v2 lane map's file broken by `edit`, which gets the file and its mid lane. */
function broken(edit: (file: MapFile, mid: Lane) => void): MapFile {
  const file = twin();
  edit(file, file.lanes![1]!);
  return file;
}
/** The tiles of a lane's first leg. */
function leg(lane: Lane): Tile[] {
  const tiles: Tile[] = [];
  traceLine(lane.path[0]!, lane.path[1]!, (x, y) => tiles.push({ x, y }) > 0);
  return tiles;
}
/** An open tile within `reach` of `from` that no flag, site, camp or slot holds and that `ok` accepts. */
function freeNear(
  file: MapFile,
  from: Tile,
  reach: number,
  ok = (_: Tile) => true,
): Tile {
  const slots = (file.lanes ?? []).flatMap((l) =>
    l.sides.flatMap((s) => [...s.towers, s.gate]),
  );
  const held = [
    ...file.flags,
    ...file.buildings,
    ...file.forts,
    ...(file.camps ?? []),
    ...slots,
  ];
  const taken = new Set(held.map((t) => `${t.x},${t.y}`));
  for (let dy = -reach; dy <= reach; dy++)
    for (let dx = -reach; dx <= reach; dx++) {
      const t = { x: from.x + dx, y: from.y + dy };
      if (
        file.terrain[t.y]?.[t.x] === "." &&
        !taken.has(`${t.x},${t.y}`) &&
        ok(t)
      )
        return t;
    }
  throw new Error("no free tile");
}

test("lane maps are their own half turn: the loader checks terrain, flags, sites, camps, lanes and slots", () => {
  for (const file of generated.values()) assert.equal(file.symmetry, "rotate");
  const cases: [(file: MapFile, mid: Lane) => void, RegExp][] = [
    [(f) => void (f.symmetry = "mirror"), /symmetry: terrain/],
    [
      (f) => void (f.camps![0] = freeNear(f, f.camps![0]!, 1)),
      /symmetry: the camp/,
    ],
    [
      (f, mid) =>
        void (mid.sides[1]!.gate = freeNear(f, mid.sides[1]!.gate, 1)),
      /the mid lane has no image/,
    ],
  ];
  for (const [edit, error] of cases)
    assert.throws(() => loadMap(broken(edit)), error);
});

test("the view carries the lanes, their slots and the camps for the renderers", () => {
  const map = loaded.get("twin-wilds")!;
  const view = viewOf(map, createWorld(map, [0, 1, 2, 3], 1));
  assert.equal(view.lanes, map.lanes);
  assert.equal(view.camps, map.camps);
  assert.deepEqual(tiny().lanes, [], "a map without lanes has none");
  assert.ok(tiny().sectorKinds.every((kind) => kind !== "jungle"));
});

test("the loader refuses broken lanes with a clear error, and old maps without lanes still load", () => {
  const cases: [(file: MapFile, mid: Lane) => unknown, RegExp][] = [
    [(f) => (f.lanes = {} as never), /lanes: 1 to 3/],
    [(f) => (f.lanes![0]!.name = "mid"), /a second mid lane/],
    [
      (_, mid) => (mid.path = Array.from({ length: 33 }, () => mid.path[0]!)),
      /2 to 32 waypoints/,
    ],
    [
      (_, mid) => (mid.path[0] = { x: 0, y: 0 }),
      /waypoint 0: \(0, 0\) is not walkable/,
    ],
    [(_, mid) => mid.path.reverse(), /not further from team 0's fort/],
    [
      (_, mid) => mid.path.splice(1, 0, mid.path[0]!),
      /waypoint 1: not further/,
    ],
    [
      (f, mid) => {
        const cut = leg(mid)[60]!;
        f.terrain[cut.y] =
          `${f.terrain[cut.y]!.slice(0, cut.x)}#${f.terrain[cut.y]!.slice(cut.x + 1)}`;
      },
      /straight way from waypoint 0 is blocked/,
    ],
    [
      (_, mid) => (mid.path[0] = leg(mid)[40]!),
      /runs from a team 0 fort to a team 1 fort/,
    ],
    [(_, mid) => mid.sides.pop(), /a side per team/],
    [
      (_, mid) => mid.sides[0]!.towers.push({ x: 1, y: 1 }),
      /2 towers and a gate/,
    ],
    [
      (_, mid) => mid.sides[0]!.towers.reverse(),
      /tower 1: not nearer its base/,
    ],
    [
      (_, mid) => mid.sides.reverse(),
      /team 0 tower 0: on the other team's side/,
    ],
    [
      (f, mid) => f.flags.push(mid.sides[0]!.towers[0]!),
      /team 0 tower 0: .* is already flag 16/,
    ],
    [
      (f, mid) => {
        const line = leg(mid);
        const far = (t: Tile) =>
          line.every(
            (p) =>
              Math.max(Math.abs(p.x - t.x), Math.abs(p.y - t.y)) >
              LANE_SLOT_REACH,
          );
        mid.sides[0]!.towers[0] = freeNear(
          f,
          mid.sides[0]!.towers[0]!,
          12,
          far,
        );
      },
      /tower 0: more than 4 tiles from its lane/,
    ],
    [
      (f, mid) => f.flags.push(freeNear(f, leg(mid)[50]!, 2)),
      /flag 16: .* is on lane ground/,
    ],
    [(f) => f.camps!.pop(), /a jungle sector holds one camp and a factory/],
    [(f) => delete f.camps, /camps: a list/],
    [
      (f) => (f.camps![0] = { x: 999, y: 0 }),
      /camp 0: \(999, 0\) is off the map/,
    ],
  ];
  for (const [edit, error] of cases)
    assert.throws(() => loadMap(broken(edit)), error);
  assert.doesNotThrow(() => loadMap(twin()), "the untouched map loads");
  assert.throws(
    () => loadMap({ ...tinyFile(), camps: [] }),
    /camps: only on a map with lanes/,
  );
});

test("a lane template the generator cannot honour is refused up front", () => {
  const base = LANE_TEMPLATES["twin-wilds"]!;
  assert.throws(() => generateLanes({ ...base, size: 175 }), /size/);
  assert.throws(() => generateLanes({ ...base, jungle: 7 }), /jungle/);
});

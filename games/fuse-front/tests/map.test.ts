import test from "node:test";
import assert from "node:assert/strict";
import {
  MapError,
  loadMap,
  sectorAt,
  terrainAt,
  walkable,
  type MapFile,
} from "../src/engine/index.js";
import { TINY, dustBasin, tiny, tinyFile } from "./fixtures/maps.js";

test("Dust Basin loads: 96×56, 15–18 sectors, a fort per seat with its team on its side of the river", () => {
  const map = dustBasin();
  assert.equal(map.name, "Dust Basin");
  assert.equal(map.width, 96);
  assert.equal(map.height, 56);
  assert.ok(map.flags.length >= 15 && map.flags.length <= 18);
  const forts = map.sites.filter((site) => site.kind === "fort");
  assert.deepEqual(
    forts.map((fort) => fort.seat),
    [0, 1, 2, 3, 4, 5],
  );
  for (const fort of forts)
    assert.equal(
      fort.x < map.width / 2,
      fort.seat % 2 === 0,
      `fort ${fort.seat}`,
    );
  for (const kind of ["robotFactory", "vehicleFactory", "turret"])
    assert.ok(
      map.sites.some((site) => site.kind === kind),
      kind,
    );
  // The river splits the map, crossed by a bridge.
  const rows = map.terrain.join("");
  assert.ok(rows.includes("~") && rows.includes("="));
  for (const [index, flag] of map.flags.entries())
    assert.equal(sectorAt(map, flag.x, flag.y), index);
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++)
      assert.equal(
        sectorAt(map, x, y) >= 0,
        walkable(terrainAt(map, x, y)),
        `(${x}, ${y})`,
      );
  assert.ok(Object.isFrozen(map) && Object.isFrozen(map.sites[0]));
});

test("sectors: each tile goes to the nearest flag by walking distance, and a site to its tile's sector", () => {
  const map = tiny();
  // The rock between the homes and the middle bends the paths around it.
  assert.equal(sectorAt(map, 1, 1), 0);
  assert.equal(sectorAt(map, 12, 1), 1);
  assert.equal(sectorAt(map, 6, 4), 2);
  assert.equal(sectorAt(map, 0, 0), -1);
  assert.equal(map.sites[TINY.robotFactory]!.sector, TINY.middle);
  assert.equal(map.sites[TINY.vehicleFactory]!.sector, TINY.southEast);
  assert.deepEqual(map.sites[TINY.robotFactory]!.door, { x: 7, y: 6 });
  assert.deepEqual(
    [TINY.fort0, TINY.fort1, TINY.fort2].map((id) => map.sites[id]!.seat),
    [0, 1, 2],
  );
});

const strip = (flags: { x: number; y: number }[]): MapFile => ({
  name: "Strip",
  width: 9,
  height: 8,
  terrain: [
    "#########",
    "#.......#",
    "#.......#",
    "#.......#",
    "#.......#",
    "#.......#",
    "#.......#",
    "#########",
  ],
  flags,
  buildings: [],
  forts: [
    { seat: 0, x: 1, y: 1 },
    { seat: 1, x: 7, y: 1 },
  ],
});

test("sectors: a tile equally near two flags goes to the lower flag index, whichever side it is on", () => {
  const one = loadMap(
    strip([
      { x: 2, y: 4 },
      { x: 6, y: 4 },
    ]),
  );
  assert.equal(sectorAt(one, 4, 4), 0);
  const other = loadMap(
    strip([
      { x: 6, y: 4 },
      { x: 2, y: 4 },
    ]),
  );
  assert.equal(sectorAt(other, 4, 4), 0);
  assert.equal(sectorAt(other, 3, 4), 1);
});

test("sectors: a diagonal step does not cut a rock's corner", () => {
  const file = strip([
    { x: 1, y: 1 },
    { x: 7, y: 6 },
  ]);
  file.terrain = [
    "#########",
    "#..#....#",
    "#..#....#",
    "###.....#",
    "#.......#",
    "#.......#",
    "#.......#",
    "#########",
  ];
  file.forts = [
    { seat: 0, x: 2, y: 1 },
    { seat: 1, x: 6, y: 6 },
  ];
  const map = loadMap(file);
  // (3, 3) touches (2, 2) diagonally, but the rock on both sides of the corner closes it.
  assert.equal(sectorAt(map, 3, 3), 1);
  assert.equal(sectorAt(map, 2, 2), 0);
});

const bad: [string, (file: MapFile) => unknown, RegExp][] = [
  ["a non-object", () => [], /JSON object/],
  ["a tiny width", (f) => ({ ...f, width: 4 }), /width and height/],
  ["a missing row", (f) => ({ ...f, terrain: f.terrain.slice(1) }), /10 rows/],
  [
    "a short row",
    (f) => ({ ...f, terrain: [...f.terrain.slice(0, 9), "###"] }),
    /row 9: 14 characters/,
  ],
  [
    "unknown terrain",
    (f) => ({
      ...f,
      terrain: f.terrain.map((r, y) => (y === 4 ? r.replace(".", "x") : r)),
    }),
    /unknown terrain 'x'/,
  ],
  ["no flags", (f) => ({ ...f, flags: [] }), /flags: 1 to/],
  [
    "a flag off the map",
    (f) => ({ ...f, flags: [...f.flags, { x: 20, y: 1 }] }),
    /off the map/,
  ],
  [
    "a flag on rock",
    (f) => ({ ...f, flags: [...f.flags, { x: 6, y: 3 }] }),
    /not walkable/,
  ],
  [
    "two flags on a tile",
    (f) => ({ ...f, flags: [...f.flags, { x: 2, y: 2 }] }),
    /already flag 0/,
  ],
  [
    "a building on rock",
    (f) => ({ ...f, buildings: [{ kind: "turret", x: 0, y: 5 }] }),
    /not open ground/,
  ],
  [
    "an unknown building",
    (f) => ({ ...f, buildings: [{ kind: "castle", x: 4, y: 5 }] }),
    /unknown kind castle/,
  ],
  [
    "a fort among the buildings",
    (f) => ({ ...f, buildings: [{ kind: "fort", x: 4, y: 5 }] }),
    /unknown kind fort/,
  ],
  [
    "a factory with its door in rock",
    (f) => ({ ...f, buildings: [{ kind: "robotFactory", x: 6, y: 2 }] }),
    /door \(6, 3\) is not walkable/,
  ],
  [
    "a factory with its door in a building",
    (f) => ({
      ...f,
      buildings: [
        { kind: "robotFactory", x: 4, y: 5 },
        { kind: "turret", x: 4, y: 6 },
      ],
    }),
    /its door is building 1/,
  ],
  [
    "a seat with two forts",
    (f) => ({ ...f, forts: [...f.forts, { seat: 0, x: 4, y: 8 }] }),
    /seat 0 has two forts/,
  ],
  [
    "a seventh seat",
    (f) => ({ ...f, forts: [...f.forts, { seat: 6, x: 4, y: 8 }] }),
    /seat 6 is not/,
  ],
  [
    "no east fort",
    (f) => ({ ...f, forts: f.forts.filter((fort) => fort.seat !== 1) }),
    /seats 0 and 1/,
  ],
  [
    "two forts in one sector",
    (f) => ({ ...f, forts: [...f.forts, { seat: 3, x: 3, y: 1 }] }),
    /shares home sector 0 with fort 0/,
  ],
  [
    "a walled-off pocket",
    (f) => ({
      ...f,
      terrain: [
        ...f.terrain.slice(0, 3),
        "#..#####.....#",
        "#..#.#.......#",
        "#..###.......#",
        ...f.terrain.slice(6),
      ],
    }),
    /\(4, 4\) is walkable but no flag reaches it/,
  ],
];

for (const [label, change, message] of bad)
  test(`a map with ${label} is refused`, () => {
    assert.throws(
      () => loadMap(change(tinyFile())),
      (error: unknown) => {
        assert.ok(error instanceof MapError);
        assert.match(error.message, message);
        return true;
      },
    );
  });

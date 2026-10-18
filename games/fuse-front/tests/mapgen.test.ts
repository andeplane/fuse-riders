import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { loadMap, type MapFile } from "../src/engine/index.js";
import {
  connectivityFault,
  formatMap,
  generate,
  imageOf,
  type Template,
} from "../tools/mapgen/generate.js";
import { TEMPLATES } from "../tools/mapgen/templates.js";
import { tinyFile } from "./fixtures/maps.js";

const generated = new Map(
  Object.entries(TEMPLATES).map(([id, template]) => [id, generate(template)]),
);

test("the generator is deterministic: a template gives the same bytes, another seed another map", () => {
  for (const [id, template] of Object.entries(TEMPLATES)) {
    assert.equal(formatMap(generate(template)), formatMap(generated.get(id)!));
    const other = generate({ ...template, seed: template.seed + 1 });
    assert.notDeepEqual(other.terrain, generated.get(id)!.terrain, id);
  }
});

test("each generated map loads, at its template's size, seats, biome and flag count", () => {
  for (const [id, template] of Object.entries(TEMPLATES)) {
    const file = generated.get(id)!;
    const map = loadMap(file);
    assert.equal(map.width, template.width);
    assert.equal(map.height, template.height);
    assert.equal(map.biome, template.biome);
    assert.equal(file.forts.length, template.players);
    assert.ok(
      map.flags.length >= 30 && map.flags.length <= 50,
      `${id}: ${map.flags.length} flags`,
    );
    const kinds = new Set(file.buildings.map((b) => b.kind));
    for (const kind of ["robotFactory", "vehicleFactory", "turret"] as const)
      assert.ok(kinds.has(kind), `${id} has a ${kind}`);
    assert.deepEqual(JSON.parse(formatMap(file)), file, "the JSON round-trips");
  }
});

/** Every tile, flag, building and fort of the west half has its image on the east, seat 2k's fort seat 2k + 1's. */
function assertSymmetric(file: MapFile, template: Template): void {
  const key = (x: number, y: number) => `${x},${y}`;
  for (let y = 0; y < file.height; y++)
    for (let x = 0; x < file.width; x++) {
      const to = imageOf(template, x, y);
      assert.equal(file.terrain[y]![x], file.terrain[to.y]![to.x], key(x, y));
    }
  const flags = new Set(file.flags.map((f) => key(f.x, f.y)));
  for (const flag of file.flags) {
    const to = imageOf(template, flag.x, flag.y);
    assert.ok(flags.has(key(to.x, to.y)), `flag ${key(flag.x, flag.y)}`);
  }
  const buildings = new Map(file.buildings.map((b) => [key(b.x, b.y), b.kind]));
  for (const building of file.buildings) {
    const to = imageOf(template, building.x, building.y);
    assert.equal(buildings.get(key(to.x, to.y)), building.kind);
  }
  const forts = new Map(file.forts.map((f) => [f.seat, f]));
  for (const fort of file.forts) {
    const to = imageOf(template, fort.x, fort.y);
    const partner = forts.get(fort.seat ^ 1)!;
    assert.deepEqual([partner.x, partner.y], [to.x, to.y], `fort ${fort.seat}`);
  }
}

test("generated maps are symmetric by mirror or half turn, so both teams get the same ground", () => {
  for (const [id, template] of Object.entries(TEMPLATES))
    assertSymmetric(generated.get(id)!, template);
  const turned = Object.values(TEMPLATES).find((t) => t.symmetry === "rotate");
  const mirrored = Object.values(TEMPLATES).find(
    (t) => t.symmetry === "mirror",
  );
  assert.ok(turned && mirrored, "both symmetries are exercised");
});

test("sectors split the ground evenly between the halves, and each factory stands by its sector's flag", () => {
  for (const [id, template] of Object.entries(TEMPLATES)) {
    const file = generated.get(id)!;
    const map = loadMap(file);
    const flagIndex = new Map(map.flags.map((f, i) => [`${f.x},${f.y}`, i]));
    let uneven = 0,
      tiles = 0;
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++) {
        const sector = map.sectorOf[y * map.width + x]!;
        if (sector < 0) continue;
        tiles++;
        const to = imageOf(template, x, y);
        const flag = map.flags[sector]!;
        const image = imageOf(template, flag.x, flag.y);
        const mirrored = flagIndex.get(`${image.x},${image.y}`);
        if (map.sectorOf[to.y * map.width + to.x] !== mirrored) uneven++;
      }
    // A tie between a flag and its image goes to the lower index (`loadMap`): only a half turn can make one.
    const limit = template.symmetry === "mirror" ? 0 : tiles / 500;
    assert.ok(uneven <= limit, `${id}: ${uneven} of ${tiles} tiles`);
    for (const site of map.sites)
      if (site.kind === "robotFactory" || site.kind === "vehicleFactory") {
        const flag = map.flags[site.sector]!;
        const reach = Math.max(
          Math.abs(flag.x - site.x),
          Math.abs(flag.y - site.y),
        );
        assert.ok(
          reach <= 4,
          `${id}: factory ${site.id} is ${reach} tiles from its flag`,
        );
      }
  }
});

test("every fort and flag of a generated map is reachable from fort 0 by the engine's own flow fields", () => {
  for (const [id, file] of generated)
    assert.equal(connectivityFault(loadMap(file)), undefined, id);
});

test("the connectivity check catches a fort walled off from the rest", () => {
  const file = tinyFile();
  file.terrain = file.terrain.map((row, y) =>
    y === 0 || y === 9 ? row : `${row.slice(0, 8)}#${row.slice(9)}`,
  );
  assert.equal(connectivityFault(loadMap(file)), "fort 1 is cut off");
});

test("a template the generator cannot honour is refused up front", () => {
  const base = TEMPLATES["rust-canyon"]!;
  assert.throws(() => generate({ ...base, width: 191 }), /width/);
  assert.throws(() => generate({ ...base, flags: 33 }), /flags/);
  assert.throws(() => generate({ ...base, players: 6, height: 40 }), /height/);
});

test("the committed maps are exactly what their templates generate (`tools/mapgen.ts --check`)", () => {
  for (const [id, file] of generated) {
    const committed = readFileSync(
      new URL(`../maps/${id}.json`, import.meta.url),
      "utf8",
    );
    assert.equal(
      committed,
      formatMap(file),
      `maps/${id}.json: run tools/mapgen.ts`,
    );
  }
});

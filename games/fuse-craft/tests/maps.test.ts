import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  createMatch,
  loadMap,
  neighbors,
  step,
  type MapDefinition,
} from "../src/engine/index.ts";
import { BUNDLED_MAP_IDS, ROOM_MAPS, bundledMap } from "../src/online/maps.ts";
import { homeCellOrder } from "../src/engine/map.ts";

const files = readdirSync(new URL("../maps/", import.meta.url)).filter((f) =>
  f.endsWith(".json"),
);
const load = (file: string) =>
  loadMap(
    JSON.parse(
      readFileSync(new URL(`../maps/${file}`, import.meta.url), "utf8"),
    ),
  );

test("at least eight playable maps ship, bundled for rooms and listed for play", () => {
  const catalog = readFileSync(
    new URL("../src/app/map-repository.ts", import.meta.url),
    "utf8",
  );
  assert.ok(files.length >= 8);
  for (const file of files) {
    const map = load(file);
    assert.equal(`${map.id}.json`, file);
    assert.ok(BUNDLED_MAP_IDS.includes(map.id), `${map.id} is bundled`);
    assert.ok(bundledMap(map.id));
    assert.ok(catalog.includes(`id: "${map.id}"`), `${map.id} is listed`);
    const room = ROOM_MAPS.find((entry) => entry.id === map.id);
    assert.equal(room?.seats, map.spawns.length);
  }
  const seats = new Set(ROOM_MAPS.map((m) => m.seats));
  assert.ok(seats.has(2) && seats.has(4) && seats.has(6));
});

test("every seat on a map gets the same opening: deposits in reach and open ground", () => {
  for (const file of files) {
    const map = load(file);
    // Seats in the same symmetry class match exactly; a mixed map (corners
    // and flanks) may differ by one step to its nearest deposits.
    const openings = map.spawns.map((s) => opening(map, s.cellIndex));
    const nearest = openings.map((o) => o.deposits.slice(0, 2).join(","));
    const reach = openings.map((o) => o.deposits.length);
    assert.equal(
      new Set(reach).size,
      1,
      `${map.id}: every seat can reach every deposit`,
    );
    const firstTwo = openings.map((o) => o.deposits[1]!);
    assert.ok(
      Math.max(...firstTwo) - Math.min(...firstTwo) <= 1,
      `${map.id}: second-nearest deposits ${nearest.join(" / ")}`,
    );
  }
});

test("the generated maps are exactly symmetric", () => {
  for (const id of [
    "twin-hemispheres",
    "synapse-islands",
    "cortex-crossing",
    "grand-cortex",
  ]) {
    const map = load(`${id}.json`);
    const { width: W, height: H, cells } = map;
    const kind = (i: number) => {
      const cell = cells[i]!;
      return cell.terrain === "deposit"
        ? `deposit:${cell.resourceKind}`
        : cell.terrain;
    };
    if (H % 2 === 0) {
      for (let i = 0; i < cells.length; i++)
        assert.equal(kind(i), kind(cells.length - 1 - i), `${id} ${i}`);
    } else {
      for (let r = 0; r < H; r++)
        for (let c = 0; c < W; c++) {
          const i = r * W + c;
          assert.equal(kind(i), kind((H - 1 - r) * W + c), `${id} ${i}`);
          const mirrored = r & 1 ? W - 2 - c : W - 1 - c;
          if (mirrored >= 0) assert.equal(kind(i), kind(r * W + mirrored));
          else assert.equal(cells[i]!.terrain, "blocked");
        }
    }
  }
});

test("a full table of players starts and runs on every multi-seat map", () => {
  for (const file of files) {
    const map = load(file);
    const roster = map.spawns.map((s) => ({ id: `p${s.slot}`, slot: s.slot }));
    let w = createMatch(map, { matchId: map.id }, roster);
    for (let i = 0; i < 40; i++) w = step(w);
    assert.equal(w.players.length, map.spawns.length);
    for (const p of w.players) {
      assert.ok(p.alive);
      assert.ok(p.territory >= 7, `${map.id} ${p.id} claims its start`);
    }
  }
});

function opening(map: MapDefinition, from: number) {
  const seen = new Map([[from, 0]]);
  const queue = [from];
  for (const cell of queue)
    for (const n of neighbors(map, cell)) {
      if (seen.has(n) || map.cells[n]!.terrain === "blocked") continue;
      seen.set(n, seen.get(cell)! + 1);
      if (map.cells[n]!.terrain === "open") queue.push(n);
    }
  return {
    deposits: [...seen]
      .filter(([cell]) => map.cells[cell]!.terrain === "deposit")
      .map(([, steps]) => steps)
      .sort((a, b) => a - b),
  };
}

test("every seat breaks ties the same way as its mirror image", () => {
  for (const file of files) {
    const map = load(file);
    const { width: W, height: H } = map;
    const point = (i: number) => map.cells.length - 1 - i;
    const vertical = (i: number) => (H - 1 - Math.floor(i / W)) * W + (i % W);
    const horizontal = (i: number) => {
      const r = Math.floor(i / W),
        c = i % W;
      const m = r & 1 ? W - 2 - c : W - 1 - c;
      return m < 0 ? -1 : r * W + m;
    };
    const home = (slot: number) =>
      map.spawns.find((s) => s.slot === slot)!.cellIndex;
    const mirrors = H % 2 ? [vertical, horizontal] : [point];
    for (const a of map.spawns)
      for (const mirror of mirrors) {
        const b = map.spawns.find((s) => s.cellIndex === mirror(home(a.slot)));
        if (!b || b === a) continue;
        // Compare a sample of cell pairs through the mirror.
        for (let i = 0; i < map.cells.length; i += 7)
          for (let j = 3; j < map.cells.length; j += 11) {
            const [mi, mj] = [mirror(i), mirror(j)];
            if (mi < 0 || mj < 0 || i === j) continue;
            assert.equal(
              Math.sign(homeCellOrder(map, a.slot, i, j)),
              Math.sign(homeCellOrder(map, b.slot, mi, mj)),
              `${map.id} seats ${a.slot}/${b.slot} cells ${i},${j}`,
            );
          }
      }
  }
});

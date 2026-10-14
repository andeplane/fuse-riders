import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { readFileSync } from "node:fs";
import {
  bloodTravel,
  heartbeat,
  HEART_MS,
  vesselMarkup,
  vesselNetwork,
  vesselPoint,
} from "../src/render/vessels.js";
import { renderBoard } from "../src/render/board.js";
import { createMatch, loadMap } from "../src/engine/index.js";

const size = { width: 1500, height: 900 };

test("the vessel network is fixed per seed and branches from arteries", () => {
  const a = vesselNetwork(size, 7);
  assert.deepEqual(vesselNetwork(size, 7), a);
  assert.notDeepEqual(vesselNetwork(size, 8), a);
  const widths = a.map((v) => v.width);
  assert.ok(Math.max(...widths) >= 3.6, "has arteries");
  assert.ok(
    widths.some((w) => w < 3),
    "and narrower branches",
  );
  for (const v of a)
    for (const [x, y] of v.points) {
      assert.ok(x > -140 && x < size.width + 140);
      assert.ok(y > -140 && y < size.height + 140);
    }
});

test("points along a vessel follow its length", () => {
  const [v] = vesselNetwork(size, 3);
  const total = v!.lengths.at(-1)!;
  assert.deepEqual(vesselPoint(v!, 0), v!.points[0]);
  assert.deepEqual(vesselPoint(v!, total * 2), v!.points.at(-1));
  const mid = vesselPoint(v!, total / 2);
  assert.ok(Number.isFinite(mid[0]) && Number.isFinite(mid[1]));
});

test("the heartbeat spikes once per beat and blood never flows backwards", () => {
  const samples = Array.from({ length: 220 }, (_, i) => i * 10);
  const beats = samples.map(heartbeat);
  assert.ok(beats.every((b) => b >= 0 && b <= 1));
  assert.ok(Math.max(...beats) > 0.9);
  assert.ok(Math.min(...beats) < 0.05);
  assert.equal(heartbeat(80), heartbeat(80 + HEART_MS));
  let previous = -Infinity;
  for (const t of samples) {
    const travel = bloodTravel(t, 30);
    assert.ok(travel >= previous, `monotonic at ${t}`);
    previous = travel;
  }
});

test("vessels render beneath the terrain without catching pointer input", () => {
  assert.match(vesselMarkup(vesselNetwork(size, 1)), /pointer-events="none"/);
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  const svg = document.querySelector("svg") as unknown as SVGSVGElement;
  const map = loadMap(
    JSON.parse(
      readFileSync(new URL("../maps/sandbox-12.json", import.meta.url), "utf8"),
    ),
  );
  renderBoard(
    svg,
    createMatch(map, {}, [{ id: "solo", slot: 0 }]),
    null,
    false,
    true,
    0,
  );
  const vessels = svg.querySelector(".vessels")!;
  assert.ok(vessels.closest(".backdrop-layer"), "drawn in the backdrop");
  assert.ok(vessels.querySelectorAll(".vessel-blood").length > 0);
  const deposit = svg.querySelector('.terrain-object[data-terrain="deposit"]')!;
  assert.match(deposit.getAttribute("data-resource") ?? "", /biomass|insight/);
  assert.match(deposit.getAttribute("style") ?? "", /--delay:-?[\d.]+s/);
});

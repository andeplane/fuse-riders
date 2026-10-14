import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { createMatch, loadMap, encodeState } from "../src/engine/index.js";
import { renderBoard, hexCenter } from "../src/render/board.js";
import {
  networkPath,
  networkPathMarkup,
  sampleNetworkPath,
} from "../src/render/network-path.js";

test("conduit endpoints and reversed travel agree along the same curve", () => {
  const path = networkPath(12, 13, 14),
    reversed = networkPath(12, 14, 13);
  for (const t of [0, 0.125, 0.5, 0.875, 1]) {
    const a = sampleNetworkPath(path, t),
      b = sampleNetworkPath(reversed, 1 - t);
    assert.equal(a.x, b.x);
    assert.equal(a.y, b.y);
    assert.ok(Math.abs(a.dx + b.dx) < 1e-9);
    assert.ok(Math.abs(a.dy + b.dy) < 1e-9);
  }
  for (const [t, cell] of [
    [0, 13],
    [1, 14],
  ]) {
    const actual = sampleNetworkPath(path, t!);
    assert.equal(actual.x, hexCenter(12, cell!).x);
    assert.equal(actual.y, hexCenter(12, cell!).y);
  }
  assert.notEqual(
    sampleNetworkPath(path, 0.5).y,
    (path.from.y + path.to.y) / 2,
  );
  const d = networkPathMarkup(path, 0.25, 0.75)
    .slice(1)
    .split(/[ Q]/)
    .map(Number);
  const midpoint = sampleNetworkPath(path, 0.5);
  assert.ok(Math.abs((d[0]! + 2 * d[2]! + d[4]!) / 4 - midpoint.x) < 1e-9);
  assert.ok(Math.abs((d[1]! + 2 * d[3]! + d[5]!) / 4 - midpoint.y) < 1e-9);
});

test("ground travelers follow their conduit, remain occluded, and respect reduced motion without changing the world", () => {
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  const svg = document.querySelector("svg") as unknown as SVGSVGElement;
  const map = loadMap(
    JSON.parse(
      readFileSync(new URL("../maps/sandbox-12.json", import.meta.url), "utf8"),
    ),
  );
  const world = createMatch(map, {}, [{ id: "solo", slot: 0 }]);
  Object.assign(world.particles[0]!, {
    mode: "transit",
    from: 13,
    to: 14,
    departedAt: 0,
    arrivesAt: 4,
  });
  world.tick = 2;
  const before = encodeState(world);
  renderBoard(svg, world, 13, false, false, 0).animate(0);
  const point = sampleNetworkPath(networkPath(12, 13, 14), 0.5);
  assert.ok(
    svg
      .querySelector(".attack-particle .moving-glyph")!
      .getAttribute("transform")!
      .startsWith(`translate(${point.x} ${point.y})`),
  );
  const layers = [...svg.children];
  assert.ok(
    layers.indexOf(svg.querySelector(".particle-layer")!) <
      layers.indexOf(svg.querySelector(".structure-layer")!),
  );
  assert.equal(
    svg.querySelector(".particle-layer")!.getAttribute("pointer-events"),
    "none",
  );
  assert.match(
    svg.querySelector(".attack-particle .particle-trail")!.getAttribute("d")!,
    /Q/,
  );
  const view = renderBoard(svg, world, 13, false, true, 0);
  view.animate(25);
  const still = svg
    .querySelector(".attack-particle .moving-glyph")!
    .getAttribute("transform");
  view.animate(49);
  assert.equal(
    svg
      .querySelector(".attack-particle .moving-glyph")!
      .getAttribute("transform"),
    still,
  );
  assert.equal(
    svg.querySelector(".attack-particle .particle-trail")!.getAttribute("d"),
    "",
  );
  assert.equal(encodeState(world), before);
});

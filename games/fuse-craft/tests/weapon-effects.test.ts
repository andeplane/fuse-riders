import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { readFileSync } from "node:fs";
import { weaponTrail } from "../src/render/weapon-trail.js";
import { combatEffect } from "../src/render/combat-effects.js";
import { shieldShell } from "../src/render/shield-shell.js";
import { siegeImpact } from "../src/render/siege-impact.js";
import { wreckCollapse } from "../src/render/wreck-collapse.js";
import { renderBoard } from "../src/render/board.js";
import { createMatch, loadMap, encodeState } from "../src/engine/index.js";

test("a collapsing silhouette retains its footprint and can seek presentation time", () => {
  const { document } = parseHTML("<html></html>");
  const art = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const wreck = wreckCollapse(document, art, { x: 100, y: 125 }, 1);
  wreck.animate(-50);
  const intact = wreck.element.outerHTML;
  wreck.animate(400);
  assert.notEqual(wreck.element.outerHTML, intact);
  assert.equal(wreck.ground.getAttribute("cy"), "125");
  const saved = wreck.element.outerHTML + wreck.ground.outerHTML;
  wreck.animate(800);
  wreck.animate(400);
  assert.equal(wreck.element.outerHTML + wreck.ground.outerHTML, saved);
  wreck.animate(850);
  assert.equal(wreck.element.getAttribute("opacity"), "0");
  wreck.animate(0);
  assert.equal(wreck.element.outerHTML, intact);
});

test("destroyed buildings retain only a cosmetic silhouette until cleanup", () => {
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  const svg = document.querySelector("svg") as unknown as SVGSVGElement;
  const map = loadMap(
    JSON.parse(
      readFileSync(new URL("../maps/sandbox-12.json", import.meta.url), "utf8"),
    ),
  );
  const world = createMatch(map, {}, [{ id: "solo", slot: 0 }]);
  const brain = world.structures[0]!;
  const survivor = {
    ...brain,
    id: world.nextEntityId++,
    cell: 13,
    kind: "tower" as const,
    hp: 100,
  };
  world.structures.push(survivor);
  renderBoard(svg, world, null, false, false, 0);
  world.structures = [survivor];
  world.tick++;
  world.outcomes = [
    { tick: world.tick, playerId: "solo", type: "destroyed", cell: brain.cell },
  ];
  const before = encodeState(world);
  const frame = renderBoard(svg, world, null, false, false, 50);
  assert.equal(svg.querySelectorAll(".combat-wreck").length, 1);
  assert.equal(svg.querySelectorAll(".structure").length, 1);
  assert.equal(
    svg.querySelector(".combat-wreck")?.parentElement?.getAttribute("class"),
    "structure-layer",
  );
  assert.equal(encodeState(world), before);
  survivor.hp = 50; // Force structure markup replacement while the wreck is active.
  const refreshed = encodeState(world);
  renderBoard(svg, world, null, false, false, 100);
  assert.equal(svg.querySelectorAll(".combat-wreck").length, 1);
  const depths = [...svg.querySelector(".structure-layer")!.children].map(
    (node) =>
      Number(node.getAttribute("data-cell") ?? node.getAttribute("data-depth")),
  );
  assert.deepEqual(
    depths,
    [...depths].sort((a, b) => a - b),
  );
  frame.animate(400);
  assert.equal(encodeState(world), refreshed);
  renderBoard(svg, world, null, false, true, 450);
  assert.equal(svg.querySelector(".combat-wreck"), null);
  assert.equal(svg.querySelector(".combat-wreck-shadow"), null);
  // A fresh renderer cannot invent a silhouette from an unobserved history.
  const fresh = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  renderBoard(fresh, world, null, false, false, 50);
  assert.equal(fresh.querySelector(".combat-wreck"), null);
});

test("Siege shell climbs above the ground line and its trail is repeatable at a given age", () => {
  const { document } = parseHTML("<html></html>");
  const trail = weaponTrail(
    document,
    { x: 0, y: 100 },
    { x: 100, y: 100 },
    "siege",
    7,
  );
  trail.animate(90);
  const head = trail.element.querySelector(".weapon-head")!;
  assert.equal(Number(head.getAttribute("cx")), 50);
  assert.ok(Number(head.getAttribute("cy")) < 81);
  assert.equal(trail.shadow.getAttribute("cx"), head.getAttribute("cx"));
  assert.equal(trail.shadow.getAttribute("cy"), "112");
  const middle = trail.element.outerHTML;
  trail.animate(140);
  assert.notEqual(trail.element.outerHTML, middle);
  trail.animate(90);
  assert.equal(trail.element.outerHTML, middle);
  trail.animate(180);
  assert.equal(head.getAttribute("cx"), "100");
  assert.equal(head.getAttribute("cy"), "90");
  assert.equal(trail.element.getAttribute("opacity"), "0");
});

test("Relay flickers between anchored endpoints and zero-length shots stay finite", () => {
  const { document } = parseHTML("<html></html>");
  const trail = weaponTrail(
    document,
    { x: 0, y: 100 },
    { x: 100, y: 100 },
    "relay",
    7,
  );
  trail.animate(0);
  const path = trail.element.querySelector(".weapon-core")!;
  const first = path.getAttribute("d");
  trail.animate(40);
  assert.notEqual(path.getAttribute("d"), first);
  assert.ok(path.getAttribute("d")!.startsWith("M0 81"));
  assert.ok(path.getAttribute("d")!.endsWith("L100 90"));
  for (const style of ["pulse", "siege", "relay"] as const) {
    const zero = weaponTrail(
      document,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      style,
      0,
    );
    for (const age of [-1, 0, 40, 200]) {
      zero.animate(age);
      assert.doesNotMatch(zero.element.outerHTML, /NaN|Infinity/);
    }
  }
});

test("impact starts at cosmetic arrival; muzzle flashes at launch", () => {
  const { document } = parseHTML("<html></html>");
  const effect = combatEffect(
    document,
    "damage",
    { x: 100, y: 100 },
    "#63cfff",
    1,
    { x: 0, y: 100 },
    { weapon: "siege" },
  );
  effect.animate(90 / effect.duration);
  assert.equal(
    effect.element
      .querySelector(".siege-impact-plume")!
      .getAttribute("opacity"),
    "0",
  );
  assert.equal(
    effect.ground.querySelector(".siege-impact-dust")!.getAttribute("opacity"),
    "0",
  );
  assert.equal(
    effect.element.querySelector(".combat-core")!.getAttribute("opacity"),
    "0",
  );
  assert.ok(
    Number(
      effect.element.querySelector(".combat-muzzle")!.getAttribute("opacity"),
    ) > 0,
  );
  effect.animate(200 / effect.duration);
  assert.equal(
    effect.element
      .querySelector(".siege-impact-plume")!
      .getAttribute("opacity"),
    "1",
  );
  assert.ok(
    Number(
      effect.element.querySelector(".combat-core")!.getAttribute("opacity"),
    ) > 0,
  );
});

test("artillery dust stays on the ground while smoke rises; seeking time preserves bounded nodes", () => {
  const { document } = parseHTML("<html></html>");
  const plume = siegeImpact(document, { x: 100, y: 100 }, 17);
  const smoke = plume.element.querySelector(".siege-impact-smoke")!;
  plume.animate(100);
  const firstHeight = Number(smoke.getAttribute("cy"));
  plume.animate(400);
  assert.ok(Number(smoke.getAttribute("cy")) < firstHeight);
  for (const puff of plume.ground.children)
    assert.ok(Number(puff.getAttribute("cy")) >= 94);
  const saved = plume.element.outerHTML + plume.ground.outerHTML;
  for (let frame = 0; frame < 300; frame++) plume.animate(frame * 3);
  plume.animate(400);
  assert.equal(plume.element.outerHTML + plume.ground.outerHTML, saved);
  assert.equal(plume.element.children.length, 7);
  assert.equal(plume.ground.children.length, 5);
  plume.animate(680);
  assert.equal(plume.element.getAttribute("opacity"), "0");
  assert.equal(plume.ground.getAttribute("opacity"), "0");
  for (const weapon of ["pulse", "relay"] as const) {
    const effect = combatEffect(
      document,
      "damage",
      { x: 0, y: 0 },
      "#63cfff",
      1,
      { x: 10, y: 0 },
      { weapon },
    );
    assert.equal(effect.element.querySelector(".siege-impact-plume"), null);
  }
});

test("shield contacts face the incoming attack and its ripple travels down a projected shell", () => {
  const { document } = parseHTML("<html></html>");
  const left = shieldShell(document, { x: 100, y: 100 }, "#63cfff", {
    x: 0,
    y: 100,
  });
  const right = shieldShell(document, { x: 100, y: 100 }, "#63cfff", {
    x: 200,
    y: 100,
  });
  assert.ok(
    Number(left.element.querySelector(".shield-contact")!.getAttribute("cx")) <
      100,
  );
  assert.ok(
    Number(right.element.querySelector(".shield-contact")!.getAttribute("cx")) >
      100,
  );
  const ripple = left.element.querySelector(".shield-ripple")!;
  left.animate(0);
  const top = Number(ripple.getAttribute("cy"));
  const narrow = Number(ripple.getAttribute("rx"));
  left.animate(0.6);
  assert.ok(Number(ripple.getAttribute("cy")) > top);
  assert.ok(Number(ripple.getAttribute("rx")) > narrow);
  assert.equal(left.element.children.length, 12);
  assert.doesNotMatch(left.element.outerHTML, /NaN|Infinity/);
});

test("a Siege gun destroyed in its firing tick retains its weapon effect without changing state", () => {
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  const svg = document.querySelector("svg") as unknown as SVGSVGElement;
  const map = loadMap(
    JSON.parse(
      readFileSync(new URL("../maps/sandbox-12.json", import.meta.url), "utf8"),
    ),
  );
  const world = createMatch(map, {}, [{ id: "solo", slot: 0 }]);
  world.structures.push({
    id: world.nextEntityId++,
    ownerId: "solo",
    cell: 13,
    kind: "siege",
    hp: 80,
    connected: true,
  });
  renderBoard(svg, world, null, false, false, 0);
  world.structures = world.structures.filter((s) => s.cell !== 13);
  world.tick++;
  world.outcomes = [
    {
      tick: world.tick,
      playerId: "solo",
      type: "damage",
      fromCell: 13,
      cell: 14,
      amount: 4,
    },
    { tick: world.tick, playerId: "solo", type: "destroyed", cell: 14 },
    {
      tick: world.tick,
      playerId: "solo",
      type: "shielded",
      cell: 14,
      fromCell: 15,
      amount: 2,
    },
  ];
  const before = encodeState(world);
  const frame = renderBoard(svg, world, null, false, false, 50);
  assert.ok(svg.querySelector(".weapon-siege"));
  assert.ok(svg.querySelector("#combat-dust"));
  assert.ok(svg.querySelector("#combat-blast-smoke"));
  frame.animate(200);
  assert.equal(
    svg.querySelector(".shield-shell")!.getAttribute("opacity"),
    "0",
  );
  for (const kind of ["destroyed", "shielded"]) {
    assert.equal(
      svg
        .querySelector(`.combat-${kind} .combat-core`)!
        .getAttribute("opacity"),
      "0",
      "paired effects wait until the incoming shell arrives",
    );
  }
  frame.animate(250);
  assert.ok(
    Number(svg.querySelector(".shield-shell")!.getAttribute("opacity")) > 0,
  );
  for (const kind of ["destroyed", "shielded"]) {
    assert.ok(
      Number(
        svg
          .querySelector(`.combat-${kind} .combat-core`)!
          .getAttribute("opacity"),
      ) > 0,
    );
  }
  assert.equal(encodeState(world), before);
  frame.animate(1400);
  assert.equal(svg.querySelector(".combat-tracer"), null);
  assert.equal(svg.querySelector(".combat-ground-light"), null);
  assert.equal(svg.querySelector(".siege-impact-plume"), null);
});

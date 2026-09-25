import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { readFileSync } from "node:fs";
import { updateContent } from "../src/app/dom-update.js";
import { createPreferencesStore } from "../src/app/preferences.js";
import { createMatch, loadMap } from "../src/engine/index.js";
import { renderBoard } from "../src/render/board.js";

test("HUD updates keep existing actionable controls alive across state changes", () => {
  const { document } = parseHTML("<html><body><aside></aside></body></html>");
  const root = document.querySelector("aside")!;
  updateContent(
    root,
    '<p>Funds 1</p><button data-action="research">Research</button><input id="priority" type="range" value="0">',
  );
  const button = root.querySelector("button"),
    input = root.querySelector("input");
  let clicks = 0;
  button!.addEventListener("click", () => clicks++);
  updateContent(
    root,
    '<p>Funds 2</p><button data-action="research">Research</button><input id="priority" type="range" value="1">',
  );
  assert.equal(root.querySelector("button"), button);
  assert.equal(root.querySelector("input"), input);
  button!.click();
  assert.equal(clicks, 1);
  assert.equal(root.querySelector("p")?.textContent, "Funds 2");
  updateContent(
    root,
    '<p>Researching</p><button data-action="cancel">Cancel</button>',
  );
  assert.equal(root.querySelectorAll("button").length, 1);
  assert.equal(root.querySelector("button")?.dataset.action, "cancel");
});

test("rendering interpolates actual transit, retains terrain and moving nodes, clears on rollback", () => {
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  const svg = document.querySelector("svg") as unknown as SVGSVGElement;
  const map = loadMap(
    JSON.parse(
      readFileSync(new URL("../maps/sandbox-12.json", import.meta.url), "utf8"),
    ),
  );
  const w = createMatch(map, {}, [{ id: "solo", slot: 0 }]);
  const particle = w.particles[0]!;
  Object.assign(particle, {
    mode: "transit",
    from: 13,
    to: 14,
    departedAt: 1,
    arrivesAt: 5,
  });
  w.tick = 2;
  renderBoard(svg, w, 13, true, false, 0).animate(25);
  const terrain = svg.querySelector(".terrain-layer"),
    moving = svg.querySelector(".attack-particle");
  const position = svg
    .querySelector(".moving-glyph")!
    .getAttribute("transform");
  assert.ok(position?.startsWith("translate("));
  assert.equal(svg.querySelectorAll(".debug-grid polygon").length, 144);
  for (const name of ["backdrop", "territory", "link", "particle", "effect"])
    assert.equal(
      svg.querySelector(`.${name}-layer`)?.getAttribute("pointer-events"),
      "none",
      "decorative layers cannot intercept tile selection",
    );
  assert.equal(svg.querySelectorAll(".backdrop-layer [data-cell]").length, 0);
  assert.equal(svg.querySelectorAll(".terrain-layer [data-cell]").length, 144);
  for (const tile of svg.querySelectorAll(".terrain-layer .hex")) {
    const outline = tile.querySelector(".hex-hover-outline")!;
    const points = (node: Element) =>
      node
        .getAttribute("points")!
        .split(" ")
        .map((point) => point.split(",").map(Number));
    const outer = points(tile.querySelector("polygon")!);
    const inner = points(outline);
    assert.equal(inner.length, 6);
    const center = outer.reduce(
      ([x, y], p) => [x! + p[0]! / 6, y! + p[1]! / 6],
      [0, 0],
    );
    for (let i = 0; i < 6; i++) {
      const radius = Math.hypot(
        inner[i]![0]! - center[0]!,
        inner[i]![1]! - center[1]!,
      );
      assert.ok(
        radius < 34,
        "entire 2px stroke stays inside its hex, clear of adjacent textures",
      );
    }
  }
  const encoded = JSON.stringify(w);
  const animation = renderBoard(svg, w, 14, true, false, 50);
  animation.animate(75);
  assert.equal(svg.querySelector(".terrain-layer"), terrain);
  assert.equal(svg.querySelector(".attack-particle"), moving);
  assert.equal(JSON.stringify(w), encoded, "rendering cannot change authority");
  w.tick = 1;
  renderBoard(svg, w, 14, true, true, 100);
  assert.notEqual(
    svg.querySelector(".terrain-layer"),
    terrain,
    "rollback clears visual caches",
  );
  assert.equal(svg.querySelector(".particle-trail")?.getAttribute("d"), "");
});

test("attack flashes use authoritative origins, deduplicate ticks and expire", () => {
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  const svg = document.querySelector("svg") as unknown as SVGSVGElement;
  const map = loadMap(
    JSON.parse(
      readFileSync(new URL("../maps/sandbox-12.json", import.meta.url), "utf8"),
    ),
  );
  const world = createMatch(map, {}, [{ id: "solo", slot: 0 }]);
  renderBoard(svg, world, null, false, false, 0);
  world.tick++;
  world.outcomes = [
    {
      tick: world.tick,
      playerId: "solo",
      type: "damage",
      fromCell: 13,
      cell: 14,
      amount: 2,
    },
  ];
  renderBoard(svg, world, null, false, false, 50);
  assert.equal(svg.querySelectorAll(".attack-flash").length, 1);
  const animation = renderBoard(svg, world, null, false, false, 60);
  assert.equal(svg.querySelectorAll(".attack-flash").length, 1);
  animation.animate(400);
  assert.equal(svg.querySelectorAll(".attack-flash").length, 0);
});

test("presentation preferences tolerate corrupt data and unavailable storage", () => {
  const store = createPreferencesStore({
    getItem: () => '{"volume":900,"mute":false,"reducedMotion":true}',
    setItem() {
      throw new Error("quota");
    },
  });
  assert.deepEqual(store.read(), {
    volume: 1,
    mute: false,
    reducedMotion: true,
  });
  assert.doesNotThrow(() => store.write(store.read()));
  assert.equal(
    createPreferencesStore({ getItem: () => "{broken", setItem() {} }).read()
      .mute,
    true,
  );
});

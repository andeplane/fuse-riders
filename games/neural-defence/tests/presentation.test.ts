import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { readFileSync } from "node:fs";
import { updateContent } from "../src/app/dom-update.js";
import { createPreferencesStore } from "../src/app/preferences.js";
import { createMatch, loadMap } from "../src/engine/index.js";
import { renderBoard } from "../src/render/board.js";
import { terrainArt, WALKABLE_GROUND } from "../src/render/terrain-art.js";
import { constructionQueueAvailability } from "../src/engine/catalog.js";

test("building status leaves artwork clear and unsupplied fragments have no supply marker", () => {
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  const svg = document.querySelector("svg") as unknown as SVGSVGElement;
  const map = loadMap(
    JSON.parse(
      readFileSync(new URL("../maps/sandbox-12.json", import.meta.url), "utf8"),
    ),
  );
  const world = createMatch(map, {}, [{ id: "solo", slot: 0 }]);
  const structure = world.structures[0]!;
  const sprites = Object.fromEntries(
    ["brain-v3", "tower-pulse-v3", "tower-siege-v3", "tower-relay-v3"].map(
      (name) => [name, `/${name}.png`],
    ),
  );
  for (const kind of ["brain", "tower", "siege", "relay"] as const) {
    structure.kind = kind;
    structure.hp = 1;
    world.tick++;
    renderBoard(svg, world, structure.cell, false, true, 0, sprites);
    const group = svg.querySelector(".structure")!;
    const art = group.querySelector(".building-art")!;
    const image = art.querySelector("image")!;
    const health = group.querySelector(".structure-hp")!;
    assert.ok(
      Number(health.getAttribute("y")) + Number(health.getAttribute("height")) <
        Number(image.getAttribute("y")),
      `${kind} health stays above its artwork`,
    );
    const supply = group.querySelector(".supply-footprint")!;
    assert.ok(supply, `${kind} shows stocked supply`);
    const painted = [...group.querySelectorAll("*")];
    assert.ok(painted.indexOf(supply) < painted.indexOf(art));
    assert.ok(Number(supply.getAttribute("opacity")) <= 0.35);
    assert.equal(group.querySelector(".charge-halo"), null);
  }
  structure.connected = false;
  world.tick++;
  renderBoard(svg, world, structure.cell, false, true, 0, sprites);
  assert.equal(svg.querySelector(".supply-footprint"), null);
});

test("arrival cues aggregate by destination beneath buildings and stop with reduced motion", () => {
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  const svg = document.querySelector("svg") as unknown as SVGSVGElement;
  const map = loadMap(
    JSON.parse(
      readFileSync(new URL("../maps/sandbox-12.json", import.meta.url), "utf8"),
    ),
  );
  const world = createMatch(map, {}, [{ id: "solo", slot: 0 }]);
  const travelers = world.particles.slice(0, 16);
  for (const p of travelers)
    Object.assign(p, {
      mode: "transit",
      from: 13,
      to: 14,
      departedAt: 0,
      arrivesAt: 1,
    });
  renderBoard(svg, world, 13, false, false, 0);
  for (const p of travelers) Object.assign(p, { mode: "stationed", cell: 14 });
  world.tick++;
  renderBoard(svg, world, 13, false, false, 50);
  assert.equal(
    svg.querySelectorAll(".arrival-pulse").length,
    1,
    "a packet of sixteen arrivals makes one cue",
  );
  const ground = svg.querySelector(".ground-effect-layer")!;
  assert.equal(ground.querySelectorAll(".arrival-pulse").length, 1);
  assert.equal(svg.querySelector(".effect-layer .arrival-pulse"), null);
  const layers = [...svg.children];
  assert.ok(
    layers.indexOf(ground) <
      layers.indexOf(svg.querySelector(".structure-layer")!),
  );
  assert.equal(
    ground.querySelector(".arrival-pulse")?.getAttribute("opacity"),
    "0.35",
  );
  // A following packet cannot stack another ring immediately.
  for (const p of travelers)
    Object.assign(p, {
      mode: "transit",
      from: 13,
      to: 14,
      departedAt: 1,
      arrivesAt: 2,
    });
  renderBoard(svg, world, 13, false, false, 75);
  for (const p of travelers) Object.assign(p, { mode: "stationed", cell: 14 });
  world.tick++;
  renderBoard(svg, world, 13, false, false, 100);
  assert.equal(svg.querySelectorAll(".arrival-pulse").length, 1);
  renderBoard(svg, world, 13, false, true, 125);
  assert.equal(svg.querySelectorAll(".arrival-pulse").length, 0);
});

test("visible terrain follows build restrictions and cannot be overridden by mismatched art", () => {
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  const svg = document.querySelector("svg") as unknown as SVGSVGElement;
  const map = loadMap(
    JSON.parse(
      readFileSync(
        new URL("../maps/skirmish-24.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const world = createMatch(map, {}, [{ id: "solo", slot: 0 }]);
  const sprites = Object.fromEntries(
    [
      WALKABLE_GROUND,
      "blocker-rock-cluster-a",
      "blocker-boulder",
      "blocker-rock-ridge-a",
      "deposit-biomass",
      "deposit-insight",
    ].map((name) => [name, `/${name}.png`]),
  );
  renderBoard(svg, world, null, false, true, 0, sprites);
  world.map.cells.forEach((cell, index) => {
    const tile = svg.querySelector(`.terrain-layer [data-cell="${index}"]`)!;
    const object = tile.querySelector(".terrain-object");
    const unavailable = constructionQueueAvailability(
      world,
      world.players[0]!,
      "neuron",
      index,
    ).missing.some((r) => r.kind === "open-cell");
    assert.equal(unavailable, cell.terrain !== "open");
    if (cell.terrain === "open") assert.equal(object, null);
    else {
      assert.ok(object);
      assert.ok(
        object?.querySelector("image"),
        `non-open tile ${index} has visible art`,
      );
      assert.equal(object.getAttribute("clip-path"), `url(#tile-${index})`);
      assert.equal(
        object.querySelector("image")?.getAttribute("href"),
        sprites[terrainArt(cell, index)!],
      );
    }
  });
  assert.equal(
    terrainArt({ terrain: "open", variant: "blocker-boulder" }, 0),
    null,
  );
  assert.equal(
    terrainArt({ terrain: "blocked", variant: WALKABLE_GROUND }, 0),
    "blocker-rock-cluster-a",
  );
  assert.equal(
    terrainArt(
      {
        terrain: "deposit",
        resourceKind: "biomass",
        variant: "deposit-insight",
      },
      0,
    ),
    "deposit-biomass",
  );
  // Missing images must never make a blocked cell look like empty ground.
  const fallback = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  ) as unknown as SVGSVGElement;
  renderBoard(fallback, world, null, false, true, 0, {});
  assert.equal(
    fallback.querySelectorAll(".terrain-blocked .terrain-object path").length,
    map.cells.filter((cell) => cell.terrain === "blocked").length,
  );
});

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
  renderBoard(svg, w, 13, false, false, 1000);
  assert.equal(
    svg.querySelector<SVGGElement>(".supply-orbit")!.style.transform,
    "rotate(72deg)",
  );
  w.structures[0]!.hp--;
  renderBoard(svg, w, 13, false, false, 1250);
  assert.equal(
    svg.querySelector<SVGGElement>(".supply-orbit")!.style.transform,
    "rotate(90deg)",
    "stock/HP markup changes must not restart orbit phase",
  );
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
  for (const name of [
    "backdrop",
    "territory",
    "link",
    "ground-effect",
    "particle",
    "effect",
  ])
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

test("neurons vary, animate without state changes, and show only real friendly links", () => {
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  const svg = document.querySelector("svg") as unknown as SVGSVGElement;
  const map = loadMap(
    JSON.parse(
      readFileSync(new URL("../maps/sandbox-12.json", import.meta.url), "utf8"),
    ),
  );
  const world = createMatch(map, {}, [{ id: "solo", slot: 0 }]);
  world.structures.push(
    {
      id: 1001,
      cell: 14,
      ownerId: "solo",
      kind: "neuron",
      hp: 60,
      connected: true,
    },
    {
      id: 1002,
      cell: 15,
      ownerId: "solo",
      kind: "neuron",
      hp: 60,
      connected: true,
    },
    {
      id: 1003,
      cell: 18,
      ownerId: "solo",
      kind: "neuron",
      hp: 60,
      connected: false,
    },
    {
      id: 1004,
      cell: 19,
      ownerId: "solo",
      kind: "neuron",
      hp: 60,
      connected: false,
    },
    {
      id: 1005,
      cell: 16,
      ownerId: "enemy",
      kind: "neuron",
      hp: 60,
      connected: true,
    },
  );
  const before = JSON.stringify(world);
  const sprites = {
    "neuron-v3": "/neuron.png",
    [WALKABLE_GROUND]: "/ground.png",
  };
  const animation = renderBoard(svg, world, null, false, false, 1000, sprites);
  assert.equal(
    svg.querySelector(".neuron-body image")?.getAttribute("href"),
    "/neuron.png",
  );
  assert.equal(
    svg.querySelector("#ground-continuation image")?.getAttribute("href"),
    "/ground.png",
  );
  assert.equal(
    svg.querySelectorAll(".ground-patch image").length,
    0,
    "ordinary tiles do not repeat textures per hex",
  );
  const links = [...svg.querySelectorAll(".network-link")].map((l) => [
    l.getAttribute("data-from"),
    l.getAttribute("data-to"),
  ]);
  assert.deepEqual(links, [
    ["13", "14"],
    ["14", "15"],
    ["18", "19"],
  ]);
  assert.equal(svg.querySelectorAll(".disconnected-link").length, 1);
  const neurons = [...svg.querySelectorAll<SVGGElement>(".neuron-body")];
  assert.notEqual(neurons[0]!.innerHTML, neurons[1]!.innerHTML);
  const transform = neurons[0]!.style.transform;
  animation.animate(1300);
  assert.notEqual(neurons[0]!.style.transform, transform);
  assert.equal(
    svg.querySelector<SVGGElement>(".disconnected .neuron-body")!.style
      .transform,
    "",
    "disconnected neurons are dormant",
  );
  const phase = neurons[0]!.style.transform;
  world.structures[1]!.hp--;
  renderBoard(svg, world, null, false, false, 1300, sprites);
  assert.equal(
    svg.querySelector<SVGGElement>(".neuron-body")!.style.transform,
    phase,
  );
  world.structures[1]!.hp++;
  assert.equal(
    JSON.stringify(world),
    before,
    "animation cannot mutate simulation",
  );
  const reduced = renderBoard(svg, world, null, false, true, 1300, sprites);
  const still = svg.querySelector<SVGGElement>(".neuron-body")!.style.transform;
  reduced.animate(1600);
  assert.equal(
    svg.querySelector<SVGGElement>(".neuron-body")!.style.transform,
    still,
  );
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

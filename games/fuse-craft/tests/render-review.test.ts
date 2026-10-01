import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  createMatch,
  encodeState,
  step,
  type MapDefinition,
  type World,
} from "../src/engine/index.js";
import { renderBoard } from "../src/render/board.js";
import {
  LIGHT_STRIDE,
  LightField,
  type LightRenderer,
  type LightTransform,
} from "../src/render/light-field.js";
import { arrangeChildren, KeyedLayer } from "../src/render/keyed-layer.js";
import {
  createWebGlLightRenderer,
  type LightCanvas,
} from "../src/render/light-canvas.js";
import type { BuildingSprites } from "../src/render/sprite-raster.js";

const WHITE = [1, 1, 1] as const;

test("combat light survives a board whose ambient light fills the budget", () => {
  const field = new LightField(100);
  field.begin();
  for (let i = 0; i < 150; i++) field.add(i, 0, 5, WHITE, 0.5);
  for (let i = 0; i < 400; i++) field.addDecor(i, i, 1, 2, WHITE, 0.5);
  field.addTransient(-1, -1, 9, [1, 0, 0], 1);
  field.flash(-2, -2, 0, 30, [1, 0.5, 0], 1, 200);
  field.step(50, false);
  assert.equal(field.size, 100, "the budget still holds");
  const xs = [...xsOf(field)];
  assert.deepEqual(
    xs.slice(0, 3),
    [-1, -2, -2],
    "the shot and both flash lights come first",
  );
  assert.ok(
    xs.slice(3).every((x) => x >= 0),
    "ambient fills what is left; decor has no room",
  );
});

test("decorative light is thinned to fit, keeping the same motes every frame", () => {
  const field = new LightField(200);
  const frame = (shift: number) => {
    field.begin();
    for (let i = 0; i < 50; i++) field.add(1000 + i, 0, 5, WHITE, 0.5);
    for (let i = 0; i < 600; i++) field.addDecor(i, i + shift, 0, 2, WHITE, 1);
    return [...xsOf(field)].filter((x) => x < 1000).map((x) => x - shift);
  };
  const first = frame(0);
  assert.equal(field.size, first.length + 50);
  assert.ok(first.length > 100 && first.length <= 150, "roughly the room");
  const spread = Math.max(...first) - Math.min(...first);
  assert.ok(spread > 500, "thinning samples the whole set, not its head");
  assert.deepEqual(frame(3), first, "moving motes keep their identity");
});

test("lights outside the view are culled before they use the budget", () => {
  const field = new LightField(10);
  const view: LightTransform = {
    ...{ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    width: 400,
    height: 300,
  };
  field.begin(view);
  field.add(200, 150, 10, WHITE, 1);
  field.add(5000, 150, 10, WHITE, 1);
  field.add(-400, -400, 10, WHITE, 1);
  field.add(-60, 150, 30, WHITE, 1); // Its glow reaches into the view.
  assert.equal(field.size, 2);
  field.begin({ ...view, width: 0, height: 0 });
  field.add(5000, 150, 10, WHITE, 1);
  assert.equal(field.size, 1, "an unmeasured view culls nothing");
});

test("flashes and sparks stay bounded while frames stop in a hidden tab", () => {
  const field = new LightField(300);
  // Ticks keep scheduling hits; no frame runs to expire them.
  for (let i = 0; i < 5000; i++) {
    field.flash(0, 0, i * 50, 10, WHITE, 1, 300);
    field.burst(0, 0, i * 50, i, {
      count: 30,
      speed: [1, 2],
      lift: [1, 2],
      life: [300, 400],
      size: [1, 2],
      hot: WHITE,
      color: WHITE,
      alpha: 1,
      sharpness: 4,
      gravity: 0,
      drag: 0,
    });
  }
  assert.ok(field.live <= 512 + 200, `live ${field.live}`);
  field.begin();
  field.step(5000 * 50, false);
  assert.ok(field.size <= 300);
  assert.ok(field.live > 0, "the latest hits still show");
});

test("a keyed layer keeps unchanged elements and moves only what is out of place", () => {
  const { document } = parseHTML(
    "<html><body><svg><g></g></svg></body></html>",
  );
  const host = document.querySelector("g") as unknown as SVGGElement;
  const layer = new KeyedLayer(host);
  const item = (key: string, text: string) => ({
    key,
    markup: `<g data-key="${key}">${text}</g>`,
  });
  const first = layer.sync([item("a", "1"), item("b", "1"), item("c", "1")]);
  assert.equal(arrangeChildren(host, first), 3);
  const records = observe(host);
  const second = layer.sync([item("a", "1"), item("b", "2"), item("c", "1")]);
  assert.equal(second[0], first[0]);
  assert.equal(second[2], first[2]);
  assert.notEqual(second[1], first[1], "a changed item is re-parsed");
  assert.equal(host.children[1], second[1], "and replaced in place");
  assert.equal(arrangeChildren(host, second), 0);
  const third = layer.sync([item("a", "1"), item("n", "1"), item("c", "1")]);
  assert.equal(arrangeChildren(host, third), 1, "only the newcomer is placed");
  assert.deepEqual(
    [...host.children].map((e) => e.getAttribute("data-key")),
    ["a", "n", "c"],
  );
  assert.equal(
    records().filter((r) => r.removed.includes("a") || r.added.includes("c"))
      .length,
    0,
    "untouched elements were never detached",
  );
});

test("construction progress rebuilds only its site, never structures or terrain", () => {
  let world = constructionWorld();
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  const svg = document.querySelector("svg") as unknown as SVGSVGElement;
  renderBoard(svg, world, null, false, false, 0);
  world = step(world);
  renderBoard(svg, world, null, false, false, 50);
  const layer = svg.querySelector(".structure-layer")!;
  const before = [...layer.children];
  assert.ok(before.some((e) => e.classList.contains("terrain-object")));
  assert.ok(before.some((e) => e.classList.contains("construction-body")));
  const records = observe(layer);
  const progress = world.players[0]!.queue[0]!.progress;
  world = step(world);
  assert.ok(world.players[0]!.queue[0]!.progress > progress);
  renderBoard(svg, world, null, false, false, 100);
  const after = [...layer.children];
  assert.equal(after.length, before.length);
  for (const [i, element] of before.entries())
    if (!element.classList.contains("construction-body"))
      assert.equal(after[i], element, `child ${i} kept`);
  const touched = records();
  assert.ok(touched.length > 0, "the site itself was rebuilt");
  for (const record of touched)
    assert.deepEqual(
      [...record.added, ...record.removed].filter((c) => c !== "site"),
      [],
      "only the construction site was replaced",
    );
});

test("a Spore pod flies to its primary target, not to a splash victim", () => {
  const world = createMatch(openMap(8, 4), {}, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
  ]);
  const spore = 9;
  world.structures.push(
    structure(world, "a", "spore", spore),
    structure(world, "b", "neuron", 12),
    structure(world, "b", "neuron", 13),
  );
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  const svg = document.querySelector("svg") as unknown as SVGSVGElement;
  renderBoard(svg, world, null, false, false, 0);
  world.tick++;
  // The engine lists hits by victim, so a splash can come before the primary.
  world.outcomes = [damage(world, 13, spore, 4), damage(world, 12, spore, 8)];
  renderBoard(svg, world, null, false, false, 50);
  const effects = [...svg.querySelectorAll(".effect-layer > .combat-damage")];
  assert.equal(effects.length, 2);
  assert.equal(effects[0]!.querySelector(".weapon-spore"), null);
  assert.ok(effects[1]!.querySelector(".weapon-spore"), "primary gets the pod");
  assert.ok(effects[0]!.querySelector(".spore-burst"), "splash still bursts");
});

test("a render measures layout once, before writing, and each frame once", () => {
  const world = constructionWorld();
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  const svg = document.querySelector("svg") as unknown as SVGSVGElement;
  let reads = 0;
  svg.getScreenCTM = () => {
    reads++;
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } as DOMMatrix;
  };
  const sprites: BuildingSprites = { resolve: () => ({}) };
  const light: LightRenderer = { draw: () => {} };
  const frame = renderBoard(
    svg,
    world,
    null,
    false,
    false,
    0,
    {},
    sprites,
    light,
  );
  assert.equal(reads, 1);
  frame.animate(16);
  assert.equal(reads, 2);
});

test("the light canvas declines a missing, lost or broken WebGL context", () => {
  assert.equal(createWebGlLightRenderer(new FakeCanvas(null), one), null);
  const throwing = new FakeCanvas(null);
  throwing.getContext = () => {
    throw new Error("blocked");
  };
  assert.equal(createWebGlLightRenderer(throwing, one), null);
  const lost = fakeGl();
  lost.lost = true;
  assert.equal(createWebGlLightRenderer(new FakeCanvas(lost.gl), one), null);
  const broken = fakeGl({ compiles: false });
  assert.equal(createWebGlLightRenderer(new FakeCanvas(broken.gl), one), null);
  assert.ok(broken.calls.includes("deleteShader"), "partial work is freed");
  assert.ok(broken.calls.includes("loseContext"), "the context is released");
});

test("the light canvas waits out a lost context and resumes on restore", () => {
  const fake = fakeGl();
  const canvas = new FakeCanvas(fake.gl);
  const renderer = createWebGlLightRenderer(canvas, one)!;
  assert.ok(renderer);
  const draw = () => {
    fake.calls.length = 0;
    renderer.draw(new Float32Array(LIGHT_STRIDE), 1, VIEW);
    return fake.calls.includes("drawArraysInstanced");
  };
  assert.ok(draw());
  const lost = new Event("webglcontextlost", { cancelable: true });
  fake.lost = true;
  canvas.dispatchEvent(lost);
  assert.ok(lost.defaultPrevented, "restoration is requested");
  assert.equal(draw(), false, "no drawing on a lost context");
  fake.lost = false;
  canvas.dispatchEvent(new Event("webglcontextrestored"));
  assert.ok(draw(), "rebuilt and drawing again");
  renderer.destroy();
  assert.ok(fake.calls.includes("deleteProgram"));
  assert.ok(fake.calls.includes("loseContext"));
  fake.lost = false;
  assert.equal(draw(), false, "a destroyed renderer draws nothing");
  const late = new Event("webglcontextlost", { cancelable: true });
  canvas.dispatchEvent(late);
  assert.equal(late.defaultPrevented, false, "its listeners are gone");
});

test("a new light canvas releases the context of one that left the page", () => {
  const old = fakeGl();
  const detached = new FakeCanvas(old.gl);
  assert.ok(createWebGlLightRenderer(detached, one));
  detached.isConnected = false;
  assert.ok(createWebGlLightRenderer(new FakeCanvas(fakeGl().gl), one));
  assert.ok(old.calls.includes("loseContext"));
});

test("the board renders combat without a light renderer", () => {
  const world = constructionWorld();
  const { document } = parseHTML("<html><body><svg></svg></body></html>");
  const svg = document.querySelector("svg") as unknown as SVGSVGElement;
  renderBoard(svg, world, null, false, false, 0);
  world.tick++;
  const brain = world.structures[0]!;
  world.outcomes = [damage(world, 2, brain.cell, 5)];
  const before = encodeState(world);
  const frame = renderBoard(svg, world, null, false, false, 50);
  frame.animate(120);
  assert.ok(svg.querySelector(".combat-damage"));
  assert.equal(encodeState(world), before);
});

const one = () => 1;
const VIEW: LightTransform = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
  width: 64,
  height: 64,
};

function xsOf(field: LightField): number[] {
  return Array.from(
    { length: field.size },
    (_, i) => field.instances[i * LIGHT_STRIDE]!,
  );
}

type Record = { added: string[]; removed: string[] };
/** Child additions and removals, by data-key or a short class tag. */
function observe(target: Element): () => Record[] {
  const window = target.ownerDocument.defaultView!;
  const records: Record[] = [];
  const tag = (node: Node): string => {
    if (!isElement(node)) return "text";
    if (node.classList.contains("construction-body")) return "site";
    return node.getAttribute("data-key") ?? node.getAttribute("class") ?? "";
  };
  const observer = new window.MutationObserver((list) => {
    for (const r of list)
      records.push({
        added: [...r.addedNodes].map(tag),
        removed: [...r.removedNodes].map(tag),
      });
  });
  observer.observe(target, { childList: true });
  return () => [
    ...records,
    ...observer.takeRecords().map((r) => ({
      added: [...r.addedNodes].map(tag),
      removed: [...r.removedNodes].map(tag),
    })),
  ];
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

function openMap(width: number, height: number): MapDefinition {
  return {
    schemaVersion: 1,
    id: "review",
    width,
    height,
    layout: "odd-r",
    cells: Array.from({ length: width * height }, () => ({ terrain: "open" })),
    spawns: [
      { slot: 0, cellIndex: 0 },
      { slot: 1, cellIndex: width * height - 1 },
    ],
  };
}

function structure(
  world: World,
  ownerId: string,
  kind: "spore" | "neuron",
  cell: number,
): World["structures"][number] {
  return {
    id: world.nextEntityId++,
    ownerId,
    kind,
    cell,
    hp: 60,
    connected: true,
  };
}

function damage(
  world: World,
  cell: number,
  fromCell: number,
  amount: number,
): World["outcomes"][number] {
  return {
    tick: world.tick,
    playerId: "a",
    type: "damage",
    cell,
    fromCell,
    amount,
  };
}

/** A network with deposits and rock beside it, building a tower. */
function constructionWorld(): World {
  const map = openMap(8, 4);
  map.cells[5] = { terrain: "deposit", resourceKind: "biomass" };
  map.cells[6] = { terrain: "blocked" };
  let world = createMatch(map, {}, [{ id: "a", slot: 0 }]);
  world.players[0]!.research = ["growth"];
  world.players[0]!.biomass = 100_000;
  for (const cell of [1, 2])
    world.structures.push(structure(world, "a", "neuron", cell));
  world = step(world, [
    {
      playerId: "a",
      sequence: 1,
      action: { type: "queueConstruction", kind: "tower", cell: 3 },
    },
  ]);
  assert.equal(
    world.outcomes.some((o) => o.type === "rejected"),
    false,
  );
  for (let i = 0; i < 400 && world.players[0]!.worker.mode !== "building"; i++)
    world = step(world);
  assert.equal(world.players[0]!.worker.mode, "building");
  return world;
}

class FakeCanvas extends EventTarget implements LightCanvas {
  width = 0;
  height = 0;
  isConnected = true;
  constructor(private readonly gl: WebGL2RenderingContext | null) {
    super();
  }
  getContext(): WebGL2RenderingContext | null {
    return this.gl;
  }
}

/** A WebGL2 stand-in that records calls; enough for the renderer's control flow. */
function fakeGl(options: { compiles?: boolean } = {}) {
  const state = { lost: false, calls: [] as string[] };
  const loseContext = {
    loseContext: () => {
      state.calls.push("loseContext");
      state.lost = true;
    },
    restoreContext: () => {},
  };
  // Only the members the renderer calls; anything else is a recorded no-op.
  const gl = new Proxy(
    {},
    {
      get(_target, name) {
        if (typeof name !== "string") return undefined;
        if (/^[A-Z0-9_]+$/.test(name)) return 0;
        return (...args: unknown[]) => {
          state.calls.push(name);
          if (name === "isContextLost") return state.lost;
          if (name === "getShaderParameter") return options.compiles ?? true;
          if (name === "getProgramParameter") return true;
          if (name === "getExtension")
            return args[0] === "WEBGL_lose_context" ? loseContext : null;
          if (name.startsWith("create")) return { name };
          return null;
        };
      },
    },
  ) as unknown as WebGL2RenderingContext;
  return Object.assign(state, { gl });
}

import test from "node:test";
import assert from "node:assert/strict";
import { createScene, effectKey } from "../src/render/scene.js";
import {
  RULES,
  createBays,
  createRulePanel,
  trainIcon,
} from "../src/render/illustrations.js";
import { hexA } from "../src/render/palette.js";
import type { MakeSurface, Paint } from "../src/render/sprites.js";
import { FX, toView, type WorldView } from "../src/engine/index.js";
import { px } from "../src/engine/math.js";
import { cart, place, playing } from "./fixtures/world.js";

/** A 2D context that records every call: enough of the canvas for the scene to draw on in Node. */
function recorder() {
  const calls: unknown[][] = [];
  const context = (): Paint => {
    const state: Record<string | symbol, unknown> = {};
    const gradient = { addColorStop: () => {} };
    return new Proxy(state, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === "createLinearGradient" || prop === "createRadialGradient")
          return () => gradient;
        if (prop === "measureText")
          return (text: string) => ({ width: text.length * 8 });
        return (...args: unknown[]) => void calls.push([prop, ...args]);
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    }) as unknown as Paint;
  };
  let made = 0;
  const make: MakeSurface = (width, height) => {
    made++;
    const g = context();
    return {
      width,
      height,
      getContext: () => g,
    } as unknown as HTMLCanvasElement;
  };
  return {
    calls,
    make,
    screen: context(),
    get made() {
      return made;
    },
    texts: () =>
      calls.filter((c) => c[0] === "fillText").map((c) => String(c[1])),
    clear: () => (calls.length = 0),
  };
}

/** A world with something of everything: trains with wagons, a full one, a guarded one, carts cooling and not. */
function crowded(): WorldView {
  const world = playing(5);
  place(world, "t0", 200, 200, 0, 3);
  place(world, "t1", 500, 300, 256, 8);
  place(world, "t2", 700, 400, 512, 2).guard = 10;
  place(world, "t3", 300, 420, 768);
  place(world, "t4", 800, 150, 100, 1);
  cart(world, 400, 200, 0);
  cart(world, 450, 250, 3, 20);
  world.fx.push({
    id: world.nextId++,
    at: world.step,
    kind: FX.collect,
    x: px(400),
    y: px(200),
    slot: 0,
    data: 1,
    other: -1,
  });
  return toView(world);
}

const cutFx = (world: WorldView, id: number): WorldView => ({
  ...world,
  fx: [
    {
      id,
      at: world.step,
      kind: "cut",
      x: 400,
      y: 300,
      slot: 0,
      data: 2,
      other: 1,
    },
  ],
});

test("the scene draws a busy depot: every train, its label, a FULL train and the carts, and paints sprites once", () => {
  const r = recorder();
  const scene = createScene(r.screen, r.make);
  const world = crowded();
  const labels = new Map(
    world.trains.map((t) => [t.id, t.id === "t0" ? "YOU" : `P${t.slot + 1}`]),
  );
  scene.draw({ world, me: "t0", labels, now: 1000 });
  const texts = r.texts();
  for (const label of ["YOU", "P2", "P3", "P4", "P5", "FULL", "DELIVER"])
    assert.ok(texts.includes(label), `drew ${label}`);
  const images = r.calls.filter((c) => c[0] === "drawImage").length;
  // A backdrop, five locomotives, fourteen wagons and two carts at least.
  assert.ok(images >= 1 + 5 + 14 + 2, `${images} blits`);
  const painted = r.made;
  r.clear();
  scene.draw({ world, me: "t0", labels, now: 1016 });
  assert.equal(r.made, painted, "the second frame paints nothing new");
});

test("an effect is drawn once, even when a rollback renumbers it; effects from before the first frame are not replayed", () => {
  const r = recorder();
  const scene = createScene(r.screen, r.make);
  const base = crowded();
  const cuts = () => r.texts().filter((t) => t.startsWith("CUT")).length;
  // On a page's first frame the cut is history.
  scene.draw({ world: cutFx(base, 900), me: "", labels: new Map(), now: 0 });
  assert.equal(cuts(), 0);
  // A new one sparks once.
  r.clear();
  const next = { ...cutFx(base, 901), step: base.step + 2 };
  next.fx[0]!.at = base.step + 30;
  scene.draw({ world: next, me: "", labels: new Map(), now: 16 });
  assert.equal(cuts(), 1);
  // The same cut under another id (a rollback renumbered it) is the same effect: still one pop-up drawn.
  r.clear();
  const renumbered = { ...next, fx: [{ ...next.fx[0]!, id: 950 }] };
  scene.draw({ world: renumbered, me: "", labels: new Map(), now: 32 });
  assert.equal(cuts(), 1);
  assert.equal(effectKey(next.fx[0]!), effectKey(renumbered.fx[0]!));
  assert.notEqual(
    effectKey(next.fx[0]!),
    effectKey({ ...next.fx[0]!, slot: 2 }),
  );
});

test("a delivery pops its count over the dock; a new round starts clean", () => {
  const r = recorder();
  const scene = createScene(r.screen, r.make);
  const world = crowded();
  scene.draw({ world, me: "", labels: new Map(), now: 0 });
  r.clear();
  const delivered: WorldView = {
    ...world,
    fx: [
      {
        id: 999,
        at: world.step,
        kind: "deliver",
        x: 100,
        y: 286,
        slot: 1,
        data: 5,
        other: 0,
      },
    ],
  };
  scene.draw({ world: delivered, me: "", labels: new Map(), now: 16 });
  assert.ok(r.texts().includes("+5"));
  r.clear();
  scene.draw({
    world: { ...delivered, seed: world.seed + 1 },
    me: "",
    labels: new Map(),
    now: 32,
  });
  assert.ok(
    !r.texts().includes("+5"),
    "the next round's first frame drops the last round's pop-ups",
  );
});

test("the pictures: every rules panel animates, the loading bays show taken and open bays, and icons paint", () => {
  for (const rule of RULES) {
    const r = recorder();
    const panel = createRulePanel(r.screen, r.make, rule);
    for (const now of [0, 1000, 2000, 3000]) panel.draw(now);
    assert.ok(r.calls.filter((c) => c[0] === "drawImage").length > 0, rule);
  }
  const r = recorder();
  const bays = createBays(r.screen, r.make);
  bays.draw(
    [0, 1, 2, 3, 4].map((slot) => ({ slot, taken: slot < 2, you: slot === 0 })),
    500,
  );
  const texts = r.texts();
  assert.deepEqual(
    texts.filter((t) => /^[1-5]$/.test(t)),
    ["1", "2", "3", "4", "5"],
  );
  assert.equal(texts.filter((t) => t === "OPEN").length, 3);
  assert.ok(texts.includes("YOU"));
  const icon = trainIcon(recorder().make, 3) as unknown as { width: number };
  assert.ok(icon.width > 0);
  assert.equal(hexA("#ff0080", 0.5), "rgba(255,0,128,0.5)");
});

test("every kind of effect draws, a cooling cart shows its ring, and reduced motion keeps the frame still", () => {
  const r = recorder();
  const scene = createScene(r.screen, r.make);
  const world = crowded();
  scene.draw({ world, me: "", labels: new Map(), now: 0, reducedMotion: true });
  const kinds = [
    "collect",
    "cut",
    "deliver",
    "bump",
    "wall",
    "spawn",
    "scrap",
  ] as const;
  const later: WorldView = {
    ...world,
    step: world.step + 1,
    fx: kinds.map((kind, i) => ({
      id: 2000 + i,
      at: world.step + 1,
      kind,
      x: 200 + i * 60,
      y: 250,
      slot: i % 5,
      data: 2,
      other: kind === "deliver" ? 1 : 0,
    })),
  };
  r.clear();
  scene.draw({
    world: later,
    me: "t0",
    labels: new Map(),
    now: 16,
    reducedMotion: true,
  });
  const texts = r.texts();
  assert.ok(
    texts.includes("+1") && texts.includes("CUT ×2!") && texts.includes("+2"),
  );
  // Reduced motion: no screen shake, so the frame is never offset.
  const shaken = r.calls.filter(
    (c) =>
      c[0] === "translate" &&
      c.length === 3 &&
      Math.abs(Number(c[1])) < 3 &&
      Number(c[1]) !== 0 &&
      Math.abs(Number(c[2])) < 3,
  );
  assert.equal(shaken.length, 0);
  // Particles age out over a few seconds of frames.
  for (let t = 32; t < 4000; t += 50)
    scene.draw({ world: later, me: "", labels: new Map(), now: t });
  r.clear();
  scene.draw({ world: later, me: "", labels: new Map(), now: 4050 });
  assert.ok(!r.texts().includes("CUT ×2!"), "the pop-ups are gone");
  // The cooling cart draws its countdown ring.
  assert.ok(r.calls.some((c) => c[0] === "arc" && c[3] === 19));
});

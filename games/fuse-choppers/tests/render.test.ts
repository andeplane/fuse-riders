import test from "node:test";
import assert from "node:assert/strict";
import { createScene, hexA } from "../src/render/scene.js";
import type { MakeSurface, Paint } from "../src/render/sprites.js";
import { toView, type WorldView } from "../src/engine/index.js";
import {
  CAMERA_END,
  EXIT_X,
  PICKUP_KINDS,
  segment,
} from "../src/engine/level.js";
import { FX } from "../src/engine/world.js";
import { px } from "../src/engine/math.js";
import { playing } from "./fixtures/world.js";

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
    /** drawImage calls whose source surface is `width` × `height` device pixels. */
    blits: (test: (width: number, height: number) => boolean) =>
      calls.filter((c) => {
        const source = c[1] as { width?: number; height?: number } | undefined;
        return (
          c[0] === "drawImage" &&
          source?.width !== undefined &&
          test(source.width, source.height!)
        );
      }).length,
  };
}

/** A world with something of everything in view. */
function crowded(): WorldView {
  const world = playing(5);
  const [a, b, c, d, e] = world.choppers;
  a!.shield = 1;
  a!.turbo = 30;
  a!.triple = 30;
  b!.stun = 20;
  b!.scramble = 30;
  b!.grace = 10;
  c!.alive = false;
  c!.cause = 0;
  c!.endedAt = world.step - 30;
  d!.exited = true;
  d!.endedAt = world.step;
  e!.face = -1;
  world.bullets.push({
    id: world.nextId++,
    owner: 0,
    x: a!.x + px(40),
    y: a!.y,
    vx: px(8),
    vy: px(1),
    life: 30,
  });
  world.bolts.push({
    id: world.nextId++,
    x: px(600),
    y: px(200),
    vx: -px(3),
    vy: px(1),
    life: 30,
  });
  world.rocks.push({
    id: world.nextId++,
    x: px(500),
    y: px(300),
    vx: px(4),
    vy: 0,
    r: px(14),
    life: 50,
  });
  world.warnings.push({ id: world.nextId++, y: px(260), at: world.step + 20 });
  world.drones.push({
    id: world.nextId++,
    x: px(700),
    y: px(240),
    baseY: px(240),
    hp: 2,
    cool: 10,
    charge: 12,
    phase: 0,
  });
  PICKUP_KINDS.forEach((_, kind) =>
    world.pickups.push({
      id: world.nextId++,
      kind,
      x: px(300 + kind * 80),
      y: px(420),
    }),
  );
  for (const kind of Object.values(FX))
    world.fx.push({
      id: world.nextId++,
      at: world.step,
      kind,
      x: px(400),
      y: px(300),
      slot: (kind % 5) - 1,
      data: kind % 5,
    });
  return toView(world);
}

test("an effect is drawn once per id, even when a rolled-back frame shows it again", () => {
  const r = recorder(),
    scene = createScene(r.screen, r.make),
    world = crowded(),
    labels = new Map([["c0", "YOU"]]);
  // The round's first frame, before anything happened; then the frame with every effect, drawn twice.
  scene.draw({ world: { ...world, fx: [] }, me: "c0", labels, now: 984 });
  scene.draw({ world, me: "c0", labels, now: 1000 });
  scene.draw({ world, me: "c0", labels, now: 1016 });
  r.calls.length = 0;
  scene.draw({ world, me: "c0", labels, now: 1032 });
  const texts = r.texts();
  assert.equal(
    texts.filter((t) => t === "CRASH!").length,
    1,
    "one crash, however often its frame is drawn",
  );
  for (const label of [
    "ESCAPED!",
    "DRONE DOWN",
    "BUMP!",
    "SCRAMBLED!",
    "SHIELD SAVED YOU",
  ])
    assert.ok(texts.includes(label), label);
  assert.ok(
    texts.some((t) => t.startsWith("+")),
    "the pickup names itself",
  );
  assert.ok(texts.includes("YOU"), "this device's chopper is labelled");
  assert.ok(texts.includes("P2"), "and the others by seat");
  assert.ok(texts.includes("?"), "a scrambled chopper shows it");
  assert.ok(texts.includes("!"), "the rock warning");
});

test("an effect a rollback renumbers is still the same effect, and is not drawn again", () => {
  const r = recorder(),
    scene = createScene(r.screen, r.make),
    world = crowded();
  scene.draw({
    world: { ...world, fx: [] },
    me: "",
    labels: new Map(),
    now: 0,
  });
  scene.draw({ world, me: "", labels: new Map(), now: 16 });
  const renumbered = {
    ...world,
    fx: world.fx.map((fx) => ({ ...fx, id: fx.id + 1000 })),
  };
  r.calls.length = 0;
  scene.draw({ world: renumbered, me: "", labels: new Map(), now: 32 });
  assert.equal(r.texts().filter((t) => t === "CRASH!").length, 1);
  // A different outcome, somewhere else, is a new effect.
  const elsewhere = {
    ...renumbered,
    fx: [{ ...renumbered.fx[0]!, x: renumbered.fx[0]!.x + 200 }],
  };
  r.calls.length = 0;
  scene.draw({ world: elsewhere, me: "", labels: new Map(), now: 48 });
  assert.equal(r.texts().filter((t) => t === "CRASH!").length, 2);
});

test("effects from before a page joined are not replayed, and a new round starts clean", () => {
  const r = recorder(),
    scene = createScene(r.screen, r.make),
    world = crowded();
  const stale = {
    ...world,
    fx: world.fx.map((fx) => ({ ...fx, at: world.step - 100 })),
  };
  scene.draw({ world: stale, me: "", labels: new Map(), now: 0 });
  scene.draw({
    world: {
      ...stale,
      fx: [
        ...stale.fx,
        {
          id: 99_999,
          at: world.step - 100,
          kind: "explode",
          x: 1,
          y: 1,
          slot: 0,
          data: 0,
        },
      ],
    },
    me: "",
    labels: new Map(),
    now: 16,
  });
  assert.ok(!r.texts().includes("CRASH!"));
  const next = { ...world, seed: world.seed + 1 };
  scene.draw({ world: next, me: "", labels: new Map(), now: 32 });
  r.calls.length = 0;
  scene.draw({ world: next, me: "", labels: new Map(), now: 48 });
  assert.ok(
    !r.texts().includes("CRASH!"),
    "the new round's first frame counts as seen",
  );
});

test("sprites and backdrop tiles are painted once and reused", () => {
  const r = recorder(),
    scene = createScene(r.screen, r.make),
    world = crowded();
  scene.draw({ world, me: "c0", labels: new Map(), now: 0 });
  const made = r.made;
  assert.ok(made > 10, "choppers, saws, pickups, drones and tiles");
  scene.draw({ world, me: "c0", labels: new Map(), now: 500 });
  assert.equal(r.made, made);
});

test("the crush zone carries its sign once it is wide, the exit gate shows at the end, and danger glows", () => {
  const r = recorder(),
    scene = createScene(r.screen, r.make);
  const world = crowded();
  scene.draw({
    world: { ...world, crushX: world.camX + 260 },
    me: "c0",
    labels: new Map(),
    now: 0,
    reducedMotion: true,
  });
  assert.ok(r.texts().includes("CRUSH"));
  assert.ok(r.texts().includes("MOVING RIGHT!"));
  r.calls.length = 0;
  scene.draw({
    world: {
      ...world,
      camX: CAMERA_END,
      crushX: CAMERA_END + 40,
      choppers: world.choppers.map((c) => ({ ...c, x: EXIT_X - 100 })),
    },
    me: "c0",
    labels: new Map(),
    now: 100,
  });
  assert.ok(r.texts().includes("EXIT"));
  assert.equal(hexA("#ff0000", 0.5), "rgba(255,0,0,0.500)");
  assert.equal(hexA("#00ff00", 2), "rgba(0,255,0,1.000)");
});

test("a crashed chopper's wreck falls, burns out and is gone", () => {
  const r = recorder(),
    scene = createScene(r.screen, r.make),
    world = crowded();
  const wrecked = world.choppers.find((c) => c.state === "crashed")!;
  for (const since of [10, 120, 400]) {
    r.calls.length = 0;
    scene.draw({
      world: {
        ...world,
        fx: [],
        choppers: [{ ...wrecked, endedAt: world.step - since }],
      },
      me: "",
      labels: new Map(),
      now: since * 16,
    });
    // A chopper sprite is 84 × 52 logical pixels, painted at twice that.
    const wrecks = r.blits((w, h) => w === 168 && h === 104);
    if (since < 240)
      assert.equal(wrecks, 1, `a wreck ${since} steps after the crash`);
    else assert.equal(wrecks, 0, "burnt out and gone");
  }
});

test("platforms carry lit landing pads and saws spin on their mounts", () => {
  const r = recorder(),
    scene = createScene(r.screen, r.make),
    world = crowded();
  let drawn = 0;
  for (let s = 3; s < 15 && drawn < 6; s++) {
    const part = segment(world.seed, s);
    if (!part.saws.length && !part.platforms.length) continue;
    const camX = (part.saws[0]?.x ?? part.platforms[0]!.x) - 400;
    r.calls.length = 0;
    scene.draw({
      world: { ...world, camX, crushX: camX + 40, step: world.step + s * 37 },
      me: "",
      labels: new Map(),
      now: s * 100,
    });
    // Saw blades are square surfaces; pickup crates, the only other square ones, are 96 × 96.
    if (part.saws.length)
      assert.ok(
        r.blits((w, h) => w === h && w !== 96) > 0,
        "a saw blade is drawn",
      );
    if (part.platforms.length)
      assert.ok(
        r.calls.some((c) => c[0] === "fillRect" && c[4] === 5),
        "a landing pad's plate",
      );
    drawn++;
  }
  assert.ok(drawn > 2);
});

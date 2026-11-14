/** The effects whose timing follows the arcade original: after-images, the dive stream, flares and the ending. */
import test from "node:test";
import assert from "node:assert/strict";
import type { FountainEffect } from "../src/render/effects.js";
import {
  CENTRE_SECONDS,
  END_ZOOM,
  endingCamera,
  endingDelay,
  IRIS_RADIUS,
  IRIS_SECONDS,
  project,
  STILL,
  ZOOM_SECONDS,
} from "../src/render/hud-model.js";
import {
  burstParticles,
  discHalfWidth,
  DIVE_COLORS,
  DIVE_STREAM,
  diveStream,
  EffectPool,
  fountainParticles,
  GHOST_EVERY,
  GHOST_LIFE,
  Ghosts,
  particleColor,
  type Ghost,
} from "../src/render/particles.js";

/** A fixed sequence standing in for Math.random. */
function sequence(): () => number {
  let n = 0;
  return () => {
    n = (n + 0.37) % 1;
    return n;
  };
}

const ghost = (patch: Partial<Ghost> = {}): Ghost => ({
  slot: 0,
  team: 0,
  sheet: "queen-flash",
  frame: 5,
  x: 100,
  y: 50,
  flip: false,
  born: 1,
  ...patch,
});

test("an after-image is left every 20 ms of movement and lives 200 ms", () => {
  assert.equal(GHOST_EVERY, 0.02);
  assert.equal(GHOST_LIFE, 0.2);
  const ghosts = new Ghosts();
  ghosts.note(ghost());
  ghosts.note(ghost({ born: 1.01, y: 54 }));
  assert.equal(ghosts.list.length, 1, "too soon after the last");
  ghosts.note(ghost({ born: 1.02 }));
  assert.equal(ghosts.list.length, 1, "it has not moved");
  ghosts.note(ghost({ born: 1.02, y: 54 }));
  ghosts.note(ghost({ born: 1.021, slot: 3 }));
  assert.equal(ghosts.list.length, 3, "each slot keeps its own time");
  assert.equal(Ghosts.left(ghost(), 1), 1);
  assert.ok(Math.abs(Ghosts.left(ghost(), 1.1) - 0.5) < 1e-9, "fades evenly");
  assert.equal(Ghosts.left(ghost(), 1.25), 0);
  assert.equal(Ghosts.left(ghost(), 0.5), 1);
  ghosts.tick(1.21);
  assert.deepEqual(
    ghosts.list.map((entry) => entry.born),
    [1.02, 1.021],
  );
  ghosts.tick(0.5);
  assert.equal(ghosts.list.length, 0, "a clock that went back keeps none");
  ghosts.note(ghost({ born: 0.5, y: 54 }));
  assert.equal(ghosts.list.length, 1, "and the slot may leave one again");
  ghosts.clear();
  assert.equal(ghosts.list.length, 0);
  ghosts.note(ghost());
  assert.equal(ghosts.list.length, 1);
});

test("a dive streams specks that rise and turn from yellow to magenta", () => {
  assert.equal(DIVE_STREAM.rate, 150);
  const specks = diveStream(100, 80, 20, 12, sequence());
  assert.equal(specks.length, 12);
  for (const speck of specks) {
    assert.ok(speck.vy < 0, "drifting up");
    assert.equal(speck.gravity, 0);
    assert.ok(speck.life >= 0.3 && speck.life <= 0.5);
    assert.ok(speck.y <= 80 && speck.y >= 60, "along the body");
    assert.ok(Math.abs(speck.x - 100) <= 2.5);
  }
  const [speck] = specks;
  assert.ok(speck);
  assert.equal(particleColor(speck), DIVE_COLORS[0]);
  assert.deepEqual(
    DIVE_COLORS.map((_, index) =>
      particleColor({
        ...speck,
        age: ((index + 0.5) / DIVE_COLORS.length) * speck.life,
      }),
    ),
    DIVE_COLORS,
  );
  assert.equal(
    particleColor({ ...speck, age: speck.life }),
    DIVE_COLORS.at(-1),
  );
  assert.equal(particleColor({ ...speck, age: -1 }), DIVE_COLORS[0]);
  assert.equal(particleColor({ ...speck, colors: [] }), speck.color);
  const plain = burstParticles(
    {
      kind: "burst",
      x: 0,
      y: 0,
      tone: "white",
      team: -1,
      count: 1,
      speed: 10,
      life: 1,
    },
    ["#abc"],
    sequence(),
  )[0];
  assert.ok(plain);
  assert.equal(particleColor(plain), "#abc");
  assert.deepEqual(diveStream(0, 0, 10, 0, sequence()), []);
});

test("a burst can be told its pixel size, its weight and when to start", () => {
  const pool = new EffectPool(sequence());
  pool.add(
    {
      kind: "burst",
      x: 100,
      y: 50,
      tone: "white",
      team: -1,
      count: 6,
      speed: 60,
      life: 1,
      size: 2,
      gravity: 0,
      delay: 0.1,
    },
    () => [],
    () => 0,
  );
  assert.ok(pool.particles.every((p) => p.size === 2 && p.gravity === 0));
  assert.ok(pool.particles.every((p) => p.age === -0.1));
  pool.tick(0.05, () => 0);
  assert.ok(
    pool.particles.every((p) => p.x === 100 && p.y === 50),
    "waiting where they will appear",
  );
  pool.tick(0.1, () => 0);
  assert.ok(pool.particles.some((p) => p.x !== 100 || p.y !== 50));
});

test("a fountain's pixels leave over its seconds and only rise", () => {
  const fountain: FountainEffect = {
    kind: "fountain",
    x: 200,
    y: 90,
    width: 20,
    tone: "team",
    team: 1,
    count: 30,
    seconds: 1,
  };
  const pixels = fountainParticles(fountain, ["#f0f"], sequence());
  assert.equal(pixels.length, 30);
  for (const pixel of pixels) {
    assert.ok(pixel.vy < 0 && pixel.gravity === 0);
    assert.ok(Math.abs(pixel.x - 200) <= 10);
    assert.equal(pixel.y, 90);
    assert.ok(pixel.age <= 0 && pixel.age > -1);
    assert.equal(pixel.color, "#f0f");
  }
  assert.ok(
    pixels.some((p) => p.age < -0.6) && pixels.some((p) => p.age > -0.4),
  );
  assert.equal(
    fountainParticles(fountain, [], sequence())[0]?.color,
    "#ffffff",
  );
  const pool = new EffectPool(sequence());
  pool.add(
    fountain,
    () => ["#000", "#111", "#f0f"],
    () => 0,
  );
  assert.equal(pool.count, 30);
});

test("a flare lives its life in the pool and is a disc", () => {
  const pool = new EffectPool();
  pool.add(
    { kind: "flare", x: 10, y: 10, radius: 48, life: 0.5 },
    () => [],
    () => 0,
  );
  assert.equal(pool.flares.length, 1);
  assert.equal(pool.count, 1);
  pool.tick(0.25, () => 0);
  assert.equal(pool.flares[0]?.age, 0.25);
  pool.tick(0.25, () => 0);
  assert.equal(pool.flares.length, 0);
  pool.add(
    { kind: "flare", x: 10, y: 10, radius: 3, life: 0.05 },
    () => [],
    () => 0,
  );
  pool.clear();
  assert.equal(pool.count, 0);
  assert.equal(discHalfWidth(5, 0), 5);
  assert.equal(discHalfWidth(5, 5), 0);
  assert.equal(discHalfWidth(5, -3), 4);
  assert.equal(discHalfWidth(5, 6), -1);
});

test("the ending waits for a dead Queen's shake, then centres and grows to twice the size", () => {
  assert.equal(IRIS_RADIUS, 43);
  assert.equal(IRIS_SECONDS, 0.5);
  assert.equal(endingDelay({ team: 0, kind: "military" }, false, 0.8), 0.8);
  assert.equal(endingDelay({ team: 0, kind: "military" }, true, 0.8), 0);
  assert.equal(endingDelay({ team: 0, kind: "economy" }, false, 0.8), 0);
  assert.equal(endingDelay({ team: 1, kind: "snail" }, false, 0.8), 0);
  const focus = { x: 400, y: 60 };
  assert.equal(endingCamera(0, focus), STILL);
  assert.equal(endingCamera(-1, focus), STILL);
  const half = endingCamera(CENTRE_SECONDS / 2, focus);
  assert.equal(half.x, (STILL.x + focus.x) / 2);
  assert.equal(half.y, (STILL.y + focus.y) / 2);
  assert.ok(half.zoom > 1 && half.zoom < END_ZOOM);
  const centred = endingCamera(CENTRE_SECONDS, focus);
  assert.deepEqual({ x: centred.x, y: centred.y }, focus);
  let most = 0;
  for (let age = 0; age <= ZOOM_SECONDS; age += 0.05)
    most = Math.max(most, endingCamera(age, focus).zoom);
  assert.ok(most > END_ZOOM && most < END_ZOOM * 1.1, "a slight overshoot");
  assert.deepEqual(endingCamera(ZOOM_SECONDS, focus), {
    ...focus,
    zoom: END_ZOOM,
  });
  assert.deepEqual(endingCamera(99, focus), { ...focus, zoom: END_ZOOM });
  assert.deepEqual(project(focus, STILL), focus);
  assert.deepEqual(project(focus, endingCamera(99, focus)), {
    x: STILL.x,
    y: STILL.y,
  });
  assert.deepEqual(project({ x: 410, y: 60 }, endingCamera(99, focus)), {
    x: STILL.x + 20,
    y: STILL.y,
  });
});

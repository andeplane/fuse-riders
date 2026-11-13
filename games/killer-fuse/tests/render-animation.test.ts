import test from "node:test";
import assert from "node:assert/strict";
import {
  FLAP_FRAME_STEPS,
  FLASH_BEAT_STEPS,
  FlapClock,
  flashing,
  unitPose,
  unitSheet,
  type PoseContext,
} from "../src/render/animation.js";
import { frameIndex } from "../src/render/manifest.js";
import { manifest, unitView } from "./render-kit.js";

const art = manifest();
const still: PoseContext = {
  time: 0,
  dy: 0,
  sinceFlap: Infinity,
  inGate: false,
};
const frameOf = (sheet: string, name: string): number => {
  const def = art.assets[sheet];
  assert.ok(def, sheet);
  assert.ok(name in def.frames, `${sheet} has a frame ${name}`);
  return frameIndex(def, name);
};

test("a unit's sheet follows its kind, team and speed", () => {
  assert.equal(unitSheet(unitView()), "worker-cyan");
  assert.equal(
    unitSheet(unitView({ team: 1, speed: true })),
    "speed-worker-pink",
  );
  assert.equal(
    unitSheet(unitView({ kind: "warrior", speed: true })),
    "speed-warrior-cyan",
  );
  assert.equal(
    unitSheet(unitView({ kind: "queen", team: 1, speed: true })),
    "queen-pink",
    "a Queen has no speed form",
  );
});

test("a Worker stands, runs, jumps and falls", () => {
  const pose = (patch: Parameters<typeof unitView>[0], context = still) =>
    unitPose(art, unitView(patch), context);
  assert.deepEqual(pose({}), {
    sheet: "worker-cyan",
    frame: frameOf("worker-cyan", "idle"),
    animation: "idle",
    flash: false,
  });
  assert.equal(pose({ moving: true }).animation, "run");
  assert.equal(
    pose({ moving: true }, { ...still, time: 5 }).frame,
    frameOf("worker-cyan", "run2"),
    "twelve frames a second: step 5 is the second frame",
  );
  const up = pose({ grounded: false }, { ...still, dy: -2 });
  assert.equal(up.animation, "jump");
  assert.equal(up.frame, frameOf("worker-cyan", "jump"));
  const down = pose({ grounded: false }, { ...still, dy: 2 });
  assert.equal(down.animation, "fall");
  assert.equal(down.frame, frameOf("worker-cyan", "fall"));
});

test("a Worker with a berry shows the carrying frame of the same pose", () => {
  const carry = unitPose(art, unitView({ carrying: true, moving: true }), {
    ...still,
    time: 5,
  });
  assert.equal(carry.animation, "runCarry");
  assert.equal(carry.frame, frameOf("worker-cyan", "run2Carry"));
  const fall = unitPose(art, unitView({ carrying: true, grounded: false }), {
    ...still,
    dy: 1,
  });
  assert.equal(fall.frame, frameOf("worker-cyan", "fallCarry"));
});

test("a Worker on the snail sits still and one in its mouth runs on the spot", () => {
  const riding = unitPose(
    art,
    unitView({ riding: true, grounded: false }),
    still,
  );
  assert.equal(riding.animation, "idle");
  const eaten = unitPose(art, unitView({ eaten: true, grounded: false }), {
    ...still,
    time: 2.5,
  });
  assert.equal(eaten.animation, "run");
  assert.equal(
    eaten.frame,
    frameOf("worker-cyan", "run2"),
    "twice as fast: step 2.5 is already the second frame",
  );
});

test("a speed Worker uses its own sheet and quicker legs", () => {
  const pose = unitPose(art, unitView({ speed: true, moving: true }), {
    ...still,
    time: 4,
  });
  assert.equal(pose.sheet, "speed-worker-cyan");
  assert.equal(pose.frame, frameOf("speed-worker-cyan", "run2"));
});

test("a Worker in a gate plays the transformation loop", () => {
  const seen = new Set<number>();
  for (let time = 0; time < 60; time += 1) {
    const pose = unitPose(art, unitView({ team: 1, invulnerable: true }), {
      ...still,
      time,
      inGate: true,
    });
    assert.equal(pose.sheet, "transform-pink");
    assert.equal(pose.animation, "transform");
    assert.equal(pose.flash, false);
    seen.add(pose.frame);
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3]);
});

test("the wings beat once per flap and then glide", () => {
  const warrior = unitView({ kind: "warrior", grounded: false });
  const at = (sinceFlap: number) =>
    unitPose(art, warrior, { ...still, sinceFlap });
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7].map((steps) => at(steps).frame),
    [
      "flapUp",
      "flapUp",
      "flapMid",
      "flapMid",
      "flapDown",
      "flapDown",
      "flapMid",
      "flapMid",
    ].map((name) => frameOf("warrior-cyan", name)),
  );
  assert.equal(at(0).animation, "fly");
  const glide = at(FLAP_FRAME_STEPS * 4);
  assert.equal(glide.animation, "glide");
  assert.equal(glide.frame, frameOf("warrior-cyan", "glide"));
  assert.equal(at(Infinity).animation, "glide");
});

test("winged units walk, stand and dive", () => {
  const queen = unitView({ kind: "queen", team: 1 });
  assert.equal(unitPose(art, queen, still).animation, "idle");
  assert.equal(
    unitPose(art, { ...queen, moving: true }, still).animation,
    "walk",
  );
  const dive = unitPose(
    art,
    { ...queen, grounded: false, diving: true },
    still,
  );
  assert.equal(dive.sheet, "queen-pink");
  assert.equal(dive.frame, frameOf("queen-pink", "dive"));
  const warrior = unitPose(
    art,
    unitView({ kind: "warrior", grounded: false, diving: true }),
    still,
  );
  assert.equal(
    warrior.animation,
    "glide",
    "a Warrior has no dive pose: it glides",
  );
});

test("an invulnerable unit shows its white sheet on alternate beats", () => {
  const unit = unitView({ invulnerable: true });
  assert.equal(flashing(unit, 0), true);
  assert.equal(flashing(unit, FLASH_BEAT_STEPS), false);
  assert.equal(flashing(unitView(), 0), false);
  const on = unitPose(art, unit, still);
  assert.equal(on.sheet, "worker-flash");
  assert.equal(on.flash, true);
  const off = unitPose(art, unit, { ...still, time: FLASH_BEAT_STEPS });
  assert.equal(off.sheet, "worker-cyan");
  const queen = unitPose(
    art,
    unitView({ kind: "queen", invulnerable: true }),
    still,
  );
  assert.equal(queen.sheet, "queen-flash");
});

test("a sheet the manifest lacks is an error, not a blank unit", () => {
  const broken = { ...art, assets: {} };
  assert.throws(
    () => unitPose(broken, unitView(), still),
    /no sheet worker-cyan/,
  );
  assert.throws(
    () => unitPose(broken, unitView(), { ...still, inGate: true }),
    /no sheet transform-cyan/,
  );
});

test("the flap clock counts steps since a unit's last flap", () => {
  const clock = new FlapClock();
  assert.equal(clock.since(2, 10), Infinity);
  clock.note(2, 10);
  assert.equal(clock.since(2, 10), 0);
  assert.equal(clock.since(2, 13.5), 3.5);
  assert.equal(clock.since(2, 8), 0, "never negative");
  clock.note(0, 4);
  clock.rewind(6);
  assert.equal(
    clock.since(2, 20),
    Infinity,
    "a flap from the future is forgotten",
  );
  assert.equal(clock.since(0, 6), 2);
  assert.equal(clock.since(1, 6), Infinity);
});

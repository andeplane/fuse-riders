import test from "node:test";
import assert from "node:assert/strict";
import {
  FLAP_FRAME_STEPS,
  FLAP_JUMP,
  FLAP_SLOWING,
  PLUNGE_DY,
  WINGS_DY,
  velocityFlaps,
  FLASH_BEAT_STEPS,
  FlapClock,
  flashing,
  unitPose,
  unitSheet,
  type PoseContext,
} from "../src/render/animation.js";
import { frameIndex } from "../src/render/manifest.js";
import { manifest, openingView, unitView, withUnit } from "./render-kit.js";

const art = manifest();
const still: PoseContext = {
  time: 0,
  dy: WINGS_DY,
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

test("a Worker in a gate stands between the pillars with empty hands", () => {
  const pose = unitPose(
    art,
    unitView({ team: 1, invulnerable: true, carrying: true, speed: true }),
    { ...still, inGate: true },
  );
  assert.equal(pose.sheet, "worker-pink");
  assert.equal(pose.frame, frameOf("worker-pink", "idle"));
  assert.equal(pose.animation, "transform");
  assert.equal(pose.flash, false);
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

test("a unit holding its height beats its wings though no flap was seen", () => {
  const queen = unitView({ kind: "queen", grounded: false });
  const at = (dy: number, time: number) =>
    unitPose(art, queen, { ...still, dy, time });
  assert.equal(at(0, 0).animation, "fly", "hovering");
  assert.equal(at(-2, 0).animation, "fly", "climbing");
  assert.equal(at(WINGS_DY - 0.01, 0).animation, "fly");
  assert.equal(at(WINGS_DY, 0).animation, "glide", "sinking freely");
  const beat = art.assets["queen-cyan"]?.animations.fly?.frames ?? [];
  assert.ok(beat.length > 1);
  assert.deepEqual(
    beat.map((_, index) => at(0, index * FLAP_FRAME_STEPS).frame),
    beat.map((name) => frameOf("queen-cyan", name)),
    "the beat runs on the clock",
  );
  assert.equal(
    at(0, beat.length * FLAP_FRAME_STEPS).frame,
    at(0, 0).frame,
    "and loops",
  );
});

test("flaps between fed views are read from the fall", () => {
  const flyer = { kind: "warrior", grounded: false, y: 100 } as const;
  const pair = (
    patchBefore: Parameters<typeof unitView>[0],
    patchAfter: Parameters<typeof unitView>[0],
    last: number | undefined,
    steps = 3,
  ) => {
    const before = withUnit(openingView({ step: 30 }), 2, {
      ...flyer,
      ...patchBefore,
    });
    const after = withUnit(openingView({ step: 30 + steps }), 2, {
      ...flyer,
      ...patchAfter,
    });
    const lastDy: (number | undefined)[] = [];
    lastDy[2] = last;
    return velocityFlaps(before, after, lastDy);
  };
  const steady = pair({}, { y: 103.3 }, 1);
  assert.deepEqual(steady.slots, [], "gravity alone");
  assert.ok(Math.abs((steady.dy[2] ?? 0) - 1.1) < 1e-9);
  assert.deepEqual(pair({}, { y: 101.5 }, 1).slots, [2], "the fall slowed");
  assert.deepEqual(pair({}, { y: 98 }, 0).slots, [2], "the climb quickened");
  assert.deepEqual(
    pair({}, { y: 107.8 }, 2.6).slots,
    [],
    "terminal speed is not a flap",
  );
  assert.ok(FLAP_SLOWING > 0.3);
  assert.deepEqual(
    pair({}, { y: 103 }, 1).slots,
    [],
    "less than half a press is noise",
  );
  assert.deepEqual(pair({}, { y: 98 }, undefined).slots, [], "no history");
  assert.deepEqual(pair({ diving: true }, { y: 101 }, 4).slots, []);
  assert.deepEqual(pair({}, { y: 101, diving: true }, 4).slots, []);
  assert.deepEqual(pair({ flapped: true }, { y: 98 }, 0).slots, []);
  assert.deepEqual(pair({}, { y: 98, flapped: true }, 0).slots, []);
  for (const [was, now] of [
    [{ grounded: true }, { y: 98 }],
    [{}, { y: 98, grounded: true }],
    [{ dead: true }, { y: 98 }],
    [{}, { y: 98, dead: true }],
    [{ kind: "worker" }, { y: 98, kind: "worker" }],
    [{}, { y: 100 - FLAP_JUMP * 3 - 1 }],
  ] as const) {
    const result = pair(was, now, 0);
    assert.deepEqual(result.slots, []);
    assert.equal(result.dy[2], undefined);
  }
  const same = pair({}, { y: 98 }, 0, 0);
  assert.deepEqual(same.slots, [], "the same step fed again");
  assert.equal(same.dy[2], undefined);
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
});

test("a Warrior dropping fast with still wings tips into its dive frame", () => {
  const warrior = unitView({ kind: "warrior", grounded: false });
  const falling = (dy: number, sinceFlap = Infinity) =>
    unitPose(art, warrior, { ...still, dy, sinceFlap });
  const plunge = falling(PLUNGE_DY);
  assert.equal(plunge.animation, "dive");
  assert.equal(plunge.frame, frameOf("warrior-cyan", "dive"));
  assert.equal(
    falling(PLUNGE_DY - 0.1).animation,
    "glide",
    "a slow sink glides",
  );
  assert.equal(falling(-PLUNGE_DY).animation, "fly", "rising is not a dive");
  assert.equal(falling(PLUNGE_DY, 0).animation, "fly", "a flap comes first");
  assert.equal(
    unitPose(art, unitView({ kind: "queen", grounded: false }), {
      ...still,
      dy: PLUNGE_DY,
    }).animation,
    "glide",
    "the Queen dives only when she means to",
  );
  assert.equal(
    unitPose(art, unitView({ kind: "warrior", speed: true, grounded: false }), {
      ...still,
      dy: PLUNGE_DY,
    }).frame,
    frameOf("speed-warrior-cyan", "dive"),
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
    /no sheet worker-cyan/,
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

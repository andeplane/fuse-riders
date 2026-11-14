import test from "node:test";
import assert from "node:assert/strict";
import {
  FLAP_THRUST,
  FLY_GRAVITY,
  FLY_GRAVITY_LIGHT,
  FLY_TERMINAL,
  S,
  TICK_HZ,
} from "../src/engine/index.js";
import {
  beatSteps,
  bodyShape,
  FLAP_SECONDS,
  GLIDE_STEPS,
  JUMP_SECONDS,
  JUMP_SHAPE,
  LAND_HEIGHT,
  LAND_SECONDS,
  landings,
  FLAP_JUMP,
  FLAP_SLOWING,
  WINGS_DY,
  velocityFlaps,
  diveEnds,
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

test("a press plays the whole wing beat fast, holds the wings up, then glides", () => {
  for (const kind of ["warrior", "queen"] as const) {
    const unit = unitView({ kind, grounded: false });
    const sheet = `${kind}-cyan`;
    const beat = art.assets[sheet]?.animations.fly?.frames ?? [];
    assert.ok(beat.length > 1);
    const at = (sinceFlap: number) =>
      unitPose(art, unit, { ...still, sinceFlap });
    const steps = beatSteps(kind);
    assert.equal(
      steps,
      (kind === "queen" ? FLAP_SECONDS.queen : FLAP_SECONDS.warrior) * TICK_HZ,
    );
    assert.deepEqual(
      beat.map((_, index) => at((index + 0.5) * (steps / beat.length)).frame),
      beat.map((name) => frameOf(sheet, name)),
      `${kind}: every frame of the beat within it`,
    );
    const held = at(steps + 0.01);
    assert.equal(held.animation, "fly");
    assert.equal(held.frame, frameOf(sheet, beat[0] ?? ""), "wings held ready");
    assert.equal(at(GLIDE_STEPS - 0.01).animation, "fly");
    const glide = at(GLIDE_STEPS);
    assert.equal(glide.animation, "glide");
    assert.equal(glide.frame, frameOf(sheet, "glide"));
    assert.equal(at(Infinity).animation, "glide");
  }
  assert.ok(beatSteps("warrior") < beatSteps("queen"));
  assert.equal(GLIDE_STEPS, FLAP_SECONDS.glide * TICK_HZ);
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
    beat.map(
      (_, index) =>
        at(0, (index + 0.5) * (beatSteps("queen") / beat.length)).frame,
    ),
    beat.map((name) => frameOf("queen-cyan", name)),
    "the beat runs on the clock",
  );
  assert.equal(
    at(0, beatSteps("queen") + 0.01).frame,
    at(0, 0.01).frame,
    "and loops",
  );
});

test("flaps between fed views are read from the fall", () => {
  const flyer = { kind: "warrior", grounded: false, y: 100 } as const;
  const steps = 3;
  const gravity = (FLY_GRAVITY / S) * steps;
  const thrust = (FLAP_THRUST / S) * steps;
  /** One pair of views a tick apart: the unit fell `last` a step before and gathers `gain` over the tick. */
  const pair = (
    gain: number | undefined,
    last: number | undefined,
    pushing: number | undefined = 0,
    patchBefore: Parameters<typeof unitView>[0] = {},
    patchAfter: Parameters<typeof unitView>[0] = {},
    apart = steps,
  ) => {
    const before = withUnit(openingView({ step: 30 }), 2, {
      ...flyer,
      ...patchBefore,
    });
    const after = withUnit(openingView({ step: 30 + apart }), 2, {
      ...flyer,
      y: gain === undefined ? 100 : 100 + ((last ?? 0) + gain) * steps,
      ...patchAfter,
    });
    const dy: (number | undefined)[] = [];
    const lift: (number | undefined)[] = [];
    dy[2] = last;
    lift[2] = pushing;
    return velocityFlaps(before, after, { dy, lift });
  };
  const steady = pair(gravity, 0.2);
  assert.deepEqual(steady.slots, [], "gravity alone");
  assert.ok(Math.abs((steady.trace.dy[2] ?? 0) - (0.2 + gravity)) < 1e-9);
  assert.equal(steady.trace.lift[2], 0);
  const one = pair(gravity - thrust, 0.2);
  assert.deepEqual(one.slots, [2], "one flap pushing");
  assert.equal(one.trace.lift[2], 1);
  assert.deepEqual(
    pair(gravity - thrust, 0.2, 1).slots,
    [],
    "the same flap, still pushing a tick later",
  );
  assert.deepEqual(pair(gravity - 2 * thrust, 0, 1).slots, [2], "a second");
  assert.deepEqual(pair(gravity - thrust, 0, undefined).slots, [2]);
  assert.deepEqual(
    pair(0, FLY_TERMINAL / S).slots,
    [],
    "terminal speed is not a flap",
  );
  assert.ok(FLAP_SLOWING * 2 * S > FLY_GRAVITY - FLY_GRAVITY_LIGHT);
  assert.deepEqual(
    pair((FLY_GRAVITY_LIGHT / S) * steps, 0.2).slots,
    [],
    "the lighter fall after a take-off is not a flap",
  );
  assert.deepEqual(
    pair(gravity - thrust * 0.4, 0.2).slots,
    [],
    "less than half a flap is noise",
  );
  const fresh = pair(-2, undefined);
  assert.deepEqual(fresh.slots, [], "no history");
  assert.equal(fresh.trace.lift[2], undefined);
  assert.ok(fresh.trace.dy[2] !== undefined);
  const flap = gravity - thrust;
  assert.deepEqual(pair(flap, 0.2, 0, { diving: true }).slots, []);
  assert.deepEqual(pair(flap, 0.2, 0, {}, { diving: true }).slots, []);
  assert.deepEqual(pair(flap, 0.2, 0, { flapped: true }).slots, []);
  assert.deepEqual(pair(flap, 0.2, 0, {}, { flapped: true }).slots, []);
  for (const [was, now] of [
    [{ grounded: true }, {}],
    [{}, { grounded: true }],
    [{ dead: true }, {}],
    [{}, { dead: true }],
    [{ kind: "worker" }, { kind: "worker" }],
    [{}, { y: 100 - FLAP_JUMP * steps - 1 }],
  ] as const) {
    const result = pair(flap, 0.2, 0, was, now);
    assert.deepEqual(result.slots, []);
    assert.equal(result.trace.dy[2], undefined);
  }
  const same = pair(flap, 0.2, 0, {}, {}, 0);
  assert.deepEqual(same.slots, [], "the same step fed again");
  assert.equal(same.trace.dy[2], undefined);
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

test("only a Queen dives: a Warrior dropping fast glides", () => {
  const warrior = unitView({ kind: "warrior", grounded: false });
  const falling = (dy: number, sinceFlap = Infinity) =>
    unitPose(art, warrior, { ...still, dy, sinceFlap });
  assert.equal(falling(3).animation, "glide");
  assert.equal(falling(-2).animation, "fly");
  assert.equal(falling(3, 0).animation, "fly", "a flap comes first");
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

test("a dive that ends in the air goes back to beating wings", () => {
  const queen = { kind: "queen", grounded: false } as const;
  const views = (
    was: Parameters<typeof unitView>[0],
    now: Parameters<typeof unitView>[0],
  ) =>
    diveEnds(
      withUnit(openingView({ step: 30 }), 0, { ...queen, ...was }),
      withUnit(openingView({ step: 33 }), 0, { ...queen, ...now }),
    );
  assert.deepEqual(views({ diving: true }, {}), [0]);
  assert.deepEqual(views({ diving: true }, { diving: true }), []);
  assert.deepEqual(views({}, {}), []);
  assert.deepEqual(views({ diving: true }, { grounded: true }), [], "landed");
  assert.deepEqual(views({ diving: true }, { dead: true }), []);
  assert.deepEqual(views({ diving: true, dead: true }, {}), []);
});

test("invulnerability blinks on a cycle of a sixth of a second", () => {
  assert.equal((FLASH_BEAT_STEPS * 2) / TICK_HZ, 10 / 60);
});

test("a landing is read from two views, harder the faster the fall", () => {
  const base = openingView();
  const air = withUnit(base, 0, { grounded: false, y: 100 });
  const ground = (y: number, step = 1) =>
    withUnit({ ...base, step: base.step + step }, 0, { grounded: true, y });
  const soft = landings(air, ground(100.4));
  assert.equal(soft.length, 1);
  assert.equal(soft[0]?.slot, 0);
  assert.ok((soft[0]?.strength ?? 0) > 0 && (soft[0]?.strength ?? 0) < 0.5);
  assert.equal(landings(air, ground(100 + FLY_TERMINAL / S))[0]?.strength, 1);
  assert.equal(landings(air, ground(106))[0]?.strength, 1, "never past 1");
  assert.equal(
    landings(air, ground(100 + FLY_TERMINAL / S, 2))[0]?.strength,
    0.5,
    "the fall is per step",
  );
  assert.deepEqual(landings(air, ground(99)), [], "rose onto it");
  assert.deepEqual(landings(air, ground(200)), [], "a respawn, not a fall");
  assert.deepEqual(landings(air, air), [], "still in the air");
  assert.deepEqual(landings(ground(100), ground(101)), [], "was standing");
  assert.deepEqual(landings(air, ground(101, 0)), [], "the same step again");
  assert.deepEqual(landings(air, withUnit(ground(101), 0, { dead: true })), []);
  assert.deepEqual(landings(withUnit(air, 0, { dead: true }), ground(101)), []);
  assert.deepEqual(landings({ ...air, units: [] }, ground(101)), []);
});

test("a body squashes on landing and a Worker stretches on its jump, then both ease back", () => {
  const whole = { w: 1, h: 1 };
  for (const kind of ["worker", "warrior", "queen"] as const) {
    const hit = bodyShape(kind, 0, 1, -1);
    assert.equal(hit.h, LAND_HEIGHT[kind]);
    assert.ok(hit.w > 1, "wider as it is shorter");
    const half = bodyShape(kind, LAND_SECONDS / 2, 1, -1);
    assert.ok(half.h > hit.h && half.h < 1);
    assert.ok(bodyShape(kind, 0, 0.5, -1).h > hit.h, "a soft landing less");
    assert.equal(bodyShape(kind, 0, 7, -1).h, hit.h);
    assert.deepEqual(bodyShape(kind, 0, -1, -1), whole);
    assert.deepEqual(bodyShape(kind, LAND_SECONDS, 1, -1), whole);
    assert.deepEqual(bodyShape(kind, -1, 1, -1), whole, "never landed");
  }
  assert.deepEqual(bodyShape("worker", -1, 0, 0), JUMP_SHAPE);
  const rising = bodyShape("worker", -1, 0, JUMP_SECONDS / 2);
  assert.ok(rising.w > JUMP_SHAPE.w && rising.w < 1);
  assert.ok(rising.h < JUMP_SHAPE.h && rising.h > 1);
  assert.deepEqual(bodyShape("worker", -1, 0, JUMP_SECONDS), whole);
  assert.deepEqual(bodyShape("queen", -1, 0, 0), whole, "only a Worker jumps");
  assert.equal(
    bodyShape("worker", 0, 1, 0).h,
    LAND_HEIGHT.worker,
    "a landing wins over the jump before it",
  );
});

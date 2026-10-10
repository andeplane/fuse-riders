import test from "node:test";
import assert from "node:assert/strict";
import { GHOST_FLIGHT, GUNSHIP_FLIGHT } from "../src/engine/flight.js";
import {
  addParticle,
  advanceParticles,
  BOB,
  bubbleStrength,
  createParticles,
  damageStage,
  emitGhost,
  emitGunship,
  FACING_SPEED,
  FLASH_TIME,
  GHOST_RADIUS,
  GUNSHIP_RADIUS,
  hullDrop,
  hullRotation,
  initialPose,
  MAX_BANK,
  MAX_DT,
  MAX_PARTICLES,
  MIN_TURN_SCALE,
  nextFacing,
  owed,
  ROTOR,
  shipPoint,
  shipVisible,
  stepPose,
  TURN_TIME,
  turnScale,
  wreckAlpha,
  WRECK_FADE,
  WRECK_TIME,
  type Particle,
  type Pose,
  type PoseInput,
} from "../src/render/gunship-pose.js";

const FRAME = 1 / 60;
const idle: PoseInput = {
  vx: 0,
  thrustX: 0,
  thrustY: 0,
  hp: 100,
  maxHp: 100,
  shield: 0,
  alive: true,
};

/** Steps `frames` frames of `FRAME` with the same input. */
function run(pose: Pose, input: PoseInput, frames: number, dt = FRAME): Pose {
  for (let i = 0; i < frames; i++) pose = stepPose(pose, input, dt, 3);
  return pose;
}

test("the hull turns only once the ship flies the other way faster than FACING_SPEED", () => {
  assert.equal(nextFacing(1, -FACING_SPEED + 1), 1);
  assert.equal(nextFacing(1, -FACING_SPEED - 1), -1);
  assert.equal(nextFacing(-1, 0), -1);
  assert.equal(nextFacing(-1, FACING_SPEED + 1), 1);

  let pose = initialPose(idle, 0, 1);
  pose = run(pose, { ...idle, vx: -10 }, 30);
  assert.equal(pose.facing, 1, "a slow drift keeps the facing");
  assert.equal(pose.turn, 1);

  pose = stepPose(pose, { ...idle, vx: -60 }, FRAME, 0);
  assert.equal(pose.facing, -1);
  assert.ok(pose.turn < 1 && pose.turn > -1, "the turn eases, not snaps");
  const turns: number[] = [];
  for (let t = 0; t < TURN_TIME + 0.05; t += FRAME) {
    pose = stepPose(pose, { ...idle, vx: -60 }, FRAME, 0);
    turns.push(pose.turn);
  }
  assert.equal(
    pose.turn,
    -1,
    "the turn ends after TURN_TIME without overshoot",
  );
  for (const turn of turns) {
    assert.ok(turn >= -1 && turn <= 1);
    const scale = turnScale(turn);
    assert.ok(Math.abs(scale) >= MIN_TURN_SCALE && Math.abs(scale) <= 1);
    assert.equal(Math.sign(scale), turn < 0 ? -1 : 1);
  }
});

test("the art is drawn for the engine's flight radii", () => {
  assert.equal(GUNSHIP_RADIUS, GUNSHIP_FLIGHT.shape.radius);
  assert.equal(GHOST_RADIUS, GHOST_FLIGHT.shape.radius);
});

test("bob and lean offset the drawing from the engine's centre by the bob alone, and stay inside their bounds", () => {
  let pose = initialPose(idle, 5);
  let most = 0;
  for (let i = 0; i < 600; i++) {
    pose = stepPose(pose, { ...idle, vx: 400 }, FRAME, 5);
    most = Math.max(most, Math.abs(pose.bob));
    // The drawing's centre sits right below or above the hit circle's, offset by the bob alone.
    const centre = shipPoint(pose, 100, 200, 2, 0, 0);
    assert.equal(centre.x, 100);
    assert.equal(centre.y, 200 + 2 * pose.bob);
    assert.ok(Math.abs(pose.bank) <= MAX_BANK + 1e-12);
  }
  assert.ok(most > 0 && most <= BOB.amplitude);
  assert.ok(pose.bank > 0, "flying right leans the bow down (clockwise)");
  assert.ok(pose.bank > MAX_BANK * 0.95, "and at full speed the lean is full");
});

test("the hull mirrors before it leans: the bow is on the side it faces and dips toward its motion", () => {
  const bow = { x: 20, y: 0 };
  const stern = { x: -20, y: 0 };
  const at = (pose: Pose, p: { x: number; y: number }) =>
    shipPoint(pose, 0, 0, 1, p.x, p.y);

  const right = run(initialPose(idle, 0, 1), { ...idle, vx: 400 }, 120);
  assert.equal(right.facing, 1);
  assert.ok(at(right, bow).x > 0 && at(right, stern).x < 0);
  assert.ok(right.bank > 0 && at(right, bow).y > at(right, stern).y);

  const left = run(initialPose(idle, 0, 1), { ...idle, vx: -400 }, 120);
  assert.equal(left.facing, -1);
  assert.equal(left.turn, -1);
  assert.ok(at(left, bow).x < 0 && at(left, stern).x > 0, "bow on the left");
  assert.ok(left.bank < 0 && at(left, bow).y > at(left, stern).y);
  assert.ok(hullRotation(left) < 0, "the hull container leans the same way");
});

test("rotors spin up with thrust, tilt into horizontal thrust and settle back to idle", () => {
  let pose = initialPose(idle, 0);
  assert.equal(pose.rotorSpin, ROTOR.idle);
  pose = run(pose, { ...idle, thrustX: 1 }, 120);
  assert.ok(pose.rotorSpin > ROTOR.full * 0.95);
  assert.ok(pose.rotorTilt > ROTOR.tilt * 0.9);
  pose = run(pose, { ...idle, thrustX: -1 }, 120);
  assert.ok(pose.rotorTilt < -ROTOR.tilt * 0.9);
  pose = run(pose, { ...idle, thrustY: -1 }, 120);
  assert.ok(pose.rotorSpin > ROTOR.full * 0.95, "climbing spins them up too");
  assert.ok(Math.abs(pose.rotorTilt) < 0.05, "but leaves them level");
  pose = run(pose, idle, 180);
  assert.ok(Math.abs(pose.rotorSpin - ROTOR.idle) < 0.05);
  assert.ok(pose.rotorPhase >= 0 && pose.rotorPhase < 2 * Math.PI);
});

test("a drop in hp or shield flashes; a rise (repair, or a rollback undoing a hit) does not", () => {
  let pose = initialPose({ ...idle, shield: 1 }, 0);
  pose = stepPose(pose, { ...idle, shield: 1, hp: 90 }, FRAME, 0);
  assert.equal(pose.flash, 1);
  assert.equal(pose.shieldFlash, 0);
  pose = run(
    pose,
    { ...idle, shield: 1, hp: 90 },
    Math.ceil(FLASH_TIME / FRAME),
  );
  assert.equal(pose.flash, 0);
  pose = stepPose(pose, { ...idle, shield: 1, hp: 100 }, FRAME, 0);
  assert.equal(pose.flash, 0);
  pose = stepPose(pose, { ...idle, shield: 0.5, hp: 100 }, FRAME, 0);
  assert.equal(pose.shieldFlash, 1);
  assert.equal(pose.flash, 0);
});

test("the shield bubble outlives the shield a hit just broke, for the length of the flash", () => {
  assert.equal(bubbleStrength(0, 0), 0);
  assert.equal(bubbleStrength(0.4, 0), 0.4);
  assert.equal(bubbleStrength(0, 0.7), 0.7);
  assert.equal(bubbleStrength(0.4, 0.7), 0.7);
  assert.equal(bubbleStrength(NaN, NaN), 0);
  assert.equal(bubbleStrength(5, 0), 1);

  // A hit that takes the last of the shield: the shield reads 0 from that frame on, the flash is up.
  let pose = initialPose({ ...idle, shield: 0.2 }, 0);
  pose = stepPose(pose, { ...idle, shield: 0 }, FRAME, 0);
  assert.equal(pose.shieldFlash, 1);
  assert.equal(bubbleStrength(0, pose.shieldFlash), 1, "flashes once");
  pose = run(pose, { ...idle, shield: 0 }, 5);
  assert.ok(bubbleStrength(0, pose.shieldFlash) > 0, "then fades, not cuts");
  pose = run(pose, { ...idle, shield: 0 }, 30);
  assert.equal(bubbleStrength(0, pose.shieldFlash), 0, "and is gone");
});

test("damage stages: smoking at half hp, burning at a quarter", () => {
  assert.equal(damageStage(100, 100), 0);
  assert.equal(damageStage(51, 100), 0);
  assert.equal(damageStage(50, 100), 1);
  assert.equal(damageStage(26, 100), 1);
  assert.equal(damageStage(25, 100), 2);
  assert.equal(damageStage(0, 100), 2);
  assert.equal(damageStage(5, 0), 0, "no max hp, no damage drawn");
});

test("destruction starts the wreck clock; it ends hidden, and coming back alive resets it", () => {
  let pose = run(initialPose(idle, 0), idle, 10);
  assert.equal(pose.wreck, -1);
  const dead = { ...idle, hp: 0, alive: false };
  pose = stepPose(pose, dead, FRAME, 0);
  assert.equal(pose.wreck, 0);
  assert.ok(shipVisible(pose));
  assert.equal(pose.flash, 0, "the wreck has its own flash, not the hit flash");
  pose = run(pose, dead, Math.ceil(WRECK_TIME / FRAME) + 1);
  assert.ok(pose.wreck >= WRECK_TIME);
  assert.equal(shipVisible(pose), false);
  pose = stepPose(pose, idle, FRAME, 0);
  assert.equal(pose.wreck, -1);
  assert.ok(shipVisible(pose));

  const late = initialPose(dead, 0);
  assert.equal(
    late.wreck,
    Infinity,
    "a ship first seen destroyed plays no wreck",
  );
  assert.equal(shipVisible(stepPose(late, dead, FRAME, 0)), false);
});

test("the wreck hull tips and falls where the trail is emitted, and fades out by the end of the wreck", () => {
  const dead = { ...idle, hp: 0, alive: false };
  const pose = run(stepPose(initialPose(idle, 0), dead, FRAME, 0), dead, 60);
  assert.ok(pose.wreck > 0.9 && pose.wreck < WRECK_TIME);
  assert.ok(hullDrop(pose) > 0);
  assert.ok(hullRotation(pose) > pose.bank, "tips toward a bow facing right");
  // A point on the gondola, 15 units below the hull's centre, follows both the tipping and the fall.
  const point = shipPoint(pose, 10, 20, 2, 0, 15);
  const rotation = hullRotation(pose);
  assert.ok(Math.abs(point.x - (10 - 2 * 15 * Math.sin(rotation))) < 1e-9);
  const down = pose.bob + hullDrop(pose) + 15 * Math.cos(rotation);
  assert.ok(Math.abs(point.y - (20 + 2 * down)) < 1e-9);

  const alive = initialPose(idle, 0);
  assert.equal(hullDrop(alive), 0);
  assert.equal(hullRotation(alive), alive.bank);
  assert.equal(wreckAlpha(alive), 1);
  assert.equal(wreckAlpha({ ...pose, wreck: WRECK_TIME - WRECK_FADE }), 1);
  assert.equal(wreckAlpha({ ...pose, wreck: WRECK_TIME }), 0);
  let last = 1;
  for (let t = WRECK_TIME - WRECK_FADE; t <= WRECK_TIME; t += 0.05) {
    const alpha = wreckAlpha({ ...pose, wreck: t });
    assert.ok(alpha <= last + 1e-12);
    last = alpha;
  }
  const never = initialPose(dead, 0);
  assert.equal(hullDrop(never), 0, "a ship first seen destroyed has no wreck");
  assert.equal(hullRotation(never), never.bank);
});

/** Fails if any number in `value` is NaN or infinite. */
function assertFinite(what: string, value: unknown): void {
  if (typeof value === "number")
    assert.ok(Number.isFinite(value), `${what} is ${value}`);
}

test("frame times are capped and bad numbers never reach the drawing", () => {
  const pose = initialPose(idle, 0);
  const long = stepPose(pose, idle, 5, 0);
  assert.ok(Math.abs(long.time - MAX_DT) < 1e-12);
  const bad = stepPose(
    pose,
    {
      vx: NaN,
      thrustX: Infinity,
      thrustY: NaN,
      hp: NaN,
      maxHp: NaN,
      shield: -Infinity,
      alive: true,
    },
    NaN,
    0,
  );
  for (const [key, value] of Object.entries(bad)) assertFinite(key, value);
  assert.equal(bad.time, 0, "a bad frame time is no time at all");
  assert.equal(stepPose(pose, idle, -1, 0).time, 0, "and a negative one none");

  // One bad frame must not blind the hit detection for the frames after it.
  const hit = stepPose(bad, { ...idle, hp: 40, shield: 0 }, FRAME, 0);
  assert.equal(hit.flash, 1);
  const first = initialPose({ ...idle, hp: NaN, shield: NaN }, 0);
  for (const [key, value] of Object.entries(first)) assertFinite(key, value);

  // The emitters take positions and velocities from the engine too.
  const nan = { x: NaN, y: Infinity, vx: NaN, vy: -Infinity };
  const p = createParticles(1);
  const burning = { ...idle, hp: 10 };
  let flying = initialPose(burning, 1);
  for (let i = 0; i < 30; i++) {
    flying = stepPose(flying, burning, FRAME, 1);
    emitGunship(p, flying, { ...nan, thrustX: NaN, thrustY: 1 }, 1, FRAME);
    emitGhost(p, flying, nan, 1, FRAME);
    advanceParticles(p, FRAME);
  }
  assert.ok(p.list.length > 0);
  for (const q of p.list)
    for (const [key, value] of Object.entries(q)) assertFinite(key, value);
  owed(p, "x", 5, NaN);
  owed(p, "x", NaN, 1);
  assertFinite("owed", p.owed.x);
});

test("emitters keep their fractional debt, so low rates emit the right number over time", () => {
  const p = createParticles(1);
  let total = 0;
  for (let i = 0; i < 120; i++) total += owed(p, "smoke", 5, FRAME);
  // Ten are owed after two seconds; the last may still be a rounding error short of due.
  assert.ok(total >= 9 && total <= 10, `${total} emitted`);
  assert.ok(p.owed.smoke! >= 0 && p.owed.smoke! < 1);
});

test("particles stay bounded, repeat for a seed, and blow away from the thrust", () => {
  const state = { x: 0, y: 0, vx: 0, vy: 0, thrustX: 1, thrustY: 0 };
  const burning: PoseInput = { ...idle, hp: 10, thrustX: 1 };
  const simulate = () => {
    const p = createParticles(7);
    let pose = initialPose(burning, 7);
    let most = 0;
    for (let i = 0; i < 400; i++) {
      pose = stepPose(pose, burning, 0.1, 7);
      advanceParticles(p, 0.1);
      emitGunship(p, pose, state, 1, 0.1);
      most = Math.max(most, p.list.length);
    }
    return { p, most };
  };
  const a = simulate();
  const b = simulate();
  assert.ok(a.most <= MAX_PARTICLES);
  assert.deepEqual(a.p.list, b.p.list);

  const p = createParticles(2);
  let pose = initialPose({ ...idle, thrustX: 1 }, 2);
  for (let i = 0; i < 30; i++) {
    pose = stepPose(pose, { ...idle, thrustX: 1 }, FRAME, 2);
    emitGunship(p, pose, state, 1, FRAME);
  }
  const exhaust = p.list.filter((q) => q.kind === "exhaust");
  assert.ok(exhaust.length > 0);
  const mean = exhaust.reduce((sum, q) => sum + q.vx, 0) / exhaust.length;
  assert.ok(mean < 0, "thrusting right blows exhaust left");
});

test("the wreck bursts once, on the frame the ship is destroyed", () => {
  const p = createParticles(4);
  const state = { x: 0, y: 0, vx: 0, vy: 0, thrustX: 0, thrustY: 0 };
  const dead = { ...idle, hp: 0, alive: false };
  let pose = stepPose(initialPose(idle, 4), dead, FRAME, 4);
  emitGunship(p, pose, state, 1, FRAME);
  const shreds = p.list.filter((q) => q.kind === "shred").length;
  assert.ok(shreds > 0);
  for (let i = 0; i < 30; i++) {
    pose = stepPose(pose, dead, FRAME, 4);
    advanceParticles(p, FRAME);
    emitGunship(p, pose, state, 1, FRAME);
  }
  assert.equal(p.list.filter((q) => q.kind === "shred").length, shreds);
  // Half a second in, the gondola has fallen well below where it hung, trailing smoke and fire.
  const trail = p.list.filter((q) => q.kind !== "shred" && q.y > 40);
  assert.ok(trail.length > 0, "smoke trails the falling gondola");
  pose = run(pose, dead, Math.ceil(WRECK_TIME / FRAME));
  const before = p.list.length;
  emitGunship(p, pose, state, 1, 0.1);
  assert.equal(p.list.length, before, "nothing once the wreck is over");
});

test("a zero, negative or bad frame time after the destruction does not burst the wreck again", () => {
  const state = { x: 0, y: 0, vx: 0, vy: 0, thrustX: 0, thrustY: 0 };
  const dead = { ...idle, hp: 0, alive: false };
  const p = createParticles(5);
  let pose = stepPose(initialPose(idle, 5), dead, FRAME, 5);
  assert.ok(pose.died);
  emitGunship(p, pose, state, 1, FRAME);
  const burst = p.list.length;
  assert.ok(burst > 0);
  for (const dt of [0, 0, -1, NaN, 0]) {
    pose = stepPose(pose, dead, dt, 5);
    assert.equal(pose.wreck, 0, "no time has passed in the wreck");
    assert.equal(pose.died, false, "and the destruction is not news again");
    emitGunship(p, pose, state, 1, dt);
  }
  assert.equal(p.list.length, burst);
  pose = stepPose(pose, dead, FRAME, 5);
  assert.ok(pose.wreck > 0 && !pose.died);
});

test("a rollback that flickers a ship dead, alive, dead explodes it once", () => {
  const state = { x: 0, y: 0, vx: 0, vy: 0, thrustX: 0, thrustY: 0 };
  const dead = { ...idle, hp: 0, alive: false };
  const p = createParticles(6);
  const shreds = () => p.list.filter((q) => q.kind === "shred").length;
  let bursts = 0;
  const feed = (input: PoseInput, pose: Pose): Pose => {
    const next = stepPose(pose, input, FRAME, 6);
    if (next.died) bursts++;
    advanceParticles(p, FRAME);
    emitGunship(p, next, state, 1, FRAME);
    return next;
  };
  let pose = run(initialPose(idle, 6), idle, 5);
  pose = feed(dead, pose);
  const first = shreds();
  assert.equal(bursts, 1);
  pose = run(pose, dead, 4);
  pose = feed(idle, pose);
  assert.equal(pose.wreck, -1, "the undone hit shows the ship whole again");
  pose = feed(dead, pose);
  assert.equal(
    bursts,
    1,
    "the second destruction a moment later is not a burst",
  );
  assert.ok(shreds() <= first);
  assert.ok(pose.wreck >= 0, "though the wreck plays on");

  // A destruction long after the first is a new one.
  pose = run(pose, dead, Math.ceil(WRECK_TIME / FRAME) + 1);
  pose = feed(idle, pose);
  pose = feed(dead, pose);
  assert.equal(bursts, 2);
});

test("smoke, soot, flames and sparks follow the damage stage, and exhaust follows the thrust", () => {
  const state = { x: 0, y: 0, vx: 0, vy: 0, thrustX: 0, thrustY: 0 };
  const kinds = (hp: number, thrust: number): Set<string> => {
    const input: PoseInput = { ...idle, hp, thrustX: thrust };
    const p = createParticles(3);
    let pose = initialPose(input, 3);
    for (let i = 0; i < 120; i++) {
      pose = stepPose(pose, input, FRAME, 3);
      emitGunship(p, pose, { ...state, thrustX: thrust }, 1, FRAME);
    }
    return new Set(p.list.map((q) => q.kind));
  };
  assert.deepEqual(
    [...kinds(100, 0)],
    [],
    "an intact, idle ship gives off nothing",
  );
  assert.deepEqual([...kinds(100, 1)], ["exhaust"]);
  assert.deepEqual([...kinds(40, 0)], ["smoke"], "half hp smokes");
  const burning = kinds(10, 0);
  for (const kind of ["soot", "fire", "spark"]) assert.ok(burning.has(kind));
  assert.ok(!burning.has("smoke") && !burning.has("exhaust"));
});

test("a full particle list makes way for new particles by dropping the most lived", () => {
  const p = createParticles(0);
  const make = (age: number): Particle => ({
    ...{ kind: "smoke", x: 0, y: 0, vx: 0, vy: 0, age, life: 1 },
    ...{ size: 1, grow: 1, spin: 0 },
  });
  for (let i = 0; i < MAX_PARTICLES; i++)
    addParticle(p, make(i === 5 ? 0.9 : 0.1));
  addParticle(p, make(0));
  assert.equal(p.list.length, MAX_PARTICLES);
  assert.equal(p.list[5]!.age, 0);
  assert.equal(p.list.filter((q) => q.age === 0.9).length, 0);
});

test("a ghost trails faint wisps from its stern", () => {
  for (const side of [-1, 1] as const) {
    const p = createParticles(9);
    const input = { ...idle, vx: 80 * side };
    let pose = initialPose(input, 9, side);
    for (let i = 0; i < 60; i++) {
      pose = stepPose(pose, input, FRAME, 9);
      emitGhost(p, pose, { x: 100, y: 0, vx: 80 * side, vy: 0 }, 2, FRAME);
    }
    assert.ok(p.list.length > 0);
    assert.ok(p.list.every((q) => q.kind === "wisp"));
    // Nothing has aged yet: each wisp is where it was born, at least 14 base units (28 px at this scale) astern.
    assert.ok(
      p.list.every((q) => (q.x - 100) * side < -28),
      `a ghost facing ${side} trails behind it`,
    );
    assert.ok(
      p.list.every((q) => q.vx * side < 0),
      `facing ${side}, wisps drift the other way`,
    );
  }
});

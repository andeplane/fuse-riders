import test from "node:test";
import assert from "node:assert/strict";
import {
  addParticle,
  advanceParticles,
  BOB,
  createParticles,
  damageStage,
  emitGhost,
  emitGunship,
  FACING_SPEED,
  FLASH_TIME,
  initialPose,
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

test("bob and lean are cosmetic: they move the drawing a little and never the hit circle", () => {
  let pose = initialPose(idle, 5);
  let most = 0;
  for (let i = 0; i < 600; i++) {
    pose = stepPose(pose, { ...idle, vx: 400 }, FRAME, 5);
    most = Math.max(most, Math.abs(pose.bob));
    // The drawing's centre sits right below or above the hit circle's, offset by the bob alone.
    const centre = shipPoint(pose, 100, 200, 2, 0, 0);
    assert.equal(centre.x, 100);
    assert.equal(centre.y, 200 + 2 * pose.bob);
  }
  assert.ok(most > 0 && most <= BOB.amplitude);
  assert.ok(pose.bank > 0, "flying right leans the bow down (clockwise)");
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

test("frame times are capped and bad numbers never reach the drawing", () => {
  const pose = initialPose(idle, 0);
  const long = stepPose(pose, idle, 5, 0);
  assert.ok(Math.abs(long.time - MAX_DT) < 1e-12);
  const bad = stepPose(
    pose,
    { ...idle, vx: NaN, thrustX: Infinity, thrustY: NaN },
    NaN,
    0,
  );
  for (const value of Object.values(bad))
    if (typeof value === "number") assert.ok(!Number.isNaN(value));
});

test("emitters keep their fractional debt, so low rates emit the right number over time", () => {
  const p = createParticles(1);
  let total = 0;
  for (let i = 0; i < 60; i++) total += owed(p, "smoke", 5, FRAME);
  assert.equal(total, 5);
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

test("a ghost trails faint wisps behind it", () => {
  const p = createParticles(9);
  const input = { ...idle, vx: -80 };
  let pose = initialPose(input, 9, -1);
  for (let i = 0; i < 60; i++) {
    pose = stepPose(pose, input, FRAME, 9);
    emitGhost(p, pose, { x: 0, y: 0, vx: -80, vy: 0 }, 1, FRAME);
  }
  assert.ok(p.list.length > 0);
  assert.ok(p.list.every((q) => q.kind === "wisp"));
  assert.ok(
    p.list.every((q) => q.vx > 0),
    "facing left, wisps drift right",
  );
});

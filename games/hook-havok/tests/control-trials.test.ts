import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorld,
  DEFAULT_TUNING,
  NEUTRAL,
  S,
  cancel,
  type World,
} from "../src/engine/world.js";
import { step } from "../src/engine/step.js";
import { decodeWorld, parseInput, parseTuning } from "../src/engine/codec.js";
import { stepCombat } from "../src/engine/combat.js";
import { activeWire, wireContact } from "../src/engine/wire-contact.js";
import { KeyboardInput } from "../src/app/keyboard-input.js";

const double = () => createWorld({ ...DEFAULT_TUNING, jumpMode: "double" });
test("air jump needs a second press, cannot repeat a third time, and landing replenishes it", () => {
  const w = double();
  w.input.jump = true;
  step(w);
  assert.ok(w.vy < 0);
  assert.equal(w.airJump, true);
  for (let i = 0; i < 12; i++) step(w);
  assert.equal(w.airJump, true, "holding first jump preserves the second");
  w.input.jump = false;
  step(w);
  w.input.jump = true;
  step(w);
  assert.equal(w.airJump, false);
  assert.ok(w.vy < -12 * S);
  w.input.jump = false;
  step(w);
  const before = w.vy;
  w.input.jump = true;
  step(w);
  assert.ok(w.vy > before, "third press does not launch");
  w.input.jump = false;
  for (let i = 0; i < 180 && !w.grounded; i++) step(w);
  assert.equal(w.grounded, true);
  assert.equal(w.airJump, true);
  assert.ok(decodeWorld(w));
});
test("walk-off/drop preserve air jump; coyote takes priority; cancel and checkpoint do not refill it", () => {
  for (const drop of [false, true]) {
    const w = double();
    if (drop) {
      w.input.drop = true;
      step(w);
    } else {
      w.x = 540 * S;
      w.grounded = false;
    }
    for (let i = 0; i < 8; i++) step(w);
    w.input.jump = true;
    step(w);
    assert.equal(w.airJump, false);
    assert.ok(w.vy < 0);
    cancel(w);
    assert.equal(w.airJump, false);
    const restored = decodeWorld(w);
    assert.ok(restored);
    assert.equal(restored.airJump, false);
    w.input.reset = true;
    step(w);
    assert.equal(w.airJump, true);
  }
  const coyote = double();
  coyote.x = 540 * S;
  coyote.grounded = false;
  coyote.input.jump = true;
  step(coyote);
  assert.equal(coyote.airJump, true);
});
test("new settings, air allowance and extended directional aim domains are validated", () => {
  const w = double();
  assert.ok(decodeWorld(w));
  assert.equal(decodeWorld({ ...w, airJump: 1 }), undefined);
  assert.equal(
    decodeWorld({ ...w, airJump: false }),
    undefined,
    "grounded double jumper must be recharged",
  );
  assert.equal(decodeWorld({ ...createWorld(), airJump: true }), undefined);
  assert.equal(parseTuning({ ...DEFAULT_TUNING, wire: "electric" }), undefined);
  assert.equal(
    parseTuning({ ...DEFAULT_TUNING, jumpMode: "triple" }),
    undefined,
  );
  assert.ok(parseInput({ ...NEUTRAL, aimX: -800, aimY: -1100 }));
  assert.equal(parseInput({ ...NEUTRAL, aimY: -4001 }), undefined);
});
test("keyboard gives eight rays, retained aim, J/K hold/release, deliberate drop and clear", () => {
  for (const [keys, dx, dy] of [
    [["KeyW"], 0, -1],
    [["KeyW", "KeyD"], 1, -1],
    [["KeyD"], 1, 0],
    [["KeyD", "KeyS"], 1, 1],
    [["KeyS"], 0, 1],
    [["KeyS", "KeyA"], -1, 1],
    [["KeyA"], -1, 0],
    [["KeyA", "KeyW"], -1, -1],
  ] as const) {
    const k = new KeyboardInput();
    k.mode = "keyboard";
    keys.forEach((key) => k.key(key, true));
    k.key("KeyK", true);
    const input = k.sample(300, -100);
    assert.equal(input.aimX, 300 + dx * 1000);
    assert.equal(input.aimY, -100 + dy * 1000);
    assert.equal(input.fire, true);
    assert.ok(parseInput({ ...NEUTRAL, ...input }));
    k.key("KeyK", true);
    assert.equal(k.sample(300, 700).fire, true);
    k.clear();
    assert.equal(k.sample(300, 700).fire, false);
    assert.deepEqual(k.direction, { x: dx, y: dy });
  }
  const k = new KeyboardInput();
  k.mode = "keyboard";
  k.key("KeyS", true);
  assert.equal(k.sample(0, 0).drop, false);
  k.key("ShiftLeft", true);
  assert.equal(k.sample(0, 0).drop, true);
  k.key("KeyJ", true);
  assert.equal(k.sample(0, 0).jump, true);
  k.clear();
  assert.equal(k.sample(0, 0).jump, false);
  k.mode = "mouse";
  assert.equal(k.accepts("KeyK"), false);
  assert.equal(
    k.sample(0, 0).fire,
    undefined,
    "mouse fire ownership is untouched",
  );
});

function armed(): World {
  const w = createWorld({
    ...DEFAULT_TUNING,
    experiment: "ball",
    wire: "spiked",
  });
  w.tick = 1;
  w.x = 950 * S;
  w.feet = 840 * S;
  w.grounded = false;
  w.input.fire = true;
  w.hook = {
    phase: "flying",
    x: 950 * S,
    y: 660 * S,
    vx: 0,
    vy: -20 * S,
    life: 40,
    distance: 149 * S,
    platform: -1,
  };
  return w;
}
test("wire midpoint splits without tip contact, consumes one shot and never cascades to children", () => {
  const w = armed();
  Object.assign(w.combat.balls[0]!, { x: 910 * S, y: 750 * S });
  assert.ok(Math.abs(w.hook.y - w.combat.balls[0]!.y) > 40 * S);
  stepCombat(w);
  assert.equal(w.combat.hits, 1);
  assert.deepEqual(
    w.combat.balls.map((b) => b.id),
    [2, 3],
  );
  assert.equal(w.hook.phase, "retracting");
  stepCombat(w);
  assert.equal(w.combat.hits, 1);
  assert.ok(decodeWorld(w));
});
test("capsule detects crossing even when both endpoints miss, and blocked/inactive wire cannot hit", () => {
  const w = armed();
  const t = wireContact(900 * S, 740 * S, 100 * S, 0, 14 * S, w);
  assert.ok(t !== undefined && t > 0 && t < 1);
  for (const phase of ["ready", "retracting"] as const) {
    w.hook.phase = phase;
    assert.equal(wireContact(950 * S, 740 * S, 0, 0, 14 * S, w), undefined);
  }
  w.hook.phase = "flying";
  w.input.fire = false;
  assert.equal(activeWire(w), undefined);
  w.input.fire = true;
  w.respawn = 1;
  assert.equal(activeWire(w), undefined);
  w.respawn = 0;
  w.x = 700 * S;
  w.feet = 700 * S;
  w.hook.x = 700 * S;
  w.hook.y = 400 * S;
  assert.ok(
    activeWire(w)!.endY >= 637 * S,
    "wire stops at underside of lower ledge",
  );
  assert.equal(wireContact(700 * S, 500 * S, 0, 0, 14 * S, w), undefined);
});
test("two wires have stable owner priority and one family advances once", () => {
  const a = armed(),
    b = armed();
  Object.assign(a.combat.balls[0]!, { x: 910 * S, y: 750 * S });
  b.combat = a.combat;
  stepCombat(a, [a, b]);
  assert.equal(a.hook.phase, "retracting");
  assert.equal(b.hook.phase, "flying");
  assert.equal(a.combat.hits, 1);
  assert.equal(a.combat.balls.length, 2);
});
test("air jump and spiked-wire state replay through repeated validated checkpoints", () => {
  const a = createWorld({
    ...DEFAULT_TUNING,
    jumpMode: "double",
    wire: "spiked",
    experiment: "surge",
    map: "crossroads",
  });
  let b = structuredClone(a);
  for (let tick = 0; tick < 1200; tick++) {
    const input = {
      ...NEUTRAL,
      move: (tick % 160 < 80 ? 1 : -1) as -1 | 1,
      jump: tick % 45 === 1 || tick % 45 === 12,
      fire: tick % 60 < 30,
      aimX: 800,
      aimY: 400,
    };
    a.input = input;
    b.input = { ...input };
    step(a);
    step(b);
    assert.deepEqual(a, b);
    const restored = decodeWorld(a);
    assert.ok(restored, `tick ${tick}`);
    if (tick % 17 === 0) b = restored;
  }
});

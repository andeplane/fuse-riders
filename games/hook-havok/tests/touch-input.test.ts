import test from "node:test";
import assert from "node:assert/strict";
import { TouchInput, touchAim } from "../src/app/touch-input.js";
import { parseInput } from "../src/engine/codec.js";
import { NEUTRAL } from "../src/engine/world.js";

test("independent thumb owners combine move/jump/fire and release independently", () => {
  const c = new TouchInput();
  assert.equal(c.begin("move", 1), true);
  c.update("move", 1, 0.8, -0.8);
  c.begin("aim", 2);
  c.update("aim", 2, 0.7, -0.7);
  assert.equal(c.state.move, 1);
  assert.equal(c.state.jump, true);
  assert.equal(c.state.fire, true);
  assert.equal(c.begin("move", 3), false);
  assert.equal(c.begin("aim", 1), false);
  assert.equal(c.end("move", 3), false);
  c.end("aim", 2);
  assert.equal(c.state.move, 1);
  assert.equal(c.state.jump, true);
  assert.equal(c.state.fire, false);
  c.update("move", 1, 0.8, 0);
  assert.equal(c.state.jump, false);
  c.end("move", 1);
  assert.equal(c.state.move, 0);
  assert.equal(c.active, false);
});
test("aim dead zone, direction snapping and launch lock avoid accidental/repeated shots", () => {
  const c = new TouchInput();
  c.begin("aim", 1);
  c.update("aim", 1, 0.1, 0.1);
  assert.equal(c.state.fire, false);
  c.update("aim", 1, 0.8, -0.2);
  assert.equal(c.state.fire, true);
  assert.equal(c.state.direction.x, 1);
  const direction = c.state.direction;
  c.update("aim", 1, -1, 0);
  assert.deepEqual(c.state.direction, direction);
  c.update("aim", 1, 0, 0);
  assert.equal(c.state.fire, true, "returning to center keeps grapple held");
  c.end("aim", 1);
  c.mode = "free";
  c.begin("aim", 2);
  c.update("aim", 2, 0.8, -0.2);
  assert.ok(c.state.direction.y < -0.2 && c.state.direction.y > -0.3);
});
test("cancel/clear rejects stale fingers, recycled IDs work only after a new press", () => {
  const c = new TouchInput();
  c.begin("move", 1);
  c.begin("aim", 2);
  c.update("move", 1, -1, -1);
  c.update("aim", 2, 1, 0);
  c.clear();
  assert.equal(c.update("move", 1, 1, -1), false);
  assert.equal(c.update("aim", 2, 1, 0), false);
  assert.equal(c.state.move, 0);
  assert.equal(c.state.jump, false);
  assert.equal(c.state.fire, false);
  c.begin("move", 1);
  c.update("move", 1, 1, 0);
  assert.equal(c.state.move, 1);
  c.update("move", 1, NaN, Infinity);
  assert.equal(c.state.move, 1);
});
test("aim endpoints preserve direction within the wire contract near arena edges", () => {
  const aim = touchAim(1590, 880, { x: Math.SQRT1_2, y: -Math.SQRT1_2 });
  assert.deepEqual(aim, { aimX: 1600, aimY: 870 });
  for (const x of [0, 310, 1600])
    for (const y of [-20, 780, 950])
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        assert.ok(
          parseInput({
            ...NEUTRAL,
            ...touchAim(x, y, { x: Math.cos(angle), y: Math.sin(angle) }),
          }),
        );
      }
});

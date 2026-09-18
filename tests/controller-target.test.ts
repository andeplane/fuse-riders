import test from "node:test";
import assert from "node:assert/strict";
import {
  ControllerInputState,
  type ControllerInputMessage,
} from "../src/client/controller-state.js";

function fixture(aimRotated = () => false) {
  const messages: ControllerInputMessage[] = [];
  let now = 0;
  const state = new ControllerInputState(
    {
      send: (m) => {
        messages.push(m);
        return true;
      },
    },
    () => now,
    aimRotated,
  );
  state.configureTargetAim({ x: 0.5, y: 0.5 });
  return {
    state,
    messages,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
test("target trackpad uses relative motion, throttles packets and sends final release coordinates", () => {
  const f = fixture();
  f.state.pointerDown(1, "bomb", { x: 100, y: 100 });
  assert.deepEqual(f.messages.at(-1)!.aim, { x: 0.5, y: 0.5 });
  f.state.pointerMove(1, { x: 132, y: 118 });
  assert.equal(
    f.messages.length,
    1,
    "move packets are throttled within a frame",
  );
  f.advance(16);
  f.state.pointerMove(1, { x: 164, y: 136 });
  assert.ok(Math.abs(f.messages.at(-1)!.aim!.x - 0.7) < 1e-8);
  f.state.pointerRelease(1, { x: 196, y: 154 });
  assert.equal(f.messages.at(-1)!.bombAction, "release");
  assert.ok(Math.abs(f.messages.at(-1)!.aim!.x - 0.8) < 1e-8);
  assert.ok(Math.abs(f.messages.at(-1)!.aim!.y - 0.8) < 1e-8);
  f.state.pointerDown(2, "left");
  assert.equal(f.messages.at(-1)!.aim, undefined);
});
test("aim clamps the board and other fingers cannot move it; cancellation clears it", () => {
  const f = fixture();
  f.state.pointerDown(1, "bomb", { x: 0, y: 0 });
  f.state.pointerDown(2, "left", { x: 0, y: 0 });
  f.advance(50);
  assert.equal(f.state.pointerMove(2, { x: 100, y: 100 }), false);
  f.state.pointerMove(1, { x: 9999, y: -9999 });
  assert.deepEqual(f.messages.at(-1)!.aim, { x: 1, y: 0 });
  f.state.pointerCancel(1);
  assert.equal(f.messages.at(-1)!.bombAction, "cancel");
  assert.equal(f.messages.at(-1)!.aim, undefined);
  f.state.clear();
  assert.equal(f.state.pointerMove(1, { x: 5, y: 5 }), false);
});
test("second Fire contact inherits aim without a jump, refresh does not reset active aim", () => {
  const f = fixture();
  f.state.pointerDown(1, "bomb", { x: 0, y: 0 });
  f.state.pointerDown(2, "bomb", { x: 200, y: 200 });
  f.state.pointerRelease(1);
  f.state.configureTargetAim({ x: 0.1, y: 0.1 });
  f.advance(50);
  f.state.pointerMove(2, { x: 232, y: 200 });
  assert.deepEqual(f.messages.at(-1)!.aim, { x: 0.6, y: 0.5 });
  f.state.pointerRelease(2);
  assert.equal(f.messages.at(-1)!.bombAction, "release");
});
test("ordinary controls send no aim and invalid positions do not corrupt it", () => {
  const f = fixture();
  f.state.configureTargetAim(undefined);
  f.state.pointerDown(1, "bomb", { x: 0, y: 0 });
  f.advance(50);
  assert.equal(f.state.pointerMove(1, { x: 30, y: 30 }), false);
  assert.equal(f.messages.at(-1)!.aim, undefined);
  f.state.configureTargetAim({ x: 0.5, y: 0.5 });
  assert.equal(f.state.pointerMove(1, { x: NaN, y: 0 }), false);
  f.state.pointerMove(1, { x: 62, y: 30 });
  assert.deepEqual(f.messages.at(-1)!.aim, { x: 0.6, y: 0.5 });
  f.state.clear(false);
  f.state.pointerDown(3, "bomb");
  assert.equal(f.state.pointerMove(3, { x: 10, y: 10 }), false);
});

test("portrait target dragging follows screen axes and final release, then returns to landscape after cancellation", () => {
  let rotated = true;
  const f = fixture(() => rotated);
  f.state.pointerDown(1, "bomb", { x: 100, y: 100 });
  f.advance(16);
  f.state.pointerMove(1, { x: 118, y: 132 });
  assert.deepEqual(f.messages.at(-1)!.aim, { x: 0.6, y: 0.4 });
  f.state.pointerRelease(1, { x: 136, y: 164 });
  assert.ok(Math.abs(f.messages.at(-1)!.aim!.x - 0.7) < 1e-8);
  assert.ok(Math.abs(f.messages.at(-1)!.aim!.y - 0.3) < 1e-8);
  assert.equal(f.messages.at(-1)!.bombAction, "release");
  f.state.pointerDown(2, "bomb", { x: 0, y: 0 });
  f.state.clear();
  assert.equal(f.messages.at(-1)!.bombAction, "cancel");
  rotated = false;
  f.state.pointerDown(3, "bomb", { x: 0, y: 0 });
  f.state.pointerRelease(3, { x: 32, y: 18 });
  assert.deepEqual(f.messages.at(-1)!.aim, { x: 0.6, y: 0.6 });
});

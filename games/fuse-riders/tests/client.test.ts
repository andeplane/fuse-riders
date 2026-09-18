import assert from "node:assert/strict";
import test from "node:test";
import {
  ControllerInputState,
  type ControllerInputMessage,
} from "../src/client/controller-state.js";
import {
  PORTAL_PALETTES,
  portalPalettes,
} from "../src/render/portal-palettes.js";

test("multitouch retains a control until its final pointer releases", () => {
  const messages: ControllerInputMessage[] = [];
  const state = new ControllerInputState({
    send: (message) => {
      messages.push(message);
      return true;
    },
  });
  state.setNextSequence(7);
  state.pointerDown(1, "left");
  state.pointerDown(2, "left");
  state.pointerDown(3, "right");
  state.pointerRelease(1);
  state.pointerRelease(2);
  assert.deepEqual(messages, [
    { type: "input", seq: 7, left: true, right: false, bomb: false },
    { type: "input", seq: 8, left: true, right: true, bomb: false },
    { type: "input", seq: 9, left: false, right: true, bomb: false },
  ]);
});

test("fast bomb tap and cancellation always send the falling edge", () => {
  const messages: ControllerInputMessage[] = [];
  const state = new ControllerInputState({
    send: (message) => {
      messages.push(message);
      return true;
    },
  });
  state.pointerDown(20, "bomb");
  state.pointerRelease(20);
  state.pointerDown(21, "bomb");
  state.clear();
  assert.deepEqual(
    messages.map(({ bomb }) => bomb),
    [true, false, true, false],
  );
  assert.deepEqual(
    messages.map(({ bombAction }) => bombAction),
    ["press", "release", "press", "cancel"],
  );
  assert.deepEqual(
    messages.map(({ seq }) => seq),
    [0, 1, 2, 3],
  );
});

test("pointer cancellation never launches and lost capture after release is a no-op", () => {
  const messages: ControllerInputMessage[] = [];
  const state = new ControllerInputState({
    send: (message) => {
      messages.push(message);
      return true;
    },
  });
  state.pointerDown(7, "bomb");
  state.resend();
  state.pointerCancel(7);
  assert.equal(state.pointerCancel(7), false);
  state.pointerDown(8, "bomb");
  state.pointerRelease(8);
  assert.equal(state.pointerCancel(8), false);
  assert.deepEqual(
    messages.map(({ bombAction }) => bombAction),
    ["press", undefined, "cancel", "press", "release"],
  );
});

test("reconnect can force a neutral sample to rearm bomb edges", () => {
  const messages: ControllerInputMessage[] = [];
  const state = new ControllerInputState({
    send: (message) => {
      messages.push(message);
      return true;
    },
  });
  state.setNextSequence(42);
  state.clear(true, true);
  assert.deepEqual(messages, [
    { type: "input", seq: 42, left: false, right: false, bomb: false },
  ]);
});

test("held-state resend advances sequence while idle resend stays silent", () => {
  const messages: ControllerInputMessage[] = [];
  const state = new ControllerInputState({
    send: (message) => {
      messages.push(message);
      return true;
    },
  });
  assert.equal(state.resend(), false);
  state.pointerDown(1, "right");
  assert.equal(state.isHeld("right"), true);
  assert.equal(state.resend(), true);
  state.clear(false);
  assert.equal(state.isHeld("right"), false);
  assert.equal(state.hasHeld(), false);
  assert.equal(state.resend(), false);
  assert.deepEqual(messages, [
    { type: "input", seq: 0, left: false, right: true, bomb: false },
    { type: "input", seq: 1, left: false, right: true, bomb: false },
  ]);
});

test("simultaneous portal pairs never share a palette, and keep their colour when a neighbour retires", () => {
  const ids = ["1:4:120", "1:5:180", "1:6:240"];
  const assigned = portalPalettes(ids);
  assert.equal(
    new Set(assigned).size,
    ids.length,
    "every live pair is told apart by colour",
  );
  for (const palette of assigned)
    assert.notEqual(
      palette[0],
      palette[1],
      "the two ends of one pair stay distinguishable",
    );
  // Retiring the oldest leaves the survivors on the colours they already had.
  assert.deepEqual(portalPalettes(ids.slice(1)), assigned.slice(1));
  // The fixture ids that previously collided are now separated.
  assert.equal(
    new Set(portalPalettes(["fixture-gates", "fixture-gates-2"])).size,
    2,
  );
  assert.ok(PORTAL_PALETTES.length >= 3);
});

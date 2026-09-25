import test from "node:test";
import assert from "node:assert/strict";
import {
  ControllerGamepadBindings,
  STANDARD_PAD,
  activeBinding,
  readGamepads,
  type PadSnapshot,
} from "../src/client/controller-gamepad.js";
import {
  ControllerInputState,
  type ControllerInputMessage,
} from "../src/client/controller-state.js";

const pad = (index = 0, buttons: number[] = [], axis = 0): PadSnapshot => ({
  index,
  id: "8BitDo",
  mapping: "standard",
  connected: true,
  axes: [axis, 0],
  buttons: Array.from({ length: 17 }, (_, i) => ({
    pressed: buttons.includes(i),
    value: Number(buttons.includes(i)),
  })),
});
function fixture(index = 0) {
  const messages: ControllerInputMessage[] = [];
  const state = new ControllerInputState({
    send: (m) => {
      messages.push(m);
      return true;
    },
  });
  let starts = 0;
  const bindings = new ControllerGamepadBindings(
    { index, id: "8BitDo", mapping: STANDARD_PAD, standard: true },
    state,
    () => starts++,
  );
  bindings.update([pad(index)], true);
  return { messages, state, bindings, starts: () => starts };
}
test("stick dead zone and hysteresis, D-pad and fire produce ordinary independent edges", () => {
  const f = fixture();
  f.bindings.update([pad(0, [], -0.3)], true);
  assert.equal(f.messages.length, 0);
  f.bindings.update([pad(0, [0], -0.8)], true);
  f.bindings.update([pad(0, [0], -0.35)], true);
  assert.equal(f.state.isHeld("left"), true);
  f.bindings.update([pad(0, [0], -0.2)], true);
  f.bindings.update([pad(0, [15])], true);
  assert.equal(f.state.isHeld("right"), true);
  assert.deepEqual(
    f.messages.flatMap((m) => (m.bombAction ? [m.bombAction] : [])),
    ["press", "release"],
  );
  f.bindings.update([pad()], true);
  assert.equal(f.state.hasHeld(), false);
});
test("identical controllers stay assigned by index even when array order changes or has holes", () => {
  const a = fixture(0),
    b = fixture(3);
  const frames = [pad(3, [0, 15]), pad(0, [14])];
  a.bindings.update(frames, true);
  b.bindings.update(frames, true);
  assert.equal(a.state.isHeld("left"), true);
  assert.equal(a.state.isHeld("bomb"), false);
  assert.equal(b.state.isHeld("right"), true);
  assert.equal(b.state.isHeld("bomb"), true);
  a.bindings.update([pad(3)], true);
  assert.equal(a.state.hasHeld(), false);
  assert.equal(b.state.isHeld("bomb"), true);
});
test("disconnect, blur/menu/phase cancellation never fires and require neutral on return", () => {
  for (const cancel of ["disconnect", "blocked", "clear"] as const) {
    const f = fixture();
    f.bindings.update([pad(0, [0, 14])], true);
    if (cancel === "clear") f.bindings.clear();
    else
      f.bindings.update(
        cancel === "disconnect" ? [] : [pad(0, [0, 14])],
        cancel !== "blocked",
      );
    f.bindings.update([pad(0, [0, 14])], true);
    f.bindings.update([pad()], true);
    assert.equal(f.state.hasHeld(), false);
    assert.deepEqual(
      f.messages.flatMap((m) => (m.bombAction ? [m.bombAction] : [])),
      ["press", "cancel"],
    );
    f.bindings.update([pad(0, [0])], true);
    f.bindings.update([pad()], true);
    assert.equal(f.messages.at(-1)?.bombAction, "release");
  }
});
test("start fires once per press; a replacement device cannot claim the old rider", () => {
  const f = fixture();
  f.bindings.update([pad(0, [9])], true);
  f.bindings.update([pad(0, [9])], true);
  assert.equal(f.starts(), 1);
  f.bindings.update([pad()], true);
  f.bindings.update([{ ...pad(0, [0, 9]), id: "Different controller" }], true);
  assert.equal(f.bindings.connected, false);
  assert.equal(f.starts(), 1);
  assert.equal(f.state.hasHeld(), false);
});
test("custom raw layouts and calibration tolerate missing and out of range axes", () => {
  const f = fixture();
  const custom = new ControllerGamepadBindings(
    {
      index: 0,
      id: "8BitDo",
      standard: false,
      mapping: {
        left: [{ axis: 1, direction: -1 }],
        right: [{ axis: 1, direction: 1 }],
        bomb: [{ button: 2 }],
      },
    },
    f.state,
  );
  custom.update([pad()], true);
  custom.update([{ ...pad(0, [2]), axes: [NaN, -1] }], true);
  assert.equal(f.state.isHeld("left"), true);
  assert.equal(f.state.isHeld("bomb"), true);
  assert.deepEqual(activeBinding(pad(0, [], -1)), { axis: 0, direction: -1 });
  assert.equal(activeBinding(pad(0, [], -1), true), undefined);
  assert.equal(activeBinding({ ...pad(), axes: [3.28, NaN] }), undefined);
});
test("browser access handles sparse snapshots, unsupported APIs and blocked access", () => {
  assert.deepEqual(
    readGamepads({ getGamepads: () => [null, pad(1)] }).pads.map(
      (p) => p.index,
    ),
    [1],
  );
  assert.match(readGamepads({}).error!, /does not support/);
  assert.match(
    readGamepads({
      getGamepads: () => {
        throw new Error("SecurityError");
      },
    }).error!,
    /blocked/,
  );
});

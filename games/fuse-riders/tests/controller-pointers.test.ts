import test from "node:test";
import assert from "node:assert/strict";
import {
  ControllerInputState,
  type ControllerInputMessage,
} from "../src/client/controller-state.js";
import {
  ControllerPointerBindings,
  type PointerButton,
} from "../src/client/controller-pointers.js";

class Button extends EventTarget implements PointerButton {
  disabled = false;
  active = false;
  captureFails = false;
  captures = new Set<number>();
  classList = {
    toggle: (_name: string, value?: boolean) => (this.active = Boolean(value)),
  };
  setPointerCapture(id: number): void {
    if (this.captureFails) throw new Error("contact expired");
    this.captures.add(id);
  }
  hasPointerCapture(id: number): boolean {
    return this.captures.has(id);
  }
  releasePointerCapture(id: number): void {
    this.captures.delete(id);
    fire(this, "lostpointercapture", id);
  }
}
function fire(
  target: EventTarget,
  type: string,
  pointerId: number,
  pointerType = "touch",
  button = 0,
  buttons = 1,
): void {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, {
    pointerId,
    pointerType,
    button,
    buttons,
    clientX: 50,
    clientY: 50,
  });
  target.dispatchEvent(event);
}
function fixture(slide = false) {
  const messages: ControllerInputMessage[] = [];
  const state = new ControllerInputState({
    send: (message) => {
      messages.push(message);
      return true;
    },
  });
  const left = new Button();
  const right = new Button();
  const bomb = new Button();
  const terminal = new EventTarget();
  let changes = 0;
  let hovered: PointerButton | undefined;
  const bindings = new ControllerPointerBindings(
    state,
    [
      [left, "left"],
      [right, "right"],
      [bomb, "bomb"],
    ],
    terminal,
    () => {
      changes += 1;
    },
    slide ? () => hovered : undefined,
  );
  return {
    messages,
    state,
    left,
    right,
    bomb,
    terminal,
    bindings,
    hover: (button?: PointerButton) => {
      hovered = button;
    },
    changes: () => changes,
  };
}

function key(
  target: EventTarget,
  type: "keydown" | "keyup",
  code: string,
  options: Partial<KeyboardEvent> = {},
): Event {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, {
    code,
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
}

for (const [left, right] of [
  ["ArrowLeft", "ArrowRight"],
  ["KeyA", "KeyD"],
] as const) {
  test(`keyboard ${left}/${right} and Space share serialized steering and charge/release semantics`, () => {
    const f = fixture();
    f.bindings.bindKeyboard(f.terminal, () => true);
    assert.equal(key(f.terminal, "keydown", left).defaultPrevented, true);
    key(f.terminal, "keydown", "Space");
    key(f.terminal, "keydown", "Space", { repeat: true });
    assert.equal(f.messages.length, 2);
    assert.deepEqual(f.messages[1], {
      type: "input",
      seq: 1,
      left: true,
      right: false,
      bomb: true,
      bombAction: "press",
    });
    assert.equal(f.left.active, true);
    assert.equal(f.bomb.active, true);
    key(f.terminal, "keydown", right);
    key(f.terminal, "keyup", left);
    assert.equal(f.left.active, false);
    assert.equal(f.right.active, true);
    key(f.terminal, "keyup", "Space");
    key(f.terminal, "keyup", right);
    assert.equal(f.messages.at(-2)!.bombAction, "release");
    assert.equal(f.state.hasHeld(), false);
  });
}

test("arrow and letter aliases keep steering until both keys are released", () => {
  for (const [arrow, letter, control] of [
    ["ArrowLeft", "KeyA", "left"],
    ["ArrowRight", "KeyD", "right"],
  ] as const) {
    for (const [first, second] of [
      [arrow, letter],
      [letter, arrow],
    ] as const) {
      const f = fixture();
      f.bindings.bindKeyboard(f.terminal, () => true);
      key(f.terminal, "keydown", first);
      key(f.terminal, "keydown", second);
      key(f.terminal, "keydown", second, { repeat: true });
      key(f.terminal, "keyup", first);
      assert.equal(f.state.isHeld(control), true);
      assert.equal(f.messages.length, 1);
      key(f.terminal, "keyup", second);
      assert.deepEqual(f.messages, [
        {
          type: "input",
          seq: 0,
          left: control === "left",
          right: control === "right",
          bomb: false,
        },
        { type: "input", seq: 1, left: false, right: false, bomb: false },
      ]);
    }
  }
});

test("keyboard and pointer holds do not release each other", () => {
  const f = fixture();
  f.bindings.bindKeyboard(f.terminal, () => true);
  key(f.terminal, "keydown", "Space");
  fire(f.bomb, "pointerdown", 1);
  key(f.terminal, "keyup", "Space");
  assert.equal(f.bomb.active, true);
  fire(f.terminal, "pointerup", 1);
  assert.deepEqual(
    f.messages.map((message) => message.bombAction),
    ["press", "release"],
  );
  fire(f.left, "pointerdown", 2);
  key(f.terminal, "keydown", "ArrowLeft");
  fire(f.terminal, "pointerup", 2);
  assert.equal(f.left.active, true);
  key(f.terminal, "keyup", "ArrowLeft");
  assert.equal(f.left.active, false);
});

test("focus/lifecycle cancellation never fires or reactivates a held key on repeat", () => {
  const f = fixture();
  let enabled = true;
  f.bindings.bindKeyboard(f.terminal, () => enabled);
  key(f.terminal, "keydown", "Space");
  f.terminal.dispatchEvent(new Event("focusin"));
  assert.equal(f.bomb.active, true);
  enabled = false;
  f.terminal.dispatchEvent(new Event("focusin"));
  assert.equal(f.messages.at(-1)!.bombAction, "cancel");
  key(f.terminal, "keyup", "Space");
  enabled = true;
  key(f.terminal, "keydown", "Space", { repeat: true });
  assert.equal(f.state.hasHeld(), false);
  key(f.terminal, "keydown", "Space");
  f.bindings.clear();
  key(f.terminal, "keyup", "Space");
  assert.deepEqual(
    f.messages.map((message) => message.bombAction),
    ["press", "cancel", "press", "cancel"],
  );
});

test("typing, disabled contexts and browser shortcuts are left alone, but keyup still releases", () => {
  const f = fixture();
  let enabled = false;
  f.bindings.bindKeyboard(f.terminal, () => enabled);
  for (const code of ["Space", "KeyA", "KeyD"]) {
    assert.equal(key(f.terminal, "keydown", code).defaultPrevented, false);
  }
  enabled = true;
  for (const modifier of ["altKey", "ctrlKey", "metaKey"]) {
    for (const code of ["ArrowLeft", "KeyA", "KeyD"]) {
      assert.equal(
        key(f.terminal, "keydown", code, { [modifier]: true }).defaultPrevented,
        false,
      );
    }
  }
  key(f.terminal, "keydown", "KeyW");
  key(f.terminal, "keyup", "KeyW");
  assert.equal(f.messages.length, 0);
  key(f.terminal, "keydown", "ArrowRight");
  enabled = false;
  key(f.terminal, "keyup", "ArrowRight");
  assert.equal(f.state.hasHeld(), false);
});

test("recycled pointer ownership cancels old steering and makes both buttons reusable", () => {
  const f = fixture();
  fire(f.left, "pointerdown", 1);
  fire(f.right, "pointerdown", 1);
  assert.equal(f.left.active, false);
  assert.equal(f.right.active, true);
  assert.equal(f.left.captures.size, 0);
  fire(f.terminal, "pointerup", 1);
  assert.equal(f.state.hasHeld(), false);
  fire(f.left, "pointerdown", 1);
  fire(f.terminal, "pointerup", 1);
  assert.equal(f.left.active, false);
  assert.ok(f.changes() > 0);
});

test("global release works if capture throws and leaves simultaneous touches intact", () => {
  const f = fixture();
  f.left.captureFails = true;
  fire(f.left, "pointerdown", 1);
  fire(f.left, "pointerdown", 2);
  fire(f.bomb, "pointerdown", 3);
  fire(f.terminal, "pointercancel", 1);
  assert.equal(f.left.active, true);
  assert.equal(f.bomb.active, true);
  fire(f.terminal, "pointerup", 2);
  fire(f.terminal, "pointerup", 3);
  assert.equal(f.state.hasHeld(), false);
  assert.equal(f.messages.at(-1)!.bombAction, "release");
});

test("lost capture and clear cancel charge without accidental release, then recover immediately", () => {
  const f = fixture();
  fire(f.bomb, "pointerdown", 1);
  fire(f.bomb, "lostpointercapture", 1);
  fire(f.terminal, "pointerup", 1);
  assert.equal(f.messages.at(-1)!.bombAction, "cancel");
  fire(f.left, "pointerdown", 2);
  fire(f.bomb, "pointerdown", 3);
  f.bindings.clear();
  assert.equal(f.left.captures.size, 0);
  assert.equal(f.bomb.captures.size, 0);
  assert.equal(f.left.active, false);
  assert.equal(f.bomb.active, false);
  assert.equal(f.messages.at(-1)!.bombAction, "cancel");
  fire(f.bomb, "pointerdown", 3);
  fire(f.terminal, "pointerup", 3);
  assert.equal(f.messages.at(-1)!.bombAction, "release");
  f.bindings.clear(false);
  f.bindings.clear(true, true);
  assert.equal(f.messages.at(-1)!.bomb, false);
});

test("disabled buttons, unrelated capture loss, right clicks and duplicate terminal events do nothing", () => {
  const f = fixture();
  f.bomb.disabled = true;
  fire(f.bomb, "pointerdown", 1);
  fire(f.left, "pointerdown", 2, "mouse", 2);
  assert.equal(f.messages.length, 0);
  fire(f.left, "pointerdown", 3);
  fire(f.right, "lostpointercapture", 3);
  assert.equal(f.left.active, true);
  fire(f.terminal, "pointerup", 3);
  const count = f.messages.length;
  fire(f.terminal, "pointercancel", 3);
  assert.equal(f.messages.length, count);
  fire(f.left, "contextmenu", 4);
});

test("input model independently repairs pointer reassignment and preserves duplicate down", () => {
  const f = fixture();
  f.state.pointerDown(1, "left");
  f.state.pointerDown(1, "left");
  assert.equal(f.messages.length, 1);
  f.state.pointerDown(1, "bomb");
  assert.equal(f.state.isHeld("left"), false);
  f.state.pointerDown(1, "right");
  assert.equal(f.messages.at(-2)!.bombAction, "cancel");
  f.state.pointerRelease(1);
  assert.equal(f.state.hasHeld(), false);
});

test("held drag enters, switches and exits buttons without tapping; hovering does not press", () => {
  const f = fixture(true);
  f.hover(f.left);
  fire(f.terminal, "pointermove", 1, "mouse", 0, 0);
  assert.equal(f.state.hasHeld(), false);
  fire(f.terminal, "pointermove", 1);
  assert.equal(f.left.active, true);
  f.hover(f.right);
  fire(f.terminal, "pointermove", 1);
  assert.equal(f.left.active, false);
  assert.equal(f.right.active, true);
  f.hover();
  fire(f.terminal, "pointermove", 1);
  assert.equal(f.state.hasHeld(), false);
  f.bomb.disabled = true;
  f.hover(f.bomb);
  fire(f.terminal, "pointermove", 1);
  assert.equal(f.state.hasHeld(), false);
});
test("sliding off a held bomb onto steering cancels the charge instead of firing", () => {
  const f = fixture(true);
  fire(f.bomb, "pointerdown", 1);
  f.hover(f.left);
  fire(f.terminal, "pointermove", 1);
  assert.equal(f.bomb.active, false);
  assert.equal(f.left.active, true);
  fire(f.terminal, "pointerup", 1);
  assert.deepEqual(
    f.messages.map((message) => message.bombAction).filter(Boolean),
    ["press", "cancel"],
  );
});

test("cancelled or cleared contacts cannot slide-reactivate before lifting", () => {
  const f = fixture(true);
  f.hover(f.left);
  fire(f.left, "pointerdown", 1);
  f.bindings.clear();
  fire(f.terminal, "pointermove", 1);
  assert.equal(f.state.hasHeld(), false);
  fire(f.terminal, "pointerup", 1);
  fire(f.terminal, "pointermove", 1);
  assert.equal(f.left.active, true);
  fire(f.terminal, "pointercancel", 1);
  fire(f.terminal, "pointermove", 1);
  assert.equal(f.state.hasHeld(), false);
  fire(f.left, "pointerdown", 1);
  assert.equal(f.left.active, true);
});

import test from "node:test";
import assert from "node:assert/strict";
import { attachGamepads, type GamepadLike } from "../src/app/input/gamepad.js";
import { InputHub, deviceLabel, type DeviceId } from "../src/app/input/hub.js";
import {
  KEY_BINDINGS,
  attachKeyboard,
  type KeyEventLike,
  type KeyboardTarget,
} from "../src/app/input/keyboard.js";
import {
  attachTouch,
  touchBandHeight,
  touchZoneAt,
  touchZoneLayout,
  type PointerLike,
  type PointerTarget,
} from "../src/app/input/touch.js";

/** A fake event target: records listeners by type and dispatches plain objects to them. */
class FakeTarget {
  readonly listeners = new Map<string, Set<(event: never) => void>>();
  addEventListener(type: string, listener: (event: never) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: (event: never) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type: string, event: object = {}): void {
    for (const listener of this.listeners.get(type) ?? [])
      (listener as (event: object) => void)(event);
  }
  count(): number {
    return [...this.listeners.values()].reduce((n, set) => n + set.size, 0);
  }
}

function recorder(): { presses: DeviceId[]; press: (d: DeviceId) => void } {
  const presses: DeviceId[] = [];
  return { presses, press: (device) => presses.push(device) };
}

function keyEvent(
  code: string,
  extra: Partial<KeyEventLike> = {},
): KeyEventLike & { prevented: boolean } {
  const event = {
    code,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    prevented: false,
    preventDefault: () => {
      event.prevented = true;
    },
    ...extra,
  };
  return event;
}

test("the hub latches presses per bound slot until taken", () => {
  const hub = new InputHub();
  hub.bind(0, "key:Q");
  hub.bind(2, "pad:0");
  hub.press("pad:0");
  hub.press("key:P"); // unbound: ignored by slots
  assert.deepEqual(hub.takePresses(4), [false, false, true, false]);
  assert.deepEqual(hub.takePresses(4), [false, false, false, false]);
  hub.press("key:Q");
  hub.press("key:Q");
  assert.deepEqual(hub.takePresses(3), [true, false, false]);
});

test("the hub reports every device press to listeners, for lobby joining", () => {
  const hub = new InputHub();
  const seen: DeviceId[] = [];
  const unsubscribe = hub.onPress((device) => seen.push(device));
  hub.press("touch:1");
  hub.press("key:M");
  unsubscribe();
  hub.press("pad:3");
  assert.deepEqual(seen, ["touch:1", "key:M"]);
});

test("a throwing press listener does not stop the others (#12)", () => {
  const errors: unknown[] = [];
  const hub = new InputHub((error) => errors.push(error));
  const seen: DeviceId[] = [];
  const boom = new Error("boom");
  hub.onPress(() => {
    throw boom;
  });
  hub.onPress((device) => seen.push(device));
  hub.bind(0, "key:Q");
  const target = new FakeTarget();
  attachKeyboard(target as KeyboardTarget, (d) => hub.press(d));
  assert.doesNotThrow(() => target.dispatch("keydown", keyEvent("KeyQ")));
  assert.deepEqual(seen, ["key:Q"]);
  assert.deepEqual(errors, [boom]);
  assert.deepEqual(hub.takePresses(1), [true], "the press is still latched");
});

test("binding drops the joining press and moves a device between slots", () => {
  const hub = new InputHub();
  hub.onPress((device) => {
    if (hub.slotOf(device) === undefined) hub.bind(1, device);
  });
  hub.press("key:C");
  assert.equal(hub.slotOf("key:C"), 1);
  assert.deepEqual(hub.takePresses(2), [false, false], "join press dropped");

  hub.bind(4, "key:C");
  assert.equal(hub.deviceOf(1), undefined);
  assert.equal(hub.slotOf("key:C"), 4);
  hub.bind(4, "pad:1"); // replaces the slot's device
  assert.equal(hub.slotOf("key:C"), undefined);
  hub.bind(0, "key:Q");
  assert.deepEqual(hub.bindings(), [
    { slot: 0, device: "key:Q" },
    { slot: 4, device: "pad:1" },
  ]);
  hub.unbind(4);
  hub.press("key:Q");
  hub.clearPresses();
  assert.deepEqual(hub.takePresses(5), [false, false, false, false, false]);
});

test("the hub polls and disposes its sources", () => {
  const hub = new InputHub();
  let polls = 0;
  let disposed = 0;
  hub.addSource({ poll: () => polls++, dispose: () => disposed++ });
  hub.addSource({});
  hub.poll();
  hub.poll();
  hub.dispose();
  hub.dispose();
  assert.deepEqual([polls, disposed], [2, 1]);
});

test("device labels are short and one-based", () => {
  assert.deepEqual(
    (["key:Q", "key:ARROWS", "pad:0", "touch:2"] as const).map(deviceLabel),
    ["Q", "ARROWS", "PAD 1", "TOUCH 3"],
  );
});

test("there are six distinct keyboard buttons with no shared codes", () => {
  assert.equal(new Set(KEY_BINDINGS.map((b) => b.device)).size, 6);
  const codes = KEY_BINDINGS.flatMap((b) => b.codes);
  assert.equal(new Set(codes).size, codes.length);
});

test("keyboard: each bound key presses its device once per keydown, ignoring repeat", () => {
  const target = new FakeTarget();
  const { presses, press } = recorder();
  const source = attachKeyboard(target as KeyboardTarget, press);
  const down = keyEvent("KeyQ");
  target.dispatch("keydown", down);
  assert.ok(down.prevented);
  target.dispatch("keydown", keyEvent("KeyQ", { repeat: true }));
  target.dispatch("keydown", keyEvent("KeyQ")); // repeat without the flag
  target.dispatch("keydown", keyEvent("KeyP"));
  target.dispatch("keyup", keyEvent("KeyQ"));
  target.dispatch("keydown", keyEvent("KeyQ"));
  assert.deepEqual(presses, ["key:Q", "key:P", "key:Q"]);

  const unbound = keyEvent("KeyA");
  target.dispatch("keydown", unbound);
  assert.equal(unbound.prevented, false);
  const shortcut = keyEvent("KeyC", { ctrlKey: true });
  target.dispatch("keydown", shortcut);
  assert.equal(shortcut.prevented, false, "Ctrl+C stays the browser's");
  assert.equal(presses.length, 3);

  source.dispose?.();
  assert.equal(target.count(), 0);
});

test("keyboard: aliased keys are one button, and blur forgets held keys", () => {
  const target = new FakeTarget();
  const { presses, press } = recorder();
  attachKeyboard(target as KeyboardTarget, press);
  target.dispatch("keydown", keyEvent("ArrowUp"));
  target.dispatch("keydown", keyEvent("ArrowLeft")); // same button still held
  target.dispatch("keyup", keyEvent("ArrowUp"));
  target.dispatch("keyup", keyEvent("ArrowLeft"));
  target.dispatch("keydown", keyEvent("ArrowDown"));
  target.dispatch("keydown", keyEvent("Numpad0"));
  target.dispatch("blur");
  target.dispatch("keydown", keyEvent("Numpad0")); // its keyup was lost
  assert.deepEqual(presses, [
    "key:ARROWS",
    "key:ARROWS",
    "key:NUM0",
    "key:NUM0",
  ]);
});

test("keyboard: a lost keyup does not block the button forever (#12)", () => {
  const target = new FakeTarget();
  const { presses, press } = recorder();
  const source = attachKeyboard(target as KeyboardTarget, press);
  // macOS drops the keyup of a key released while Cmd is held.
  target.dispatch("keydown", keyEvent("KeyQ"));
  target.dispatch("keydown", keyEvent("MetaLeft", { metaKey: true }));
  target.dispatch("keyup", keyEvent("MetaLeft"));
  target.dispatch("keydown", keyEvent("KeyQ"));
  // Switching tabs while holding a key loses its keyup too.
  target.dispatch("keydown", keyEvent("KeyP"));
  target.dispatch("visibilitychange");
  target.dispatch("keydown", keyEvent("KeyP"));
  // A Ctrl chord forgets held keys even when the chord key is bound.
  target.dispatch("keydown", keyEvent("ArrowUp"));
  target.dispatch("keydown", keyEvent("ArrowDown", { ctrlKey: true }));
  target.dispatch("keydown", keyEvent("ArrowUp"));
  assert.deepEqual(presses, [
    "key:Q",
    "key:Q",
    "key:P",
    "key:P",
    "key:ARROWS",
    "key:ARROWS",
  ]);
  source.dispose?.();
  assert.equal(target.count(), 0);
});

test("keyboard: keys typed into a form field stay the field's (#12)", () => {
  const target = new FakeTarget();
  const { presses, press } = recorder();
  attachKeyboard(target as KeyboardTarget, press);
  const fields = [
    { tagName: "INPUT" },
    { tagName: "TEXTAREA" },
    { tagName: "SELECT" },
    { tagName: "DIV", isContentEditable: true },
  ];
  for (const field of fields) {
    const typed = keyEvent("ArrowLeft", {
      target: field as unknown as EventTarget,
    });
    target.dispatch("keydown", typed);
    assert.equal(typed.prevented, false, field.tagName);
  }
  assert.deepEqual(presses, [], "typing a name does not join a player");
  const onCanvas = keyEvent("ArrowLeft", {
    target: { tagName: "CANVAS" } as unknown as EventTarget,
  });
  target.dispatch("keydown", onCanvas);
  assert.ok(onCanvas.prevented);
  assert.deepEqual(presses, ["key:ARROWS"]);
});

function pad(index: number, down: number[] = [], mapping = "standard") {
  return {
    index,
    connected: true,
    mapping,
    buttons: Array.from({ length: 16 }, (_, i) => ({
      pressed: down.includes(i),
      value: down.includes(i) ? 1 : 0,
    })),
  } satisfies GamepadLike;
}

test("gamepads: any face button presses pad N on its rising edge", () => {
  let pads: (GamepadLike | null)[] = [pad(0), null, pad(2)];
  const { presses, press } = recorder();
  const source = attachGamepads(() => pads, press);
  source.poll?.();
  pads = [pad(0, [0]), null, pad(2, [3])];
  source.poll?.();
  pads = [pad(0, [0, 1]), null, pad(2, [3])]; // still held
  source.poll?.();
  pads = [pad(0, [12]), null, pad(2)]; // d-pad is not a face button
  source.poll?.();
  pads = [pad(0, [2]), null, pad(2)];
  source.poll?.();
  assert.deepEqual(presses, ["pad:0", "pad:2", "pad:0"]);
});

test("gamepads: hot-plugged pads join, and a replugged pad is the same device", () => {
  let pads: (GamepadLike | null)[] = [];
  const { presses, press } = recorder();
  const source = attachGamepads(() => pads, press);
  source.poll?.();
  pads = [pad(0, [1])]; // appears with a button down: that is a press
  source.poll?.();
  pads = []; // unplugged while held
  source.poll?.();
  pads = [null, pad(1, [5], "")]; // unmapped pad: any button
  source.poll?.();
  pads = [pad(0, [1]), { ...pad(1), connected: false }];
  source.poll?.();
  assert.deepEqual(presses, ["pad:0", "pad:1", "pad:0"]);
});

class FakeSurface extends FakeTarget {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    super();
  }
  getBoundingClientRect() {
    return { left: 10, top: 20, width: this.width, height: this.height };
  }
}

function tap(
  x: number,
  y: number,
): PointerLike & {
  prevented: boolean;
} {
  const event = {
    clientX: x + 10,
    clientY: y + 20,
    prevented: false,
    preventDefault: () => {
      event.prevented = true;
    },
  };
  return event;
}

test("touch: zones split the bottom band, and taps elsewhere are ignored", () => {
  const surface = new FakeSurface(900, 600);
  const { presses, press } = recorder();
  const source = attachTouch(surface as PointerTarget, press);
  surface.dispatch("pointerdown", tap(100, 590)); // no zones yet
  source.setZoneCount(3);
  const above = tap(100, 300);
  surface.dispatch("pointerdown", above);
  assert.equal(above.prevented, false);
  const left = tap(100, 590);
  surface.dispatch("pointerdown", left);
  assert.ok(left.prevented);
  surface.dispatch("pointerdown", tap(450, 500));
  surface.dispatch("pointerdown", tap(899, 599));
  assert.deepEqual(presses, ["touch:0", "touch:1", "touch:2"]);
  source.dispose?.();
  assert.equal(surface.count(), 0);
});

test("touch: fingers down together in different zones all press (multi-touch)", () => {
  const surface = new FakeSurface(800, 400);
  const hub = new InputHub();
  const source = attachTouch(surface as PointerTarget, (d) => hub.press(d));
  source.setZoneCount(4);
  for (let zone = 0; zone < 4; zone++) hub.bind(zone, `touch:${zone}`);
  surface.dispatch("pointerdown", tap(50, 390));
  surface.dispatch("pointerdown", tap(650, 390));
  surface.dispatch("pointerdown", tap(250, 390));
  assert.deepEqual(hub.takePresses(4), [true, true, false, true]);
});

test("touch geometry: the drawn zones are the hit-test zones", () => {
  assert.equal(touchBandHeight(400), 100);
  assert.equal(touchBandHeight(200), 80);
  assert.equal(touchBandHeight(2000), 180);
  const [width, height, count] = [1000, 500, 4];
  const zones = touchZoneLayout(width, height, count);
  assert.equal(zones.length, count);
  zones.forEach((zone, index) => {
    const centreX = zone.x + zone.width / 2;
    const centreY = zone.y + zone.height / 2;
    assert.equal(touchZoneAt(centreX, centreY, width, height, count), index);
    assert.ok(zone.y + zone.height <= height && zone.x + zone.width <= width);
  });
  assert.equal(touchZoneAt(500, 100, width, height, count), undefined);
  assert.equal(touchZoneAt(500, 499, width, height, 0), undefined);
  assert.deepEqual(touchZoneLayout(width, height, 0), []);
});

test("touch: the source draws zones from the rect it hit-tests against (#12)", () => {
  const surface = new FakeSurface(700, 350);
  const { presses, press } = recorder();
  const source = attachTouch(surface as PointerTarget, press);
  assert.deepEqual(source.layout(), []);
  source.setZoneCount(3);
  const zones = source.layout();
  assert.deepEqual(zones, touchZoneLayout(700, 350, 3));
  for (const zone of zones) {
    surface.dispatch("pointerdown", tap(zone.x + 1, zone.y + 1));
    surface.dispatch(
      "pointerdown",
      tap(zone.x + zone.width - 1, zone.y + zone.height - 1),
    );
  }
  assert.deepEqual(presses, [
    "touch:0",
    "touch:0",
    "touch:1",
    "touch:1",
    "touch:2",
    "touch:2",
  ]);
});

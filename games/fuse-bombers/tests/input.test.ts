import test from "node:test";
import assert from "node:assert/strict";
import {
  DOWN,
  FIRE,
  INPUT_MASK,
  LEFT,
  RIGHT,
  UP,
  thrustDirection,
} from "../src/engine/input.js";
import { menuAction, type MenuState } from "../src/app/flow.js";
import {
  STICK_DEAD_ZONE,
  attachGamepads,
  stickBits,
  type GamepadLike,
} from "../src/app/input/gamepad.js";
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

/** A hub that records every press: `press` reports one tap, `hold` held bits (whose fire edge presses). */
function recorder() {
  const hub = new InputHub();
  const presses: DeviceId[] = [];
  hub.onPress((device) => presses.push(device));
  const press = (device: DeviceId) => hub.press(device);
  const hold = (device: DeviceId, bits: number) => hub.setHeld(device, bits);
  return { hub, presses, press, hold };
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
  hub.bind(0, "key:WASD");
  const target = new FakeTarget();
  attachKeyboard(target as KeyboardTarget, (d, bits) => hub.setHeld(d, bits));
  assert.doesNotThrow(() => target.dispatch("keydown", keyEvent("Space")));
  assert.deepEqual(seen, ["key:WASD"]);
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

test("the hub: fire's rising edge is one press, and heldBits follows the seated device", () => {
  const { hub, presses } = recorder();
  hub.setHeld("pad:0", UP | FIRE);
  hub.setHeld("pad:0", UP | FIRE); // still held: no new press
  hub.setHeld("pad:0", UP);
  hub.setHeld("pad:0", FIRE);
  assert.deepEqual(presses, ["pad:0", "pad:0"]);
  assert.equal(hub.heldBits(0), 0, "an unbound slot (a bot) holds nothing");
  hub.bind(0, "pad:0");
  assert.equal(hub.heldBits(0), FIRE);
  assert.deepEqual(hub.takePresses(1), [false], "the join press is dropped");
  hub.setHeld("pad:0", 0);
  hub.setHeld("pad:0", LEFT | FIRE);
  assert.deepEqual(
    [hub.heldBits(0), hub.heldBy("pad:0")],
    [LEFT | FIRE, LEFT | FIRE],
  );
  assert.deepEqual(hub.takePresses(1), [true]);
  hub.dispose();
  assert.equal(hub.heldBits(0), 0);
});

test("four keyboard riders, each with all five bits, share no key and use no menu key", () => {
  assert.equal(new Set(KEY_BINDINGS.map((b) => b.device)).size, 4);
  const codes = KEY_BINDINGS.flatMap((b) => Object.keys(b.keys));
  assert.equal(new Set(codes).size, codes.length);
  for (const { device, keys } of KEY_BINDINGS)
    assert.equal(
      Object.values(keys).reduce((all, bit) => all | bit, 0),
      INPUT_MASK,
      device,
    );
  const states: MenuState[] = ["lobby", "playing", "results", "winner"];
  for (const state of [...states, "paused" as const])
    for (const code of codes)
      assert.equal(menuAction(state, code), undefined, `${code} in ${state}`);
});

test("keyboard: each fire key presses its rider once per keydown, ignoring repeat", () => {
  const target = new FakeTarget();
  const { presses, hold } = recorder();
  const source = attachKeyboard(target as KeyboardTarget, hold);
  const down = keyEvent("Space");
  target.dispatch("keydown", down);
  assert.ok(down.prevented);
  target.dispatch("keydown", keyEvent("Space", { repeat: true }));
  target.dispatch("keydown", keyEvent("Space")); // repeat without the flag
  target.dispatch("keydown", keyEvent("KeyH"));
  target.dispatch("keyup", keyEvent("Space"));
  target.dispatch("keydown", keyEvent("Space"));
  target.dispatch("keydown", keyEvent("KeyW")); // steering is not a press
  assert.deepEqual(presses, ["key:WASD", "key:IJKL", "key:WASD"]);

  const unbound = keyEvent("KeyQ");
  target.dispatch("keydown", unbound);
  assert.equal(unbound.prevented, false);
  const shortcut = keyEvent("KeyA", { ctrlKey: true });
  target.dispatch("keydown", shortcut);
  assert.equal(shortcut.prevented, false, "Ctrl+A stays the browser's");
  assert.equal(presses.length, 3);

  source.dispose?.();
  assert.equal(target.count(), 0);
});

test("keyboard: riders hold their cluster's bits; release restores, opposites cancel, blur lets go", () => {
  const target = new FakeTarget();
  const { hub, hold } = recorder();
  attachKeyboard(target as KeyboardTarget, hold);
  hub.bind(0, "key:WASD");
  hub.bind(1, "key:NUMPAD");
  const key = (type: "keydown" | "keyup", ...codes: string[]) => {
    for (const code of codes) target.dispatch(type, keyEvent(code));
    return [hub.heldBits(0), hub.heldBits(1)];
  };
  assert.deepEqual(key("keydown", "KeyW", "KeyD", "Numpad5", "Numpad2"), [
    UP | RIGHT,
    DOWN,
  ]);
  assert.deepEqual(key("keyup", "Numpad5", "KeyW"), [RIGHT, DOWN]);
  assert.deepEqual(key("keydown", "KeyA", "Space"), [
    LEFT | RIGHT | FIRE,
    DOWN,
  ]);
  assert.deepEqual(thrustDirection(hub.heldBits(0)), { x: 0, y: 0 });
  assert.deepEqual(key("keyup", "KeyD"), [LEFT | FIRE, DOWN]);
  target.dispatch("blur");
  assert.deepEqual(key("keyup"), [0, 0], "blur releases every held key");
  key("keydown", "KeyS", "Numpad6");
  target.dispatch("visibilitychange");
  assert.deepEqual(key("keyup"), [0, 0]);
});

test("keyboard: aliased keys are one button, and blur forgets held keys", () => {
  const target = new FakeTarget();
  const { presses, hold } = recorder();
  attachKeyboard(target as KeyboardTarget, hold);
  target.dispatch("keydown", keyEvent("Numpad0"));
  target.dispatch("keydown", keyEvent("NumpadEnter")); // same button still held
  target.dispatch("keyup", keyEvent("Numpad0"));
  target.dispatch("keyup", keyEvent("NumpadEnter"));
  target.dispatch("keydown", keyEvent("NumpadEnter"));
  target.dispatch("keydown", keyEvent("Slash"));
  target.dispatch("blur");
  target.dispatch("keydown", keyEvent("Slash")); // its keyup was lost
  assert.deepEqual(presses, [
    "key:NUMPAD",
    "key:NUMPAD",
    "key:ARROWS",
    "key:ARROWS",
  ]);
});

test("keyboard: a lost keyup does not block the button forever (#12)", () => {
  const target = new FakeTarget();
  const { presses, hold } = recorder();
  const source = attachKeyboard(target as KeyboardTarget, hold);
  // macOS drops the keyup of a key released while Cmd is held.
  target.dispatch("keydown", keyEvent("Space"));
  target.dispatch("keydown", keyEvent("MetaLeft", { metaKey: true }));
  target.dispatch("keyup", keyEvent("MetaLeft"));
  target.dispatch("keydown", keyEvent("Space"));
  // Switching tabs while holding a key loses its keyup too.
  target.dispatch("keydown", keyEvent("KeyH"));
  target.dispatch("visibilitychange");
  target.dispatch("keydown", keyEvent("KeyH"));
  // A Ctrl chord forgets held keys even when the chord key is bound.
  target.dispatch("keydown", keyEvent("Slash"));
  target.dispatch("keydown", keyEvent("Slash", { ctrlKey: true }));
  target.dispatch("keydown", keyEvent("Slash"));
  assert.deepEqual(presses, [
    "key:WASD",
    "key:WASD",
    "key:IJKL",
    "key:IJKL",
    "key:ARROWS",
    "key:ARROWS",
  ]);
  source.dispose?.();
  assert.equal(target.count(), 0);
});

test("keyboard: keys typed into a form field stay the field's (#12)", () => {
  const target = new FakeTarget();
  const { presses, hold } = recorder();
  attachKeyboard(target as KeyboardTarget, hold);
  const fields = [
    { tagName: "INPUT" },
    { tagName: "TEXTAREA" },
    { tagName: "SELECT" },
    { tagName: "DIV", isContentEditable: true },
    { tagName: "BUTTON" }, // Space presses a focused button (the portal)
  ];
  for (const field of fields) {
    const typed = keyEvent("Space", {
      target: field as unknown as EventTarget,
    });
    target.dispatch("keydown", typed);
    assert.equal(typed.prevented, false, field.tagName);
  }
  assert.deepEqual(presses, [], "typing a name does not join a player");
  const onCanvas = keyEvent("Space", {
    target: { tagName: "CANVAS" } as unknown as EventTarget,
  });
  target.dispatch("keydown", onCanvas);
  assert.ok(onCanvas.prevented);
  const onButton = keyEvent("Slash", {
    target: { tagName: "BUTTON" } as unknown as EventTarget,
  });
  target.dispatch("keydown", onButton);
  assert.deepEqual(presses, ["key:WASD", "key:ARROWS"]);
});

function pad(
  index: number,
  down: number[] = [],
  mapping = "standard",
  axes = [0, 0],
) {
  return {
    index,
    connected: true,
    mapping,
    axes,
    buttons: Array.from({ length: 16 }, (_, i) => ({
      pressed: down.includes(i),
      value: down.includes(i) ? 1 : 0,
    })),
  } satisfies GamepadLike;
}

test("gamepads: any face button presses pad N on its rising edge", () => {
  let pads: (GamepadLike | null)[] = [pad(0), null, pad(2)];
  const { presses, hold } = recorder();
  const source = attachGamepads(() => pads, hold);
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
  const { hub, presses, hold } = recorder();
  const source = attachGamepads(() => pads, hold);
  source.poll?.();
  pads = [pad(0, [1], "standard", [-1, 0])]; // appears with a button down: that is a press
  source.poll?.();
  assert.equal(hub.heldBy("pad:0"), LEFT | FIRE);
  pads = []; // unplugged while held
  source.poll?.();
  assert.equal(hub.heldBy("pad:0"), 0, "an unplugged pad lets go");
  pads = [null, pad(1, [5], "")]; // unmapped pad: any button
  source.poll?.();
  pads = [pad(0, [1]), { ...pad(1), connected: false }];
  source.poll?.();
  assert.deepEqual(presses, ["pad:0", "pad:1", "pad:0"]);
});

test("gamepads: the left stick or the D-pad steers; any face button fires", () => {
  const { hub, hold } = recorder();
  let pads: GamepadLike[] = [];
  const source = attachGamepads(() => pads, hold);
  const held = (next: GamepadLike) => {
    pads = [next];
    source.poll?.();
    return hub.heldBy("pad:0");
  };
  assert.equal(held(pad(0, [], "standard", [0.3, -0.1])), 0, "dead zone");
  assert.equal(held(pad(0, [], "standard", [0.7, -0.7])), UP | RIGHT);
  assert.equal(held(pad(0, [12, 15])), UP | RIGHT, "D-pad up and right");
  assert.equal(held(pad(0, [13, 2], "standard", [-1, 0])), LEFT | DOWN | FIRE);
  assert.equal(held(pad(0, [14], "")), FIRE, "unmapped: every button fires");
});

test("stick quantisation: a dead zone, then 8 equal 45° sectors", () => {
  /** A lean at `angle` degrees; y grows downward, so 90° is down. */
  const lean = (angle: number, length = 1) =>
    stickBits(
      length * Math.cos((angle * Math.PI) / 180),
      length * Math.sin((angle * Math.PI) / 180),
      STICK_DEAD_ZONE,
    );
  assert.equal(lean(0, STICK_DEAD_ZONE), 0);
  assert.equal(lean(0, STICK_DEAD_ZONE + 0.01), RIGHT);
  const sectors: [number, number][] = [
    [22, RIGHT],
    [23, DOWN | RIGHT],
    [67, DOWN | RIGHT],
    [68, DOWN],
    [135, DOWN | LEFT],
    [180, LEFT],
    [-157, UP | LEFT],
    [-158, LEFT],
    [-90, UP],
  ];
  for (const [angle, bits] of sectors)
    assert.equal(lean(angle), bits, `${angle}°`);
  assert.equal(stickBits(Number.NaN, 1, STICK_DEAD_ZONE), 0);
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

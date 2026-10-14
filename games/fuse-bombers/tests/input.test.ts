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
  CONTROLLER_TOP,
  attachTouch,
  controllerPadLayout,
  touchControlAt,
  touchPadLayout,
  type Rect,
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

test("primary arrows and WASD combine held keys, release independently, and cancel on blur", () => {
  const target = new FakeTarget();
  const hub = new InputHub();
  hub.bind(0, "key:WASD");
  attachKeyboard(target as KeyboardTarget, (d, bits) => hub.setHeld(d, bits), {
    arrowsPrimary: () => true,
  });
  target.dispatch("keydown", keyEvent("ArrowLeft"));
  assert.equal(hub.heldBits(0), LEFT);
  assert.equal(hub.heldBy("key:ARROWS"), 0);
  target.dispatch("keydown", keyEvent("KeyA"));
  target.dispatch("keyup", keyEvent("ArrowLeft"));
  assert.equal(hub.heldBits(0), LEFT, "WASD is still held");
  target.dispatch("keydown", keyEvent("ArrowRight"));
  assert.deepEqual(thrustDirection(hub.heldBits(0)), { x: 0, y: 0 });
  target.dispatch("keyup", keyEvent("KeyA"));
  assert.equal(hub.heldBits(0), RIGHT);
  target.dispatch("keydown", keyEvent("Space"));
  assert.deepEqual(hub.takePresses(1), [true]);
  target.dispatch("blur");
  assert.equal(hub.heldBits(0), 0);
});

test("seating a dedicated arrows rider releases primary holds and keeps the two seats independent", () => {
  const target = new FakeTarget();
  const hub = new InputHub();
  hub.bind(0, "key:WASD");
  const source = attachKeyboard(
    target as KeyboardTarget,
    (d, bits) => hub.setHeld(d, bits),
    {
      arrowsPrimary: () => hub.slotOf("key:ARROWS") === undefined,
    },
  );
  target.dispatch("keydown", keyEvent("ArrowUp"));
  assert.equal(hub.heldBits(0), UP);
  hub.bind(1, "key:ARROWS");
  source.poll?.();
  assert.deepEqual([hub.heldBits(0), hub.heldBits(1)], [0, 0]);
  target.dispatch("keydown", keyEvent("ArrowDown"));
  target.dispatch("keydown", keyEvent("KeyW"));
  target.dispatch("keydown", keyEvent("Slash"));
  assert.deepEqual([hub.heldBits(0), hub.heldBits(1)], [UP, DOWN | FIRE]);
  assert.deepEqual(hub.takePresses(2), [false, true]);
  target.dispatch("visibilitychange");
  assert.deepEqual([hub.heldBits(0), hub.heldBits(1)], [0, 0]);
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

/** A fake pad overlay: a `width` × `height` surface whose top-left corner sits at (10, 20) on the page. */
class FakeSurface extends FakeTarget {
  constructor(
    public width: number, // a phone turned over is a surface resized
    public height: number,
  ) {
    super();
  }
  getBoundingClientRect() {
    return { left: 10, top: 20, width: this.width, height: this.height };
  }
}

/**
 * Touch pads on a fake surface and page feeding a real hub. Fingers are given in surface coordinates: `down` puts
 * finger `id` on a fake element that records its pointer captures (or, for a browser that cannot capture, throws
 * on them or has no such method), `move` slides it, `end` lifts it (or cancels it, or takes its capture away).
 */
function touchRig(
  width = 1000,
  height = 500,
  sides = [0, 1],
  capture: "works" | "throws" | "missing" = "works",
) {
  const surface = new FakeSurface(width, height);
  const page = new FakeTarget();
  const { hub, presses, hold } = recorder();
  const source = attachTouch(surface, hold, page);
  source.setSides(sides);
  const captured: number[] = [];
  const element = Object.assign(
    new EventTarget(),
    capture === "missing"
      ? {}
      : {
          setPointerCapture: (id: number) => {
            if (capture === "throws") throw new Error("InvalidPointerId");
            captured.push(id);
          },
        },
  );
  const event = (x: number, y: number, pointerId: number) => {
    const e = {
      ...{ clientX: x + 10, clientY: y + 20, pointerId, target: element },
      prevented: false,
      preventDefault: () => void (e.prevented = true),
    };
    return e;
  };
  const down = (x: number, y: number, id = 1) => {
    const e = event(x, y, id);
    surface.dispatch("pointerdown", e);
    return e;
  };
  const move = (x: number, y: number, id = 1) =>
    surface.dispatch("pointermove", event(x, y, id));
  const end = (id = 1, type = "pointerup") =>
    surface.dispatch(type, event(0, 0, id));
  const [left, right] = touchPadLayout(width, height, [0, 1]); // both sides' places
  assert.ok(left && right);
  /** A point on `rect` at fractions (`fx`, `fy`) of its size. */
  const on = (rect: Rect, fx = 0.5, fy = 0.5): [number, number] => [
    rect.x + rect.width * fx,
    rect.y + rect.height * fy,
  ];
  const held = (side: number) => hub.heldBy(`touch:${side}`);
  return {
    ...{ surface, page, hub, presses, source, captured },
    ...{ down, move, end, left, right, on, held },
  };
}

test("touch: each arrow holds its direction, between two arrows the diagonal, the centre nothing", () => {
  const { down, end, left, on, held, captured } = touchRig();
  const cases: [number, number, number][] = [
    [0.5, 0.1, UP],
    [0.5, 0.9, DOWN],
    [0.1, 0.5, LEFT],
    [0.9, 0.5, RIGHT],
    [0.8, 0.2, UP | RIGHT], // between ▲ and ▶
    [0.1, 0.1, UP | LEFT], // a corner
    [0.9, 0.9, DOWN | RIGHT],
    [0.2, 0.8, DOWN | LEFT],
    [0.5, 0.5, 0],
    [0.55, 0.45, 0], // inside the dead centre
  ];
  for (const [fx, fy, bits] of cases) {
    const event = down(...on(left.dpad, fx, fy));
    assert.equal(held(0), bits, `${fx}, ${fy}`);
    assert.ok(event.prevented, "no emulated mouse or zoom");
    end();
    assert.equal(held(0), 0);
  }
  assert.equal(captured.length, cases.length, "every finger is captured");
});

test("touch: a thumb sliding round the D-pad turns, and past its edge still steers", () => {
  const { down, move, end, left, on, held, presses } = touchRig();
  down(...on(left.dpad, 0.5, 0.1));
  assert.equal(held(0), UP);
  move(...on(left.dpad, 0.85, 0.15));
  assert.equal(held(0), UP | RIGHT);
  move(...on(left.dpad, 0.9, 0.5));
  assert.equal(held(0), RIGHT);
  move(...on(left.dpad, 1.6, 0.5)); // off the pad, over the canvas
  assert.equal(held(0), RIGHT);
  move(...on(left.dpad, 0.5, 0.5));
  assert.equal(held(0), 0);
  move(...on(left.dpad, 0.1, 0.9));
  assert.equal(held(0), DOWN | LEFT);
  end();
  assert.equal(held(0), 0);
  assert.deepEqual(presses, [], "steering never fires");
});

test("touch: lift, cancel, lost capture, blur, a hidden tab and a hidden side all let go", () => {
  const rig = touchRig();
  const { down, end, left, right, on, held, page } = rig;
  for (const ending of ["pointerup", "pointercancel", "lostpointercapture"]) {
    down(...on(left.dpad, 0.5, 0.1), 1);
    down(...on(left.fire), 2);
    assert.equal(held(0), UP | FIRE);
    end(2, ending);
    assert.equal(held(0), UP, ending);
    end(1, ending);
    assert.equal(held(0), 0, ending);
    end(1, "pointerup"); // a lift after a cancel is nothing
    assert.equal(held(0), 0);
  }
  for (const loss of ["blur", "visibilitychange"]) {
    down(...on(left.dpad, 0.1, 0.5), 1);
    down(...on(right.fire), 2);
    page.dispatch(loss);
    assert.deepEqual([held(0), held(1)], [0, 0], loss);
    end(1);
    end(2);
  }
  down(...on(left.fire), 1);
  down(...on(right.dpad, 0.5, 0.9), 2);
  rig.source.setSides([1]); // the left rider's pad goes away
  assert.deepEqual([held(0), held(1)], [0, DOWN]);
  assert.equal(down(...on(left.fire), 3).prevented, false, "nothing there now");
  assert.equal(held(0), 0);
  down(...on(left.dpad, 0.5, 0.1), 4); // the lone right rider's D-pad spreads to the left corner
  assert.deepEqual([held(0), held(1)], [0, UP | DOWN]);
});

test("touch: without pointer capture a finger that slid off its pad still lets go when it lifts anywhere", () => {
  for (const capture of ["throws", "missing"] as const) {
    const { down, move, left, on, held, page } = touchRig(
      1000,
      500,
      [0, 1],
      capture,
    );
    down(...on(left.dpad, 0.5, 0.1), 1);
    down(...on(left.fire), 2);
    assert.equal(held(0), UP | FIRE, capture);
    move(...on(left.dpad, 0.9, 0.5), 1); // still on the pad: moves are heard
    assert.equal(held(0), RIGHT | FIRE, capture);
    // Off the pads the page, not the pad overlay, hears the lifts.
    page.dispatch("pointerup", { pointerId: 9 }); // somebody else's finger
    assert.equal(held(0), RIGHT | FIRE, capture);
    page.dispatch("pointerup", { pointerId: 1 });
    assert.equal(held(0), FIRE, capture);
    page.dispatch("pointercancel", { pointerId: 2 });
    assert.equal(held(0), 0, capture);
  }
});

test("touch: two riders on one screen hold independently", () => {
  const { hub, down, end, left, right, on, held } = touchRig();
  hub.bind(0, "touch:0");
  hub.bind(1, "touch:1");
  down(...on(left.dpad, 0.5, 0.1), 1);
  down(...on(right.fire), 2);
  down(...on(right.dpad, 0.1, 0.5), 3);
  assert.deepEqual([held(0), held(1)], [UP, LEFT | FIRE]);
  down(...on(left.fire), 4);
  end(3);
  assert.deepEqual([hub.heldBits(0), hub.heldBits(1)], [UP | FIRE, FIRE]);
  assert.deepEqual(hub.takePresses(2), [true, true]);
  end(2);
  assert.deepEqual([held(0), held(1)], [UP | FIRE, 0]);
});

test("touch: FIRE's rising edge is exactly one press, however the finger slides", () => {
  const { hub, presses, down, move, end, left, right, on } = touchRig();
  hub.bind(0, "touch:0");
  down(...on(left.fire), 1);
  assert.deepEqual(presses, ["touch:0"]);
  move(...on(left.fire, 2, -1), 1); // slides off: still held, no new press
  move(...on(right.fire), 1);
  down(...on(left.fire), 2); // a second finger on the same button
  end(1);
  assert.equal(hub.heldBy("touch:0"), FIRE);
  assert.deepEqual(presses, ["touch:0"]);
  assert.deepEqual(hub.takePresses(1), [true]);
  assert.deepEqual(hub.takePresses(1), [false]);
  end(2);
  assert.equal(hub.heldBy("touch:0"), 0);
  down(...on(left.fire), 3);
  assert.deepEqual(presses, ["touch:0", "touch:0"]);
});

test("touch: touches off the pads are the page's, and dispose detaches", () => {
  const rig = touchRig(1000, 500, []);
  const { down, surface, page, left, on, held } = rig;
  assert.deepEqual(rig.source.layout(), []);
  assert.equal(down(500, 480).prevented, false, "no sides shown yet");
  rig.source.setSides([0, 1]);
  assert.equal(down(500, 100).prevented, false, "above the pads");
  assert.equal(down(...on(left.dpad, 1.1, 0.5)).prevented, false, "between");
  assert.equal(
    down(...on(left.fire, 0.05, 0.05)).prevented,
    false,
    "FIRE is round",
  );
  assert.equal(held(0), 0);
  rig.source.dispose?.();
  assert.equal(surface.count() + page.count(), 0);
});

test("touch geometry: pads fit phones and tablets, never meet, and a lone rider's spread out", () => {
  const sizes = [
    [667, 375],
    [844, 390],
    [1024, 768],
    [1366, 1024],
    [390, 844],
  ];
  for (const [width = 0, height = 0] of sizes) {
    const pads = touchPadLayout(width, height, [0, 1]);
    const [left, right] = pads;
    assert.ok(left && right);
    for (const pad of pads) {
      for (const r of [pad.dpad, pad.fire]) {
        assert.ok(r.x >= 0 && r.y >= 0, `${width}×${height}`);
        assert.ok(r.x + r.width <= width && r.y + r.height <= height);
      }
      const centre = (r: Rect) =>
        [r.x + r.width / 2, r.y + r.height / 2] as const;
      assert.deepEqual(touchControlAt(...centre(pad.dpad), pads), {
        side: pad.side,
        fire: false,
      });
      assert.deepEqual(touchControlAt(...centre(pad.fire), pads), {
        side: pad.side,
        fire: true,
      });
    }
    assert.ok(
      left.fire.x + left.fire.width < right.dpad.x,
      `${width}×${height}`,
    );
    if (width > height) assert.ok(left.dpad.width >= 100, "a thumb's worth");
    const [solo] = touchPadLayout(width, height, [1]);
    assert.ok(solo && solo.dpad.x < width / 4 && solo.fire.x > width / 2);
  }
  const { source } = touchRig(700, 350);
  assert.deepEqual(source.layout(), touchPadLayout(700, 350, [0, 1]));
});

test("a phone controller's pads: big, below its header, apart, and steering and firing like the arena's", () => {
  for (const [width, height] of [
    [390, 844],
    [360, 640],
    [844, 390],
    [667, 375],
  ] as const) {
    const [pad] = controllerPadLayout(width, height, [0]);
    assert.ok(pad, `${width}×${height}`);
    for (const r of [pad.dpad, pad.fire]) {
      assert.ok(
        r.y >= height * CONTROLLER_TOP && r.x >= 0,
        `${width}×${height}`,
      );
      assert.ok(r.x + r.width <= width && r.y + r.height <= height);
    }
    assert.ok(
      Math.min(pad.dpad.width, pad.fire.width) >=
        Math.min(width, height) * 0.35,
      "a palm's worth",
    );
    const apart =
      width > height
        ? pad.dpad.x + pad.dpad.width < pad.fire.x
        : pad.fire.y + pad.fire.height < pad.dpad.y;
    assert.ok(
      apart,
      `${width}×${height}: FIRE ${width > height ? "right of" : "above"} the D-pad`,
    );
  }
  assert.deepEqual(
    controllerPadLayout(390, 844, []),
    [],
    "nothing shown, nothing hit",
  );
  // The same touch source, laid out as a controller: a finger slides from ▲ to the ◥ diagonal, then FIRE presses.
  const rig = touchRig(390, 844, []);
  rig.source.setSides([0], controllerPadLayout);
  const [pad] = rig.source.layout();
  assert.ok(pad && pad.dpad.width > 200);
  rig.down(...rig.on(pad.dpad, 0.5, 0.1));
  assert.equal(rig.held(0), UP);
  rig.move(...rig.on(pad.dpad, 0.9, 0.1));
  assert.equal(rig.held(0), UP | RIGHT);
  rig.down(...rig.on(pad.fire), 2);
  assert.equal(rig.held(0), UP | RIGHT | FIRE);
  assert.equal(rig.presses.length, 1);
  rig.page.dispatch("blur");
  assert.equal(rig.held(0), 0, "blur lets go");
  rig.source.setSides([0]);
  assert.deepEqual(
    rig.source.layout(),
    touchPadLayout(390, 844, [0]),
    "back over the arena",
  );
});

test("a controller's pads: only side 0 has any, and a finger held through a turn of the phone keeps its hold", () => {
  assert.deepEqual(controllerPadLayout(390, 844, [1]), []);
  assert.deepEqual(controllerPadLayout(390, 844, [1, 2]), []);
  const rig = touchRig(390, 844, []);
  rig.source.setSides([0], controllerPadLayout);
  const [tall] = rig.source.layout();
  assert.ok(tall);
  rig.down(...rig.on(tall.dpad, 0.5, 0.1));
  assert.equal(rig.held(0), UP);
  // The phone turns: the surface is 844 × 390 now, the pads sit elsewhere, and the thumb has not lifted.
  rig.surface.width = 844;
  rig.surface.height = 390;
  const [wide] = rig.source.layout();
  assert.ok(wide && wide.dpad.x !== tall.dpad.x);
  assert.equal(rig.held(0), UP, "a resize lets go of nothing");
  rig.move(...rig.on(wide.dpad, 0.9, 0.5));
  assert.equal(rig.held(0), RIGHT, "the thumb steers by the new D-pad");
  rig.down(...rig.on(wide.fire), 2);
  assert.equal(rig.held(0), RIGHT | FIRE);
  assert.equal(rig.presses.length, 1, "one finger on FIRE, one press");
  rig.end();
  rig.end(2);
  assert.equal(rig.held(0), 0, "and both lifts let go");
  // A round that ends takes the pads away: a finger still down is let go with them.
  rig.down(...rig.on(wide.dpad, 0.1, 0.5));
  assert.equal(rig.held(0), LEFT);
  rig.source.setSides([]);
  assert.equal(rig.held(0), 0);
});

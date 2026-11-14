import test from "node:test";
import assert from "node:assert/strict";
import {
  INPUT_DOWN,
  INPUT_HELD,
  INPUT_LEFT,
  INPUT_RIGHT,
} from "../src/engine/index.js";
import {
  Controls,
  HOLD_REPEAT_MS,
  HOLD_REPEAT_STEPS,
  HOLD_TO_FLAP_KEY,
  Keys,
  Pads,
  STICK_DEAD,
  STICK_DIVE,
  Touch,
  gameKey,
  holdToFlapFrom,
  readPads,
  releaseWhenAway,
  settle,
  stickBits,
  watchPads,
  type PadLike,
  type PadSource,
} from "../src/app/controls.js";

function rig() {
  const log: (number | "press" | "attack")[] = [];
  const controls = new Controls({
    input: (bits) => void log.push(bits),
    press: () => void log.push("press"),
    attack: () => void log.push("attack"),
  });
  return { log, controls };
}
/** A standard-mapping pad: the axes it reports and the buttons held down. */
const pad = (
  axes: number[],
  pressed: number[] = [],
  buttons = 17,
  mapping = "standard",
): PadLike => ({
  connected: true,
  mapping,
  axes,
  buttons: Array.from({ length: buttons }, (_, index) => ({
    pressed: pressed.includes(index),
    value: pressed.includes(index) ? 1 : 0,
  })),
});
/** A pad the browser does not recognise: no mapping, so only the sticks and the first three buttons are read. */
const oddPad = (axes: number[], pressed: number[] = []): PadLike =>
  pad(axes, pressed, 17, "");

test("left and right together are neither", () => {
  assert.equal(settle(INPUT_LEFT | INPUT_RIGHT | INPUT_DOWN), INPUT_DOWN);
  assert.equal(settle(INPUT_LEFT | INPUT_HELD), INPUT_LEFT | INPUT_HELD);
});

test("the sources merge, and only a change reaches the runtime", () => {
  const { log, controls } = rig();
  controls.set("keys", INPUT_LEFT);
  controls.set("pad", INPUT_LEFT);
  controls.set("touch", INPUT_HELD);
  assert.deepEqual(log, [INPUT_LEFT, INPUT_LEFT | INPUT_HELD]);
  controls.set("keys", 0);
  assert.equal(controls.value(), INPUT_LEFT | INPUT_HELD, "the pad holds left");
  controls.set("pad", INPUT_RIGHT);
  controls.set("keys", INPUT_LEFT);
  assert.equal(controls.value(), INPUT_HELD);
  controls.release();
  assert.equal(controls.value(), 0);
  assert.equal(log.at(-1), 0);
  controls.press();
  assert.equal(log.at(-1), "press");
});

test("the source that last held something is the device in use", () => {
  const { controls } = rig();
  assert.equal(controls.lastUsed(), undefined);
  controls.set("pad", 0);
  assert.equal(controls.lastUsed(), undefined, "an idle pad says nothing");
  controls.set("keys", INPUT_LEFT);
  assert.equal(controls.lastUsed(), "keys");
  controls.set("touch", INPUT_HELD);
  controls.set("pad", 0);
  assert.equal(controls.lastUsed(), "touch");
  controls.release();
  assert.equal(controls.lastUsed(), "touch", "letting go keeps the device");
});

test("the keyboard: arrows or A/D move, down or S dives, Space is the one button", () => {
  const { log, controls } = rig();
  const keys = new Keys(controls);
  for (const code of [
    "ArrowLeft",
    "ArrowRight",
    "ArrowDown",
    "KeyA",
    "KeyD",
    "KeyS",
    "Space",
  ])
    assert.ok(gameKey(code), code);
  assert.ok(gameKey("ArrowUp"), "up is kept from scrolling the page");
  for (const code of ["KeyW", "KeyK", "Enter", "toString"])
    assert.equal(gameKey(code), false, code);
  assert.equal(keys.press("Enter"), false);
  assert.deepEqual(log, []);

  assert.equal(keys.press("KeyA"), true);
  assert.equal(keys.press("KeyA"), true, "key repeat");
  assert.deepEqual(log, [INPUT_LEFT]);
  keys.press("Space");
  assert.deepEqual(log.slice(1), [INPUT_LEFT | INPUT_HELD, "press"]);
  keys.press("Space");
  assert.equal(log.length, 3, "a repeat is not a new press");
  keys.lift("Space");
  assert.equal(controls.value(), INPUT_LEFT);
  keys.press("Space");
  assert.deepEqual(
    log.slice(-2),
    [INPUT_LEFT | INPUT_HELD, "press"],
    "each press is an edge",
  );
  keys.lift("Space");
  keys.lift("Space");
  keys.press("ArrowDown");
  keys.press("ArrowRight");
  assert.equal(controls.value(), INPUT_DOWN);
  keys.lift("ArrowRight");
  keys.lift("ArrowDown");
  keys.press("KeyS");
  assert.equal(controls.value(), INPUT_LEFT | INPUT_DOWN, "S dives too");
  keys.clear();
  assert.equal(controls.value(), 0);
});

test("up and W are bound to nothing: no held bits and no press", () => {
  const { log, controls } = rig();
  const keys = new Keys(controls);
  assert.equal(keys.press("ArrowUp"), true, "swallowed");
  assert.equal(keys.press("KeyW"), false);
  keys.lift("ArrowUp");
  keys.lift("KeyW");
  assert.deepEqual(log, []);
  assert.equal(controls.value(), 0);
  assert.equal(controls.lastUsed(), undefined);
  // Up held while flying is still nothing: the flap is only ever the button.
  keys.press("ArrowUp");
  keys.press("Space");
  assert.deepEqual(log, [INPUT_HELD, "press"]);
  assert.equal(controls.value(), INPUT_HELD, "up adds no bit of its own");
});

test("Space is the only key that flaps: no attack key or arrow holds the button", () => {
  const { log, controls } = rig();
  const keys = new Keys(controls);
  for (const code of [
    "KeyX",
    "KeyZ",
    "ShiftLeft",
    "ShiftRight",
    "KeyJ",
    "ArrowUp",
    "ArrowLeft",
    "ArrowRight",
    "ArrowDown",
    "KeyA",
    "KeyD",
    "KeyS",
  ]) {
    keys.press(code);
    assert.equal(controls.value() & INPUT_HELD, 0, `${code} does not flap`);
    keys.lift(code);
  }
  assert.equal(log.includes("press"), false, "nothing but Space presses");
  keys.press("Space");
  assert.deepEqual(log.slice(-2), [INPUT_HELD, "press"]);
});

test("a gamepad: stick or d-pad to move and dive, A / Cross for the button, up for nothing", () => {
  const { log, controls } = rig();
  const pads = new Pads(controls);
  // A third of the way to move, past a worn stick's drift; half way down before the Queen dives.
  assert.deepEqual([STICK_DEAD, STICK_DIVE], [0.3, 0.5]);
  assert.equal(pads.connected(), false, "nothing is connected until a poll");
  pads.poll([null, pad([-0.9, 0])]);
  assert.deepEqual(log, [INPUT_LEFT]);
  assert.equal(pads.connected(), true);
  pads.poll([null, pad([0.2, 0.1])]);
  assert.equal(controls.value(), 0, "inside the dead zone");
  pads.poll([pad([-0.3, 0.5])]);
  assert.equal(controls.value(), 0, "exactly on the line is not past it");
  pads.poll([pad([0.31, 0.51])]);
  assert.equal(controls.value(), INPUT_RIGHT | INPUT_DOWN);
  pads.poll([pad([-0.31, 0.3])]);
  assert.equal(
    controls.value(),
    INPUT_LEFT,
    "a stick pushed sideways and drifting down does not dive",
  );
  pads.poll([pad([0, -1], [12])]);
  assert.equal(controls.value(), 0, "stick up and d-pad up do nothing");
  pads.poll([pad([0, 0], [13, 14])]);
  assert.equal(controls.value(), INPUT_LEFT | INPUT_DOWN);
  pads.poll([pad([0, 0], [15])]);
  assert.equal(controls.value(), INPUT_RIGHT);
  pads.poll([pad([Number.NaN, 4], [])]);
  assert.equal(controls.value(), 0, "a nonsense axis holds nothing");
  pads.poll([pad([-1.0001, 0], [])]);
  assert.equal(controls.value(), INPUT_LEFT, "a hair past the end is the end");
  log.length = 0;
  pads.poll([pad([0, 0], [3])]);
  assert.deepEqual(log, [0], "Y / Triangle is bound to nothing");
  pads.poll([pad([0, 0], [0])]);
  assert.deepEqual(log.slice(1), [INPUT_HELD, "press"]);
  pads.poll([pad([0, 0], [0])]);
  assert.equal(log.length, 3, "held is not pressed again");
  pads.poll([pad([0, 0])]);
  pads.poll([pad([0, 0], [0])]);
  assert.deepEqual(log.slice(3), [0, INPUT_HELD, "press"]);
});

test("one device, one seat: the first connected pad plays and the rest are ignored", () => {
  const { log, controls } = rig();
  const pads = new Pads(controls);
  // An empty slot, then the pad that plays, then a second pad nobody is holding this seat with.
  pads.poll([null, pad([-1, 0], [0]), pad([1, 0], [1])]);
  assert.deepEqual(log, [INPUT_LEFT | INPUT_HELD, "press"], "no attack");
  log.length = 0;
  pads.poll([null, pad([0, 0]), pad([0, 0], [0, 1])]);
  assert.deepEqual(log, [0], "the extra pad presses nothing");
  // A pad present but unplugged is not the one that plays.
  const gone: PadLike = { ...pad([-1, 0]), connected: false };
  pads.poll([gone, pad([1, 0])]);
  assert.equal(controls.value(), INPUT_RIGHT);
  pads.poll([]);
  assert.equal(controls.value(), 0);
  assert.equal(pads.connected(), false);
});

test("a pad plugged in mid-match: the press that reveals it to the browser still flaps", () => {
  const { log, controls } = rig();
  const pads = new Pads(controls);
  // Before the pad is pressed the browser shows nothing at all, whatever is plugged in.
  pads.poll([]);
  pads.poll([null]);
  assert.deepEqual(log, [], "an empty frame holds nothing and presses nothing");
  // The browser hands the pad over the moment A goes down: that first poll is the press.
  pads.poll([null, pad([0, 0], [0])]);
  assert.deepEqual(log, [INPUT_HELD, "press"]);
  assert.equal(pads.connected(), true, "and the hints know a pad is in use");
  assert.equal(controls.lastUsed(), "pad");
  // A second pad arriving in an earlier slot is a different pad: its held button is a new press, not a carry-over.
  log.length = 0;
  pads.poll([pad([0, 0], [0]), pad([0, 0], [0])]);
  assert.deepEqual(log, ["press"], "the new pad's button presses once");
  pads.poll([pad([0, 0], [0]), pad([0, 0], [0])]);
  assert.deepEqual(log, ["press"], "and then stays held");
});

test("a pad unplugged mid-match lets go: nothing stays held and the next press still counts", () => {
  const { log, controls } = rig();
  const pads = new Pads(controls);
  pads.poll([pad([-1, 0], [0])]);
  assert.equal(controls.value(), INPUT_LEFT | INPUT_HELD);
  log.length = 0;
  // The browser's own event, which arrives whether or not the frame loop is polling.
  const page = new FakePage();
  const abort = new AbortController();
  watchPads(page, pads, { signal: abort.signal });
  page.fire("gamepaddisconnected");
  assert.deepEqual(log, [0], "the held bits are let go at once");
  assert.equal(pads.connected(), false);
  // Plugged back in with the button still down: a fresh press, not a carried-over hold.
  pads.poll([pad([0, 0], [0])]);
  assert.deepEqual(log.slice(1), [INPUT_HELD, "press"]);
  // The listener comes off with the page's others.
  abort.abort();
  page.fire("gamepaddisconnected");
  assert.equal(controls.value(), INPUT_HELD, "nothing is listening any more");
  assert.deepEqual([...page.listeners.values()].flat(), []);
});

test("a pad the browser does not know: the sticks and the first three buttons", () => {
  const { log, controls } = rig();
  const pads = new Pads(controls);
  pads.poll([oddPad([-1, 0])]);
  assert.equal(controls.value(), INPUT_LEFT, "axis 0 still moves");
  pads.poll([oddPad([0, 1])]);
  assert.equal(controls.value(), INPUT_DOWN, "axis 1 still dives");
  pads.poll([oddPad([0, 0], [13, 14, 15])]);
  assert.equal(
    controls.value(),
    0,
    "the d-pad buttons mean nothing on an unknown pad",
  );
  log.length = 0;
  pads.poll([oddPad([0, 0], [0])]);
  assert.deepEqual(log, [INPUT_HELD, "press"], "button 0 still flaps");
  pads.poll([oddPad([0, 0], [1])]);
  assert.deepEqual(log.slice(2), [0, "attack"]);
  pads.poll([oddPad([0, 0], [2])]);
  assert.deepEqual(log.slice(4), ["attack"], "button 2 attacks as well");
  pads.poll([oddPad([0, 0], [4, 5, 6, 7])]);
  assert.deepEqual(log.slice(5), [], "and nothing further up is guessed at");
});

test("the pads a browser hands over: none when it has no Gamepad API, or blocks it", () => {
  assert.deepEqual(readPads({}), [], "no Gamepad API at all");
  const blocked: PadSource = {
    getGamepads: () => {
      throw new Error("blocked by a permissions policy");
    },
  };
  assert.deepEqual(readPads(blocked), []);
  const one = pad([0, 0]);
  assert.deepEqual(readPads({ getGamepads: () => [null, one] }), [null, one]);
});

/** A clock the test moves by hand. */
class FakeClock {
  ms = 1_000;
  readonly now = (): number => this.ms;
}
function holdRig() {
  const clock = new FakeClock();
  const log: (number | "press")[] = [];
  const controls = new Controls(
    {
      input: (bits) => void log.push(bits),
      press: () => void log.push("press"),
      attack: () => undefined,
    },
    clock.now,
  );
  const presses = () => log.filter((entry) => entry === "press").length;
  return { clock, controls, keys: new Keys(controls), presses };
}

test("hold to flap is off by default: holding the button presses once", () => {
  assert.equal(holdToFlapFrom(null), false);
  assert.equal(holdToFlapFrom("0"), false);
  assert.equal(holdToFlapFrom("1"), true);
  assert.equal(HOLD_TO_FLAP_KEY, "killer-fuse-hold-to-flap");
  const { clock, controls, keys, presses } = holdRig();
  assert.equal(controls.holdsToFlap(), false);
  keys.press("Space");
  for (let frame = 0; frame < 120; frame += 1) {
    clock.ms += 1000 / 60;
    controls.pulse();
  }
  assert.equal(presses(), 1);
});

test("hold to flap: a held button presses again every 8 steps, 7.5 a second", () => {
  assert.equal(HOLD_REPEAT_STEPS, 8);
  assert.equal(HOLD_REPEAT_MS, (8 * 1000) / 60);
  const { clock, controls, keys, presses } = holdRig();
  controls.setHoldToFlap(true);
  assert.equal(controls.holdsToFlap(), true);
  keys.press("Space");
  assert.equal(presses(), 1, "the press itself");
  clock.ms += HOLD_REPEAT_MS - 1;
  controls.pulse();
  assert.equal(presses(), 1, "not yet");
  clock.ms += 1;
  controls.pulse();
  assert.equal(presses(), 2, "8 steps after the press");
  // One more second of frames at 60 Hz: 7 or 8 presses, on the cadence.
  for (let frame = 0; frame < 60; frame += 1) {
    clock.ms += 1000 / 60;
    controls.pulse();
  }
  assert.equal(presses(), 2 + 7);
  keys.lift("Space");
  clock.ms += 1_000;
  controls.pulse();
  assert.equal(presses(), 9, "a released button stops");
});

test("hold to flap: a new tap restarts the count, a stall presses once, and turning it off stops it", () => {
  const { clock, controls, keys, presses } = holdRig();
  controls.setHoldToFlap(true);
  keys.press("Space");
  clock.ms += HOLD_REPEAT_MS / 2;
  keys.lift("Space");
  controls.pulse();
  keys.press("Space");
  clock.ms += HOLD_REPEAT_MS / 2;
  controls.pulse();
  assert.equal(presses(), 2, "counted from the second tap, not the first");
  clock.ms += 10_000;
  controls.pulse();
  assert.equal(presses(), 3, "a hidden tab presses once, not eighty times");
  clock.ms += HOLD_REPEAT_MS - 1;
  controls.pulse();
  assert.equal(presses(), 3, "and counts again from then");
  clock.ms += 1;
  controls.pulse();
  assert.equal(presses(), 4);
  controls.setHoldToFlap(false);
  clock.ms += 1_000;
  controls.pulse();
  assert.equal(presses(), 4);
  // Held already when it is turned on: the first repeat comes a full period later.
  controls.setHoldToFlap(true);
  controls.pulse();
  clock.ms += HOLD_REPEAT_MS;
  controls.pulse();
  assert.equal(presses(), 5);
});

test("a gamepad press restarts the hold-to-flap count as well", () => {
  const { clock, controls, presses } = holdRig();
  controls.setHoldToFlap(true);
  const pads = new Pads(controls);
  pads.poll([pad([0, 0], [0])]);
  clock.ms += HOLD_REPEAT_MS;
  pads.poll([pad([0, 0], [0])]);
  controls.pulse();
  assert.equal(presses(), 2);
  // Without a clock the controls still work; hold to flap simply never comes due.
  const plain = new Controls({
    input: () => undefined,
    press: () => undefined,
    attack: () => undefined,
  });
  plain.setHoldToFlap(true);
  plain.set("keys", INPUT_HELD);
  plain.pulse();
  plain.pulse();
  assert.equal(plain.value(), INPUT_HELD);
});

test("the touch pad: sideways past the dead zone, down on a clear pull, and the big button", () => {
  assert.equal(stickBits(0, 0, 50), 0);
  assert.equal(stickBits(-10, 0, 50), 0);
  assert.equal(stickBits(-12, 0, 50), INPUT_LEFT);
  assert.equal(stickBits(12, 20, 50), INPUT_RIGHT);
  assert.equal(stickBits(0, 26, 50), INPUT_DOWN);
  assert.equal(stickBits(30, 40, 50), INPUT_RIGHT | INPUT_DOWN);
  assert.equal(stickBits(0, -40, 50), 0, "up does nothing");

  const { log, controls } = rig();
  const touch = new Touch(controls);
  touch.move(-30, 0, 50);
  touch.hold(true);
  touch.hold(true);
  assert.deepEqual(log, [INPUT_LEFT, INPUT_LEFT | INPUT_HELD, "press"]);
  touch.rest();
  assert.equal(controls.value(), INPUT_HELD);
  touch.hold(false);
  touch.hold(false);
  assert.equal(controls.value(), 0);
  touch.hold(true);
  assert.deepEqual(log.slice(-2), [INPUT_HELD, "press"]);
});

test("attack: X, Z, either Shift or J, B / Circle, X / Square, a bumper or a trigger, and the touch ATTACK button, each a press edge only", () => {
  const { log, controls } = rig();
  const keys = new Keys(controls);
  for (const code of ["KeyX", "KeyZ", "ShiftLeft", "ShiftRight", "KeyJ"]) {
    assert.ok(gameKey(code), code);
    keys.press(code);
    keys.press(code);
    assert.deepEqual(log, ["attack"], `held ${code} attacks once`);
    assert.equal(controls.value(), 0, `${code} holds nothing`);
    assert.equal(controls.lastUsed(), "keys");
    keys.lift(code);
    keys.press(code);
    assert.deepEqual(log, ["attack", "attack"], `${code} again is an edge`);
    keys.lift(code);
    log.length = 0;
  }

  log.length = 0;
  const pads = new Pads(controls);
  pads.poll([pad([0, 0], [1])]);
  pads.poll([pad([0, 0], [1])]);
  assert.deepEqual(log, ["attack"], "B / Circle, held, attacks once");
  assert.equal(controls.lastUsed(), "pad");
  // Whichever finger is free: the other face button, either bumper, either trigger, each its own press.
  for (const button of [2, 4, 5, 6, 7]) {
    log.length = 0;
    pads.poll([pad([0, 0], [button])]);
    assert.deepEqual(log, ["attack"], `button ${button} attacks`);
    pads.poll([pad([0, 0], [button])]);
    assert.deepEqual(log, ["attack"], `button ${button} held attacks once`);
    pads.poll([pad([0, 0])]);
  }
  // A trigger the browser does not call pressed, pulled past half way, counts too.
  log.length = 0;
  const pulled: PadLike = {
    ...pad([0, 0]),
    buttons: pad([0, 0]).buttons.map((button, index) =>
      index === 7 ? { pressed: false, value: 0.8 } : button,
    ),
  };
  pads.poll([pulled]);
  assert.deepEqual(log, ["attack"], "a pulled trigger attacks");
  log.length = 0;
  pads.poll([pad([0, 0], [0, 4])]);
  assert.deepEqual(log, [INPUT_HELD, "press", "attack"], "A still flaps");

  log.length = 0;
  const touch = new Touch(controls);
  touch.strike(true);
  touch.strike(true);
  touch.strike(false);
  touch.strike(false);
  touch.strike(true);
  assert.deepEqual(log, ["attack", "attack"]);
  assert.equal(controls.lastUsed(), "touch");
});

/** A typed stand-in for `window` / `document`: it keeps its listeners so a test can fire and then abort them. */
class FakePage {
  visibilityState = "visible";
  readonly listeners = new Map<string, (() => void)[]>();
  addEventListener(
    type: string,
    listener: () => void,
    options?: { signal?: AbortSignal },
  ): void {
    const kept = this.listeners.get(type) ?? [];
    kept.push(listener);
    this.listeners.set(type, kept);
    options?.signal?.addEventListener("abort", () => {
      this.listeners.set(
        type,
        (this.listeners.get(type) ?? []).filter((one) => one !== listener),
      );
    });
  }
  fire(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
}

test("a hidden tab lets go of the controls, as losing focus does: a phone fires no blur", () => {
  const { log, controls } = rig();
  const keys = new Keys(controls);
  const window = new FakePage(),
    document = new FakePage();
  const abort = new AbortController();
  releaseWhenAway(
    window,
    document,
    () => {
      keys.clear();
      controls.release();
    },
    { signal: abort.signal },
  );

  keys.press("ArrowRight");
  keys.press("Space");
  assert.equal(controls.value(), INPUT_RIGHT | INPUT_HELD);
  // The phone case: the tab is hidden without the window ever losing focus.
  document.visibilityState = "hidden";
  document.fire("visibilitychange");
  assert.equal(controls.value(), 0, "the held bits are let go");
  // And the keyboard's own set is cleared with them, so coming back does not re-hold what was down.
  log.length = 0;
  keys.lift("ArrowRight");
  keys.lift("Space");
  assert.deepEqual(log, [], "nothing was still held to lift");
  keys.press("ArrowRight");
  assert.equal(controls.value(), INPUT_RIGHT, "the keys work again");

  // Coming back into view holds nothing of its own.
  document.visibilityState = "visible";
  document.fire("visibilitychange");
  assert.equal(controls.value(), INPUT_RIGHT, "a visible tab releases nothing");

  window.fire("blur");
  assert.equal(controls.value(), 0, "focus loss still releases");

  // The listeners come off with the page's others: an aborted room releases nothing more.
  keys.press("ArrowLeft");
  abort.abort();
  document.visibilityState = "hidden";
  document.fire("visibilitychange");
  window.fire("blur");
  assert.equal(controls.value(), INPUT_LEFT, "nothing is listening any more");
  assert.deepEqual(
    [...window.listeners.values(), ...document.listeners.values()].flat(),
    [],
  );
});
test("a report cancels a gamepad and held buttons or axes cannot resume until neutral", () => {
  const { log, controls } = rig();
  const pads = new Pads(controls);
  pads.poll([pad([-1, 0], [0, 1])]);
  pads.cancel();
  controls.release();
  const count = log.length;
  pads.poll([pad([-1, 0], [0, 1])]);
  assert.equal(controls.value(), 0);
  assert.equal(
    log.length,
    count,
    "closing must not flap or attack from a held pad",
  );
  pads.poll([pad([0, 0])]);
  pads.poll([pad([-1, 0], [0])]);
  assert.equal(controls.value(), INPUT_LEFT | INPUT_HELD);
  assert.equal(log.at(-1), "press");
});

import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { setupLocalPlayers } from "../src/online/local-gamepads.js";
import {
  STANDARD_PAD,
  type PadSnapshot,
} from "../src/client/controller-gamepad.js";
import { LOCAL_KEYBOARD_PRESETS } from "../src/client/controller-keyboard.js";

const pad = (
  index = 0,
  mapping = "standard",
  buttons: number[] = [],
  axis = 0,
): PadSnapshot => ({
  index,
  id: `Controller ${index}`,
  connected: true,
  mapping,
  axes: [axis, 0],
  buttons: Array.from({ length: 17 }, (_, i) => ({
    pressed: buttons.includes(i),
    value: Number(buttons.includes(i)),
  })),
});
function setup(initial: PadSnapshot[] = [], initialError?: string) {
  const { document } = parseHTML(
    "<html><body><div id='app'></div></body></html>",
  );
  const app = document.querySelector<HTMLElement>("#app")!;
  let pads = initial,
    error = initialError,
    frame: (() => void) | undefined,
    leave = () => {},
    restore = () => {},
    cancelled = 0;
  const result = setupLocalPlayers(app, {
    document,
    backUrl: "/",
    readPads: () => ({ pads, error }),
    requestFrame: (fn) => {
      frame = fn;
      return 1;
    },
    cancelFrame: () => {
      frame = undefined;
      cancelled++;
    },
    onPageHide: (fn) => {
      leave = fn;
    },
    onPageRestore: (fn) => {
      restore = fn;
    },
  });
  const input = (label: string) =>
    app.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  const button = (text: string) =>
    [...app.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === text,
    )!;
  const press = (b: HTMLElement) =>
    b.onclick?.call(b, new Event("click") as PointerEvent);
  const tick = () => {
    const fn = frame;
    frame = undefined;
    fn?.();
  };
  return {
    app,
    result,
    input,
    button,
    press,
    tick,
    addKeyboard: () => press(button("ADD KEYBOARD PLAYER")),
    update: (next: PadSnapshot[], failure?: string) => {
      pads = next;
      error = failure;
      tick();
    },
    leave: () => leave(),
    restore: () => restore(),
    cancelled: () => cancelled,
  };
}
test("setup detects multiple pads, retains names and returns fixed assignments plus an optional keyboard", async () => {
  const f = setup();
  assert.equal(f.button("START LOCAL GAME").disabled, true);
  assert.match(f.app.textContent!, /No controllers detected/);
  f.update([pad(0), pad(2)]);
  f.input("Controller 1 player name").value = " Alice ";
  f.addKeyboard();
  f.tick();
  assert.match(f.app.textContent!, /3 players · 2 AI/);
  f.press(f.button("START LOCAL GAME"));
  assert.deepEqual(await f.result, [
    { name: "Keyboard 1", keys: LOCAL_KEYBOARD_PRESETS[0] },
    {
      name: "Alice",
      pad: {
        id: "Controller 0",
        index: 0,
        mapping: STANDARD_PAD,
        standard: true,
      },
    },
    {
      name: "Player 3",
      pad: {
        id: "Controller 2",
        index: 2,
        mapping: STANDARD_PAD,
        standard: true,
      },
    },
  ]);
  assert.equal(f.cancelled(), 1);
});
test("capacity, blank names and disconnected pads cannot start an invalid roster", () => {
  const pads = Array.from({ length: 6 }, (_, i) => pad(i));
  const f = setup(pads);
  assert.equal(f.input("Use controller 6").checked, false);
  f.input("Use controller 6").checked = true;
  f.tick();
  assert.equal(f.button("START LOCAL GAME").disabled, true);
  assert.match(f.app.textContent!, /at most five/);
  f.input("Use controller 6").checked = false;
  f.input("Controller 1 player name").value = " ";
  f.tick();
  assert.equal(f.button("START LOCAL GAME").disabled, true);
  f.input("Controller 1 player name").value = "Alice";
  f.update([]);
  assert.equal(f.button("START LOCAL GAME").disabled, true);
  assert.match(f.app.textContent!, /Disconnected/);
  f.update([pad()]);
  assert.equal(f.button("START LOCAL GAME").disabled, false);
  f.leave();
  assert.equal(f.cancelled(), 1);
});
test("blocked access offers retry and keyboard fallback", async () => {
  const f = setup([], "Controller access is blocked");
  assert.equal(f.button("RETRY DETECTION").hidden, false);
  f.addKeyboard();
  f.tick();
  assert.equal(f.button("START LOCAL GAME").disabled, false);
  f.press(f.button("RETRY DETECTION"));
  f.update([pad()]);
  assert.equal(f.button("RETRY DETECTION").hidden, true);
  f.input("Use controller 1").checked = false;
  f.tick();
  f.press(f.button("START LOCAL GAME"));
  assert.deepEqual(await f.result, [
    { name: "Keyboard 1", keys: LOCAL_KEYBOARD_PRESETS[0] },
  ]);
});
test("raw controllers calibrate deliberate left/right/fire, rejecting repeated controls", async () => {
  const f = setup([pad(0, "")]);
  assert.equal(f.button("START LOCAL GAME").disabled, true);
  f.press(f.button("CONFIGURE CONTROLS"));
  f.tick();
  assert.match(f.app.textContent!, /LEFT/);
  f.update([pad(0, "", [], -1)]);
  f.update([pad(0, "")]);
  assert.match(f.app.textContent!, /RIGHT/);
  f.update([pad(0, "", [], 1)]);
  f.update([pad(0, "")]);
  assert.match(f.app.textContent!, /FIRE/);
  f.update([pad(0, "", [2])]);
  assert.equal(f.button("START LOCAL GAME").disabled, false);
  f.press(f.button("START LOCAL GAME"));
  assert.deepEqual((await f.result)[0]?.pad?.mapping, {
    left: [{ axis: 0, direction: -1 }],
    right: [{ axis: 0, direction: 1 }],
    bomb: [{ button: 2 }],
  });
  const repeat = setup([pad(0, "")]);
  repeat.press(repeat.button("CONFIGURE CONTROLS"));
  for (let i = 0; i < 3; i++) {
    repeat.update([pad(0, "")]);
    repeat.update([pad(0, "", [1])]);
  }
  assert.equal(repeat.button("START LOCAL GAME").disabled, true);
  assert.match(repeat.app.textContent!, /Controls must differ/);
  repeat.update([{ ...pad(), id: "Replacement" }]);
  assert.match(repeat.app.textContent!, /Replacement/);
  assert.equal(repeat.button("START LOCAL GAME").disabled, false);
});

test("multiple keyboard players have editable presets, prevent conflicting keys, and can be removed", async () => {
  const f = setup();
  f.addKeyboard();
  f.addKeyboard();
  f.tick();
  const choices = f.app.querySelectorAll<HTMLSelectElement>("select");
  assert.deepEqual(
    [...choices].map((choice) => choice.value),
    ["KeyA", "KeyD", "Space", "KeyE", "KeyF", "KeyM"],
  );
  const select = (value: string) => {
    for (const option of choices[3]!.querySelectorAll("option"))
      option.removeAttribute("selected");
    choices[3]!.querySelector<HTMLOptionElement>(
      `option[value="${value}"]`,
    )!.selected = true;
    f.tick();
  };
  select("KeyA");
  assert.equal(f.button("START LOCAL GAME").disabled, true);
  assert.match(f.app.textContent!, /separate keys/);
  select("KeyZ");
  assert.equal(f.button("START LOCAL GAME").disabled, false);
  f.press(
    f.app.querySelector<HTMLElement>('[aria-label="Remove keyboard 1"]')!,
  );
  f.tick();
  f.addKeyboard();
  f.tick();
  assert.equal(f.app.querySelectorAll(".local-keyboard").length, 2);
  f.press(f.button("START LOCAL GAME"));
  const players = await f.result;
  assert.deepEqual(
    players.map((p) => p.keys?.left),
    ["KeyZ", "KeyA"],
  );
});

test("browser Back resumes setup detection without restarting a completed setup", async () => {
  const f = setup();
  f.leave();
  f.update([pad()]);
  assert.equal(f.button("START LOCAL GAME").disabled, true);
  f.restore();
  assert.equal(f.button("START LOCAL GAME").disabled, false);
  f.press(f.button("START LOCAL GAME"));
  await f.result;
  f.leave();
  f.restore();
  f.update([]);
  assert.equal(f.button("START LOCAL GAME").disabled, false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { LEFT, RIGHT } from "../src/engine/input.js";
import {
  Flow,
  menuAction,
  pressesFocusedControl,
  type MenuState,
} from "../src/app/flow.js";
import {
  HOLD_MS,
  attachGamepads,
  type GamepadLike,
} from "../src/app/input/gamepad.js";
import { InputHub, type Command, type DeviceId } from "../src/app/input/hub.js";
import type { TouchPadStyle } from "../src/app/input/index.js";
import {
  attachKeyboard,
  type KeyEventLike,
  type KeyboardTarget,
} from "../src/app/input/keyboard.js";
import {
  attachTouch,
  type PointerLike,
  type PointerTarget,
} from "../src/app/input/touch.js";

/** A standard-mapped pad with these buttons down (0–3 face buttons, 8 Back, 9 Start). */
function pad(index: number, down: number[] = [], mapping = "standard") {
  return {
    index,
    connected: true,
    mapping,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({
      pressed: down.includes(i),
      value: down.includes(i) ? 1 : 0,
    })),
  } satisfies GamepadLike;
}

/** Fake pads on a fake clock feeding a real hub. */
function fakePads(hub: InputHub) {
  const state = { pads: [] as GamepadLike[], time: 0 };
  hub.addSource(
    attachGamepads(
      () => state.pads,
      (d, bits) => hub.setHeld(d, bits),
      (d, c) => hub.command(d, c),
      () => state.time,
    ),
  );
  return state;
}

test("gamepads: Start and Back are commands, never presses, and a held button reports hold once", () => {
  const presses: DeviceId[] = [];
  const commands: string[] = [];
  const hub = new InputHub();
  hub.onPress((d) => presses.push(d));
  let [pads, time] = [[pad(0)] as GamepadLike[], 0];
  const source = attachGamepads(
    () => pads,
    (d, bits) => hub.setHeld(d, bits),
    (d, c) => commands.push(`${d} ${c}`),
    () => time,
  );
  const poll = (next: GamepadLike[], at: number) => {
    [pads, time] = [next, at];
    source.poll?.();
  };
  poll([pad(0)], 0);
  poll([pad(0, [9])], 16);
  poll([pad(0, [9])], 32); // still held: no repeat
  poll([pad(0, [8])], 48);
  poll([pad(0, [0])], 64); // the player button goes down…
  poll([pad(0, [0])], 64 + HOLD_MS - 1);
  poll([pad(0, [0])], 64 + HOLD_MS); // …and is held for a second
  poll([pad(0, [0])], 64 + 3 * HOLD_MS);
  poll([pad(0, [1])], 64 + 3 * HOLD_MS + 16); // still a face button down: no new press
  poll([pad(0, [12])], 4000); // steering alone (the D-pad)…
  poll([pad(0, [12])], 4000 + 2 * HOLD_MS); // …never reports hold
  poll([pad(1, [9], "")], 7000); // unmapped pad: every button is the player button
  assert.deepEqual(presses, ["pad:0", "pad:1"]);
  assert.deepEqual(commands, ["pad:0 start", "pad:0 back", "pad:0 hold"]);
});

test("the hub passes commands to their listeners without latching a shot", () => {
  const hub = new InputHub();
  const seen: [DeviceId, Command][] = [];
  const off = hub.onCommand((d, c) => seen.push([d, c]));
  hub.bind(0, "pad:0");
  hub.command("pad:0", "start");
  assert.deepEqual(hub.takePresses(1), [false]);
  off();
  hub.command("pad:0", "back");
  assert.deepEqual(seen, [["pad:0", "start"]]);
});

test("menu keys and pad commands: Start confirms and pauses, Back goes back", () => {
  const table: [MenuState, string, string | undefined][] = [
    ["lobby", "start", "start"],
    ["lobby", "back", undefined],
    ["lobby", "Enter", "start"],
    ["lobby", "Space", undefined], // the WASD rider's fire key
    ["winner", "Space", undefined],
    ["countdown", "start", "pause"],
    ["playing", "start", "pause"],
    ["playing", "back", "pause"],
    ["playing", "Escape", "pause"],
    ["playing", "Enter", undefined],
    ["paused", "start", "resume"],
    ["paused", "back", "resume"],
    ["paused", "Backspace", "quit"],
    ["results", "start", "next"],
    ["results", "back", "pause"],
    ["winner", "start", "again"],
    ["winner", "back", "lobby"],
  ];
  for (const [state, key, action] of table)
    assert.equal(menuAction(state, key), action, `${key} in ${state}`);
});

test("Enter and Space on a focused control outside the screens press it, not the menus", () => {
  /** A focused element: a button or link (`control`), inside the overlay screens or not. */
  const focused = (control: boolean, inScreen: boolean) =>
    ({ closest: () => (control ? {} : null), inScreen }) as unknown as Node;
  const screen = {
    contains: (node: Node | null) =>
      (node as unknown as { inScreen: boolean }).inScreen,
  };
  const portalToggle = focused(true, false);
  const lobbyButton = focused(true, true);
  const canvas = focused(false, false);
  assert.ok(pressesFocusedControl("Enter", portalToggle, screen));
  assert.ok(pressesFocusedControl("Space", portalToggle, screen));
  // Player buttons and other menu keys still reach the game.
  assert.ok(!pressesFocusedControl("KeyQ", portalToggle, screen));
  assert.ok(!pressesFocusedControl("Escape", portalToggle, screen));
  // A clicked lobby button, the page itself and no target leave Enter to the lobby.
  assert.ok(!pressesFocusedControl("Enter", lobbyButton, screen));
  assert.ok(!pressesFocusedControl("Enter", canvas, screen));
  assert.ok(!pressesFocusedControl("Enter", null, screen));
});

test("keyboard riders join and leave the lobby by their fire key; direction keys never join", () => {
  const { flow, hub } = fakeFlow();
  const listeners = new Map<string, (event: KeyEventLike) => void>();
  const target: KeyboardTarget = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: () => undefined,
  };
  attachKeyboard(target, (d, bits) => hub.setHeld(d, bits));
  const key = (type: "keydown" | "keyup", code: string) =>
    listeners.get(type)?.({
      code,
      repeat: false,
      ...{ ctrlKey: false, metaKey: false, altKey: false },
      preventDefault: () => undefined,
    });
  for (const code of ["KeyW", "KeyA", "ArrowUp", "KeyI", "Numpad8"])
    key("keydown", code);
  assert.deepEqual(flow.lobby.devices, Array(6).fill(undefined));
  key("keydown", "Space");
  key("keydown", "Slash");
  key("keyup", "Slash");
  key("keydown", "Slash"); // fires again: leaves
  key("keydown", "KeyH");
  key("keydown", "NumpadEnter");
  assert.deepEqual(flow.lobby.devices.slice(0, 4), [
    "key:WASD",
    "key:IJKL",
    "key:NUMPAD",
    undefined,
  ]);
});

type Listener = (event: never) => void;

/**
 * Touch pads on a fake 1000 × 500 overlay feeding `hub`. `press` puts finger `id` on one side's control (a point of
 * its D-pad, up by default) and `lift` takes it off; `tap` is both, on FIRE or the up arrow.
 */
function fakeTouchPads(hub: InputHub) {
  const listeners = new Map<string, (event: PointerLike) => void>();
  const surface: PointerTarget = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: () => undefined,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 500,
    }),
  };
  const page = { addEventListener: () => {}, removeEventListener: () => {} };
  const source = attachTouch(surface, (d, bits) => hub.setHeld(d, bits), page);
  const pointer = (type: string, x: number, y: number, pointerId: number) =>
    listeners.get(type)?.({
      ...{ clientX: x, clientY: y, pointerId },
      preventDefault: () => undefined,
    });
  /** Finger `id` down on `side`'s FIRE, or at fractions `at` of its D-pad; false when that side shows no pad. */
  const press = (
    side: number,
    control: "fire" | "dpad",
    at: readonly [number, number] = control === "fire"
      ? [0.5, 0.5]
      : [0.5, 0.15],
    id = 1,
  ): boolean => {
    const rect = source.layout().find((pad) => pad.side === side)?.[control];
    if (!rect) return false;
    pointer(
      "pointerdown",
      rect.x + rect.width * at[0],
      rect.y + rect.height * at[1],
      id,
    );
    return true;
  };
  const lift = (id = 1) => pointer("pointerup", 0, 0, id);
  const tap = (side: number, control: "fire" | "dpad"): boolean => {
    const pressed = press(side, control);
    lift();
    return pressed;
  };
  return { source, press, lift, tap };
}

/** A Flow on fake devices: a real hub, fake pads, touch pads and clock, a fake overlay element and keyboard. */
function fakeFlow(touch = false) {
  const hub = new InputHub();
  const pads = fakePads(hub);
  const touchPads = fakeTouchPads(hub);
  const zones: (TouchPadStyle | undefined)[][] = [];
  const listeners = new Map<string, Listener>();
  const root = {
    dataset: {} as Record<string, string>,
    innerHTML: "",
    addEventListener: (type: string, l: Listener) => listeners.set(type, l),
  };
  const flow = new Flow({
    input: {
      hub,
      touchEnabled: touch,
      setTouchPads: (z) => {
        zones.push([...z]);
        touchPads.source.setSides(z.flatMap((s, side) => (s ? [side] : [])));
      },
    },
    root: root as unknown as HTMLElement,
    keys: { addEventListener: () => undefined },
    show: () => undefined,
    seed: 1,
  });
  /** Poll the pads (as the round scene's frame does) with these buttons down, `ms` later. */
  const frame = (next: GamepadLike[] = pads.pads, ms = 16) => {
    pads.pads = next;
    pads.time += ms;
    flow.advance(ms);
  };
  const click = (action: string) =>
    (listeners.get("click") as (e: object) => void)({
      target: { closest: () => ({ getAttribute: () => action }) },
    });
  return { flow, hub, frame, root, zones, click, ...touchPads };
}

test("a gamepad-only group joins, starts with Start and pauses and resumes with Start", () => {
  const { flow, frame } = fakeFlow();
  frame([pad(0), pad(1)]);
  frame([pad(0, [0]), pad(1, [2])]); // both join
  frame([pad(0), pad(1)]);
  assert.deepEqual(flow.lobby.devices.slice(0, 2), ["pad:0", "pad:1"]);
  frame([pad(0), pad(1, [9])]);
  assert.equal(flow.screen.kind, "countdown");
  frame([pad(0), pad(1)], 4000);
  assert.equal(flow.screen.kind, "playing");
  const x = flow.view.castles[0]?.x ?? 0;
  for (let i = 0; i < 30; i++) frame([pad(0, [15]), pad(1)]); // D-pad right
  assert.ok((flow.view.castles[0]?.x ?? 0) > x + 5, "the held D-pad steers");
  frame([pad(0, [0]), pad(1)]); // a shot never pauses
  assert.equal(flow.paused, false);
  frame([pad(0, [0, 9]), pad(1)]);
  assert.equal(flow.paused, true);
  const tick = flow.view.tick;
  frame([pad(0, [0]), pad(1)], 1000);
  assert.equal(flow.view.tick, tick, "paused: the round stands still");
  frame([pad(0, [0, 9]), pad(1)]);
  assert.equal(flow.paused, false);
});

test("holding a seated player's button for a second in the lobby starts the match", () => {
  const { flow, frame } = fakeFlow();
  frame([pad(0, [0])]); // joins
  frame([pad(0)]);
  frame([pad(0, [0])]); // leaves again, then holds: not seated, no start
  frame([pad(0, [0])], HOLD_MS);
  assert.equal(flow.screen.kind, "lobby");
  frame([pad(0)]);
  frame([pad(0, [0])]); // joins and holds
  frame([pad(0, [0])], HOLD_MS / 2);
  assert.equal(flow.screen.kind, "lobby");
  frame([pad(0, [0])], HOLD_MS / 2);
  assert.equal(flow.screen.kind, "countdown");
  frame([pad(0, [0])], HOLD_MS * 5); // still held mid-round: nothing more
  assert.equal(flow.paused, false);
});

test("touch riders join and leave the lobby with their side's FIRE; the D-pad never joins", () => {
  const { flow, zones, tap } = fakeFlow(true);
  const labels = () => zones.at(-1)?.map((z) => z?.label);
  assert.deepEqual(labels(), ["JOIN", "JOIN"]);
  assert.ok(tap(0, "dpad") && tap(1, "dpad"));
  assert.deepEqual(flow.lobby.devices, Array(6).fill(undefined));
  tap(1, "fire");
  tap(0, "fire");
  assert.deepEqual(flow.lobby.devices.slice(0, 2), ["touch:1", "touch:0"]);
  assert.deepEqual(labels(), ["BLUE", "RED"]);
  tap(1, "fire"); // fires again: leaves
  assert.deepEqual(flow.lobby.devices.slice(0, 2), [undefined, "touch:0"]);
  assert.deepEqual(labels(), ["BLUE", "JOIN"]);
});

test("touch riders keep their side in the match, and get a pause button", () => {
  const { flow, hub, root, zones, click, tap } = fakeFlow(true);
  tap(0, "fire");
  tap(1, "fire");
  tap(0, "fire"); // leaves: the right side's rider stays on the right
  flow.advance(16);
  assert.match(root.innerHTML, /data-action="start"/);
  assert.doesNotMatch(root.innerHTML, /data-action="pause"/);
  click("start");
  assert.deepEqual(flow.lobby.devices[1], "touch:1");
  assert.deepEqual(
    zones.at(-1)?.map((z) => z?.label),
    [undefined, "FIRE"],
  );
  assert.equal(tap(0, "fire"), false, "only seated sides show");
  hub.clearPresses();
  assert.ok(tap(1, "fire"));
  assert.deepEqual(hub.takePresses(2), [false, true]);
  flow.advance(16);
  assert.match(root.innerHTML, /data-action="pause"/);
  click("pause");
  assert.equal(flow.paused, true);
  flow.advance(16);
  assert.doesNotMatch(root.innerHTML, /class="pause"/);
});

test("a touch rider flies with the held D-pad through the match flow, and stops when the finger lifts", () => {
  const { flow, hub, frame, click, tap, press, lift } = fakeFlow(true);
  tap(0, "fire");
  click("start");
  frame(undefined, 4000); // the countdown
  assert.equal(flow.screen.kind, "playing");
  const x = () => flow.view.castles[0]?.x ?? 0;
  const start = x();
  press(0, "dpad", [0.9, 0.5]); // the right arrow
  assert.equal(hub.heldBits(0), RIGHT);
  for (let i = 0; i < 30; i++) frame();
  assert.ok(x() > start + 5, "the held arrow flies right");
  assert.equal(flow.view.lastHeld[0], RIGHT, "steering is not a shot");
  lift();
  frame();
  assert.equal(flow.view.lastHeld[0], 0);
});

test("the touch pads give way to the pause menu and let go of every finger, and return on resume", () => {
  const { flow, hub, zones, frame, click, tap, press } = fakeFlow(true);
  tap(0, "fire");
  tap(1, "fire");
  click("start");
  frame(undefined, 4000);
  press(0, "dpad", [0.9, 0.5], 1);
  press(1, "dpad", [0.1, 0.5], 2);
  assert.deepEqual(
    [hub.heldBy("touch:0"), hub.heldBy("touch:1")],
    [RIGHT, LEFT],
  );
  click("pause");
  assert.deepEqual(zones.at(-1), [undefined, undefined], "no pad over RESUME");
  assert.deepEqual([hub.heldBy("touch:0"), hub.heldBy("touch:1")], [0, 0]);
  assert.equal(press(0, "fire"), false, "nothing to touch while paused");
  click("resume");
  assert.deepEqual(
    zones.at(-1)?.map((z) => z?.label),
    ["FIRE", "FIRE"],
  );
  assert.equal(flow.paused, false);
});

test("the touch pads stay off the results screen and come back with the next round", () => {
  const { flow, zones, frame, click, tap } = fakeFlow(true);
  const shown = () => zones.at(-1)?.map((z) => z !== undefined);
  tap(0, "fire");
  tap(1, "fire");
  click("start");
  frame(undefined, 4000);
  assert.deepEqual(shown(), [true, true]);
  for (let i = 0; i < 4000 && flow.screen.kind === "playing"; i++)
    frame(undefined, 100);
  assert.equal(flow.screen.kind, "results", "the round ran out");
  assert.deepEqual(shown(), [false, false], "no pad over NEXT ROUND");
  frame(undefined, 8000); // the results screen counts down
  assert.equal(flow.screen.kind, "countdown");
  assert.deepEqual(shown(), [true, true]);
});

test("the touch pads stay off the winner screen, and the lobby brings them back", () => {
  const { flow, zones, frame, click, tap } = fakeFlow(true);
  const shown = () => zones.at(-1)?.map((z) => z !== undefined);
  tap(0, "fire");
  flow.lobby.setWinsToWin(1);
  click("start");
  for (let i = 0; i < 40000 && flow.screen.kind !== "winner"; i++)
    frame(undefined, 100);
  assert.equal(flow.screen.kind, "winner", "one round win takes the match");
  assert.deepEqual(shown(), [false, false], "no pad over PLAY AGAIN");
  click("lobby");
  assert.deepEqual(shown(), [true, true], "the lobby's JOIN pads");
});

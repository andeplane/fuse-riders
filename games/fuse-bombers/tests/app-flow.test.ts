import test from "node:test";
import assert from "node:assert/strict";
import { Flow, menuAction, type MenuState } from "../src/app/flow.js";
import {
  HOLD_MS,
  attachGamepads,
  type GamepadLike,
} from "../src/app/input/gamepad.js";
import { InputHub, type Command, type DeviceId } from "../src/app/input/hub.js";
import type { TouchZoneStyle } from "../src/app/input/index.js";
import { Lobby } from "../src/app/lobby.js";

/** A standard-mapped pad with these buttons down (0–3 face buttons, 8 Back, 9 Start). */
function pad(index: number, down: number[] = [], mapping = "standard") {
  return {
    index,
    connected: true,
    mapping,
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
      (d) => hub.press(d),
      (d, c) => hub.command(d, c),
      () => state.time,
    ),
  );
  return state;
}

test("gamepads: Start and Back are commands, never presses, and a held button reports hold once", () => {
  const presses: DeviceId[] = [];
  const commands: string[] = [];
  let [pads, time] = [[pad(0)] as GamepadLike[], 0];
  const source = attachGamepads(
    () => pads,
    (d) => presses.push(d),
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
  poll([pad(1, [9], "")], 5000); // unmapped pad: every button is the player button
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

test("touch zones are renumbered left to right, so a match has no blank zone", () => {
  const lobby = new Lobby();
  for (const d of ["touch:0", "key:Q", "touch:1", "touch:2"] as const)
    lobby.press(d);
  lobby.press("touch:0"); // leaves slot 0
  lobby.press("pad:0"); // takes slot 0
  lobby.compactTouchZones();
  assert.deepEqual(
    lobby.seats().map((s) => s.device),
    ["pad:0", "key:Q", "touch:0", "touch:1"],
  );
});

type Listener = (event: never) => void;

/** A Flow on fake devices: a real hub, fake pads and clock, a fake overlay element and keyboard. */
function fakeFlow(touch = false) {
  const hub = new InputHub();
  const pads = fakePads(hub);
  const zones: TouchZoneStyle[][] = [];
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
      setTouchZones: (z) => zones.push([...z]),
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
  return { flow, hub, frame, root, zones, click };
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

test("touch-only players get a pause button mid-round and no blank zone", () => {
  const { flow, hub, root, zones, click } = fakeFlow(true);
  hub.press("touch:0");
  hub.press("touch:1");
  hub.press("touch:0"); // leaves: zone 0 would be blank in the match
  flow.advance(16);
  assert.match(root.innerHTML, /data-action="start"/);
  assert.doesNotMatch(root.innerHTML, /data-action="pause"/);
  click("start");
  assert.deepEqual(flow.lobby.devices[1], "touch:0");
  assert.deepEqual(
    zones.at(-1)?.map((z) => z.label),
    ["BLUE"],
  );
  flow.advance(16);
  assert.match(root.innerHTML, /data-action="pause"/);
  click("pause");
  assert.equal(flow.paused, true);
  flow.advance(16);
  assert.doesNotMatch(root.innerHTML, /class="pause"/);
});

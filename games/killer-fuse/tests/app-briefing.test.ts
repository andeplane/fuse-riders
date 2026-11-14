import test from "node:test";
import assert from "node:assert/strict";
import { QUEEN_EGGS } from "../src/engine/index.js";
import {
  briefing,
  briefingKey,
  buttonLabel,
  deviceFor,
  type DeviceClues,
} from "../src/app/briefing.js";
import {
  CONTROLS,
  DEVICE_CONTROLS,
  DEVICE_KEYS,
  WIN_LINE,
} from "../src/app/guide.js";

const clues = (patch: Partial<DeviceClues> = {}): DeviceClues => ({
  last: undefined,
  pad: false,
  coarse: false,
  controller: false,
  ...patch,
});
/** Every line the card shows, as the page lays it out: a title and at most four lines under it. */
const lines = (card: ReturnType<typeof briefing>): string[] => [
  ...(card.controls.length
    ? [card.controls.map((hint) => `${hint.keys} ${hint.action}`).join(" · ")]
    : []),
  ...card.tips,
  card.win,
];

test("a Queen on the keyboard: flap, dive, kill from above, claim gates, her lives", () => {
  const card = briefing(0, "keys");
  assert.equal(card.title, "YOU ARE THE CYAN QUEEN");
  assert.equal(card.team, 0);
  assert.deepEqual(card.controls, [
    { keys: "A D / ← →", action: "move" },
    { keys: "Space", action: "flap: tap ~3×/s to hold height" },
    { keys: "S / ↓", action: "dive, hold" },
  ]);
  assert.deepEqual(card.tips, [
    `Touch enemies from above or behind to kill · Touch gates to claim them · You have ${QUEEN_EGGS} lives`,
  ]);
  assert.equal(card.win, WIN_LINE);
  assert.equal(briefing(1, "keys").title, "YOU ARE THE PINK QUEEN");
  assert.equal(briefing(1, "keys").team, 1);
});

test("a Worker: jump, berries, gates and the snail", () => {
  const card = briefing(5, "pad");
  assert.equal(card.title, "YOU ARE THE PINK WORKER");
  assert.equal(card.team, 1);
  assert.deepEqual(card.controls, [
    { keys: "Stick / D-pad ← →", action: "move" },
    { keys: "A / Cross", action: "jump (hold for higher)" },
  ]);
  assert.match(card.tips[0]!, /berries to your hive/);
  assert.match(card.tips[0]!, /gate with a berry/);
  assert.match(card.tips[1]!, /snail/);
  assert.equal(briefing(2, "keys").team, 0);
  assert.equal(briefing(4, "keys").title, "YOU ARE THE CYAN WORKER");
});

test("on touch the card names the button by its label", () => {
  assert.equal(briefing(0, "touch").controls[1]!.keys, "FLAP");
  assert.equal(briefing(0, "touch").controls[2]!.keys, "Left pad ↓");
  assert.equal(briefing(3, "touch").controls[1]!.keys, "JUMP");
  assert.equal(buttonLabel("worker"), "JUMP");
  assert.equal(buttonLabel("warrior"), "FLAP");
  assert.equal(buttonLabel("queen"), "FLAP");
  assert.equal(buttonLabel(undefined), "FLAP");
});

test("a watcher gets the objective only", () => {
  const card = briefing(-1, "keys");
  assert.equal(card.title, "WATCHING");
  assert.equal(card.team, undefined);
  assert.deepEqual([card.controls, card.tips], [[], []]);
  assert.match(card.win, new RegExp(`${QUEEN_EGGS} times`));
});

test("every card stays within four lines", () => {
  for (const slot of [-1, 0, 1, 2, 3, 4, 5])
    for (const device of ["keys", "pad", "touch"] as const)
      assert.ok(lines(briefing(slot, device)).length <= 4, `${slot} ${device}`);
});

test("the device: what was used last, else a gamepad, else touch on a phone, else keys", () => {
  assert.equal(deviceFor(clues()), "keys");
  assert.equal(deviceFor(clues({ coarse: true })), "touch");
  assert.equal(deviceFor(clues({ controller: true })), "touch");
  assert.equal(deviceFor(clues({ coarse: true, pad: true })), "pad");
  assert.equal(deviceFor(clues({ pad: true, last: "keys" })), "keys");
  assert.equal(deviceFor(clues({ coarse: true, last: "pad" })), "pad");
  assert.equal(deviceFor(clues({ last: "touch" })), "touch");
});

test("the card's key changes with its text and only then", () => {
  assert.equal(
    briefingKey(briefing(0, "keys")),
    briefingKey(briefing(0, "keys")),
  );
  assert.notEqual(
    briefingKey(briefing(0, "keys")),
    briefingKey(briefing(0, "pad")),
  );
  assert.notEqual(
    briefingKey(briefing(2, "keys")),
    briefingKey(briefing(3, "keys")),
  );
});

test("no hint names up: flying is only ever the button", () => {
  const texts = [
    ...Object.values(DEVICE_KEYS).flatMap((keys) => Object.values(keys)),
    ...Object.values(DEVICE_CONTROLS).flatMap((hints) =>
      hints.flatMap((hint) => [hint.keys, hint.action]),
    ),
    ...CONTROLS.flatMap((hint) => [hint.keys, hint.action]),
    ...[-1, 0, 2].flatMap((slot) =>
      (["keys", "pad", "touch"] as const).flatMap((device) =>
        lines(briefing(slot, device)),
      ),
    ),
  ];
  for (const text of texts) {
    assert.doesNotMatch(text, /↑|\bup\b|\bW\b/i, text);
  }
});

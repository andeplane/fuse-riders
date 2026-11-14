import test from "node:test";
import assert from "node:assert/strict";
import { QUEEN_EGGS } from "../src/engine/index.js";
import {
  FINAL_TICKS,
  TITLE_AT,
  WIN_STAGES,
  buttonLabel,
  cardKey,
  countdownCard,
  deviceFor,
  roleControls,
  type CountdownCard,
  type CountdownState,
  type DeviceClues,
} from "../src/app/briefing.js";
import { CONTROLS, DEVICE_CONTROLS, DEVICE_KEYS } from "../src/app/guide.js";

const clues = (patch: Partial<DeviceClues> = {}): DeviceClues => ({
  last: undefined,
  pad: false,
  coarse: false,
  controller: false,
  ...patch,
});
/** The first game's countdown, 8 s, at `elapsed` log ticks. */
const first = (elapsed: number): CountdownState => ({
  round: 1,
  elapsed,
  left: 161 - elapsed,
});
const card = (state: CountdownState, slot = 0): CountdownCard =>
  countdownCard(state, slot, "keys", "Twin Hives");
const texts = (shown: CountdownCard): string[] => [
  shown.title,
  shown.subtitle,
  ...shown.wins.map((win) => win.caption),
  ...shown.controls.flatMap((hint) => [hint.keys, hint.action]),
];

test("every seat sees all four controls, keyboard and gamepad side by side", () => {
  assert.deepEqual(roleControls(0, "keys"), [
    { keys: "A D / ← → · Stick / D-pad ← →", action: "move" },
    {
      keys: "Space · A / Cross",
      action: "flap: tap repeatedly to fly (~3/s holds height)",
    },
    { keys: "S / ↓ · Stick / D-pad ↓", action: "dive (Queen, hold)" },
    { keys: "J · B / Circle", action: "attack (Warrior, Queen)" },
  ]);
  assert.deepEqual(
    roleControls(5, "pad"),
    roleControls(5, "keys"),
    "the same on either",
  );
  assert.deepEqual(
    roleControls(5, "keys").map((hint) => hint.action),
    [
      "move",
      "jump (hold for higher); tap repeatedly to fly as a Warrior",
      "dive (Queen, hold)",
      "attack (Warrior, Queen)",
    ],
  );
  assert.deepEqual(
    roleControls(1, "touch").map((hint) => hint.keys),
    ["Left pad", "FLAP", "Left pad ↓", "ATTACK"],
  );
  assert.equal(roleControls(3, "touch")[1]!.keys, "JUMP");
  assert.deepEqual(roleControls(-1, "keys"), [], "a watcher has no keys");
});

test("the first game opens on the three ways to win, one picture at a time, with the controls throughout", () => {
  assert.equal(card(first(0)).title, "", "a dark beat before the title");
  assert.equal(card(first(TITLE_AT)).title, "THREE WAYS TO WIN");
  assert.deepEqual(
    WIN_STAGES.map((stage) => stage.at),
    [32, 46, 60],
    "1.6, 2.3 and 3.0 s at 20 ticks a second",
  );
  const counts = [0, 31, 32, 45, 46, 59, 60, 100].map(
    (elapsed) => card(first(elapsed)).wins.length,
  );
  assert.deepEqual(counts, [0, 0, 1, 1, 2, 2, 3, 3]);
  assert.deepEqual(
    card(first(60)).wins.map((win) => win.kind),
    ["military", "economy", "snail"],
  );
  for (const win of card(first(60)).wins) {
    const words = win.caption.split(" ").length;
    assert.ok(words >= 3 && words <= 5, win.caption);
  }
  assert.match(card(first(60)).wins[0]!.caption, new RegExp(`${QUEEN_EGGS}×`));
  for (const elapsed of [0, 10, 60, 120, 160])
    assert.equal(card(first(elapsed)).controls.length, 4, "controls stay");
  const opening = card(first(10), 3);
  assert.equal(opening.first, true);
  assert.equal(opening.team, 1);
  assert.equal(
    opening.subtitle,
    "GAME 1 · TWIN HIVES · YOU ARE THE PINK WORKER",
  );
});

test("the last three seconds count 3, 2, 1, and later games only count down", () => {
  assert.equal(FINAL_TICKS, 60);
  const title = (left: number) =>
    card({ round: 1, elapsed: 161 - left, left }).title;
  assert.deepEqual(
    [61, 60, 41, 40, 21, 20, 1].map((left) => title(left)),
    ["THREE WAYS TO WIN", "3", "3", "2", "2", "1", "1"],
  );
  assert.equal(title(0), "1", "never below 1");
  assert.equal(
    card(first(140)).wins.length,
    3,
    "the pictures stay for 3, 2, 1",
  );
  const later = card({ round: 2, elapsed: 0, left: 61 });
  assert.deepEqual(
    [later.title, later.first, later.wins.length, later.controls.length],
    ["GET READY", false, 0, 4],
  );
  assert.equal(card({ round: 3, elapsed: 30, left: 31 }).title, "2");
});

test("a watcher sees the wins and the countdown, but no controls", () => {
  const watching = card(first(60), -1);
  assert.deepEqual(
    [watching.team, watching.controls.length, watching.wins.length],
    [undefined, 0, 3],
  );
  assert.match(watching.subtitle, /WATCHING$/);
});

test("the touch button names what it does", () => {
  assert.equal(buttonLabel("worker"), "JUMP");
  assert.equal(buttonLabel("warrior"), "FLAP");
  assert.equal(buttonLabel("queen"), "FLAP");
  assert.equal(buttonLabel(undefined), "FLAP");
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

test("the card's key changes with what it shows and only then", () => {
  assert.equal(cardKey(card(first(33))), cardKey(card(first(34))));
  assert.notEqual(cardKey(card(first(31))), cardKey(card(first(32))));
  assert.notEqual(
    cardKey(card(first(10))),
    cardKey(countdownCard(first(10), 0, "touch", "Twin Hives")),
  );
});

test("no hint names up: flying is only ever the button", () => {
  const all = [
    ...Object.values(DEVICE_KEYS).flatMap((keys) => Object.values(keys)),
    ...Object.values(DEVICE_CONTROLS).flatMap((hints) =>
      hints.flatMap((hint) => [hint.keys, hint.action]),
    ),
    ...CONTROLS.flatMap((hint) => [hint.keys, hint.action]),
    ...[-1, 0, 2].flatMap((slot) =>
      (["keys", "pad", "touch"] as const).flatMap((device) =>
        texts(countdownCard(first(100), slot, device, "Twin Hives")),
      ),
    ),
  ];
  for (const text of all) assert.doesNotMatch(text, /↑|\bup\b|\bW\b/i, text);
});

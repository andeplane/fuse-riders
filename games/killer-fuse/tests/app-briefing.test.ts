import test from "node:test";
import assert from "node:assert/strict";
import { QUEEN_EGGS } from "../src/engine/index.js";
import {
  FINAL_TICKS,
  WIN_WAYS,
  buttonLabel,
  cardKey,
  countdownCard,
  deviceFor,
  controlRows,
  roleNote,
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
  shown.role,
  ...shown.wins.map((win) => win.caption),
  ...shown.controls.flatMap((row) => [
    row.action,
    ...row.keys,
    ...row.pad,
    ...row.touch,
    row.note,
  ]),
];

test("every seat sees all four controls as rows, its own role's first", () => {
  const queen = controlRows(0);
  assert.deepEqual(
    queen.map((row) => [row.action, row.mine]),
    [
      ["MOVE", true],
      ["JUMP / FLAP", true],
      ["DIVE", true],
      ["ATTACK", true],
    ],
  );
  assert.deepEqual(queen[0], {
    action: "MOVE",
    keys: ["←", "→", "A", "D"],
    pad: ["Stick", "D-pad"],
    touch: ["Left pad"],
    note: "",
    mine: true,
  });
  assert.deepEqual(
    [queen[1]!.keys, queen[1]!.pad, queen[1]!.touch, queen[1]!.note],
    [["Space"], ["A / Cross"], ["FLAP"], "tap to fly (~3/s holds height)"],
  );
  assert.deepEqual(
    [
      queen[2]!.keys,
      queen[2]!.note,
      queen[3]!.keys,
      queen[3]!.pad,
      queen[3]!.note,
    ],
    [
      ["↓", "S"],
      "Queen, hold",
      ["X", "Z", "Shift", "J"],
      ["B / Circle", "X / Square", "Bumpers", "Triggers"],
      "Warrior, Queen",
    ],
  );
  const worker = controlRows(5);
  assert.deepEqual(
    worker.map((row) => [row.action, row.mine]),
    [
      ["MOVE", true],
      ["JUMP / FLAP", true],
      ["DIVE", false],
      ["ATTACK", false],
    ],
    "a Worker's own rows first; dive and attack stay, dimmed",
  );
  assert.equal(worker[1]!.touch[0], "JUMP");
  assert.match(worker[1]!.note, /hold for higher · tap to fly as a Warrior/);
  assert.deepEqual(controlRows(-1), [], "a watcher has no keys");
  // The card names the caps of the device this page plays with: the gamepad's own once a pad is in use.
  assert.equal(
    countdownCard(first(10), 0, "touch", "Twin Hives").device,
    "touch",
  );
  assert.equal(countdownCard(first(10), 0, "pad", "Twin Hives").device, "pad");
  assert.equal(
    countdownCard(first(10), 0, "keys", "Twin Hives").device,
    "keys",
  );
});

test("the first game shows all three ways to win from its first frame, with the controls throughout", () => {
  assert.equal(card(first(0)).title, "THREE WAYS TO WIN", "no dark beat first");
  assert.deepEqual(
    WIN_WAYS.map((way) => way.kind),
    ["military", "economy", "snail"],
  );
  // Every frame of the countdown carries all three, identical: nothing arrives, nothing leaves.
  const ticks = [0, 1, 10, 31, 32, 45, 46, 59, 60, 100, 140, 160];
  for (const elapsed of ticks)
    assert.deepEqual(
      card(first(elapsed)).wins,
      WIN_WAYS,
      `tick ${elapsed} shows all three`,
    );
  for (const win of WIN_WAYS) {
    const words = win.caption.split(" ").length;
    assert.ok(words >= 3 && words <= 5, win.caption);
  }
  assert.match(WIN_WAYS[0]!.caption, new RegExp(`${QUEEN_EGGS}×`));
  for (const elapsed of ticks)
    assert.equal(card(first(elapsed)).controls.length, 4, "controls stay");
  const opening = card(first(10), 3);
  assert.equal(opening.first, true);
  assert.equal(opening.team, 1);
  assert.equal(
    opening.subtitle,
    "GAME 1 · TWIN HIVES · YOU ARE THE PINK WORKER",
  );
});

test("nothing on the card changes over a countdown except the 3, 2, 1", () => {
  for (const slot of [-1, 0, 3])
    for (const device of ["keys", "pad", "touch"] as const) {
      const frames = Array.from({ length: 162 }, (_, elapsed) =>
        countdownCard(first(elapsed), slot, device, "Twin Hives"),
      );
      const bodies = new Set(frames.map((frame) => cardKey(frame)));
      assert.equal(
        bodies.size,
        1,
        `slot ${slot} on ${device}: one body for the whole countdown`,
      );
      const titles = [...new Set(frames.map((frame) => frame.title))];
      assert.deepEqual(
        titles,
        ["THREE WAYS TO WIN", "3", "2", "1"],
        "the title is the only thing that moves, and only forwards",
      );
    }
});

test("a Queen is told she cannot carry berries or ride the snail", () => {
  const queen = card(first(0), 0);
  assert.equal(queen.role, roleNote(0));
  assert.match(queen.role, /Queens cannot carry berries or ride the snail/);
  assert.match(queen.role, /play a Worker to carry berries and ride the snail/);
  assert.equal(roleNote(1), roleNote(0), "both Queens");
  // A Worker keeps its own lines and gets no extra one; a watcher plays nothing.
  assert.equal(card(first(0), 2).role, "");
  assert.equal(card(first(0), 5).role, "");
  assert.equal(card(first(0), -1).role, "");
  assert.equal(roleNote(-1), "");
  // Later games count down only, so the line goes with the rest of the briefing.
  assert.equal(card({ round: 2, elapsed: 0, left: 61 }, 0).role, "");
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
  assert.equal(card(first(140)).wins.length, card(first(0)).wins.length);
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

test("the card's key changes with its body and never with the title", () => {
  // The 3, 2, 1 is outside the key on purpose: rebuilding the pictures under it is what made them flash.
  assert.equal(cardKey(card(first(33))), cardKey(card(first(34))));
  assert.equal(cardKey(card(first(31))), cardKey(card(first(32))));
  assert.equal(cardKey(card(first(100))), cardKey(card(first(160))));
  assert.notEqual(
    cardKey(card(first(10))),
    cardKey(countdownCard(first(10), 0, "touch", "Twin Hives")),
  );
  assert.notEqual(
    cardKey(card(first(10), 0)),
    cardKey(card(first(10), 2)),
    "a Queen's role line is part of the body",
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

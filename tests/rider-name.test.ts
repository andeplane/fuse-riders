import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LOGGED_NAME_UNITS,
  MAX_RIDER_NAME,
  loggedRiderName,
  seatRiderName,
  suggestRiderName,
  trimmedRiderName,
  validRiderName,
} from "../src/engine/rider-name.js";
import { parseClientMessage } from "../src/shared/protocol.js";
import { BOT, JOIN, isEntry } from "../src/engine/input-log.js";
import {
  applyTick,
  createRoomState,
  type StreamEntries,
} from "../src/engine/apply-tick.js";
import { BotController } from "../src/engine/bot-controller.js";
import {
  decodeGameState,
  encodeGameState,
} from "../src/engine/codec/checkpoint.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";

const FOX = String.fromCodePoint(0x1f98a);
const HIGH = String.fromCharCode(0xd83e); // the first half of FOX
const LOW = String.fromCharCode(0xdd8a);
const ZWJ = String.fromCharCode(0x200d);
/** Man, woman, girl, boy joined: seven code points, eleven UTF-16 units, one picture. */
const FAMILY = [0x1f468, 0x1f469, 0x1f467, 0x1f466]
  .map((point) => String.fromCodePoint(point))
  .join(ZWJ);
const BELL = String.fromCharCode(7);
const TAB = String.fromCharCode(9);

test("one rule for a rider name wherever it is stored", () => {
  for (const good of [
    "A",
    "Anders",
    "x".repeat(MAX_RIDER_NAME),
    "two words",
    "🦊".repeat(MAX_RIDER_NAME),
  ])
    assert.equal(validRiderName(good), true, good);
  const bad: unknown[] = [
    "",
    " ",
    " pad",
    "pad ",
    "x".repeat(MAX_RIDER_NAME + 1),
    `a${String.fromCharCode(7)}b`,
    `tab${String.fromCharCode(9)}`,
    `a${String.fromCharCode(0xd800)}`,
    7,
    null,
    undefined,
    ["a"],
  ];
  for (const value of bad)
    assert.equal(validRiderName(value), false, JSON.stringify(value));
});

test("a first username is the first word of a display name that fits, and always valid or empty", () => {
  assert.equal(suggestRiderName("Anders Hafreager"), "Anders");
  assert.equal(suggestRiderName("  Madonna  "), "Madonna");
  assert.equal(
    suggestRiderName("Wolfeschlegelsteinhausenbergerdorff Jr"),
    "Wolfeschlegelstein",
  );
  assert.equal(
    suggestRiderName(`Bell${String.fromCharCode(7)}a Rossi`),
    "Bella",
  );
  assert.equal(suggestRiderName(""), "");
  assert.equal(suggestRiderName("Signed in"), "Signed");
  for (const text of [
    "Anders Hafreager",
    "Wolfeschlegelsteinhausenbergerdorff",
    "🦊🦊 fox",
  ])
    assert.equal(validRiderName(suggestRiderName(text)), true, text);
});

test("the seat normaliser: whatever comes in, what is seated is a valid rider name the log accepts", () => {
  const cases: [raw: string, seated: string | undefined, why: string][] = [
    ["Anders", "Anders", "a good name is left alone"],
    ["  Anders  ", "Anders", "trimmed"],
    ["x".repeat(18), "x".repeat(18), "18 letters fit"],
    ["x".repeat(19), "x".repeat(18), "19 letters are cut to 18"],
    ["x".repeat(20), "x".repeat(18), "20 letters are cut to 18"],
    ["x".repeat(21), "x".repeat(18), "21 letters are cut to 18"],
    [
      "x".repeat(17) + " y",
      "x".repeat(17),
      "a cut that ends on a space is trimmed again",
    ],
    [
      FOX.repeat(10),
      FOX.repeat(10),
      "ten emoji are 20 units: the log's bound exactly",
    ],
    [
      FOX.repeat(11),
      FOX.repeat(10),
      "the eleventh would be 22 units; the pair is dropped whole",
    ],
    [
      "x" + FOX.repeat(10),
      "x" + FOX.repeat(9),
      "19 units hold no further pair: not half of one",
    ],
    [
      FOX.repeat(18),
      FOX.repeat(10),
      "a valid 18-emoji account name is seated as the ten that fit the log",
    ],
    [FAMILY, FAMILY, "a joined sequence that fits is kept whole"],
    [
      FAMILY + FAMILY,
      FAMILY + Array.from(FAMILY).slice(0, 5).join(""),
      "cut by code point inside the second family: parent, parent, child, and no dangling joiner",
    ],
    ["ab" + HIGH, "ab", "half a pair at the end is dropped"],
    [LOW + "ab" + HIGH + "cd", "abcd", "half pairs anywhere are dropped"],
    [HIGH, undefined, "nothing but half a pair is no name"],
    ["", undefined, "empty"],
    ["   ", undefined, "blank"],
    [
      "a" + BELL + "b",
      undefined,
      "a control character inside refuses the name",
    ],
    ["a" + TAB + "b", undefined, "a tab inside refuses the name"],
    [
      TAB + "ab" + TAB,
      "ab",
      "whitespace controls around it are padding, as trim has always had it",
    ],
  ];
  for (const [raw, seated, why] of cases) {
    const name = seatRiderName(raw);
    assert.equal(name, seated, why);
    if (name !== undefined) {
      assert.equal(validRiderName(name), true, `${why}: valid`);
      assert.equal(loggedRiderName(name), true, `${why}: fits the log`);
      assert.equal(seatRiderName(name), name, `${why}: idempotent`);
    }
  }
  // A cut through the middle of a joined sequence must not leave the joiner behind.
  const cut = seatRiderName("x".repeat(15) + FAMILY)!;
  assert.equal(cut.endsWith(ZWJ), false);
  assert.equal(validRiderName(cut) && loggedRiderName(cut), true);
});

test("seeded: every seated name is valid, fits the log, and is a prefix of the cleaned input", () => {
  let a = 20260917;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
  const alphabet = ["a", "Z", " ", "é", FOX, FAMILY, ZWJ, HIGH, LOW, "中"];
  let seated = 0;
  for (let round = 0; round < 3000; round++) {
    const raw = Array.from(
      { length: Math.floor(random() * 26) },
      () => alphabet[Math.floor(random() * alphabet.length)]!,
    ).join("");
    const name = seatRiderName(raw);
    if (name === undefined) continue;
    seated++;
    assert.equal(validRiderName(name), true, JSON.stringify(raw));
    assert.equal(loggedRiderName(name), true, JSON.stringify(raw));
    const cleaned = Array.from(raw)
      .filter((point) => point !== HIGH && point !== LOW)
      .join("")
      .trim();
    assert.equal(cleaned.startsWith(name), true, JSON.stringify(raw));
  }
  assert.ok(seated > 2000);
});

test("the log's bound is the rule it has always had, and admits every seated name", () => {
  const accepted = ["A", " pad ", "x".repeat(20), FOX.repeat(10), "ab" + HIGH];
  const refused: unknown[] = [
    "",
    "   ",
    "x".repeat(21),
    FOX.repeat(10) + "x",
    "a" + BELL,
    "a" + String.fromCharCode(0x7f),
    7,
    undefined,
  ];
  for (const name of accepted) {
    assert.equal(loggedRiderName(name), true, JSON.stringify(name));
    assert.equal(isEntry([1, 1, JOIN, "m", name, 0, "fox", 0]), true);
    assert.equal(isEntry([1, 1, BOT, "add", "bot:1", name, 0]), true);
  }
  for (const name of refused) {
    assert.equal(loggedRiderName(name), false, JSON.stringify(name));
    assert.equal(isEntry([1, 1, JOIN, "m", name, 0, "fox", 0]), false);
    assert.equal(isEntry([1, 1, BOT, "add", "bot:1", name, 0]), false);
  }
  assert.equal(MAX_LOGGED_NAME_UNITS, 20);
});

test("a logged name folds to the same stored name as before: trimmed for a rider, as written for a bot, and the checkpoint carries both", () => {
  const room = createRoomState("names", defaultRoomSettings());
  const stream: StreamEntries = {
    generation: 0,
    entries: [
      [1, 1, JOIN, "host", "  " + "x".repeat(16) + "  ", 0, "fox", 0],
      [2, 1, JOIN, "guest", "ab" + HIGH, 1, "fox", 0],
      [3, 1, BOT, "add", "bot:1", " Ada ", 2],
    ],
  };
  applyTick(room, "host", new Map([["host", stream]]), new BotController());
  const names = (game: typeof room.game) =>
    [...game.players.values()].map((player) => player.name);
  assert.deepEqual(names(room.game), ["x".repeat(16), "ab" + HIGH, " Ada "]);
  const restored = decodeGameState(encodeGameState(room.game));
  assert.ok(
    restored,
    "a state an older manager could have produced still loads",
  );
  assert.deepEqual(names(restored), names(room.game));
  room.game.players.get("host")!.name = "a" + BELL;
  assert.equal(
    decodeGameState(encodeGameState(room.game)),
    undefined,
    "a control character never came through the log, so a checkpoint carrying one is refused",
  );
});

test("a join message carries a valid rider name or is refused; it is not repaired", () => {
  const join = (name: unknown) =>
    parseClientMessage(JSON.stringify({ type: "join", name }));
  assert.deepEqual(join(" Anders "), { type: "join", name: "Anders" });
  assert.deepEqual(join(FOX.repeat(18)), {
    type: "join",
    name: FOX.repeat(18),
  });
  assert.equal(trimmedRiderName(" two words "), "two words");
  for (const bad of ["", "  ", "x".repeat(19), "a" + BELL, "ab" + TAB, 7])
    assert.equal(join(bad), null, JSON.stringify(bad));
  assert.equal(trimmedRiderName("ab" + HIGH), undefined, "half a pair");
});

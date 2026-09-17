import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_RIDER_NAME,
  suggestRiderName,
  validRiderName,
} from "../src/shared/rider-name.js";

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

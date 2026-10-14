import test from "node:test";
import assert from "node:assert/strict";
import {
  validAccountName,
  suggestAccountName,
} from "../packages/fuse-ui/src/account-name.js";
import {
  validRiderName,
  suggestRiderName,
} from "../games/fuse-riders/src/engine/rider-name.js";
test("shared username UI agrees with existing engine and backend name rules", () => {
  for (const name of [
    "Ada",
    "",
    " Ada",
    "x".repeat(18),
    "x".repeat(19),
    "🦊".repeat(18),
    "a\n",
    "\ud800",
    "<b>Ada</b>",
  ]) {
    assert.equal(validAccountName(name), validRiderName(name), name);
    assert.equal(suggestAccountName(name), suggestRiderName(name), name);
  }
});

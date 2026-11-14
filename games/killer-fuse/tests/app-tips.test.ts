import test from "node:test";
import assert from "node:assert/strict";
import { DEVICE_CONTROLS } from "../src/app/guide.js";
import { RULE_TIPS, TIP_MS, lobbyTips, tipIndex } from "../src/app/tips.js";

test("the first tip is the controls of the device in use, then one rule each", () => {
  const tips = lobbyTips("pad");
  assert.equal(tips[0]!.title, "CONTROLS · GAMEPAD");
  assert.equal(tips[0]!.hints, DEVICE_CONTROLS.pad);
  assert.equal(lobbyTips("touch")[0]!.hints, DEVICE_CONTROLS.touch);
  assert.deepEqual(tips.slice(1), RULE_TIPS);
  const titles = RULE_TIPS.map((tip) => tip.title);
  for (const wanted of [
    "QUEEN: CLAIM THE GATES",
    "JUMP HIGHER",
    "ONLY THE QUEEN DIVES",
    "GATES TAKE A BERRY",
    "THE SWORD",
    "THE SNAIL EATS WORKERS",
    "THREE WAYS TO WIN",
  ])
    assert.ok(titles.includes(wanted), wanted);
  for (const tip of RULE_TIPS) {
    assert.ok(tip.text.length > 0, tip.title);
    assert.doesNotMatch(tip.text, /higher one wins|on contact|regrow/i);
  }
});

test("a new tip every 15 s, round and round", () => {
  assert.equal(TIP_MS, 15_000);
  assert.deepEqual(
    [0, 14_999, 15_000, 29_999, 30_000, 8 * 15_000].map((ms) =>
      tipIndex(ms, 8),
    ),
    [0, 0, 1, 1, 2, 0],
  );
  assert.equal(
    tipIndex(-5, 8),
    0,
    "a clock that steps back stays on the first",
  );
  assert.equal(tipIndex(99_999, 0), 0, "no tips is tip 0");
});

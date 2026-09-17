import test from "node:test";
import assert from "node:assert/strict";
import { validateGoldenUpdate } from "../scripts/lib/golden-update.js";

const previous = { rules: "rules-1", hashes: ["a", "b"] };
test("golden refresh refuses hash or recording drift without a rules bump", () => {
  for (const hashes of [["a", "changed"], ["a"], ["a", "b", "c"]]) {
    assert.throws(
      () => validateGoldenUpdate(previous, { rules: previous.rules, hashes }),
      /unchanged RULES/,
    );
  }
  assert.throws(
    () => validateGoldenUpdate(previous, previous, true),
    /unchanged RULES/,
  );
  assert.deepEqual(
    previous,
    { rules: "rules-1", hashes: ["a", "b"] },
    "validation does not mutate existing evidence",
  );
});

test("golden refresh allows identical no-ops and intentional versioned updates", () => {
  assert.doesNotThrow(() =>
    validateGoldenUpdate(previous, {
      ...previous,
      hashes: [...previous.hashes],
    }),
  );
  assert.doesNotThrow(() =>
    validateGoldenUpdate(
      previous,
      { rules: "rules-2", hashes: ["different"] },
      true,
    ),
  );
});

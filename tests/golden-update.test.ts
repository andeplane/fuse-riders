import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GoldenRefusal,
  goldenFailure,
  RECORD_COMMAND,
  RULES_FILE,
  validateGoldenCoverage,
  validateGoldenUpdate,
} from "../scripts/lib/golden-update.js";

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

test("golden refresh refuses to pin a replay that lost coverage, and says to record instead", () => {
  const bumped = { rules: "rules-2", hashes: ["different"] };
  // The plain updater under a rules bump: the stored inputs drifted away from what the golden test asserts.
  assert.throws(
    () => validateGoldenCoverage(previous, bumped, ["pickups", "gun:scenery"]),
    (error: unknown) =>
      error instanceof GoldenRefusal &&
      error.message.includes("rules-2") &&
      error.message.includes("was rules-1") &&
      error.message.includes(
        "2 coverage requirements (pickups, gun:scenery)",
      ) &&
      error.message.includes(`Run \`${RECORD_COMMAND}\` instead`) &&
      error.message.includes("Nothing was written") &&
      !error.message.includes("\n"),
  );
  // Unchanged rules and unchanged hashes, and still a claim unmet: the requirements grew past the recording.
  assert.throws(
    () => validateGoldenCoverage(previous, previous, ["portal"]),
    (error: unknown) =>
      error instanceof GoldenRefusal &&
      /1 coverage requirement \(portal\) under unchanged RULES \(rules-1\)/.test(
        error.message,
      ) &&
      error.message.includes(RECORD_COMMAND),
  );
  // A fresh recording that still falls short is not told to record again.
  assert.throws(
    () => validateGoldenCoverage(previous, bumped, ["five-riders"], true),
    (error: unknown) =>
      error instanceof GoldenRefusal &&
      error.message.includes("the fresh recording does not reach") &&
      error.message.includes("replay-recorder.ts") &&
      !error.message.includes("instead"),
  );
  for (const recorded of [false, true])
    assert.doesNotThrow(() =>
      validateGoldenCoverage(previous, bumped, [], recorded),
    );
  // The older refusals still come first and are refusals too.
  assert.throws(
    () => validateGoldenUpdate(previous, { rules: "rules-1", hashes: ["x"] }),
    GoldenRefusal,
  );
});

test("a golden failure says which case it is, where it starts and what to run", () => {
  assert.equal(goldenFailure("rules-1", "rules-1", 0, 2, 2), undefined);

  const unbumped = goldenFailure("rules-1", "rules-1", 7, 20, 20)!;
  assert.match(
    unbumped,
    /behaviour changed and RULES did not \(still rules-1\)/,
  );
  assert.match(unbumped, /First diverging tick: 7 of 20\./);
  assert.ok(unbumped.includes(`INTENDED: bump RULES in ${RULES_FILE}`));
  assert.ok(unbumped.includes(RECORD_COMMAND));
  assert.match(
    unbumped,
    /NOT intended[^]*regression[^]*Do not refresh the golden/,
  );
  assert.match(unbumped, /tick 7 and fix it/);

  const stale = goldenFailure("rules-2", "rules-1", 7, 20, 20)!;
  assert.match(
    stale,
    /RULES is rules-2 but the golden still pins rules-1: RULES was bumped and the golden was not refreshed/,
  );
  assert.match(stale, /First diverging tick: 7 of 20\./);
  assert.ok(stale.includes(RECORD_COMMAND));
  assert.match(stale, /merged main and both sides bumped RULES/);
  assert.doesNotMatch(stale, /regression/);

  const unnoticed = goldenFailure("rules-2", "rules-1", 0, 20, 20)!;
  assert.match(unnoticed, /still hashes the same under the new rules/);
  assert.ok(unnoticed.includes(RECORD_COMMAND));

  const outOfStep = goldenFailure("rules-1", "rules-1", 0, 21, 20)!;
  assert.match(outOfStep, /runs 21 ticks and the golden pins 20/);
  assert.match(outOfStep, /Restore both from main/);
  assert.match(
    goldenFailure("rules-2", "rules-1", 0, 21, 20)!,
    /runs 21 ticks and the golden pins 20/,
  );
  for (const message of [unbumped, stale, unnoticed, outOfStep])
    assert.match(message, /engine-safety-net\.md, 'When the golden fails'/);
});

test("the file the golden guidance sends a developer to declares RULES, and the docs name the same file", () => {
  const read = (path: string): string =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  assert.match(read(RULES_FILE), /^export const RULES = "/m);
  for (const doc of ["AGENTS.md", "docs/design/engine-safety-net.md"])
    assert.ok(read(doc).includes(`\`${RULES_FILE}\``), `${doc} names it`);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RULES } from "../src/engine/apply-tick.js";
import { isEntry } from "../src/engine/input-log.js";
import { goldenFailure } from "../../../scripts/lib/golden-update.js";
import { replayGolden } from "./fixtures/golden-replay.js";
import type { Recording } from "./fixtures/replay-log.js";

test("the input-only mechanic recording keeps every tick on the pinned rules", () => {
  const recording: Recording = JSON.parse(
    readFileSync(
      new URL("./fixtures/mechanics-recording.json", import.meta.url),
      "utf8",
    ),
  );
  const golden: { rules: string; hashes: string[] } = JSON.parse(
    readFileSync(
      new URL("./fixtures/golden-hashes.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(
    Object.keys(recording).sort(),
    ["creator", "entries", "matchId", "ticks"],
    "the fixture is a log of inputs and nothing else",
  );
  for (const entries of Object.values(recording.entries))
    for (const entry of entries)
      assert.ok(isEntry(entry), "fixture contains only valid wire entries");
  const { hashes, claims } = replayGolden(recording);

  // The rules and the hashes come first: they are what an engine change breaks, and their message says what to do
  // about it. A changed engine also plays the stored inputs into different rounds, so the coverage below fails with
  // it, and said nothing useful while it was asserted first.
  const mismatch = hashes.findIndex(
    (hash, index) => hash !== golden.hashes[index],
  );
  const failure = goldenFailure(
    RULES,
    golden.rules,
    mismatch + 1,
    hashes.length,
    golden.hashes.length,
  );
  assert.equal(RULES, golden.rules, failure);
  assert.equal(mismatch, -1, failure);
  assert.equal(hashes.length, golden.hashes.length, failure);

  // Every tick matches, so the engine is the one the golden was pinned with: what can still be wrong is the
  // recording itself, re-recorded or edited into something that no longer exercises what it is there to exercise.
  for (const { key, claim, ok, detail } of claims)
    assert.ok(
      ok,
      [
        `The hashes match, but the recording no longer reaches requirement ${key}: ${claim}.`,
        ...(detail ? [`  Seen instead: ${detail}`] : []),
        `  The fixtures were refreshed with a workload that lost coverage. The requirements are in`,
        `  games/fuse-riders/tests/fixtures/replay-coverage.ts (REQUIREMENTS) and games/fuse-riders/tests/fixtures/golden-replay.ts; restore both fixtures`,
        `  from main, or see docs/design/engine-safety-net.md, 'When the golden fails', for a recorder that cannot reach one.`,
      ].join("\n"),
    );
});

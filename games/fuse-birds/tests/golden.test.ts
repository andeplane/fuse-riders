import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { replayFixture } from "../../../scripts/lib/fuse-birds-replay.js";

test("versioned two-, three- and five-player matches preserve their outcome and destruction hashes", () => {
  const fixtures: { seed: number; count: number }[] = JSON.parse(
    readFileSync(new URL("./fixtures/golden.json", import.meta.url), "utf8"),
  );
  const actual = fixtures.map(({ seed, count }) => {
    const { hashes: _hashes, ...result } = replayFixture(seed, count);
    return result;
  });
  assert.deepEqual(
    actual,
    fixtures,
    "Investigate a changed replay; only an intended rules change may replace the golden.",
  );
});

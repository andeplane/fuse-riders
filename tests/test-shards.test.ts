import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  mergeTimings,
  parseShard,
  partition,
  readTimings,
  testFiles,
  SUITE_ONLY,
  gateFiles,
} from "../scripts/lib/test-shards.js";

const files = testFiles();
const timings = readTimings("scripts/test-timings.json");

test("pnpm test runs the shard-aware runner over the suite's three globs", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(pkg.scripts.test, "tsx scripts/run-tests.ts");
  assert.ok(files.includes("tests/test-shards.test.ts"));
  for (const file of files)
    assert.match(
      file,
      /^(tests|(packages|games)\/[^/]+\/tests)\/[^/]+\.test\.ts$/,
    );
  assert.equal(new Set(files).size, files.length);
});

test("every shard count puts every test file in exactly one shard", () => {
  for (let total = 1; total <= 12; total++) {
    const shards = partition(files, timings, total);
    assert.equal(shards.length, total);
    assert.deepEqual(
      shards.flat().sort(),
      [...files].sort(),
      `${total} shards`,
    );
  }
});

test("a new or unmeasured file still runs, and stale timings are ignored", () => {
  const listed = ["a.test.ts", "b.test.ts", "new.test.ts"];
  const shards = partition(listed, { "a.test.ts": 9, "gone.test.ts": 50 }, 2);
  assert.deepEqual(shards.flat().sort(), listed);
  // No timings at all is the round-robin-like even split, not an empty shard.
  assert.deepEqual(
    partition(["a", "b", "c", "d"], {}, 2).map((shard) => shard.length),
    [2, 2],
  );
});

test("the heaviest files are spread out, so the slowest shard is near the even share", () => {
  const costs = { a: 40, b: 30, c: 20, d: 10, e: 10, f: 10, g: 5, h: 5 };
  const shards = partition(Object.keys(costs), costs, 3);
  const loads = shards.map((shard) =>
    shard.reduce((sum, file) => sum + costs[file as keyof typeof costs], 0),
  );
  assert.deepEqual(loads, [45, 45, 40]);
  // Deterministic: every shard of a run computes the same split.
  assert.deepEqual(partition(Object.keys(costs).reverse(), costs, 3), shards);
});

test("TEST_SHARD is i/n with i within 1..n, and empty means the whole suite", () => {
  assert.equal(parseShard(undefined), undefined);
  assert.equal(parseShard(""), undefined);
  assert.deepEqual(parseShard("3/6"), { index: 3, total: 6 });
  for (const bad of ["0/6", "7/6", "1/0", "a/b", "2", "1/2/3"])
    assert.throws(() => parseShard(bad), /TEST_SHARD/, bad);
});

test("merged timings are the mean of every measurement, rounded and sorted", () => {
  assert.deepEqual(
    Object.entries(mergeTimings([{ b: 1, a: 2 }, { a: 3.14159 }, { a: 4 }])),
    [
      ["a", 3],
      ["b", 1],
    ],
  );
});

test("the gate leaves out only the listed suite-only files, and each of them is a real test file", () => {
  const files = testFiles();
  assert.ok(SUITE_ONLY.length > 0);
  for (const file of SUITE_ONLY)
    assert.ok(files.includes(file), `${file} is not a unit test file`);
  assert.deepEqual(gateFiles(files, false), files);
  assert.deepEqual(
    gateFiles(files, true),
    files.filter((file) => !SUITE_ONLY.includes(file)),
  );
  // The gate sets TEST_GATE; the release jobs' runs (the weekly suite, a dispatch, `full-ci`) do not.
  assert.ok(
    readFileSync(".github/workflows/ci.yml", "utf8").includes(
      "      TEST_GATE: ${{ (inputs.release || github.event_name == 'workflow_dispatch' || contains(github.event.pull_request.labels.*.name, 'full-ci')) && '0' || '1' }}\n",
    ),
  );
});

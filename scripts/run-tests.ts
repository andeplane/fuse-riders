/**
 * `pnpm test`: the unit suite through `tsx --test`, the whole of it unless TEST_SHARD=i/n picks one cost-balanced
 * shard (scripts/lib/test-shards.ts). Extra arguments go to `node --test` (`pnpm test --test-name-pattern=x`).
 *
 *   TEST_TIMINGS_OUT=<file>                                   also write seconds per file there (CI's unit shards)
 *   pnpm exec tsx scripts/run-tests.ts --merge-timings <dir>  fold such files into scripts/test-timings.json
 */
import { spawn } from "node:child_process";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mergeTimings,
  parseShard,
  partition,
  readTimings,
  testFiles,
} from "./lib/test-shards.js";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const TIMINGS = "scripts/test-timings.json";
const args = process.argv.slice(2);

if (args[0] === "--merge-timings") {
  const dir = args[1];
  if (!dir) throw new Error("--merge-timings needs a directory");
  const found: string[] = [];
  const walk = (path: string) => {
    for (const name of readdirSync(path).sort()) {
      const child = join(path, name);
      if (statSync(child).isDirectory()) walk(child);
      else if (name.endsWith(".json")) found.push(child);
    }
  };
  walk(dir);
  const merged = mergeTimings([
    readTimings(TIMINGS),
    ...found.map(readTimings),
  ]);
  // Only files that still exist, so a deleted test does not linger in the table.
  const live = new Set(testFiles());
  const kept = Object.fromEntries(
    Object.entries(merged).filter(([file]) => live.has(file)),
  );
  writeFileSync(TIMINGS, `${JSON.stringify(kept, null, 2)}\n`);
  console.log(
    `${TIMINGS}: ${Object.keys(kept).length} files from ${found.length} timing files`,
  );
  process.exit(0);
}

const all = testFiles();
const shard = parseShard(process.env.TEST_SHARD);
let files = all;
if (shard) {
  const timings = readTimings(TIMINGS);
  files = partition(all, timings, shard.total)[shard.index - 1]!;
  const estimate = files.reduce((sum, file) => sum + (timings[file] ?? 0), 0);
  console.log(
    `shard ${shard.index}/${shard.total}: ${files.length} of ${all.length} files, ${Math.round(estimate)} s of measured test time`,
  );
}
// `node --test` with no files falls back to its own default globs, which is not this suite.
if (files.length === 0) {
  console.log("No test files in this shard.");
  process.exit(0);
}

const out = process.env.TEST_TIMINGS_OUT;
const reporters = out
  ? [
      "--test-reporter=tap",
      "--test-reporter-destination=stdout",
      "--test-reporter=./scripts/lib/test-timing-reporter.ts",
      `--test-reporter-destination=${out}`,
    ]
  : [];
const child = spawn("tsx", ["--test", ...reporters, ...args, ...files], {
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => child.kill(signal));
child.once("error", (error) => {
  console.error(error);
  process.exit(1);
});
child.once("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));

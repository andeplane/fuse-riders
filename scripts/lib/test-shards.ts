import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Which unit test files `pnpm test` runs, and how CI's `unit` shards split them.
 *
 * `node --test --test-shard` splits files round-robin by index, so one shard could draw three heavy replay
 * files while another drew only quick ones: on one pull request the eight shards took 12 s to 95 s. Here a
 * shard is chosen by measured cost instead (scripts/test-timings.json, refreshed with
 * `pnpm exec tsx scripts/run-tests.ts --merge-timings <dir>` from the timing files the CI shards upload), so the
 * shards finish together. A file with no measurement counts as the median, so a new test file still lands in
 * exactly one shard; a stale timing file only costs balance, never coverage.
 */

/** The globs `pnpm test` has always run: `tests/*.test.ts`, `packages/*\/tests/*.test.ts`, `games/*\/tests/*.test.ts`. */
export function testFiles(root = "."): string[] {
  const files: string[] = [];
  const tests = (dir: string) => {
    if (!existsSync(join(root, dir))) return;
    for (const name of readdirSync(join(root, dir)).sort())
      if (name.endsWith(".test.ts")) files.push(`${dir}/${name}`);
  };
  tests("tests");
  for (const parent of ["packages", "games"]) {
    if (!existsSync(join(root, parent))) continue;
    for (const entry of readdirSync(join(root, parent), {
      withFileTypes: true,
    }).sort((a, b) => a.name.localeCompare(b.name)))
      if (entry.isDirectory()) tests(`${parent}/${entry.name}/tests`);
  }
  return files;
}

/** `TEST_SHARD=i/n` as node's `--test-shard` reads it; undefined when unset. */
export function parseShard(
  value: string | undefined,
): { index: number; total: number } | undefined {
  if (value === undefined || value === "") return undefined;
  const match = /^(\d+)\/(\d+)$/.exec(value);
  const index = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (!match || total < 1 || index < 1 || index > total)
    throw new Error(`TEST_SHARD must be i/n with 1 <= i <= n, not '${value}'`);
  return { index, total };
}

/** Seconds per file; anything that is not a finite non-negative number is ignored. */
export type Timings = Record<string, number>;

export function readTimings(path: string): Timings {
  if (!existsSync(path)) return {};
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  const timings: Timings = {};
  if (value && typeof value === "object")
    for (const [file, seconds] of Object.entries(value))
      if (
        typeof seconds === "number" &&
        Number.isFinite(seconds) &&
        seconds >= 0
      )
        timings[file] = seconds;
  return timings;
}

/**
 * Longest-processing-time assignment: heaviest file first, each to the least-loaded shard (lowest index on a
 * tie). Deterministic in the file list and timings alone, so every shard computes the same partition, and every
 * file lands in exactly one shard.
 */
export function partition(
  files: readonly string[],
  timings: Timings,
  total: number,
): string[][] {
  const known = files
    .map((file) => timings[file])
    .filter((seconds): seconds is number => seconds !== undefined)
    .sort((a, b) => a - b);
  const fallback = known.length ? known[Math.floor(known.length / 2)]! : 1;
  const cost = (file: string) => timings[file] ?? fallback;
  const order = [...files].sort(
    (a, b) => cost(b) - cost(a) || (a < b ? -1 : a > b ? 1 : 0),
  );
  const shards = Array.from({ length: total }, () => ({
    load: 0,
    files: [] as string[],
  }));
  for (const file of order) {
    let target = shards[0]!;
    for (const shard of shards) if (shard.load < target.load) target = shard;
    target.files.push(file);
    target.load += cost(file);
  }
  return shards.map((shard) => shard.files.sort());
}

/**
 * Timing files folded into one, rounded to 0.1 s: each file's seconds are the mean of every measurement of it.
 * One measurement is noisy (a file's wall time depends on what shares its runner: the same file took 32 s on one
 * run and 59 s on the next), so the table passed in first, the committed one, counts as one more sample.
 */
export function mergeTimings(parts: readonly Timings[]): Timings {
  const samples = new Map<string, number[]>();
  for (const part of parts)
    for (const [file, seconds] of Object.entries(part))
      samples.set(file, [...(samples.get(file) ?? []), seconds]);
  const merged: Timings = {};
  for (const [file, values] of samples)
    merged[file] =
      Math.round(
        (values.reduce((sum, value) => sum + value, 0) / values.length) * 10,
      ) / 10;
  return Object.fromEntries(
    Object.entries(merged).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

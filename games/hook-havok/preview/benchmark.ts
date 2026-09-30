import { performance } from "node:perf_hooks";
import { cpus, platform, release } from "node:os";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { traverse, TRAVERSAL } from "../tests/fixtures/traversal.js";
const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
for (let i = 0; i < 100; i++) traverse();
const timings: number[] = [];
let checksum = 0;
for (let i = 0; i < 1000; i++) {
  const start = performance.now(),
    world = traverse();
  timings.push(performance.now() - start);
  checksum += world.tick + world.deaths + world.x;
}
timings.sort((a, b) => a - b);
const report = {
  command:
    "node node_modules/tsx/dist/cli.mjs games/hook-havok/preview/benchmark.ts",
  fixtureSha256: createHash("sha256")
    .update(
      readFileSync(new URL("../tests/fixtures/traversal.ts", import.meta.url)),
    )
    .digest("hex"),
  harnessSha256: createHash("sha256")
    .update(readFileSync(new URL("./benchmark.ts", import.meta.url)))
    .digest("hex"),
  revision: execFileSync(
    "git",
    [
      "-c",
      `safe.directory=${process.cwd().replaceAll("\\", "/")}`,
      "rev-parse",
      "HEAD",
    ],
    { encoding: "utf8" },
  ).trim(),
  node: process.version,
  os: `${platform()} ${release()}`,
  cpu: cpus()[0]?.model,
  logicalCpus: cpus().length,
  workload:
    "TRAVERSAL v1: fixed ordinary inputs; default tuning; no random seed",
  physicsTicksPerRun: TRAVERSAL.reduce((n, s) => n + s.ticks, 0),
  warmupRuns: 100,
  measuredRuns: 1000,
  totalMs: timings.reduce((a, b) => a + b, 0),
  medianTraversalMs: percentile(timings, 0.5),
  p95TraversalMs: percentile(timings, 0.95),
  checksum,
  limits:
    "Headless engine only, excluding renderer, networking, audio, checkpoint validation and test assertions. Not a device/frame-rate guarantee.",
};
mkdirSync("artifacts", { recursive: true });
writeFileSync(
  "artifacts/hook-havok-phase5-benchmark.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { BOTH_ENGINES, launchBrowser } from "./lib/browser.js";
import { GOLDEN_SEED } from "../games/fuse-riders/tests/fixtures/golden-replay.ts";
import {
  replayHashes,
  type Recording,
} from "../games/fuse-riders/tests/fixtures/replay-log.ts";
import { makeRecording } from "../games/fuse-riders/tests/fixtures/replay-recorder.ts";

// Phase 0 gate: the same seeded five-rider log folds to the same state hash on every tick in Node, Chromium and WebKit.
// By default that log is the pinned golden recording, read from its fixture, and the seed is only reported: it is
// the one that recording was played with. REPLAY_SEED or REPLAY_TICKS plays a fresh uncovered log instead.
const seed = Number(process.env.REPLAY_SEED ?? GOLDEN_SEED);
const started = performance.now();
const custom =
  process.env.REPLAY_TICKS !== undefined ||
  process.env.REPLAY_SEED !== undefined;
const recording: Recording = custom
  ? makeRecording(seed, Number(process.env.REPLAY_TICKS ?? 3000))
  : JSON.parse(
      await readFile(
        new URL(
          "../games/fuse-riders/tests/fixtures/mechanics-recording.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
const ticks = recording.ticks;
const node = replayHashes(recording);
console.log(
  `node: ${ticks} ticks, ${Object.values(recording.entries).reduce((sum, list) => sum + list.length, 0)} entries, ${Math.round(performance.now() - started)} ms`,
);
const bundle = await build({
  stdin: {
    contents: `import { replayHashes } from './games/fuse-riders/tests/fixtures/replay-log.ts'; globalThis.replayHashes = replayHashes;`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2022",
});
const results: Record<
  string,
  { ticks: number; ms: number; firstMismatch?: number }
> = { node: { ticks, ms: Math.round(performance.now() - started) } };
for (const { kind: name } of BOTH_ENGINES) {
  const browser = await launchBrowser(name, { headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><title>Determinism replay</title>");
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const at = performance.now();
    const hashes = await page.evaluate(
      (data) =>
        (
          globalThis as unknown as {
            replayHashes(recording: Recording): string[];
          }
        ).replayHashes(data),
      recording,
    );
    const mismatch = hashes.findIndex((hash, index) => hash !== node[index]);
    results[name] = {
      ticks: hashes.length,
      ms: Math.round(performance.now() - at),
      ...(mismatch >= 0 ? { firstMismatch: mismatch + 1 } : {}),
    };
    console.log(name, results[name]);
  } finally {
    await browser.close();
  }
}
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/determinism-replay.json",
  JSON.stringify(
    {
      revision: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      seed,
      ticks,
      results,
      lastHash: node.at(-1),
    },
    null,
    2,
  ),
);
for (const [name, result] of Object.entries(results)) {
  assert.equal(result.ticks, ticks, `${name} replayed every tick`);
  assert.equal(
    result.firstMismatch,
    undefined,
    `${name} diverged at tick ${result.firstMismatch}`,
  );
}
console.log(
  "Determinism replay passed: identical state hash on every tick in Node, Chromium and WebKit.",
);

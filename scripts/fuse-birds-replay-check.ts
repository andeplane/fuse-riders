import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { launchBrowser } from "./lib/browser.js";
import { replayFixture } from "./lib/fuse-birds-replay.js";
const server = process.argv[2]
  ? undefined
  : await createServer({ server: { host: "127.0.0.1", port: 0 } });
await server?.listen();
const base =
  process.argv[2] ?? server!.resolvedUrls!.local[0]!.replace(/\/$/, "");
const cases = [
  { seed: 123, count: 2 },
  { seed: 914, count: 3 },
  { seed: 987654, count: 5 },
];
const expected = cases.map((c) => replayFixture(c.seed, c.count));
const evidence: unknown[] = [
  {
    runtime: `Node ${process.version}`,
    results: expected.map(({ hashes, ...result }) => result),
  },
];
let failures = 0;
try {
  for (const [name, launch] of Object.entries({
    chromium: () =>
      launchBrowser("chromium", { headless: true, timeout: 30_000 }),
    firefox: () =>
      launchBrowser("firefox", { headless: true, timeout: 30_000 }),
    webkit: () => launchBrowser("webkit", { headless: true, timeout: 30_000 }),
  })) {
    let browser;
    try {
      browser = await launch();
      const page = await browser.newPage();
      await page.goto(`${base}/games/fuse-birds/replay-check.html?mute`);
      const results = await page.evaluate(async (cases) => {
        const modulePath = "/scripts/lib/fuse-birds-replay.ts";
        const { replayFixture: run } = (await import(modulePath)) as {
          replayFixture: typeof replayFixture;
        };
        return cases.map((c) => run(c.seed, c.count));
      }, cases);
      assert.deepEqual(
        results,
        expected,
        `${name} diverged from the Node action/checkpoint replay`,
      );
      evidence.push({
        runtime: name,
        version: browser.version(),
        results: results.map(
          ({ hashes, ...result }: ReturnType<typeof replayFixture>) => result,
        ),
      });
      console.log(
        `${name}: every tick matched Node for ${cases.length} complete matches`,
      );
    } catch (error) {
      failures++;
      evidence.push({ runtime: name, error: String(error) });
      console.error(`${name}: ${String(error).slice(0, 250)}`);
    } finally {
      await browser?.close();
    }
  }
  await writeFile(
    "/tmp/fuse-birds-cross-runtime.json",
    JSON.stringify(evidence, null, 2),
  );
  console.log("Saved /tmp/fuse-birds-cross-runtime.json");
  if (process.env.CI) {
    await mkdir("artifacts", { recursive: true });
    await writeFile(
      "artifacts/fuse-birds-cross-runtime.json",
      JSON.stringify(evidence, null, 2),
    );
  }
} finally {
  await server?.close();
}
if (failures) process.exitCode = 1;

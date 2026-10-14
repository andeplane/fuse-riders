import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createDevRoomService } from "../service/dev.js";

const root = fileURLToPath(new URL("../", import.meta.url));
async function tests(directory: string): Promise<string[]> {
  try {
    return (await readdir(resolve(root, directory)))
      .filter((name) => name.endsWith(".test.ts"))
      .map((name) => `${directory}/${name}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
async function run(args: string[], env = process.env): Promise<number> {
  return new Promise((yes, no) => {
    const child = spawn(process.env.npm_execpath ?? "pnpm", args, {
      cwd: root,
      env,
      stdio: "inherit",
    });
    child.once("error", no);
    child.once("exit", (code) => yes(code ?? 1));
  });
}

const files = await tests("tests");
const browserFlows: string[] = [];
for (const parent of ["packages", "games"])
  for (const entry of await readdir(resolve(root, parent), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    files.push(...(await tests(`${parent}/${entry.name}/tests`)));
    if (parent !== "games") continue;
    let manifest: unknown;
    try {
      manifest = JSON.parse(
        await readFile(
          resolve(root, parent, entry.name, "browser-coverage.json"),
          "utf8",
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (
      !manifest ||
      typeof manifest !== "object" ||
      !("scripts" in manifest) ||
      !Array.isArray(manifest.scripts) ||
      !manifest.scripts.length ||
      !manifest.scripts.every(
        (script: unknown) =>
          typeof script === "string" &&
          /^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*\.(?:ts|mjs)$/.test(script),
      )
    )
      throw new Error(`Invalid browser coverage manifest: games/${entry.name}`);
    for (const script of manifest.scripts)
      browserFlows.push(`games/${entry.name}/${script}`);
  }
const concurrency = process.env.TEST_CONCURRENCY ?? "4";
if (!/^[1-9]\d*$/.test(concurrency))
  throw new Error("TEST_CONCURRENCY must be a positive integer");
const unitExit = await run([
  "exec",
  "c8",
  "--check-coverage=false",
  "tsx",
  "--test",
  `--test-concurrency=${concurrency}`,
  ...files.sort(),
]);
const roomService = createDevRoomService({
  staticDirectory: resolve(root, "dist"),
});
await new Promise<void>((resolve) =>
  roomService.server.listen(0, "127.0.0.1", resolve),
);
const address = roomService.server.address();
if (!address || typeof address === "string")
  throw new Error("Coverage room service has no port");
const server = await createServer({
  root,
  server: {
    host: "127.0.0.1",
    port: 0,
    open: false,
    proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } },
  },
});
let browserExit = 1;
try {
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("Coverage Vite server has no local URL");
  browserExit = 0;
  for (const script of browserFlows.sort()) {
    const exit = await run(["exec", "tsx", script], {
      ...process.env,
      BROWSER: "chrome",
      ONLINE_URL: url,
      FUSE_GAME_COVERAGE_DIR: resolve(root, "coverage/tmp"),
    });
    browserExit ||= exit;
  }
} finally {
  try {
    await server.close();
  } finally {
    await roomService.close();
  }
}
const reportExit = await run([
  "exec",
  "c8",
  "report",
  "--temp-directory",
  "coverage/tmp",
  "--exclude-after-remap",
]);
// Never let a passing report hide failed unit tests or a failed browser flow.
process.exitCode = unitExit || browserExit || reportExit;

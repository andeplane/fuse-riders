import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
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
for (const parent of ["packages", "games"])
  for (const entry of await readdir(resolve(root, parent), {
    withFileTypes: true,
  }))
    if (entry.isDirectory())
      files.push(...(await tests(`${parent}/${entry.name}/tests`)));
// Bound test-process contention; service startup tests still use their original deadlines.
const unitExit = await run([
  "exec",
  "c8",
  "--check-coverage=false",
  "tsx",
  "--test",
  "--test-concurrency=4",
  ...files.sort(),
]);
let browserExit = 1;
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
  plugins: [
    {
      name: "birds-coverage-route",
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          if (request.url?.startsWith("/fuse-birds/"))
            request.url = request.url.replace(
              "/fuse-birds/",
              "/games/fuse-birds/",
            );
          next();
        });
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 0,
    open: false,
    proxy: { "/api": { target: `http://127.0.0.1:${address.port}`, ws: true } },
  },
});
try {
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("Coverage Vite server has no local URL");
  browserExit = await run(
    [
      "exec",
      "tsx",
      "scripts/fuse-birds-render-smoke.ts",
      url.replace(/\/$/, ""),
      "/tmp/fuse-birds-coverage",
    ],
    {
      ...process.env,
      FUSE_BIRDS_COVERAGE_DIR: resolve(root, "coverage/tmp"),
    },
  );
  const onlineExit = await run(
    [
      "exec",
      "tsx",
      "scripts/fuse-birds-online-smoke.ts",
      url.replace(/\/$/, ""),
      "/tmp/fuse-birds-online-coverage",
    ],
    { ...process.env, FUSE_BIRDS_COVERAGE_DIR: resolve(root, "coverage/tmp") },
  );
  browserExit ||= onlineExit;
} finally {
  await server.close();
  await roomService.close();
}
const reportExit = await run([
  "exec",
  "c8",
  "report",
  "--temp-directory",
  "coverage/tmp",
  "--exclude-after-remap",
]);
// A good report never masks failed tests or a failed browser flow.
process.exitCode = unitExit || browserExit || reportExit;

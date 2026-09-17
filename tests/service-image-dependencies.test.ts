import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

interface Lockfile {
  packages: Record<string, { dev?: boolean; link?: boolean }>;
}

/**
 * Dockerfile.cloud installs with `npm ci --omit=dev` and starts `node --import tsx src/service/index.ts`,
 * so a package the service reaches must not be dev-only in the lockfile. A violation here would
 * otherwise first show up as a Cloud Run revision that cannot start.
 */
test("the Cloud Run entry and its tsx loader resolve from production dependencies only", async () => {
  const lock = JSON.parse(
    await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
  ) as Lockfile;
  const dockerfile = await readFile(
    new URL("../Dockerfile.cloud", import.meta.url),
    "utf8",
  );
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(
    dockerfile,
    /CMD \["node", "--import", "tsx", "src\/service\/index\.ts"\]/,
  );

  // Bundling is only a way to walk the static import graph; nothing is written.
  const result = await build({
    entryPoints: ["src/service/index.ts"],
    absWorkingDir: fileURLToPath(new URL("..", import.meta.url)),
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  const installed = new Set<string>(["node_modules/tsx"]);
  for (const input of Object.keys(result.metafile.inputs)) {
    const match = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
    if (match) installed.add(match[1]!);
  }
  assert.ok(
    installed.has("node_modules/@google-cloud/firestore") &&
      installed.has("node_modules/ws"),
    "the walk reached the service's third-party imports",
  );
  // `debug` requires `supports-color` inside a try/catch as an undeclared extra and runs without it;
  // the walk cannot tell that require from a hard one.
  const optional = new Set([
    "node_modules/supports-color",
    "node_modules/has-flag",
  ]);
  const devOnly = [...installed].filter((key) => {
    if (optional.has(key)) return false;
    const entry = lock.packages[key];
    assert.ok(entry, `${key} is in package-lock.json`);
    return entry.dev === true;
  });
  assert.deepEqual(
    devOnly,
    [],
    "imported by the service but omitted from the image by --omit=dev",
  );
});

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
 *
 * The walk is esbuild's static import graph, so it only sees literal `import`, `import()` and
 * `require()` specifiers. It cannot see `createRequire(...)("pkg")`, an `import()` whose argument is
 * not a string literal, or `import.meta.resolve`. The second assertion below therefore refuses those
 * forms in every first-party file of the graph, so the blind spot cannot be used silently. It does not
 * look inside third-party packages: their own dependencies are covered by the lockfile, which marks a
 * package production when any production package declares it.
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
  // npm ci links a workspace package only if its manifest is in the image before the install; a missing one
  // would leave fuse-platform or fuse-network-be unresolvable when the revision starts.
  const workspaces = Object.keys(lock.packages).filter((key) =>
    /^packages\/[^/]+$/.test(key),
  );
  assert.ok(workspaces.includes("packages/fuse-platform"));
  for (const workspace of workspaces)
    assert.ok(
      dockerfile.includes(`COPY ${workspace}/package.json ./${workspace}/`),
      `Dockerfile.cloud copies ${workspace}/package.json before npm ci`,
    );
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
  const firstParty: string[] = [];
  for (const input of Object.keys(result.metafile.inputs)) {
    const match = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
    if (match) installed.add(match[1]!);
    else firstParty.push(input);
  }
  assert.ok(
    installed.has("node_modules/@google-cloud/firestore") &&
      installed.has("node_modules/ws"),
    "the walk reached the service's third-party imports",
  );
  assert.ok(
    firstParty.includes("src/service/index.ts") &&
      firstParty.some((file) => file.startsWith("packages/fuse-network-be/")) &&
      firstParty.some((file) => file.startsWith("packages/fuse-platform/")),
    "the walk reached the service's own source, including its workspace packages",
  );
  // Resolution the walk above cannot follow. `import(` followed by anything but a quote is a computed
  // specifier; a template literal counts, because only a plain string is certain to be walked.
  const unwalkable =
    /createRequire|import\.meta\.resolve|\bimport\s*\(\s*(?!["'])/;
  const hidden: string[] = [];
  for (const file of firstParty) {
    const source = await readFile(
      new URL(`../${file}`, import.meta.url),
      "utf8",
    );
    if (unwalkable.test(source)) hidden.push(file);
  }
  assert.deepEqual(
    hidden,
    [],
    "resolves a module in a way the static walk cannot see (createRequire, import.meta.resolve or a non-literal import())",
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

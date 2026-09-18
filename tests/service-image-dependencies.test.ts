import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { posix } from "node:path";
import { build } from "esbuild";
import { parse } from "yaml";

type Deps = Record<string, string | { version: string }>;
interface Lockfile {
  importers: Record<
    string,
    { dependencies?: Deps; optionalDependencies?: Deps }
  >;
  snapshots: Record<
    string,
    { dependencies?: Deps; optionalDependencies?: Deps }
  >;
}

/** `name@version`, dropping pnpm's peer suffix such as `(encoding@0.1.13)`. */
const packageId = (name: string, version: string) =>
  `${name}@${version.replace(/\(.*$/, "")}`;

/**
 * Every `name@version` a `pnpm install --prod` puts on disk: the production and optional dependencies
 * of the root, of each workspace package they link, and of everything those reach.
 */
function productionPackages(lock: Lockfile): Set<string> {
  const production = new Set<string>();
  const importers = new Set<string>();
  const pending: Array<{ importer: string } | { id: string }> = [
    { importer: "." },
  ];
  const visit = (deps: Deps | undefined, importer?: string) => {
    for (const [name, entry] of Object.entries(deps ?? {})) {
      const version = typeof entry === "string" ? entry : entry.version;
      if (version.startsWith("link:"))
        pending.push({
          importer: posix.join(importer ?? ".", version.slice(5)),
        });
      // An npm alias (`"wrap-ansi-cjs": "npm:wrap-ansi@7"`) records the real package as its version.
      else if (/^.[^@(]*@/.test(version)) pending.push({ id: version });
      else pending.push({ id: `${name}@${version}` });
    }
  };
  for (let next = pending.pop(); next; next = pending.pop()) {
    if ("importer" in next) {
      if (importers.has(next.importer)) continue;
      importers.add(next.importer);
      const entry = lock.importers[next.importer];
      assert.ok(entry, `${next.importer} is a workspace importer`);
      visit(entry.dependencies, next.importer);
      visit(entry.optionalDependencies, next.importer);
    } else {
      const id = next.id.replace(/\(.*$/, "");
      if (production.has(id)) continue;
      production.add(id);
      const entry = lock.snapshots[next.id];
      assert.ok(entry, `${next.id} is in pnpm-lock.yaml`);
      visit(entry.dependencies);
      visit(entry.optionalDependencies);
    }
  }
  return production;
}

/**
 * Dockerfile.cloud installs with `pnpm install --prod` and starts `node --import tsx src/service/index.ts`,
 * so a package the service reaches must be a production dependency in the lockfile. A violation here would
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
  const production = productionPackages(
    parse(
      await readFile(new URL("../pnpm-lock.yaml", import.meta.url), "utf8"),
    ) as Lockfile,
  );
  const dockerfile = await readFile(
    new URL("../Dockerfile.cloud", import.meta.url),
    "utf8",
  );
  assert.match(dockerfile, /pnpm install --prod --frozen-lockfile/);
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
  // esbuild follows pnpm's symlinks, so each package is reached at its store path,
  // node_modules/.pnpm/<name with + for />@<version>[_<peers>]/node_modules/<name>/.
  const tsx = await readFile(
    new URL("../node_modules/tsx/package.json", import.meta.url),
    "utf8",
  );
  const installed = new Set<string>([
    packageId("tsx", (JSON.parse(tsx) as { version: string }).version),
  ]);
  const names = new Set<string>(["tsx"]);
  const firstParty: string[] = [];
  for (const input of Object.keys(result.metafile.inputs)) {
    const match = input.match(
      /node_modules\/\.pnpm\/([^/]+)\/node_modules\/((?:@[^/]+\/)?[^/]+)\//,
    );
    if (match) {
      const [, directory, name] = match as unknown as [string, string, string];
      const prefix = `${name.replace("/", "+")}@`;
      assert.ok(directory.startsWith(prefix), `${input} is in the pnpm store`);
      installed.add(
        packageId(name, directory.slice(prefix.length).split("_")[0]!),
      );
      names.add(name);
    } else {
      assert.doesNotMatch(
        input,
        /node_modules/,
        `${input} is in the pnpm store`,
      );
      firstParty.push(input);
    }
  }
  assert.ok(
    names.has("@google-cloud/firestore") && names.has("ws"),
    "the walk reached the service's third-party imports",
  );
  assert.ok(
    firstParty.includes("src/service/index.ts") &&
      firstParty.some((file) => file.startsWith("packages/fuse-network-be/")),
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
  // the walk cannot tell that require from a hard one, and finds it through pnpm's hidden hoisting.
  const optional = /^(supports-color|has-flag)@/;
  const devOnly = [...installed].filter(
    (id) => !optional.test(id) && !production.has(id),
  );
  assert.deepEqual(
    devOnly,
    [],
    "imported by the service but omitted from the image by --prod",
  );
});

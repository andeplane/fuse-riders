import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * three.js is a lazy chunk: nothing reachable through static imports from the OS entry may import `three`
 * or the pipes module. The screen saver overlay `await import()`s it the moment the saver starts.
 */
const ENTRY = path.join("packages", "fuseos", "src", "main.tsx");
const PIPES = path.join(
  "packages",
  "fuseos",
  "src",
  "screensaver",
  "pipes",
  "pipes.ts",
);

// Static `import`/`export ... from` only: `import type` is erased and `import()` is a chunk boundary.
const STATIC_IMPORT =
  /^\s*(?:import|export)\s+(?!type[\s{])[^;'"]*?\bfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;

function specifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const match of source.matchAll(STATIC_IMPORT)) {
    const specifier = match[1] ?? match[2];
    if (specifier) found.push(specifier);
  }
  return found;
}

function resolveRelative(from: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ])
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return undefined;
}

function reachable(entry: string): {
  files: Set<string>;
  packages: Map<string, string[]>;
} {
  const files = new Set<string>();
  const packages = new Map<string, string[]>();
  const queue = [path.resolve(entry)];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || files.has(file)) continue;
    files.add(file);
    for (const specifier of specifiers(file)) {
      if (specifier.startsWith(".")) {
        const next = resolveRelative(file, specifier);
        if (next && !files.has(next)) queue.push(next);
      } else {
        const importers = packages.get(specifier) ?? [];
        importers.push(path.relative(process.cwd(), file));
        packages.set(specifier, importers);
      }
    }
  }
  return { files, packages };
}

test("the OS entry never reaches three.js or the pipes module through static imports", () => {
  const { files, packages } = reachable(ENTRY);
  assert.ok(files.size > 20, `walked only ${files.size} files from ${ENTRY}`);
  const three = [...packages.entries()].filter(
    ([specifier]) => specifier === "three" || specifier.startsWith("three/"),
  );
  assert.deepEqual(
    three,
    [],
    `three.js is statically imported by ${JSON.stringify(three)}`,
  );
  assert.ok(
    !files.has(path.resolve(PIPES)),
    "the pipes module is statically reachable from the entry",
  );
});

test("the pipes module itself imports three, so the lazy boundary is real", () => {
  const found = specifiers(PIPES);
  assert.ok(
    found.includes("three"),
    `expected an import of three, got ${found.join(", ")}`,
  );
  const deps = path.join(
    "packages",
    "fuseos",
    "src",
    "screensaver",
    "screenSaverDepsContext.ts",
  );
  const source = readFileSync(deps, "utf8");
  assert.match(source, /import\("\.\/pipes\/pipes"\)/);
});

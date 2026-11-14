import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { syntax } from "./fixtures/source-guards.js";

/**
 * Clippy's model (`@mlc-ai/web-llm`, a megabyte of library plus hundreds of megabytes of weights) must not load
 * before the user sends the first chat message. Two guards: the static import graph from the OS entry never reaches
 * the library or the worker that hosts it, and, when a build exists, the chunks the page loads at start carry none
 * of the library's code.
 */
const repo = fileURLToPath(new URL("..", import.meta.url));
const fuseos = path.join(repo, "packages", "fuseos", "src");
const ENTRY = path.join(fuseos, "main.tsx");
const LIBRARY = "@mlc-ai/web-llm";
const WORKER = path.join(fuseos, "llm", "llmWorker.ts");

/** Static (non-type) imports and re-exports of a module: what the bundler puts in the same load. */
function staticImports(file: string): string[] {
  const source = syntax(file);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      !node.importClause?.isTypeOnly &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      found.push(node.moduleSpecifier.text);
    else if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      found.push(node.moduleSpecifier.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function resolveLocal(from: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ])
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  return undefined;
}

/** Every source file the entry loads statically, and every bare package it imports on that path. */
export function staticGraph(entry: string): {
  files: Set<string>;
  packages: Map<string, string[]>;
} {
  const files = new Set<string>();
  const packages = new Map<string, string[]>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || files.has(file)) continue;
    files.add(file);
    for (const specifier of staticImports(file)) {
      if (specifier.startsWith(".")) {
        const target = resolveLocal(file, specifier);
        if (target) queue.push(target);
        continue;
      }
      const importers = packages.get(specifier) ?? [];
      importers.push(path.relative(repo, file));
      packages.set(specifier, importers);
    }
  }
  return { files, packages };
}

test("the OS entry never reaches web-llm or its worker through static imports", () => {
  const { files, packages } = staticGraph(ENTRY);
  assert.ok(files.size > 20, `walked only ${files.size} files`);
  assert.ok(
    files.has(path.join(fuseos, "assistant", "OfficeAssistant.tsx")),
    "the walk reaches the Office Assistant",
  );
  assert.ok(
    files.has(path.join(fuseos, "llm", "webLlmChat.ts")),
    "the walk reaches the engine module, whose own import of the library is dynamic",
  );
  assert.deepEqual(packages.get(LIBRARY), undefined);
  assert.ok(!files.has(WORKER), "llmWorker.ts is reached only as a Worker URL");
});

test("the engine module imports the library dynamically and the worker is the only static importer", () => {
  const engine = readFileSync(
    path.join(fuseos, "llm", "webLlmChat.ts"),
    "utf8",
  );
  assert.match(engine, /await import\("@mlc-ai\/web-llm"\)/);
  assert.doesNotMatch(engine, /from "@mlc-ai\/web-llm"/);
  assert.deepEqual(staticImports(WORKER), [LIBRARY]);
});

const STATIC_IMPORT =
  /(?:^|[;\s}])import\s*(?:[\w$*{},\s]+?\s*from\s*)?["'](\.[^"']+)["']/g;
const DYNAMIC_IMPORT = /import\(\s*["'](\.[^"']+)["']\s*\)/g;

function chunkImports(file: string, pattern: RegExp): string[] {
  const code = readFileSync(file, "utf8");
  return [...code.matchAll(pattern)].map((match) =>
    path.resolve(path.dirname(file), match[1] ?? ""),
  );
}

/** A chunk and everything it imports statically: one load, as far as the browser is concerned. */
function staticClosure(roots: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    queue.push(...chunkImports(file, STATIC_IMPORT));
  }
  return seen;
}

/**
 * The chunks a built page runs before the desktop shows: the page's module scripts with their static imports, and
 * the chunks those scripts import dynamically at once (site/main.ts awaits the OS entry), with theirs. A chunk the OS
 * itself imports dynamically (Webamp, the model) is a later load and stays out.
 */
function bootChunks(dist: string): string[] {
  const html = readFileSync(path.join(dist, "index.html"), "utf8");
  // The src carries the build's base (`/assets/...`, `/fuse-games/assets/...` or `./assets/...`); the file is under dist/assets either way.
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(
    (match) => {
      const src = match[1] ?? "";
      const assets = src.lastIndexOf("assets/");
      return path.join(
        dist,
        assets >= 0 ? src.slice(assets) : src.replace(/^\.?\//, ""),
      );
    },
  );
  const page = staticClosure(scripts);
  const os = staticClosure(
    [...page].flatMap((chunk) => chunkImports(chunk, DYNAMIC_IMPORT)),
  );
  return [...new Set([...page, ...os])];
}

const DIST = path.join(repo, "dist");
/** Strings only the library's own code carries (the OS names the model ids and the cache names itself). */
const LIBRARY_MARKERS = [
  "huggingface.co/mlc-ai",
  "WebWorkerMLCEngineHandler",
  "mlc-chat-config.json",
];

test(
  "the built page's boot chunks carry no web-llm code",
  { skip: !existsSync(path.join(DIST, "index.html")) && "no dist/ build" },
  () => {
    const chunks = bootChunks(DIST);
    assert.ok(
      chunks.some((chunk) => readFileSync(chunk, "utf8").includes("Clippy")),
      "the boot chunks include the desktop (found no Clippy in them)",
    );
    const offenders = chunks.flatMap((chunk) => {
      const code = readFileSync(chunk, "utf8");
      const found = LIBRARY_MARKERS.filter((marker) => code.includes(marker));
      return found.length > 0
        ? [`${path.relative(DIST, chunk)}: ${found.join(", ")}`]
        : [];
    });
    assert.deepEqual(offenders, []);
  },
);

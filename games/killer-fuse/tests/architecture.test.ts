import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  deterministicViolations,
  imports,
  sourceFiles,
  syntax,
} from "../../../tests/fixtures/source-guards.js";

/**
 * The engine boundary: `src/engine/` is a deterministic simulation that imports nothing outside itself (no app, no
 * netcode, no npm or Node packages) and computes the same bits on every JS engine, because an online room replays
 * one input log on different browsers. The page and the online layer import the engine, never the reverse. A new
 * cross-layer import is a design question (which layer owns this?), not an exception to add here.
 */

const game = fileURLToPath(new URL("..", import.meta.url));
const engineDir = path.join(game, "src", "engine");

/** Why `specifier`, imported from the engine file `source`, crosses the boundary; undefined when it stays inside. */
export function boundaryViolation(
  source: string,
  specifier: string,
): string | undefined {
  if (!specifier.startsWith("."))
    return `${specifier} is a package; the engine imports only its own modules`;
  const relative = path.relative(
    engineDir,
    path.resolve(path.dirname(source), specifier),
  );
  if (relative.startsWith("..") || path.isAbsolute(relative))
    return `${specifier} resolves outside src/engine/`;
  return undefined;
}

test("src/engine/ imports nothing outside itself", () => {
  const files = sourceFiles(engineDir);
  assert.ok(files.some((file) => file.endsWith("step.ts")));
  const found = files.flatMap((file) =>
    imports(syntax(file)).flatMap((specifier) => {
      const reason = boundaryViolation(file, specifier);
      return reason ? [`${path.relative(game, file)}: ${reason}`] : [];
    }),
  );
  assert.deepEqual(
    found,
    [],
    "move the concept into the engine, or have the app import the engine instead",
  );
});

test("the boundary guard rejects the app, the netcode and packages and accepts engine-relative imports", () => {
  const source = path.join(engineDir, "step.ts");
  const nested = path.join(engineDir, "bots", "pilot.ts");
  for (const specifier of [
    "../app/main.js",
    "../game/index.js",
    "../platform.js",
    "../../tests/engine-kit.js",
    "fuse-netcode",
    "node:fs",
  ])
    assert.ok(boundaryViolation(source, specifier), specifier);
  assert.ok(boundaryViolation(nested, "../../app/main.js"));
  for (const specifier of ["./rng.js", "./bots/pilot.js"])
    assert.equal(boundaryViolation(source, specifier), undefined, specifier);
  assert.equal(boundaryViolation(nested, "../step.js"), undefined);
});

/**
 * What would make a replay play differently, here or on another browser: the clock, ambient randomness, and the
 * `Math` functions (`sin`, `atan2`, `hypot`, `exp`, `**`, …) whose last bits the language leaves to each engine.
 * The engine needs none of them: positions are integer subpixels and randomness is `src/engine/rng.ts`.
 */
test("the engine keeps to deterministic arithmetic: no clock, no Math.random, no library trigonometry", () => {
  const files = sourceFiles(engineDir);
  assert.ok(files.some((file) => file.endsWith("rng.ts")));
  for (const file of files)
    assert.deepEqual(
      deterministicViolations(syntax(file)),
      [],
      `${path.relative(game, file)}: use integer arithmetic and src/engine/rng.ts`,
    );
});

test("the guard refuses Math.sin added to an engine file, and every other form it bans", () => {
  const file = path.join(engineDir, "motion.ts");
  const withSin = `${readFileSync(file, "utf8")}\nexport const wobble = (t: number) => Math.sin(t);\n`;
  assert.deepEqual(deterministicViolations(syntax(file, withSin)), [
    "Math.sin",
  ]);
  const found = deterministicViolations(
    syntax(
      "sample.ts",
      `const a = Date.now(); const b = performance.now(); const c = Math.random();
       const d = Math["ran" + "dom"](); const { random } = Math; const e = Math.cos(1);
       const f = Math.atan2(1, 2) + Math.hypot(3, 4) + Math.exp(1) + Math.log2(8) + Math.pow(2, 3) + 2 ** 3;`,
    ),
  );
  assert.deepEqual(found, [
    "Date",
    "Math extraction",
    "Math.[dynamic]",
    "Math.atan2",
    "Math.cos",
    "Math.exp",
    "Math.hypot",
    "Math.log2",
    "Math.pow",
    "Math.random",
    "exponentiation",
    "performance",
  ]);
});

/**
 * The render boundary: `src/render/` draws the view and nothing else of the game. From the engine it imports the
 * types of `engine/view.ts` (never its values: `viewOf` would bring the rules in behind the contract) and the pure
 * kernels of `engine/view-kit.ts`, should one be needed; a rule value it needs travels as data in the view
 * (`RoundView.rules`). It never imports `online/` or `app/`, nor the netcode, and the room knows the renderer only
 * through `render/api.ts`.
 */
const renderDir = path.join(game, "src", "render");
const engineModule = (name: string): string => path.join(engineDir, name);

/** Why `specifier`, imported from the render file `source`, crosses the boundary; undefined when it may. */
export function renderViolation(
  source: string,
  specifier: string,
  typeOnly: boolean,
): string | undefined {
  if (!specifier.startsWith("."))
    return /^fuse-(netcode|network|platform)/.test(specifier)
      ? `${specifier}: the renderer knows nothing of the room or the platform`
      : undefined;
  const target = path
    .resolve(path.dirname(source), specifier)
    .replace(/\.js$/, ".ts");
  const relative = path.relative(renderDir, target);
  if (!relative.startsWith("..") && !path.isAbsolute(relative))
    return undefined;
  if (target === engineModule("view-kit.ts")) return undefined;
  if (target === engineModule("view.ts"))
    return typeOnly
      ? undefined
      : `${specifier}: a value import of the view contract; import its types only`;
  return `${specifier}: the renderer imports only engine/view.ts (types) and engine/view-kit.ts`;
}

/** Every module `file` imports, with whether the import brings no values (`import type`, or every binding typed). */
export function importEdges(
  file: ts.SourceFile,
): { specifier: string; typeOnly: boolean }[] {
  const found: { specifier: string; typeOnly: boolean }[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const clause = node.importClause;
      found.push({
        specifier: node.moduleSpecifier.text,
        typeOnly:
          !!clause &&
          (clause.isTypeOnly ||
            (!clause.name &&
              !!clause.namedBindings &&
              ts.isNamedImports(clause.namedBindings) &&
              clause.namedBindings.elements.every((e) => e.isTypeOnly))),
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      found.push({
        specifier: node.moduleSpecifier.text,
        typeOnly:
          node.isTypeOnly ||
          (!!node.exportClause &&
            ts.isNamedExports(node.exportClause) &&
            node.exportClause.elements.every((e) => e.isTypeOnly)),
      });
    else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      found.push({ specifier: node.arguments[0].text, typeOnly: false });
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

test("src/render/ imports only the view contract's types from the engine, and nothing of online/ or app/", () => {
  const files = sourceFiles(renderDir);
  assert.ok(files.some((file) => file.endsWith("scene.ts")));
  const found = files.flatMap((file) =>
    importEdges(syntax(file)).flatMap(({ specifier, typeOnly }) => {
      const reason = renderViolation(file, specifier, typeOnly);
      return reason ? [`${path.relative(game, file)}: ${reason}`] : [];
    }),
  );
  assert.deepEqual(
    found,
    [],
    "put the rule value on the view (RoundView.rules) or a kernel in engine/view-kit.ts",
  );
});

test("the render guard refuses the engine's values, the barrel, the online and app layers and the netcode", () => {
  const source = path.join(renderDir, "scene.ts");
  for (const [specifier, typeOnly] of [
    ["../engine/index.js", true],
    ["../engine/index.js", false],
    ["../engine/tuning.js", true],
    ["../engine/view.js", false],
    ["../online/index.js", true],
    ["../online/game.js", false],
    ["../app/main.js", true],
    ["../../tests/render-kit.js", false],
    ["fuse-netcode", true],
    ["fuse-network-fe", false],
    ["fuse-platform", false],
  ] as const)
    assert.ok(renderViolation(source, specifier, typeOnly), specifier);
  for (const [specifier, typeOnly] of [
    ["../engine/view.js", true],
    ["../engine/view-kit.js", false],
    ["./animation.js", false],
    ["./effects.js", true],
    ["typescript", false],
  ] as const)
    assert.equal(
      renderViolation(source, specifier, typeOnly),
      undefined,
      specifier,
    );
  assert.deepEqual(
    importEdges(
      syntax(
        "sample.ts",
        `import type { A } from "./a.js"; import { type B, type C } from "./b.js"; import { type D, e } from "./d.js";
         import f from "./f.js"; export type { G } from "./g.js"; export { type H } from "./h.js"; export * from "./i.js";
         const j = await import("./j.js");`,
      ),
    ),
    [
      { specifier: "./a.js", typeOnly: true },
      { specifier: "./b.js", typeOnly: true },
      { specifier: "./d.js", typeOnly: false },
      { specifier: "./f.js", typeOnly: false },
      { specifier: "./g.js", typeOnly: true },
      { specifier: "./h.js", typeOnly: true },
      { specifier: "./i.js", typeOnly: false },
      { specifier: "./j.js", typeOnly: false },
    ],
  );
});

/** The state must survive a structured clone and JSON, so no engine module may build it from classes or collections. */
test("no engine module declares a class", () => {
  for (const file of sourceFiles(engineDir))
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /^\s*(export\s+)?(abstract\s+)?class\s/m,
      path.relative(game, file),
    );
});

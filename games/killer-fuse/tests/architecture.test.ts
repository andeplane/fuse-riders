import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

/** The state must survive a structured clone and JSON, so no engine module may build it from classes or collections. */
test("no engine module declares a class", () => {
  for (const file of sourceFiles(engineDir))
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /^\s*(export\s+)?(abstract\s+)?class\s/m,
      path.relative(game, file),
    );
});

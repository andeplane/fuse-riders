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
 * The engine boundary: `src/engine/` is a deterministic simulation that imports nothing outside itself — no
 * `render/`, no `app/`, no Phaser, no npm or Node packages — and computes the same bits on every JS engine, because
 * an online room replays one input log on different browsers. Rendering and app code import the engine, never the
 * reverse. A new cross-layer import is a design question (which layer owns this?), not an exception to add here.
 * That the game as a whole imports no other game is tests/game-isolation.
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
  const found = sourceFiles(engineDir).flatMap((file) =>
    imports(syntax(file)).flatMap((specifier) => {
      const reason = boundaryViolation(file, specifier);
      return reason ? [`${path.relative(game, file)}: ${reason}`] : [];
    }),
  );
  assert.deepEqual(
    found,
    [],
    "move the concept into the engine, or have render/app import the engine instead",
  );
});

test("the boundary guard rejects render, app and packages and accepts engine-relative imports", () => {
  const source = path.join(engineDir, "world.ts");
  const nested = path.join(engineDir, "physics", "rocket.ts");
  for (const specifier of [
    "../render/title-scene.js",
    "../app/main.js",
    "../../tests/helper.js",
    "phaser",
    "node:fs",
  ])
    assert.ok(boundaryViolation(source, specifier), specifier);
  assert.ok(boundaryViolation(nested, "../../render/scene.js"));
  for (const specifier of ["./rng.js", "./physics/rocket.js"])
    assert.equal(boundaryViolation(source, specifier), undefined, specifier);
  assert.equal(boundaryViolation(nested, "../world.js"), undefined);
});

/**
 * What would make a replay play differently, here or on another browser: the clock, ambient randomness, and the
 * `Math` functions (`sin`, `atan2`, `hypot`, `exp`, `log2`, `**`, …) whose last bits the language leaves to each
 * engine. The engine's trigonometry, `exp` and `log2` are `src/engine/det-math.ts`.
 */
test("the engine keeps to deterministic arithmetic: no clock, no Math.random, no library trigonometry", () => {
  const files = sourceFiles(engineDir);
  assert.ok(files.some((file) => file.endsWith("det-math.ts")));
  for (const file of files)
    assert.deepEqual(
      deterministicViolations(syntax(file)),
      [],
      `${path.relative(game, file)}: use src/engine/det-math.ts`,
    );
});

test("the guard refuses Math.sin added to an engine file, and every other form it bans", () => {
  const file = path.join(engineDir, "geometry.ts");
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

test("the guard refuses every Math function the language leaves approximated and accepts the exactly rounded ones", () => {
  const approximated = [
    ...["sin", "cos", "tan", "asin", "acos", "atan", "atan2"],
    ...["sinh", "cosh", "tanh", "asinh", "acosh", "atanh"],
    ...["exp", "expm1", "log", "log1p", "log2", "log10", "pow", "hypot"],
    ...["cbrt", "random"],
  ];
  for (const name of approximated)
    assert.deepEqual(
      deterministicViolations(syntax("sample.ts", `Math.${name}(1);`)),
      [`Math.${name}`],
    );
  const exact = `Math.PI + Math.E + Math.SQRT2 + Math.LN2 + Math.LOG2E; Math.abs(1); Math.sign(1); Math.min(1, 2);
    Math.max(1, 2); Math.floor(1); Math.ceil(1); Math.round(1); Math.trunc(1); Math.sqrt(4); Math.fround(1);
    Math.imul(1, 2); Math.clz32(1);`;
  assert.deepEqual(deterministicViolations(syntax("sample.ts", exact)), []);
});

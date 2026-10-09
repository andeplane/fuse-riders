import test from "node:test";
import assert from "node:assert/strict";
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
 * `render/`, no `app/`, no Phaser, no npm or Node packages — and reads no clock or ambient randomness. Rendering and
 * app code import the engine, never the reverse. A new cross-layer import is a design question (which layer owns
 * this?), not an exception to add here. That the game as a whole imports no other game is tests/game-isolation.
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
 * What would make a seeded match play differently on a replay: the clock and ambient randomness. Unlike the online
 * games, this one-screen game may use `Math`'s trigonometry, `exp` and `log2`, so only these are refused.
 */
const UNSEEDED = new Set([
  "Date",
  "performance",
  "Math.random",
  "Math.[dynamic]",
  "Math extraction",
]);

test("the engine reads no clock and no unseeded randomness", () => {
  for (const file of sourceFiles(engineDir))
    assert.deepEqual(
      deterministicViolations(syntax(file)).filter((v) => UNSEEDED.has(v)),
      [],
      path.relative(game, file),
    );
});

test("the clock and randomness guard catches every form it refuses", () => {
  const found = deterministicViolations(
    syntax(
      "sample.ts",
      `const a = Date.now(); const b = performance.now(); const c = Math.random();
       const d = Math["ran" + "dom"](); const { random } = Math; const e = Math.sin(1);`,
    ),
  ).filter((v) => UNSEEDED.has(v));
  assert.deepEqual(found, [...UNSEEDED].sort());
});

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  imports,
  sourceFiles,
  syntax,
} from "../../../tests/fixtures/source-guards.js";

/**
 * The engine boundary: `src/engine/` is a deterministic simulation that imports nothing outside itself — no
 * `render/`, no `app/`, no Phaser, no npm or Node packages. Rendering and app code import the engine, never the
 * reverse. A new cross-layer import is a design question (which layer owns this?), not an exception to add here.
 * Like every game in the repo, the rest of the game may import the shared packages but never another game.
 */

const game = fileURLToPath(new URL("..", import.meta.url));
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const engineDir = path.join(game, "src", "engine");
const OTHER_GAMES = [
  ...readdirSync(path.join(repo, "games")).filter(
    (name) => name !== "fuse-bombers",
  ),
  "fuse-riders-game",
];
const inside = (base: string, target: string): boolean => {
  const relative = path.relative(base, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

/** Why `specifier`, imported from the engine file `source`, crosses the boundary; undefined when it stays inside. */
export function boundaryViolation(
  source: string,
  specifier: string,
): string | undefined {
  if (!specifier.startsWith("."))
    return `${specifier} is a package; the engine imports only its own modules`;
  if (!inside(engineDir, path.resolve(path.dirname(source), specifier)))
    return `${specifier} resolves outside src/engine/`;
  return undefined;
}

/** Why `specifier`, imported from any game file `source`, leaves the game; undefined when it may. */
export function gameViolation(
  source: string,
  specifier: string,
): string | undefined {
  if (!specifier.startsWith("."))
    return OTHER_GAMES.some(
      (name) => specifier === name || specifier.startsWith(`${name}/`),
    )
      ? `${specifier} is another game`
      : undefined;
  const target = path.resolve(path.dirname(source), specifier);
  return inside(game, target) || inside(path.join(repo, "packages"), target)
    ? undefined
    : `${specifier} leaves the game`;
}

function violations(
  directory: string,
  rule: (source: string, specifier: string) => string | undefined,
): string[] {
  return sourceFiles(directory).flatMap((file) =>
    imports(syntax(file)).flatMap((specifier) => {
      const reason = rule(file, specifier);
      return reason ? [`${path.relative(game, file)}: ${reason}`] : [];
    }),
  );
}

test("src/engine/ imports nothing outside itself", () => {
  assert.deepEqual(
    violations(engineDir, boundaryViolation),
    [],
    "move the concept into the engine, or have render/app import the engine instead",
  );
});

test("the game imports shared packages, never another game", () => {
  assert.deepEqual(violations(path.join(game, "src"), gameViolation), []);
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

test("the game guard rejects other games and paths out of the game, and accepts the shared packages", () => {
  const source = path.join(game, "src", "app", "main.ts");
  for (const specifier of [
    "fuse-riders-game",
    "fuse-craft/platform",
    "../../../fuse-riders/src/engine/rng.js",
    "../../../../service/history.js",
  ])
    assert.ok(gameViolation(source, specifier), specifier);
  for (const specifier of [
    "fuse-ui/portal",
    "phaser",
    "../engine/index.js",
    "../../../../packages/fuse-ui/src/portal.js",
  ])
    assert.equal(gameViolation(source, specifier), undefined, specifier);
});

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gameImportViolation,
  gamePackages,
  imports,
  sourceFiles,
  syntax,
} from "./fixtures/source-guards.js";

/**
 * Every game in `games/` stands alone: its source imports its own modules and `packages/`, never another game or
 * `service/`. This one test covers every game, a new one included, so no game needs its own copy of the rule.
 */
const repo = fileURLToPath(new URL("..", import.meta.url));
const packages = gamePackages();

test("every game's source imports only itself and the shared packages", () => {
  const found = [...packages.keys()].flatMap((game) =>
    sourceFiles(path.join(repo, "games", game, "src")).flatMap((file) =>
      imports(syntax(file)).flatMap((specifier) => {
        const reason = gameImportViolation(game, file, specifier, packages);
        return reason ? [`${path.relative(repo, file)}: ${reason}`] : [];
      }),
    ),
  );
  assert.deepEqual(found, []);
});

test("the game guard names each game by its package and refuses other games and paths out", () => {
  assert.equal(packages.get("fuse-riders"), "fuse-riders-game");
  assert.equal(packages.get("fuse-bombers"), "fuse-bombers");
  const file = path.join(
    repo,
    "games",
    "fuse-bombers",
    "src",
    "app",
    "main.ts",
  );
  for (const specifier of [
    "fuse-riders-game",
    "fuse-craft/platform",
    "hook-havok",
    "../../../fuse-riders/src/engine/rng.js",
    "../../../../service/history.js",
    "../../../../tests/fixtures/source-guards.js",
  ])
    assert.ok(
      gameImportViolation("fuse-bombers", file, specifier, packages),
      specifier,
    );
  for (const specifier of [
    "fuse-ui/portal",
    "phaser",
    "node:fs",
    "dice-extra", // A package that only shares a game's name as a prefix.
    "../engine/index.js",
    "../../../../packages/fuse-ui/src/portal.js",
  ])
    assert.equal(
      gameImportViolation("fuse-bombers", file, specifier, packages),
      undefined,
      specifier,
    );
});

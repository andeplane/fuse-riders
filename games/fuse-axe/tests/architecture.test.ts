import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readdirSync } from "node:fs";
import {
  deterministicViolations,
  imports,
  sourceFiles,
  syntax,
} from "../../../tests/fixtures/source-guards.js";

const game = fileURLToPath(new URL("../", import.meta.url));
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const OTHER_GAMES = readdirSync(path.join(repo, "games")).filter(
  (name) => name !== "fuse-axe",
);
const under = (file: string, folder: string) =>
  file.replaceAll("\\", "/").includes(`/src/${folder}/`);
const inside = (base: string, target: string) => {
  const relative = path.relative(base, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

// The walk covers whichever of engine/, render/, online/ and app/ exist yet; the rules below apply as each arrives.
test("the engine imports nothing outside itself, and the renderer reads only the engine's view", () => {
  const files = sourceFiles(path.join(game, "src"));
  assert.ok(files.some((file) => under(file, "engine")));
  for (const file of files) {
    for (const specifier of imports(syntax(file))) {
      if (!specifier.startsWith(".")) {
        assert.ok(
          !under(file, "engine"),
          `${file}: the engine imports ${specifier}`,
        );
        assert.ok(
          !OTHER_GAMES.some(
            (name) => specifier === name || specifier.startsWith(`${name}/`),
          ) &&
            specifier !== "fuse-riders-game" &&
            !specifier.startsWith("fuse-riders-game/"),
          `${file}: imports another game, ${specifier}`,
        );
        continue;
      }
      const target = path.resolve(path.dirname(file), specifier);
      assert.ok(
        inside(game, target) || inside(path.join(repo, "packages"), target),
        `${file}: ${specifier} leaves the game`,
      );
      if (under(file, "engine"))
        assert.ok(
          inside(path.join(game, "src/engine"), target),
          `${file}: the engine leaves its layer`,
        );
      if (under(file, "render")) {
        assert.ok(
          !inside(path.join(game, "src/app"), target),
          `${file}: the renderer imports the app`,
        );
        assert.ok(
          !inside(path.join(game, "src/online"), target),
          `${file}: the renderer imports the netcode`,
        );
        if (inside(path.join(game, "src/engine"), target))
          assert.ok(
            ["view.js", "view-kit.js"].includes(path.basename(target)),
            `${file}: the renderer reaches into the engine's ${path.basename(target)}`,
          );
      }
    }
  }
});

test("the engine keeps to deterministic arithmetic: no clock, no Math.random, no trigonometry", () => {
  for (const file of sourceFiles(path.join(game, "src/engine")))
    assert.deepEqual(deterministicViolations(syntax(file)), [], file);
});

test("the deterministic guard would catch a clock or Math.random in the engine", () => {
  const probe = syntax(
    "probe.ts",
    "export const t = Date.now() + Math.random();",
  );
  assert.deepEqual(deterministicViolations(probe), ["Date", "Math.random"]);
});

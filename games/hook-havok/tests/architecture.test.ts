import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  sourceFiles,
  imports,
  syntax,
} from "../../../tests/fixtures/source-guards.js";

test("Hook Havok source stays inside its game or shared packages; renderer does not import app", () => {
  const game = fileURLToPath(new URL("../", import.meta.url));
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  for (const file of sourceFiles(path.join(game, "src"))) {
    for (const specifier of imports(syntax(file))) {
      if (!specifier.startsWith(".")) {
        assert.ok(
          !["dice", "ball-bros", "fuse-riders-game", "fuse-birds"].some(
            (name) => specifier === name || specifier.startsWith(name + "/"),
          ),
          `${file}: cross-game import ${specifier}`,
        );
        continue;
      }
      const target = path.resolve(path.dirname(file), specifier);
      const inside = (base: string) => {
        const relative = path.relative(base, target);
        return (
          relative === "" ||
          (!relative.startsWith("..") && !path.isAbsolute(relative))
        );
      };
      assert.ok(
        inside(game) || inside(path.join(repo, "packages")),
        `${file}: import leaves game/shared packages: ${specifier}`,
      );
      if (file.replaceAll("\\", "/").includes("/src/render/"))
        assert.ok(
          !inside(path.join(game, "src/app")),
          `${file}: renderer imports app`,
        );
    }
  }
});

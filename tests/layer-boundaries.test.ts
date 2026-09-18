import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  forbiddenEdge,
  imports,
  layerViolations,
  renderValueImportsOfView,
  sourceFiles,
  syntax,
} from "./fixtures/source-guards.js";

test("architecture imports match the exact shrinking migration allowlist", () => {
  const allowed: string[] = JSON.parse(
    readFileSync(
      new URL("./fixtures/layer-allowlist.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(
    layerViolations(),
    allowed,
    "new edges are forbidden; remove stale allowlist entries as their dependencies move",
  );
});

test("rendering is done migrating: only the engine's view and view-kit, and no allowlisted exception", () => {
  const allowed: string[] = JSON.parse(
    readFileSync(
      new URL("./fixtures/layer-allowlist.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(
    allowed.filter((edge) => edge.startsWith("src/render/")),
    [],
    "src/render/ may not be given an exception again: publish the value in the view, or add a kernel to view-kit",
  );
  for (const specifier of [
    "../engine/game.js",
    "../engine/tuning.js",
    "../engine/index.js",
    "../shared/avatars.js",
    "../shared/protocol.js",
    "fuse-netcode",
    "../online/fuse-game.js",
    "../online/room-runtime.js",
    "../client/safe-storage.js",
  ])
    assert.ok(forbiddenEdge("src/render/scene.ts", specifier), specifier);
  for (const specifier of [
    "../engine/view.js",
    "../engine/view-kit.js",
    "./themes.js",
    "phaser",
  ])
    assert.equal(
      forbiddenEdge("src/render/scene.ts", specifier),
      undefined,
      specifier,
    );
  assert.equal(
    forbiddenEdge("src/render/time/present.ts", "../../engine/view-kit.js"),
    undefined,
  );
});

test("the boundary guard covers target directories, re-exports, type imports and dynamic imports", () => {
  for (const specifier of [
    "fuse-network-fe",
    "fuse-network-be",
    "fuse-network-protocol",
    "fuse-network-fe/room-api",
  ]) {
    assert.ok(forbiddenEdge("src/render/world.ts", specifier));
    assert.ok(forbiddenEdge("src/engine/game.ts", specifier));
    assert.equal(forbiddenEdge("src/net/world.ts", specifier), undefined);
  }
  assert.ok(forbiddenEdge("src/engine/apply-tick.ts", "fuse-netcode"));
  assert.ok(
    forbiddenEdge(
      "packages/fuse-netcode/src/rollback.ts",
      "../../../src/engine/apply-tick.js",
    ),
  );
  assert.deepEqual(
    imports(
      syntax(
        "sample.ts",
        `import {x} from '../app/a.js'; export {y} from './b.js'; const c = import('./c.js'); type T = import('./d.js').T;`,
      ),
    ),
    ["../app/a.js", "./b.js", "./c.js", "./d.js"],
  );
  assert.ok(forbiddenEdge("src/engine/game.ts", "../app/ui.js"));
  assert.ok(forbiddenEdge("src/net/world.ts", "../render/time.js"));
  assert.ok(forbiddenEdge("src/render/world.ts", "../engine/game.js"));
  assert.ok(
    forbiddenEdge(
      "packages/fuse-network-fe/src/world.ts",
      "../../../src/engine/game.js",
    ),
  );
  assert.equal(
    forbiddenEdge("src/render/world.ts", "../engine/view-kit.js"),
    undefined,
  );
  assert.equal(
    forbiddenEdge("src/net/world.ts", "../engine/game.js"),
    undefined,
  );
  assert.equal(
    forbiddenEdge("src/app/main.ts", "../render/world.js"),
    undefined,
  );
});

test("rendering takes only types from engine/view: a value import of toView would pull the rules in behind the contract", () => {
  assert.deepEqual(
    sourceFiles("src/render").flatMap((file) =>
      renderValueImportsOfView(syntax(file)),
    ),
    [],
  );
  const check = (text: string, file = "src/render/phaser/scene.ts") =>
    renderValueImportsOfView(syntax(file, text));
  for (const text of [
    'import { toView } from "../../engine/view.js";',
    'import { toView, type WorldView } from "../../engine/view.js";',
    'import * as view from "../../engine/view.js";',
    'import "../../engine/view.js";',
    'export { toView } from "../../engine/view.js";',
    'export * from "../../engine/view.js";',
    'const view = await import("../../engine/view.js");',
  ])
    assert.equal(check(text).length, 1, text);
  for (const text of [
    'import type { WorldView } from "../../engine/view.js";',
    'import { type WorldView, type RiderView } from "../../engine/view.js";',
    'export type { WorldView } from "../../engine/view.js";',
    'import { advanceTrail } from "../../engine/view-kit.js";',
  ])
    assert.deepEqual(check(text), [], text);
  assert.deepEqual(
    check('import { toView } from "../engine/view.js";', "src/online/ui.ts"),
    [],
    "only render files are held to it",
  );
});

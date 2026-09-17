import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  forbiddenEdge,
  imports,
  layerViolations,
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
    "../online/rollback.js",
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

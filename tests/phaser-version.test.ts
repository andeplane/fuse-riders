import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("the Phaser internals the arena patches belong to the exact release that is installed", () => {
  // `arena.ts` cannot be imported here: Phaser needs a window. The constant is read from its source instead.
  const guarded = /export const GUARDED_PHASER_VERSION = "([^"]+)";/.exec(
    read("../src/render/phaser/arena.ts"),
  )?.[1];
  assert.ok(guarded, "arena.ts states the Phaser release its guard targets");
  // Phaser is bundled into the client, so it may be declared among either set of dependencies.
  const manifest = JSON.parse(read("../package.json")) as Record<
    "dependencies" | "devDependencies",
    Record<string, string> | undefined
  >;
  const declared =
    manifest.dependencies?.phaser ?? manifest.devDependencies?.phaser;
  const installed: string = JSON.parse(
    read("../node_modules/phaser/package.json"),
  ).version;
  const advice =
    "guardDefaultTextures (src/render/phaser/arena.ts) takes over two private READY listeners. After a Phaser upgrade, " +
    "check that the renderer's boot and Game.texturesReady are still the two listeners, in that order, run " +
    "`npx tsx scripts/phaser-browser.ts` in Chrome and WebKit, then update GUARDED_PHASER_VERSION.";
  assert.equal(
    declared,
    guarded,
    `package.json must pin Phaser exactly. ${advice}`,
  );
  assert.equal(installed, guarded, advice);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PICKUP_TYPES } from "../src/engine/game.js";
import { themes } from "../src/client/themes.js";

// Resolved from this file, not the working directory, so the test means the same run from anywhere.
const manifestPath = fileURLToPath(
  new URL("../public/themes/manifest.json", import.meta.url),
);
const themeFile = (id: string, file: string) =>
  fileURLToPath(new URL(`../public/themes/${id}/${file}`, import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  themes: Record<string, { label: string; path: string }>;
  sprites: Record<string, { file: string }>;
};

// Nothing loads the manifest at runtime, so it rots in silence: the gravity bomb shipped a whole release before
// anyone noticed it was absent here. A pickup with no entry is now a test failure rather than a stale document.
test("the manifest inventories every pickup the game has", () => {
  for (const type of PICKUP_TYPES) {
    assert.ok(
      manifest.sprites[`pickup-${type}`],
      `manifest.json has no entry for pickup-${type}`,
    );
  }
});
test("the manifest inventories no pickup the game lost", () => {
  const known = new Set(PICKUP_TYPES.map((type) => `pickup-${type}`));
  const strays = Object.keys(manifest.sprites).filter(
    (name) => name.startsWith("pickup-") && !known.has(name),
  );
  assert.deepEqual(
    strays,
    [],
    "manifest.json still inventories pickups that no longer exist",
  );
});
// The themes block is the next thing to rot the same way the sprite list did: a third ThemeId would leave the
// manifest describing two, and nothing would say so. This guard fixes no current defect; it prevents the next one.
test("the manifest describes exactly the themes the registry defines", () => {
  assert.deepEqual(
    Object.keys(manifest.themes).sort(),
    Object.keys(themes).sort(),
    "manifest.json and the themes registry disagree about which styles exist",
  );
  for (const theme of Object.values(themes)) {
    assert.equal(
      manifest.themes[theme.id]?.label,
      theme.label,
      `manifest.json mislabels ${theme.id}`,
    );
    assert.equal(
      manifest.themes[theme.id]?.path,
      `/themes/${theme.id}`,
      `manifest.json has the wrong path for ${theme.id}`,
    );
  }
});
test("every file the manifest names exists in every theme", () => {
  for (const theme of Object.values(themes)) {
    for (const [name, sprite] of Object.entries(manifest.sprites)) {
      assert.ok(
        existsSync(themeFile(theme.id, sprite.file)),
        `${theme.id} is missing ${sprite.file}, named by the manifest as ${name}`,
      );
    }
  }
});

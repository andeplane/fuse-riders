import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PICKUP_TYPES } from "../src/engine/game.js";
import { themes } from "../src/render/themes.js";

// Resolved from this file, not the working directory, so the test means the same run from anywhere.
const themeDirectory = (id: string) =>
  fileURLToPath(new URL(`../public/themes/${id}`, import.meta.url));

// Neither the compiler nor the renderers notice a pickup whose artwork was never drawn: Phaser logs a load error and the
// canvas quietly falls back to a generic glyph. This is the only check that a new type actually has a picture (#177).
test("every pickup type has artwork in every theme", () => {
  for (const theme of Object.values(themes)) {
    const files = new Set(readdirSync(themeDirectory(theme.id)));
    for (const type of PICKUP_TYPES) {
      assert.ok(
        files.has(`pickup-${type}.svg`),
        `${theme.id} is missing pickup-${type}.svg`,
      );
    }
  }
});
test("no theme ships artwork for a pickup the game does not have", () => {
  const known = new Set(PICKUP_TYPES.map((type) => `pickup-${type}.svg`));
  for (const theme of Object.values(themes)) {
    const strays = readdirSync(themeDirectory(theme.id)).filter(
      (file) =>
        file.startsWith("pickup-") && file.endsWith(".svg") && !known.has(file),
    );
    assert.deepEqual(
      strays,
      [],
      `${theme.id} ships artwork for pickups that no longer exist`,
    );
  }
});

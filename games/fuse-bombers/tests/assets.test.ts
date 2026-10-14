import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MUSIC_FILES } from "../src/app/audio/director.js";
import { SHARED_SPRITES } from "../src/render/sprites.js";

/** The site root's public/, which every game's page is served beside. */
const publicDir = fileURLToPath(new URL("../../../public/", import.meta.url));

test("every shared file the game loads is in the site root's public/", () => {
  const files = [
    ...Object.values(SHARED_SPRITES),
    ...Object.values(MUSIC_FILES),
  ];
  assert.equal(files.length, 7);
  for (const file of files) {
    assert.ok(!file.startsWith("/"), `${file} is relative to the site base`);
    assert.ok(existsSync(publicDir + file), `public/${file} exists`);
  }
});

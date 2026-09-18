import test from "node:test";
import assert from "node:assert/strict";
import { AVATAR_ATLAS } from "../src/render/avatar-atlas.js";
import {
  AVATARS,
  AVATAR_ATLAS_URL,
  avatarCell,
} from "../src/shared/avatars.js";

test("the scene's avatar sheet names every avatar the game accepts, in the image's order", () => {
  assert.deepEqual(
    [...AVATAR_ATLAS.frames],
    AVATARS.map((avatar) => avatar.id),
  );
  assert.equal(AVATAR_ATLAS.url, AVATAR_ATLAS_URL);
  assert.equal(
    AVATAR_ATLAS.columns * AVATAR_ATLAS.rows,
    AVATAR_ATLAS.frames.length,
  );
  // The DOM portraits (src/client/avatar-heads.ts) cut the same sheet through `avatarCell`.
  for (const [index, id] of AVATAR_ATLAS.frames.entries())
    assert.deepEqual(avatarCell(id), {
      column: index % AVATAR_ATLAS.columns,
      row: Math.floor(index / AVATAR_ATLAS.columns),
    });
});

import test from "node:test";
import assert from "node:assert/strict";
import { AVATAR_ATLAS } from "../src/render/avatar-atlas.js";
import {
  AVATARS,
  AVATAR_ATLAS_URL,
  AVATAR_COLUMNS,
  AVATAR_ROWS,
  RIDER_AVATARS,
  avatarCell,
  avatarCellPosition,
} from "../src/shared/avatars.js";
import { BOT_AVATAR, isRiderAvatarId } from "../src/engine/avatar-id.js";

test("the scene's avatar sheet names every avatar the game accepts, in the image's order", () => {
  assert.deepEqual(
    [...AVATAR_ATLAS.frames],
    AVATARS.map((avatar) => avatar.id),
  );
  assert.equal(AVATAR_ATLAS.url, AVATAR_ATLAS_URL);
  assert.deepEqual(
    [AVATAR_ATLAS.columns, AVATAR_ATLAS.rows],
    [AVATAR_COLUMNS, AVATAR_ROWS],
    "the scene and the DOM cut the same grid",
  );
  // The grid holds the heads and may have spare cells: eleven in five columns leaves four of the last row empty, and
  // the next head added goes into one of them without the sheet changing shape.
  assert.ok(
    AVATAR_ATLAS.frames.length <= AVATAR_ATLAS.columns * AVATAR_ATLAS.rows &&
      AVATAR_ATLAS.frames.length >
        AVATAR_ATLAS.columns * (AVATAR_ATLAS.rows - 1),
    `${AVATAR_ATLAS.frames.length} heads need exactly ${AVATAR_ATLAS.rows} rows of ${AVATAR_ATLAS.columns}`,
  );
  // The DOM portraits (games/fuse-riders/src/client/avatar-heads.ts) cut the same sheet through `avatarCell`.
  for (const [index, id] of AVATAR_ATLAS.frames.entries())
    assert.deepEqual(avatarCell(id), {
      column: index % AVATAR_ATLAS.columns,
      row: Math.floor(index / AVATAR_ATLAS.columns),
    });
  // And position it by proportion, which is not the same as `index / count`: with three rows the middle one is 50%.
  assert.equal(avatarCellPosition("robot"), "0% 0%");
  assert.equal(avatarCellPosition("mushroom"), "0% 100%");
  assert.equal(avatarCellPosition("skull"), "0% 50%");
  assert.equal(avatarCellPosition("slime"), "100% 50%");
});

test("the robot is the AI riders' head and no human wears it", () => {
  assert.equal(
    RIDER_AVATARS.some((avatar) => avatar.id === BOT_AVATAR),
    false,
    "the picker does not offer it",
  );
  assert.equal(
    RIDER_AVATARS.length,
    AVATARS.length - 1,
    "and offers everything else, which is still ten heads",
  );
  assert.equal(isRiderAvatarId(BOT_AVATAR), false);
  assert.equal(
    isRiderAvatarId("mushroom"),
    true,
    "its replacement in the grid",
  );
  assert.equal(isRiderAvatarId("nonsense"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { AVATARS, avatarCell } from "../src/shared/avatars.ts";
import { isAvatarId } from "../src/engine/avatar-id.ts";
import { parseClientMessage } from "../src/shared/protocol.ts";
import { addPlayer, createGame, toView } from "../src/engine/game.ts";
import { classicSettings } from "./fixtures/classic-settings.ts";

test("ten distinct avatar ids address exactly ten atlas cells", () => {
  assert.equal(AVATARS.length, 10);
  const cells = new Set<string>();
  AVATARS.forEach(({ id }, index) => {
    assert.ok(isAvatarId(id));
    assert.deepEqual(avatarCell(id), {
      column: index % 5,
      row: Math.floor(index / 5),
    });
    cells.add(JSON.stringify(avatarCell(id)));
    assert.deepEqual(
      parseClientMessage(
        JSON.stringify({ type: "join", name: "Rider", avatarId: id }),
      ),
      { type: "join", name: "Rider", avatarId: id },
    );
  });
  assert.equal(cells.size, 10);
  for (const invalid of [
    undefined,
    null,
    0,
    "",
    "ROBOT",
    "constructor",
    "../bad.png",
    {},
    [],
  ]) {
    assert.equal(isAvatarId(invalid), false);
    assert.deepEqual(avatarCell(invalid), { column: 0, row: 0 });
    if (invalid !== undefined)
      assert.equal(
        parseClientMessage(
          JSON.stringify({ type: "join", name: "Rider", avatarId: invalid }),
        ),
        null,
      );
  }
});

test("default and selected heads appear in authoritative snapshots without changing slot color", () => {
  const state = createGame("avatars", classicSettings());
  addPlayer(state, { id: "a", name: "A", slot: 0, color: "#22d3ee" });
  addPlayer(state, {
    id: "b",
    name: "B",
    slot: 1,
    color: "#ff4fa3",
    avatarId: "dragon",
  });
  const [a, b] = toView(state).players;
  assert.equal(a!.avatarId, "robot");
  assert.equal(b!.avatarId, "dragon");
  assert.equal(b!.color, "#ff4fa3");
});

test("live avatar messages only accept a known head and no player override", () => {
  for (const { id } of AVATARS)
    assert.deepEqual(
      parseClientMessage(JSON.stringify({ type: "setAvatar", avatarId: id })),
      { type: "setAvatar", avatarId: id },
    );
  for (const body of [
    { type: "setAvatar" },
    { type: "setAvatar", avatarId: "bad" },
    { type: "setAvatar", avatarId: "robot", playerId: "other" },
  ])
    assert.equal(parseClientMessage(JSON.stringify(body)), null);
});

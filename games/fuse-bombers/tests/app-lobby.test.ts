import test from "node:test";
import assert from "node:assert/strict";
import { Lobby } from "../src/app/lobby.js";

test("pressing joins the first free slot and pressing again leaves", () => {
  const lobby = new Lobby();
  assert.deepEqual(lobby.press("key:WASD"), { slot: 0, joined: true });
  assert.deepEqual(lobby.press("pad:0"), { slot: 1, joined: true });
  assert.deepEqual(lobby.press("key:WASD"), { slot: 0, joined: false });
  assert.deepEqual(lobby.press("key:IJKL"), { slot: 0, joined: true });
  assert.deepEqual(
    lobby.seats().map((s) => [s.name, s.tag]),
    [
      ["RED", "IJKL"],
      ["BLUE", "PAD 1"],
      ["GREEN", "BOT"],
      ["YELLOW", "BOT"],
    ],
  );
});

test("joining grows the player count, which cannot shrink below a seated human", () => {
  const lobby = new Lobby();
  lobby.setPlayerCount(2);
  for (const key of ["key:WASD", "key:IJKL", "key:ARROWS"] as const)
    lobby.press(key);
  assert.equal(lobby.playerCount, 3);
  lobby.setPlayerCount(2);
  assert.equal(lobby.playerCount, 3);
  lobby.setPlayerCount(9);
  assert.equal(lobby.playerCount, 6);
  for (const device of ["key:NUMPAD", "pad:0", "touch:0"] as const)
    lobby.press(device);
  assert.equal(lobby.press("pad:3"), undefined, "a full lobby ignores presses");
});

test("bot difficulty cycles per slot or for all bots; rounds to win are clamped", () => {
  const lobby = new Lobby();
  assert.equal(lobby.seats()[1]?.difficulty, "easy", "bots start easy");
  lobby.press("key:WASD");
  lobby.cycleDifficulty(2);
  assert.equal(lobby.seats()[2]?.difficulty, "normal");
  lobby.cycleDifficulty();
  assert.deepEqual(
    lobby.seats().map((s) => s.difficulty),
    ["normal", "normal", "normal", "normal"],
  );
  lobby.setWinsToWin(0);
  assert.equal(lobby.winsToWin, 1);
});

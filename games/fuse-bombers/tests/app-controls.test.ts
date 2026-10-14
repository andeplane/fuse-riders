import assert from "node:assert/strict";
import test from "node:test";
import { localControls } from "../src/app/controls.js";
import { Lobby } from "../src/app/lobby.js";

test("countdown guidance describes occupied seats and reserves arrows for their own rider", () => {
  const lobby = new Lobby();
  lobby.press("key:WASD");
  assert.deepEqual(localControls(lobby.seats()), [
    { keys: "WASD / arrows + Space", action: "RED: fly + fire / ghost bomb" },
  ]);
  lobby.press("key:ARROWS");
  assert.deepEqual(localControls(lobby.seats()), [
    { keys: "WASD + Space", action: "RED: fly + fire / ghost bomb" },
    { keys: "Arrow keys + /", action: "BLUE: fly + fire / ghost bomb" },
  ]);
});

test("touch and gamepad countdown guidance names the actual pilot devices", () => {
  const lobby = new Lobby();
  lobby.press("touch:1");
  lobby.press("pad:2");
  assert.deepEqual(localControls(lobby.seats()), [
    { keys: "TOUCH 2 D-pad + FIRE", action: "RED: fly + fire / ghost bomb" },
    {
      keys: "PAD 3 stick / D-pad + face button",
      action: "BLUE: fly + fire / ghost bomb",
    },
  ]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { FakeMesh } from "./fixtures/fake-mesh.js";
import { counterGame } from "./fixtures/counter-game.js";
test("start/rematch minimum defaults to two and may explicitly allow one, never zero", () => {
  for (const minPlayers of [undefined, 1]) {
    const mesh = new FakeMesh("host");
    const game = {
      ...counterGame,
      seating: {
        ...counterGame.seating,
        ...(minPlayers ? { minPlayers } : {}),
      },
    };
    const host = mesh.join("host", game);
    mesh.run(200);
    assert.equal(host.command({ type: "action", action: "start" }), false);
    host.command({ type: "join", name: "Keeper" });
    mesh.run(300);
    assert.equal(
      host.command({ type: "action", action: "start" }),
      minPlayers === 1,
    );
    const room = host.roomState()!;
    room.stage = "over";
    assert.equal(
      host.command({ type: "action", action: "rematch" }),
      minPlayers === 1,
    );
    host.stop();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { present } from "../src/app/presenter.js";
import { createArena } from "../src/engine/state.js";
import { view } from "../src/engine/view.js";

test("HUD shows countdown, launch, damage, spectating and corrected results from state", () => {
  const arena = createArena([
    { id: "solo", name: "You", slot: 0, bot: false },
    { id: "bot-1", name: "Sparks", slot: 1, bot: true },
  ]);
  const hud = () => present(view(arena.tick, "match", arena))!;
  assert.equal(present(view(0, "lobby", null)), undefined);
  assert.equal(hud().time, "02:00");
  assert.equal(hud().toast, "GET READY · 3");
  arena.tick = 60;
  arena.phase = "playing";
  assert.equal(hud().toast, "SPACE TO LAUNCH");
  arena.balls[0]!.held = null;
  arena.tick = 100;
  assert.equal(hud().toast, "");
  assert.equal(hud().time, "01:58");
  arena.bases[0]!.blocks[0]!.alive = false;
  assert.equal(hud().cards[0]!.armor, "47 / 48");
  arena.bases[0]!.alive = false;
  assert.equal(hud().cards[0]!.armor, "CORE LOST");
  assert.equal(hud().cards[0]!.label, "SPECTATING");
  assert.equal(hud().toast, "CORE LOST · WATCH THE FINISH");
  arena.phase = "over";
  arena.winner = "bot-1";
  assert.equal(hud().title, "SPARKS WINS");
  assert.equal(hud().toast, "");
  arena.winner = null;
  arena.tick = 2460;
  assert.equal(hud().title, "ROUND DRAW");
  assert.equal(hud().time, "00:00");
  // A corrected snapshot restores the player's armor and removes the speculative result.
  arena.bases[0]!.alive = true;
  arena.bases[0]!.blocks[0]!.alive = true;
  arena.phase = "playing";
  assert.equal(hud().over, false);
  assert.equal(hud().cards[0]!.armor, "48 / 48");
  arena.bases[0]!.bot = true;
  assert.equal(hud().result, "Last core standing wins");
});

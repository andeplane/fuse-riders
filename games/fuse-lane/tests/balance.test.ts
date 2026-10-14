import test from "node:test";
import assert from "node:assert/strict";
import { ACTION } from "fuse-netcode";
import {
  BOT_STYLES,
  botStyle,
  createRoom,
  type FuseLaneRoom,
} from "../src/game/index.js";
import { TURNS, addBot, fold, runWhile } from "./fixtures/lane.js";

/**
 * A guard on the balance pass (scripts/fuse-lane-balance.ts has the full numbers): a match of four hard bots at the
 * Standard goals ends in the 20s of weeks, not in a dozen or never. A change that moves this is a balance change.
 */
function botMatch(seed: string): FuseLaneRoom {
  const room = createRoom(seed, TURNS);
  fold(room, {
    a: [0, 1, 2, 3].map((slot) => addBot(`bot:${slot + 1}`, slot)),
  });
  fold(room, { a: [[ACTION, "start", seed]] });
  runWhile(room, () => room.stage === "running", 20_000);
  return room;
}

test("four hard bots finish a Standard match in roughly 20-35 weeks", () => {
  for (const seed of ["balance-a", "balance-b", "balance-c"]) {
    const room = botMatch(seed);
    assert.equal(room.stage, "over", seed);
    assert.ok(room.week >= 18 && room.week <= 36, `${seed}: week ${room.week}`);
    assert.equal(room.winners.length, 1);
  }
});

test("every match deals its bots four different styles", () => {
  const room = botMatch("styles");
  const styles = Object.keys(room.players).map((id) => botStyle(room, id).name);
  assert.equal(new Set(styles).size, BOT_STYLES.length);
});

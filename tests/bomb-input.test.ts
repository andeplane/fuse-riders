import assert from "node:assert/strict";
import test from "node:test";
import {
  BombInputBuffer,
  MAX_PENDING_BOMB_ACTIONS,
} from "../src/shared/bomb-input.js";

test("ordered bomb edges survive a between-tick tap, while held resends do not repeat presses", () => {
  const buffer = new BombInputBuffer();
  buffer.accept(true, "press");
  buffer.accept(true);
  buffer.accept(true, "press");
  buffer.accept(false, "release");
  buffer.accept(false, "release");
  assert.deepEqual(buffer.drain(), ["press", "release"]);
  assert.deepEqual(buffer.drain(), []);
});

test("interruption discards even a queued release and requires a neutral handshake", () => {
  const buffer = new BombInputBuffer();
  buffer.accept(true, "press");
  buffer.accept(false, "release");
  buffer.cancel(true);
  buffer.accept(true, "press");
  assert.deepEqual(buffer.drain(), ["cancel"]);
  buffer.accept(false);
  buffer.accept(true, "press");
  assert.deepEqual(buffer.drain(), ["cancel", "press"]);
  buffer.accept(false, "cancel");
  assert.deepEqual(buffer.drain(), ["cancel"]);
  buffer.accept(true, "press");
  buffer.accept(false);
  assert.deepEqual(
    buffer.drain(),
    ["cancel"],
    "unmarked neutral input cannot launch",
  );
});

test("overflow cancels the bounded queue and a later fresh press can recover", () => {
  const buffer = new BombInputBuffer();
  for (let index = 0; index < MAX_PENDING_BOMB_ACTIONS / 2; index++) {
    buffer.accept(true, "press");
    buffer.accept(false, "release");
  }
  buffer.accept(true, "press");
  assert.deepEqual(buffer.drain(), ["cancel"]);
  buffer.accept(false, "release");
  assert.deepEqual(buffer.drain(), []);
  buffer.accept(true, "press");
  assert.deepEqual(buffer.drain(), ["press"]);
});

test("commands drain as bare actions in order across held resends, and a cancel replaces the queue", () => {
  const buffer = new BombInputBuffer();
  buffer.accept(true, "press");
  buffer.accept(true);
  buffer.accept(false, "release");
  buffer.accept(true, "press");
  assert.deepEqual(buffer.drainCommands(), [
    { action: "press" },
    { action: "release" },
    { action: "press" },
  ]);
  buffer.accept(false, "release");
  assert.deepEqual(buffer.drainCommands(), [{ action: "release" }]);
  buffer.accept(true, "press");
  assert.deepEqual(buffer.drainCommands(), [{ action: "press" }]);
  buffer.cancel();
  assert.deepEqual(buffer.drainCommands(), [{ action: "cancel" }]);
});

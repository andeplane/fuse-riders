import assert from "node:assert/strict";
import test from "node:test";
import {
  BombInputBuffer,
  MAX_PENDING_BOMB_ACTIONS,
} from "../src/engine/bomb-input.js";

// The buffer is the gesture core (`src/engine/bomb-gesture.ts`) behind a device's frames. Its semantics are the log
// fold's, which `tests/bomb-input-differential.test.ts` holds it to stream by stream; these are the cases by hand.
// Until #253 A3 it was the LAN server's own state machine: it ignored a press over a held button, cancelled on an
// unheld frame, wiped its queue on a cancel and wanted a neutral frame after an interruption. The log never did.

test("ordered bomb edges survive a between-tick tap; frames without an edge add nothing", () => {
  const buffer = new BombInputBuffer();
  buffer.accept("press");
  buffer.accept();
  buffer.accept();
  buffer.accept("release");
  buffer.accept("release");
  assert.deepEqual(buffer.drain(), ["press", "release"]);
  assert.deepEqual(buffer.drain(), []);
});

test("a press over a held gesture abandons it first, as every replica folds it", () => {
  const buffer = new BombInputBuffer();
  buffer.accept("press");
  buffer.accept("press");
  assert.deepEqual(buffer.drain(), ["press", "cancel", "press"]);
  buffer.accept("release");
  assert.deepEqual(buffer.drain(), ["release"]);
});

test("an interruption abandons the held gesture and nothing else; an idle cancel or release is nothing", () => {
  const buffer = new BombInputBuffer();
  buffer.accept("press");
  buffer.accept("release");
  buffer.cancel();
  assert.deepEqual(
    buffer.drain(),
    ["press", "release"],
    "the launch already happened; there is nothing left to abandon",
  );
  buffer.accept("press");
  buffer.cancel();
  buffer.accept("release");
  assert.deepEqual(
    buffer.drain(),
    ["press", "cancel"],
    "an abandoned charge cannot launch",
  );
  buffer.accept("cancel");
  buffer.accept("release");
  assert.deepEqual(buffer.drain(), []);
  buffer.accept("press");
  assert.deepEqual(buffer.drain(), ["press"], "no handshake is owed");
});

test("overflow drops the tick's queue for one cancel and a later fresh press recovers", () => {
  const buffer = new BombInputBuffer();
  for (let index = 0; index < MAX_PENDING_BOMB_ACTIONS / 2; index++) {
    buffer.accept("press");
    buffer.accept("release");
  }
  assert.equal(buffer.drain().length, MAX_PENDING_BOMB_ACTIONS, "at the bound");
  for (let index = 0; index < MAX_PENDING_BOMB_ACTIONS / 2; index++) {
    buffer.accept("press");
    buffer.accept("release");
  }
  buffer.accept("press");
  assert.deepEqual(buffer.drain(), ["cancel"]);
  buffer.accept("release");
  assert.deepEqual(buffer.drain(), []);
  buffer.accept("press");
  assert.deepEqual(buffer.drain(), ["press"]);
});

test("target input: a release carries its own aim despite later frames and caller mutation", () => {
  const buffer = new BombInputBuffer();
  const first = { x: 0.1, y: 0.2 };
  buffer.accept("press", first);
  first.x = 1;
  buffer.accept(undefined, { x: 0.3, y: 0.4 });
  const released = { x: 0.5, y: 0.6 };
  buffer.accept("release", released);
  released.x = 1;
  buffer.accept("press", { x: 0.7, y: 0.8 });
  assert.deepEqual(buffer.drainCommands(), [
    // A device logs the press before the aim of the same frame, so the press is unaimed; `step` reads the aim of a
    // charging Target Bomb from the tick's intent.
    { action: "press" },
    { action: "release", aim: { x: 0.5, y: 0.6 } },
    { action: "press" },
  ]);
  buffer.accept("release");
  assert.deepEqual(buffer.drainCommands(), [
    { action: "release", aim: { x: 0.7, y: 0.8 } },
  ]);
  buffer.accept("press");
  assert.deepEqual(buffer.drainCommands(), [{ action: "press" }]);
  buffer.cancel();
  assert.deepEqual(buffer.drainCommands(), [{ action: "cancel" }]);
});

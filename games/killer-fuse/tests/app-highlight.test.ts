import test from "node:test";
import assert from "node:assert/strict";
import {
  HIGHLIGHT_MS,
  highlightUntil,
  type UnitSnap,
} from "../src/app/highlight.js";

const snap = (patch: Partial<UnitSnap> = {}): UnitSnap => ({
  game: "m1:1",
  live: true,
  dead: false,
  kind: "worker",
  speed: false,
  ...patch,
});

test("the outline lasts three seconds from when play starts", () => {
  assert.equal(HIGHLIGHT_MS, 3_000);
  const counting = snap({ live: false });
  assert.equal(
    highlightUntil(undefined, counting, 100, 0),
    0,
    "not during the countdown",
  );
  assert.equal(highlightUntil(counting, snap(), 500, 0), 3_500, "play starts");
  assert.equal(
    highlightUntil(undefined, snap(), 500, 0),
    3_500,
    "joined mid-game",
  );
  assert.equal(
    highlightUntil(snap(), snap(), 900, 3_500),
    3_500,
    "nothing new",
  );
  assert.equal(
    highlightUntil(snap(), snap({ game: "m1:2" }), 9_000, 3_500),
    12_000,
    "the next game is a new spawn",
  );
  assert.equal(
    highlightUntil(snap(), undefined, 900, 3_500),
    0,
    "no unit, no outline",
  );
});

test("a respawn and a transformation light it again; a death does not", () => {
  const dead = snap({ dead: true, kind: "warrior" });
  assert.equal(highlightUntil(snap({ kind: "warrior" }), dead, 1_000, 0), 0);
  assert.equal(
    highlightUntil(dead, snap(), 4_000, 0),
    7_000,
    "back from the dead, a Worker again",
  );
  assert.equal(
    highlightUntil(snap(), snap({ kind: "warrior" }), 5_000, 0),
    8_000,
  );
  assert.equal(highlightUntil(snap(), snap({ speed: true }), 5_000, 0), 8_000);
  assert.equal(
    highlightUntil(dead, snap({ dead: true }), 5_000, 42),
    42,
    "a change while dead is not a transformation",
  );
});

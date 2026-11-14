import test from "node:test";
import assert from "node:assert/strict";
import type { Frame } from "fuse-netcode";
import { view, type Room, type View } from "../src/online/index.js";
import { present, type Viewer } from "../src/app/presenter.js";
import {
  ROOM_CAPACITY,
  TEAM_COLORS,
  roomSeatRows,
  slotColor,
  slotLabel,
} from "../src/app/room-model.js";
import { ID, fold, join, lobby, started } from "./fixtures/room.js";

const viewer = (patch: Partial<Viewer> = {}): Viewer => ({
  me: "a",
  solo: false,
  display: false,
  ...patch,
});
const frame = (room: Room, managerId = "a"): Frame<View> => ({
  ...view(room),
  managerId,
});
const rows = (room: Room, who: Partial<Viewer> = {}) =>
  roomSeatRows(present(frame(room), viewer(who)));

test("six numbered slots, coloured and named for the two teams", () => {
  assert.equal(ROOM_CAPACITY, 6);
  // The label also says what the role does: the slot is where a player chooses, so it cannot assume they know.
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(slotLabel), [
    "Cyan Queen · flies, fights",
    "Pink Queen · flies, fights",
    "Cyan Worker · berries, snail, gates",
    "Pink Worker · berries, snail, gates",
    "Cyan Worker · berries, snail, gates",
    "Pink Worker · berries, snail, gates",
  ]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(slotColor), [
    TEAM_COLORS[0],
    TEAM_COLORS[1],
    TEAM_COLORS[0],
    TEAM_COLORS[1],
    TEAM_COLORS[0],
    TEAM_COLORS[1],
  ]);
});

test("only the seats people hold become rows; the engine's bots leave their slots open", () => {
  const room = lobby();
  const seated = rows(room);
  assert.deepEqual(
    seated.map((row) => [row.id, row.slot, row.name, row.color]),
    [
      ["a", 0, "Ada (you)", TEAM_COLORS[0]],
      ["b", 1, "Bo", TEAM_COLORS[1]],
    ],
  );
  // The slot itself names the role, so a row's status line carries only what is pending about the seat.
  assert.deepEqual(
    seated.map((row) => row.status),
    ["", ""],
  );
  // The other four slots carry no row at all: the layout shows them open, and the engine plays them.
  assert.equal(seated.length < ROOM_CAPACITY, true);
});

test("a row keeps its slot number after a player in a lower slot leaves", () => {
  const room = lobby();
  fold(room, { a: [join(ID.c, "Cy", 4)] });
  assert.deepEqual(
    rows(room).map((row) => [row.name, row.slot]),
    [
      ["Ada (you)", 0],
      ["Bo", 1],
      ["Cy", 4],
    ],
  );
});

test("the swap action and its button text travel with the row", () => {
  const room = lobby();
  const mine = rows(room);
  assert.deepEqual(
    mine.map((row) => [row.action, row.label]),
    [
      ["none", ""],
      ["ask", "ASK TO SWAP"],
    ],
  );
  // Once play has begun, no seat offers a swap.
  const playing = rows(started());
  assert.deepEqual(
    playing.map((row) => row.action),
    ["none", "none"],
  );
});

test("a watcher sees the seated players but holds no row of their own", () => {
  const room = lobby();
  const seen = rows(room, { me: "z" });
  assert.deepEqual(
    seen.map((row) => [row.id, row.name]),
    [
      ["a", "Ada"],
      ["b", "Bo"],
    ],
  );
});

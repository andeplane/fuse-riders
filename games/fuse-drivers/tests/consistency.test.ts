import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  JOIN,
  LEAVE,
  PRESENCE,
  SETTINGS,
  packMessage,
  unpackMessage,
} from "fuse-netcode";
import {
  HOLD,
  MAX_ROUNDS,
  ROLL,
  TARGET,
  createRoom,
  fuseDriversGame,
  fuseDriversView,
  isFuseDriversEntry,
  matchResult,
  roundResult,
  type FuseDriversRoom,
} from "../src/game/index.js";
import { FAST, fold, rig, runTo, started } from "./fixtures/fuseDrivers.js";

const { encode, decode } = fuseDriversGame.checkpoint;
const roundTrip = (room: FuseDriversRoom) =>
  decode(unpackMessage(packMessage(encode(room))) as unknown[], room.tick);

test("a seat that joins mid-round and banks points keeps the room decodable", () => {
  const room = started();
  fold(room, { a: [[JOIN, "c", "Cy", 2, "owl", 1]] });
  fold(room, { a: [[HOLD, 1]] });
  fold(room, { b: [[HOLD, 2]] });
  assert.equal(room.turn, "c");
  rig(room, 3);
  fold(room, { c: [[ROLL, 3]] });
  fold(room, { c: [[HOLD, 3]] });
  assert.equal(room.scores.c, 3);
  const decoded = roundTrip(room);
  assert.ok(decoded, "the checkpoint decodes mid-round");
  assert.equal(fuseDriversGame.hash(decoded), fuseDriversGame.hash(room));
  // And once c wins the round, its receipt names it.
  room.scores.c = TARGET;
  fold(room, { a: [[HOLD, room.turnNo]] });
  fold(room, { b: [[HOLD, room.turnNo]] });
  fold(room, { c: [[HOLD, room.turnNo]] });
  assert.equal(room.roundWinner, "c");
  assert.equal(roundResult(room, 1)!.players.at(-1)!.name, "Cy");
});

test("the entry boundary and the checkpoint accept the same match ids", () => {
  const room = started();
  for (const matchId of [
    "m1",
    "a".repeat(64),
    "a b",
    "é",
    "a".repeat(65),
    "",
  ]) {
    const entry = isFuseDriversEntry([1, 1, ACTION, "start", matchId]);
    const probe = structuredClone(room);
    probe.matchId = matchId;
    assert.equal(
      roundTrip(probe) !== undefined,
      entry,
      JSON.stringify(matchId),
    );
  }
  assert.equal(isFuseDriversEntry([1, 1, ACTION, "start", "a b"]), false);
});

test("members come in slot then id order, before and after a checkpoint", () => {
  const room = createRoom("m0", FAST);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 1, "fox", 1],
      [JOIN, "z", "Zed", 0, "cat", 1],
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  const ids = (from: FuseDriversRoom) =>
    [...fuseDriversGame.members(from)].map((seat) => seat.id);
  assert.deepEqual(ids(room), ["z", "a"]);
  assert.deepEqual(ids(roundTrip(room)!), ids(room));
});

test("settings logged during a match take effect at the next match", () => {
  const room = started();
  fold(room, { a: [[SETTINGS, { turnTicks: 100, display: false }]] });
  rig(room, 4);
  fold(room, { a: [[ROLL, 1]] });
  assert.equal(
    room.deadline,
    room.tick + FAST.turnTicks,
    "the turn keeps its timer",
  );
  assert.equal(fuseDriversView(room).turnTicks, FAST.turnTicks);
  assert.equal(
    fuseDriversGame.settings(room).turnTicks,
    100,
    "the lobby sees the change",
  );
  fold(room, { a: [[ACTION, "lobby", "m2"]] });
  fold(room, { a: [[ACTION, "start", "m2"]] });
  assert.equal(room.deadline, room.tick + 100);
});

test("seat churn cannot run a match past MAX_ROUNDS: the bound ends it, and the room still decodes", () => {
  const room = started();
  let next = 0;
  for (let round = 1; room.stage !== "over"; round++) {
    assert.ok(round <= MAX_ROUNDS, "the match ends by the bound");
    // "a" (who manages the room) wins once; after that it passes, and whoever is next wins.
    if (room.turn === "a" && room.wins.a)
      fold(room, { a: [[HOLD, room.turnNo]] });
    const winner = room.turn;
    room.scores[winner] = TARGET;
    fold(room, { [winner]: [[HOLD, room.turnNo]] });
    assert.equal(room.wins[winner], 1);
    if (room.winner) break;
    if (winner === "a") {
      runTo(room, room.resumeAt);
      continue;
    }
    // The winner leaves between rounds and someone new sits down in its place.
    const slot = room.seats.get(winner)!.slot,
      id = `n${++next}`;
    fold(room, { a: [[LEAVE, winner]] });
    fold(room, { a: [[JOIN, id, `New ${next}`, slot, "owl", 1]] });
    runTo(room, room.resumeAt);
  }
  assert.equal(room.round, MAX_ROUNDS);
  assert.equal(room.history.length, MAX_ROUNDS);
  assert.ok(room.winner);
  assert.ok(matchResult(room));
  const decoded = roundTrip(room);
  assert.ok(decoded, "the finished room decodes");
  assert.equal(fuseDriversGame.hash(decoded), fuseDriversGame.hash(room));
});

test("receipts are frozen when a round or the match is decided", () => {
  const room = started();
  room.scores.a = TARGET;
  fold(room, { a: [[HOLD, 1]] });
  const round = roundResult(room, 1);
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  assert.deepEqual(
    roundResult(room, 1),
    round,
    "a later disconnect changes nothing",
  );
  fold(room, { a: [[PRESENCE, "b", true, 1]] });
  runTo(room, room.resumeAt);
  assert.equal(room.turn, "b");
  fold(room, { b: [[HOLD, room.turnNo]] });
  room.scores.a = TARGET;
  fold(room, { a: [[HOLD, room.turnNo]] });
  assert.equal(room.stage, "over");
  const match = matchResult(room);
  assert.deepEqual(match!.finishers, ["a", "b"]);
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  fold(room, { a: [[LEAVE, "b"]] });
  assert.deepEqual(matchResult(room), match);
  assert.deepEqual(roundResult(room, 1), round);
  const decoded = roundTrip(room)!;
  assert.deepEqual(matchResult(decoded), match);
});

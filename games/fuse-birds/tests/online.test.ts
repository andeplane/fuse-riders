import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  JOIN,
  PRESENCE,
  World,
  SnapshotAssembler,
  encodeSnapshot,
  decodeSnapshot,
  MAX_SNAPSHOT_BYTES,
  type StreamEntries,
} from "fuse-netcode";
import {
  birdsGame,
  decodeRoom,
  encodeRoom,
  foldTick,
  hashRoom,
  isBirdsEntry,
  type BirdsEntry,
  type BirdsRoom,
} from "../src/online/game.js";
function tick(
  room: BirdsRoom,
  entries: BirdsEntry[] = [],
  actor = "a",
  generation = 1,
): void {
  foldTick(room, "a", new Map([[actor, { generation, entries }]]));
}
function roomReady(): BirdsRoom {
  const room = birdsGame.createRoom("lobby", { display: false });
  tick(room, [
    [1, 1, JOIN, "a", "Alpha", 0, "owl", 1],
    [2, 1, JOIN, "b", "Beta", 1, "owl", 1],
  ]);
  tick(room, [[3, 2, ACTION, "start", "match-1"]]);
  for (let i = 0; room.match?.phase === "preparing" && i < 3000; i++)
    tick(room);
  assert.equal(room.match?.phase, "aiming");
  return room;
}
test("terrain checkpoints survive the real MessagePack snapshot transport", () => {
  const room = roomReady();
  tick(room, [launch(room)]);
  const world = new World(birdsGame, room, "a", "a"),
    assembler = new SnapshotAssembler(birdsGame, 42);
  let result: ReturnType<SnapshotAssembler["accept"]>;
  for (const chunk of encodeSnapshot(world, 42))
    result = assembler.accept(chunk);
  assert.ok(result!);
  assert.ok(result.bytes.length < MAX_SNAPSHOT_BYTES);
  const decoded = decodeSnapshot(birdsGame, result.bytes, 42);
  assert.ok(decoded);
  assert.equal(hashRoom(decoded.state), hashRoom(room));
});
function launch(room: BirdsRoom, actor = "a"): BirdsEntry {
  const match = room.match!,
    w = match.preparation.witnesses.find(
      (w) => w.from === "a" && w.wind === match.wind,
    )!;
  return [
    4,
    room.tick + 1,
    0,
    room.matchId,
    {
      type: "launch",
      actor,
      round: match.round,
      turn: match.turn,
      ordinal: 1,
      weapon: "scatter",
      vx: w.vx,
      vy: w.vy,
    },
  ];
}
test("online fold starts the same library, advances exactly three steps and checkpoints flight", () => {
  const room = roomReady(),
    before = birdsGame.clock(room);
  tick(room, [launch(room)]);
  assert.equal(birdsGame.clock(room), before + 3);
  assert.equal(room.match!.players[0]!.ammo, 2);
  const decoded = decodeRoom(encodeRoom(room), room.tick);
  assert.ok(decoded);
  assert.equal(hashRoom(decoded), hashRoom(room));
  for (let i = 0; i < 240; i++) {
    tick(room);
    tick(decoded);
  }
  assert.equal(hashRoom(decoded), hashRoom(room));
});
test("an opponent cannot submit another bird's launch and a retired generation cannot act after presence changes", () => {
  const room = roomReady();
  tick(room, [launch(room)], "b");
  assert.equal(room.match!.players[0]!.ammo, 3);
  const entry = launch(room);
  const streams = new Map<string, StreamEntries<BirdsEntry>>([
    [
      "a",
      {
        generation: 2,
        entries: [[5, room.tick + 1, PRESENCE, "a", true, 2]],
        retired: [{ generation: 1, entries: [entry] }],
      },
    ],
  ]);
  foldTick(room, "a", streams);
  assert.equal(room.match!.players[0]!.ammo, 3);
  tick(room, [launch(room)], "a", 2);
  assert.equal(room.match!.players[0]!.ammo, 2);
});
test("checkpoint rejects invalid room clocks, seat collisions and mismatched match scope", () => {
  const room = roomReady(),
    good = hashRoom(room);
  assert.equal(decodeRoom(encodeRoom(room), room.tick + 1), undefined);
  const seats = encodeRoom(room);
  seats[1] = [
    ["a", "A", 0, "owl", true, false, 1, false],
    ["b", "B", 0, "owl", true, false, 1, false],
  ];
  assert.equal(decodeRoom(seats, room.tick), undefined);
  const wrongId = encodeRoom(room);
  wrongId[0] = ["other", "running", room.startedAt];
  assert.equal(decodeRoom(wrongId, room.tick), undefined);
  assert.equal(hashRoom(room), good);
});
test("wire guard refuses unsupported bots and malformed vectors", () => {
  assert.equal(isBirdsEntry([1, 1, 15, "add", "bot", "Bot", 0]), false);
  assert.equal(
    isBirdsEntry([
      1,
      1,
      0,
      "match",
      {
        type: "launch",
        actor: "a",
        round: 1,
        turn: 1,
        ordinal: 1,
        weapon: "scatter",
        vx: NaN,
        vy: -100,
      },
    ]),
    false,
  );
  assert.equal(isBirdsEntry([1, 1, JOIN, "a.b", "Alpha", 0, "owl", 1]), true);
});
test("a rematch resets inventory and rotates the opening player", () => {
  const room = roomReady();
  for (let i = 0; room.stage === "running" && i < 4000; i++) {
    const match = room.match!,
      player = match.players[match.active]!;
    tick(
      room,
      match.phase === "aiming"
        ? [
            [
              i + 10,
              room.tick + 1,
              0,
              room.matchId,
              {
                type: "pass",
                actor: player.id,
                round: match.round,
                turn: match.turn,
                ordinal: player.ordinal + 1,
              },
            ],
          ]
        : [],
      player.id,
    );
  }
  assert.equal(room.stage, "over");
  tick(room, [[5000, room.tick + 1, ACTION, "rematch", "match-2"]]);
  assert.equal(room.stage, "running");
  assert.equal(room.match!.round, 2);
  assert.equal(room.match!.active, 1);
  assert.ok(room.match!.players.every((p) => p.ammo === 3 && p.hp === 100));
  assert.ok(decodeRoom(encodeRoom(room), room.tick));
});

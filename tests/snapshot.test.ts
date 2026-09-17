import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SNAPSHOT_BYTES,
  SNAPSHOT_CHUNK_BYTES,
  SnapshotAssembler,
  decodeSnapshot,
  encodeSnapshot,
} from "../src/online/snapshot.js";
import { World } from "../src/online/rollback.js";
import { packMessage, unpackMessage } from "../src/online/packet.js";
import { decodeGameState, encodeGameState } from "../src/online/checkpoint.js";
import {
  ACTION,
  BOT,
  JOIN,
  PRESS,
  STEER,
  type Entry,
} from "../src/shared/input-log.js";
import {
  RULES,
  createRoomState,
  hashRoomState,
} from "../src/shared/apply-tick.js";
import { defaultRoomSettings } from "../src/shared/room-settings.js";
import {
  COUNTDOWN_TICKS,
  addPlayer,
  createGame,
  startMatch,
  step,
  SLOT_COLORS,
} from "../src/shared/game.js";

const ROOM = 42;
function playingWorld(): World {
  const w = new World(
    createRoomState("m", defaultRoomSettings()),
    "creator",
    "creator",
  );
  const creator = w.stream("creator", 1),
    guest = w.stream("guest", 2);
  creator.append(1, [JOIN, "creator", "Creator", 0, "fox", 1]);
  creator.append(1, [JOIN, "guest", "Guest", 1, "cat", 2]);
  creator.append(1, [BOT, "add", "bot:1", "AI Hopper", 2]);
  creator.append(2, [ACTION, "start", "m"]);
  guest.receive(
    [
      [1, 5, PRESS, 1] as Entry,
      [2, 70, STEER, 1] as Entry,
      [4, 80, STEER, 2] as Entry,
    ],
    4,
    62,
    80,
    0,
  );
  creator.through = 75;
  guest.through = 62;
  w.advance(75);
  assert.equal(w.state.game.phase, "playing");
  assert.equal(w.tick, 75);
  return w;
}

test("a snapshot carries the world, folds, bots and every stream past its base, in bounded chunks, and installs identically", () => {
  const w = playingWorld();
  const chunks = encodeSnapshot(w, ROOM);
  // The guest stream is complete through 62, so the snapshot is the retained state at 60, not the speculative 75.
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]!.tick, 60);
  assert.equal(chunks[0]!.rules, RULES);
  const assembler = new SnapshotAssembler(ROOM),
    complete = assembler.accept(chunks[0]);
  assert.ok(complete);
  assert.equal(complete.tick, 60);
  const decoded = decodeSnapshot(complete.bytes, ROOM)!;
  assert.ok(decoded);
  assert.equal(hashRoomState(decoded.state), w.hashAt(60));
  assert.deepEqual(decoded.state.bots, new Set(["bot:1"]));
  assert.deepEqual(decoded.state.folds.get("guest"), {
    generation: 2,
    flags: 0,
    activeGesture: 1,
    latestGesture: 1,
  });
  const guest = decoded.streams.find((stream) => stream.id === "guest")!;
  assert.deepEqual(
    { generation: guest.generation, seq: guest.seq, gesture: guest.gesture },
    { generation: 2, seq: 1, gesture: 1 },
  );
  assert.deepEqual(
    guest.entries,
    [
      [2, 70, STEER, 1],
      [4, 80, STEER, 2],
    ],
    "the entries after the served tick, gap included, are replayed by the joiner",
  );
  const joiner = new World(decoded.state, "creator", "joiner");
  for (const stream of decoded.streams) {
    const log = joiner.stream(stream.id, stream.generation, {
      seq: stream.seq,
      tick: 60,
      gesture: stream.gesture,
    });
    if (stream.entries.length)
      log.receive(stream.entries, stream.entries.at(-1)![0], 75, 200, 60);
  }
  joiner.streams
    .get("guest")!
    .receive([[3, 76, STEER, 3] as Entry], 4, 90, 90, 75);
  w.streams.get("guest")!.receive([[3, 76, STEER, 3] as Entry], 4, 90, 90, 75);
  for (const world of [w, joiner]) {
    world.streams.get("creator")!.through = 90;
    world.streams.get("guest")!.through = 90;
    world.advance(90);
  }
  assert.equal(
    hashRoomState(joiner.state),
    hashRoomState(w.state),
    "snapshot plus replay equals the original fold",
  );
});

test("large snapshots are chunked at 16 KB and reassembled only in order", () => {
  const w = playingWorld();
  w.streams.get("guest")!.receive([[3, 76, STEER, 3] as Entry], 4, 80, 80, 75);
  w.streams.get("creator")!.through = 80; // Every stream complete: the current state is served.
  for (const player of w.state.game.players.values())
    player.trail = Array.from({ length: 700 }, (_, i) => ({
      x1: i,
      y1: 1,
      x2: i + 1,
      y2: 2,
      createdTick: 1,
      expiresAtTick: 9999,
    }));
  const chunks = encodeSnapshot(w, ROOM);
  assert.equal(chunks[0]!.tick, 75);
  assert.ok(chunks.length > 3);
  assert.ok(
    chunks.every(
      (chunk) => chunk.data.length <= (SNAPSHOT_CHUNK_BYTES * 4) / 3 + 4,
    ),
  );
  const assembler = new SnapshotAssembler(ROOM);
  for (const chunk of chunks.slice(0, -1))
    assert.equal(assembler.accept(chunk), undefined);
  assert.equal(
    assembler.accept(chunks[1]),
    undefined,
    "a repeated chunk drops the transfer",
  );
  for (const chunk of chunks.slice(0, -1)) assembler.accept(chunk);
  const complete = assembler.accept(chunks.at(-1))!;
  assert.ok(complete);
  assert.ok(decodeSnapshot(complete.bytes, ROOM));
  for (const bad of [
    { ...chunks[0], rules: "other" },
    { ...chunks[0], room: ROOM + 1 },
    { ...chunks[0], chunk: 9 },
    { ...chunks[0], total: 0 },
    { ...chunks[0], data: 5 },
    { type: "snapshot" },
    null,
    "x",
    { ...chunks[0], total: 1000 },
  ])
    assert.equal(assembler.accept(bad), undefined);
  const skipped = new SnapshotAssembler(ROOM);
  skipped.accept(chunks[0]);
  assert.equal(skipped.accept({ ...chunks[2] }), undefined);
  assert.equal(skipped.accept({ ...chunks[1], tick: 7 }), undefined);
  const garbage = new SnapshotAssembler(ROOM);
  assert.equal(
    garbage.accept({ ...chunks[0], total: 1, data: "@@@" }),
    undefined,
  );
  assert.equal(
    decodeSnapshot(new Uint8Array(MAX_SNAPSHOT_BYTES + 1), ROOM),
    undefined,
  );
});

test("foreign rules on any snapshot chunk discard the transfer and allow a fresh retry", () => {
  const [snapshot] = encodeSnapshot(playingWorld(), ROOM);
  assert.ok(snapshot);
  assert.equal(snapshot.total, 1);
  // Split a real payload into three chunks so the first, middle and final
  // envelope guards are tested independently of decodeSnapshot's rules guard.
  const span = Math.ceil(snapshot.data.length / 3);
  const chunks = Array.from({ length: 3 }, (_, chunk) => ({
    ...snapshot,
    chunk,
    total: 3,
    data: snapshot.data.slice(chunk * span, (chunk + 1) * span),
  }));
  const expected = new SnapshotAssembler(ROOM).accept(snapshot);
  assert.ok(expected);

  for (const foreignIndex of [0, 1, 2]) {
    const assembler = new SnapshotAssembler(ROOM);
    for (const [index, chunk] of chunks.entries()) {
      assert.equal(
        assembler.accept(
          index === foreignIndex ? { ...chunk, rules: "other" } : chunk,
        ),
        undefined,
        `foreign rules on chunk ${foreignIndex} must prevent completion`,
      );
    }
    if (foreignIndex > 0) {
      for (const chunk of chunks.slice(foreignIndex)) {
        assert.equal(
          assembler.accept(chunk),
          undefined,
          "corrected continuation cannot revive a discarded transfer",
        );
      }
    }
    for (const chunk of chunks.slice(0, -1))
      assert.equal(assembler.accept(chunk), undefined);
    const complete = assembler.accept(chunks.at(-1));
    assert.deepEqual(complete, expected, "a fresh retry reassembles exactly");
    assert.ok(decodeSnapshot(complete!.bytes, ROOM));
  }
});

test("snapshot validation rejects foreign rules and rooms, corrupt state, inconsistent folds, bots, streams and hashes", () => {
  const w = playingWorld(),
    bytes = new SnapshotAssembler(ROOM).accept(
      encodeSnapshot(w, ROOM)[0],
    )!.bytes;
  const fields = unpackMessage(bytes) as unknown[];
  const mutate = (change: (value: unknown[]) => void) => {
    const copy = structuredClone(fields);
    change(copy);
    return decodeSnapshot(packMessage(copy), ROOM);
  };
  assert.ok(decodeSnapshot(packMessage(fields), ROOM));
  assert.equal(
    mutate((v) => {
      v[0] = "fuse-p2p-0";
    }),
    undefined,
  );
  assert.equal(
    mutate((v) => {
      v[1] = 7;
    }),
    undefined,
  );
  assert.equal(
    mutate((v) => {
      v[2] = 76;
    }),
    undefined,
  );
  assert.equal(
    mutate((v) => {
      v[3] = "{";
    }),
    undefined,
  );
  assert.equal(
    mutate((v) => {
      v[4] = { version: 2 };
    }),
    undefined,
  );
  assert.equal(
    mutate((v) => {
      v[8] = "0".repeat(16);
    }),
    undefined,
    "hash mismatch",
  );
  assert.equal(
    mutate((v) => {
      (v[5] as unknown[][])[0]![2] = 9;
    }),
    undefined,
    "bad flags",
  );
  assert.equal(
    mutate((v) => {
      (v[5] as unknown[][])[0]![3] = 3;
    }),
    undefined,
    "active gesture must match latest",
  );
  assert.equal(
    mutate((v) => {
      (v[5] as unknown[][])[0]!.splice(3, 0, null, null);
    }),
    undefined,
    "the retired seven-element fold that carried aim",
  );
  assert.equal(
    mutate((v) => {
      (v[5] as unknown[][]).pop();
    }),
    undefined,
    "every rider needs a fold",
  );
  assert.equal(
    mutate((v) => {
      (v[5] as unknown[][]).push(["bot:1", 1, 0, 0, 0]);
    }),
    undefined,
    "bots have no fold",
  );
  assert.equal(
    mutate((v) => {
      (v[5] as unknown[][]).push((v[5] as unknown[][])[0]!);
    }),
    undefined,
    "duplicate fold",
  );
  assert.equal(
    mutate((v) => {
      (v[6] as string[]).push("guest");
    }),
    undefined,
  );
  assert.equal(
    mutate((v) => {
      (v[6] as string[]).push("bot:9");
    }),
    undefined,
  );
  assert.equal(
    mutate((v) => {
      v[6] = "bot:1";
    }),
    undefined,
  );
  assert.equal(
    mutate((v) => {
      (v[7] as unknown[][])[0]![2] = -1;
    }),
    undefined,
  );
  assert.equal(
    mutate((v) => {
      (v[7] as unknown[][])[1]![4] = [
        [9, 1, STEER, 0],
        [8, 1, STEER, 0],
      ];
    }),
    undefined,
    "stream entries must increase",
  );
  assert.equal(
    mutate((v) => {
      (v[7] as unknown[][])[1]![4] = [[1, 80, STEER, 0]];
    }),
    undefined,
    "entries must follow the base seq",
  );
  assert.equal(
    mutate((v) => {
      (v[7] as unknown[][]).push((v[7] as unknown[][])[0]!);
    }),
    undefined,
  );
  assert.equal(
    mutate((v) => {
      v.push(1);
    }),
    undefined,
  );
  assert.equal(decodeSnapshot(packMessage("nope"), ROOM), undefined);
  assert.equal(decodeSnapshot(new Uint8Array([0xc1]), ROOM), undefined);
});

test("replica game-state encoding preserves negative zero, maps and connection flags and rejects corruption", () => {
  const game = createGame("codec");
  addPlayer(game, {
    id: "p0",
    name: "P0",
    slot: 0,
    color: SLOT_COLORS[0]!,
    connected: false,
  });
  addPlayer(game, {
    id: "p1",
    name: "P1",
    slot: 1,
    color: SLOT_COLORS[1]!,
    connected: true,
  });
  game.players.get("p0")!.connected = true;
  game.players.get("p1")!.connected = true;
  startMatch(game);
  for (let i = 0; i < COUNTDOWN_TICKS + 5; i++) step(game, new Map());
  game.players.get("p0")!.connected = false;
  game.players.get("p1")!.drunkHeadingOffset = -0;
  game.players.get("p1")!.bombChargeStartedTick = game.tick;
  const restored = decodeGameState(encodeGameState(game))!;
  assert.ok(restored);
  assert.equal(restored.players.get("p0")!.connected, false);
  assert.ok(Object.is(restored.players.get("p1")!.drunkHeadingOffset, -0));
  assert.equal(encodeGameState(restored), encodeGameState(game));
  const corrupt = (change: (data: Record<string, unknown>) => void) => {
    const data = JSON.parse(encodeGameState(game));
    change(data);
    return decodeGameState(JSON.stringify(data));
  };
  assert.equal(
    corrupt((data) => {
      data.tick = -1;
    }),
    undefined,
  );
  assert.equal(
    corrupt((data) => {
      delete data.players;
    }),
    undefined,
  );
  assert.equal(
    corrupt((data) => {
      data.phase = "weird";
    }),
    undefined,
  );
  assert.equal(
    corrupt((data) => {
      (data.players as { $map: unknown[][] }).$map[0]![1] = {
        ...((data.players as { $map: unknown[][] }).$map[0]![1] as object),
        slot: 1,
      };
    }),
    undefined,
    "duplicate slots",
  );
  assert.equal(
    corrupt((data) => {
      data.roundWinnerId = "ghost";
    }),
    undefined,
  );
  assert.equal(
    corrupt((data) => {
      data["con" + "structor"] = 1;
    }),
    undefined,
  );
  assert.equal(decodeGameState("{"), undefined);
  assert.equal(decodeGameState(5), undefined);
  assert.equal(decodeGameState(" ".repeat(2_000_001)), undefined);
  assert.equal(decodeGameState(JSON.stringify({ $number: "-0" })), undefined);
});

test("a snapshot is served at the newest retained tick every rider has completed, never at the speculative tick", () => {
  const w = playingWorld();
  assert.ok(
    w.completeTick() < w.tick,
    "the guest stream is incomplete, so the world is ahead of what is final",
  );
  const chunks = encodeSnapshot(w, ROOM);
  assert.ok(
    chunks[0]!.tick <= w.completeTick(),
    `served ${chunks[0]!.tick} ≤ complete ${w.completeTick()}`,
  );
  const assembler = new SnapshotAssembler(ROOM);
  let complete: { bytes: Uint8Array } | undefined;
  for (const chunk of chunks) complete = assembler.accept(chunk) ?? complete;
  const decoded = decodeSnapshot(complete!.bytes, ROOM);
  assert.ok(decoded);
  assert.equal(decoded.state.game.tick, chunks[0]!.tick);
  assert.ok(
    decoded.streams
      .find((stream) => stream.id === "creator")!
      .entries.every((entry) => entry[1] > chunks[0]!.tick),
    "entries after the served tick ride along for replay",
  );
});

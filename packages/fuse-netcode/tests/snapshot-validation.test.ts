import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  JOIN,
  SnapshotAssembler,
  World,
  decodeSnapshot,
  encodeSnapshot,
  packMessage,
  unpackMessage,
} from "../src/index.js";
import { ADD, MARK, counterGame } from "./fixtures/counter-game.js";
import { FakeMesh } from "./fixtures/fake-mesh.js";

type StreamWire = [string, number, number, number, number[][]];
function checkpoint(): unknown[] {
  const world = new World(
    counterGame,
    counterGame.createRoom("m", { target: 1000 }),
    "a",
    "a",
  );
  const log = world.stream("a", 1);
  log.append(1, [JOIN, "a", "A", 0, "fox", 1]);
  log.append(2, [ACTION, "start", "m"]);
  log.append(3, [MARK, 7]);
  log.through = 12;
  world.advance(12);
  log.append(14, [MARK, 8]);
  log.append(15, [MARK, 9]);
  const assembler = new SnapshotAssembler(counterGame, 42);
  const assembled = assembler.accept(encodeSnapshot(world, 42)[0]!)!;
  return unpackMessage(assembled.bytes) as unknown[];
}

const invalid: Record<string, (stream: StreamWire) => void> = {
  "entry at the checkpoint tick": (stream) => {
    stream[4][0]![1] = 12;
  },
  "descending entry ticks": (stream) => {
    stream[4][1]![1] = 13;
  },
  "reused ordinal": (stream) => {
    stream[4][0]![3] = 7;
  },
  "reversed ordinals": (stream) => {
    stream[4][1]![3] = 7;
  },
  "unbounded sequence gap": (stream) => {
    stream[4][1]![0] = 100_000;
  },
  "out-of-window entry": (stream) => {
    stream[4][1]![1] = 100_000;
  },
};
test("a snapshot retains valid future replay entries", () => {
  const decoded = decodeSnapshot(counterGame, packMessage(checkpoint()), 42)!;
  assert.equal(decoded.streams[0]!.entries.length, 2);
});
for (const [name, corrupt] of Object.entries(invalid)) {
  test(`a valid checkpoint hash cannot admit ${name}`, () => {
    const value = checkpoint();
    const streams = value[3 + counterGame.checkpoint.leading] as StreamWire[];
    corrupt(streams[0]!);
    assert.equal(
      decodeSnapshot(counterGame, packMessage(value), 42),
      undefined,
    );
  });
}

test("invalid replay metadata leaves a healthy runtime intact and a clean retry recovers", () => {
  const mesh = new FakeMesh("a", { target: 1000 });
  const a = mesh.join("a"),
    b = mesh.join("b");
  mesh.run(200);
  a.command({ type: "join", name: "A" });
  b.command({ type: "join", name: "B" });
  mesh.run(3000);
  mesh.setHidden("b", true);
  const held = b.roomState()!,
    hash = counterGame.hash(held),
    before = b.metrics();
  mesh.snapshot = (chunk, to) => {
    if (to !== "b") return;
    const bytes = Uint8Array.from(atob(chunk.data), (char) =>
      char.charCodeAt(0),
    );
    const value = unpackMessage(bytes) as unknown[];
    const streams = value[3 + counterGame.checkpoint.leading] as StreamWire[];
    const stream = streams.find((stream) => stream[0] === "a")!;
    stream[1] = 99;
    stream[4] = [[stream[2] + 1, value[2] as number, ADD, 1]];
    chunk.data = btoa(String.fromCharCode(...packMessage(value)));
  };
  b.requestSnapshot("a");
  mesh.run(50);
  assert.equal(b.roomState(), held);
  assert.equal(counterGame.hash(held), hash);
  assert.equal(b.metrics().streams.a!.generation, before.streams.a!.generation);
  assert.equal(b.sync.state, "Resyncing");
  mesh.snapshot = () => {};
  mesh.setHidden("b", false);
  mesh.run(3000);
  assert.equal(b.sync.state, "Live");
  a.command({ type: "action", action: "start" });
  mesh.run(200);
  a.add(3);
  mesh.run(200);
  assert.equal(b.roomState()!.totals.a, 3);
  a.stop();
  b.stop();
});

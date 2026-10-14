import test from "node:test";
import assert from "node:assert/strict";
import { encodePacket, roomHash, wrapMs } from "../src/index.js";
import { ADD, counterGame } from "./fixtures/counter-game.js";
import { FakeMesh } from "./fixtures/fake-mesh.js";

for (const replacement of [false, true]) {
  test(`a refused ${replacement ? "replacement" : "current"} packet preserves the clock, generation and healthy traffic`, () => {
    const mesh = new FakeMesh("a", { target: 1000 });
    const a = mesh.join("a"),
      b = mesh.join("b");
    mesh.run(200);
    a.command({ type: "join", name: "A" });
    b.command({ type: "join", name: "B" });
    mesh.run(3000);
    const before = b.metrics();
    const tick = Math.floor(before.clockTick);
    assert.ok(
      a.transport!.sendFast(
        "b",
        encodePacket({
          room: roomHash("ROOM:a"),
          from: "a",
          generation: replacement ? 2 : 1,
          through: tick,
          lastSeq: 0,
          entries: [[before.streams.a!.lastSeq + 1, tick + 1, ADD, 1]],
          sentAt: wrapMs(mesh.now),
          echoSentAt: wrapMs(mesh.now),
          echoHeld: 0,
          clockTick: tick + 1000,
          hash: null,
        }),
      ),
    );
    mesh.run(20);
    const after = b.metrics();
    assert.equal(after.streams.a!.rejected, before.streams.a!.rejected + 1);
    assert.equal(after.streams.a!.generation, before.streams.a!.generation);
    assert.equal(after.streams.a!.contiguous, before.streams.a!.contiguous);
    assert.ok(after.clockTick - before.clockTick < 1);
    assert.equal(after.clock.offset, before.clock.offset);
    assert.equal(after.clock.bestRttMs, before.clock.bestRttMs);
    assert.equal(after.snapshotRequest, false);
    a.command({ type: "action", action: "start" });
    mesh.run(200);
    assert.ok(a.add(3));
    mesh.run(200);
    assert.equal(
      b.roomState()!.totals.a,
      3,
      "valid traffic still applies after refusal",
    );
    assert.ok(Math.abs(b.metrics().clockTick - a.metrics().clockTick) < 1);
    a.stop();
    b.stop();
  });
}

test("a refused packet before the first snapshot cannot fence out the valid generation", () => {
  const mesh = new FakeMesh("a", { target: 1000 });
  const a = mesh.join("a");
  mesh.run(200);
  a.command({ type: "join", name: "A" });
  mesh.run(200);
  mesh.snapshot = (chunk) => {
    chunk.data = "!";
  };
  const b = mesh.join("b");
  mesh.run(100);
  assert.equal(b.roomState(), undefined);
  const tick = Math.floor(a.metrics().clockTick);
  a.transport!.sendFast(
    "b",
    encodePacket({
      room: roomHash("ROOM:a"),
      from: "a",
      generation: 2,
      through: tick,
      lastSeq: 0,
      entries: [[1, tick + 1, ADD, 1]],
      sentAt: wrapMs(mesh.now),
      echoSentAt: wrapMs(mesh.now),
      echoHeld: 0,
      clockTick: tick + 1000,
      hash: null,
    }),
  );
  mesh.run(20);
  assert.ok(b.metrics().clockTick < tick + 2);
  mesh.snapshot = () => {};
  mesh.run(3000);
  b.command({ type: "join", name: "B" });
  mesh.run(200);
  a.command({ type: "action", action: "start" });
  mesh.run(200);
  a.add(3);
  mesh.run(200);
  assert.equal(b.roomState()!.totals.a, 3);
  assert.equal(b.metrics().streams.a!.generation, 1);
  a.stop();
  b.stop();
});

test("a valid replacement packet overtaking hello moves the seat generation before applying inputs", () => {
  const mesh = new FakeMesh("a", { target: 1000 });
  const a = mesh.join("a"),
    b = mesh.join("b");
  mesh.run(200);
  a.command({ type: "join", name: "A" });
  b.command({ type: "join", name: "B" });
  mesh.run(3000);
  a.command({ type: "action", action: "start" });
  mesh.run(200);
  const tick = Math.floor(a.metrics().clockTick) + 2;
  b.transport!.sendFast(
    "a",
    encodePacket({
      room: roomHash("ROOM:a"),
      from: "b",
      generation: 2,
      through: tick - 1,
      lastSeq: 1,
      entries: [[1, tick, ADD, 3]],
      sentAt: wrapMs(mesh.now),
      echoSentAt: 0,
      echoHeld: 0,
      clockTick: tick - 1,
      hash: null,
    }),
  );
  mesh.run(10);
  b.transport!.send("a", {
    type: "hello",
    generation: 2,
    rules: counterGame.rules,
    world: true,
    hidden: false,
    full: false,
  });
  mesh.run(1000);
  assert.equal(a.roomState()!.seats.get("b")!.generation, 2);
  assert.equal(a.roomState()!.totals.b, 3);
  a.stop();
  b.stop();
});

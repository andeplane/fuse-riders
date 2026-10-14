import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ROOM_PROTOCOL_VERSION } from "fuse-network-protocol";
import { TransportHarness } from "./fixtures/fake-rtc.js";

async function healthy(h: TransportHarness, index = 0): Promise<void> {
  const pc = h.connections[index]!;
  const game = pc.created.get("game")!;
  pc.connectionBecomes("connected");
  game.open();
  pc.created.get("input")!.open();
  for (let round = 0; round < 2; round++) {
    await h.run(200);
    const probe = game.envelopes().at(-1)!.data as { probeId: number };
    game.receive(
      JSON.stringify({
        id: round + 1,
        sender: "c-b",
        receiver: "c-a",
        data: { type: "linkPong", probeId: probe.probeId },
      }),
    );
  }
  assert.equal(h.transport.linked("b"), true);
}

test("stale RTC callbacks cannot deliver or drain a replacement connection", async () => {
  const h = new TransportHarness();
  await h.admit("a", ["b"]);
  const old = h.connections[0]!;
  const game = old.created.get("game")!;
  const input = old.created.get("input")!;
  await h.socket.deliver({
    type: "peer",
    id: "b",
    online: true,
    connectionId: "c-b2",
  });
  await h.flush();
  const replacement = h.connections[1]!;
  replacement.connectionBecomes("connected");
  replacement.created.get("game")!.open();
  replacement.created.get("input")!.open();
  const before = structuredClone(h.recorded);
  const signals = h.relayedSignals;
  old.gathered("candidate:stale");
  old.connectionBecomes("failed");
  old.iceBecomes("failed");
  assert.equal(old.offerChannel("game").closeCalls, 1);
  game.receive(
    JSON.stringify({ id: 1, sender: "c-b", receiver: "c-a", data: "stale" }),
  );
  input.receive(new Uint8Array([9]).buffer);
  for (const channel of [game, input]) {
    channel.closing();
    channel.shut();
    channel.err();
    channel.open();
  }
  await h.flush();
  assert.deepEqual(h.recorded, before);
  assert.equal(h.relayedSignals, signals);
  replacement.created.get("game")!.receive(
    JSON.stringify({
      id: 1,
      sender: "c-b2",
      receiver: "c-a",
      data: "current",
    }),
  );
  replacement.created.get("input")!.receive(new Uint8Array([7]).buffer);
  assert.deepEqual(h.recorded.messages, [["b", "current"]]);
  assert.deepEqual(
    h.recorded.fast.map(([, bytes]) => [...bytes]),
    [[7]],
  );
  assert.equal(h.transport.sendFast("b", new Uint8Array([1])), true);
  h.transport.close();
});

test("backpressure and serialization or channel failures recover without draining the link", async () => {
  const h = new TransportHarness();
  await h.admit("a", ["b"]);
  await healthy(h);
  const game = h.connections[0]!.created.get("game")!;
  const input = h.connections[0]!.created.get("input")!;
  const sent = h.transport.sentBytes;
  game.bufferedAmount = 64_000;
  input.bufferedAmount = 16_000;
  assert.equal(h.transport.send("b", { message: 1 }), false);
  assert.equal(h.transport.sendFast("b", new Uint8Array([1])), false);
  game.bufferedAmount = input.bufferedAmount = 0;
  game.throwOnSend = input.throwOnSend = new Error("queue refused");
  assert.equal(h.transport.send("b", { message: 2 }), false);
  assert.equal(h.transport.sendFast("b", new Uint8Array([2])), false);
  await h.run(200); // A refused health probe must also remain safe.
  game.throwOnSend = input.throwOnSend = undefined;
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.equal(h.transport.send("b", cyclic), false);
  assert.equal(h.transport.send("b", 1n), false);
  assert.equal(h.transport.sentBytes, sent);
  assert.equal(h.transport.linked("b"), true);
  assert.equal(h.transport.send("b", { message: 3 }), true);
  assert.equal(h.transport.sendFast("b", new Uint8Array([3])), true);
  assert.ok(h.transport.sentBytes > sent);
  h.transport.close();
});

for (const label of ["game", "input"] as const) {
  for (const event of ["closing", "shut", "err"] as const) {
    test(`${label} ${event} drains both gameplay paths until replacement`, async () => {
      const h = new TransportHarness();
      await h.admit("a", ["b"]);
      await healthy(h);
      h.connections[0]!.created.get(label)![event]();
      assert.equal(h.transport.linked("b"), false);
      assert.equal(h.transport.send("b", { message: 1 }), false);
      assert.equal(h.transport.sendFast("b", new Uint8Array([1])), false);
      // Let the last acknowledged probe expire, then the bounded restart interval.
      await h.runSteps(14_000);
      assert.equal(h.connections.length, 2);
      await healthy(h, 1);
      assert.equal(h.transport.send("b", { message: 2 }), true);
      h.transport.close();
    });
  }
}

test("socket reconnect reconciles absent members and ignores retired socket callbacks", async () => {
  const h = new TransportHarness({ random: () => 0 });
  await h.admit("a", ["b", "c"]);
  const old = h.socket;
  old.drop(1006);
  await h.run(1500);
  assert.equal(h.sockets.length, 2);
  h.socket.open();
  await h.socket.deliver({
    type: "welcome",
    protocol: ROOM_PROTOCOL_VERSION,
    id: "a",
    hostId: "a",
    connectionId: "c-a2",
    peers: [{ id: "b", connectionId: "c-b2" }],
  });
  await h.flush();
  assert.ok(h.recorded.peers.some(([id, online]) => id === "c" && !online));
  assert.equal(h.connections[0]!.closeCalls, 1);
  assert.equal(h.connections[1]!.closeCalls, 1);
  assert.equal(h.connections.length, 3);
  const before = structuredClone(h.recorded);
  await old.deliver({
    type: "peer",
    id: "d",
    online: true,
    connectionId: "c-d",
  });
  await old.deliver({
    type: "welcome",
    protocol: ROOM_PROTOCOL_VERSION,
    id: "obsolete",
    hostId: "obsolete",
    connectionId: "old",
    peers: [],
  });
  await old.deliver({
    type: "signal",
    from: "b",
    connectionId: "c-b2",
    data: { description: { type: "offer", sdp: "old" } },
  });
  old.drop(1006);
  await h.run(2000);
  assert.deepEqual(h.recorded, before);
  assert.equal(h.connections.length, 3);
  assert.equal(h.sockets.length, 2);
  h.transport.close();
});

test("a failed ICE restart releases the attempt so a later retry can succeed", async () => {
  const h = new TransportHarness();
  await h.admit("a", ["b"]);
  const pc = h.connections[0]!;
  pc.failOffer = new Error("temporary negotiation failure");
  await h.runSteps(8200);
  const failed = (await h.transport.diagnostics()).links[0]!;
  assert.equal(failed.lastFailure, "restart: Error");
  assert.equal(failed.restarts.attempts, 1);
  assert.equal(h.descriptionsTo("b").length, 1);
  pc.failOffer = undefined;
  await h.runSteps(8200);
  assert.equal(h.connections.length, 1);
  assert.equal(h.descriptionsTo("b").length, 2);
  assert.deepEqual(pc.offers, [
    undefined,
    { iceRestart: true },
    { iceRestart: true },
  ]);
  h.transport.close();
});

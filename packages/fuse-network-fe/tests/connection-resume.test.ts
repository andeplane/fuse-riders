import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ROOM_PROTOCOL_VERSION } from "fuse-network-protocol";
import { FakePeerConnection, TransportHarness } from "./fixtures/fake-rtc.js";

// The room socket is cut every hour and whenever a service instance stops. The page reconnects naming the connection
// it already is; a service that still holds the seat welcomes it back under the same id, and then nothing about the
// mesh may change: these pin that, and that anything else is still the full rebuild it always was.

let pongs = 0;
/** Moves time in health-check steps, answering every probe on each link as its peer (a connection id) would. */
async function pump(
  h: TransportHarness,
  links: [FakePeerConnection, string][],
  ms: number,
): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += 200) {
    await h.run(200);
    for (const [pc, connection] of links) {
      const game = pc.created.get("game")!;
      const probe = game
        .envelopes()
        .filter(
          (envelope) =>
            (envelope.data as { type?: string }).type === "linkProbe",
        )
        .at(-1);
      if (probe)
        game.receive(
          JSON.stringify({
            id: 1_000_000 + ++pongs,
            sender: connection,
            receiver: "c-a",
            data: {
              type: "linkPong",
              probeId: (probe.data as { probeId: number }).probeId,
            },
          }),
        );
    }
  }
}
/** Admits `a` beside `peers` and brings every link up to carrying gameplay. */
async function playing(
  h: TransportHarness,
  peers: string[],
): Promise<[FakePeerConnection, string][]> {
  await h.admit("a", peers, "a");
  const links = peers.map((peer, index): [FakePeerConnection, string] => [
    h.connections[index]!,
    `c-${peer}`,
  ]);
  for (const [pc] of links) {
    pc.connectionBecomes("connected");
    pc.created.get("game")!.open();
    pc.created.get("input")!.open();
  }
  await pump(h, links, 400);
  for (const peer of peers) assert.equal(h.transport.linked(peer), true);
  return links;
}
const welcome = (
  connectionId: string,
  peers: Record<string, string>,
  resumed = true,
) => ({
  type: "welcome",
  protocol: ROOM_PROTOCOL_VERSION,
  id: "a",
  hostId: "a",
  connectionId,
  resumed,
  peers: Object.entries(peers).map(([id, connection]) => ({
    id,
    connectionId: connection,
  })),
});

test("a socket dropped mid-round is resumed: every link keeps carrying the round and the room above hears nothing", async () => {
  const h = new TransportHarness({ random: () => 0 });
  const links = await playing(h, ["b"]);
  const pc = h.connections[0]!,
    game = pc.created.get("game")!,
    input = pc.created.get("input")!;
  const receive = (id: number, data: unknown) =>
    game.receive(JSON.stringify({ id, sender: "c-b", receiver: "c-a", data }));
  receive(1, "before the drop");
  const before = structuredClone({
    peers: h.recorded.peers,
    links: h.recorded.links,
    welcomes: h.recorded.welcomes,
  });
  const sentSignals = h.relayedSignals;

  h.socket.drop(1006);
  // The reconnect waits 1.5 s. The round does not: ticks, room control and the peer's packets all still flow.
  for (let step = 0; step < 7; step++) {
    await pump(h, links, 200);
    assert.equal(h.transport.linked("b"), true, `linked ${step * 200} ms in`);
    assert.equal(h.transport.send("b", { tick: step }), true);
    assert.equal(h.transport.sendFast("b", new Uint8Array([step])), true);
    input.receive(new Uint8Array([step]).buffer);
  }
  await h.run(100);
  assert.equal(h.sockets.length, 2, "the socket is reopened after the backoff");
  h.socket.open();
  assert.deepEqual(h.socket.sent[0], {
    type: "auth",
    token: "token",
    resume: "c-a",
  });
  await h.socket.deliver(welcome("c-a", { b: "c-b" }));
  // Delivered twice, the welcome is the same roster again and changes nothing more.
  await h.socket.deliver(welcome("c-a", { b: "c-b" }));
  await pump(h, links, 400);

  assert.equal(h.connections.length, 1, "no peer connection was rebuilt");
  assert.equal(pc.closeCalls, 0);
  assert.equal(h.relayedSignals, sentSignals, "nothing was renegotiated");
  assert.deepEqual(
    {
      peers: h.recorded.peers,
      links: h.recorded.links,
      welcomes: h.recorded.welcomes,
    },
    before,
    "no member came or went, no link changed and the room was not welcomed again",
  );
  assert.equal(h.recorded.fast.length, 7);
  assert.equal(h.transport.linked("b"), true);
  assert.equal(h.transport.send("b", { tick: "after" }), true);
  // The link's own history is kept too: a frame it already delivered is still a duplicate.
  receive(1, "before the drop");
  receive(2, "after the resume");
  assert.deepEqual(h.recorded.messages, [
    ["b", "before the drop"],
    ["b", "after the resume"],
  ]);
  assert.equal(h.recorded.statuses.at(-1), "Reconnected");
  assert.deepEqual(h.recorded.terminated, []);
  // The resumed socket is the page's signalling path again: the heartbeat goes out on it.
  assert.ok(h.socket.frames("time").length > 0);
  h.transport.close();
});

test("a resume reconciles who came, went or reloaded while the socket was down, and touches no other link", async () => {
  const h = new TransportHarness({ random: () => 0 });
  const links = await playing(h, ["b", "c", "d"]);
  const [toB, toC, toD] = h.connections;
  h.recorded.peers.length = h.recorded.links.length = 0;
  h.socket.drop(1006);
  await h.run(1500);
  h.socket.open();
  // While the socket was down: c left, d reloaded into a new connection, and e joined.
  await h.socket.deliver(welcome("c-a", { b: "c-b", d: "c-d2", e: "c-e" }));
  await h.flush();
  assert.deepEqual(h.recorded.peers, [
    ["c", false],
    ["d", true],
    ["e", true],
  ]);
  assert.deepEqual(h.recorded.links, [
    ["c", false],
    ["d", false],
  ]);
  assert.equal(toB!.closeCalls, 0, "the untouched link stays");
  assert.equal(toC!.closeCalls, 1);
  assert.equal(toD!.closeCalls, 1);
  // One new peer connection each for the reloaded member and the newcomer, offered at once (a < d, a < e).
  assert.equal(h.connections.length, 5);
  assert.equal(h.descriptionsTo("d").length, 1);
  assert.equal(h.descriptionsTo("e").length, 1);
  assert.equal(h.descriptionsTo("b").length, 0);
  // Only the socket was down: once its probes are answered again the kept link is carrying, with no negotiation.
  await pump(h, links.slice(0, 1), 400);
  assert.equal(h.transport.linked("b"), true);
  assert.equal(h.transport.send("c", "gone"), false);
  // A frame from the reloaded member's old connection is no longer its voice.
  await h.socket.deliver({
    type: "signal",
    from: "d",
    connectionId: "c-d",
    data: { description: { type: "answer", sdp: "stale" } },
  });
  assert.equal(h.connections[3]!.remoteDescription, null);
  h.transport.close();
});

test("a service that no longer holds the seat answers with a new connection, and the mesh is rebuilt as before", async () => {
  const h = new TransportHarness({ random: () => 0 });
  await playing(h, ["b"]);
  const pc = h.connections[0]!;
  h.socket.drop(1006);
  await h.run(1500);
  h.socket.open();
  assert.equal(h.socket.sent[0]!.resume, "c-a");
  await h.socket.deliver(welcome("c-a2", { b: "c-b" }, false));
  await h.flush();
  assert.equal(pc.closeCalls, 1);
  assert.equal(h.connections.length, 2);
  assert.deepEqual(h.recorded.welcomes, [
    ["a", "a"],
    ["a", "a"],
  ]);
  assert.equal(h.transport.connectionId, "c-a2");
  // The next drop offers the connection the page holds now.
  h.socket.drop(1012);
  await h.run(1500);
  h.socket.open();
  assert.equal(h.socket.sent[0]!.resume, "c-a2");
  h.transport.close();
});

test("the first socket of a page offers nothing to resume, and a game's own word for a full room wins", async () => {
  const h = new TransportHarness({ gameId: "fuse-lane" });
  h.transport.connect();
  h.socket.open();
  assert.deepEqual(h.socket.sent[0], {
    type: "auth",
    token: "token",
    gameId: "fuse-lane",
  });
  h.socket.drop(4029, "Room full");
  assert.deepEqual(h.recorded.terminated, ["Room full"]);

  const own = new TransportHarness({ copy: { roomFull: "Table full" } });
  own.transport.connect();
  own.socket.open();
  own.socket.drop(4029, "Room full");
  assert.deepEqual(own.recorded.terminated, ["Table full"]);

  const silent = new TransportHarness();
  silent.transport.connect();
  silent.socket.open();
  silent.socket.drop(4029);
  assert.deepEqual(silent.recorded.terminated, ["Room full"]);
});

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  CLOSE_ROOM_ENDED,
  ROOM_PROTOCOL_VERSION,
  authFrame,
} from "fuse-network-protocol";
import { browserTransportDependencies } from "../src/index.js";
import { FakeDataChannel, TransportHarness } from "./fixtures/fake-rtc.js";

/**
 * `PeerTransport` on typed RTC, socket and timer fakes (`fixtures/fake-rtc.ts`). Every test drives the clock itself,
 * so nothing here waits on the real 200 ms health interval, and no test reads a private field: roles are observed
 * through the signalling the transport relays, link state through `linked()`, and teardown through the fake clock's
 * armed-timer count.
 */

/** A reliable-channel frame as a peer would send it: the envelope the transport validates before delivering. */
function envelope(from: string, to: string, id: number, data: unknown): string {
  return JSON.stringify({ id, data, sender: `c-${from}`, receiver: `c-${to}` });
}

/** The `game` channel this side created for `peer`, opened. */
function openCreatedGame(
  harness: TransportHarness,
  index = 0,
): FakeDataChannel {
  const pc = harness.connections[index]!;
  const game = pc.created.get("game")!;
  pc.connectionBecomes("connected");
  game.open();
  return game;
}

test("the smaller id offers and creates both channels; the larger only answers", async () => {
  const offerer = new TransportHarness();
  await offerer.admit("a", ["b"]);

  assert.equal(offerer.connections.length, 1);
  const pc = offerer.connections[0]!;
  assert.deepEqual([...pc.created.keys()], ["game", "input"]);
  // The unreliable channel is the per-tick packet path: unordered, never retransmitted.
  assert.equal(pc.created.get("input")!.ordered, false);
  assert.equal(pc.created.get("input")!.maxRetransmits, 0);
  assert.equal(offerer.descriptionsTo("b").length, 1);
  assert.equal(offerer.descriptionsTo("b")[0]!.type, "offer");
  assert.equal(pc.answers, 0);

  const answerer = new TransportHarness();
  await answerer.admit("z", ["b"]);
  // "z" > "b", so this page waits: no connection is built until the offer arrives.
  assert.equal(answerer.connections.length, 0);
  assert.equal(answerer.socket.frames("signal").length, 0);

  await answerer.socket.deliver({
    type: "signal",
    from: "b",
    connectionId: "c-b",
    data: { description: { type: "offer", sdp: "remote-offer" } },
  });
  await answerer.flush();

  assert.equal(answerer.connections.length, 1);
  // The answerer creates no channel of its own; both arrive over `ondatachannel`.
  assert.equal(answerer.connections[0]!.created.size, 0);
  assert.equal(answerer.connections[0]!.answers, 1);
  assert.deepEqual(
    answerer.descriptionsTo("b").map((description) => description.type),
    ["answer"],
  );

  answerer.transport.close();
  offerer.transport.close();
});

test("the room socket authenticates with its first frame and the welcome names the room", async () => {
  const harness = new TransportHarness({ gameId: "fuse-riders" });
  harness.transport.connect();
  harness.socket.open();

  assert.ok(
    harness.socket.url.startsWith("wss://rooms.test/api/rooms/ROOM/ws"),
  );
  assert.deepEqual(
    harness.socket.sent[0],
    JSON.parse(authFrame("token", "fuse-riders")),
  );

  await harness.socket.deliver({
    type: "welcome",
    protocol: 999,
    id: "a",
    hostId: "a",
    connectionId: "c-a",
    peers: [],
  });
  // A protocol the page does not speak is terminal, not a retry.
  assert.deepEqual(harness.recorded.terminated, [
    "Room protocol changed — reload this page",
  ]);
  harness.transport.close();
});

test("an opened channel links, and two acknowledged probes make the link carry gameplay", async () => {
  const harness = new TransportHarness();
  await harness.admit("a", ["b"]);
  const game = openCreatedGame(harness);

  assert.deepEqual(harness.recorded.links, [["b", true]]);
  // Open is a hint; until probes come back the link does not carry gameplay.
  assert.equal(harness.transport.linked("b"), false);

  for (let round = 0; round < 2; round++) {
    await harness.run(200);
    const probe = game.envelopes().at(-1)!.data as {
      type: string;
      probeId: number;
    };
    assert.equal(probe.type, "linkProbe");
    game.receive(
      envelope("b", "a", round + 1, {
        type: "linkPong",
        probeId: probe.probeId,
      }),
    );
  }

  assert.equal(harness.transport.linked("b"), true);
  assert.equal(harness.transport.send("b", { hello: true }), true);
  harness.transport.close();
});

test("the health check stands down while the page is hidden", async () => {
  const harness = new TransportHarness();
  await harness.admit("a", ["b"]);
  const game = openCreatedGame(harness);

  await harness.setHidden(true);
  const before = game.envelopes().length;
  await harness.run(1000);
  assert.equal(game.envelopes().length, before);

  await harness.setHidden(false);
  await harness.run(200);
  assert.ok(game.envelopes().length > before);
  harness.transport.close();
});

test("a peer's linkBye drains the link before the channel reports it closed", async () => {
  const harness = new TransportHarness();
  await harness.admit("a", ["b"]);
  const game = openCreatedGame(harness);

  game.receive(envelope("b", "a", 1, { type: "linkBye" }));

  // The channel still reads "open" — WebKit's lagging readyState — but the gate is monotonic and refuses sends.
  assert.equal(game.readyState, "open");
  assert.equal(harness.transport.linked("b"), false);
  assert.equal(harness.transport.send("b", { hello: true }), false);
  const after = game.envelopes().length;
  await harness.run(1000);
  assert.equal(game.envelopes().length, after);
  harness.transport.close();
});

test("a drained link is replaced with a fresh connection, an unhealthy one is restarted in place", async () => {
  const harness = new TransportHarness();
  await harness.admit("a", ["b"]);
  const first = harness.connections[0]!;
  const game = openCreatedGame(harness);
  game.shut();

  assert.deepEqual(harness.recorded.links, [
    ["b", true],
    ["b", false],
  ]);

  // Below the 8 s restart interval nothing is spent on the link.
  await harness.runSteps(7800);
  assert.equal(harness.connections.length, 1);

  await harness.runSteps(400);
  // The gate is monotonic, so an in-place ICE restart could not recover it: a new connection and a new gate.
  assert.equal(harness.connections.length, 2);
  assert.ok(first.closeCalls > 0);
  const second = harness.connections[1]!;
  assert.deepEqual([...second.created.keys()], ["game", "input"]);
  assert.equal(harness.descriptionsTo("b").length, 2);

  // The replacement is not drained, so its retry is an ICE restart on the same connection: the answerer
  // recognises the unchanged DTLS certificate and answers without rebuilding its side.
  await harness.runSteps(8200);
  assert.equal(harness.connections.length, 2);
  assert.equal(second.closeCalls, 0);
  assert.deepEqual(second.offers, [undefined, { iceRestart: true }]);
  harness.transport.close();
});

test("the restart budget carries across the replacement and then stops", async () => {
  const harness = new TransportHarness();
  await harness.admit("a", ["b"]);
  const game = openCreatedGame(harness);
  game.shut();

  // Four attempts: the force-replacement at 8 s spends the first, then three ICE restarts on the replacement.
  await harness.runSteps(60_000);
  const offers = harness.descriptionsTo("b").length;
  assert.equal(harness.connections.length, 2);
  // The replacement's own offer, then three ICE restarts: four attempts in all, shared with the replacement.
  assert.deepEqual(harness.connections[1]!.offers, [
    undefined,
    { iceRestart: true },
    { iceRestart: true },
    { iceRestart: true },
  ]);
  // The first link's offer plus those four; the budget is exhausted and no further offer is relayed.
  assert.equal(offers, 5);

  await harness.runSteps(60_000);
  assert.equal(harness.descriptionsTo("b").length, offers);
  assert.equal(harness.connections.length, 2);
  harness.transport.close();
});

test("a down room socket does not spend the restart budget", async () => {
  const harness = new TransportHarness({ random: () => 0 });
  await harness.admit("a", ["b"]);
  openCreatedGame(harness);
  harness.socket.drop(1006);

  const relayed = harness.relayedSignals;
  assert.equal(relayed, 1);
  await harness.runSteps(20_000);
  // A down socket cannot carry the restart offer, so the budget is not burned on it; the reconnect comes first.
  assert.equal(harness.relayedSignals, relayed);
  assert.equal(harness.connections.length, 1);
  assert.deepEqual(harness.connections[0]!.offers, [undefined]);
  harness.transport.close();
});

test("a farewell says goodbye on every link and closes the connections after the grace period", async () => {
  const harness = new TransportHarness();
  await harness.admit("a", ["b", "c"]);
  const first = openCreatedGame(harness, 0);
  const second = openCreatedGame(harness, 1);

  harness.transport.close(true);

  for (const game of [first, second])
    assert.deepEqual(game.envelopes().at(-1)!.data, { type: "linkBye" });
  // The connections stay up so the bye can leave the send queue.
  assert.equal(harness.connections[0]!.closeCalls, 0);
  assert.equal(harness.connections[1]!.closeCalls, 0);
  assert.equal(harness.clock.pending, 1);

  await harness.run(149);
  assert.equal(harness.connections[0]!.closeCalls, 0);
  await harness.run(1);
  assert.equal(harness.connections[0]!.closeCalls, 1);
  assert.equal(harness.connections[1]!.closeCalls, 1);
  assert.equal(harness.clock.pending, 0);
});

test("a close forced by the room service sends nothing and closes at once", async () => {
  const harness = new TransportHarness();
  await harness.admit("a", ["b"]);
  const game = openCreatedGame(harness);
  const sent = game.envelopes().length;

  harness.transport.close();

  assert.equal(game.envelopes().length, sent);
  assert.equal(harness.connections[0]!.closeCalls, 1);
  assert.equal(harness.clock.pending, 0);
});

test("teardown cancels every timer and subscription the transport armed", async () => {
  const harness = new TransportHarness({ random: () => 0 });
  await harness.admit("a", ["b"]);

  assert.deepEqual(harness.clock.intervals, [200, 2000]);
  assert.equal(harness.visibilitySubscriptions, 1);

  // A dropped socket arms the reconnect timer as well.
  harness.socket.drop(1006);
  assert.equal(harness.clock.pending, 3);

  harness.transport.close();

  assert.equal(harness.clock.pending, 0);
  assert.equal(harness.visibilitySubscriptions, 0);
  // Nothing the clock can do afterwards reopens a socket or probes a peer.
  const sockets = harness.sockets.length;
  await harness.run(60_000);
  assert.equal(harness.sockets.length, sockets);
});

test("a terminal room-ended close stops the transport without a reconnect timer", async () => {
  const harness = new TransportHarness({ random: () => 0 });
  await harness.admit("a", ["b"]);

  harness.socket.drop(CLOSE_ROOM_ENDED);

  assert.equal(harness.recorded.ended, 1);
  assert.deepEqual(harness.recorded.terminated, ["Room ended"]);
  assert.equal(harness.clock.pending, 0);
  await harness.run(60_000);
  assert.equal(harness.sockets.length, 1);
});

test("a throwing message handler does not take the transport down — and today nothing reports it", async () => {
  const harness = new TransportHarness();
  await harness.admit("a", ["b"]);
  const game = openCreatedGame(harness);
  const statuses = harness.recorded.statuses.length;

  harness.messageThrows = new Error("the application blew up");
  // The channel handler must not rethrow into the RTC callback that invoked it.
  assert.doesNotThrow(() => game.receive(envelope("b", "a", 1, { one: 1 })));

  // Today the parser's catch also swallows what `receive()` and the application callback throw. Nothing is
  // reported: no status, no rethrow. Suspected bug, deliberately asserted as-is here — narrowing that catch to
  // the parser is #258's "guard UI callbacks" item, not this testability refactor.
  assert.equal(harness.recorded.statuses.length, statuses);

  // The link is untouched: the next frame is delivered and the health check still runs.
  game.receive(envelope("b", "a", 2, { two: 2 }));
  assert.deepEqual(
    harness.recorded.messages.map(([, data]) => data),
    [{ one: 1 }, { two: 2 }],
  );
  const probes = game.envelopes().length;
  await harness.run(200);
  assert.ok(game.envelopes().length > probes);
  harness.transport.close();
});

test("a callback that throws on the room socket is reported as connection recovery", async () => {
  const harness = new TransportHarness();
  harness.peerThrows = new Error("the application blew up");
  await harness.admit("a", []);

  await harness.socket.deliver({
    type: "peer",
    id: "b",
    connectionId: "c-b",
    online: true,
  });

  // The room socket's frame handler does report what it caught, unlike the datachannel one above.
  assert.equal(
    harness.recorded.statuses.at(-1),
    "Connection recovery: the application blew up",
  );
  harness.transport.close();
});

test("a channel error drains the link and says so, without throwing", async () => {
  const harness = new TransportHarness();
  await harness.admit("a", ["b"]);
  const game = openCreatedGame(harness);

  assert.doesNotThrow(() => game.err());

  assert.equal(harness.transport.linked("b"), false);
  assert.equal(
    harness.recorded.statuses.at(-1),
    "Direct connection failed · retrying",
  );
  harness.transport.close();
});

test("a peer that leaves drops its link and a returning connection id replaces it", async () => {
  const harness = new TransportHarness();
  await harness.admit("a", ["b"]);
  openCreatedGame(harness);

  await harness.socket.deliver({
    type: "peer",
    id: "b",
    connectionId: "c-b",
    online: false,
  });
  assert.equal(harness.connections[0]!.closeCalls, 1);
  assert.deepEqual(harness.recorded.peers.at(-1), ["b", false]);
  assert.equal(harness.transport.send("b", { hello: true }), false);

  // The same member back on a new connection is a new link, not the old one revived.
  await harness.socket.deliver({
    type: "peer",
    id: "b",
    connectionId: "c-b2",
    online: true,
  });
  await harness.flush();
  assert.equal(harness.connections.length, 2);
  harness.transport.close();
});

test("the unreliable channel refuses packets over the limit and while the link is drained", async () => {
  const harness = new TransportHarness({ maxFastBytes: 8 });
  await harness.admit("a", ["b"]);
  const pc = harness.connections[0]!;
  const input = pc.created.get("input")!;
  openCreatedGame(harness);
  input.open();

  assert.equal(harness.transport.sendFast("b", new Uint8Array(4)), true);
  assert.equal(harness.transport.sendFast("b", new Uint8Array(9)), false);

  input.bufferedAmount = 16_000;
  assert.equal(harness.transport.sendFast("b", new Uint8Array(4)), false);
  input.bufferedAmount = 0;

  pc.connectionBecomes("failed");
  assert.equal(harness.transport.sendFast("b", new Uint8Array(4)), false);
  harness.transport.close();
});

test("an inbound fast packet is delivered only within the size bounds", async () => {
  const harness = new TransportHarness({ maxFastBytes: 8 });
  await harness.admit("a", ["b"]);
  const input = harness.connections[0]!.created.get("input")!;
  openCreatedGame(harness);
  input.open();

  input.receive(new Uint8Array([1, 2, 3]).buffer);
  input.receive(new ArrayBuffer(0));
  input.receive(new ArrayBuffer(9));
  input.receive("not binary");

  assert.deepEqual(
    harness.recorded.fast.map(([, bytes]) => [...bytes]),
    [[1, 2, 3]],
  );
  harness.transport.close();
});

/** A `getStats()` report with one succeeded candidate pair of the given local and remote candidate types. */
function pairReport(local: string, remote: string): RTCStatsReport {
  return new Map<string, Record<string, unknown>>([
    [
      "local",
      { type: "local-candidate", candidateType: local, protocol: "udp" },
    ],
    ["remote", { type: "remote-candidate", candidateType: remote }],
    [
      "pair",
      {
        type: "candidate-pair",
        state: "succeeded",
        nominated: true,
        localCandidateId: "local",
        remoteCandidateId: "remote",
      },
    ],
    ["transport", { type: "transport", dtlsState: "connected" }],
  ]);
}

test("explain says which side of the handshake is missing", async () => {
  const harness = new TransportHarness();
  assert.equal(
    harness.transport.explain("b"),
    "room service connection down — reconnecting",
  );

  harness.transport.connect();
  harness.socket.open();
  assert.equal(harness.transport.explain("b"), "waiting for room admission");

  await harness.socket.deliver({
    type: "welcome",
    protocol: ROOM_PROTOCOL_VERSION,
    id: "z",
    hostId: "z",
    connectionId: "c-z",
    peers: [],
  });
  // A member the room service has not announced is not a link problem at all.
  assert.equal(
    harness.transport.explain("b"),
    "the host is not in the room yet",
  );
  harness.transport.close();
});

test("diagnostics and stats report the selected candidate pair per link", async () => {
  const harness = new TransportHarness();
  await harness.admit("a", ["b", "c"], "a");
  const direct = harness.connections[0]!;
  const relayed = harness.connections[1]!;
  direct.stats = pairReport("host", "srflx");
  relayed.stats = pairReport("relay", "srflx");
  openCreatedGame(harness, 0);
  openCreatedGame(harness, 1);

  assert.deepEqual(await harness.transport.stats(), {
    direct: 1,
    relayed: 1,
    buffered: 0,
  });

  const report = await harness.transport.diagnostics();
  assert.equal(report.socket, "open");
  assert.ok(report.ice.servers > 0);
  assert.equal(report.links.length, 2);
  assert.deepEqual(report.links[0]!.selected, {
    local: "host",
    remote: "srflx",
    protocol: "udp",
  });
  assert.equal(report.links[0]!.dtls, "connected");
  assert.equal(report.links[0]!.connection, "connected");
  assert.equal(report.links[0]!.healthy, false);
  harness.transport.close();
});

test("the default dependencies wire the real timers", async () => {
  const deps = browserTransportDependencies();
  assert.equal(typeof deps.now(), "number");

  // Both timer helpers return a cancel, and cancelling really stops the timer.
  let ticks = 0;
  const stopInterval = deps.schedule(() => ticks++, 1);
  let fired = false;
  deps.delay(() => (fired = true), 1)();
  await new Promise((resolve) => setTimeout(resolve, 10));
  stopInterval();
  assert.equal(fired, false);
  assert.ok(ticks > 0);
  const settled = ticks;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(ticks, settled);

  // `defer` is deliberately not called here. Its `MessageChannel` is never closed — as the transport's own
  // deferral port never was before this seam — so the port would keep Node's event loop alive and `pnpm test`
  // would never exit. The transport's use of `defer` is covered through the injected one instead.
});

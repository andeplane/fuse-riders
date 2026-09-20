import test from "node:test";
import {
  SNAPSHOT_INTERVAL,
  SAMPLE_WINDOW_MS,
  SLEW_TICKS_PER_SECOND,
  CREATOR_SILENCE_MS,
  DISCONNECT_MS,
  SNAPSHOT_RETRY_MS,
  SNAPSHOT_SERVE_MS,
  pageGeneration,
  roomHash,
  packMessage,
} from "fuse-netcode";
import { RoomRuntime } from "../src/online/room-runtime.js";
import assert from "node:assert/strict";
import { FakeNetwork, type NetworkOptions } from "./fixtures/fake-room.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";
import { COUNTDOWN_TICKS, RIDER_COLORS } from "../src/engine/game.js";
import { validRiderName } from "../src/engine/rider-name.js";
import { presentFrames } from "../src/render/time/present.js";
import type { WorldView } from "../src/engine/view.js";
import { RULES } from "../src/engine/apply-tick.js";
import { hashRoomState } from "../src/engine/apply-tick.js";

// The classic arena: these rooms are driven by idle riders, and scenery would end their rounds before the
// membership, resync and delegation behaviour under test had played out.
const settings = { ...defaultRoomSettings(), map: "classic" as const };
const HOST = "a-host",
  GUESTS = ["b-guest", "c-guest", "d-guest", "e-guest"],
  TV = "f-tv";
function room(
  options: NetworkOptions = {
    loss: 0,
    baseMs: 20,
    jitterMs: 0,
    reliableMs: 30,
  },
  seed = 1,
) {
  const net = new FakeNetwork(HOST, options, seed);
  const join = (id: string, name: string) => {
    const runtime = net.add(id, settings, { humanName: name });
    runtime.start();
    runtime.command({ type: "join", name });
    return runtime;
  };
  return { net, join };
}
const world = (runtime: RoomRuntime) =>
  (
    runtime as unknown as {
      world: { state: Parameters<typeof hashRoomState>[0]; tick: number };
    }
  ).world;
const hashes = (net: FakeNetwork, ids: string[]) =>
  new Set(ids.map((id) => hashRoomState(world(net.runtimes.get(id)!).state)));

test("the creator opens a fresh world, seats joiners, adds bots and starts; everyone folds the same log", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  assert.deepEqual(net.recorded.get(HOST)!.ready, [[HOST, true]]);
  assert.equal(net.frame(HOST)!.players.length, 1);
  assert.equal(net.frame(HOST)!.players[0]!.name, "Host");
  const guest = join(GUESTS[0]!, "Guest");
  net.step(900);
  assert.deepEqual(net.recorded.get(GUESTS[0]!)!.ready, [[GUESTS[0]!, false]]);
  assert.deepEqual(
    net.frame(GUESTS[0]!)!.players.map((p) => p.name),
    ["Host", "Guest"],
    "the guest received a snapshot and the join entry",
  );
  assert.equal(host.command({ type: "bot", action: "add" }), true);
  assert.equal(guest.command({ type: "bot", action: "add" }), false);
  assert.equal(host.command({ type: "action", action: "start" }), true);
  net.step(100);
  assert.equal(net.frame(GUESTS[0]!)!.phase, "countdown");
  assert.equal(net.frame(GUESTS[0]!)!.players.length, 3);
  const botName = net
    .frame(GUESTS[0]!)!
    .players.find((p) => p.id.startsWith("bot:"))!.name;
  assert.match(
    botName,
    /^AI \w+$/,
    "an added AI has no difficulty label in the replicated roster",
  );
  assert.equal(
    host.command({ type: "action", action: "start" }),
    false,
    "already running",
  );
  net.step(COUNTDOWN_TICKS * 50 + 200);
  assert.equal(net.frame(HOST)!.phase, "playing");
  assert.equal(net.frame(GUESTS[0]!)!.phase, "playing");
  guest.command({
    type: "input",
    seq: 1,
    left: true,
    right: false,
    bomb: false,
  });
  guest.command({
    type: "input",
    seq: 2,
    left: true,
    right: false,
    bomb: false,
  });
  net.step(500);
  assert.equal(hashes(net, [HOST, GUESTS[0]!]).size, 1);
  const angle = net.frame(HOST)!.players.find((p) => p.id === GUESTS[0])!.angle;
  assert.notEqual(
    angle,
    net.frame(HOST)!.players.find((p) => p.id === HOST)!.angle,
  );
  assert.equal(net.runtimes.get(HOST)!.metrics().rtt[GUESTS[0]!], 40);
  assert.ok(
    Math.abs(
      net.runtimes.get(GUESTS[0]!)!.metrics().clockTick -
        net.runtimes.get(HOST)!.metrics().clockTick,
    ) < 1,
  );
  assert.match(net.recorded.get(HOST)!.statuses.join("|"), /direct game link/);
  host.stop();
  guest.stop();
});

test("five riders and a TV keep one world through 5% loss, 100 ms jitter and reordering; gaps repair within 600 ms", () => {
  const { net, join } = room(
    { loss: 0.05, baseMs: 20, jitterMs: 100, reliableMs: 40 },
    7,
  );
  const host = join(HOST, "Host");
  net.step(200);
  const guests = GUESTS.map((id, index) => {
    const runtime = join(id, `Rider ${index}`);
    net.step(150);
    return runtime;
  });
  const tv = net.add(TV, settings, { displayOnly: true });
  tv.start();
  net.step(600);
  assert.equal(net.frame(TV)!.players.length, 5);
  assert.equal(host.command({ type: "action", action: "start" }), true);
  net.step(COUNTDOWN_TICKS * 50 + 300);
  let steer = 0,
    longestGapMs = 0;
  const gapSince = new Map<string, number>();
  for (let elapsed = 0; elapsed < 20_000; elapsed += 50) {
    for (const [index, guest] of guests.entries()) {
      const flags = Math.floor(((elapsed / 50) * 7 + index * 13) % 5);
      guest.command({
        type: "input",
        seq: ++steer,
        left: flags === 1,
        right: flags === 2,
        bomb: flags === 3,
        ...(flags === 3
          ? { bombAction: "press" as const }
          : flags === 4
            ? { bombAction: "release" as const }
            : {}),
      });
    }
    net.step(50);
    for (const [id, runtime] of net.runtimes)
      for (const [from, stream] of world(runtime).state.folds.size
        ? (
            runtime as unknown as {
              world: { streams: Map<string, { gap: boolean }> };
            }
          ).world.streams
        : []) {
        const key = `${id}<${from}`;
        if (stream.gap) {
          if (!gapSince.has(key)) gapSince.set(key, net.now);
          longestGapMs = Math.max(longestGapMs, net.now - gapSince.get(key)!);
        } else gapSince.delete(key);
      }
  }
  assert.ok(longestGapMs <= 600, `longest unrepaired gap ${longestGapMs} ms`);
  net.step(2500);
  assert.equal(
    hashes(net, [HOST, ...GUESTS, TV]).size,
    1,
    "every replica agrees once packets settle",
  );
  assert.ok(net.droppedFast > 0);
  assert.ok(
    [...net.runtimes.values()].some(
      (runtime) => runtime.metrics().rollbacks > 0,
    ),
    "late packets rolled back",
  );
  assert.ok(
    [...net.runtimes.values()].every(
      (runtime) => runtime.metrics().mismatches === 0,
    ),
    "no divergence",
  );
  const perSecond = net.bytesFast / 6 / 5 / (net.now / 1000);
  assert.ok(perSecond < 15_000, `${Math.round(perSecond)} B/s per link`);
  assert.ok(world(host).state.game.round >= 1);
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test("malformed, foreign and oversized fast packets change nothing; the clock tracks the authority under asymmetric delay", () => {
  const { net, join } = room({
    loss: 0,
    baseMs: 20,
    jitterMs: 0,
    reliableMs: 30,
    oneWayMs: (from: string) => (from === HOST ? 90 : 10),
  });
  const host = join(HOST, "Host");
  net.step(200);
  const guest = join(GUESTS[0]!, "Guest");
  net.step(1500);
  const before = hashRoomState(world(guest).state),
    tick = world(guest).tick;
  const transport = net.transports.get(GUESTS[0]!)!;
  for (const bytes of [
    new Uint8Array(600),
    packMessage([1, roomHash("other"), HOST, 1, 5, 0, [], 1, 0, 0, 1, null]),
    packMessage([
      1,
      roomHash("AB42:a-host"),
      "someone",
      1,
      5,
      0,
      [],
      1,
      0,
      0,
      1,
      null,
    ]),
    packMessage([2, 1, "x", 1]),
    packMessage("junk"),
    packMessage([
      1,
      roomHash("AB42:a-host"),
      HOST,
      1,
      5,
      99,
      [[1, 999999, 0, 1]],
      1,
      0,
      0,
      1,
      null,
    ]),
  ])
    transport.events.fast(HOST, bytes);
  assert.equal(hashRoomState(world(guest).state), before);
  assert.equal(world(guest).tick, tick);
  net.step(4000);
  const drift = guest.metrics().clockTick - host.metrics().clockTick;
  assert.ok(
    Math.abs(drift) <= 1,
    `follower within one tick of the authority: ${drift}`,
  );
  assert.equal(guest.metrics().rtt[HOST], 100);
  host.stop();
  guest.stop();
});

test("a silent rider is marked absent after one second, play continues, and its return restores the seat", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const guest = join(GUESTS[0]!, "Guest");
  net.step(400);
  host.command({ type: "action", action: "start" });
  net.step(COUNTDOWN_TICKS * 50 + 200);
  net.ticks.delete(GUESTS[0]!); // The guest's tab froze: no packets leave it.
  net.step(DISCONNECT_MS + 300);
  assert.equal(
    net.frame(HOST)!.players.find((p) => p.id === GUESTS[0])!.connected,
    false,
  );
  const stalled = world(host).tick;
  net.step(3000);
  assert.ok(
    world(host).tick > stalled + 40,
    "the world keeps running past the absent rider",
  );
  net.ticks.set(GUESTS[0]!, () =>
    (guest as unknown as { tickLoop(): void }).tickLoop(),
  );
  net.step(3000);
  assert.equal(
    net.frame(HOST)!.players.find((p) => p.id === GUESTS[0])!.connected,
    true,
    "the creator re-enables a rider whose packets resumed",
  );
  assert.equal(hashes(net, [HOST, GUESTS[0]!]).size, 1);
  host.stop();
  guest.stop();
});

test("a guest refresh mid-round installs a snapshot with a new generation and converges", () => {
  const { net, join } = room(
    { loss: 0.02, baseMs: 15, jitterMs: 30, reliableMs: 30 },
    3,
  );
  const host = join(HOST, "Host");
  net.step(200);
  join(GUESTS[0]!, "Guest");
  join(GUESTS[1]!, "Other");
  net.step(600);
  host.command({ type: "action", action: "start" });
  net.step(COUNTDOWN_TICKS * 50 + 500);
  const reloaded = net.reload(GUESTS[0]!, settings, { humanName: "Guest" });
  reloaded.command({ type: "join", name: "Guest" });
  net.step(3000);
  assert.equal(
    net.frame(GUESTS[0]!)!.players.find((p) => p.id === GUESTS[0])!.connected,
    true,
  );
  reloaded.command({
    type: "input",
    seq: 1,
    left: false,
    right: true,
    bomb: false,
  });
  net.step(1500);
  assert.equal(hashes(net, [HOST, GUESTS[0]!, GUESTS[1]!]).size, 1);
  assert.ok(reloaded.metrics().tick > 0);
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test("a creator refresh mid-round rejoins the running world from a peer; a creator silent for five seconds is delegated", () => {
  const { net, join } = room();
  let host = join(HOST, "Host");
  net.step(200);
  const guest = join(GUESTS[0]!, "Guest");
  join(GUESTS[1]!, "Other");
  net.step(600);
  host.command({ type: "action", action: "start" });
  net.step(COUNTDOWN_TICKS * 50 + 500);
  const matchId = net.frame(GUESTS[0]!)!.matchId;
  host = net.reload(HOST, settings, { humanName: "Host" });
  host.command({ type: "join", name: "Host" });
  net.step(3000);
  assert.equal(
    net.frame(HOST)!.matchId,
    matchId,
    "the creator recovered the running match rather than starting over",
  );
  assert.equal(
    net.frame(HOST)!.players.find((p) => p.id === HOST)!.connected,
    true,
  );
  assert.equal(hashes(net, [HOST, GUESTS[0]!, GUESTS[1]!]).size, 1);
  assert.equal(host.command({ type: "action", action: "lobby" }), true);
  net.step(300);
  assert.equal(net.frame(GUESTS[0]!)!.phase, "lobby");
  host.command({ type: "action", action: "start" });
  net.step(COUNTDOWN_TICKS * 50 + 300);
  net.ticks.delete(HOST);
  net.step(CREATOR_SILENCE_MS + 1500);
  assert.equal(
    net.frame(GUESTS[0]!)!.players.find((p) => p.id === HOST)!.connected,
    false,
    "the lowest rider logged the creator absent",
  );
  assert.match(
    net.recorded.get(GUESTS[0]!)!.statuses.join("|"),
    /Waiting for Host/,
  );
  const tick = world(guest).tick;
  net.step(2000);
  assert.ok(world(guest).tick > tick + 30, "play resumed without the creator");
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test("a divergence resync re-installs the world without restarting the member's own stream, so later inputs still reach peers", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const guest = join(GUESTS[0]!, "Guest");
  net.step(900);
  host.command({ type: "action", action: "start" });
  net.step(COUNTDOWN_TICKS * 50 + 300);
  guest.command({
    type: "input",
    seq: 1,
    left: true,
    right: false,
    bomb: false,
  });
  net.step(300);
  const before = (
    world(host) as unknown as { streams: Map<string, { contiguous: number }> }
  ).streams.get(GUESTS[0]!)!.contiguous;
  assert.ok(before >= 1);
  (guest as unknown as { requestSnapshot(): void }).requestSnapshot();
  net.step(600);
  assert.equal(
    guest.metrics().snapshotRequest,
    false,
    "the snapshot installed",
  );
  guest.command({
    type: "input",
    seq: 2,
    left: false,
    right: true,
    bomb: false,
  });
  guest.command({
    type: "input",
    seq: 3,
    left: false,
    right: false,
    bomb: true,
    bombAction: "press",
  });
  net.step(600);
  assert.ok(
    (
      world(host) as unknown as { streams: Map<string, { contiguous: number }> }
    ).streams.get(GUESTS[0]!)!.contiguous >=
      before + 2,
    "the host keeps applying the guest's entries after the resync",
  );
  assert.equal(hashes(net, [HOST, GUESTS[0]!]).size, 1);
  host.stop();
  guest.stop();
});

test("an entry that left its owner's retained window before it could be sent is recovered by a snapshot instead of a permanent stall", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const guest = join(GUESTS[0]!, "Guest");
  const other = join(GUESTS[1]!, "Other");
  net.step(900);
  host.command({ type: "action", action: "start" });
  net.step(COUNTDOWN_TICKS * 50 + 300);
  net.muted.add(GUESTS[1]!);
  other.command({
    type: "input",
    seq: 1,
    left: true,
    right: false,
    bomb: false,
  });
  net.step(3000); // Silent long enough to be marked absent and to age the entry out.
  net.muted.delete(GUESTS[1]!);
  net.step(1500);
  other.command({
    type: "input",
    seq: 2,
    left: false,
    right: true,
    bomb: false,
  });
  net.step(4000);
  assert.equal(
    net.frame(HOST)!.players.find((p) => p.id === GUESTS[1])!.connected,
    true,
  );
  const stalled = world(host).tick;
  net.step(2000);
  assert.ok(
    world(host).tick > stalled + 30,
    "the host is not stalled on the lost entry",
  );
  assert.ok(world(guest).tick > stalled + 20, "nor is the other guest");
  assert.equal(hashes(net, [HOST, GUESTS[0]!, GUESTS[1]!]).size, 1);
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test("a joiner whose snapshot source vanishes retries other peers and reports repeated failures", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  join(GUESTS[0]!, "Guest");
  net.step(600);
  const late = net.add(GUESTS[1]!, settings);
  late.start();
  net.step(60); // welcome, peers announced, links opening
  net.transports.get(HOST)!.deaf = true;
  net.transports.get(GUESTS[0]!)!.deaf = true; // nobody hears the request
  net.step(SNAPSHOT_RETRY_MS * 3 + 900);
  assert.match(
    net.recorded.get(GUESTS[1]!)!.statuses.join("|"),
    /reload this page/,
  );
  net.transports.get(HOST)!.deaf = false;
  net.step(SNAPSHOT_RETRY_MS + 500);
  void host;
  assert.equal(
    net.frame(GUESTS[1]!)!.players.length,
    2,
    "a later attempt succeeds",
  );
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test("solo runs a room with no peers: one human, four AI, a paused clock while hidden and lobby actions", () => {
  const net = new FakeNetwork("solo", {
    loss: 0,
    baseMs: 0,
    jitterMs: 0,
    reliableMs: 0,
  });
  const recorded: string[] = [];
  let frame: WorldView | undefined;
  const runtime = new RoomRuntime(
    "SOLO",
    { ...settings, mode: "shared" },
    {
      state: (state) => {
        frame = state;
      },
      event: () => {},
      status: (text) => recorded.push(text),
      ready: (id) => recorded.push(`ready:${id}`),
    },
    { humanName: "Player", dependencies: net.dependencies("solo") },
  );
  assert.equal(runtime.command({ type: "action", action: "start" }), false);
  runtime.start();
  runtime.start();
  assert.ok(recorded.includes("ready:solo"), recorded.join("|"));
  assert.equal(frame!.players.length, 5);
  assert.equal(frame!.players[0]!.name, "Player");
  assert.equal(frame!.phase, "countdown");
  net.step(COUNTDOWN_TICKS * 50 + 100);
  assert.equal(frame!.phase, "playing");
  assert.equal(runtime.solo, true);
  assert.equal(
    runtime.command({
      type: "input",
      seq: 0,
      left: true,
      right: false,
      bomb: true,
      bombAction: "press",
    }),
    true,
  );
  net.step(50);
  assert.notEqual(frame!.players[0]!.bombChargeStartedTick, undefined);
  const view = presentFrames(runtime.presentation()!);
  assert.equal(view.players[0]!.presentationTick! > frame!.tick - 1, true);
  net.setHidden("solo", true);
  const paused = frame!.tick;
  net.step(5000);
  assert.equal(frame!.tick, paused);
  assert.equal(
    frame!.players[0]!.bombChargeStartedTick,
    undefined,
    "hiding cancels the charge",
  );
  assert.equal(
    recorded.at(-1),
    "Solo · you and four AI riders",
    "the recurring status returns once the notice hold expires",
  );
  assert.equal(
    runtime.command({
      type: "input",
      seq: 1,
      left: true,
      right: false,
      bomb: false,
    }),
    false,
  );
  net.setHidden("solo", false);
  net.step(110);
  assert.ok(
    frame!.tick >= paused + 1 && frame!.tick <= paused + 2,
    `resumed: ${frame!.tick} after ${paused}`,
  );
  assert.equal(runtime.command({ type: "action", action: "lobby" }), true);
  net.step(60);
  assert.equal(frame!.phase, "lobby");
  assert.equal(
    runtime.command({
      type: "settings",
      settings: { ...settings, mode: "shared", length: 2 },
    }),
    true,
  );
  net.step(60);
  assert.equal(runtime.command({ type: "action", action: "start" }), true);
  net.step(60);
  assert.equal(frame!.phase, "countdown");
  assert.equal(runtime.command({ type: "action", action: "rematch" }), false);
  assert.equal(
    runtime.command({ type: "bot", action: "remove", id: "nope" }),
    false,
  );
  assert.equal(
    runtime.command({ type: "bot", action: "add" }),
    false,
    "five seats are taken",
  );
  // The command is accepted — the entry is this rider's to write — but the fold refuses the head, because the four AI
  // riders in this solo room wear `robot` and a human that wore it too could not be told from them (rules 48).
  assert.equal(runtime.command({ type: "avatar", avatarId: "robot" }), true);
  net.step(60);
  assert.notEqual(frame!.players[0]!.avatarId, "robot");
  // A head no rider wears still applies, so the rule blocks the clash and not the choice.
  assert.equal(runtime.command({ type: "avatar", avatarId: "dragon" }), true);
  net.step(60);
  assert.equal(frame!.players[0]!.avatarId, "dragon");
  // Colour is the same bargain: a free one is taken, and the AI riders already hold the four below it.
  assert.equal(runtime.command({ type: "color", colorIndex: 6 }), true);
  net.step(60);
  assert.equal(frame!.players[0]!.color, RIDER_COLORS[6]);
  assert.equal(
    new Set(frame!.players.map((player) => player.color)).size,
    frame!.players.length,
    "every rider in the room wears a different colour",
  );
  runtime.stop();
  runtime.stop();
  assert.equal(
    runtime.command({ type: "action", action: "lobby" }),
    true,
    "commands still fold locally after stop",
  );
});

test("a storm of snapshot requests gets one snapshot per peer per half second", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const guest = join(GUESTS[0]!, "Guest");
  net.step(900);
  const transport = net.transports.get(HOST)!;
  net.step(SNAPSHOT_SERVE_MS); // The join's own snapshot was served inside the window.
  const before = transport.reliableSends;
  transport.events.message(GUESTS[0]!, { type: "snapshotRequest" });
  const chunks = transport.reliableSends - before;
  assert.ok(chunks >= 1, "a request is answered with the snapshot chunks");
  for (let i = 0; i < 20; i++)
    transport.events.message(GUESTS[0]!, { type: "snapshotRequest" });
  assert.equal(
    transport.reliableSends - before,
    chunks,
    "repeats inside the window are ignored",
  );
  net.step(SNAPSHOT_SERVE_MS + 10);
  transport.events.message(GUESTS[0]!, { type: "snapshotRequest" });
  assert.equal(
    transport.reliableSends - before,
    2 * chunks,
    "the next window is served again",
  );
  host.stop();
  guest.stop();
});

test("a press during a second of lost packets still charges from the original tick once the link returns, and the release fires it", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const guest = join(GUESTS[0]!, "Guest");
  net.step(900);
  assert.equal(host.command({ type: "action", action: "start" }), true);
  net.step(COUNTDOWN_TICKS * 50 + 300);
  net.muted.add(GUESTS[0]!);
  guest.command({
    type: "input",
    seq: 1,
    left: false,
    right: false,
    bomb: true,
    bombAction: "press",
  });
  net.step(60);
  const pressTick = net
    .frame(GUESTS[0]!)!
    .players.find((p) => p.id === GUESTS[0])!.bombChargeStartedTick;
  assert.ok(pressTick !== undefined, "the guest charges at once");
  for (let i = 0; i < 18; i++) {
    guest.command({
      type: "input",
      seq: 2 + i,
      left: false,
      right: false,
      bomb: true,
    });
    net.step(50);
  }
  assert.equal(
    net.frame(HOST)!.players.find((p) => p.id === GUESTS[0])!
      .bombChargeStartedTick,
    undefined,
    "the host has not heard the press",
  );
  net.muted.delete(GUESTS[0]!);
  net.step(400);
  assert.equal(
    net.frame(HOST)!.players.find((p) => p.id === GUESTS[0])!
      .bombChargeStartedTick,
    pressTick,
    "the late press rolled the host back to the original tick",
  );
  guest.command({
    type: "input",
    seq: 30,
    left: false,
    right: false,
    bomb: false,
    bombAction: "release",
  });
  net.step(400);
  const bomb = net.frame(HOST)!.bombs.find((b) => b.ownerId === GUESTS[0]);
  assert.ok(bomb, "the release launched a bomb on the host");
  assert.ok(
    bomb.launchedTick - pressTick >= 20,
    `charged for ${bomb.launchedTick - pressTick} ticks`,
  );
  assert.equal(hashes(net, [HOST, GUESTS[0]!]).size, 1);
  host.stop();
  guest.stop();
});

test("while the creator is absent the delegate carries its duties: a further silent rider is marked absent and play continues", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const riders = GUESTS.slice(0, 3).map((id, index) => {
    const runtime = join(id, `Rider ${index}`);
    net.step(150);
    return runtime;
  });
  net.step(600);
  assert.equal(host.command({ type: "action", action: "start" }), true);
  net.step(COUNTDOWN_TICKS * 50 + 300);
  net.muted.add(HOST);
  net.step(CREATOR_SILENCE_MS + 1500);
  // An absent rider loses its seat at the next round boundary, so absence shows as disconnected or gone.
  const seated = (viewer: RoomRuntime, id: string) =>
    world(viewer).state.game.players.get(id)?.connected ?? false;
  assert.equal(
    seated(riders[0]!, HOST),
    false,
    "the delegate marked the creator absent",
  );
  net.muted.add(GUESTS[2]!);
  const before = net.frame(GUESTS[0]!)!.tick;
  net.step(4000);
  assert.equal(
    seated(riders[0]!, GUESTS[2]!),
    false,
    "the delegate marked the silent rider absent",
  );
  assert.ok(
    net.frame(GUESTS[0]!)!.tick > before + 40,
    `play continued ${net.frame(GUESTS[0]!)!.tick - before} ticks past the stall window`,
  );
  assert.equal(hashes(net, [GUESTS[0]!, GUESTS[1]!]).size, 1);
  host.stop();
  for (const rider of riders) rider.stop();
});

test("a creator and its delegate dropping together are both marked absent by the next rider, and play continues", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const riders = GUESTS.slice(0, 3).map((id, index) => {
    const runtime = join(id, `Rider ${index}`);
    net.step(150);
    return runtime;
  });
  net.step(600);
  assert.equal(host.command({ type: "action", action: "start" }), true);
  net.step(COUNTDOWN_TICKS * 50 + 300);
  net.muted.add(HOST);
  net.muted.add(GUESTS[0]!);
  net.step(CREATOR_SILENCE_MS + 2500);
  const c = world(riders[1]!).state.game.players;
  assert.equal(c.get(HOST)?.connected ?? false, false);
  assert.equal(
    c.get(GUESTS[0]!)?.connected ?? false,
    false,
    "the silent delegate is absent too",
  );
  const before = net.frame(GUESTS[1]!)!.tick;
  net.step(3000);
  assert.ok(net.frame(GUESTS[1]!)!.tick > before + 40, "play continues");
  assert.equal(hashes(net, [GUESTS[1]!, GUESTS[2]!]).size, 1);
  host.stop();
  for (const rider of riders) rider.stop();
});

test("presses keep working after a rider was marked absent and returned", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const guest = join(GUESTS[0]!, "Guest");
  net.step(900);
  assert.equal(host.command({ type: "action", action: "start" }), true);
  net.step(COUNTDOWN_TICKS * 50 + 300);
  guest.command({
    type: "input",
    seq: 1,
    left: false,
    right: false,
    bomb: true,
    bombAction: "press",
  });
  net.step(100);
  guest.command({
    type: "input",
    seq: 2,
    left: false,
    right: false,
    bomb: false,
    bombAction: "release",
  });
  net.step(100);
  net.muted.add(GUESTS[0]!);
  net.step(DISCONNECT_MS + 400);
  assert.equal(
    net.frame(HOST)!.players.find((p) => p.id === GUESTS[0])!.connected,
    false,
    "the creator logged the silence",
  );
  net.muted.delete(GUESTS[0]!);
  net.step(600);
  assert.equal(
    net.frame(HOST)!.players.find((p) => p.id === GUESTS[0])!.connected,
    true,
    "and the return",
  );
  assert.doesNotThrow(() =>
    guest.command({
      type: "input",
      seq: 3,
      left: false,
      right: false,
      bomb: true,
      bombAction: "press",
    }),
  );
  net.step(300);
  assert.equal(
    (
      net.runtimes.get(HOST)! as unknown as {
        world: { streams: Map<string, { latestOrdinal(): number }> };
      }
    ).world.streams
      .get(GUESTS[0]!)!
      .latestOrdinal(),
    2,
    "the new gesture id continues the sequence and every replica accepted it",
  );
  assert.equal(hashes(net, [HOST, GUESTS[0]!]).size, 1);
  host.stop();
  guest.stop();
});

test("a burst of settings saves reaches every rider within a second, with no snapshot", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const guest = join(GUESTS[0]!, "Guest");
  net.step(900);
  const requests = () =>
      net.reliableLog.filter((message) => message.type === "snapshotRequest")
        .length,
    before = requests();
  for (const length of [5, 6, 7]) {
    assert.equal(
      host.command({ type: "settings", settings: { ...settings, length } }),
      true,
    );
    net.step(100);
  }
  net.step(700);
  assert.equal(
    world(guest).state.settings.length,
    7,
    "the last save arrived through the packets",
  );
  assert.equal(requests(), before, "no rider needed a snapshot");
  host.stop();
  guest.stop();
});

test("after a lobby reset drops an absent rider, a joiner still receives a valid world", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const guest = join(GUESTS[0]!, "Guest");
  net.step(300);
  const third = join(GUESTS[1]!, "Third");
  net.step(900);
  assert.equal(host.command({ type: "action", action: "start" }), true);
  net.step(COUNTDOWN_TICKS * 50 + 300);
  net.muted.add(GUESTS[1]!);
  net.step(DISCONNECT_MS + 400);
  assert.equal(host.command({ type: "action", action: "lobby" }), true);
  net.step(300);
  assert.deepEqual(
    net
      .frame(HOST)!
      .players.map((p) => p.id)
      .sort(),
    [HOST, GUESTS[0]!],
    "the absent rider lost its seat",
  );
  const late = join(GUESTS[2]!, "Late");
  net.step(1500);
  assert.deepEqual(
    net
      .frame(GUESTS[2]!)!
      .players.map((p) => p.id)
      .sort(),
    [HOST, GUESTS[0]!, GUESTS[2]!],
    "the joiner installed the reset world and took a seat",
  );
  host.stop();
  guest.stop();
  third.stop();
  late.stop();
});

test("an undecodable snapshot waits for the retry timer instead of asking again at once", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  net.transports.get(HOST)!.deaf = true; // The creator never answers, so the joiner's request stays pending.
  const guest = join(GUESTS[0]!, "Guest");
  net.step(900);
  const requests = () =>
    net.reliableLog.filter(
      (message) =>
        message.type === "snapshotRequest" && message.from === GUESTS[0],
    ).length;
  assert.equal(requests(), 1);
  const bogus = {
    type: "snapshot",
    tick: 0,
    rules: RULES,
    room: roomHash(`AB42:${HOST}`),
    chunk: 0,
    total: 1,
    data: btoa(String.fromCharCode(...packMessage("nope"))),
  };
  net.transports.get(GUESTS[0]!)!.events.message(HOST, bogus);
  net.step(SNAPSHOT_RETRY_MS - 200);
  assert.equal(requests(), 1, "no new request inside the retry window");
  net.step(400);
  assert.equal(requests(), 2, "one retry after the window");
  host.stop();
  guest.stop();
});

test("a creator and a joiner that connect at the same moment open one fresh world: a noWorld answer completes the request", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  const guest = join(GUESTS[0]!, "Guest");
  net.step(3500);
  assert.deepEqual(
    net
      .frame(HOST)
      ?.players.map((p) => p.name)
      .sort(),
    ["Guest", "Host"],
    "the creator opened a lobby and seated the joiner",
  );
  assert.deepEqual(
    net
      .frame(GUESTS[0]!)
      ?.players.map((p) => p.name)
      .sort(),
    ["Guest", "Host"],
    "the joiner got the world",
  );
  assert.ok(net.frame(HOST)!.tick > 20, "the room is ticking");
  assert.equal(hashes(net, [HOST, GUESTS[0]!]).size, 1);
  assert.ok(
    !net.recorded.get(HOST)!.statuses.some((text) => /reload/.test(text)),
    "no reload warning",
  );
  host.stop();
  guest.stop();
});

test("page generations differ for loads a tenth of a second apart and fit the packet field", () => {
  const at = Date.parse("2026-09-16T00:00:00Z");
  assert.notEqual(pageGeneration(at), pageGeneration(at + 100));
  assert.ok(pageGeneration(at + 100) > pageGeneration(at));
  assert.ok(
    Number.isInteger(pageGeneration(at)) && pageGeneration(at) < 2 ** 32,
  );
});

test("a creator and four joiners that all connect at once open one world and everyone is seated within three seconds", () => {
  const { net, join } = room();
  const all = [HOST, ...GUESTS],
    runtimes = all.map((id) => join(id, id));
  net.step(3000);
  for (const id of all)
    assert.deepEqual(
      net
        .frame(id)
        ?.players.map((p) => p.id)
        .sort(),
      [...all].sort(),
      `${id} sees every rider`,
    );
  assert.equal(hashes(net, all).size, 1);
  assert.ok(
    !net.recorded.get(HOST)!.statuses.some((text) => /reload/.test(text)),
  );
  for (const runtime of runtimes) runtime.stop();
});

test("once both humans are out every member runs three steps per log tick while the clock keeps its rate, stays in one world and drops back at round over", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const guest = join(GUESTS[0]!, "Guest");
  net.step(900);
  for (let i = 0; i < 3; i++) host.command({ type: "bot", action: "add" });
  host.command({ type: "action", action: "start" });
  net.step(COUNTDOWN_TICKS * 50 + 200);
  // The wall clock's rate, sampled on both members every half second for the whole run: ten ticks each time.
  const rates: number[] = [];
  let last: number[] | undefined;
  const step = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 50) {
      net.step(50);
      if (net.now % 500 !== 0) continue;
      const now = [host.metrics().clockTick, guest.metrics().clockTick];
      if (last) rates.push(now[0]! - last[0]!, now[1]! - last[1]!);
      last = now;
    }
  };
  const botsOnly = () => {
    const frame = net.frame(HOST)!;
    return (
      frame.phase === "playing" &&
      frame.players.every(
        (p) => p.alive === p.id.startsWith("bot:") || !p.alive,
      ) &&
      frame.players.some((p) => p.alive)
    );
  };
  for (let i = 0; i < 600 && !botsOnly(); i++) step(50);
  assert.ok(
    botsOnly(),
    "the unsteered humans crashed while AI riders were still racing",
  );
  step(300);
  const before = net.frame(HOST)!,
    logBefore = world(host).tick;
  step(500);
  assert.equal(net.frame(HOST)!.phase, "playing");
  assert.ok(
    Math.abs(net.frame(HOST)!.tick - before.tick - 30) <= 3,
    `thirty game ticks in half a second: ${net.frame(HOST)!.tick - before.tick}`,
  );
  assert.ok(
    Math.abs(world(host).tick - logBefore - 10) <= 1,
    `ten log ticks in half a second: ${world(host).tick - logBefore}`,
  );
  assert.ok(
    Math.abs(guest.metrics().clockTick - host.metrics().clockTick) < 6,
    `clocks stay together: ${guest.metrics().clockTick - host.metrics().clockTick}`,
  );
  for (let i = 0; i < 1200 && net.frame(HOST)!.phase === "playing"; i++)
    step(50);
  assert.equal(net.frame(HOST)!.phase, "roundOver");
  step(200);
  const after = net.frame(HOST)!.tick;
  step(500);
  assert.ok(
    Math.abs(net.frame(HOST)!.tick - after - 10) <= 2,
    `normal pace after the round: ${net.frame(HOST)!.tick - after}`,
  );
  step(2000);
  assert.ok(Math.abs(guest.metrics().clockTick - host.metrics().clockTick) < 3);
  assert.ok(rates.length > 20);
  assert.ok(
    rates.every((ticks) => Math.abs(ticks - 10) < 0.5),
    `the wall clock never changed rate: ${rates.map((ticks) => ticks.toFixed(2)).join(" ")}`,
  );
  // The clocks may sit a tick apart when sampled, so compare the world both members have already simulated.
  const hashAt = (runtime: RoomRuntime, tick: number) =>
    (
      world(runtime) as unknown as { hashAt(tick: number): string | undefined }
    ).hashAt(tick);
  const shared =
    Math.floor(
      (Math.min(world(host).tick, world(guest).tick) - 1) / SNAPSHOT_INTERVAL,
    ) * SNAPSHOT_INTERVAL;
  assert.ok(
    hashAt(host, shared) !== undefined,
    "the shared tick is still in history",
  );
  assert.equal(hashAt(host, shared), hashAt(guest, shared));
  host.stop();
  guest.stop();
});

function botsOnlyRoom(options?: NetworkOptions) {
  const { net, join } = room(options);
  const host = join(HOST, "Host");
  net.step(200);
  const guest = join(GUESTS[0]!, "Guest");
  net.step(900);
  for (let i = 0; i < 3; i++) host.command({ type: "bot", action: "add" });
  host.command({ type: "action", action: "start" });
  net.step(COUNTDOWN_TICKS * 50 + 200);
  const botsOnly = () => {
    const frame = net.frame(HOST)!;
    return (
      frame.phase === "playing" &&
      frame.players.some((p) => p.alive) &&
      frame.players.every((p) => !p.alive || p.id.startsWith("bot:"))
    );
  };
  return {
    net,
    host,
    guest,
    botsOnly,
    untilBotsOnly: () => {
      for (let i = 0; i < 600 && !botsOnly(); i++) net.step(50);
      assert.ok(botsOnly());
    },
  };
}
const apart = (a: RoomRuntime, b: RoomRuntime) =>
  Math.abs(a.metrics().clockTick - b.metrics().clockTick);

test("a guest hidden before the last human dies does not hold the room back, and its clock stays with the authority's", () => {
  const f = botsOnlyRoom();
  f.net.step(300);
  f.net.setHidden(GUESTS[0]!, true);
  f.untilBotsOnly();
  f.net.step(1500);
  const before = f.net.frame(HOST)!.tick;
  f.net.step(500);
  assert.equal(f.net.frame(HOST)!.phase, "playing");
  assert.ok(
    f.net.frame(HOST)!.tick - before >= 27,
    `the room is not waiting on the hidden guest: ${f.net.frame(HOST)!.tick - before}`,
  );
  assert.ok(
    apart(f.host, f.guest) < 3,
    `the hidden guest's clock never left the authority's: ${apart(f.host, f.guest)}`,
  );
  f.host.stop();
  f.guest.stop();
});

test("a guest hidden while only AI riders race keeps the authority's clock throughout and catches up in the same world", () => {
  const f = botsOnlyRoom();
  f.untilBotsOnly();
  f.net.step(300);
  f.net.setHidden(GUESTS[0]!, true);
  let widest = 0;
  for (let i = 0; i < 1200 && f.net.frame(HOST)!.phase === "playing"; i++) {
    f.net.step(50);
    widest = Math.max(widest, apart(f.host, f.guest));
  }
  f.net.step(3000);
  widest = Math.max(widest, apart(f.host, f.guest));
  // There is no rate to disagree on: a hidden follower's clock is the authority's, give or take a round trip.
  assert.ok(widest < 3, `the clocks stayed together: ${widest}`);
  f.net.setHidden(GUESTS[0]!, false);
  for (
    let elapsed = 0;
    elapsed < 5000 &&
    (Math.abs(world(f.host).tick - world(f.guest).tick) > 2 ||
      f.guest.metrics().snapshotRequest);
    elapsed += 50
  )
    f.net.step(50);
  f.net.step(1000);
  assert.ok(
    apart(f.host, f.guest) < 3,
    `back in step: ${apart(f.host, f.guest)}`,
  );
  assert.ok(
    Math.abs(world(f.host).tick - world(f.guest).tick) <= 2,
    "the guest's world caught up",
  );
  assert.equal(f.host.metrics().mismatches + f.guest.metrics().mismatches, 0);
  assert.equal(f.guest.metrics().snapshotRequest, false);
  f.host.stop();
  f.guest.stop();
});

test("with a hidden guest on a lossy, reordering link the room keeps triple game speed", () => {
  const f = botsOnlyRoom({
    loss: 0.02,
    baseMs: 20,
    jitterMs: 120,
    reliableMs: 30,
  });
  f.net.step(300);
  f.net.setHidden(GUESTS[0]!, true);
  f.untilBotsOnly();
  f.net.step(1500);
  const before = f.net.frame(HOST)!.tick;
  f.net.step(1000);
  assert.equal(f.net.frame(HOST)!.phase, "playing");
  assert.ok(
    f.net.frame(HOST)!.tick - before >= 50,
    `the room keeps triple game speed through jitter: ${f.net.frame(HOST)!.tick - before}`,
  );
  f.host.stop();
  f.guest.stop();
});

test("a join is seated under the one rider-name rule: cut by code point, never through an emoji, and valid for a match report", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const fox = String.fromCodePoint(0x1f98a);
  // The join used to cut at 20 UTF-16 units: nineteen letters and half a fox, a name the history service refuses.
  join(GUESTS[0]!, "x".repeat(19) + fox);
  // Eleven foxes are 22 units; ten fit the log.
  join(GUESTS[1]!, fox.repeat(11));
  join(GUESTS[2]!, "  padded  ");
  net.step(900);
  const names = net.frame(HOST)!.players.map((player) => player.name);
  assert.deepEqual(names, ["Host", "x".repeat(18), fox.repeat(10), "padded"]);
  for (const name of names) assert.equal(validRiderName(name), true, name);
  for (const runtime of net.runtimes.values()) runtime.stop();
  host.stop();
});

test("a name carrying a control character is refused at the join and the rider is not seated; the characters either side of the range are kept", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  // NUL, the unit separator and DEL bound the join's pattern; a tab sits inside its range.
  for (const [index, code] of [0x00, 0x1f, 0x7f, 0x09].entries()) {
    const id = GUESTS[index]!;
    join(id, `Bad${String.fromCharCode(code)}name`);
    net.step(900);
    assert.ok(
      net.recorded
        .get(id)!
        .statuses.includes("Choose a name (1–18 characters)"),
      `character ${code}`,
    );
  }
  assert.deepEqual(
    net.frame(HOST)!.players.map((player) => player.name),
    ["Host"],
  );
  // The pattern stops at DEL. A tilde (0x7E) sits just below it and 0x80 just above, in the C1 range the join has
  // never refused: both are seated unchanged, so a pattern widened to either side fails here.
  const edges = "Ok~\x80name";
  join(TV, edges);
  net.step(900);
  assert.deepEqual(
    net.recorded
      .get(TV)!
      .statuses.filter((status) => /Choose a name/.test(status)),
    [],
  );
  assert.deepEqual(
    net.frame(HOST)!.players.map((player) => player.name),
    ["Host", edges],
  );
  for (const runtime of net.runtimes.values()) runtime.stop();
  host.stop();
});

test("the crown moves to the next seat while the creator is away, and back the moment it returns", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const first = join(GUESTS[0]!, "First");
  net.step(300);
  const second = join(GUESTS[1]!, "Second");
  net.step(900);
  assert.equal(net.frame(GUESTS[1]!)!.managerId, HOST);
  assert.equal(
    first.command({ type: "action", action: "start" }),
    false,
    "a guest manages nothing while the creator is here",
  );
  assert.equal(host.command({ type: "action", action: "start" }), true);
  net.step(COUNTDOWN_TICKS * 50 + 400);
  assert.equal(net.frame(GUESTS[0]!)!.phase, "playing");
  // The host's link drops mid-round: its tab is still open, but nothing it sends reaches the room.
  net.disconnect(HOST);
  net.step(CREATOR_SILENCE_MS + 2000);
  // Every replica that can hear the room folds the same log, so every screen in it names the same host.
  for (const id of [GUESTS[0]!, GUESTS[1]!])
    assert.equal(
      net.frame(id)!.managerId,
      GUESTS[0]!,
      `${id} names the rider in the next seat as host`,
    );
  assert.equal(
    second.command({ type: "settings", settings: { ...settings, length: 9 } }),
    false,
    "only the delegate, not every rider behind it",
  );
  assert.equal(
    first.command({ type: "settings", settings: { ...settings, length: 9 } }),
    true,
    "the delegate runs the room the absent creator cannot",
  );
  net.step(600);
  assert.equal(world(second).state.settings.length, 9);
  // The creator comes back. Its seat was freed at the round boundary it missed, as any absent rider's is, so it
  // takes one again — and the room is its own the moment it does, because its token still owns the room code.
  net.connect(HOST);
  net.step(6000);
  host.command({ type: "join", name: "Host" });
  net.step(2000);
  for (const id of [HOST, GUESTS[0]!, GUESTS[1]!])
    assert.equal(
      net.frame(id)!.managerId,
      HOST,
      `the creator's token still owns the room: ${id} gives the crown back`,
    );
  assert.equal(
    first.command({ type: "settings", settings: { ...settings, length: 7 } }),
    false,
    "and the delegate runs nothing again",
  );
  assert.equal(hashes(net, [HOST, GUESTS[0]!, GUESTS[1]!]).size, 1);
  host.stop();
  first.stop();
  second.stop();
});

test("a match whose host never comes back can still be taken back to the lobby by the next rider", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const first = join(GUESTS[0]!, "First");
  net.step(300);
  const second = join(GUESTS[1]!, "Second");
  net.step(900);
  assert.equal(host.command({ type: "action", action: "start" }), true);
  net.step(COUNTDOWN_TICKS * 50 + 400);
  assert.equal(net.frame(GUESTS[0]!)!.phase, "playing");
  // The host closes its tab mid-match. The room keeps running while riders stay in it (#262).
  host.stop();
  net.muted.add(HOST);
  net.step(CREATOR_SILENCE_MS + 2000);
  assert.equal(net.frame(GUESTS[0]!)!.managerId, GUESTS[0]!);
  assert.equal(
    first.command({ type: "action", action: "lobby" }),
    true,
    "the room does not need its creator to move on",
  );
  net.step(600);
  assert.equal(net.frame(GUESTS[1]!)!.phase, "lobby");
  assert.equal(
    first.command({ type: "action", action: "start" }),
    true,
    "and the next match is the delegate's to start",
  );
  net.step(300);
  assert.equal(net.frame(GUESTS[1]!)!.phase, "countdown");
  assert.equal(hashes(net, [GUESTS[0]!, GUESTS[1]!]).size, 1);
  first.stop();
  second.stop();
});

test("kick: the manager frees a human seat between rounds, the target is told, and it may come back", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const guest = join(GUESTS[0]!, "Guest");
  net.step(900);
  assert.equal(
    guest.command({ type: "kick", id: HOST }),
    false,
    "a guest cannot kick the host",
  );
  assert.equal(
    host.command({ type: "kick", id: HOST }),
    false,
    "and nobody kicks themselves",
  );
  assert.ok(host.command({ type: "bot", action: "add" }));
  net.step(300);
  const botId = net
    .frame(HOST)!
    .players.find((player) => player.id.startsWith("bot:"))!.id;
  assert.equal(
    host.command({ type: "kick", id: botId }),
    false,
    "an AI rider goes through its own button",
  );
  assert.equal(host.command({ type: "kick", id: GUESTS[0]! }), true);
  assert.equal(
    net.recorded.get(GUESTS[0]!)!.kicked,
    0,
    "the target is told once the seat is actually gone, not when the entry is written",
  );
  net.step(600);
  for (const id of [HOST, GUESTS[0]!])
    assert.deepEqual(
      net
        .frame(id)!
        .players.filter((player) => !player.id.startsWith("bot:"))
        .map((player) => player.id),
      [HOST],
      `${id} sees the seat freed outright, not merely offline`,
    );
  assert.equal(
    net.recorded.get(GUESTS[0]!)!.kicked,
    1,
    "the target's own screen is told why its seat went",
  );
  assert.ok(
    net.recorded
      .get(GUESTS[0]!)!
      .statuses.includes("The host removed you from the room"),
  );
  // Re-entry is allowed: a kick is a nudge out of this match, not a ban.
  guest.command({ type: "join", name: "Guest" });
  net.step(900);
  assert.ok(
    net.frame(HOST)!.players.some((player) => player.id === GUESTS[0]!),
    "the kicked rider may take a seat again",
  );
  host.stop();
  guest.stop();
});

test("kick: refused mid-round, allowed by the delegate, and it reaches a watcher in any phase", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const first = join(GUESTS[0]!, "First");
  net.step(300);
  const second = join(GUESTS[1]!, "Second");
  net.step(300);
  const watcher = net.add(TV, settings, { humanName: "Watcher" });
  watcher.start();
  watcher.command({ type: "spectate", name: "Watcher" });
  net.step(900);
  assert.deepEqual(
    net.frame(HOST)!.spectators.map((seat) => seat.id),
    [TV],
  );
  assert.equal(host.command({ type: "action", action: "start" }), true);
  net.step(COUNTDOWN_TICKS * 50 + 400);
  assert.equal(net.frame(HOST)!.phase, "playing");
  assert.equal(
    host.command({ type: "kick", id: GUESTS[1]! }),
    false,
    "mid-round a LEAVE only marks a rider absent, and its own page would rejoin",
  );
  assert.ok(
    net.recorded
      .get(HOST)!
      .statuses.includes("Remove riders between rounds or return to menu"),
  );
  // A watcher holds no seat and no simulation state, so it goes in any phase.
  assert.equal(host.command({ type: "kick", id: TV }), true);
  net.step(600);
  assert.deepEqual(net.frame(GUESTS[0]!)!.spectators, []);
  assert.equal(net.recorded.get(TV)!.kicked, 1);
  // With the creator gone the delegate holds the same escape hatch.
  host.stop();
  net.muted.add(HOST);
  net.step(CREATOR_SILENCE_MS + 2000);
  assert.equal(net.frame(GUESTS[0]!)!.managerId, GUESTS[0]!);
  assert.equal(first.command({ type: "action", action: "lobby" }), true);
  net.step(600);
  assert.equal(first.command({ type: "kick", id: GUESTS[1]! }), true);
  net.step(600);
  assert.deepEqual(
    net.frame(GUESTS[0]!)!.players.map((player) => player.id),
    [GUESTS[0]!],
  );
  assert.equal(net.recorded.get(GUESTS[1]!)!.kicked, 1);
  first.stop();
  second.stop();
  watcher.stop();
});

test("succession is read off the seats: the rider below the host takes over, not the lowest id", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  // Seats go in join order, so the rider with the higher id sits directly under the host. By id the other one would
  // be the delegate; by seat it is this one, which is what the lobby list shows.
  const below = join(GUESTS[2]!, "Below");
  net.step(300);
  const lower = join(GUESTS[1]!, "Lower");
  net.step(900);
  assert.deepEqual(
    net.frame(HOST)!.players.map((player) => [player.id, player.slot]),
    [
      [HOST, 0],
      [GUESTS[2]!, 1],
      [GUESTS[1]!, 2],
    ],
  );
  assert.ok(GUESTS[1]! < GUESTS[2]!, "and it is not the lowest id");
  net.disconnect(HOST);
  net.step(CREATOR_SILENCE_MS + 2000);
  for (const id of [GUESTS[1]!, GUESTS[2]!])
    assert.equal(net.frame(id)!.managerId, GUESTS[2]!, `${id} agrees`);
  assert.equal(
    lower.command({ type: "settings", settings: { ...settings, length: 9 } }),
    false,
  );
  assert.equal(
    below.command({ type: "settings", settings: { ...settings, length: 9 } }),
    true,
  );
  net.step(600);
  assert.equal(world(lower).state.settings.length, 9);
  host.stop();
  below.stop();
  lower.stop();
});

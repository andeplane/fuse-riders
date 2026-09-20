import test from "node:test";
import assert from "node:assert/strict";
import { FakeNetwork, type NetworkOptions } from "./fixtures/fake-room.js";
import { ScriptedPeer } from "./fixtures/scripted-peer.js";
import {
  DISCONNECT_MS,
  STALLED_GAP_MS,
  WINDOW_GRACE_MS,
  encodeNack,
  roomHash,
  ROLLBACK_TICKS,
  SEQ_AHEAD,
} from "fuse-netcode";
import {
  RULES_MISMATCH,
  type RoomRuntime,
} from "../src/online/room-runtime.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";
import { COUNTDOWN_TICKS } from "../src/engine/game.js";
import { ACTION, PRESENCE, STEER } from "../src/engine/input-log.js";
import { plainStatus } from "../src/online/status-copy.js";
import { connectHint } from "../src/online/connect-hint.js";

// Hostile members here are scripted peers: they hold the room's DTLS-bound identity like anyone else, speak the wire
// protocol, and send what a modified client would. Every assertion reads a runtime's public surface.
const settings = { ...defaultRoomSettings(), map: "classic" as const };
const HOST = "a-host",
  GUESTS = ["b-guest", "c-guest"],
  HOSTILE = "z-hostile";
const LAN: NetworkOptions = {
  loss: 0,
  baseMs: 20,
  jitterMs: 0,
  reliableMs: 30,
};

function room(options: NetworkOptions = LAN, seed = 1) {
  const net = new FakeNetwork(HOST, options, seed);
  const join = (id: string, name: string) => {
    const runtime = net.add(id, settings, { humanName: name });
    runtime.start();
    runtime.command({ type: "join", name });
    return runtime;
  };
  return { net, join };
}
/** A host, two guests and a scripted rider, all seated, with the match running. */
function matchWithHostile(options?: NetworkOptions) {
  const { net, join } = room(options);
  const host = join(HOST, "Host");
  net.step(200);
  const guests = GUESTS.map((id, index) => join(id, `Guest ${index}`));
  const hostile = new ScriptedPeer(net, HOSTILE);
  hostile.connect();
  hostile.join("Mallory");
  net.step(1500);
  assert.deepEqual(
    net.frame(HOST)!.players.map((player) => player.id),
    [HOST, ...GUESTS, HOSTILE],
  );
  assert.equal(host.command({ type: "action", action: "start" }), true);
  net.step(COUNTDOWN_TICKS * 50 + 500);
  assert.equal(net.frame(HOST)!.phase, "playing");
  return {
    net,
    host,
    honest: [host, ...guests],
    ids: [HOST, ...GUESTS],
    hostile,
  };
}
const rejected = (runtime: RoomRuntime) =>
  runtime.metrics().streams[HOSTILE]?.rejected ?? 0;
/** The replicas named (the creator first) hold one world: the authority's hashes keep being compared, none mismatches, and one recent tick looks the same everywhere. */
function assertOneWorld(
  net: FakeNetwork,
  ids: string[],
  run: () => void,
): void {
  const honest = ids.map((id) => net.runtimes.get(id)!),
    guests = honest.slice(1);
  const before = guests.map((guest) => guest.metrics().hashChecks);
  run();
  for (const [index, guest] of guests.entries())
    assert.ok(
      guest.metrics().hashChecks > before[index]!,
      `guest ${index} kept comparing the authority's hashes`,
    );
  for (const runtime of honest) assert.equal(runtime.metrics().mismatches, 0);
  const confirmed = Math.min(
    ...honest.map((runtime) => runtime.confirmedTick()),
  );
  const frames = ids.map((id) =>
    net.recorded
      .get(id)!
      .states.filter((frame) => frame.tick <= confirmed)
      .at(-1),
  );
  const tick = Math.min(...frames.map((frame) => frame?.tick ?? -1));
  assert.ok(tick > 0, "every replica published a confirmed frame");
  const at = ids.map((id) =>
    net.recorded.get(id)!.states.find((frame) => frame.tick === tick),
  );
  assert.ok(at[0], `the host still holds its frame for tick ${tick}`);
  for (const frame of at.slice(1)) assert.deepEqual(frame, at[0]);
}

test("a rider that declares itself complete two seconds ahead cannot then steer inside those ticks; a steer after them folds everywhere", () => {
  const { net, honest, ids, hostile } = matchWithHostile();
  // The lookahead cheat: claim completeness 40 ticks ahead so nobody waits or predicts, watch two seconds of play,
  // then commit a steer stamped back where everyone already holds the stream complete.
  hostile.script = (peer) => ({
    ...peer.heartbeat(),
    through: Math.floor(peer.clock()) + ROLLBACK_TICKS,
  });
  net.step(1500);
  const promised = Math.floor(hostile.clock()) + ROLLBACK_TICKS;
  const late = hostile.entry(Math.floor(hostile.clock()) + 1, STEER, 1);
  hostile.script = (peer) => ({
    through: promised,
    lastSeq: late[0],
    entries: [late],
  });
  net.step(300);
  for (const runtime of honest) {
    assert.ok(rejected(runtime) > 0, "the packet carrying it is refused");
    assert.deepEqual(runtime.heldControls(HOSTILE), {
      left: false,
      right: false,
    });
    assert.equal(runtime.metrics().streams[HOSTILE]!.gap, false);
  }
  // The same rider playing by its promise: the seq is re-issued after the promised tick and folds on every replica.
  hostile.seq--;
  const fair = hostile.entry(promised + 1, STEER, 1);
  hostile.script = (peer) => ({
    through: Math.max(promised, Math.floor(peer.clock())),
    lastSeq: fair[0],
    entries: [fair],
  });
  assertOneWorld(net, ids, () => net.step(4000));
  for (const runtime of honest) {
    assert.deepEqual(runtime.heldControls(HOSTILE), {
      left: true,
      right: false,
    });
    assert.ok(runtime.confirmedTick() > promised);
  }
  for (const runtime of honest) runtime.stop();
});

test("an inflated lastSeq opens no gap: replicas resync at the stalled-gap pace while the rider still counts as heard, then play on without it", () => {
  const { net, honest, ids, hostile } = matchWithHostile();
  const attackAt = net.now;
  hostile.script = (peer) => ({
    ...peer.heartbeat(),
    lastSeq: peer.seq + SEQ_AHEAD + 1,
  });
  // Out of reach is what an honest rider looks like to a replica that was cut off from it for minutes, so it is not
  // held against the sender at first: the rider stays seated and each replica tries the snapshot that would fix it.
  net.step(3000);
  const seated = () =>
    net.frame(HOST)!.players.find((player) => player.id === HOSTILE)
      ?.connected ?? false;
  assert.equal(seated(), true);
  for (const runtime of honest) {
    const stream = runtime.metrics().streams[HOSTILE]!;
    assert.equal(stream.gap, false);
    assert.equal(stream.lastSeq, 0);
    assert.ok(stream.rejected > 0);
  }
  assert.deepEqual(
    [hostile.nacks, hostile.undecodable],
    [0, 0],
    "there is no missing seq to nack: the resync is all a replica asks for",
  );
  // A snapshot cannot help here, and the patience is bounded: the rider is then silent like any other, and the room moves on.
  net.step(WINDOW_GRACE_MS + DISCONNECT_MS);
  const tick = honest[0]!.tick;
  assertOneWorld(net, ids, () => net.step(4000));
  assert.equal(seated(), false);
  for (const runtime of honest)
    assert.ok(runtime.tick > tick + 60, "the world runs on past the rider");
  for (const id of ids) {
    const requests = net.reliableLog
      .filter(
        (message) =>
          message.at >= attackAt &&
          message.from === id &&
          message.type === "snapshotRequest",
      )
      .map((message) => message.at);
    assert.ok(requests.length >= 1, `${id} tried a resync`);
    for (const [index, at] of requests.entries())
      if (index > 0)
        assert.ok(
          at - requests[index - 1]! >= STALLED_GAP_MS,
          `${id} asked again after ${at - requests[index - 1]!} ms`,
        );
  }
  // The asking backs off with the grace but never stops (a replica that could not send a request inside the grace
  // must still get one out): from here the attack costs each replica one snapshot request per grace period.
  const backedOffFrom = net.now;
  net.step(3 * WINDOW_GRACE_MS);
  for (const id of ids) {
    const late = net.reliableLog
      .filter(
        (message) =>
          message.at >= backedOffFrom &&
          message.from === id &&
          message.type === "snapshotRequest",
      )
      .map((message) => message.at);
    assert.ok(
      late.length >= 1 && late.length <= 3,
      `${id} sent ${late.length} requests in three grace periods`,
    );
    for (const [index, at] of late.entries())
      if (index > 0)
        assert.ok(
          at - late[index - 1]! >= WINDOW_GRACE_MS,
          `${id} asked again after ${at - late[index - 1]!} ms`,
        );
  }
  assert.equal(seated(), false);
  for (const runtime of honest) assert.equal(runtime.metrics().mismatches, 0);
  // Honest packets again: the creator hears it, and gives it a seat when it asks (a round ending in the meantime
  // dropped the absent rider's).
  hostile.script = (peer) => peer.heartbeat();
  hostile.askForSeat();
  assertOneWorld(net, ids, () => net.step(2000));
  assert.equal(seated(), true);
  for (const runtime of honest) runtime.stop();
});

/**
 * Two riders on one page and generation each. The guest stops hearing anything while the host logs more entries than the
 * seq bound, then hears it again; for `unhealthyMs` after that its link to the host delivers but does not report as
 * sendable, so no snapshot request can go out. Returns how the guest recovered.
 */
function outOfReach(unhealthyMs: number) {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const guest = join(GUESTS[0]!, "Guest");
  net.step(900);
  assert.equal(host.command({ type: "action", action: "start" }), true);
  net.step(COUNTDOWN_TICKS * 50 + 300);
  const ids = [HOST, GUESTS[0]!],
    transport = net.transports.get(GUESTS[0]!)!;
  transport.deaf = true;
  const from = host.metrics().streams[HOST]!.lastSeq;
  for (
    let step = 0;
    host.metrics().streams[HOST]!.lastSeq < from + SEQ_AHEAD + 200;
    step++
  ) {
    for (let index = 0; index < 12; index++)
      host.command({
        type: "input",
        seq: step * 12 + index,
        left: index % 2 === 0,
        right: false,
        bomb: false,
      });
    net.step(50);
  }
  assert.ok(
    host.metrics().streams[HOST]!.lastSeq >
      guest.metrics().streams[HOST]!.contiguous + SEQ_AHEAD,
    "the host is out of the guest's reach",
  );
  transport.deaf = false;
  if (unhealthyMs > 0) transport.unhealthy.add(HOST);
  const healedAt = net.now;
  let caughtUpAt: number | undefined;
  for (
    let elapsed = 0;
    elapsed < unhealthyMs + 10_000 && caughtUpAt === undefined;
    elapsed += 50
  ) {
    if (elapsed >= unhealthyMs) transport.unhealthy.delete(HOST);
    net.step(50);
    const seen = guest.metrics().streams[HOST]!;
    if (
      !seen.gap &&
      seen.lastSeq === host.metrics().streams[HOST]!.lastSeq &&
      Math.abs(guest.tick - host.tick) <= 2
    )
      caughtUpAt = net.now;
  }
  assert.ok(caughtUpAt !== undefined, "the guest caught the host's stream up");
  const requests = net.reliableLog.filter(
    (message) => message.at >= healedAt && message.type === "snapshotRequest",
  ).length;
  assertOneWorld(net, ids, () => net.step(4000));
  for (const id of ids)
    assert.deepEqual(
      net.frame(id)!.players.map((player) => [player.id, player.connected]),
      ids.map((rider) => [rider, true]),
      `${id} sees both riders present`,
    );
  assert.equal(
    net.reliableLog.filter(
      (message) =>
        message.at > caughtUpAt! && message.type === "snapshotRequest",
    ).length,
    0,
    "one resync was enough",
  );
  host.stop();
  guest.stop();
  return { requests, recoveredMs: caughtUpAt - healedAt };
}

test("a replica cut off while its peer logs more entries than the seq bound resyncs once it hears it again, and nobody is left absent", () => {
  const { requests, recoveredMs } = outOfReach(0);
  assert.ok(recoveredMs <= 2 * STALLED_GAP_MS + 1000, `${recoveredMs} ms`);
  assert.ok(requests >= 1 && requests <= 2, `${requests} requests`);
});

test("the same replica still resyncs when no link could carry a snapshot request until after the grace had run out", () => {
  // Past the grace the host counts as silent and the asking has backed off, but it has not stopped: the first tick
  // with a link fit to carry the request sends it.
  for (const unhealthyMs of [12_000, 20_000]) {
    assert.ok(unhealthyMs > WINDOW_GRACE_MS);
    const { requests, recoveredMs } = outOfReach(unhealthyMs);
    assert.ok(
      recoveredMs <= unhealthyMs + 1000,
      `${unhealthyMs} ms unhealthy: recovered after ${recoveredMs} ms`,
    );
    assert.equal(requests, 1, `${unhealthyMs} ms unhealthy`);
  }
});

test("a peer announcing different rules is refused at the handshake and at packet ingest, and each side is told who has to reload", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const guest = join(GUESTS[0]!, "Guest");
  net.step(800);
  const outdated = new ScriptedPeer(net, HOSTILE, { rules: "fuse-p2p-1" });
  outdated.connect();
  outdated.join("Old build");
  outdated.script = (peer) => ({
    through: Math.floor(peer.clock()),
    lastSeq: 1,
    entries: [[1, Math.floor(peer.clock()) + 1, STEER, 1]],
  });
  net.step(1500);
  // A hello is a claim, not proof: a client that lies about its rules is a modified client, which the trust model
  // does not defend against. What this closes is an honest stale build being folded into the room.
  for (const runtime of [host, guest]) {
    assert.deepEqual(runtime.metrics().refused, [HOSTILE]);
    assert.equal(runtime.metrics().streams[HOSTILE], undefined);
    assert.equal(runtime.metrics().heard[HOSTILE], undefined);
  }
  assert.deepEqual(
    net.frame(HOST)!.players.map((player) => player.id),
    [HOST, GUESTS[0]],
    "its join is not seated",
  );
  // These pages are current, so they are not told to reload.
  for (const id of [HOST, GUESTS[0]!])
    assert.ok(
      net.recorded.get(id)!.statuses.includes(RULES_MISMATCH.staleRider),
    );
  assert.equal(plainStatus(RULES_MISMATCH.staleRider).retry, false);
  assert.ok(
    outdated.inbox.some(
      ({ from, data }) =>
        from === HOST &&
        data.type === "error" &&
        data.error === RULES_MISMATCH.replyToStale,
    ),
    "the refused joiner, which may predate the refusal, is told why",
  );
  assert.deepEqual(plainStatus(RULES_MISMATCH.replyToStale), {
    tone: "bad",
    text: RULES_MISMATCH.replyToStale,
    retry: true,
  });
  // It may ask for the world; nobody serves a game it cannot fold.
  for (const to of [HOST, GUESTS[0]!])
    outdated.transport.send(to, { type: "snapshotRequest" });
  net.step(300);
  assert.equal(
    outdated.inbox.filter(({ data }) => data.type === "snapshot").length,
    0,
  );
  // The room is untouched: both riders start and play.
  assert.equal(host.command({ type: "action", action: "start" }), true);
  net.step(COUNTDOWN_TICKS * 50 + 3000);
  assert.equal(net.frame(GUESTS[0]!)!.phase, "playing");
  assert.ok(guest.metrics().hashChecks > 0);
  assert.equal(guest.metrics().mismatches, 0);
  host.stop();
  guest.stop();
});

test("a page refused by the whole room keeps saying which side is out of date, and stops asking the creator it refused for a seat", () => {
  for (const [rules, expected, reload] of [
    // Only the page that is behind gets the reload button; all three stay on screen verbatim.
    ["fuse-p2p-9999", RULES_MISMATCH.stale, true],
    ["fuse-p2p-1", RULES_MISMATCH.staleRoom, false],
    ["some-other-game", RULES_MISMATCH.unknown, true],
  ] as const) {
    const { net, join } = room();
    // The room's creator runs other rules; this page is the one joining.
    const creator = new ScriptedPeer(net, HOST, { rules });
    creator.connect();
    net.step(100);
    const guest = join(GUESTS[0]!, "Guest");
    net.step(12_000);
    assert.equal(
      net.recorded.get(GUESTS[0]!)!.statuses.at(-1),
      expected,
      "still on screen long after the hello's notice would have expired",
    );
    assert.deepEqual(plainStatus(expected), {
      tone: "bad",
      text: expected,
      retry: reload,
    });
    assert.equal(
      connectHint(expected, 60_000),
      expected,
      "the boot card shows it instead of its network hint",
    );
    const joins = net.reliableLog.filter(
      (message) => message.from === GUESTS[0] && message.type === "join",
    );
    assert.ok(
      joins.length <= 1,
      `${joins.length} joins sent to a refused creator`,
    );
    assert.deepEqual(guest.metrics().refused, [HOST]);
    guest.stop();
  }
});

test("with older and newer builds both refused, this page is the stale one whichever was heard first", () => {
  for (const newerFirst of [true, false]) {
    const { net, join } = room();
    const peers = [
      new ScriptedPeer(net, HOST, { rules: "fuse-p2p-1" }),
      new ScriptedPeer(net, HOSTILE, { rules: "fuse-p2p-9999" }),
    ];
    for (const peer of newerFirst ? [...peers].reverse() : peers) {
      peer.connect();
      net.step(400);
    }
    const guest = join(GUESTS[0]!, "Guest");
    net.step(8000);
    assert.deepEqual(guest.metrics().refused, [HOST, HOSTILE]);
    assert.equal(
      net.recorded.get(GUESTS[0]!)!.statuses.at(-1),
      RULES_MISMATCH.stale,
      "a build ahead of this one exists, so reloading this page is what helps",
    );
    guest.stop();
  }
});

test("a creator whose only peer is on different rules opens its own room and sends that peer nothing", () => {
  const { net, join } = room();
  // A tab that predates the refusal: it would take the creator's packets for its own room's clock and entries.
  const old = new ScriptedPeer(net, HOSTILE, { rules: "fuse-p2p-1" });
  old.connect();
  net.step(100);
  const host = join(HOST, "Host");
  net.step(1500);
  assert.deepEqual(host.metrics().refused, [HOSTILE]);
  assert.deepEqual(
    net.frame(HOST)?.players.map((player) => player.name),
    ["Host"],
  );
  old.transport.sendFast(
    HOST,
    encodeNack({
      room: roomHash(`AB42:${HOST}`),
      from: HOSTILE,
      firstMissingSeq: 1,
    }),
  );
  net.step(3000);
  assert.ok(host.tick > 40, "the creator's own room is running");
  assert.deepEqual(
    old.heardFast.get(HOST) ?? [],
    [],
    "the old room sees a silent creator and succeeds it on its own rules",
  );
  host.stop();
});

test("KNOWN GAP (#258 N7, succession is an owner decision): one packet of forged absences makes any seated rider the acting creator; the replicas still agree", () => {
  const { net, honest, ids, hostile } = matchWithHostile();
  // Last in the succession order, and everyone is plainly alive. Absence claims about riders ahead of the claimant are
  // accepted from anyone, each one moves the claimant up, and with the creator marked absent the first in line manages
  // the room: three presence entries and a lobby reset in one tick, from one packet.
  const tick = Math.floor(hostile.clock()) + 4;
  const forged = [
    hostile.entry(tick, PRESENCE, HOST, false, 1),
    hostile.entry(tick, PRESENCE, GUESTS[0], false, 1),
    hostile.entry(tick, PRESENCE, GUESTS[1], false, 1),
    hostile.entry(tick, ACTION, "lobby", "forged-match"),
  ];
  hostile.script = (peer) => ({
    ...peer.heartbeat(),
    lastSeq: peer.seq,
    entries: forged,
  });
  assertOneWorld(net, ids, () => net.step(3000));
  for (const id of ids) {
    const frame = net.frame(id)!;
    assert.equal(frame.phase, "lobby", "the forged reset applied everywhere");
    assert.deepEqual(
      frame.players.map((player) => player.id),
      [HOSTILE],
      "and a lobby reset drops riders marked absent: the honest riders lost their seats",
    );
  }
  for (const runtime of honest) assert.equal(rejected(runtime), 0);
  for (const runtime of honest) runtime.stop();
});

/** Every rider keeps steering and firing, so every stream carries entries the whole time. */
function playHard(net: FakeNetwork, ms: number, from = 0): number {
  let seq = from;
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
    for (const [index, rider] of [...net.runtimes.values()].entries()) {
      const flags = Math.floor(((net.now / 50) * 7 + index * 13) % 5);
      rider.command({
        type: "input",
        seq: ++seq,
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
  }
  return seq;
}
function assertNothingRefused(net: FakeNetwork, label: string): void {
  for (const [id, runtime] of net.runtimes) {
    const metrics = runtime.metrics();
    for (const [from, stream] of Object.entries(metrics.streams))
      assert.equal(stream.rejected, 0, `${label}: ${id} refused ${from}`);
    assert.deepEqual(metrics.refused, [], label);
    assert.equal(metrics.mismatches, 0, `${label}: ${id}`);
  }
}

test("heavy loss, duplication and reordering never trip the hardening checks, through a hidden tab, a reload and a deaf spell that forces a resync", () => {
  for (const seed of [3, 11]) {
    const { net, join } = room(
      {
        loss: 0.2,
        baseMs: 20,
        jitterMs: 150,
        reliableMs: 40,
        duplicate: 0.2,
      },
      seed,
    );
    const host = join(HOST, "Host");
    net.step(200);
    const riders = ["b-guest", "c-guest", "d-guest"];
    for (const [index, id] of riders.entries()) {
      join(id, `Rider ${index}`);
      net.step(150);
    }
    net.step(1500);
    assert.equal(host.command({ type: "action", action: "start" }), true);
    net.step(COUNTDOWN_TICKS * 50 + 300);
    let seq = playHard(net, 3000);
    // A tab in the background for three seconds: it keeps sending, simulates nothing and logs no input. This exercises
    // the runtime's hidden-state path only. FakeNetwork keeps ticking a hidden runtime every 10 ms, so real
    // background-timer throttling (about one tick a second) is NOT modelled here: that is #258 N4, with a reproducer
    // on codex/arch-hidden-policy.
    net.setHidden("d-guest", true);
    seq = playHard(net, 3000, seq);
    net.setHidden("d-guest", false);
    seq = playHard(net, 2000, seq);
    // A reload: the same member comes back on a new generation and its old stream is retired.
    net.reload("c-guest", settings, { humanName: "Rider 1" });
    net.runtimes.get("c-guest")!.command({ type: "join", name: "Rider 1" });
    seq = playHard(net, 4000, seq);
    // Three seconds of hearing nothing, past every peer's retained window: nacks cannot close that, a snapshot does.
    const requestsBefore = net.reliableLog.filter(
      (message) =>
        message.from === "b-guest" && message.type === "snapshotRequest",
    ).length;
    net.transports.get("b-guest")!.deaf = true;
    seq = playHard(net, 3000, seq);
    net.transports.get("b-guest")!.deaf = false;
    playHard(net, 5000, seq);
    net.step(3000);
    assert.ok(
      net.reliableLog.filter(
        (message) =>
          message.from === "b-guest" && message.type === "snapshotRequest",
      ).length > requestsBefore,
      `seed ${seed}: the deaf spell forced a resync`,
    );
    assert.ok(net.droppedFast > 1000 && net.duplicatedFast > 1000);
    assertNothingRefused(net, `seed ${seed}`);
    for (const id of riders)
      assert.ok(net.runtimes.get(id)!.metrics().hashChecks > 0, `seed ${seed}`);
    assert.ok(
      [...net.runtimes.values()].some(
        (runtime) => runtime.metrics().rollbacks > 0,
      ),
    );
    for (const player of net.frame(HOST)!.players)
      assert.equal(player.connected, true, `seed ${seed}: ${player.name}`);
    for (const runtime of net.runtimes.values()) runtime.stop();
  }
});

test("the checks stay quiet through a triple-pace phase with a hidden follower, on a lossy reordering link", () => {
  const { net, join } = room(
    { loss: 0.1, baseMs: 20, jitterMs: 100, reliableMs: 40, duplicate: 0.1 },
    5,
  );
  const host = join(HOST, "Host");
  net.step(200);
  join(GUESTS[0]!, "Guest");
  net.step(1200);
  for (let index = 0; index < 3; index++)
    host.command({ type: "bot", action: "add" });
  host.command({ type: "action", action: "start" });
  net.step(COUNTDOWN_TICKS * 50 + 300);
  const botsOnly = () => {
    const frame = net.frame(HOST)!;
    return (
      frame.phase === "playing" &&
      frame.players.some((player) => player.alive) &&
      frame.players.every(
        (player) => !player.alive || player.id.startsWith("bot:"),
      )
    );
  };
  // The riders hold one turn until they crash; their input keeps being logged after that, at three ticks per 50 ms.
  let seq = 0,
    tripled = 0;
  for (let step = 0; step < 1200 && tripled < 60; step++) {
    for (const rider of net.runtimes.values())
      rider.command({
        type: "input",
        seq: ++seq,
        left: botsOnly() ? step % 2 === 0 : true,
        right: false,
        bomb: false,
      });
    if (botsOnly() && tripled++ === 10) net.setHidden(GUESTS[0]!, true);
    net.step(50);
  }
  assert.ok(tripled >= 60, "the room reached and held the bots-only phase");
  net.setHidden(GUESTS[0]!, false);
  playHard(net, 4000, seq);
  net.step(2000);
  assertNothingRefused(net, "triple pace");
  for (const runtime of net.runtimes.values()) runtime.stop();
});

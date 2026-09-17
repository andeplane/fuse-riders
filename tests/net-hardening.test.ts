import test from "node:test";
import assert from "node:assert/strict";
import { FakeNetwork, type NetworkOptions } from "./fixtures/fake-room.js";
import { ScriptedPeer } from "./fixtures/scripted-peer.js";
import {
  DISCONNECT_MS,
  RULES_MISMATCH_REPLY,
  RULES_MISMATCH_STATUS,
  type RoomRuntime,
} from "../src/online/room-runtime.js";
import { ROLLBACK_TICKS, SEQ_AHEAD } from "../src/online/stream.js";
import { defaultRoomSettings } from "../src/shared/room-settings.js";
import { COUNTDOWN_TICKS } from "../src/shared/game.js";
import { ACTION, PRESENCE, STEER } from "../src/shared/input-log.js";
import { plainStatus } from "../src/online/status-copy.js";

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
  return { net, host, guests, honest: [host, ...guests], hostile };
}
const rejected = (runtime: RoomRuntime) =>
  runtime.metrics().streams[HOSTILE]?.rejected ?? 0;
/** The honest replicas hold one world: the authority's hashes keep being compared, none mismatches, and one recent tick looks the same everywhere. */
function assertOneWorld(
  net: FakeNetwork,
  honest: RoomRuntime[],
  guests: RoomRuntime[],
  run: () => void,
): void {
  const before = guests.map((guest) => guest.metrics().hashChecks);
  run();
  for (const [index, guest] of guests.entries())
    assert.ok(
      guest.metrics().hashChecks > before[index]!,
      `guest ${index} kept comparing the authority's hashes`,
    );
  for (const runtime of honest) assert.equal(runtime.metrics().mismatches, 0);
  const ids = [HOST, ...GUESTS],
    confirmed = Math.min(...honest.map((runtime) => runtime.confirmedTick()));
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
  const { net, honest, guests, hostile } = matchWithHostile();
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
  assertOneWorld(net, honest, guests, () => net.step(4000));
  for (const runtime of honest) {
    assert.deepEqual(runtime.heldControls(HOSTILE), {
      left: true,
      right: false,
    });
    assert.ok(runtime.confirmedTick() > promised);
  }
  for (const runtime of honest) runtime.stop();
});

test("an inflated lastSeq opens no gap: the rider is refused, marked absent like a silent one, and hash checks carry on", () => {
  const { net, honest, guests, hostile } = matchWithHostile();
  const attackAt = net.now;
  hostile.script = (peer) => ({
    ...peer.heartbeat(),
    lastSeq: peer.seq + SEQ_AHEAD + 1,
  });
  const tick = honest[0]!.tick;
  assertOneWorld(net, honest, guests, () => net.step(DISCONNECT_MS + 4000));
  for (const runtime of honest) {
    const stream = runtime.metrics().streams[HOSTILE]!;
    assert.equal(stream.gap, false);
    assert.equal(stream.lastSeq, 0);
    assert.ok(stream.rejected > 0);
    assert.ok(
      runtime.tick > tick + 80,
      "the world runs on past the refused rider",
    );
  }
  assert.equal(
    net.frame(HOST)!.players.find((player) => player.id === HOSTILE)!.connected,
    false,
    "refused packets are no sign of life",
  );
  assert.deepEqual(
    net.reliableLog.filter(
      (message) => message.at >= attackAt && message.type === "snapshotRequest",
    ),
    [],
    "nobody resyncs over a gap that was never opened",
  );
  // Honest packets again: the creator hears it and restores the seat.
  hostile.script = (peer) => peer.heartbeat();
  assertOneWorld(net, honest, guests, () => net.step(2000));
  assert.equal(
    net.frame(HOST)!.players.find((player) => player.id === HOSTILE)!.connected,
    true,
  );
  for (const runtime of honest) runtime.stop();
});

test("a peer announcing different rules is refused at the handshake and at packet ingest, and both sides are told to reload", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const guest = join(GUESTS[0]!, "Guest");
  net.step(800);
  const outdated = new ScriptedPeer(net, HOSTILE, { rules: "fuse-p2p-0" });
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
  for (const id of [HOST, GUESTS[0]!])
    assert.ok(net.recorded.get(id)!.statuses.includes(RULES_MISMATCH_STATUS));
  assert.deepEqual(plainStatus(RULES_MISMATCH_STATUS), {
    tone: "bad",
    text: RULES_MISMATCH_STATUS,
    retry: true,
  });
  assert.ok(
    outdated.inbox.some(
      ({ from, data }) =>
        from === HOST &&
        data.type === "error" &&
        data.error === RULES_MISMATCH_REPLY,
    ),
    "the refused joiner is told why",
  );
  assert.equal(plainStatus(RULES_MISMATCH_REPLY).retry, true);
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

test("a creator whose only peer is on different rules opens its own room instead of waiting for that peer's world", () => {
  const { net, join } = room();
  const outdated = new ScriptedPeer(net, HOSTILE, { rules: "fuse-p2p-0" });
  outdated.connect();
  net.step(100);
  const host = join(HOST, "Host");
  net.step(1500);
  assert.deepEqual(host.metrics().refused, [HOSTILE]);
  assert.deepEqual(
    net.frame(HOST)?.players.map((player) => player.name),
    ["Host"],
  );
  host.stop();
});

test("KNOWN GAP (#258 N7, succession is an owner decision): one packet of forged absences makes any seated rider the acting creator; the replicas still agree", () => {
  const { net, honest, guests, hostile } = matchWithHostile();
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
  assertOneWorld(net, honest, guests, () => net.step(3000));
  for (const id of [HOST, ...GUESTS]) {
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

test("heavy loss, duplication and reordering never trip the hardening checks: nothing is refused and one world holds", () => {
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
    const riders = ["b-guest", "c-guest", "d-guest"].map((id, index) => {
      const runtime = join(id, `Rider ${index}`);
      net.step(150);
      return runtime;
    });
    net.step(1500);
    assert.equal(host.command({ type: "action", action: "start" }), true);
    net.step(COUNTDOWN_TICKS * 50 + 300);
    let seq = 0;
    for (let elapsed = 0; elapsed < 15_000; elapsed += 50) {
      for (const [index, rider] of [host, ...riders].entries()) {
        const flags = Math.floor(((elapsed / 50) * 7 + index * 13) % 5);
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
    net.step(3000);
    assert.ok(net.droppedFast > 1000 && net.duplicatedFast > 1000);
    for (const runtime of [host, ...riders]) {
      const metrics = runtime.metrics();
      for (const [id, stream] of Object.entries(metrics.streams))
        assert.equal(stream.rejected, 0, `seed ${seed}: stream ${id}`);
      assert.deepEqual(metrics.refused, []);
      assert.equal(metrics.mismatches, 0, `seed ${seed}`);
      assert.ok(metrics.rollbacks > 0);
    }
    for (const rider of riders)
      assert.ok(rider.metrics().hashChecks > 0, `seed ${seed}`);
    for (const player of net.frame(HOST)!.players)
      assert.equal(player.connected, true, `seed ${seed}: ${player.name}`);
    for (const runtime of [host, ...riders]) runtime.stop();
  }
});

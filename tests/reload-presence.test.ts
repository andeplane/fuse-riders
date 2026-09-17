import test from "node:test";
import assert from "node:assert/strict";
import { FakeNetwork, type NetworkOptions } from "./fixtures/fake-room.js";
import { ScriptedPeer } from "./fixtures/scripted-peer.js";
import { STEER } from "../src/shared/input-log.js";
import {
  CREATOR_SILENCE_MS,
  DISCONNECT_MS,
  LINK_WAIT_MS,
} from "../src/online/room-runtime.js";
import { defaultRoomSettings } from "../src/shared/room-settings.js";
import { COUNTDOWN_TICKS, ROUND_OVER_TICKS } from "../src/shared/game.js";

// A page that has just (re)loaded has heard nobody yet. These tests pin that "not heard in this page's lifetime" is not
// "silent": a rider is logged absent only once this runtime could have heard it and did not.

const settings = { ...defaultRoomSettings(), map: "classic" as const };
const HOST = "a-host",
  GUESTS = ["b-guest", "c-guest", "d-guest", "e-guest"],
  ALL = [HOST, ...GUESTS];
/** Links to a reloaded page come back one after another, as ICE does under load: the first at once, the last 2.4 s later. */
const staggered = (page: string, other: string): number =>
  ALL.filter((id) => id !== page).indexOf(other) * 800;
function room(
  linkAfterReload: (page: string, other: string) => number = staggered,
  seed = 7,
) {
  let reloaded: string | undefined;
  const options: NetworkOptions = {
    loss: 0.02,
    baseMs: 20,
    jitterMs: 40,
    reliableMs: 30,
    linkMs: (a, b) =>
      reloaded === undefined || (a !== reloaded && b !== reloaded)
        ? 0
        : linkAfterReload(reloaded, a === reloaded ? b : a),
  };
  const net = new FakeNetwork(HOST, options, seed);
  const join = (id: string) => {
    const runtime = net.add(id, settings, { humanName: id });
    runtime.start();
    runtime.command({ type: "join", name: id });
    return runtime;
  };
  const host = join(HOST);
  net.step(200);
  for (const id of GUESTS) join(id);
  net.step(800);
  host.command({ type: "action", action: "start" });
  net.step(COUNTDOWN_TICKS * 50 + 500);
  assert.equal(net.frame(HOST)!.phase, "playing");
  assert.equal(net.frame(HOST)!.players.length, 5);
  return {
    net,
    reload: (id: string, replaced = false) => {
      reloaded = id;
      const runtime = net.reload(id, settings, { humanName: id, replaced });
      runtime.command({ type: "join", name: id });
      return runtime;
    },
  };
}
/** Step in 10 ms slices and collect every rider any replica showed as absent, or without a seat, along the way. */
function watch(net: FakeNetwork, ms: number, riders: string[]): Set<string> {
  const seen = new Set<string>();
  for (let elapsed = 0; elapsed < ms; elapsed += 10) {
    net.step(10);
    for (const id of net.runtimes.keys()) {
      const frame = net.frame(id);
      if (!frame) continue;
      for (const rider of riders) {
        const player = frame.players.find((p) => p.id === rider);
        if (!player) seen.add(`${rider} unseated on ${id}`);
        else if (!player.connected) seen.add(`${rider} absent on ${id}`);
      }
    }
  }
  return seen;
}
const seated = (net: FakeNetwork, on: string) =>
  net
    .frame(on)!
    .players.filter((player) => player.connected)
    .map((player) => player.id)
    .sort();

test("a creator reloading mid-round never logs the riders it has not heard yet as absent, and a lobby reset right after keeps their seats", () => {
  const { net, reload } = room();
  const host = reload(HOST);
  // Until the reloaded page has a world it publishes nothing; from then on nobody who stayed may be shown absent.
  const before = net.now;
  let recovered = -1;
  const seen = new Set<string>();
  // The last rider's link opens 2.4 s in; the lobby entry logged before that reaches it by resync.
  for (let elapsed = 0; elapsed < 6000; elapsed += 10) {
    for (const entry of watch(net, 10, GUESTS)) seen.add(entry);
    if (recovered < 0 && net.frame(HOST)) {
      recovered = net.now - before;
      // What the smoke does: the creator returns the room to the lobby as soon as its page is back. A lobby reset
      // drops every rider logged absent, so a false absence here costs a healthy rider its seat.
      assert.equal(host.command({ type: "action", action: "lobby" }), true);
    }
  }
  assert.ok(
    recovered > 0 && recovered < 1000,
    `the creator had a world again after ${recovered} ms, before its slower links opened`,
  );
  assert.deepEqual([...seen], []);
  for (const id of ALL) {
    assert.equal(net.frame(id)!.phase, "lobby");
    assert.deepEqual(seated(net, id), ALL, `${id} sees everyone seated`);
  }
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test("a round boundary just after the creator's reload prunes nobody who stayed connected", () => {
  const { net, reload } = room();
  // Idle riders in the classic arena end the round by themselves. The creator reloads halfway through the three
  // seconds of `roundOver`, so the boundary falls after it has a world again and before its slower links have opened.
  for (let waited = 0; net.frame(GUESTS[0]!)!.phase !== "roundOver"; waited++) {
    assert.ok(waited < 6000, "the round ended");
    net.step(10);
  }
  const round = net.frame(GUESTS[0]!)!.round;
  net.step((ROUND_OVER_TICKS * 50) / 2);
  reload(HOST);
  const seen = watch(net, 6000, GUESTS);
  assert.deepEqual([...seen], []);
  for (const id of ALL) {
    assert.ok(net.frame(id)!.round > round, `${id} is in the next round`);
    assert.deepEqual(seated(net, id), ALL, `${id} sees everyone seated`);
  }
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test("a rider whose link to the reloaded creator never comes up is still logged absent, after the link wait and no sooner", () => {
  const dead = GUESTS[3]!,
    linkedRiders = GUESTS.slice(0, 3);
  const { net, reload } = room((_, other) => (other === dead ? 1e9 : 0));
  reload(HOST);
  const early = watch(net, LINK_WAIT_MS - 200, GUESTS);
  assert.deepEqual([...early], [], "nobody is judged before the link wait");
  const late = watch(net, DISCONNECT_MS + 700, linkedRiders);
  assert.deepEqual([...late], []);
  for (const id of [HOST, ...linkedRiders])
    assert.deepEqual(
      seated(net, id),
      [HOST, ...linkedRiders],
      `${id} sees the unreachable rider absent and everyone else seated`,
    );
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test("a guest reloading mid-round is logged present once, not flapped absent while its first packets are on their way", () => {
  const { net, reload } = room(() => 0);
  const guest = GUESTS[1]!,
    others = ALL.filter((id) => id !== guest);
  reload(guest);
  // Its hello (reliable channel) reaches the creator before its packets do: they start 600 ms after the link.
  net.muted.add(guest);
  const seen = new Set<string>();
  let left = -1,
    back = -1,
    flapped = false;
  for (let elapsed = 0; elapsed < 5000; elapsed += 10) {
    if (elapsed === 1000) net.muted.delete(guest);
    for (const entry of watch(net, 10, others)) seen.add(entry);
    const connected = net
      .frame(HOST)!
      .players.find((player) => player.id === guest)!.connected;
    if (!connected && left < 0)
      left = elapsed; // The service reported the old page gone: `LEAVE`.
    else if (connected && left >= 0 && back < 0) back = elapsed;
    else if (!connected && back >= 0) flapped = true;
  }
  assert.deepEqual([...seen], []);
  assert.ok(left >= 0, "its absence during the reload was logged");
  assert.ok(
    back >= 0 && back < 1000,
    `logged present on its hello, before any packet (${back} ms)`,
  );
  assert.equal(flapped, false, "and not logged absent again before it spoke");
  for (const id of ALL)
    assert.deepEqual(seated(net, id), ALL, `${id} sees everyone seated`);
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test("a guest whose connection the service replaced (no offline event) is judged from its new link, not from its old page's last packet", () => {
  const { net, reload } = room(() => 0);
  const guest = GUESTS[1]!;
  reload(guest, true);
  // The new page is linked after 400 ms and heard 600 ms after that: a second after the old page's last packet
  // falls in between, and used to log the rider absent with its new page already linked.
  net.muted.add(guest);
  const early = watch(net, 1000, ALL);
  net.muted.delete(guest);
  const late = watch(net, 4000, ALL);
  assert.deepEqual([...early, ...late], []);
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test("a guest whose connection the service replaced and whose new page never links is logged absent a second after its old page's last packet", () => {
  const { net, reload } = room(() => 1e9);
  const guest = GUESTS[1]!,
    others = ALL.filter((id) => id !== guest);
  reload(guest, true);
  const seen = watch(net, DISCONNECT_MS + 500, others);
  assert.deepEqual([...seen], []);
  assert.deepEqual(seated(net, HOST), others, "as before: no link wait");
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test("a reloaded guest that never sends a packet is logged absent one second after its link came up", () => {
  const { net, reload } = room(() => 0);
  const guest = GUESTS[1]!,
    others = ALL.filter((id) => id !== guest);
  reload(guest);
  net.muted.add(guest);
  const seen = watch(net, 3000, others);
  assert.deepEqual([...seen], []);
  assert.deepEqual(seated(net, HOST), others);
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test("with the creator gone for good, a rider reloading under the acting creator keeps every connected rider seated", () => {
  const { net, reload } = room();
  net.runtimes.get(HOST)!.stop();
  net.runtimes.delete(HOST);
  net.step(CREATOR_SILENCE_MS + DISCONNECT_MS + 1000);
  assert.deepEqual(seated(net, GUESTS[0]!), GUESTS, "the creator is absent");
  const stayed = [GUESTS[0]!, GUESTS[1]!, GUESTS[3]!];
  reload(GUESTS[2]!);
  const seen = watch(net, 5000, stayed);
  assert.deepEqual([...seen], []);
  for (const id of GUESTS)
    assert.deepEqual(seated(net, id), GUESTS, `${id} sees every rider seated`);
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test("the acting creator reloading does not cost the riders behind it their seats", () => {
  const { net, reload } = room();
  net.runtimes.get(HOST)!.stop();
  net.runtimes.delete(HOST);
  net.step(CREATOR_SILENCE_MS + DISCONNECT_MS + 1000);
  assert.deepEqual(seated(net, GUESTS[1]!), GUESTS, "the creator is absent");
  reload(GUESTS[0]!);
  const seen = watch(net, 6000, GUESTS.slice(1));
  assert.deepEqual([...seen], []);
  for (const id of GUESTS)
    assert.deepEqual(seated(net, id), GUESTS, `${id} sees every rider seated`);
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test("a rider whose connection the service replaced, reloading under the acting creator with slow links to the riders ahead of it, marks none of them absent", () => {
  // Its world comes from the last rider; the links to the riders ahead of it in the succession order open two seconds
  // later. With the creator gone it judges them on the five-second rule, and it has heard neither of them yet.
  const { net, reload } = room((_, other) => (other === GUESTS[3] ? 0 : 2000));
  net.runtimes.get(HOST)!.stop();
  net.runtimes.delete(HOST);
  net.step(CREATOR_SILENCE_MS + DISCONNECT_MS + 1000);
  assert.deepEqual(seated(net, GUESTS[0]!), GUESTS, "the creator is absent");
  reload(GUESTS[2]!, true);
  const seen = watch(net, 6000, [GUESTS[0]!, GUESTS[1]!, GUESTS[3]!]);
  assert.deepEqual([...seen], []);
  for (const id of GUESTS)
    assert.deepEqual(seated(net, id), GUESTS, `${id} sees every rider seated`);
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test("a hidden rider keeps its seat through the creator's reload like any other", () => {
  const { net, reload } = room();
  net.setHidden(GUESTS[3]!, true);
  net.step(500);
  reload(HOST);
  assert.deepEqual([...watch(net, 5000, GUESTS)], []);
  assert.deepEqual(seated(net, HOST), ALL);
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test("the link is not a sign of life: a rider sending the reloaded creator only packets no unmodified client sends is logged absent within two seconds", () => {
  const net = new FakeNetwork(HOST, {
    loss: 0,
    baseMs: 20,
    jitterMs: 0,
    reliableMs: 30,
  });
  const join = (id: string) => {
    const runtime = net.add(id, settings, { humanName: id });
    runtime.start();
    runtime.command({ type: "join", name: id });
    return runtime;
  };
  const host = join(HOST);
  net.step(200);
  join(GUESTS[0]!);
  const hostile = new ScriptedPeer(net, "z-hostile");
  hostile.connect();
  hostile.join("Mallory");
  net.step(1500);
  host.command({ type: "action", action: "start" });
  net.step(COUNTDOWN_TICKS * 50 + 500);
  assert.deepEqual(seated(net, GUESTS[0]!), [HOST, GUESTS[0]!, "z-hostile"]);
  // An entry numbered past the `lastSeq` its own packet declares: refused as a violation, which is not hearing it (#278).
  hostile.script = (peer) => ({
    ...peer.heartbeat(),
    entries: [[peer.seq + 1000, Math.floor(peer.clock()) + 1, STEER, 1]],
  });
  const reloaded = net.reload(HOST, settings, { humanName: HOST });
  reloaded.command({ type: "join", name: HOST });
  assert.deepEqual([...watch(net, 2000, [GUESTS[0]!])], []);
  assert.ok(
    (reloaded.metrics().streams["z-hostile"]?.rejected ?? 0) > 0,
    "its packets reached the reloaded creator and were refused",
  );
  assert.deepEqual(seated(net, HOST), [HOST, GUESTS[0]!]);
  assert.deepEqual(seated(net, GUESTS[0]!), [HOST, GUESTS[0]!]);
  for (const runtime of net.runtimes.values()) runtime.stop();
});

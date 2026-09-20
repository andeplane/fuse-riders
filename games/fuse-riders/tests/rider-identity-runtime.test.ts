import test from "node:test";
import assert from "node:assert/strict";
import { FakeNetwork } from "./fixtures/fake-room.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";
import { COUNTDOWN_TICKS, RIDER_COLORS } from "../src/engine/game.js";
import { hashRoomState } from "../src/engine/apply-tick.js";
import type { RoomRuntime } from "../src/online/room-runtime.js";

/**
 * Colour and head across real runtimes: the rules in `rider-identity.test.ts` are the fold's, and these are the same
 * rules seen through the netcode — a choice that has to survive a reload, reach every peer's replica and stay agreed
 * when two devices reach for one colour over a lossy link.
 */
const settings = { ...defaultRoomSettings(), map: "classic" as const };
const HOST = "a-host",
  GUESTS = ["b-guest", "c-guest", "d-guest"];

const world = (runtime: RoomRuntime) =>
  (
    runtime as unknown as {
      world: { state: Parameters<typeof hashRoomState>[0] };
    }
  ).world;
const hashes = (net: FakeNetwork, ids: string[]) =>
  new Set(ids.map((id) => hashRoomState(world(net.runtimes.get(id)!).state)));
const colorOf = (net: FakeNetwork, viewer: string, rider: string) =>
  net.frame(viewer)!.players.find((player) => player.id === rider)?.color;

function room(loss = 0, jitterMs = 0, seed = 3) {
  const net = new FakeNetwork(
    HOST,
    { loss, baseMs: 20, jitterMs, reliableMs: 30 },
    seed,
  );
  const join = (id: string, name: string) => {
    const runtime = net.add(id, settings, { humanName: name });
    runtime.start();
    runtime.command({ type: "join", name });
    return runtime;
  };
  return { net, join };
}

test("a colour a rider chose reaches every replica, and every seat still holds a different one", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const guest = join(GUESTS[0]!, "Guest");
  net.step(900);
  assert.equal(host.command({ type: "color", colorIndex: 7 }), true);
  assert.equal(guest.command({ type: "color", colorIndex: 9 }), true);
  net.step(300);
  // Both replicas name the same colour for both riders, and the room folded one world.
  for (const viewer of [HOST, GUESTS[0]!]) {
    assert.equal(colorOf(net, viewer, HOST), RIDER_COLORS[7]);
    assert.equal(colorOf(net, viewer, GUESTS[0]!), RIDER_COLORS[9]);
  }
  assert.equal(hashes(net, [HOST, GUESTS[0]!]).size, 1);
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test("two riders reaching for one colour over a lossy link end up agreed, and only one has it", () => {
  const { net, join } = room(0.08, 90, 11);
  const host = join(HOST, "Host");
  net.step(200);
  const guests = GUESTS.map((id, index) => {
    const runtime = join(id, `Rider ${index}`);
    net.step(600);
    return runtime;
  });
  net.step(1200);
  assert.equal(net.frame(HOST)!.players.length, 4, "everyone is seated");
  // Every rider asks for the same colour at once, under loss and jitter, so the entries arrive in different orders on
  // different replicas. The fold resolves by seat, so they must all still agree afterwards.
  for (const runtime of [host, ...guests])
    assert.equal(runtime.command({ type: "color", colorIndex: 6 }), true);
  net.step(2500);
  const ids = [HOST, ...GUESTS];
  assert.equal(
    hashes(net, ids).size,
    1,
    "every replica agrees once packets settle",
  );
  const seen = net.frame(HOST)!.players;
  assert.equal(
    seen.filter((player) => player.color === RIDER_COLORS[6]).length,
    1,
    "exactly one rider wears the contested colour",
  );
  assert.equal(
    new Set(seen.map((player) => player.color)).size,
    seen.length,
    "and no two riders share any colour",
  );
  // The seat that won is the lowest one, on every replica alike.
  for (const viewer of ids)
    assert.equal(
      net
        .frame(viewer)!
        .players.find((player) => player.color === RIDER_COLORS[6])!.id,
      HOST,
    );
  assert.ok(
    [...net.runtimes.values()].every(
      (runtime) => runtime.metrics().mismatches === 0,
    ),
    "no divergence",
  );
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test("a rider that reloads mid-round keeps the colour and head it chose", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const guest = join(GUESTS[0]!, "Guest");
  net.step(900);
  assert.equal(guest.command({ type: "color", colorIndex: 8 }), true);
  assert.equal(guest.command({ type: "avatar", avatarId: "dragon" }), true);
  net.step(400);
  assert.equal(colorOf(net, HOST, GUESTS[0]!), RIDER_COLORS[8]);
  // Mid-round the seat is held rather than freed, so the reloaded page comes back into its own seat. Colour and head
  // live in the fold, not on the device, so they are recovered from a peer's snapshot with the rest of the world.
  assert.equal(host.command({ type: "action", action: "start" }), true);
  net.step(COUNTDOWN_TICKS * 50 + 600);
  assert.equal(net.frame(HOST)!.phase, "playing");
  net.reload(GUESTS[0]!, settings, { humanName: "Guest" });
  net.step(6000);
  const back = net.frame(GUESTS[0]!)!.players.find((p) => p.id === GUESTS[0]);
  assert.equal(back?.color, RIDER_COLORS[8], "its own page agrees");
  assert.equal(back?.avatarId, "dragon");
  assert.equal(colorOf(net, HOST, GUESTS[0]!), RIDER_COLORS[8], "and the host");
  assert.equal(hashes(net, [HOST, GUESTS[0]!]).size, 1);
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test("a rider that leaves the lobby frees its colour again", () => {
  const { net, join } = room();
  join(HOST, "Host");
  net.step(200);
  const guest = join(GUESTS[0]!, "Guest");
  net.step(900);
  assert.equal(guest.command({ type: "color", colorIndex: 3 }), true);
  net.step(300);
  assert.equal(colorOf(net, HOST, GUESTS[0]!), RIDER_COLORS[3]);
  // A reload in the lobby frees the seat outright (`reclaimable`), so the colour goes back into the pool rather than
  // being held for a page that may never come back, and the next joiner takes the lowest free one as always.
  net.reload(GUESTS[0]!, settings, { humanName: "Guest" });
  net.step(2500);
  assert.deepEqual(
    net.frame(HOST)!.players.map((player) => player.id),
    [HOST],
    "the seat was freed",
  );
  const next = net.add(GUESTS[1]!, settings, { humanName: "Next" });
  next.start();
  next.command({ type: "join", name: "Next" });
  net.step(1500);
  assert.equal(colorOf(net, HOST, GUESTS[1]!), RIDER_COLORS[1]);
  for (const runtime of net.runtimes.values()) runtime.stop();
});

test("a colour command is refused for an index off the palette, a fraction, or a device with no seat", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  // A watcher has no seat, so it has no colour to change.
  const watcher = net.add(GUESTS[0]!, settings, { humanName: "Watcher" });
  watcher.start();
  watcher.command({ type: "spectate", name: "Watcher" });
  net.step(900);
  assert.equal(watcher.command({ type: "color", colorIndex: 2 }), false);
  for (const colorIndex of [-1, 1.5, RIDER_COLORS.length, Number.NaN])
    assert.equal(
      host.command({ type: "color", colorIndex }),
      false,
      `refused ${colorIndex}`,
    );
  // The host keeps the colour it joined with through all of that.
  net.step(200);
  assert.equal(colorOf(net, HOST, HOST), RIDER_COLORS[0]);
  for (const runtime of net.runtimes.values()) runtime.stop();
});

import test from "node:test";
import assert from "node:assert/strict";
import { FakeNetwork, type NetworkOptions } from "./fixtures/fake-room.js";
import { CREATOR_SILENCE_MS } from "fuse-netcode";
import { type RoomRuntime } from "../src/online/room-runtime.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";
import {
  MAX_SPECTATORS,
  actingCreator,
  type RoomState,
} from "../src/engine/apply-tick.js";
import { MAX_PLAYERS } from "../src/engine/game.js";
import { ROOM_LIMITS } from "../../../service/room-limits.js";

// The classic arena: these rooms are driven by idle riders, and scenery would end their rounds before the membership
// behaviour under test had played out.
const settings = { ...defaultRoomSettings(), map: "classic" as const };
const HOST = "a-host",
  RIDERS = ["b-rider", "c-rider"],
  WATCHERS = ["p-watch", "q-watch", "r-watch", "s-watch", "t-watch", "u-watch"];

function room(
  options: NetworkOptions = {
    loss: 0,
    baseMs: 20,
    jitterMs: 0,
    reliableMs: 30,
  },
) {
  const net = new FakeNetwork(HOST, options);
  const start = (id: string, name: string) => {
    const runtime = net.add(id, settings, { humanName: name });
    runtime.start();
    return runtime;
  };
  return {
    net,
    join: (id: string, name: string) => {
      const runtime = start(id, name);
      runtime.command({ type: "join", name });
      return runtime;
    },
    /** The other way in: a named member of the room with no seat. */
    watch: (id: string, name: string) => {
      const runtime = start(id, name);
      runtime.command({ type: "spectate", name });
      return runtime;
    },
  };
}
const world = (runtime: RoomRuntime) =>
  (runtime as unknown as { world: { state: RoomState; tick: number } }).world;
const watching = (net: FakeNetwork, id: string) =>
  (net.frame(id)?.spectators ?? []).map((seat) => seat.name);

test("the room service admits every member the game can list: five riders, five watchers and a display", () => {
  assert.equal(
    ROOM_LIMITS.maxGuests + 1,
    MAX_PLAYERS + MAX_SPECTATORS + 1,
    "the creator plus its guests is the whole roster plus the TV",
  );
});

test("a watcher is a listed member on every replica, sees the match, and takes no seat", () => {
  const { net, join, watch } = room();
  const host = join(HOST, "Host");
  net.step(200);
  join(RIDERS[0]!, "Rider");
  watch(WATCHERS[0]!, "Watcher");
  net.step(1200);
  for (const id of [HOST, RIDERS[0]!, WATCHERS[0]!])
    assert.deepEqual(watching(net, id), ["Watcher"], `${id} lists the watcher`);
  assert.deepEqual(
    net.frame(WATCHERS[0]!)!.players.map((p) => p.name),
    ["Host", "Rider"],
    "the watcher holds no seat and sees both riders",
  );
  assert.equal(host.command({ type: "action", action: "start" }), true);
  net.step(2000);
  assert.equal(
    net.frame(WATCHERS[0]!)!.phase,
    net.frame(HOST)!.phase,
    "the watcher folds the same world as the riders",
  );
  assert.equal(
    net.frame(WATCHERS[0]!)!.tick,
    net.frame(HOST)!.tick,
    "and keeps up with it",
  );
  // The watcher steers nothing: an input command from it is refused before anything is logged.
  assert.equal(
    net.runtimes.get(WATCHERS[0]!)!.command({
      type: "input",
      seq: 1,
      left: true,
      right: false,
      bomb: false,
    }),
    false,
  );
});

test("a sixth watcher is refused, and the refusal reaches the page that asked", () => {
  const { net, join, watch } = room();
  join(HOST, "Host");
  net.step(200);
  join(RIDERS[0]!, "Rider");
  for (const [index, id] of WATCHERS.entries())
    watch(id, `Watcher ${index + 1}`);
  net.step(3000);
  assert.equal(
    world(net.runtimes.get(HOST)!).state.spectators.size,
    MAX_SPECTATORS,
  );
  assert.equal(watching(net, HOST).length, MAX_SPECTATORS);
  assert.equal(
    watching(net, HOST).includes("Watcher 6"),
    false,
    "the sixth is not listed",
  );
  assert.ok(
    net.recorded
      .get(WATCHERS[5]!)!
      .statuses.some((text) => text.includes("spectators watching")),
    `the refused page was told why: ${net.recorded.get(WATCHERS[5]!)!.statuses.join(" | ")}`,
  );
});

test("a watcher that reloads mid-match is listed absent and then present again, under its new generation", () => {
  const { net, join, watch } = room();
  const host = join(HOST, "Host");
  net.step(200);
  join(RIDERS[0]!, "Rider");
  watch(WATCHERS[0]!, "Watcher");
  net.step(1200);
  host.command({ type: "action", action: "start" });
  net.step(1500);
  const before = world(net.runtimes.get(HOST)!).state.spectators.get(
    WATCHERS[0]!,
  )!.generation;
  net.reload(WATCHERS[0]!, settings, { humanName: "Watcher" });
  net.step(400);
  assert.equal(
    world(net.runtimes.get(HOST)!).state.spectators.get(WATCHERS[0]!)!
      .connected,
    false,
    "a live match keeps the watcher listed while it is away",
  );
  net.runtimes
    .get(WATCHERS[0]!)!
    .command({ type: "spectate", name: "Watcher" });
  net.step(3000);
  const after = world(net.runtimes.get(HOST)!).state.spectators.get(
    WATCHERS[0]!,
  )!;
  assert.equal(after.connected, true, "and lists it present again");
  assert.ok(after.generation > before, "under the reloaded page's generation");
  assert.deepEqual(watching(net, WATCHERS[0]!), ["Watcher"]);
});

test("a watcher that goes while the room is in its lobby frees its place outright", () => {
  const { net, join, watch } = room();
  join(HOST, "Host");
  net.step(200);
  join(RIDERS[0]!, "Rider");
  watch(WATCHERS[0]!, "Watcher");
  net.step(1200);
  assert.deepEqual(watching(net, HOST), ["Watcher"]);
  net.runtimes.get(WATCHERS[0]!)!.stop();
  net.disconnect(WATCHERS[0]!);
  net.step(1000);
  assert.deepEqual(
    watching(net, HOST),
    [],
    "the lobby list is who is in the room right now",
  );
});

test("a creator can run the room from the watching list, and hands the crown on only when it goes", () => {
  const { net, join, watch } = room();
  const host = watch(HOST, "Host");
  net.step(200);
  join(RIDERS[0]!, "One");
  join(RIDERS[1]!, "Two");
  net.step(1500);
  assert.deepEqual(watching(net, RIDERS[0]!), ["Host"]);
  assert.equal(
    actingCreator(world(host).state, HOST),
    undefined,
    "a creator watching the room is present: no second manager stands beside it",
  );
  assert.equal(host.command({ type: "action", action: "start" }), true);
  net.step(1500);
  assert.equal(net.frame(RIDERS[1]!)!.phase, "countdown");
  assert.equal(
    net.frame(RIDERS[1]!)!.players.length,
    2,
    "the watching creator is not a rider in the match it started",
  );
  net.runtimes.get(HOST)!.stop();
  net.disconnect(HOST);
  net.step(CREATOR_SILENCE_MS + 2000);
  assert.equal(
    actingCreator(world(net.runtimes.get(RIDERS[0]!)!).state, HOST),
    RIDERS[0],
    "the crown passes to the lowest connected rider once the watching creator is gone",
  );
});

test("nothing waits on a watcher's stream: a silent watcher never stalls the riders", () => {
  const { net, join, watch } = room();
  const host = join(HOST, "Host");
  net.step(200);
  join(RIDERS[0]!, "Rider");
  watch(WATCHERS[0]!, "Watcher");
  net.step(1200);
  host.command({ type: "action", action: "start" });
  net.step(1000);
  const before = net.frame(HOST)!.tick;
  net.muted.add(WATCHERS[0]!);
  net.step(4000);
  assert.ok(
    net.frame(HOST)!.tick - before > 60,
    `the room played on without the watcher's packets (${before} → ${net.frame(HOST)!.tick})`,
  );
  assert.equal(
    net.frame(HOST)!.tick,
    net.frame(RIDERS[0]!)!.tick,
    "and both riders are still in step",
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeNetwork, type NetworkOptions } from "./fixtures/fake-room.js";
import { CREATOR_SILENCE_MS } from "fuse-netcode";
import { type RoomRuntime } from "../src/online/room-runtime.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";
import {
  MAX_SPECTATORS,
  RULES,
  actingCreator,
  roomManager,
  type RoomState,
} from "../src/engine/apply-tick.js";
import { MAX_PLAYERS } from "../src/engine/game.js";
import {
  JOIN,
  LEAVE,
  SPECTATOR,
  isEntry,
  isManagementKind,
  type Entry,
} from "../src/engine/input-log.js";

/**
 * Changing sides in the lobby: a watcher takes a seat and a rider starts watching, both keeping their place in the
 * room (plan §10 O4). The manager writes an ordered pair of entries that already exist — `SPECTATOR leave` then
 * `JOIN`, or `LEAVE` then `SPECTATOR join` — at one tick, so the fold is untouched and `RULES` does not move.
 */

// The classic arena: these rooms are driven by idle riders, and scenery would end their rounds before the membership
// behaviour under test had played out.
const settings = { ...defaultRoomSettings(), map: "classic" as const };
const HOST = "a-host",
  RIDERS = ["b-rider", "c-rider", "d-rider", "e-rider", "f-rider"],
  WATCHERS = ["p-watch", "q-watch", "r-watch", "s-watch", "t-watch"];

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
    watch: (id: string, name: string) => {
      const runtime = start(id, name);
      runtime.command({ type: "spectate", name });
      return runtime;
    },
  };
}
const world = (runtime: RoomRuntime) =>
  (
    runtime as unknown as {
      world: {
        state: RoomState;
        tick: number;
        streams: Map<string, { entries: Map<number, Entry> }>;
      };
    }
  ).world;
const watching = (net: FakeNetwork, id: string) =>
  (net.frame(id)?.spectators ?? []).map((seat) => seat.name);
const riders = (net: FakeNetwork, id: string) =>
  (net.frame(id)?.players ?? []).map((p) => p.name);
/** Everyone in the room, on every replica: a switch must leave the same room behind on all of them. */
const everywhere = (net: FakeNetwork, ids: readonly string[]) =>
  ids.map((id) => ({
    id,
    riders: riders(net, id),
    watching: watching(net, id),
  }));
const statuses = (net: FakeNetwork, id: string) =>
  net.recorded.get(id)!.statuses.join(" | ");

test("a watcher takes a seat and every replica seats it, with nobody leaving the room", () => {
  const { net, join, watch } = room();
  join(HOST, "Host");
  net.step(200);
  join(RIDERS[0]!, "Rider");
  const watcher = watch(WATCHERS[0]!, "Watcher");
  net.step(1200);
  assert.deepEqual(watching(net, HOST), ["Watcher"], "watching to begin with");
  const generation = world(watcher).state.spectators.get(
    WATCHERS[0]!,
  )!.generation;

  watcher.command({ type: "join", name: "Watcher" });
  net.step(1200);

  assert.deepEqual(
    everywhere(net, [HOST, RIDERS[0]!, WATCHERS[0]!]),
    [HOST, RIDERS[0]!, WATCHERS[0]!].map((id) => ({
      id,
      riders: ["Host", "Rider", "Watcher"],
      watching: [],
    })),
    "the seat and the empty watching list are the same on every replica",
  );
  const fold = world(net.runtimes.get(HOST)!).state.folds.get(WATCHERS[0]!)!;
  assert.equal(
    fold.generation,
    generation,
    "the same page kept its place: no reload, no new generation",
  );
  assert.equal(
    net.recorded.get(WATCHERS[0]!)!.kicked,
    0,
    "and it was never told it had been removed",
  );
});

test("a rider starts watching, its seat is freed, and the next rider takes it", () => {
  const { net, join } = room();
  join(HOST, "Host");
  net.step(200);
  const rider = join(RIDERS[0]!, "Rider");
  net.step(1200);
  assert.deepEqual(riders(net, HOST), ["Host", "Rider"]);
  const slot = world(rider).state.game.players.get(RIDERS[0]!)!.slot;

  rider.command({ type: "spectate", name: "Rider" });
  net.step(1200);

  assert.deepEqual(
    everywhere(net, [HOST, RIDERS[0]!]),
    [HOST, RIDERS[0]!].map((id) => ({
      id,
      riders: ["Host"],
      watching: ["Rider"],
    })),
    "the seat is gone and the watching list has it, on both replicas",
  );
  assert.equal(
    world(net.runtimes.get(HOST)!).state.folds.has(RIDERS[0]!),
    false,
    "the freed seat left no fold behind",
  );

  join(RIDERS[1]!, "Two");
  net.step(1500);
  assert.equal(
    world(net.runtimes.get(HOST)!).state.game.players.get(RIDERS[1]!)!.slot,
    slot,
    "and the freed seat is the one the next rider takes",
  );
});

test("the pair is two entries that already existed, written at one tick", () => {
  const { net, join, watch } = room();
  const host = join(HOST, "Host");
  net.step(200);
  join(RIDERS[0]!, "Rider");
  const watcher = watch(WATCHERS[0]!, "Watcher");
  net.step(1200);
  watcher.command({ type: "join", name: "Watcher" });
  net.step(1200);
  net.runtimes.get(RIDERS[0]!)!.command({ type: "spectate", name: "Rider" });
  net.step(1200);

  const logged = [...world(host).streams.get(HOST)!.entries.values()];
  for (const entry of logged)
    assert.ok(
      isEntry(entry),
      `the manager logged a valid wire entry: ${entry}`,
    );
  // No new kind: a switch is spelled with JOIN, LEAVE and SPECTATOR, which the fold has folded since #351.
  const kinds = new Set(
    logged.filter((entry) => isManagementKind(entry[2])).map((e) => e[2]),
  );
  assert.deepEqual(
    [...kinds].filter((kind) => kind > SPECTATOR),
    [],
    "no management kind beyond the ones the fold already knows",
  );
  const at = (kind: number, subject: string) =>
    logged.find(
      (entry) =>
        entry[2] === kind &&
        (kind === SPECTATOR ? entry[4] : entry[3]) === subject,
    );
  const takeLeave = at(SPECTATOR, WATCHERS[0]!),
    takeJoin = at(JOIN, WATCHERS[0]!);
  assert.ok(takeLeave && takeJoin, "the watcher's pair was logged");
  assert.equal(
    takeLeave![1],
    takeJoin![1],
    "SPECTATOR leave and JOIN share one tick",
  );
  assert.ok(
    takeLeave![0] < takeJoin![0],
    "and the leave is logged first, since JOIN returns early while the id is still watching",
  );
  const watchLeave = at(LEAVE, RIDERS[0]!),
    watchJoin = logged.find(
      (entry) => entry[2] === SPECTATOR && entry[4] === RIDERS[0]!,
    );
  assert.ok(watchLeave && watchJoin, "the rider's pair was logged");
  assert.equal(watchLeave![1], watchJoin![1], "LEAVE and SPECTATOR join too");
  assert.ok(watchLeave![0] < watchJoin![0], "seat first, watching list second");
});

test("the golden is the one this branch found: the fold did not move", () => {
  const golden: { rules: string; hashes: string[] } = JSON.parse(
    readFileSync(
      new URL("./fixtures/golden-hashes.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    RULES,
    golden.rules,
    "switching sides adds no entry kind and changes no fold, so RULES stays where it is and the golden is not re-recorded",
  );
});

test("a switch mid-round is refused on both sides, and says when to try again", () => {
  const { net, join, watch } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const rider = join(RIDERS[0]!, "Rider");
  const watcher = watch(WATCHERS[0]!, "Watcher");
  net.step(1200);
  host.command({ type: "action", action: "start" });
  // Past the countdown: both of its phases are a running round, and this is the one riders are steering in.
  net.step(5000);
  assert.equal(net.frame(HOST)!.phase, "playing", "a round is running");

  assert.equal(
    watcher.command({ type: "join", name: "Watcher" }),
    false,
    "the page refuses its own switch before it asks anyone",
  );
  assert.equal(rider.command({ type: "spectate", name: "Rider" }), false);
  net.step(1500);

  assert.deepEqual(
    everywhere(net, [HOST, RIDERS[0]!, WATCHERS[0]!]),
    [HOST, RIDERS[0]!, WATCHERS[0]!].map((id) => ({
      id,
      riders: ["Host", "Rider"],
      watching: ["Watcher"],
    })),
    "nobody moved: the round is still the one that started",
  );
  assert.match(
    statuses(net, WATCHERS[0]!),
    /Take a seat between rounds/,
    `the watcher was told when it can: ${statuses(net, WATCHERS[0]!)}`,
  );
  assert.match(
    statuses(net, RIDERS[0]!),
    /Start watching between rounds/,
    `and so was the rider: ${statuses(net, RIDERS[0]!)}`,
  );
});

test("a watcher is refused a seat while the room has five riders, and keeps its place", () => {
  const { net, join, watch } = room();
  join(HOST, "Host");
  net.step(200);
  for (const [index, id] of RIDERS.slice(0, MAX_PLAYERS - 1).entries())
    join(id, `Rider ${index + 1}`);
  const watcher = watch(WATCHERS[0]!, "Watcher");
  net.step(2500);
  assert.equal(riders(net, HOST).length, MAX_PLAYERS, "every seat is taken");

  watcher.command({ type: "join", name: "Watcher" });
  net.step(1500);

  assert.equal(riders(net, HOST).length, MAX_PLAYERS, "still five riders");
  assert.deepEqual(
    watching(net, WATCHERS[0]!),
    ["Watcher"],
    "a refused switch leaves the watcher on the list it was on",
  );
  assert.match(
    statuses(net, WATCHERS[0]!),
    /Room is full/,
    `and says why: ${statuses(net, WATCHERS[0]!)}`,
  );
});

test("a rider is refused the watching list while five are watching, and keeps its seat", () => {
  const { net, join, watch } = room();
  join(HOST, "Host");
  net.step(200);
  const rider = join(RIDERS[0]!, "Rider");
  for (const [index, id] of WATCHERS.entries())
    watch(id, `Watcher ${index + 1}`);
  net.step(3000);
  assert.equal(
    watching(net, HOST).length,
    MAX_SPECTATORS,
    "the watching list is full",
  );

  rider.command({ type: "spectate", name: "Rider" });
  net.step(1500);

  assert.deepEqual(
    riders(net, HOST),
    ["Host", "Rider"],
    "a refused switch leaves the rider in its seat",
  );
  assert.equal(watching(net, HOST).length, MAX_SPECTATORS);
  assert.match(
    statuses(net, RIDERS[0]!),
    /spectators watching/,
    `and says why: ${statuses(net, RIDERS[0]!)}`,
  );
});

test("a page that reloads after switching comes back on the side it switched to", () => {
  const { net, join } = room();
  join(HOST, "Host");
  net.step(200);
  const rider = join(RIDERS[0]!, "Rider");
  net.step(1200);
  rider.command({ type: "spectate", name: "Rider" });
  net.step(1200);
  assert.deepEqual(watching(net, HOST), ["Rider"]);
  const before = world(net.runtimes.get(HOST)!).state.spectators.get(
    RIDERS[0]!,
  )!.generation;

  net.reload(RIDERS[0]!, settings, { humanName: "Rider" });
  net.step(400);
  net.runtimes.get(RIDERS[0]!)!.command({ type: "spectate", name: "Rider" });
  net.step(2000);

  const after = world(net.runtimes.get(HOST)!).state.spectators.get(
    RIDERS[0]!,
  )!;
  assert.equal(after.connected, true, "the reloaded page is watching again");
  assert.ok(after.generation > before, "under its new generation");
  assert.deepEqual(
    riders(net, HOST),
    ["Host"],
    "and the seat it gave up did not come back with it",
  );
});

test("the creator switches sides and keeps the room", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  join(RIDERS[0]!, "One");
  join(RIDERS[1]!, "Two");
  net.step(1500);
  assert.equal(roomManager(world(host).state, HOST), HOST);

  host.command({ type: "spectate", name: "Host" });
  net.step(1500);

  assert.deepEqual(watching(net, RIDERS[0]!), ["Host"], "the creator watches");
  assert.deepEqual(riders(net, RIDERS[0]!), ["One", "Two"]);
  for (const id of [HOST, RIDERS[0]!, RIDERS[1]!]) {
    const state = world(net.runtimes.get(id)!).state;
    assert.equal(
      roomManager(state, HOST),
      HOST,
      `${id} still names the creator as host`,
    );
    assert.equal(
      actingCreator(state, HOST),
      undefined,
      `${id} stands nobody in beside it`,
    );
  }
  assert.equal(
    host.command({ type: "action", action: "start" }),
    true,
    "and it can still start the race it is watching",
  );

  // And back again: the creator takes a seat in the room it never left.
  net.step(1500);
  host.command({ type: "action", action: "lobby" });
  net.step(1500);
  host.command({ type: "join", name: "Host" });
  net.step(1500);
  // Seat 0 was the creator's and nobody else took it, so it is the seat it comes back to.
  assert.deepEqual(riders(net, RIDERS[0]!), ["Host", "One", "Two"]);
  assert.deepEqual(watching(net, RIDERS[0]!), []);
  assert.equal(roomManager(world(host).state, HOST), HOST, "still the host");
});

test("a stand-in host may not switch its own side, and is told why", () => {
  const { net, join } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const one = join(RIDERS[0]!, "One");
  join(RIDERS[1]!, "Two");
  net.step(1500);

  host.stop();
  net.disconnect(HOST);
  net.step(CREATOR_SILENCE_MS + 2000);
  assert.equal(
    actingCreator(world(one).state, HOST),
    RIDERS[0],
    "the first rider is standing in",
  );

  one.command({ type: "spectate", name: "One" });
  net.step(2000);

  // Without the refusal the pair would be written from the stand-in's own stream, `permitted` would rank it nowhere
  // between the two entries, the `SPECTATOR join` would be dropped on every replica and the member would be gone.
  for (const id of [RIDERS[0]!, RIDERS[1]!]) {
    assert.ok(
      riders(net, id).includes("One"),
      `${id} still seats the stand-in host`,
    );
    assert.deepEqual(watching(net, id), [], `${id} lists nobody watching`);
  }
  assert.match(
    statuses(net, RIDERS[0]!),
    /standing in as host/,
    `and it was told why: ${statuses(net, RIDERS[0]!)}`,
  );
});

test("two members swap sides in the same room and both land", () => {
  const { net, join, watch } = room();
  const host = join(HOST, "Host");
  net.step(200);
  for (const [index, id] of RIDERS.slice(0, MAX_PLAYERS - 1).entries())
    join(id, `Rider ${index + 1}`);
  const watcher = watch(WATCHERS[0]!, "Watcher");
  net.step(2500);
  assert.equal(riders(net, HOST).length, MAX_PLAYERS, "every seat is taken");

  // The seat one gives up is the seat the other takes: the manager frees it and claims it in the same fold.
  net.runtimes.get(RIDERS[3]!)!.command({ type: "spectate", name: "Rider 4" });
  watcher.command({ type: "join", name: "Watcher" });
  net.step(2500);

  for (const id of [HOST, RIDERS[0]!, WATCHERS[0]!]) {
    assert.equal(
      riders(net, id).includes("Watcher"),
      true,
      `${id} seats the watcher that sat down`,
    );
    assert.equal(
      riders(net, id).includes("Rider 4"),
      false,
      `${id} freed the seat of the rider that stood up`,
    );
    assert.deepEqual(watching(net, id), ["Rider 4"], `${id} lists the swap`);
    assert.equal(riders(net, id).length, MAX_PLAYERS, `${id} is still full`);
  }
  assert.equal(
    world(host).state.game.players.size,
    MAX_PLAYERS,
    "and no seat was doubled up",
  );
});

test("a link that drops, duplicates and reorders packets still folds the pair the same everywhere", () => {
  // A quarter of the packets lost, a tenth of the rest delivered twice, and jitter wide enough to reorder them: the
  // pair travels as the two log entries it is, so what repairs it is the repair every entry already has.
  const { net, join, watch } = room({
    loss: 0.25,
    baseMs: 30,
    jitterMs: 80,
    reliableMs: 60,
    duplicate: 0.1,
  });
  join(HOST, "Host");
  net.step(600);
  const rider = join(RIDERS[0]!, "Rider");
  watch(WATCHERS[0]!, "Watcher");
  net.step(4000);
  assert.deepEqual(riders(net, HOST), ["Host", "Rider"], "the room settled");

  net.runtimes.get(WATCHERS[0]!)!.command({ type: "join", name: "Watcher" });
  rider.command({ type: "spectate", name: "Rider" });
  net.step(8000);

  const seen = everywhere(net, [HOST, RIDERS[0]!, WATCHERS[0]!]);
  assert.deepEqual(
    seen,
    [HOST, RIDERS[0]!, WATCHERS[0]!].map((id) => ({
      id,
      riders: ["Host", "Watcher"],
      watching: ["Rider"],
    })),
    `every replica folded the same swap: ${JSON.stringify(seen)}`,
  );
  // The fold is what the log says it is, hash included: a duplicated or reordered half cannot have been applied twice.
  const hashes = new Set(
    [HOST, RIDERS[0]!, WATCHERS[0]!].map((id) =>
      JSON.stringify([
        world(net.runtimes.get(id)!).state.game.players.size,
        world(net.runtimes.get(id)!).state.spectators.size,
        world(net.runtimes.get(id)!).state.folds.size,
      ]),
    ),
  );
  assert.equal(hashes.size, 1, `one shape on every replica: ${[...hashes]}`);
});

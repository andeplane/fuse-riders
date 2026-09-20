import test from "node:test";
import assert from "node:assert/strict";
import { FakeNetwork, type NetworkOptions } from "./fixtures/fake-room.js";
import { CREATOR_SILENCE_MS } from "fuse-netcode";
import { type RoomRuntime } from "../src/online/room-runtime.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";
import {
  MAX_SPECTATORS,
  actingCreator,
  applyTick,
  createRoomState,
  hashRoomState,
  roomManager,
  type RoomState,
} from "../src/engine/apply-tick.js";
import { BotController } from "../src/engine/bot-controller.js";
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
  // `SPECTATOR` carries the member id in the same slot whichever way it goes, so the action is matched, not the id:
  // the watcher's own arrival is a `SPECTATOR join` about the same member.
  const about = (subject: string) =>
    logged
      .filter(
        (entry) =>
          isManagementKind(entry[2]) &&
          (entry[2] === SPECTATOR ? entry[4] : entry[3]) === subject,
      )
      .map((entry) => [entry[0], entry[1], entry[2], entry[3]] as const);

  // The tail, because the stream prunes what the fold has finished with: what a switch wrote is the last thing said
  // about that member, and it is two entries.
  const pair = (subject: string) => about(subject).slice(-2);
  const take = pair(WATCHERS[0]!);
  assert.deepEqual(
    take.map((e) => [e[2], e[3]]),
    [
      [SPECTATOR, "leave"],
      [JOIN, WATCHERS[0]],
    ],
    "taking a seat is a SPECTATOR leave and a JOIN, in that order: JOIN returns early while the id is still listed",
  );
  assert.equal(take[0]![1], take[1]![1], "the pair shares one tick");
  assert.ok(take[0]![0] < take[1]![0], "and one seq follows the other");

  const startWatching = pair(RIDERS[0]!);
  assert.deepEqual(
    startWatching.map((e) => [e[2], e[3]]),
    [
      [LEAVE, RIDERS[0]],
      [SPECTATOR, "join"],
    ],
    "and starting to watch is a LEAVE and a SPECTATOR join: the seat goes first, since SPECTATOR join refuses a seated id",
  );
  assert.equal(
    startWatching[0]![1],
    startWatching[1]![1],
    "that pair shares one tick too",
  );
  assert.ok(startWatching[0]![0] < startWatching[1]![0]);
  // And nothing outside the three kinds the fold already had was written about either of them.
  for (const subject of [WATCHERS[0]!, RIDERS[0]!])
    for (const entry of about(subject))
      assert.ok(
        [JOIN, LEAVE, SPECTATOR].includes(entry[2]),
        `a switch is spelled with entries that already existed, not kind ${entry[2]}`,
      );
});

test("a switch folds to exactly what leaving and rejoining folds to", () => {
  // The claim behind the whole change: the pair is not a new rule, it is the two entries the fold already had. Written
  // at one tick and written a tick apart, they must leave the same room behind — hash, seat, fold and all.
  const fold = (together: boolean) => {
    const state = createRoomState("switch", settings),
      bots = new BotController();
    const ticks: Entry[][] = together
      ? [
          [
            [1, 1, JOIN, "a-host", "Host", 0, "fox", 0],
            [2, 1, SPECTATOR, "join", "p-watch", "Watcher", 0],
          ],
          [
            [3, 2, SPECTATOR, "leave", "p-watch"],
            [4, 2, JOIN, "p-watch", "Watcher", 1, "fox", 0],
          ],
          [],
        ]
      : [
          [
            [1, 1, JOIN, "a-host", "Host", 0, "fox", 0],
            [2, 1, SPECTATOR, "join", "p-watch", "Watcher", 0],
          ],
          [[3, 2, SPECTATOR, "leave", "p-watch"]],
          [[4, 3, JOIN, "p-watch", "Watcher", 1, "fox", 0]],
        ];
    for (const entries of ticks)
      applyTick(
        state,
        "a-host",
        new Map([["a-host", { generation: 0, entries }]]),
        bots,
      );
    return { hash: hashRoomState(state), state };
  };
  const together = fold(true),
    apart = fold(false);
  assert.deepEqual(
    [...together.state.game.players.keys()],
    ["a-host", "p-watch"],
    "the watcher ended up in a seat",
  );
  assert.equal(together.state.spectators.size, 0);
  assert.equal(
    together.hash,
    apart.hash,
    "one tick or two, the fold is the same: a switch is leave-then-join and nothing else",
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

test("between the rounds of a live match, both directions go through", () => {
  const { net, join, watch } = room();
  const host = join(HOST, "Host");
  net.step(200);
  const rider = join(RIDERS[0]!, "Rider");
  const watcher = watch(WATCHERS[0]!, "Watcher");
  net.step(1200);
  host.command({ type: "action", action: "start" });
  // Up to the first pause and no further: `roundOver` is the phase the feature is named for, and a match of idle
  // riders runs through all of its rounds if it is simply left to.
  for (let waited = 0; waited < 120_000; waited += 250) {
    net.step(250);
    if (net.frame(HOST)!.phase === "roundOver") break;
  }
  assert.equal(
    net.frame(HOST)!.phase,
    "roundOver",
    `the match reached a pause between rounds (phase ${net.frame(HOST)!.phase})`,
  );
  const round = net.frame(HOST)!.round;

  assert.equal(watcher.command({ type: "join", name: "Watcher" }), true);
  assert.equal(rider.command({ type: "spectate", name: "Rider" }), true);
  net.step(2000);

  for (const id of [HOST, RIDERS[0]!, WATCHERS[0]!]) {
    assert.ok(
      riders(net, id).includes("Watcher"),
      `${id} seated the watcher at the pause`,
    );
    assert.equal(
      riders(net, id).includes("Rider"),
      false,
      `${id} freed the rider's seat at the pause`,
    );
    assert.deepEqual(watching(net, id), ["Rider"], `${id} agrees who watches`);
  }
  assert.equal(
    net.frame(HOST)!.round,
    round,
    "and the match is the same one, still between the same two rounds",
  );
});

test("a watcher takes the seat of a rider the room lists absent", () => {
  const { net, join, watch } = room();
  join(HOST, "Host");
  net.step(200);
  for (const [index, id] of RIDERS.slice(0, MAX_PLAYERS - 1).entries())
    join(id, `Rider ${index + 1}`);
  const watcher = watch(WATCHERS[0]!, "Watcher");
  net.step(2500);
  assert.equal(riders(net, HOST).length, MAX_PLAYERS, "every seat is taken");

  // One rider's page goes. Its seat is reclaimable in the lobby, exactly as it is for a fresh joiner.
  net.runtimes.get(RIDERS[3]!)!.stop();
  net.disconnect(RIDERS[3]!);
  net.step(2000);

  watcher.command({ type: "join", name: "Watcher" });
  net.step(2000);
  for (const id of [HOST, RIDERS[0]!, WATCHERS[0]!]) {
    assert.ok(
      riders(net, id).includes("Watcher"),
      `${id} gave the watcher the seat that was standing empty`,
    );
    assert.deepEqual(watching(net, id), [], `${id} empties the watching list`);
    assert.equal(riders(net, id).length, MAX_PLAYERS, `${id} is full again`);
  }
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

test("a shared screen's first rider changes sides, though the crown never leaves it", () => {
  // A creator driving a TV from a page that took no seat has no record in the fold, so `actingCreator` names the first
  // rider for as long as the room lasts. That rider cannot write its own pair — and does not have to: the creator's
  // page can, whatever the succession order says, so the request goes there instead (`switchWriter`).
  const net = new FakeNetwork(HOST, {
    loss: 0,
    baseMs: 20,
    jitterMs: 0,
    reliableMs: 30,
  });
  const tv = net.add(HOST, settings, { displayOnly: true });
  tv.start();
  net.step(300);
  for (const [index, id] of RIDERS.slice(0, 2).entries()) {
    const runtime = net.add(id, settings, { humanName: `Rider ${index + 1}` });
    runtime.start();
    runtime.command({ type: "join", name: `Rider ${index + 1}` });
  }
  net.step(2500);
  assert.equal(
    actingCreator(world(net.runtimes.get(RIDERS[0]!)!).state, HOST),
    RIDERS[0],
    "the first rider runs the room beside the unseated creator",
  );

  assert.equal(
    net.runtimes
      .get(RIDERS[0]!)!
      .command({ type: "spectate", name: "Rider 1" }),
    true,
    "and its own page does not refuse the switch",
  );
  net.step(2500);

  for (const id of [HOST, RIDERS[0]!, RIDERS[1]!]) {
    assert.deepEqual(
      watching(net, id),
      ["Rider 1"],
      `${id} lists the switched rider as watching`,
    );
    assert.deepEqual(riders(net, id), ["Rider 2"], `${id} freed its seat`);
  }
  assert.equal(
    actingCreator(world(net.runtimes.get(RIDERS[1]!)!).state, HOST),
    RIDERS[1],
    "the crown moves to the rider still seated, as it always did",
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
  assert.ok(
    net.droppedFast > 0 && net.duplicatedFast > 0 && net.reorderedFast > 0,
    `the link really was impaired: dropped ${net.droppedFast}, duplicated ${net.duplicatedFast}, reordered ${net.reorderedFast}`,
  );
  // Each replica's own confirmed full-state hash, which is the whole room and not a summary of it: a half applied
  // twice, or one half folded without the other, would show up here as a disagreement.
  const ids = [HOST, RIDERS[0]!, WATCHERS[0]!];
  const common = [...(net.reportedHashes.get(HOST)?.keys() ?? [])].filter(
    (tick) => ids.every((id) => net.reportedHashes.get(id)?.has(tick)),
  );
  assert.ok(common.length >= 3, `shared confirmed ticks: ${common.length}`);
  for (const tick of common)
    assert.equal(
      new Set(ids.map((id) => net.reportedHashes.get(id)!.get(tick))).size,
      1,
      `replicas disagree at ${tick}`,
    );
});

/**
 * Three phones racing over one mesh, driven through `RoomRuntime` itself: the seating handshake, the packets, the
 * nacks that repair a gap and the snapshots that carry a whole race are the netcode under test, not a `World` fed
 * hand-built entries. Every clock is the mesh's, so each test is one deterministic sequence of `run(ms)` calls.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  LEFT,
  fuseDriversGame,
  fuseDriversView,
  trackFor,
  type FuseDriversRoom,
} from "../src/game/index.js";
import {
  botInput,
  createBotMemory,
  type BotMemory,
} from "../src/game/sim/bot.js";
import type { Truck } from "../src/game/sim/truck.js";
import { defined } from "./fixtures/defined.js";
import { SETTINGS } from "./fixtures/fuseDrivers.js";
import {
  FuseDriversMesh,
  type TestFuseDriversRuntime,
} from "./fixtures/mesh.js";

/** A seeded generator, so a lossy mesh is the same mesh on every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

const NAMES: Record<string, string> = { a: "Ada", b: "Bo", c: "Cy", d: "Dee" };
/** The countdown is 90 simulation steps, which is three seconds of mesh clock and 60 log ticks. */
const COUNTDOWN_MS = 3200;
/** How often a driver looks at its screen and moves its thumbs: every log tick, as a phone does. */
const HAND_MS = 50;
/** The creator stamps a hash every `HASH_INTERVAL` ticks, so a race this long is checked many times over. */
const MIN_HASH_CHECKS = 5;

interface Table {
  readonly mesh: FuseDriversMesh;
  /** Everyone still on the mesh, in the order they arrived. */
  readonly peers: TestFuseDriversRuntime[];
  join: (id: string) => TestFuseDriversRuntime;
  /** Runs the mesh with every driver's hands on the wheel, and reports the control changes logged. */
  drive: (ms: number) => number;
  room: (id: string) => FuseDriversRoom;
}

/**
 * One mesh, and the phones that have joined it so far.
 *
 * Its drivers steer with the bot's own brain, each reading its own replica the way a player reads their own screen:
 * that is a hundred real control changes over a race, logged at the moments the race itself makes them.
 */
function table(): Table {
  const mesh = new FuseDriversMesh("a", SETTINGS);
  const runtimes = new Map<string, TestFuseDriversRuntime>();
  const memories = new Map<string, BotMemory>();
  const join = (id: string): TestFuseDriversRuntime => {
    const runtime = mesh.join(id);
    assert.equal(
      runtime.command({ type: "join", name: defined(NAMES[id], "name") }),
      true,
      `${id} asked for a seat`,
    );
    runtimes.set(id, runtime);
    return runtime;
  };
  const room = (id: string): FuseDriversRoom =>
    defined(
      defined(runtimes.get(id), `runtime ${id}`).roomState(),
      `room ${id}`,
    );
  const hands = (): number => {
    let changes = 0;
    for (const [id, runtime] of runtimes) {
      const state = runtime.roomState();
      const race = state?.race;
      if (!race || state.stage !== "running") continue;
      const slot = state.grid.indexOf(id);
      if (slot < 0) continue;
      const memory = memories.get(id) ?? createBotMemory(0x5eed, slot);
      const [input, next] = botInput(
        race,
        slot,
        memory,
        trackFor(state.settings.track),
        "normal",
      );
      memories.set(id, next);
      if (runtime.drive(input)) changes++;
    }
    return changes;
  };
  return {
    mesh,
    get peers() {
      return [...runtimes.values()];
    },
    join,
    room,
    drive(ms) {
      let changes = 0;
      mesh.run(ms, () => {
        if (mesh.now % HAND_MS === 0) changes += hands();
      });
      return changes;
    },
  };
}

/** The creator opens the room, the two drivers join it, and a bot takes the fourth slot. */
function seated(): Table {
  const room = table();
  room.join("a");
  // The creator holds the room before the phones reach it, as a page that opened it does.
  room.mesh.run(600);
  room.join("b");
  room.join("c");
  room.mesh.run(400);
  assert.equal(
    defined(room.peers[0]).command({ type: "bot", action: "add" }),
    true,
    "the creator added a bot",
  );
  room.mesh.run(200);
  return room;
}

/** The same, with the race started and the countdown run out, so the trucks are really driving. */
function racing(): Table {
  const room = seated();
  assert.equal(
    defined(room.peers[0]).command({ type: "action", action: "start" }),
    true,
    "the creator started the race",
  );
  room.drive(COUNTDOWN_MS);
  for (const peer of room.peers)
    assert.equal(defined(peer.roomState()).stage, "running");
  assert.equal(defined(room.room("a").race).phase, "racing");
  return room;
}

/** The race as bytes, which is what "the same race" has to mean across peers. */
const raceBytes = (room: FuseDriversRoom): string =>
  JSON.stringify(defined(room.race, "race"));

const truckOf = (room: FuseDriversRoom, id: string): Truck =>
  defined(defined(room.race, "race").trucks[room.grid.indexOf(id)], "truck");

/**
 * Every peer holds one race: the same hash at a tick they have all folded and still retain, and — because they run one
 * clock — the same room and the same race bytes at the tick they are standing on.
 */
function assertOneRace(
  peers: readonly TestFuseDriversRuntime[],
  what: string,
): void {
  const first = defined(defined(peers[0]).roomState(), "room");
  const newest = Math.min(
    ...peers.map((peer) => defined(peer.roomState(), "room").tick),
  );
  // Checkpoints are kept every four ticks (`checkpoint.leading`), so this is a tick they all retain.
  const at = Math.floor((newest - 4) / 4) * 4;
  const hash = defined(peers[0]).hashAt(at);
  assert.ok(hash, `${what}: tick ${String(at)} is retained`);
  for (const peer of peers) {
    const room = defined(peer.roomState(), "room");
    assert.equal(peer.hashAt(at), hash, `${what}: hash at tick ${String(at)}`);
    assert.equal(room.tick, first.tick, `${what}: the same log tick`);
    assert.equal(
      fuseDriversGame.hash(room),
      fuseDriversGame.hash(first),
      `${what}: hash`,
    );
    assert.equal(raceBytes(room), raceBytes(first), `${what}: race bytes`);
    const metrics = peer.metrics();
    assert.equal(metrics.mismatches, 0, `${what}: no hash mismatch was seen`);
    assert.deepEqual(metrics.refused, [], `${what}: nobody was refused`);
    assert.equal(metrics.settled, true, `${what}: no rollback is owed`);
  }
}

/** Trucks that never left the grid would prove nothing: the field has to have driven a real stretch of track. */
function assertDroveOn(room: FuseDriversRoom, what: string): void {
  const made = room.grid.map((id) => truckOf(room, id).progress);
  for (const [slot, id] of room.grid.entries())
    assert.ok(
      defined(made[slot], "progress") > 0.5,
      `${what}: ${id} pulled away from the starting grid`,
    );
  assert.ok(
    Math.max(...made) > 2,
    `${what}: the race is checkpoints down the track (${made.map((one) => one.toFixed(1)).join(", ")})`,
  );
}

test("a driver joins through the runtime, is seated, and every peer sees the same grid", () => {
  const room = table();
  const creator = room.join("a");
  room.mesh.run(600);
  assert.deepEqual(
    [...room.room("a").seats.keys()],
    ["a"],
    "the creator holds the room alone",
  );

  // The phone joins by command, the way the page does: a request to the manager, a seat in the manager's log, and the
  // whole room back over the wire, since this runtime has never folded a tick of it.
  const driver = room.join("b");
  assert.equal(driver.roomState(), undefined, "b starts with no world at all");
  room.mesh.run(400);
  const seat = defined(room.room("b").seats.get("b"), "b's seat");
  assert.equal(seat.name, "Bo");
  assert.equal(seat.connected, true);
  assert.equal(seat.watcher, undefined, "a driver, not a watcher");
  assert.equal(seat.bot, false);

  room.join("c");
  room.mesh.run(400);
  assert.equal(creator.command({ type: "bot", action: "add" }), true);
  room.mesh.run(300);

  const grid = fuseDriversView(room.room("a")).drivers;
  assert.deepEqual(
    grid.map((driverView) => [driverView.id, driverView.slot]),
    [
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["bot:1", 3],
    ],
    "three phones and a bot, each in its own slot",
  );
  for (const peer of room.peers)
    assert.deepEqual(
      fuseDriversView(defined(peer.roomState(), "room")).drivers,
      grid,
      "every peer shows the same lobby grid",
    );
});

test("the creator starts the race and three peers converge on it, truck for truck", () => {
  const room = racing();
  const before = room.room("a").tick;
  const changes = room.drive(10_000);

  assert.ok(
    room.room("a").tick - before >= 190,
    `the race ran two hundred log ticks (${String(room.room("a").tick - before)})`,
  );
  assert.ok(changes > 60, `the drivers really steered (${String(changes)})`);
  assertOneRace(room.peers, "a calm mesh");
  assertDroveOn(room.room("a"), "a calm mesh");
  assert.equal(defined(room.room("a").race).phase, "racing");
  // The creator stamps its hash into its packets and the others check it as they go, which is how a real divergence
  // would surface: `assertOneRace` has already read back that none of them saw one.
  assert.ok(
    room.peers
      .slice(1)
      .every((peer) => peer.metrics().hashChecks > MIN_HASH_CHECKS),
    "the drivers compared the creator's hash with their own state, again and again",
  );
});

test("dropped, delayed, reordered and duplicated packets converge on the same race", () => {
  const room = racing();
  const random = seeded(0x1989);
  room.mesh.fast = () => {
    const roll = random();
    if (roll < 0.2) return { drop: true };
    return {
      delayMs: 20 + Math.floor(random() * 120),
      ...(roll > 0.85 ? { duplicateMs: 40 + Math.floor(random() * 200) } : {}),
    };
  };
  const changes = room.drive(6000);
  // The mesh comes good, and the peers are given the moment they need to settle on the race they all folded.
  room.mesh.fast = () => ({ delayMs: 20 });
  room.drive(1500);

  assert.ok(changes > 50, `the drivers steered through the loss`);
  assert.ok(
    room.peers.some((peer) => peer.metrics().rollbacks > 0),
    "late packets rolled a replica back",
  );
  assert.ok(
    room.peers.every((peer) => peer.metrics().streams["b"]?.gap === false),
    "every gap in b's stream was repaired",
  );
  assertOneRace(room.peers, "a lossy mesh");
  assertDroveOn(room.room("a"), "a lossy mesh");
});

test("a peer cut off from every packet, and a peer that joins late, take the race from a snapshot", () => {
  const room = racing();
  room.drive(1000);
  const cut = defined(room.peers[2]);
  const installedAt = (peer: TestFuseDriversRuntime): number =>
    defined(peer.metrics().streams["a"], "a's stream").base;
  const before = installedAt(cut);

  // Nothing fast reaches c for four seconds: it can speculate to its stall bound and then only wait, while a and b
  // race on. Its own packets still arrive, so the two of them have no reason to wait for it.
  room.mesh.fast = (_from, to) =>
    to === "c" ? { drop: true } : { delayMs: 20 };
  room.drive(4000);
  assert.ok(
    room.room("a").tick - room.room("c").tick >= 20,
    `c fell behind the race (${String(room.room("a").tick - room.room("c").tick)} ticks)`,
  );

  room.mesh.fast = () => ({ delayMs: 20 });
  room.drive(2000);
  assert.ok(
    installedAt(cut) > before,
    "c was too far behind to fold its way back, so it installed a fresh snapshot",
  );
  assertOneRace(room.peers, "after a blackout");

  // A fourth phone arrives mid-race, with no log and no world: the only way into a race already run is a peer's snapshot.
  const joinedAt = room.room("a").tick;
  const late = room.join("d");
  assert.equal(late.roomState(), undefined);
  room.drive(2000);
  assert.equal(
    defined(room.room("d").seats.get("d"), "d's seat").name,
    "Dee",
    "it was seated in the room it recovered",
  );
  assert.deepEqual(
    room.room("d").grid,
    room.room("a").grid,
    "and the grid it recovered is the grid the others are racing",
  );
  assert.ok(
    installedAt(late) > joinedAt - 25,
    `d started from a snapshot of a tick it never folded (${String(installedAt(late))} of ${String(joinedAt)})`,
  );
  assertOneRace(room.peers, "with a late joiner");
  assertDroveOn(room.room("d"), "with a late joiner");
});

test("a driver whose page goes away stops steering, and the peers that stay agree its truck went straight", () => {
  const room = racing();
  room.drive(1500);
  // b takes over from its own hands and holds the wheel over, which is one entry and no other.
  const driver = defined(room.peers[1]);
  driver.drive({});
  assert.equal(driver.drive({ left: true }), true, "b holds a left turn");
  room.mesh.run(800);
  for (const peer of room.peers)
    assert.equal(
      defined(peer.roomState()).controls["b"],
      LEFT,
      "every peer is driving b's truck into the turn",
    );
  assert.equal(truckOf(room.room("a"), "b").turnDir, -1, "and it is turning");

  // The page closes: the runtime stops its loop and the transport drops it, mid-turn, with the wheel still over.
  driver.stop();
  room.mesh.run(1000);
  const staying = room.peers.filter((peer) => peer !== driver);
  for (const peer of staying) {
    const state = defined(peer.roomState());
    assert.equal(defined(state.seats.get("b"), "b's seat").connected, false);
    assert.equal(state.controls["b"], 0, "b's truck let go of the wheel");
    assert.equal(truckOf(state, "b").turnDir, 0, "and came out of the turn");
  }

  const abandoned = truckOf(room.room("a"), "b");
  room.mesh.run(1000);
  const rolling = truckOf(room.room("a"), "b");
  assert.notEqual(rolling.x, abandoned.x, "the truck is still rolling");
  assert.equal(
    rolling.heading,
    abandoned.heading,
    "an absent driver is not left holding a turn",
  );
  assertOneRace(staying, "after a driver left");
});

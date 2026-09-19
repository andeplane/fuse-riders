import test from "node:test";
import assert from "node:assert/strict";
import { defaultText, rulesAge } from "../src/index.js";
import { CounterRuntime, FakeMesh } from "./fixtures/fake-mesh.js";
import { counterGame, hashCounter } from "./fixtures/counter-game.js";

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
const room = (runtime: CounterRuntime) => runtime.roomState()!;
function seated(mesh: FakeMesh, ids: string[]): CounterRuntime[] {
  const runtimes = ids.map((id) => mesh.join(id));
  mesh.run(200);
  runtimes.forEach((runtime, index) =>
    runtime.command({ type: "join", name: ids[index]!.toUpperCase() }),
  );
  // A member that asked before the creator opened the room was told `noWorld`, and asks again after the retry interval.
  mesh.run(3000);
  for (const runtime of runtimes)
    assert.equal(
      runtime.roomState()?.seats.get(runtime.transport!.id)?.connected,
      true,
    );
  return runtimes;
}
/**
 * Every replica holds the same state once the room settles: the same hash at a retained tick they have all passed. The
 * replicas' loops run one after another, so at any instant one may be a tick ahead of another.
 */
function assertConverged(runtimes: CounterRuntime[]): void {
  const newest = Math.min(...runtimes.map((runtime) => room(runtime).tick));
  const at = Math.floor((newest - 4) / 4) * 4;
  const hashes = runtimes.map((runtime) => runtime.hashAt(at));
  assert.ok(hashes[0], `every replica retains tick ${at}`);
  for (const hash of hashes) assert.equal(hash, hashes[0]);
}

test("a second game gets rooms, seats, host succession and rematch from the package", () => {
  const mesh = new FakeMesh("host", { target: 12 });
  const [host, guest] = seated(mesh, ["host", "guest"]);
  assert.deepEqual(
    [...room(host!).seats.values()].map((seat) => [seat.id, seat.slot]),
    [
      ["host", 0],
      ["guest", 1],
    ],
  );
  assert.equal(
    guest!.command({ type: "action", action: "start" }),
    false,
    "only the host manages the room",
  );
  assert.equal(host!.command({ type: "bot", action: "add" }), true);
  assert.equal(host!.command({ type: "action", action: "start" }), true);
  mesh.run(300);
  assert.equal(room(guest!).stage, "running");
  for (let turn = 0; turn < 3; turn++) {
    assert.ok(guest!.add(4));
    mesh.run(100);
  }
  mesh.run(400);
  assert.equal(room(host!).stage, "over");
  assertConverged([host!, guest!]);
  const wins = mesh.recorded
    .get("host")!
    .events.filter(({ event }) => event.type === "win");
  assert.deepEqual(
    wins.map(({ event }) => event),
    [{ type: "win", id: "guest" }],
    "the win is emitted once",
  );

  const before = room(host!).matchId;
  assert.equal(host!.command({ type: "action", action: "rematch" }), true);
  mesh.run(300);
  assert.notEqual(room(guest!).matchId, before);
  assert.equal(room(guest!).stage, "running");
  assert.deepEqual(room(guest!).totals, {});

  // The host's page goes away: after the silence rule the guest succeeds it and logs the host absent. The room's
  // commands go with the duties, so the party is not stuck waiting for a device that is not coming back.
  mesh.leave("host");
  mesh.run(7000);
  assert.equal(room(guest!).seats.get("host")?.connected, false);
  assert.equal(guest!.command({ type: "action", action: "lobby" }), true);
  mesh.run(300);
  assert.equal(room(guest!).stage, "lobby");
  assert.equal(guest!.command({ type: "bot", action: "add" }), true);
  assert.equal(
    guest!.creator,
    false,
    "the guest is the acting creator, not the creator",
  );
});

test("dropped, duplicated and reordered fast packets converge on one state", () => {
  const random = seeded(7);
  const mesh = new FakeMesh("a", { target: 1000 });
  const runtimes = seated(mesh, ["a", "b", "c"]);
  runtimes[0]!.command({ type: "action", action: "start" });
  mesh.run(300);
  mesh.fast = () => {
    const roll = random();
    if (roll < 0.2) return { drop: true };
    return {
      delayMs: 20 + Math.floor(random() * 120),
      ...(roll > 0.8 ? { duplicateMs: 40 + Math.floor(random() * 200) } : {}),
    };
  };
  for (let step = 0; step < 60; step++) {
    const runtime = runtimes[step % 3]!;
    assert.ok(runtime.add(1 + (step % 9)));
    if (step % 7 === 0) assert.ok(runtime.mark());
    mesh.run(30 + Math.floor(random() * 50));
  }
  mesh.fast = () => ({ delayMs: 20 });
  mesh.run(3000);
  assertConverged(runtimes);
  const totals = room(runtimes[0]!).totals;
  let expected = 0;
  for (let step = 0; step < 60; step++) expected += 1 + (step % 9);
  assert.equal(
    Object.values(totals).reduce((sum, value) => sum + value, 0),
    expected,
    "every entry was applied exactly once",
  );
  assert.ok(
    runtimes.some((runtime) => runtime.metrics().rollbacks > 0),
    "late packets rolled a replica back",
  );
  for (const [id, recorded] of mesh.recorded) {
    const adds = recorded.events.filter(({ event }) => event.type === "add");
    const sum = adds.reduce(
      (total, { event }) => total + (event.type === "add" ? event.amount : 0),
      0,
    );
    assert.ok(
      sum >= expected,
      `${id} heard every add at least once, whatever it rolled back`,
    );
  }
});

test("a late joiner recovers the room from a peer's snapshot, and a corrupt snapshot is refused without installing anything", () => {
  const mesh = new FakeMesh("a", { target: 1000 });
  const [a, b] = seated(mesh, ["a", "b"]);
  a!.command({ type: "action", action: "start" });
  mesh.run(300);
  for (let step = 0; step < 10; step++) {
    assert.ok(a!.add(3));
    assert.ok(b!.add(2));
    mesh.run(50);
  }
  let corrupted = 0;
  mesh.snapshot = (chunk, to) => {
    if (to !== "c" || corrupted++ > 0) return;
    // Flip one character of the base64 text: the bytes still decode, but no longer to a state its hash matches.
    const at = Math.floor(chunk.data.length / 2);
    chunk.data =
      chunk.data.slice(0, at) +
      (chunk.data[at] === "A" ? "B" : "A") +
      chunk.data.slice(at + 1);
  };
  const c = mesh.join("c");
  mesh.run(400);
  assert.equal(corrupted, 1, "the first snapshot was corrupted in flight");
  assert.equal(c.roomState(), undefined, "nothing was installed from it");
  mesh.run(4000);
  assert.ok(c.roomState(), "a retry installed a clean snapshot");
  c.command({ type: "join", name: "C" });
  mesh.run(1000);
  c.add(5);
  mesh.run(1500);
  assertConverged([a!, b!, c]);
  assert.equal(room(c).totals.c, 5);
  assert.equal(room(c).totals.a, 30);
});

test("a replica that already holds a world refuses a corrupt resync and keeps its state until a clean one arrives", () => {
  const mesh = new FakeMesh("a", { target: 1000 });
  const [a, b] = seated(mesh, ["a", "b"]);
  a!.command({ type: "action", action: "start" });
  mesh.run(300);
  assert.ok(a!.add(3) && b!.add(2));
  mesh.run(500);
  // b's tab is hidden long enough that catching up would cost more than a snapshot: shown again, it asks for one.
  mesh.setHidden("b", true);
  mesh.run(12_000);
  const held = room(b!),
    before = hashCounter(held),
    tick = held.tick;
  let corrupted = 0;
  mesh.snapshot = (chunk, to) => {
    if (to !== "b" || corrupted++ > 0) return;
    const at = Math.floor(chunk.data.length / 2);
    chunk.data =
      chunk.data.slice(0, at) +
      (chunk.data[at] === "A" ? "B" : "A") +
      chunk.data.slice(at + 1);
  };
  mesh.fast = (from, to) => (to === "b" ? { drop: true } : { delayMs: 20 });
  mesh.setHidden("b", false);
  assert.equal(
    b!.metrics().snapshotRequest,
    true,
    "shown again, far behind: it asks",
  );
  mesh.run(200);
  assert.equal(corrupted, 1, "the answer was corrupted in flight");
  assert.equal(room(b!), held, "the world it held was not replaced");
  assert.equal(hashCounter(room(b!)), before, "nor changed");
  assert.equal(room(b!).tick, tick);
  mesh.fast = () => ({ delayMs: 20 });
  mesh.run(4000);
  assert.ok(room(b!).tick > tick + 200, "a retry installed a clean snapshot");
  assertConverged([a!, b!]);
});

test("a peer on other rules is refused, and the text says which side is out of date", () => {
  const mesh = new FakeMesh("a");
  seated(mesh, ["a"]);
  // A newer build of the same game joins: this older room is what it must not take a world from.
  const newer = { ...counterGame, rules: "counter-4" };
  const b = mesh.join("b", newer);
  // Past the notice's hold, the recurring status returns.
  mesh.run(6000);
  const statuses = mesh.recorded.get("b")!.statuses;
  assert.ok(
    statuses.includes(defaultText.mismatch.staleRider),
    statuses.join(" | "),
  );
  assert.equal(
    statuses.at(-1),
    defaultText.mismatch.staleRoom,
    "with no world to be had, the older room is what it names",
  );
  assert.equal(
    b.roomState(),
    undefined,
    "nothing is taken from a peer on other rules",
  );
  assert.deepEqual(b.metrics().refused, ["a"]);
  assert.equal(rulesAge("counter-3", "counter-4"), "newer");
  assert.equal(rulesAge("counter-3", "fuse-p2p-4"), "unknown");
  assert.equal(rulesAge("counter-3", 3), "unknown");
});

test("solo seats the player and the game's bots and starts at once", () => {
  let now = 0,
    loop: (() => void) | undefined;
  const runtime = new CounterRuntime(
    counterGame,
    "SOLO",
    { target: 5 },
    {
      state: () => {},
      event: () => {},
      status: () => {},
      ready: () => {},
    },
    {
      humanName: "  Ada  ",
      dependencies: {
        now: () => now,
        hidden: () => false,
        token: () => "match",
        generation: () => 1,
        schedule: (callback) => {
          loop = callback;
          return () => (loop = undefined);
        },
        onVisibilityChange: () => () => {},
      },
    },
  );
  runtime.start();
  const state = runtime.roomState()!;
  assert.deepEqual(
    [...state.seats.values()].map((seat) => [seat.id, seat.name, seat.bot]),
    [
      ["solo", "Ada", false],
      ["bot:1", "AI 1", true],
    ],
  );
  assert.equal(state.stage, "running");
  for (let step = 0; step < 100; step++) {
    now += 10;
    loop!();
  }
  runtime.add(5);
  for (let step = 0; step < 10; step++) {
    now += 10;
    loop!();
  }
  assert.equal(runtime.roomState()!.stage, "over");
  runtime.stop();
  assert.equal(loop, undefined);
});

test("a watcher is listed without a seat, steers nothing, is not waited on, and leaves the lobby's list when it goes", () => {
  const mesh = new FakeMesh("a", { target: 1000 });
  const [a, b] = seated(mesh, ["a", "b"]);
  const w = mesh.join("w");
  mesh.run(3000);
  assert.equal(w.command({ type: "spectate", name: "Watcher" }), true);
  mesh.run(1000);
  const listed = room(a!).seats.get("w")!;
  assert.deepEqual(
    [listed.watcher, listed.slot, listed.connected],
    [true, -1, true],
  );
  assert.equal(w.add(3), false, "a watcher has no seat to steer");
  assert.equal(
    b!.command({ type: "spectate", name: "B" }),
    true,
    "the command is sent; the creator refuses it",
  );
  mesh.run(500);
  assert.equal(room(a!).seats.get("b")?.watcher, undefined);
  // One rider and one watcher short of two riders: a watcher does not count towards a start.
  mesh.leave("b");
  mesh.run(500);
  assert.equal(room(a!).seats.has("b"), false);
  assert.equal(a!.command({ type: "action", action: "start" }), false);
  assert.ok(mesh.recorded.get("a")!.statuses.includes(defaultText.needTwo));
  const lagging = mesh.recorded.get("a")!.statuses.length;
  mesh.fast = (from) => (from === "w" ? { drop: true } : { delayMs: 20 });
  mesh.run(800);
  assert.ok(
    !mesh.recorded
      .get("a")!
      .statuses.slice(lagging)
      .some((text) => text.includes("Watcher")),
    "a silent watcher is not named as lagging",
  );
  mesh.fast = () => ({ delayMs: 20 });
  const b2 = mesh.join("b");
  mesh.run(3000);
  b2.command({ type: "join", name: "B" });
  mesh.run(1000);
  a!.command({ type: "action", action: "start" });
  mesh.run(300);
  // The watcher's page freezes: nothing waits on its stream, so the players play on.
  mesh.fast = (from) => (from === "w" ? { drop: true } : { delayMs: 20 });
  const before = room(a!).tick;
  assert.ok(a!.add(4) && b2.add(5));
  mesh.run(2500);
  assert.ok(room(a!).tick - before > 40, "not held by the stall rule");
  assert.deepEqual(room(b2).totals, { a: 4, b: 5 });
  mesh.fast = () => ({ delayMs: 20 });
  a!.command({ type: "action", action: "lobby" });
  mesh.run(500);
  mesh.leave("w");
  mesh.run(500);
  assert.equal(
    room(a!).seats.has("w"),
    false,
    "a watcher leaving the lobby frees its place",
  );
  assertConverged([a!, b2]);
});

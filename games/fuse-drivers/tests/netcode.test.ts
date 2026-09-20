import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  BOT,
  JOIN,
  SnapshotAssembler,
  World,
  decodeSnapshot,
  encodeSnapshot,
  type WorldEvent,
} from "fuse-netcode";
import {
  HOLD,
  ROLL,
  createRoom,
  fuseDriversGame,
  type FuseDriversEntry,
  type FuseDriversEvent,
  type FuseDriversRoom,
  type FuseDriversSettings,
  type FuseDriversView,
} from "../src/game/index.js";
import { FAST } from "./fixtures/fuseDrivers.js";
import {
  FuseDriversMesh,
  type TestFuseDriversRuntime,
} from "./fixtures/mesh.js";

type FuseDriversWorld = World<
  FuseDriversRoom,
  FuseDriversEntry,
  FuseDriversView,
  FuseDriversEvent,
  FuseDriversSettings
>;

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

/**
 * A replica of one room: the creator `a` (not seated) seats `b` at slot 0 and a bot at slot 1 at tick 1 and starts at
 * tick 2, so b opens. Only b's stream is remote.
 */
function replica(self = "a"): FuseDriversWorld {
  const world = new World(fuseDriversGame, createRoom("m0", FAST), "a", self);
  const a = world.stream("a", 1);
  world.stream("b", 1);
  a.append(1, [JOIN, "b", "Bo", 0, "cat", 1]);
  a.append(1, [BOT, "add", "bot:1", "Bot 2", 1]);
  a.append(2, [ACTION, "start", "m1"]);
  a.through = 400;
  return world;
}
const kinds = (events: readonly WorldEvent<FuseDriversEvent>[]) =>
  events.map(({ event }) => event);

test("the same log folds to the same room and hash on every replica, however the packets batch it", () => {
  const entries: FuseDriversEntry[] = [
    [1, 5, ROLL, 1],
    [2, 9, ROLL, 1],
    [3, 14, HOLD, 1],
  ];
  const whole = replica(),
    trickled = replica("b");
  whole.receive("b", entries, 3, 300, 300);
  whole.advance(300);
  for (const [index, entry] of entries.entries()) {
    trickled.receive("b", [entry], index + 1, entry[1], entry[1]);
    trickled.advance(entry[1] + 2);
  }
  trickled.receive("b", [], 3, 300, 300);
  trickled.advance(300);
  assert.equal(
    fuseDriversGame.hash(whole.state),
    fuseDriversGame.hash(trickled.state),
  );
  assert.equal(whole.hashAt(296), trickled.hashAt(296));
  assert.deepEqual(whole.view()[0], trickled.view()[0]);
  assert.ok(whole.state.rolls >= 2, "b rolled and the bot played on");
  // A different match id seeds different fuseDrivers.
  const other = new World(fuseDriversGame, createRoom("m0", FAST), "a", "a");
  const log = other.stream("a", 1);
  other.stream("b", 1);
  log.append(1, [JOIN, "b", "Bo", 0, "cat", 1]);
  log.append(1, [BOT, "add", "bot:1", "Bot 2", 1]);
  log.append(2, [ACTION, "start", "another"]);
  log.through = 400;
  other.receive("b", entries, 3, 300, 300);
  other.advance(300);
  assert.notEqual(
    fuseDriversGame.hash(other.state),
    fuseDriversGame.hash(whole.state),
  );
});

test("a late HOLD stamped before the timer ran out undoes a replica's speculative auto-hold and the bot's next roll", () => {
  // b rolls at tick 5, so its turn holds by itself at tick 45; b pressed HOLD at tick 44.
  const roll: FuseDriversEntry = [1, 5, ROLL, 1],
    hold: FuseDriversEntry = [2, 44, HOLD, 1];
  const onTime = replica();
  onTime.receive("b", [roll, hold], 2, 120, 120);
  const heard = kinds(onTime.advance(120).events);
  const pressed = heard.find((event) => event.type === "hold");
  assert.ok(
    pressed?.type === "hold" && pressed.id === "b" && !pressed.auto,
    "b's own hold",
  );

  const late = replica();
  // b's HOLD is in flight: b has only promised its stream through tick 43, and the replica speculates past it.
  late.receive("b", [roll], 1, 43, 43);
  const speculated = kinds(late.advance(80).events);
  assert.equal(late.tick, 80);
  assert.deepEqual(
    speculated.find((event) => event.type === "hold"),
    { ...pressed, auto: true },
    "the replica held for b when the timer ran out",
  );
  assert.ok(
    speculated.some((event) => event.type === "roll" && event.id === "bot:1"),
    "and the bot took its turn after the auto-hold",
  );
  assert.notEqual(
    fuseDriversGame.hash(late.state),
    fuseDriversGame.hash(onTime.state),
  );

  const corrected = late.receive("b", [roll, hold], 2, 120, 120);
  assert.equal(corrected.status, "accepted");
  assert.ok(corrected.rollbackTicks > 80 - 44);
  assert.deepEqual(
    kinds(corrected.events).find((event) => event.type === "hold"),
    pressed,
    "the corrected hold is b's own",
  );
  late.advance(120);
  assert.equal(
    fuseDriversGame.hash(late.state),
    fuseDriversGame.hash(onTime.state),
  );
  assert.equal(late.hashAt(116), onTime.hashAt(116));
  assert.deepEqual(
    late.view()[0],
    onTime.view()[0],
    "the view shows the corrected turn, timer and roll",
  );
  // The same packet again changes nothing.
  const again = late.receive("b", [roll, hold], 2, 120, 120);
  assert.equal(again.rollbackTicks, 0);
  assert.deepEqual(again.events, []);
});

test("dropped, duplicated and reordered entries converge on the on-time room", () => {
  const entries: FuseDriversEntry[] = [
    [1, 4, ROLL, 1],
    [2, 8, ROLL, 1],
    [3, 12, ROLL, 1],
    [4, 16, HOLD, 1],
  ];
  const onTime = replica();
  onTime.receive("b", entries, 4, 200, 200);
  onTime.advance(200);

  const lossy = replica();
  // Seq 1 is dropped and seq 3 arrives before seq 2; the gap holds them until seq 1 is repaired.
  lossy.receive("b", [entries[2]!], 3, 12, 12);
  lossy.advance(20);
  lossy.receive("b", [entries[1]!, entries[1]!], 3, 12, 12);
  lossy.advance(30);
  lossy.receive("b", [entries[0]!, entries[2]!], 3, 12, 12);
  lossy.advance(40);
  lossy.receive("b", [entries[3]!, entries[3]!], 4, 200, 200);
  lossy.receive("b", entries, 4, 200, 200);
  lossy.advance(200);
  assert.equal(
    fuseDriversGame.hash(lossy.state),
    fuseDriversGame.hash(onTime.state),
  );
  assert.equal(lossy.state.history.length, onTime.state.history.length);
  assert.equal(lossy.state.rolls, onTime.state.rolls);
});

test("a room snapshot carries the fuseDrivers room whole, and a tampered one is refused", () => {
  const source = replica();
  source.receive("b", [[1, 5, ROLL, 1]], 1, 60, 60);
  source.advance(60);
  const chunks = encodeSnapshot(source, 4);
  assert.equal(chunks[0]!.rules, "fuse-drivers-1");
  const assembler = new SnapshotAssembler(fuseDriversGame, 4);
  let complete: { tick: number; bytes: Uint8Array } | undefined;
  for (const chunk of chunks) complete = assembler.accept(chunk);
  assert.ok(complete);
  const decoded = decodeSnapshot(fuseDriversGame, complete.bytes, 4)!;
  assert.ok(decoded);
  assert.equal(
    fuseDriversGame.hash(decoded.state),
    fuseDriversGame.hash(source.servable().state),
  );
  // A replica that installs it folds on to the same room.
  const joiner = replica();
  joiner.install(decoded.state);
  assert.deepEqual(
    fuseDriversGame.view(joiner.state),
    fuseDriversGame.view(decoded.state),
  );
  const flipped = complete.bytes.slice();
  const at = flipped.length - 3;
  flipped[at] = flipped[at]! ^ 0xff;
  assert.equal(decodeSnapshot(fuseDriversGame, flipped, 4), undefined);
});

/** Every replica holds the same state once the room settles: the same hash at a retained tick all have passed. */
function assertConverged(runtimes: TestFuseDriversRuntime[]): void {
  const newest = Math.min(
    ...runtimes.map((runtime) => runtime.roomState()!.tick),
  );
  const at = Math.floor((newest - 4) / 4) * 4;
  const hashes = runtimes.map((runtime) => runtime.hashAt(at));
  assert.ok(hashes[0], `every replica retains tick ${at}`);
  for (const hash of hashes) assert.equal(hash, hashes[0]);
}

test("three phones and a bot play Pig over dropped, duplicated and reordered packets and agree on every roll", () => {
  const random = seeded(11);
  const mesh = new FuseDriversMesh("a", { turnTicks: 60, display: false });
  const ids = ["a", "b", "c"];
  const runtimes = ids.map((id) => mesh.join(id));
  mesh.run(200);
  runtimes.forEach((runtime, index) =>
    runtime.command({ type: "join", name: ids[index]!.toUpperCase() }),
  );
  mesh.run(3000);
  assert.equal(
    runtimes[1]!.command({ type: "action", action: "start" }),
    false,
  );
  assert.equal(runtimes[0]!.command({ type: "bot", action: "add" }), true);
  mesh.run(300);
  assert.equal(runtimes[0]!.command({ type: "action", action: "start" }), true);
  mesh.run(300);
  for (const runtime of runtimes)
    assert.equal(runtime.roomState()!.stage, "running");

  mesh.fast = () => {
    const roll = random();
    if (roll < 0.2) return { drop: true };
    return {
      delayMs: 20 + Math.floor(random() * 120),
      ...(roll > 0.85 ? { duplicateMs: 40 + Math.floor(random() * 200) } : {}),
    };
  };
  // Each phone rolls while its turn total is under 12, then holds; a press every 300 ms of its own clock.
  let pressed = 0;
  const lastPress = new Map<string, number>();
  mesh.run(60_000, () => {
    for (const [index, runtime] of runtimes.entries()) {
      const id = ids[index]!,
        room = runtime.roomState();
      if (!room || room.turn !== id) continue;
      if (mesh.now - (lastPress.get(id) ?? 0) < 300) continue;
      lastPress.set(id, mesh.now);
      if (runtime.press(room.turnTotal < 12 ? ROLL : HOLD)) pressed++;
    }
  });
  mesh.fast = () => ({ delayMs: 20 });
  mesh.run(3000);
  assertConverged(runtimes);
  assert.ok(pressed > 20, `the phones pressed (${pressed})`);
  const room = runtimes[0]!.roomState()!;
  assert.ok(room.history.length >= 1, "at least one round was decided");
  assert.ok(
    runtimes.some((runtime) => runtime.metrics().rollbacks > 0),
    "late packets rolled a replica back",
  );
  // Rounds decided agree everywhere: every replica heard each round's decision once per timeline, and the room says who won.
  for (const runtime of runtimes)
    assert.deepEqual(runtime.roomState()!.history, room.history);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  JOIN,
  SnapshotAssembler,
  World,
  decodeSnapshot,
  encodeSnapshot,
} from "fuse-netcode";
import {
  INPUT_HELD,
  INPUT_LEFT,
  INPUT_RIGHT,
  RULES,
  type GameEvent,
} from "../src/engine/index.js";
import {
  DEFAULT_SETTINGS,
  PLAY,
  PRESS,
  createRoom,
  killerFuseGame as game,
  type Entry,
  type Room,
  type Settings,
  type View,
} from "../src/online/game.js";
import { KillerFuseMesh, type TestKillerFuseRuntime } from "./fixtures/mesh.js";

type KillerFuseWorld = World<Room, Entry, View, GameEvent, Settings>;
const ONE_GAME: Settings = { ...DEFAULT_SETTINGS, wins: 1, botLevel: "hard" };
/** The countdown is over at this log tick of a replica below: the set starts at tick 2. */
const PLAYING = 70;

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
 * A replica of one room: the creator `a` (the Cyan Queen) seats itself and `b` (the Pink Queen) at tick 1 and starts
 * at tick 2. Only b's stream is remote.
 */
function replica(self = "a"): KillerFuseWorld {
  const world = new World(game, createRoom("m0", ONE_GAME), "a", self);
  const a = world.stream("a", 1);
  world.stream("b", 1);
  a.append(1, [JOIN, "a", "Ada", 0, "bee", 1]);
  a.append(1, [JOIN, "b", "Bo", 1, "bee", 1]);
  a.append(2, [ACTION, "start", "m1"]);
  a.through = 2_000;
  return world;
}
/** b's controls: a held direction, then presses a few ticks apart on different steps. */
const moves: Entry[] = [
  [1, PLAYING + 2, PLAY, "m1", 1, INPUT_LEFT],
  [2, PLAYING + 6, PRESS, "m1", 1, 1, 0],
  [3, PLAYING + 9, PRESS, "m1", 1, 2, 2],
  [4, PLAYING + 13, PLAY, "m1", 1, INPUT_RIGHT | INPUT_HELD],
  [5, PLAYING + 17, PRESS, "m1", 1, 3, 1],
];

test("the same log folds to the same room and hash on every replica, however the packets batch it", () => {
  const whole = replica(),
    trickled = replica("b");
  whole.receive("b", moves, 5, 200, 200);
  whole.advance(200);
  for (const [index, entry] of moves.entries()) {
    trickled.receive("b", [entry], index + 1, entry[1], entry[1]);
    trickled.advance(entry[1] + 2);
  }
  trickled.receive("b", [], 5, 200, 200);
  trickled.advance(200);
  assert.equal(game.hash(whole.state), game.hash(trickled.state));
  assert.equal(whole.hashAt(196), trickled.hashAt(196));
  assert.deepEqual(whole.view()[0], trickled.view()[0]);
  // The controls counted: the same room without them is another room.
  const idle = replica();
  idle.receive("b", [], 0, 200, 200);
  idle.advance(200);
  assert.notEqual(game.hash(idle.state), game.hash(whole.state));
});

test("a press that arrives 150 to 300 ms late rolls the replica back to the room that heard it on time", () => {
  const onTime = replica();
  onTime.receive("b", moves, 5, 200, 200);
  onTime.advance(200);
  // Log ticks are 50 ms: 3 to 6 ticks late.
  for (const late of [3, 4, 5, 6]) {
    const replicaLate = replica();
    let heard = 0,
      rolledBack = 0;
    for (let tick = 1; tick <= 200; tick++) {
      // What b had logged `late` ticks ago arrives now; the replica has already simulated past it.
      const known = moves.filter((entry) => entry[1] <= tick - late);
      if (known.length > heard || tick === 200) {
        const promised = tick === 200 ? 200 : tick - late;
        const result = replicaLate.receive(
          "b",
          tick === 200 ? moves : known,
          tick === 200 ? 5 : known.length,
          promised,
          promised,
        );
        assert.equal(result.status, "accepted");
        rolledBack += result.rollbackTicks;
        heard = known.length;
      }
      replicaLate.advance(tick);
    }
    assert.ok(rolledBack >= late, `${late} ticks late rolled back`);
    assert.equal(
      game.hash(replicaLate.state),
      game.hash(onTime.state),
      `${late} ticks late`,
    );
    assert.equal(replicaLate.hashAt(196), onTime.hashAt(196));
    assert.deepEqual(replicaLate.view()[0], onTime.view()[0]);
  }
});

test("dropped, duplicated and reordered entries converge on the on-time room", () => {
  const onTime = replica();
  onTime.receive("b", moves, 5, 200, 200);
  onTime.advance(200);
  const lossy = replica();
  // Seq 1 is dropped and seq 3 arrives before seq 2; the gap holds them until seq 1 is repaired.
  lossy.receive("b", [moves[2]!], 3, PLAYING + 9, PLAYING + 9);
  lossy.advance(PLAYING + 12);
  lossy.receive("b", [moves[1]!, moves[1]!], 3, PLAYING + 9, PLAYING + 9);
  lossy.advance(PLAYING + 16);
  lossy.receive("b", [moves[0]!, moves[2]!], 3, PLAYING + 9, PLAYING + 9);
  lossy.advance(PLAYING + 20);
  lossy.receive("b", [moves[4]!, moves[3]!, moves[3]!], 5, 200, 200);
  lossy.receive("b", moves, 5, 200, 200);
  lossy.advance(200);
  assert.equal(game.hash(lossy.state), game.hash(onTime.state));
});

test("a room snapshot carries the room whole, and a tampered one is refused", () => {
  const source = replica();
  source.receive("b", moves, 5, 160, 160);
  source.advance(160);
  const chunks = encodeSnapshot(source, 4);
  assert.equal(chunks[0]!.rules, RULES);
  const assembler = new SnapshotAssembler(game, 4);
  let complete: { tick: number; bytes: Uint8Array } | undefined;
  for (const chunk of chunks) complete = assembler.accept(chunk);
  assert.ok(complete);
  const decoded = decodeSnapshot(game, complete.bytes, 4)!;
  assert.ok(decoded);
  assert.equal(game.hash(decoded.state), game.hash(source.servable().state));
  const joiner = replica();
  joiner.install(decoded.state);
  assert.deepEqual(game.view(joiner.state), game.view(decoded.state));
  const flipped = complete.bytes.slice();
  const at = flipped.length - 3;
  flipped[at] = flipped[at]! ^ 0xff;
  assert.equal(decodeSnapshot(game, flipped, 4), undefined);
});

/** Every replica holds the same state once the room settles: the same hash at a retained tick all have passed. */
function assertConverged(runtimes: TestKillerFuseRuntime[]): void {
  const newest = Math.min(
    ...runtimes.map((runtime) => runtime.roomState()!.tick),
  );
  const at = Math.floor((newest - 4) / 4) * 4;
  const hashes = runtimes.map((runtime) => runtime.hashAt(at));
  assert.ok(hashes[0], `every replica retains tick ${at}`);
  for (const hash of hashes) assert.equal(hash, hashes[0]);
}

/** One peer's play: a new held direction every `period` ms, and a press every `tap` ms. */
function player(runtime: TestKillerFuseRuntime, period: number, tap: number) {
  const bits = [INPUT_LEFT, INPUT_RIGHT, INPUT_RIGHT | INPUT_HELD, 0];
  let presses = 0;
  return {
    play(now: number): void {
      if (runtime.roomState()?.stage !== "running") return;
      if (now % period === 0) runtime.input(bits[(now / period) % 4]!);
      else runtime.flush();
      if (now % tap === 0 && runtime.press()) presses++;
    },
    presses: () => presses,
  };
}

test("two peers play a set to its end over 150 to 300 ms of delay, loss and reordering, and agree on every hash", () => {
  const random = seeded(23);
  const mesh = new KillerFuseMesh("a", ONE_GAME);
  const ids = ["a", "b"];
  const runtimes = ids.map((id) => mesh.join(id));
  mesh.run(200);
  runtimes.forEach((runtime, index) =>
    assert.ok(runtime.command({ type: "join", name: ids[index]! })),
  );
  mesh.run(3_000);
  assert.equal(
    runtimes[1]!.command({ type: "action", action: "start" }),
    false,
    "only the creator starts",
  );
  // The joiner picks the Pink Worker's seat before the start.
  assert.ok(runtimes[1]!.seat(3));
  mesh.run(500);
  assert.ok(runtimes[0]!.command({ type: "action", action: "start" }));
  mesh.run(500);
  for (const runtime of runtimes) {
    assert.equal(runtime.roomState()!.stage, "running");
    assert.deepEqual(runtime.roomState()!.world!.humans, [
      true,
      false,
      false,
      true,
      false,
      false,
    ]);
  }
  mesh.fast = () => {
    const roll = random();
    if (roll < 0.1) return { drop: true };
    return {
      delayMs: 150 + Math.floor(random() * 150),
      ...(roll > 0.9 ? { duplicateMs: 200 + Math.floor(random() * 200) } : {}),
    };
  };
  const players = [
    player(runtimes[0]!, 700, 230),
    player(runtimes[1]!, 900, 310),
  ];
  const over = () =>
    runtimes.every((runtime) => runtime.roomState()!.stage === "over");
  let checked = 0;
  for (let ms = 0; ms < 600_000 && !over(); ms += 1_000) {
    mesh.run(1_000, () => players.forEach((p) => p.play(mesh.now)));
    // Mid-game, with packets still in flight: what both have confirmed is the same room.
    if (ms % 10_000 === 0) {
      const confirmed = Math.min(
        ...runtimes.map((runtime) => runtime.confirmedTick()),
      );
      const at = Math.floor((confirmed / 3 - 4) / 4) * 4;
      const [mine, theirs] = runtimes.map((runtime) => runtime.hashAt(at));
      if (mine && theirs) {
        assert.equal(mine, theirs, `tick ${at}`);
        checked++;
      }
    }
  }
  mesh.fast = () => ({ delayMs: 20 });
  mesh.run(3_000);
  assert.ok(over(), "the set finished on both peers");
  assertConverged(runtimes);
  assert.ok(checked > 0, "hashes were compared during play");
  assert.ok(players.every((p) => p.presses() > 20));
  assert.ok(
    runtimes.every((runtime) => runtime.metrics().rollbacks > 0),
    "late packets rolled both replicas back",
  );
  const [mine, theirs] = runtimes.map((runtime) => runtime.roomState()!);
  assert.deepEqual(theirs!.results, mine!.results);
  assert.deepEqual(theirs!.stats, mine!.stats);
  assert.equal(mine!.results.length, 1);
  assert.deepEqual(mine!.results[0]!.present, ["a", "b"]);
  // Events are told once per log tick they happen on. A victory predicted on one tick and moved to another by a late
  // packet is told again, which is why the page draws from the view; the last telling is the one that stood.
  for (const id of ids) {
    const victories = mesh.emitted
      .get(id)!
      .filter((event) => event.type === "victory");
    assert.ok(victories.length >= 1, id);
    assert.deepEqual(victories.at(-1), {
      type: "victory",
      team: mine!.results[0]!.team,
      kind: mine!.results[0]!.kind,
    });
  }
});

test("a peer that joins a running game is handed the room and takes over a bot", () => {
  const mesh = new KillerFuseMesh("a", ONE_GAME);
  const host = mesh.join("a");
  mesh.run(200);
  assert.ok(host.command({ type: "join", name: "Ada" }));
  mesh.run(500);
  assert.ok(host.command({ type: "action", action: "start" }));
  mesh.run(5_000);
  const late = mesh.join("b");
  mesh.run(2_000);
  assert.ok(late.command({ type: "join", name: "Bo" }));
  mesh.run(2_000);
  assert.equal(late.roomState()!.stage, "running");
  assert.equal(late.roomState()!.seats.get("b")!.slot, 1);
  assert.deepEqual(host.roomState()!.world!.humans.slice(0, 2), [true, true]);
  assert.ok(late.press(), "and plays at once");
  mesh.run(1_000);
  assertConverged([host, late]);
  // It leaves again: the bot is back, and the game goes on.
  mesh.leave("b");
  mesh.run(3_000);
  assert.equal(host.roomState()!.world!.humans[1], false);
  assert.equal(host.roomState()!.stage, "running");
});

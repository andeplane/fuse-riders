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
} from "fuse-netcode";
import {
  ACT,
  APPLY,
  END_WEEK,
  JOBHUB,
  JOBS,
  MONO,
  READY,
  WALK,
  WORK,
  createRoom,
  fuseLaneGame,
  type FuseLaneEntry,
  type FuseLaneEvent,
  type FuseLaneRoom,
  type FuseLaneSettings,
  type FuseLaneView,
} from "../src/game/index.js";
import { FAST } from "./fixtures/lane.js";
import { FuseLaneMesh, type TestFuseLaneRuntime } from "./fixtures/mesh.js";

type LaneWorld = World<
  FuseLaneRoom,
  FuseLaneEntry,
  FuseLaneView,
  FuseLaneEvent,
  FuseLaneSettings
>;
const COOK = JOBS.findIndex((job) => job.sure === true);

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

/** A replica of one room: the creator `a` seats `b` at slot 0 and a bot at slot 1 at tick 1 and starts at tick 2. */
function replica(self = "a"): LaneWorld {
  const world = new World(fuseLaneGame, createRoom("m0", FAST), "a", self);
  const a = world.stream("a", 1);
  world.stream("b", 1);
  a.append(1, [JOIN, "b", "Bo", 0, "cat", 1]);
  a.append(1, [BOT, "add", "bot:1", "Bot 2", 1]);
  a.append(2, [ACTION, "start", "m1"]);
  a.through = 2000;
  return world;
}

/** b walks to the Job Hub, applies as a cook, walks to Mono Burger and works. */
const plan: FuseLaneEntry[] = [
  [1, 5, WALK, 1, JOBHUB],
  [2, 60, ACT, 1, JOBHUB, APPLY, COOK, 0],
  [3, 62, WALK, 1, MONO],
  [4, 120, ACT, 1, MONO, WORK, 0, 0],
];

test("the same log folds to the same room and hash on every replica, however the packets batch it", () => {
  const whole = replica(),
    trickled = replica("b");
  whole.receive("b", plan, 4, 400, 400);
  whole.advance(400);
  for (const [index, entry] of plan.entries()) {
    trickled.receive("b", [entry], index + 1, entry[1], entry[1]);
    trickled.advance(entry[1] + 3);
  }
  trickled.receive("b", [], 4, 400, 400);
  trickled.advance(400);
  assert.equal(
    fuseLaneGame.hash(whole.state),
    fuseLaneGame.hash(trickled.state),
  );
  assert.equal(whole.hashAt(396), trickled.hashAt(396));
  assert.deepEqual(whole.view()[0], trickled.view()[0]);
  const b = whole.state.players.b!;
  assert.equal(b.job, COOK);
  assert.equal(b.shifts, 1);
});

test("a late entry stamped in the past rolls the replica back, bots included, onto the on-time room", () => {
  const onTime = replica();
  onTime.receive("b", plan, 4, 400, 400);
  onTime.advance(400);

  const late = replica();
  // b's application is in flight: b has promised its stream only through tick 59, and the replica speculates on.
  late.receive("b", plan.slice(0, 1), 1, 59, 59);
  late.advance(100);
  assert.ok(late.tick > 90, "the replica speculated past the application");
  assert.equal(late.state.players.b!.job, -1);
  assert.notEqual(
    fuseLaneGame.hash(late.state),
    fuseLaneGame.hash(onTime.state),
  );
  const corrected = late.receive("b", plan, 4, 400, 400);
  assert.equal(corrected.status, "accepted");
  assert.ok(corrected.rollbackTicks >= 30);
  late.advance(400);
  assert.equal(fuseLaneGame.hash(late.state), fuseLaneGame.hash(onTime.state));
  assert.deepEqual(
    late.view()[0],
    onTime.view()[0],
    "the view shows the corrected job, cash and position",
  );
  const again = late.receive("b", plan, 4, 400, 400);
  assert.equal(again.rollbackTicks, 0);
});

test("dropped, duplicated and reordered entries converge on the on-time room", () => {
  const onTime = replica();
  onTime.receive("b", plan, 4, 400, 400);
  onTime.advance(400);

  const lossy = replica();
  lossy.receive("b", [plan[2]!], 3, 62, 62);
  lossy.advance(30);
  lossy.receive("b", [plan[1]!, plan[1]!], 3, 62, 62);
  lossy.advance(40);
  lossy.receive("b", [plan[0]!, plan[2]!], 3, 62, 62);
  lossy.advance(50);
  lossy.receive("b", [plan[3]!, plan[3]!], 4, 400, 400);
  lossy.receive("b", plan, 4, 400, 400);
  lossy.advance(400);
  assert.equal(fuseLaneGame.hash(lossy.state), fuseLaneGame.hash(onTime.state));
});

test("a room snapshot carries the Fusetown room whole, and a tampered one is refused", () => {
  const source = replica();
  source.receive("b", plan, 4, 400, 400);
  source.advance(400);
  const chunks = encodeSnapshot(source, 4);
  assert.equal(chunks[0]!.rules, "fuse-lane-3");
  const assembler = new SnapshotAssembler(fuseLaneGame, 4);
  let complete: { tick: number; bytes: Uint8Array } | undefined;
  for (const chunk of chunks) complete = assembler.accept(chunk);
  assert.ok(complete);
  const decoded = decodeSnapshot(fuseLaneGame, complete.bytes, 4)!;
  assert.ok(decoded);
  assert.equal(
    fuseLaneGame.hash(decoded.state),
    fuseLaneGame.hash(source.servable().state),
  );
  const joiner = replica();
  joiner.install(decoded.state);
  assert.deepEqual(
    fuseLaneGame.view(joiner.state),
    fuseLaneGame.view(decoded.state),
  );
  const flipped = complete.bytes.slice();
  const at = flipped.length - 3;
  flipped[at] = flipped[at]! ^ 0xff;
  assert.equal(decodeSnapshot(fuseLaneGame, flipped, 4), undefined);
});

/** Every replica holds the same state once the room settles: the same hash at a retained tick all have passed. */
function assertConverged(runtimes: TestFuseLaneRuntime[]): void {
  const newest = Math.min(
    ...runtimes.map((runtime) => runtime.roomState()!.tick),
  );
  const at = Math.floor((newest - 4) / 4) * 4;
  const hashes = runtimes.map((runtime) => runtime.hashAt(at));
  assert.ok(hashes[0], `every replica retains tick ${at}`);
  for (const hash of hashes) assert.equal(hash, hashes[0]);
}

test("three phones and a bot live two weeks over dropped, duplicated and reordered packets and agree on everything", () => {
  const random = seeded(11);
  const mesh = new FuseLaneMesh("a", FAST);
  const ids = ["a", "b", "c"];
  const runtimes = ids.map((id) => mesh.join(id));
  mesh.run(200);
  runtimes.forEach((runtime, index) =>
    runtime.command({ type: "join", name: ids[index]!.toUpperCase() }),
  );
  mesh.run(3000);
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
  // Each phone wanders: every 400 ms of its clock it walks somewhere, applies for the cook job or works, and taps
  // READY in the briefing; all three race for the same job.
  let pressed = 0;
  const last = new Map<string, number>();
  mesh.run(70_000, () => {
    for (const [index, runtime] of runtimes.entries()) {
      const id = ids[index]!,
        room = runtime.roomState();
      if (
        !room ||
        room.stage !== "running" ||
        mesh.now - (last.get(id) ?? 0) < 400
      )
        continue;
      last.set(id, mesh.now);
      const player = room.players[id];
      if (!player) continue;
      const roll = random();
      let ok: boolean;
      if (room.phase === 1) ok = runtime.play(READY, room.week);
      else if (player.inside === JOBHUB && player.job < 0)
        ok = runtime.play(ACT, room.week, JOBHUB, APPLY, COOK, 0);
      else if (player.inside === MONO && player.job === COOK)
        ok = runtime.play(ACT, room.week, MONO, WORK, 0, 0);
      else if (roll < 0.05) ok = runtime.play(END_WEEK, room.week);
      else ok = runtime.play(WALK, room.week, roll < 0.5 ? JOBHUB : MONO);
      if (ok) pressed++;
    }
  });
  mesh.fast = () => ({ delayMs: 20 });
  mesh.run(3000);
  assertConverged(runtimes);
  assert.ok(pressed > 50, `the phones pressed (${pressed})`);
  const room = runtimes[0]!.roomState()!;
  assert.ok(room.week >= 2, `weeks went by (${room.week})`);
  const cooks = Object.values(room.players).filter(
    (player) => player.job === COOK,
  );
  assert.ok(cooks.length <= 1, "one cook, however the race went");
  assert.ok(
    runtimes.some((runtime) => runtime.metrics().rollbacks > 0),
    "late packets rolled a replica back",
  );
  for (const runtime of runtimes)
    assert.deepEqual(runtime.roomState()!.players, room.players);
});

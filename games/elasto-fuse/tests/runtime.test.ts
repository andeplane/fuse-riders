import test from "node:test";
import assert from "node:assert/strict";
import type { RuntimeDependencies } from "fuse-netcode";
import {
  BRAKE,
  GAS,
  RESTART,
  STEPS_PER_TICK,
  TURN,
  VOLT_LEFT,
  VOLT_RIGHT,
  toView,
} from "../src/engine/index.js";
import { forward, forwardInputs } from "../src/app/forward.js";
import { DEFAULT_SETTINGS, hash, type Settings } from "../src/online/game.js";
import { ElastoFuseRuntime, heldBits } from "../src/online/runtime.js";
import { Mesh, type TestRuntime } from "./fixtures/mesh.js";

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
/** A link that drops a tenth of its fast packets, duplicates another tenth and delivers the rest out of order. */
function lossy(mesh: Mesh, seed: number): void {
  const random = seeded(seed);
  mesh.fast = () => {
    const roll = random();
    if (roll < 0.1) return { drop: true };
    if (roll < 0.2) return { delayMs: 20, duplicateMs: 60 };
    return { delayMs: 10 + Math.floor(random() * 70) };
  };
}
const steady = (mesh: Mesh) => {
  mesh.fast = () => ({ delayMs: 15 });
};
const MOVES = [
  0,
  GAS,
  GAS,
  GAS | VOLT_LEFT,
  GAS | VOLT_RIGHT,
  BRAKE,
  TURN | GAS,
  RESTART,
  VOLT_RIGHT,
];

/** Host and guest seated and a match started by the host. */
function race(settings: Settings = DEFAULT_SETTINGS): {
  mesh: Mesh;
  host: TestRuntime;
  guest: TestRuntime;
} {
  const mesh = new Mesh("host", settings);
  const host = mesh.join("host"),
    guest = mesh.join("guest");
  mesh.run(300);
  host.command({ type: "join", name: "Host" });
  guest.command({ type: "join", name: "Guest" });
  mesh.run(3_000);
  assert.equal(host.roomState()!.seats.size, 2);
  assert.ok(host.command({ type: "action", action: "start" }));
  return { mesh, host, guest };
}

test("solo is one rider on the chosen level, never a shared screen", () => {
  const dependencies: RuntimeDependencies = {
    now: () => 0,
    hidden: () => false,
    token: () => "match",
    generation: () => 1,
    schedule: () => () => {},
    onVisibilityChange: () => () => {},
  };
  const runtime = new ElastoFuseRuntime(
    "SOLO",
    { ...DEFAULT_SETTINGS, display: true, level: 4 },
    { state: () => {}, event: () => {}, status: () => {}, ready: () => {} },
    { humanName: "Ada", humanAvatar: "fox", dependencies },
  );
  runtime.start();
  const room = runtime.roomState()!;
  assert.equal(runtime.self, "solo");
  assert.equal(room.stage, "running");
  assert.deepEqual(
    room.roster.map((entrant) => [entrant.id, entrant.name, entrant.bot]),
    [["solo", "Ada", false]],
  );
  assert.equal(room.world?.level, 4);
  assert.equal(room.settings.display, false);
  runtime.input(GAS | TURN | 64);
  assert.equal(runtime.heldNow, GAS | TURN);
  runtime.stop();
  assert.equal(heldBits(64 | BRAKE), BRAKE);
});

test("two devices race over a mesh that drops, duplicates and reorders, and agree on every bike", () => {
  const { mesh, host, guest } = race();
  lossy(mesh, 4);
  const random = seeded(11);
  let t = 0,
    heardGuest = false,
    heardHost = false;
  mesh.run(14_000, () => {
    t++;
    if (t % 7 === 0) host.input(MOVES[Math.floor(random() * MOVES.length)]!);
    if (t % 11 === 0) guest.input(MOVES[Math.floor(random() * MOVES.length)]!);
    heardGuest ||= (host.roomState()!.held.guest ?? 0) !== 0;
    heardHost ||= (guest.roomState()!.held.host ?? 0) !== 0;
  });
  assert.ok(
    heardGuest && heardHost,
    "each replica folded the other's controls",
  );
  host.input(0);
  guest.input(0);
  steady(mesh);
  mesh.run(2_000);
  assert.ok(mesh.align());
  const a = host.roomState()!,
    b = guest.roomState()!;
  assert.ok(Math.min(host.confirmedTick(), guest.confirmedTick()) > 0);
  assert.equal(a.tick, b.tick);
  assert.equal(hash(a), hash(b), "identical world hashes");
  assert.deepEqual(a.world, b.world);
  assert.ok(
    a.world!.riders.every((rider) => rider.run > 0 || rider.deaths > 0),
    "and the bikes were ridden",
  );
  assert.equal(host.metrics().mismatches, 0);
  assert.equal(guest.metrics().mismatches, 0);
  assert.ok(
    guest.frameTiming()?.newer.world,
    "the screen gets frames with the world",
  );
});

test("a device that joins mid-race recovers the world from a peer and watches on in step", () => {
  const { mesh, host, guest } = race();
  let t = 0;
  mesh.run(6_000, () => {
    if (++t % 20 === 0) guest.input(t % 40 === 0 ? GAS | VOLT_RIGHT : GAS);
  });
  const late = mesh.join("late");
  mesh.run(3_000);
  assert.ok(late.command({ type: "spectate", name: "Late" }));
  mesh.run(2_000);
  guest.input(0);
  mesh.run(1_000);
  assert.ok(mesh.align());
  const room = late.roomState()!;
  assert.ok(room.world, "the late device has the race");
  assert.equal(room.seats.get("late")?.watcher, true);
  assert.deepEqual(
    room.world.riders.map((rider) => rider.id),
    ["host", "guest"],
  );
  assert.equal(hash(room), hash(host.roomState()!));
  assert.equal(hash(room), hash(guest.roomState()!));
  late.input(GAS);
  mesh.run(500);
  assert.equal(
    host.roomState()!.held.late,
    undefined,
    "a watcher steers nobody",
  );
});

test("a key acts on the step it goes down, and the picture drawn ahead is the bike the room then computes", () => {
  let now = 0,
    pass: (() => void) | undefined;
  const dependencies: RuntimeDependencies = {
    now: () => now,
    hidden: () => false,
    token: () => "match",
    generation: () => 1,
    schedule: (callback) => {
      pass = callback;
      return () => {};
    },
    onVisibilityChange: () => () => {},
  };
  const runtime = new ElastoFuseRuntime(
    "SOLO",
    { ...DEFAULT_SETTINGS, count: 1 },
    { state: () => {}, event: () => {}, status: () => {}, ready: () => {} },
    { humanName: "Ada", humanAvatar: "fox", dependencies },
  );
  runtime.start();
  const wait = (ms: number) => {
    for (let t = 0; t < ms; t += 5) {
      now += 5;
      pass?.();
    }
  };
  while (runtime.roomState()!.world!.phase === "countdown") wait(50);
  // Onto a tick boundary, then most of the way through the tick: the key goes down on its third step.
  const tick = runtime.roomState()!.tick;
  while (runtime.roomState()!.tick === tick) wait(5);
  wait(30);
  const before = runtime.roomState()!.tick;
  const drawn = (steps: number, own: (step: number) => number) =>
    forward(
      runtime.roomState()!.world!,
      steps,
      forwardInputs(runtime.roomState()!, "solo", own),
    );
  const logged = (step: number) => runtime.heldAhead(step);
  const idle = drawn(STEPS_PER_TICK, () => 0);
  runtime.input(GAS);
  assert.equal(runtime.heldAhead(0), 0, "not before it was pressed");
  assert.equal(runtime.heldAhead(1), 0);
  assert.equal(runtime.heldAhead(2), GAS, "from the step it went down");
  assert.equal(runtime.heldAhead(STEPS_PER_TICK + 1), GAS);
  assert.deepEqual(
    drawn(2, logged),
    drawn(2, () => 0),
  );
  const ahead = drawn(STEPS_PER_TICK, logged);
  assert.notDeepEqual(ahead, idle);
  while (runtime.roomState()!.tick === before) wait(5);
  assert.deepEqual(toView(runtime.roomState()!.world!), ahead);
  runtime.stop();
});

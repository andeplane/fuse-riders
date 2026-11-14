import test from "node:test";
import assert from "node:assert/strict";
import type { RuntimeDependencies } from "fuse-netcode";
import { DUCK, JUMP, botInput, planInput } from "../src/engine/index.js";
import {
  DEFAULT_SETTINGS,
  createFuseSurgeGame,
  hash,
  type Settings,
} from "../src/online/game.js";
import { FuseSurgeRuntime, heldBits } from "../src/online/runtime.js";
import { matchResult } from "../src/online/result.js";
import { dueReports } from "../src/app/reports.js";
import { Mesh, steadyBot, type TestRuntime } from "./fixtures/mesh.js";

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
const MOVES = [0, JUMP, DUCK, JUMP | DUCK, JUMP, 0];
const QUICK: Settings = { ...DEFAULT_SETTINGS, target: 1, seconds: 20 };

/** Host and guest seated and a match started by the host. */
function duel(
  settings: Settings = DEFAULT_SETTINGS,
  game = createFuseSurgeGame(),
): { mesh: Mesh; host: TestRuntime; guest: TestRuntime } {
  const mesh = new Mesh("host", settings, game);
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

/** Both devices play through their own held controls (the host soundly, the guest as an easy bot) until the match is over. */
function playOut(mesh: Mesh, host: TestRuntime, guest: TestRuntime): void {
  for (let i = 0; i < 6_000 && host.roomState()!.stage !== "over"; i++)
    mesh.run(50, () => {
      for (const device of [host, guest]) {
        const room = device.roomState();
        const slot = room?.world?.riders.findIndex(
          (rider) => rider.id === device.self,
        );
        if (room?.world && slot !== undefined && slot >= 0)
          device.input(
            device === host
              ? planInput(room.world, slot)
              : botInput(room.world, slot, 0),
          );
      }
    });
  host.input(0);
  guest.input(0);
  assert.equal(host.roomState()!.stage, "over", "the match was played out");
}

test("solo is one player against three bots with the chosen settings, never a shared screen", () => {
  const dependencies: RuntimeDependencies = {
    now: () => 0,
    hidden: () => false,
    token: () => "match",
    generation: () => 1,
    schedule: () => () => {},
    onVisibilityChange: () => () => {},
  };
  const runtime = new FuseSurgeRuntime(
    "SOLO",
    { ...DEFAULT_SETTINGS, display: true, hits: 4, seconds: 90 },
    { state: () => {}, event: () => {}, status: () => {}, ready: () => {} },
    { humanName: "Ada", humanAvatar: "fox", dependencies },
  );
  runtime.start();
  const room = runtime.roomState()!;
  assert.equal(runtime.self, "solo");
  assert.equal(room.stage, "running");
  assert.deepEqual(
    room.roster.map((entrant) => [entrant.id, entrant.name, entrant.bot]),
    [
      ["solo", "Ada", false],
      ["bot:1", "Amp", true],
      ["bot:2", "Ohm", true],
      ["bot:3", "Watt", true],
    ],
  );
  assert.equal(room.world?.rules.hits, 4);
  assert.equal(room.world?.rules.seconds, 90);
  assert.equal(room.settings.display, false);
  runtime.input(JUMP | 64);
  assert.equal(runtime.heldNow, JUMP);
  runtime.stop();
  assert.equal(heldBits(8 | DUCK), DUCK);
});

test("two devices play over a mesh that drops, duplicates and reorders, and agree on the world", () => {
  const { mesh, host, guest } = duel();
  lossy(mesh, 4);
  const random = seeded(11);
  let t = 0,
    heardGuest = false,
    heardHost = false;
  mesh.run(10_000, () => {
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
    a.world!.riders.some((rider) => rider.dodges + rider.taken > 0),
    "and surges reached the riders",
  );
  assert.equal(host.metrics().mismatches, 0);
  assert.equal(guest.metrics().mismatches, 0);
  const timing = guest.frameTiming();
  assert.ok(timing?.newer.world, "the screen gets frames with the world");
});

test("a device that joins mid-match recovers the world from a peer and watches on in step", () => {
  const { mesh, host, guest } = duel();
  let t = 0;
  mesh.run(3_000, () => {
    if (++t % 20 === 0) guest.input(t % 40 === 0 ? JUMP : DUCK);
  });
  const late = mesh.join("late");
  mesh.run(3_000);
  assert.ok(late.command({ type: "spectate", name: "Late" }));
  mesh.run(2_000);
  guest.input(0);
  mesh.run(1_000);
  assert.ok(mesh.align());
  const room = late.roomState()!;
  assert.ok(room.world, "the late device has the match");
  assert.equal(room.seats.get("late")?.watcher, true);
  assert.deepEqual(
    room.world.riders.map((rider) => rider.id),
    ["host", "guest"],
  );
  assert.equal(hash(room), hash(host.roomState()!));
  assert.equal(hash(room), hash(guest.roomState()!));
  late.input(JUMP);
  mesh.run(500);
  assert.equal(
    host.roomState()!.held.late,
    undefined,
    "a watcher steers nobody",
  );
});

test("a played-out match is decided the same everywhere, reported once, and a rematch logs held keys again", () => {
  const { mesh, host, guest } = duel(QUICK);
  guest.input(DUCK);
  mesh.run(400);
  assert.equal(host.roomState()!.held.guest, DUCK);
  // A resync forgets what was logged, not the keys still down.
  guest.resync();
  guest.flush();
  mesh.run(200);
  assert.equal(host.roomState()!.held.guest, DUCK);
  playOut(mesh, host, guest);
  guest.input(DUCK);
  mesh.run(1_500);
  assert.ok(mesh.align());
  const over = host.roomState()!;
  assert.ok(over.decided!.winners.includes("host"), "sound play won or drew");
  assert.equal(over.world!.riders[0]!.wins, 1);
  assert.equal(hash(guest.roomState()!), hash(over));
  assert.equal(over.held.guest, undefined, "nothing is held once it is over");
  const sent = new Set<string>();
  const fromHost = dueReports(over, host.self, host.confirmedTick(), sent),
    fromGuest = dueReports(
      guest.roomState()!,
      guest.self,
      guest.confirmedTick(),
      sent,
    );
  assert.deepEqual(
    fromHost.map((report) => report.path),
    ["round-results", "results"],
  );
  assert.deepEqual(fromGuest, fromHost);
  assert.deepEqual(fromHost[1]!.result, matchResult(over));
  for (const report of fromHost) sent.add(report.key);
  assert.deepEqual(dueReports(over, "host", host.confirmedTick(), sent), []);
  assert.deepEqual(
    dueReports(over, "late", host.confirmedTick(), new Set()),
    [],
    "a device that did not finish it owes nothing",
  );
  assert.deepEqual(
    dueReports(over, "bot:1", host.confirmedTick(), new Set()),
    [],
  );
  assert.deepEqual(dueReports(over, "", host.confirmedTick(), new Set()), []);
  assert.deepEqual(
    dueReports(over, "host", over.decided!.clock - 1, new Set()),
    [],
    "not before the deciding tick is confirmed",
  );
  const finished = over.matchId;
  assert.ok(!guest.command({ type: "action", action: "rematch" }), "host only");
  assert.ok(
    host.command({
      type: "settings",
      settings: { ...QUICK, hits: 5, pace: 0 },
    }),
  );
  assert.ok(host.command({ type: "action", action: "rematch" }));
  mesh.run(1_000);
  assert.ok(mesh.align());
  const again = guest.roomState()!;
  assert.equal(again.stage, "running");
  assert.notEqual(again.matchId, finished);
  assert.equal(again.world!.rules.hits, 5);
  assert.equal(again.world!.rules.pace, 0);
  assert.equal(again.world!.round, 1);
  assert.equal(host.roomState()!.held.guest, DUCK, "logged again, unasked");
  assert.equal(hash(host.roomState()!), hash(again));
});

test("unknown settings are refused, and a bot seat plays through the injected bot on every device", () => {
  const mesh = new Mesh(
    "host",
    { ...QUICK, hits: 2 },
    createFuseSurgeGame(steadyBot),
  );
  const host = mesh.join("host"),
    guest = mesh.join("guest");
  mesh.run(300);
  host.command({ type: "join", name: "Host" });
  mesh.run(800);
  const unknown: unknown = { ...QUICK, pace: 9 };
  assert.ok(!host.command({ type: "settings", settings: unknown as Settings }));
  assert.ok(!host.command({ type: "action", action: "start" }), "one rider");
  assert.ok(host.command({ type: "bot", action: "add" }));
  mesh.run(300);
  assert.ok(host.command({ type: "action", action: "start" }));
  lossy(mesh, 9);
  for (let i = 0; i < 1_500 && host.roomState()!.stage !== "over"; i++)
    mesh.run(100);
  steady(mesh);
  mesh.run(2_000);
  assert.ok(mesh.align());
  const room = host.roomState()!;
  assert.equal(room.stage, "over", "the bot outlasted a host who never moved");
  assert.deepEqual(room.decided?.winners, ["bot:1"]);
  assert.ok(room.world!.riders[1]!.dodges > 0, "the bot played");
  assert.deepEqual(room.decided?.finishers, ["host"]);
  assert.equal(hash(guest.roomState()!), hash(room), "the onlooker agrees");
});

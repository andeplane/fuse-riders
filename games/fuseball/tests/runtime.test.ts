import test from "node:test";
import assert from "node:assert/strict";
import type { RuntimeDependencies } from "fuse-netcode";
import { BTN, LEFT, RIGHT, TARGET, UP, DOWN } from "../src/engine/index.js";
import {
  DEFAULT_SETTINGS,
  createFuseballGame,
  hash,
  settingsFor,
  type Settings,
} from "../src/online/game.js";
import { FuseballRuntime, stickBits } from "../src/online/runtime.js";
import { matchResult } from "../src/online/result.js";
import { dueReports } from "../src/app/reports.js";
import { Mesh, chase, chaserBot, type TestRuntime } from "./fixtures/mesh.js";

const DOWNLINK: Settings = {
  display: false,
  mapId: "downlink",
  seed: 0,
  size: 1,
};

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
const STICK = [0, LEFT, RIGHT, UP, DOWN, LEFT | UP, RIGHT | DOWN];

/** Host and guest seated and a match started by the host. */
function duel(
  settings: Settings = DEFAULT_SETTINGS,
  game = createFuseballGame(),
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
/** Plays `host` as the chaser until the match is over; `each` runs every 10 ms beside it. */
function playOut(mesh: Mesh, host: TestRuntime, each: () => void = () => {}) {
  let t = 0;
  for (let i = 0; i < 1_500 && host.roomState()!.stage !== "over"; i++)
    mesh.run(100, () => {
      const world = mesh.frames.get("host")!.at(-1)?.world;
      const slot = world?.riders.findIndex((rider) => rider.id === "host");
      if (world && ++t % 5 === 0 && (slot === 0 || slot === 1))
        host.input(chase(world, slot, t / 5));
      each();
    });
  host.input(0);
  assert.equal(host.roomState()!.stage, "over", "the chaser won a match");
}

test("solo is one rider against one bot, on the chosen map, never a shared screen", () => {
  const dependencies: RuntimeDependencies = {
    now: () => 0,
    hidden: () => false,
    token: () => "match",
    generation: () => 1,
    schedule: () => () => {},
    onVisibilityChange: () => () => {},
  };
  const runtime = new FuseballRuntime(
    "SOLO",
    { display: true, mapId: "halo", seed: 0, size: 1 },
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
      ["bot:1", "Volta", true],
    ],
  );
  assert.equal(room.seats.get("solo")?.avatarId, "fox");
  assert.equal(room.world?.mapId, "halo");
  assert.equal(room.settings.display, false);
  runtime.stop();
  // The stick a device reports is always one a stick can give.
  assert.equal(stickBits(LEFT | RIGHT | BTN), BTN);
  assert.equal(stickBits(UP | DOWN | LEFT), LEFT);
  assert.equal(stickBits(64 | RIGHT), RIGHT);
});

test("two devices play over a mesh that drops, duplicates and reorders, and agree on the world", () => {
  const { mesh, host, guest } = duel();
  lossy(mesh, 4);
  mesh.run(3_200);
  assert.equal(guest.roomState()!.world!.phase, "play");
  // Both mash their sticks and buttons on their own schedules; each replica has to hear the other.
  const random = seeded(11);
  let t = 0,
    heardGuest = false,
    heardHost = false;
  mesh.run(8_000, () => {
    t++;
    if (t % 7 === 0)
      host.input(STICK[Math.floor(random() * 7)]! | (random() < 0.5 ? BTN : 0));
    if (t % 11 === 0)
      guest.input(
        STICK[Math.floor(random() * 7)]! | (random() < 0.5 ? BTN : 0),
      );
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
    a.world!.riders.some((rider) => rider.jumps > 0),
    "and something happened in it",
  );
  assert.equal(a.held.host, undefined);
  assert.equal(host.metrics().mismatches, 0);
  assert.equal(guest.metrics().mismatches, 0);
  const frame = mesh.frames.get("guest")!.at(-1)!;
  assert.ok(frame.world, "the screen gets frames with the world");
  assert.equal(frame.tick, b.simulationTick);
  const timing = guest.frameTiming();
  assert.ok(timing?.newer.world && timing.older?.world, "two frames to blend");
});

test("a generated level converges after lossy controls and a late join recovers its seed", () => {
  const { mesh, host, guest } = duel({
    display: false,
    mapId: "random",
    seed: 0xffffffff,
    size: 1,
  });
  lossy(mesh, 37);
  mesh.run(3_500);
  let n = 0;
  mesh.run(4_000, () => {
    if (++n % 11 === 0) host.input(n % 22 ? LEFT | BTN : RIGHT);
    if (n % 17 === 0) guest.input(n % 34 ? RIGHT | BTN : LEFT);
  });
  host.input(0);
  guest.input(0);
  steady(mesh);
  const late = mesh.join("late");
  mesh.run(3_000);
  assert.ok(late.command({ type: "spectate", name: "Late" }));
  mesh.run(2_000);
  assert.ok(mesh.align());
  for (const runtime of [host, guest, late]) {
    assert.equal(runtime.roomState()!.world!.mapId, "random");
    assert.equal(runtime.roomState()!.world!.seed, 0xffffffff);
    assert.equal(hash(runtime.roomState()!), hash(host.roomState()!));
    assert.equal(runtime.metrics().mismatches, 0);
  }
});

test("a device that joins mid-match recovers the world from a peer and watches on in step", () => {
  const { mesh, host, guest } = duel();
  mesh.run(3_500);
  let t = 0;
  mesh.run(2_000, () => {
    if (++t % 20 === 0) guest.input(t % 40 === 0 ? LEFT | BTN : LEFT);
  });
  assert.equal(host.roomState()!.world!.phase, "play");
  const late = mesh.join("late");
  mesh.run(3_000);
  assert.ok(late.command({ type: "spectate", name: "Late" }));
  mesh.run(2_000);
  guest.input(0);
  mesh.run(1_000);
  assert.ok(mesh.align());
  const room = late.roomState()!;
  assert.ok(room.world, "the late device has the match");
  assert.equal(room.seats.get("late")?.watcher, true, "and a place to watch");
  assert.deepEqual(
    room.world.riders.map((rider) => rider.id),
    ["host", "guest"],
  );
  assert.equal(room.tick, host.roomState()!.tick);
  assert.equal(hash(room), hash(host.roomState()!));
  assert.equal(hash(room), hash(guest.roomState()!));
  // A watcher's stick steers nobody.
  late.input(RIGHT);
  mesh.run(500);
  assert.equal(host.roomState()!.held.late, undefined);
});

test("held controls are logged when play needs them, after a resync, and again in a rematch", () => {
  const { mesh, host, guest } = duel(DOWNLINK);
  guest.input(BTN);
  mesh.run(400);
  assert.equal(host.roomState()!.held.guest, BTN, "held from the countdown on");
  // A resync forgets what was logged, not the keys still down: the held button is logged again.
  guest.resync();
  guest.flush();
  mesh.run(200);
  assert.equal(host.roomState()!.held.guest, BTN);
  guest.input(0);
  mesh.run(200);
  assert.equal(host.roomState()!.held.guest, undefined);
  // The guest keeps tapping at home while the host chases the ball into its pit three times.
  let t = 0;
  playOut(mesh, host, () => {
    if (++t % 30 === 0) guest.input(t % 60 === 0 ? BTN : 0);
  });
  guest.input(LEFT);
  mesh.run(1_500);
  assert.ok(mesh.align());
  const over = host.roomState()!;
  // Own goals count, so either rider may have won; the board says who.
  const winner = over.roster.find((each) => each.id === over.decided?.winner);
  assert.ok(winner, "one of the two riders won");
  assert.equal(over.world!.score[winner.slot], TARGET);
  assert.equal(hash(guest.roomState()!), hash(over));
  assert.equal(over.held.guest, undefined, "nothing is held once it is over");
  // Both devices owe the same receipts once the deciding tick is confirmed, and none twice.
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
  assert.equal(fromHost[0]!.result.round, 1);
  for (const report of fromHost) sent.add(report.key);
  assert.deepEqual(dueReports(over, "host", host.confirmedTick(), sent), []);
  assert.deepEqual(
    dueReports(over, "host", over.decided!.clock - 1, new Set()),
    [],
  );
  assert.deepEqual(
    dueReports(over, "late", host.confirmedTick(), new Set()),
    [],
  );
  assert.deepEqual(
    dueReports(over, "bot:1", host.confirmedTick(), new Set()),
    [],
  );
  const finished = over.matchId;
  // The host picks another map and asks for a rematch; the guest's held stick is logged for the new match.
  assert.ok(!guest.command({ type: "action", action: "rematch" }), "host only");
  assert.ok(
    host.command({
      type: "settings",
      settings: { display: false, mapId: "halo", seed: 0, size: 1 },
    }),
  );
  assert.ok(host.command({ type: "action", action: "rematch" }));
  mesh.run(1_000);
  assert.ok(mesh.align());
  const again = guest.roomState()!;
  assert.equal(again.stage, "running");
  assert.notEqual(again.matchId, finished);
  assert.equal(again.world!.mapId, "halo");
  assert.deepEqual(again.world!.score, [0, 0]);
  assert.equal(host.roomState()!.held.guest, LEFT, "logged again, unasked");
  assert.equal(hash(host.roomState()!), hash(again));
  assert.equal(
    dueReports(again, "host", host.confirmedTick(), new Set()).length,
    0,
  );
});

test("a room refuses settings it does not know, and a bot seat plays through the injected bot on every device", () => {
  const mesh = new Mesh("host", DOWNLINK, createFuseballGame(chaserBot));
  const host = mesh.join("host"),
    guest = mesh.join("guest");
  mesh.run(300);
  host.command({ type: "join", name: "Host" });
  mesh.run(800);
  const unknown: unknown = { display: false, mapId: "moon" };
  assert.ok(
    !host.command({ type: "settings", settings: unknown as Settings }),
    "a map that does not exist",
  );
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
  assert.equal(room.stage, "over");
  assert.ok(room.world!.riders[1].jumps > 0, "the bot rode");
  assert.deepEqual(room.decided?.finishers, ["host"]);
  assert.equal(hash(guest.roomState()!), hash(room), "the onlooker agrees");
  assert.equal(guest.roomState()!.seats.has("guest"), false, "it never sat");
});

test("a lobby seat is a choice: a guest joins the seat it asks for, anyone switches team, and a smaller mode keeps everyone seated", () => {
  const mesh = new Mesh("host", DEFAULT_SETTINGS, createFuseballGame());
  const host = mesh.join("host"),
    guest = mesh.join("guest");
  mesh.run(300);
  const slots = (runtime: TestRuntime) =>
    Object.fromEntries(
      [...runtime.roomState()!.seats.values()].map((seat) => [
        seat.id,
        seat.slot,
      ]),
    );
  host.command({ type: "join", name: "Host" });
  mesh.run(800);
  assert.deepEqual(slots(host), { host: 0 }, "the host's first seat");
  assert.ok(
    host.command({
      type: "settings",
      settings: settingsFor(DEFAULT_SETTINGS, 3),
    }),
  );
  mesh.run(300);
  guest.command({ type: "join", name: "Guest", slot: 4 });
  mesh.run(3_000);
  assert.deepEqual(slots(guest), { host: 0, guest: 4 });
  // The guest crosses to the other team, the host follows it to a seat of its own choosing.
  assert.ok(guest.command({ type: "join", name: "Guest", slot: 5 }));
  mesh.run(3_000);
  assert.ok(host.command({ type: "join", name: "Host", slot: 3 }));
  mesh.run(800);
  assert.deepEqual(slots(host), { host: 3, guest: 5 });
  assert.deepEqual(slots(guest), slots(host));
  // A taken seat is refused and moves nobody.
  guest.command({ type: "join", name: "Guest", slot: 3 });
  mesh.run(3_000);
  assert.deepEqual(slots(host), { host: 3, guest: 5 });
  // One a side has two seats: both are moved into them, in seat order.
  assert.ok(
    host.command({
      type: "settings",
      settings: settingsFor(DEFAULT_SETTINGS, 1),
    }),
  );
  mesh.run(800);
  assert.deepEqual(slots(host), { host: 0, guest: 1 });
  assert.deepEqual(slots(guest), slots(host));
  assert.ok(host.command({ type: "action", action: "start" }));
  mesh.run(300);
  assert.equal(guest.roomState()!.stage, "running");
});

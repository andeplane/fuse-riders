import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, UP } from "../src/engine/index.js";
import { Mesh } from "./fixtures/mesh.js";

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

test("two devices and a bot fly one round over a lossy, reordering mesh and agree on it", () => {
  const mesh = new Mesh("host", DEFAULT_SETTINGS);
  const random = seeded(4);
  mesh.fast = () => {
    const roll = random();
    if (roll < 0.1) return { drop: true };
    if (roll < 0.2) return { delayMs: 20, duplicateMs: 60 };
    return { delayMs: 10 + Math.floor(random() * 70) };
  };
  const host = mesh.join("host"),
    guest = mesh.join("guest");
  mesh.run(300);
  host.command({ type: "join", name: "Host" });
  guest.command({ type: "join", name: "Guest" });
  mesh.run(3_000);
  assert.ok(host.command({ type: "bot", action: "add" }));
  mesh.run(300);
  assert.equal(host.roomState()!.seats.size, 3);
  assert.equal(guest.roomState()!.seats.size, 3);
  assert.ok(host.command({ type: "action", action: "start" }));
  mesh.run(3_500);
  assert.equal(guest.roomState()!.stage, "running");
  assert.equal(guest.roomState()!.world!.phase, "play");
  // The guest pulses its lift; the host's replica has to hear it.
  let t = 0,
    heard = false;
  mesh.run(4_000, () => {
    if (++t % 15 === 0) guest.input(t % 30 === 0 ? UP : 0);
    heard ||= host.roomState()!.held.guest === UP;
  });
  assert.ok(heard, "the guest's lift reached the host's fold");
  guest.input(0);
  mesh.fast = () => ({ delayMs: 15 });
  mesh.run(2_000);
  assert.ok(Math.min(host.confirmedTick(), guest.confirmedTick()) > 0);
  const hostRoom = host.roomState()!,
    guestRoom = guest.roomState()!;
  assert.equal(hostRoom.tick, guestRoom.tick);
  assert.equal(
    JSON.stringify(hostRoom.world?.choppers),
    JSON.stringify(guestRoom.world?.choppers),
    "both replicas flew the same round",
  );
  assert.equal(host.self, "host");
  assert.ok(
    mesh.frames.get("guest")!.at(-1)!.world,
    "the screen gets frames with the world",
  );
});

test("a device that joins mid-round recovers the world from a peer and flies on with the room", () => {
  const mesh = new Mesh("host", DEFAULT_SETTINGS);
  const host = mesh.join("host");
  mesh.run(300);
  host.command({ type: "join", name: "Host" });
  mesh.run(500);
  host.command({ type: "bot", action: "add" });
  host.command({ type: "bot", action: "add" });
  mesh.run(300);
  host.command({ type: "action", action: "start" });
  mesh.run(4_000);
  assert.equal(host.roomState()!.world!.phase, "play");
  const late = mesh.join("late");
  mesh.run(3_000);
  late.command({ type: "join", name: "Late" });
  mesh.run(2_000);
  const room = late.roomState()!;
  assert.ok(room.world, "the late device has the round");
  assert.ok(room.seats.has("late"), "and a seat");
  assert.ok(
    !room.world.choppers.some((c) => c.id === "late"),
    "it flies from the next round",
  );
  assert.equal(room.tick, host.roomState()!.tick);
  assert.equal(
    JSON.stringify(room.world.choppers),
    JSON.stringify(host.roomState()!.world!.choppers),
  );
});

test("held controls are logged when a round begins, after a resync, and again in the next round", () => {
  const mesh = new Mesh("host", { ...DEFAULT_SETTINGS, wins: 2 });
  const host = mesh.join("host");
  mesh.run(200);
  host.command({ type: "join", name: "Host" });
  mesh.run(1_000);
  host.command({ type: "bot", action: "add" });
  mesh.run(200);
  host.input(UP);
  assert.equal(
    host.roomState()!.held.host,
    undefined,
    "nothing is logged in the lobby",
  );
  host.command({ type: "action", action: "start" });
  mesh.run(2_650);
  assert.equal(host.roomState()!.world!.phase, "play");
  assert.equal(
    host.roomState()!.held.host,
    UP,
    "the held lift reached the round once it began",
  );
  // A resync forgets what was logged, not the keys still down: the held lift is logged again.
  host.resync();
  host.flush();
  mesh.run(100);
  assert.equal(host.roomState()!.held.host, UP);
  // Still holding, the host flies into the ceiling; the bot takes the round; the next round hears the lift at once.
  let round = host.roomState()!.round;
  for (let i = 0; i < 400 && round === 1; i++) {
    mesh.run(100);
    round = host.roomState()!.round;
  }
  assert.equal(round, 2);
  mesh.run(200);
  assert.equal(host.roomState()!.held.host, UP, "logged again for round two");
  host.input(0);
  mesh.run(100);
  assert.equal(host.roomState()!.held.host, undefined);
  mesh.leave("host");
});

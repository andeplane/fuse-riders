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
  const room = () => guest.roomState()!;
  assert.equal(room().stage, "running");
  assert.equal(room().world!.phase, "play");
  // The guest pulses its lift; the host holds nothing and falls.
  let t = 0;
  mesh.run(4_000, () => {
    if (++t % 15 === 0) guest.input(t % 30 === 0 ? UP : 0);
  });
  guest.input(0);
  mesh.fast = () => ({ delayMs: 15 });
  mesh.run(2_000);
  const tick = Math.min(host.confirmedTick(), guest.confirmedTick());
  assert.ok(tick > 0);
  const hostRoom = host.roomState()!,
    guestRoom = guest.roomState()!;
  assert.equal(hostRoom.tick, guestRoom.tick);
  assert.equal(
    JSON.stringify(hostRoom.world?.choppers),
    JSON.stringify(guestRoom.world?.choppers),
    "both replicas flew the same round",
  );
  assert.equal(host.self, "host");
  const frames = mesh.frames.get("guest")!;
  assert.ok(frames.at(-1)!.world, "the screen gets frames with the world");
});

test("held controls are logged once per change, and again when a new round begins", () => {
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
  const room = host.roomState()!;
  assert.equal(room.world!.phase, "play");
  assert.equal(
    room.held.host,
    UP,
    "the held lift reached the round once it began",
  );
  host.input(0);
  mesh.run(100);
  assert.equal(host.roomState()!.held.host, undefined);
  mesh.leave("host");
});

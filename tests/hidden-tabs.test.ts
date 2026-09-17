import test from "node:test";
import assert from "node:assert/strict";
import { FakeNetwork } from "./fixtures/fake-room.js";
import { defaultRoomSettings } from "../src/shared/room-settings.js";

const settings = defaultRoomSettings();
function room() {
  const net = new FakeNetwork("host", {
    loss: 0,
    baseMs: 20,
    jitterMs: 120,
    reliableMs: 30,
    hiddenTickMs: 1000,
  });
  const host = net.add("host", settings);
  host.start();
  host.command({ type: "join", name: "Host" });
  net.step(200);
  const guest = net.add("guest", settings);
  guest.start();
  guest.command({ type: "join", name: "Guest" });
  net.step(1500);
  return { net, host, guest };
}

test("a one-Hz hidden guest does not repeatedly toggle its visible seat presence", () => {
  const { net, host, guest } = room();
  try {
    net.setHidden("guest", true);
    const presence = new Set<boolean>();
    for (let i = 0; i < 200; i++) {
      net.step(50);
      presence.add(
        net.frame("host")!.players.find((p) => p.id === "guest")!.connected,
      );
    }
    assert.equal(
      presence.size,
      1,
      "hidden presence must be stable instead of flapping between packets",
    );
  } finally {
    host.stop();
    guest.stop();
  }
});

test("a sole hidden world holder lets a new visible peer recover the room", () => {
  const { net, host, guest } = room();
  try {
    const matchId = net.frame("host")!.matchId;
    guest.stop();
    net.setHidden("host", true);
    net.step(30_000);
    const returning = net.reload("guest", settings);
    returning.command({ type: "join", name: "Guest" });
    net.step(6000);
    assert.equal(net.frame("guest")?.matchId, matchId);
    assert.equal(
      returning.metrics().snapshotRequest,
      false,
      "snapshot recovery must settle rather than loop on a frozen source",
    );
    assert.ok(
      returning.tick > 500,
      "new visible peer catches up to the running room",
    );
    returning.stop();
  } finally {
    host.stop();
    guest.stop();
  }
});

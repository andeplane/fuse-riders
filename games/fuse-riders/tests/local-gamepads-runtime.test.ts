import test from "node:test";
import assert from "node:assert/strict";
import { RoomRuntime, type RoomCommand } from "../src/online/room-runtime.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";
import { COUNTDOWN_TICKS } from "../src/engine/tuning.js";
import type { Frame } from "../src/online/fuse-game.js";
import { FakeNetwork } from "./fixtures/fake-room.js";

function local(names = ["One", "Two"]) {
  const net = new FakeNetwork("solo", {
    loss: 0,
    baseMs: 0,
    jitterMs: 0,
    reliableMs: 0,
  });
  let frame: Frame;
  const runtime = new RoomRuntime(
    "SOLO",
    { ...defaultRoomSettings(), map: "classic", length: 1 },
    {
      ready: () => {},
      status: () => {},
      event: () => {},
      state: (next) => {
        frame = next;
      },
    },
    { localPlayers: names, dependencies: net.dependencies("solo") },
  );
  runtime.start();
  return { net, runtime, frame: () => frame! };
}
const input = (
  left: boolean,
  right: boolean,
  bombAction?: "press" | "cancel" | "release",
): Extract<RoomCommand, { type: "input" }> => ({
  type: "input",
  seq: 1,
  left,
  right,
  bomb: bombAction === "press",
  bombAction,
});

test("local humans replace bots, have unique identities, and their streams never stall", () => {
  for (let count = 1; count <= 5; count++) {
    const f = local(Array.from({ length: count }, (_, i) => `Player ${i + 1}`));
    assert.equal(f.frame().players.length, 5);
    assert.equal(
      f.frame().players.filter((p) => !p.id.startsWith("bot:")).length,
      count,
    );
    assert.equal(new Set(f.frame().players.map((p) => p.color)).size, 5);
    assert.equal(f.frame().phase, "countdown");
    f.net.step(10_000);
    assert.ok(
      f.runtime.tick >= 199,
      `local streams stalled with ${count} humans`,
    );
    assert.ok(f.runtime.confirmedTick() >= 198);
    assert.equal(f.runtime.metrics().snapshotRequest, false);
    assert.equal(f.net.sentFast, 0);
    f.runtime.stop();
  }
});
test("independent steering and bomb gestures cancel for every rider when hidden", () => {
  const f = local();
  f.net.step(COUNTDOWN_TICKS * 50 + 100);
  assert.equal(f.runtime.localInput("solo", input(true, false, "press")), true);
  assert.equal(
    f.runtime.localInput("local-2", input(false, true, "press")),
    true,
  );
  assert.equal(
    f.runtime.localInput("intruder", input(true, true, "press")),
    false,
  );
  f.net.step(50);
  assert.deepEqual(f.runtime.heldControls("solo"), {
    left: true,
    right: false,
  });
  assert.deepEqual(f.runtime.heldControls("local-2"), {
    left: false,
    right: true,
  });
  for (const p of f.frame().players.slice(0, 2))
    assert.notEqual(p.bombChargeStartedTick, undefined);
  assert.equal(
    f.runtime.presentation()!.local,
    undefined,
    "all humans share the same presentation time",
  );
  f.net.setHidden("solo", true);
  const tick = f.runtime.tick;
  f.net.step(1000);
  assert.equal(f.runtime.tick, tick);
  for (const id of f.runtime.localPlayerIds) {
    assert.deepEqual(f.runtime.heldControls(id), { left: false, right: false });
    assert.equal(
      f.frame().players.find((p) => p.id === id)!.bombChargeStartedTick,
      undefined,
    );
    assert.equal(f.runtime.localInput(id, input(false, true, "press")), false);
  }
  f.net.setHidden("solo", false);
  f.net.step(100);
  assert.ok(f.runtime.tick > tick);
});
test("local log replay is repeatable and roster survives lobby and rematch", () => {
  const a = local(),
    b = local();
  for (const f of [a, b]) {
    f.net.step(COUNTDOWN_TICKS * 50 + 100);
    f.runtime.localInput("local-2", input(true, false, "press"));
    f.net.step(100);
    f.runtime.localInput("local-2", input(false, false, "release"));
    f.net.step(100);
  }
  assert.deepEqual(a.frame(), b.frame());
  const ids = a.frame().players.map((p) => p.id);
  a.runtime.command({ type: "action", action: "lobby" });
  a.net.step(100);
  assert.equal(a.frame().phase, "lobby");
  a.runtime.command({ type: "action", action: "start" });
  a.net.step(100);
  assert.deepEqual(
    a.frame().players.map((p) => p.id),
    ids,
  );
  a.net.step(60_000);
  assert.equal(a.frame().phase, "matchOver");
  assert.ok(a.runtime.confirmedTick() >= a.runtime.tick - 1);
  a.runtime.command({ type: "action", action: "rematch" });
  a.net.step(100);
  assert.equal(a.frame().phase, "countdown");
  assert.deepEqual(
    a.frame().players.map((p) => p.id),
    ids,
  );
});
test("invalid local rosters fail before startup", () => {
  for (const names of [[], [""], Array.from({ length: 6 }, () => "Rider")])
    assert.throws(() => local(names), /Local players/);
  assert.throws(
    () =>
      new RoomRuntime(
        "ROOM",
        defaultRoomSettings(),
        {
          ready: () => {},
          state: () => {},
          event: () => {},
          status: () => {},
        },
        {
          localPlayers: ["One"],
          transport: () => {
            throw new Error("must not create transport");
          },
        },
      ),
    /Local players/,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { FakeNetwork } from "./fixtures/fake-room.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";

for (const seed of [7, 20260917, 0xdeadbeef])
  test(`replicas converge after seeded loss, duplication and reordering (${seed})`, () => {
    const net = new FakeNetwork(
      "host",
      { loss: 0.2, duplicate: 0.3, baseMs: 20, jitterMs: 250, reliableMs: 40 },
      seed,
    );
    // `watcher` takes no seat: it carries no inputs through the impairment, and every replica must still fold the same
    // watching list and the same world as the riders.
    const ids = ["host", "rider", "third", "watcher"];
    const runtimes = ids.map((id) => {
      const runtime = net.add(id, defaultRoomSettings(), { humanName: id });
      runtime.start();
      runtime.command(
        id === "watcher"
          ? { type: "spectate", name: id }
          : { type: "join", name: id },
      );
      net.step(1000);
      return runtime;
    });
    try {
      assert.ok(runtimes[0]!.command({ type: "action", action: "start" }));
      let random = seed >>> 0;
      const roll = () => {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        return random;
      };
      for (let turn = 1; turn <= 180; turn++) {
        for (const runtime of runtimes) {
          const flags = roll() % 4;
          const action =
            turn % 7 === 1
              ? "press"
              : turn % 7 === 3
                ? "release"
                : turn % 7 === 5
                  ? "cancel"
                  : undefined;
          runtime.command({
            type: "input",
            seq: turn,
            left: flags === 1,
            right: flags === 2,
            bomb: action === "press",
            ...(action ? { bombAction: action } : {}),
          });
        }
        net.step(50);
      }
      assert.ok(net.droppedFast > 0);
      assert.ok(net.duplicatedFast > 0);
      assert.ok(net.reorderedFast > 0);
      assert.ok(runtimes.some((runtime) => runtime.metrics().rollbacks > 0));
      const settledAfter = Math.max(
        ...runtimes.map((runtime) => runtime.metrics().tick),
      );
      net.options = {
        loss: 0,
        duplicate: 0,
        baseMs: 20,
        jitterMs: 0,
        reliableMs: 40,
      };
      net.step(5000);
      // Observe each replica's emitted full-state hash, not private fields or just its rendered snapshot.
      const commonTicks = [
        ...(net.reportedHashes.get("host")?.keys() ?? []),
      ].filter(
        (tick) =>
          tick > settledAfter &&
          ids.every((id) => net.reportedHashes.get(id)?.has(tick)),
      );
      assert.ok(
        commonTicks.length >= 3,
        "multiple shared confirmed ticks after repair",
      );
      for (const tick of commonTicks)
        assert.equal(
          new Set(ids.map((id) => net.reportedHashes.get(id)!.get(tick))).size,
          1,
          `replicas disagree at ${tick}`,
        );
      for (const runtime of runtimes) {
        assert.ok(
          Object.values(runtime.metrics().streams).every(
            (stream) => !stream.gap,
          ),
        );
        assert.equal(runtime.metrics().snapshotRequest, false);
      }
      for (const id of ids)
        assert.deepEqual(
          net.frame(id)?.spectators.map((seat) => [seat.name, seat.connected]),
          [["watcher", true]],
          `${id} agrees on the watching list`,
        );
    } finally {
      for (const runtime of runtimes) runtime.stop();
    }
  });

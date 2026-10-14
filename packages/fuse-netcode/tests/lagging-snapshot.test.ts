import test from "node:test";
import assert from "node:assert/strict";
import { FakeMesh } from "./fixtures/fake-mesh.js";
import { SnapshotAssembler, decodeSnapshot } from "../src/index.js";
import { counterGame } from "./fixtures/counter-game.js";

test("a slightly newer valid snapshot grants local catch-up while the whole room remains behind", () => {
  const mesh = new FakeMesh("a", { target: 1000 });
  const a = mesh.join("a"),
    b = mesh.join("b");
  try {
    mesh.run(200);
    a.command({ type: "join", name: "Alpha" });
    b.command({ type: "join", name: "Beta" });
    mesh.run(3000);
    a.command({ type: "action", action: "start" });
    mesh.run(300);
    mesh.setHidden("b", true);
    mesh.run(1000);
    const held = b.roomState()!.tick;
    assert.ok(a.roomState()!.tick > held);
    let offeredTick: number | undefined;
    let assembler: SnapshotAssembler | undefined;
    mesh.snapshot = (chunk, to) => {
      if (to === "b") {
        offeredTick = chunk.tick;
        assembler ??= new SnapshotAssembler(counterGame, chunk.room);
        const complete = assembler.accept(chunk);
        if (complete)
          assert.ok(
            decodeSnapshot(counterGame, complete.bytes, chunk.room),
            "the selected peer's real checkpoint validates before admission",
          );
      }
    };
    mesh.elapseWithoutLoops(30_000);
    mesh.setHidden("b", false);
    b.requestSnapshot("a");
    let installed = false;
    for (let pass = 0; pass < 30; pass++) {
      mesh.run(10);
      if (
        offeredTick !== undefined &&
        offeredTick > held &&
        b.roomState()!.tick >= offeredTick
      ) {
        installed = true;
        assert.ok(
          b.metrics().clockTick - b.roomState()!.tick > 200,
          "the newer checkpoint is still far behind the log clock",
        );
        assert.equal(
          b.sync.mayFetchBacklog(mesh.now),
          false,
          "give the local step budget time to advance instead of immediately fetching again",
        );
        break;
      }
    }
    assert.equal(
      installed,
      true,
      "the real selected peer supplied a valid newer snapshot",
    );
    const recovered = b.roomState()!.tick;
    mesh.run(2000);
    assert.ok(
      b.roomState()!.tick > recovered + 100,
      "bounded local passes make forward progress after the marginal resync",
    );
    assert.ok(a.add(4));
    mesh.run(1000);
    assert.equal(a.roomState()!.totals.a, 4);
    assert.equal(b.roomState()!.totals.a, 4);
    const tick =
      Math.floor((Math.min(a.roomState()!.tick, b.roomState()!.tick) - 4) / 4) *
      4;
    assert.ok(a.hashAt(tick));
    assert.equal(a.hashAt(tick), b.hashAt(tick));
  } finally {
    a.stop();
    b.stop();
  }
});

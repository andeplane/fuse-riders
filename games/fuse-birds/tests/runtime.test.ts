import { test } from "node:test";
import assert from "node:assert/strict";
import { BirdsMesh, type TestBirdsRuntime } from "./fixtures/mesh.js";

function converge(a: TestBirdsRuntime, b: TestBirdsRuntime): void {
  const tick = Math.floor((Math.min(a.tick, b.tick) - 4) / 4) * 4;
  assert.ok(tick > 0);
  assert.ok(a.hashAt(tick));
  assert.equal(a.hashAt(tick), b.hashAt(tick));
}
test("a returning page refuses its connected old-generation seat until automatic admission, then applies play", () => {
  const mesh = new BirdsMesh("b");
  const b = mesh.join("b");
  let a = mesh.join("a", 1);
  try {
    mesh.run(200);
    b.command({ type: "join", name: "Beta" });
    a.command({ type: "join", name: "Alpha" });
    mesh.run(3000);
    b.command({ type: "action", action: "start" });
    mesh.run(4000);
    mesh.setHidden("a", true);
    mesh.run(300);
    assert.equal(a.admitted, false, "an away seat cannot submit ordinary play");
    assert.equal(a.play({ type: "pass" }), false);
    mesh.setHidden("a", false);
    mesh.run(1000);
    assert.equal(a.admitted, true);
    assert.equal(b.play({ type: "pass" }), true);
    mesh.run(1000);
    assert.equal(a.admitted, true);
    a.stop();
    a = mesh.join("a", 2);
    let observedOldSeat = false;
    for (let wait = 0; wait < 500; wait++) {
      mesh.run(10);
      const seat = a.roomState()?.seats.get("a");
      if (seat?.connected && seat.generation === 1) {
        observedOldSeat = true;
        assert.equal(a.admitted, false);
        assert.equal(a.play({ type: "pass" }), false);
        break;
      }
    }
    assert.equal(
      observedOldSeat,
      true,
      "a real recovered checkpoint still owns the previous generation",
    );
    for (let wait = 0; wait < 500 && !a.admitted; wait++) mesh.run(10);
    assert.equal(a.roomState()?.seats.get("a")?.generation, 2);
    assert.equal(
      a.admitted,
      true,
      "normal PRESENCE admission needs no rejected play to recover",
    );
    const turn = a.roomState()!.match!.turn;
    assert.equal(a.play({ type: "pass" }), true);
    mesh.run(1000);
    assert.ok(a.roomState()!.match!.turn > turn);
    assert.equal(b.roomState()!.match!.turn, a.roomState()!.match!.turn);
    converge(a, b);
  } finally {
    for (const runtime of mesh.runtimes.values()) runtime.stop();
  }
});
test("rapid alternating passes remain actionable through crate drops and sudden death", () => {
  const mesh = new BirdsMesh("a"),
    a = mesh.join("a"),
    b = mesh.join("b");
  try {
    mesh.run(200);
    a.command({ type: "join", name: "Alpha" });
    b.command({ type: "join", name: "Beta" });
    mesh.run(3000);
    a.command({ type: "action", action: "start" });
    mesh.run(4000);
    for (let attempts = 0; attempts < 100; attempts++) {
      const match = a.roomState()!.match!;
      if (match.phase === "over") break;
      assert.equal(match.phase, "aiming");
      assert.equal(b.roomState()!.match!.turn, match.turn);
      const turn = match.turn;
      const runtime = match.players[match.active]!.id === "a" ? a : b;
      assert.equal(runtime.play({ type: "pass" }), true);
      // Act again as soon as both peers expose the new turn, including a predicted tick.
      for (let wait = 0; wait < 500; wait++) {
        mesh.run(10);
        const next = a.roomState()!.match!,
          peer = b.roomState()!.match!;
        if (
          next.phase === "over" ||
          (next.turn > turn &&
            next.phase === "aiming" &&
            peer.turn === next.turn &&
            peer.phase === "aiming")
        )
          break;
      }
      assert.ok(
        a.roomState()!.match!.turn > turn ||
          a.roomState()!.match!.phase === "over",
        `Pass ${turn} was applied`,
      );
      converge(a, b);
    }
    assert.equal(a.roomState()!.match!.phase, "over");
  } finally {
    for (const runtime of mesh.runtimes.values()) runtime.stop();
  }
});
test("real runtime scopes a Scatter launch, repairs reordered input, and recovers a late display", () => {
  const mesh = new BirdsMesh("a"),
    a = mesh.join("a"),
    b = mesh.join("b");
  try {
    assert.equal(a.play({ type: "pass" }), false);
    mesh.run(200);
    a.command({ type: "join", name: "Alpha" });
    b.command({ type: "join", name: "Beta" });
    mesh.run(3000);
    assert.equal(a.self, "a");
    assert.equal(b.command({ type: "action", action: "start" }), false);
    assert.equal(a.command({ type: "action", action: "start" }), true);
    for (
      let i = 0;
      i < 1000 &&
      (a.roomState()?.match?.phase !== "aiming" ||
        b.roomState()?.match?.phase !== "aiming");
      i++
    )
      mesh.run(10);
    assert.equal(a.roomState()?.match?.phase, "aiming");
    converge(a, b);
    assert.equal(b.play({ type: "pass" }), false);
    assert.equal(
      a.play({ type: "launch", weapon: "scatter", vx: 1, vy: NaN }),
      false,
    );
    mesh.fast = (_from, _to, sent) =>
      sent % 3 === 0
        ? { drop: true }
        : { delayMs: sent % 2 ? 90 : 10, duplicateMs: 120 };
    const state = a.roomState()!.match!,
      w = state.preparation.witnesses.find(
        (w) => w.from === "a" && w.wind === state.wind,
      )!;
    assert.equal(
      a.play({ type: "launch", weapon: "scatter", vx: w.vx, vy: w.vy }),
      true,
    );
    mesh.run(3000);
    converge(a, b);
    assert.equal(a.roomState()!.match!.players[0]!.ammo, 2);
    assert.equal(b.roomState()!.match!.players[0]!.ammo, 2);
    mesh.fast = () => ({ delayMs: 20 });
    // A raw terrain checkpoint exceeds the retry window at this rate. The normal
    // compressed terrain must arrive and converge without bypassing real chunk assembly.
    mesh.reliableBytesPerSecond = 48_000;
    const display = mesh.join("display");
    mesh.run(4000);
    assert.equal(display.admitted, false);
    assert.equal(display.play({ type: "pass" }), false);
    converge(a, display);
    assert.equal(display.roomState()!.match!.players[0]!.ammo, 2);
    assert.ok(display.roomState()!.match!.terrain.version > 0);
  } finally {
    for (const runtime of mesh.runtimes.values()) runtime.stop();
  }
});

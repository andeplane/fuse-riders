import test from "node:test";
import assert from "node:assert/strict";
import { RIGHT, LEFT, VACUUM, PULSE } from "../src/engine/world.js";
import { hash } from "../src/online/game.js";
import { Mesh } from "./fixtures/mesh.js";
function agree(mesh: Mesh, a: string, b: string): void {
  const first = mesh.frames.get(a)!,
    second = mesh.frames.get(b)!;
  const tick = Math.min(first.at(-1)!.tick, second.at(-1)!.tick);
  assert.deepEqual(
    [...first].reverse().find((f) => f.tick === tick),
    [...second].reverse().find((f) => f.tick === tick),
  );
}
test("loss, duplication, reordering, held/released input and peer recovery converge", () => {
  const m = new Mesh("host", { display: false });
  let packet = 0;
  m.fast = () => {
    const n = packet++ % 10;
    return n === 0
      ? { drop: true }
      : n === 1
        ? { delayMs: 10, duplicateMs: 70 }
        : { delayMs: 20 + (n % 3) * 30 };
  };
  const h = m.join("host"),
    g = m.join("guest");
  m.run(500);
  h.command({ type: "join", name: "Host" });
  g.command({ type: "join", name: "Guest" });
  m.run(2500);
  h.command({ type: "bot", action: "add" });
  m.run(500);
  h.readyUp();
  g.readyUp();
  m.run(2500);
  assert.equal(h.roomState()!.stage, "running");
  assert.equal(g.roomState()!.stage, "running");
  let n = 0;
  m.run(7000, () => {
    if (++n % 20 === 0)
      g.input([RIGHT | VACUUM, LEFT, 0, PULSE][(n / 20) % 4]!);
  });
  g.input(0);
  m.fast = () => ({ delayMs: 15 });
  m.run(2500);
  agree(m, "host", "guest");
  assert.equal(g.roomState()!.held.guest, 0);
  g.resync();
  g.input(VACUUM);
  m.run(500);
  assert.equal(h.roomState()!.held.guest, VACUUM);
  const late = m.join("late");
  m.run(3000);
  assert.ok(late.roomState()?.world);
  agree(m, "host", "late");
  g.stop();
  m.run(3000);
  assert.equal(h.roomState()!.seats.get("guest")!.connected, false);
  h.stop();
  late.stop();
});
test("all ready humans can rematch and recover a checkpoint after a finished round", () => {
  const m = new Mesh("host", { display: true }),
    h = m.join("host"),
    g = m.join("guest");
  m.run(500);
  h.command({ type: "join", name: "Host" });
  g.command({ type: "join", name: "Guest" });
  m.run(2000);
  h.readyUp();
  g.readyUp();
  m.run(93000);
  assert.equal(h.roomState()!.stage, "over");
  assert.equal(hash(h.roomState()!), hash(g.roomState()!));
  h.readyUp();
  m.run(500);
  assert.equal(h.roomState()!.stage, "over");
  g.readyUp();
  m.run(1000);
  assert.equal(h.roomState()!.stage, "running");
  assert.equal(h.roomState()!.world!.hunters[0]!.score, 0);
  h.stop();
  g.stop();
});

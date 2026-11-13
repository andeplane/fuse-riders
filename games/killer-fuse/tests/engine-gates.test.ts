import test from "node:test";
import assert from "node:assert/strict";
import {
  GATE_INVULN,
  GATE_STEPS,
  MAPS,
  S,
  stepRound,
  type GateKind,
} from "../src/engine/index.js";
import { gateOpenTo } from "../src/engine/gates.js";
import { bare, ofType, put, run, stand, unitOf } from "./engine-kit.js";

const MAP = MAPS[1];

function gate(
  kind: GateKind,
  side: "left" | "right" = "left",
): {
  index: number;
  x: number;
  y: number;
} {
  const index = MAP.gates.findIndex(
    (def) => def.kind === kind && (side === "left" ? def.x < 200 : def.x > 280),
  );
  const def = MAP.gates[index];
  assert.ok(def);
  return { index, x: def.x, y: def.y };
}

test("a Worker with a berry who stands in a warrior gate for the full time comes out a Warrior, invulnerable", () => {
  const state = bare();
  const at = gate("warrior");
  const worker = stand(state, 2, at.x, at.y, { carrying: true });
  const early = run(state, GATE_STEPS);
  assert.deepEqual(early, []);
  assert.equal(worker.gate, at.index);
  assert.equal(state.gates[at.index]?.user, 2);
  assert.equal(worker.kind, "worker");
  stepRound(state, []);
  assert.deepEqual(state.events, [
    { type: "gateUse", slot: 2, gate: at.index, kind: "warrior" },
  ]);
  assert.equal(worker.kind, "warrior");
  assert.equal(worker.carrying, false);
  assert.equal(worker.invuln, GATE_INVULN);
  assert.equal(worker.gate, -1);
  assert.equal(worker.gateProgress, 0);
  assert.equal(state.gates[at.index]?.user, -1);
});

test("a gate does nothing for a Worker without a berry", () => {
  const state = bare();
  const at = gate("warrior");
  const worker = stand(state, 2, at.x, at.y);
  assert.deepEqual(run(state, GATE_STEPS + 5), []);
  assert.equal(worker.gate, -1);
});

test("a speed gate makes a speed Worker once, and a speed Worker in a warrior gate becomes a speed Warrior", () => {
  const state = bare();
  const speed = gate("speed");
  const worker = stand(state, 2, speed.x, speed.y, { carrying: true });
  const events = run(state, GATE_STEPS + 1);
  assert.deepEqual(events, [
    { type: "gateUse", slot: 2, gate: speed.index, kind: "speed" },
  ]);
  assert.equal(worker.speed, true);
  assert.equal(worker.kind, "worker");
  worker.carrying = true;
  run(state, 5);
  assert.equal(worker.gate, -1);
  assert.equal(gateOpenTo(state, speed.index, worker), false);
  const warrior = gate("warrior");
  stand(state, 2, warrior.x, warrior.y, { carrying: true });
  run(state, GATE_STEPS + 1);
  assert.equal(worker.kind, "warrior");
  assert.equal(worker.speed, true);
  assert.equal(gateOpenTo(state, warrior.index, worker), false);
});

test("stepping out of a gate loses the progress", () => {
  const state = bare();
  const at = gate("warrior");
  const worker = stand(state, 2, at.x, at.y, { carrying: true });
  run(state, 60);
  assert.equal(worker.gateProgress, 59);
  worker.x += 40 * S;
  stepRound(state, []);
  assert.equal(worker.gate, -1);
  assert.equal(worker.gateProgress, 0);
  assert.equal(state.gates[at.index]?.user, -1);
});

test("one Worker uses a gate at a time; the next starts when it is free", () => {
  const state = bare();
  const at = gate("warrior");
  stand(state, 2, at.x - 2, at.y, { carrying: true });
  const second = stand(state, 4, at.x + 2, at.y, { carrying: true });
  const events = run(state, GATE_STEPS + 1);
  assert.equal(ofType(events, "gateUse").length, 1);
  assert.equal(second.kind, "worker");
  assert.equal(second.gate, -1);
  // The first one is a Warrior standing in the gate now; the second is admitted on the next step.
  stepRound(state, []);
  assert.equal(second.gate, at.index);
  const more = run(state, GATE_STEPS + 1);
  assert.deepEqual(ofType(more, "gateUse"), [
    { type: "gateUse", slot: 4, gate: at.index, kind: "warrior" },
  ]);
});

test("a Queen claims a gate by touching it: the other team is locked out, mid-use too, until its own Queen takes it back", () => {
  const state = bare();
  const at = gate("warrior");
  const worker = stand(state, 2, at.x, at.y, { carrying: true });
  run(state, 30);
  assert.equal(worker.gate, at.index);
  const queen = put(state, 1, at.x + 6, at.y);
  stepRound(state, []);
  assert.deepEqual(ofType(state.events, "gateClaim"), [
    { type: "gateClaim", slot: 1, gate: at.index, team: 1 },
  ]);
  assert.equal(state.gates[at.index]?.owner, 1);
  assert.equal(gateOpenTo(state, at.index, worker), false);
  // The Queen killed the Worker she touched; put a fresh carrier in the claimed gate.
  queen.x = 400 * S;
  const again = stand(state, 4, at.x, at.y, { carrying: true });
  const events = run(state, GATE_STEPS + 5);
  assert.deepEqual(ofType(events, "gateUse"), []);
  assert.equal(again.gate, -1);
  // An enemy Worker may use it.
  const enemy = stand(state, 3, at.x, at.y, { carrying: true });
  again.x = 300 * S;
  stepRound(state, []);
  assert.equal(enemy.gate, at.index);
  // Its own Queen touching it changes nothing; the other Queen takes it and throws the user out.
  put(state, 1, at.x, at.y - 30);
  put(state, 0, at.x - 6, at.y, { invuln: 600 });
  enemy.invuln = 600;
  unitOf(state, 1).invuln = 600;
  stepRound(state, []);
  assert.deepEqual(ofType(state.events, "gateClaim"), [
    { type: "gateClaim", slot: 0, gate: at.index, team: 0 },
  ]);
  assert.equal(enemy.gate, -1);
  assert.equal(state.gates[at.index]?.user, -1);
});

test("a Worker in a gate can be killed, which frees the gate", () => {
  const state = bare();
  const at = gate("warrior");
  const worker = stand(state, 2, at.x, at.y, { carrying: true });
  run(state, 20);
  put(state, 3, at.x + 3, at.y, { kind: "warrior" });
  stepRound(state, []);
  assert.equal(worker.dead, true);
  assert.equal(worker.gate, -1);
  assert.equal(state.gates[at.index]?.user, -1);
});

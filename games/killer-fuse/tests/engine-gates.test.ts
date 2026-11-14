import test from "node:test";
import assert from "node:assert/strict";
import {
  GATE_HALF,
  GATE_HEIGHT,
  GATE_INVULN,
  GATE_LOCK,
  GATE_OFFER,
  GATE_STEPS,
  MAPS,
  S,
  stepRound,
  viewOf,
  type GateKind,
} from "../src/engine/index.js";
import { resolveCombat } from "../src/engine/combat.js";
import { gateOpenTo } from "../src/engine/gates.js";
import {
  bare,
  controls,
  ofType,
  put,
  run,
  stand,
  unitOf,
} from "./engine-kit.js";

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

const SWING = { kind: "warrior", attack: 3, dashing: true } as const;

test("a gate takes 0.5 s of offering and 2 s locked in: the Worker comes out a Warrior on the gate's floor, invulnerable", () => {
  assert.deepEqual([GATE_OFFER, GATE_LOCK, GATE_STEPS], [30, 120, 150]);
  assert.deepEqual([GATE_HALF, GATE_HEIGHT], [8.5 * S, 26 * S]);
  const state = bare();
  const at = gate("warrior");
  const worker = stand(state, 2, at.x + 2, at.y, { carrying: true });
  stepRound(state, []);
  assert.deepEqual(state.events, [
    { type: "gateOffer", slot: 2, gate: at.index },
  ]);
  assert.equal(worker.gate, at.index);
  assert.equal(state.gates[at.index]?.user, 2);
  assert.deepEqual(run(state, GATE_OFFER - 1), []);
  assert.equal(worker.carrying, true);
  stepRound(state, []);
  assert.deepEqual(state.events, [
    { type: "gateLock", slot: 2, gate: at.index },
  ]);
  // The berry is spent the moment the gate locks.
  assert.equal(worker.carrying, false);
  assert.equal(worker.kind, "worker");
  assert.equal(viewOf(state).units[2]?.locked, true);
  assert.equal(
    viewOf(state).gates[at.index]?.progress,
    GATE_OFFER / GATE_STEPS,
  );
  assert.deepEqual(run(state, GATE_LOCK - 1), []);
  stepRound(state, []);
  assert.deepEqual(state.events, [
    {
      type: "gateUse",
      slot: 2,
      gate: at.index,
      kind: "warrior",
      x: at.x,
      y: at.y,
    },
  ]);
  assert.equal(worker.kind, "warrior");
  assert.deepEqual([worker.x, worker.y], [at.x * S, at.y * S]);
  assert.ok(worker.ground >= 0);
  assert.equal(worker.invuln, GATE_INVULN);
  assert.equal(GATE_INVULN, 132);
  assert.equal(worker.gate, -1);
  assert.equal(worker.gateProgress, 0);
  assert.equal(state.gates[at.index]?.user, -1);
});

test("a gate does nothing for a Worker without a berry, one that is moving, in the air or not wholly inside it", () => {
  const state = bare();
  const at = gate("warrior");
  const worker = stand(state, 2, at.x, at.y);
  assert.deepEqual(run(state, 5), []);
  assert.equal(worker.gate, -1);
  const edge = bare();
  stand(edge, 2, at.x + 7, at.y, { carrying: true });
  put(edge, 4, at.x, at.y - 3, { carrying: true, vy: -200 });
  stepRound(edge, []);
  assert.deepEqual(ofType(edge.events, "gateOffer"), []);
  // Walking through it is not offering.
  const walking = bare();
  stand(walking, 2, at.x - 4, at.y, { carrying: true });
  const events = run(walking, 4, () => controls({ 2: { right: true } }));
  assert.deepEqual(ofType(events, "gateOffer"), []);
});

test("a speed gate makes a speed Worker once, and a speed Worker in a warrior gate becomes a speed Warrior", () => {
  const state = bare();
  const speed = gate("speed");
  const worker = stand(state, 2, speed.x, speed.y, { carrying: true });
  const events = run(state, GATE_STEPS + 1);
  assert.deepEqual(
    events.map((event) => event.type),
    ["gateOffer", "gateLock", "gateUse"],
  );
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

test("moving during the offer cancels it and keeps the berry; once locked in, the controls do nothing", () => {
  const state = bare();
  const at = gate("warrior");
  const worker = stand(state, 2, at.x, at.y, { carrying: true });
  run(state, GATE_OFFER - 5);
  assert.equal(worker.gateProgress, GATE_OFFER - 6);
  stepRound(state, controls({ 2: { right: true } }));
  assert.equal(worker.gate, -1);
  assert.equal(worker.gateProgress, 0);
  assert.equal(worker.carrying, true);
  assert.equal(state.gates[at.index]?.user, -1);
  // Standing still again starts over.
  run(state, 3);
  const events = run(state, GATE_OFFER + 2);
  assert.equal(ofType(events, "gateLock").length, 1);
  const x = worker.x;
  const locked = run(state, 40, () =>
    controls({ 2: { left: true, pressed: true, held: true } }),
  );
  assert.deepEqual(locked, []);
  assert.equal(worker.x, x);
  assert.equal(worker.gate, at.index);
  // A jump during the offer cancels it too.
  const hop = bare();
  const jumper = stand(hop, 2, at.x, at.y, { carrying: true });
  run(hop, 10);
  run(hop, 2, () => controls({ 2: { pressed: true, held: true } }));
  assert.equal(jumper.gate, -1);
});

test("one Worker uses a gate at a time; the next starts when it is free", () => {
  const state = bare();
  const at = gate("warrior");
  stand(state, 2, at.x - 2, at.y, { carrying: true });
  const second = stand(state, 4, at.x + 2, at.y, { carrying: true });
  const events = run(state, GATE_STEPS + 1);
  assert.equal(ofType(events, "gateUse").length, 1);
  assert.equal(ofType(events, "gateOffer").length, 1);
  assert.equal(second.kind, "worker");
  assert.equal(second.gate, -1);
  // The first one is a Warrior standing in the gate now; the second is admitted on the next step.
  stepRound(state, []);
  assert.equal(second.gate, at.index);
  const more = run(state, GATE_STEPS);
  assert.deepEqual(
    ofType(more, "gateUse").map((event) => event.slot),
    [4],
  );
});

test("a Queen claims a gate by touching it, which ends her hatching invulnerability: the other team's offer is thrown out, but not a Worker already locked in", () => {
  const state = bare();
  const at = gate("warrior");
  const worker = stand(state, 2, at.x, at.y, { carrying: true });
  run(state, 10);
  assert.equal(worker.gate, at.index);
  const queen = put(state, 1, at.x + 6, at.y - 10, { invuln: 100 });
  stepRound(state, []);
  assert.deepEqual(ofType(state.events, "gateClaim"), [
    { type: "gateClaim", slot: 1, gate: at.index, team: 1 },
  ]);
  assert.equal(queen.invuln, 0);
  assert.equal(state.gates[at.index]?.owner, 1);
  assert.equal(worker.gate, -1);
  assert.equal(worker.carrying, true);
  assert.equal(gateOpenTo(state, at.index, worker), false);
  queen.x = 400 * S;
  const events = run(state, GATE_OFFER + 5);
  assert.deepEqual(ofType(events, "gateOffer"), []);
  // An enemy Worker may use it, and once it is locked in the gate changing hands does not stop it.
  worker.x = 300 * S;
  const enemy = stand(state, 3, at.x, at.y, { carrying: true });
  run(state, GATE_OFFER + 2);
  assert.equal(enemy.gateProgress > GATE_OFFER, true);
  // Its own Queen touching it changes nothing; the other Queen takes it.
  put(state, 1, at.x, at.y - 10);
  put(state, 0, at.x - 6, at.y - 10);
  stepRound(state, []);
  assert.deepEqual(ofType(state.events, "gateClaim"), [
    { type: "gateClaim", slot: 0, gate: at.index, team: 0 },
  ]);
  assert.equal(enemy.gate, at.index);
  unitOf(state, 0).dead = true;
  unitOf(state, 1).dead = true;
  const rest = run(state, GATE_LOCK);
  assert.equal(ofType(rest, "gateUse").length, 1);
  assert.equal(enemy.kind, "warrior");
});

test("a Worker offering its berry can be killed, which frees the gate; a locked-in one cannot be touched", () => {
  const state = bare();
  const at = gate("warrior");
  const worker = stand(state, 2, at.x, at.y, { carrying: true });
  run(state, 20);
  put(state, 3, at.x + 8, at.y, { ...SWING, facing: -1 });
  resolveCombat(state);
  assert.equal(worker.dead, true);
  assert.equal(worker.gate, -1);
  assert.equal(state.gates[at.index]?.user, -1);
  const safe = bare();
  const locked = stand(safe, 2, at.x, at.y, { carrying: true });
  run(safe, GATE_OFFER + 1);
  put(safe, 3, at.x + 8, at.y, { ...SWING, facing: -1 });
  safe.events = [];
  resolveCombat(safe);
  assert.equal(locked.dead, false);
  assert.deepEqual(safe.events, []);
});

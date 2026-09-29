import test from "node:test";
import assert from "node:assert/strict";
import {
  createArena,
  syncKeepers,
  stepArena,
  encodeArena,
  decodeArena,
  type Arena,
} from "../src/engine/arena.js";
import {
  DEFAULT_TUNING,
  NEUTRAL,
  S,
  type Tuning,
} from "../src/engine/world.js";
import { COUNTDOWN_TICKS, ROUND_TICKS } from "../src/engine/contest.js";
import { Mesh } from "./fixtures/mesh.js";
import { decode, encode, hash } from "../src/online/game.js";
const members = ["amber", "blue", "green"].map((id, slot) => ({
  id,
  slot,
  connected: true,
  generation: 1,
}));
test("active rounds can return to lobby, lose a peer and restore on refresh", () => {
  const mesh = new Mesh(),
    a = mesh.join("a");
  mesh.run(500);
  a.command({ type: "join", name: "A" });
  mesh.run(500);
  const b = mesh.join("b");
  mesh.run(1500);
  b.command({ type: "join", name: "B" });
  mesh.run(1000);
  a.command({
    type: "settings",
    settings: { ...DEFAULT_TUNING, rules: "score" },
  });
  mesh.run(500);
  a.command({ type: "action", action: "start" });
  mesh.run(4500);
  assert.equal(a.state()!.simulation.contest.phase, "active");
  a.command({ type: "action", action: "lobby" });
  mesh.run(500);
  b.stop();
  mesh.run(1200);
  const state = a.state()!;
  assert.equal(state.stage, "lobby");
  assert.equal(hash(decode(encode(state), state.tick)!), hash(state));
  const returning = mesh.join("b");
  mesh.run(2500);
  assert.equal(returning.state()!.stage, "lobby");
  const common = Math.min(a.state()!.tick, returning.state()!.tick) - 10;
  assert.equal(a.hashAt(common), returning.hashAt(common));
  a.stop();
  returning.stop();
});
function start(rules: Tuning["rules"], n = 2) {
  const arena = createArena({ ...DEFAULT_TUNING, rules });
  syncKeepers(arena, members.slice(0, n));
  for (let i = 0; i < COUNTDOWN_TICKS; i++) stepArena(arena);
  assert.equal(arena.contest.phase, "active");
  return arena;
}
function fall(arena: Arena, slot: number) {
  const world = arena.keepers.find((k) => k.slot === slot)!.world;
  world.x = 800 * S;
  world.feet = 954 * S;
  world.grounded = false;
}
test("competitive trials wait, count down, lock entrants and ignore personal reset", () => {
  const a = createArena({ ...DEFAULT_TUNING, rules: "elimination" });
  syncKeepers(a, members.slice(0, 1));
  stepArena(a);
  assert.equal(a.contest.phase, "waiting");
  syncKeepers(a, members.slice(0, 2));
  stepArena(a);
  assert.equal(a.contest.phase, "countdown");
  syncKeepers(a, [members[0]!, { ...members[1]!, connected: false }]);
  stepArena(a);
  assert.equal(a.contest.phase, "waiting");
  syncKeepers(a, members.slice(0, 2));
  for (let i = 0; i < COUNTDOWN_TICKS; i++) stepArena(a);
  syncKeepers(a, members);
  a.keepers[0]!.world.input = { ...NEUTRAL, move: 1, reset: true };
  a.keepers[2]!.world.input = { ...NEUTRAL, move: 1, fire: true };
  const lateX = a.keepers[2]!.world.x;
  for (let i = 0; i < 20; i++) stepArena(a);
  assert.equal(a.contest.entries.length, 2);
  assert.equal(a.keepers[2]!.world.x, lateX);
  assert.ok(a.keepers[0]!.world.x > 310 * S);
  assert.equal(a.contest.phase, "active");
});
test("elimination resolves simultaneous falls as a draw and freezes the result", () => {
  const a = start("elimination");
  fall(a, 0);
  fall(a, 1);
  stepArena(a);
  assert.equal(a.contest.phase, "over");
  assert.deepEqual(a.contest.winners, []);
  const result = structuredClone(a.contest);
  for (let i = 0; i < 60; i++) stepArena(a);
  assert.deepEqual(a.contest, result);
  assert.ok(a.keepers.every((k) => k.world.respawn > 0));
  assert.ok(decodeArena(encodeArena(a)));
});
test("a fall eliminates, disconnects forfeit, and refreshed generations cannot re-enter", () => {
  const a = start("elimination", 3);
  fall(a, 0);
  stepArena(a);
  assert.equal(a.contest.entries[0]!.out, true);
  assert.equal(a.contest.phase, "active");
  syncKeepers(a, [members[0]!, { ...members[1]!, generation: 2 }, members[2]!]);
  stepArena(a);
  assert.equal(a.contest.phase, "over");
  assert.deepEqual(a.contest.winners, ["green"]);
  const b = start("score");
  syncKeepers(b, [members[0]!, { ...members[1]!, connected: false }]);
  stepArena(b);
  assert.deepEqual(b.contest.winners, ["amber"]);
});
test("score rounds award player hits, penalize falls, respawn and end on the fixed clock", () => {
  const a = start("score");
  for (let i = 0; i < 31; i++) stepArena(a);
  a.keepers[0]!.world.input = { ...NEUTRAL, fire: true, aimX: 170, aimY: 782 };
  for (let i = 0; i < 20; i++) stepArena(a);
  assert.equal(a.contest.entries[0]!.score, 1);
  a.keepers[0]!.world.input = { ...NEUTRAL };
  fall(a, 0);
  stepArena(a);
  assert.equal(a.contest.entries[0]!.score, -1);
  for (let i = 0; i < 31; i++) stepArena(a);
  assert.equal(a.keepers[0]!.world.respawn, 0);
  const restored = decodeArena(encodeArena(a))!;
  assert.ok(restored);
  while (a.contest.phase !== "over") {
    stepArena(a);
    stepArena(restored);
  }
  assert.equal(a.contest.elapsed, ROUND_TICKS);
  assert.equal(
    a.contest.entries[1]!.score,
    -2,
    "the knocked-back rival also falls",
  );
  assert.deepEqual(a.contest.winners, ["amber"]);
  assert.deepEqual(encodeArena(restored), encodeArena(a));
});
test("timeout ties share winners; forged scores, entrants and premature results are refused", () => {
  const a = start("elimination");
  while (a.contest.phase !== "over") stepArena(a);
  assert.deepEqual(a.contest.winners, ["amber", "blue"]);
  const raw = JSON.parse(JSON.stringify(encodeArena(a)));
  raw.contest.elapsed = 10;
  assert.equal(decodeArena(raw), undefined);
  raw.contest.elapsed = ROUND_TICKS;
  raw.contest.winners = ["amber"];
  assert.equal(decodeArena(raw), undefined);
  raw.contest.winners = ["amber", "blue"];
  raw.contest.entries[0].score = 1;
  assert.equal(decodeArena(raw), undefined);
  raw.contest.entries[0].score = 0;
  raw.contest.entries[1].id = "amber";
  assert.equal(decodeArena(raw), undefined);
});

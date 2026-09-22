import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  createMatch,
  decodeState,
  encodeState,
  hashState,
  isAction,
  UNIT,
  type Action,
  type Match,
  type Projectile,
} from "../src/engine/index.js";
import { generateTerrain } from "../src/engine/terrain.js";

/** Explicit flat-arena fixture: isolates support/impact contracts from random map selection. */
function arena(): Match {
  const s = createMatch("physics-cases", 1, [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ]);
  s.terrain = generateTerrain(1, 2, true).terrain;
  s.phase = "aiming";
  s.players.forEach((p, i) =>
    Object.assign(p, {
      x: (200 + i * 300) * UNIT,
      y: 444 * UNIT,
      fallFrom: 444 * UNIT,
    }),
  );
  return s;
}
function command(
  s: Match,
  body:
    | { type: "pass" }
    | { type: "launch"; weapon: "pebble" | "scatter"; vx: number; vy: number },
): Action {
  const p = s.players[s.active]!;
  return {
    ...body,
    actor: p.id,
    turn: s.turn,
    round: s.round,
    ordinal: p.ordinal + 1,
  };
}
function projectile(s: Match, values: Partial<Projectile> = {}): Projectile {
  return {
    id: s.nextEntity++,
    shot: 1,
    owner: "a",
    kind: "pebble",
    x: 300 * UNIT,
    y: 441 * UNIT,
    vx: 256,
    vy: 0,
    expires: 600,
    cleared: true,
    ...values,
  };
}
test("walking and hopping are rejected without moving a bird or consuming an ordinal", () => {
  for (const type of ["move", "hop"] as const) {
    const state = arena(),
      control = decodeState(encodeState(state))!;
    const action = { ...command(state, { type: "pass" }), type, direction: 1 };
    assert.equal(isAction(action), false);
    // Deliberately bypass static typing to exercise runtime rejection of legacy inputs.
    // @ts-expect-error Locomotion is not a legal public action.
    advance(state, [action]);
    advance(control);
    assert.equal(hashState(state), hashState(control));
    assert.equal(state.players[0]!.ordinal, 0);
  }
});
test("falling and pass keep the turn unresolved until landing; airborne launches spend nothing", () => {
  const s = arena(),
    p = s.players[0]!,
    turn = s.turn;
  p.y = p.fallFrom = 420 * UNIT;
  p.grounded = false;
  advance(s);
  const rejected = advance(s, [
    command(s, { type: "launch", weapon: "scatter", vx: 1024, vy: -1024 }),
  ]);
  assert.equal(p.ammo, 3);
  assert.ok(rejected.some((f) => f.type === "rejected"));
  advance(s, [command(s, { type: "pass" })]);
  assert.equal(s.turn, turn);
  for (let i = 0; i < 200 && s.turn === turn; i++) advance(s);
  assert.equal(s.turn, turn + 1);
  assert.equal(p.grounded, true);
  assert.equal(p.hp, 100);
});
test("a long fall damages on landing once, and water resolves a simultaneous draw", () => {
  const s = arena(),
    p = s.players[0]!;
  p.y = p.fallFrom = 300 * UNIT;
  p.grounded = false;
  let hits = 0;
  for (let i = 0; i < 100; i++)
    hits += advance(s).filter(
      (f) => f.type === "damage" && f.actor === p.id,
    ).length;
  assert.equal(hits, 1);
  assert.ok(p.hp >= 60 && p.hp < 100);
  assert.equal(p.grounded, true);
  s.water = 440;
  const facts = advance(s);
  assert.equal(s.phase, "over");
  assert.equal(s.winner, null);
  assert.equal(facts.filter((f) => f.type === "eliminated").length, 2);
});
test("a horizontal Scatter splits at its launch position and fragments share the original expiry", () => {
  const s = arena(),
    facts = advance(s, [
      command(s, { type: "launch", weapon: "scatter", vx: 1024, vy: 0 }),
    ]);
  const split = facts.find((f) => f.type === "split");
  assert.ok(split);
  assert.equal(split.x, 209);
  assert.equal(split.y, 441);
  assert.equal(s.players[0]!.ammo, 2);
  assert.equal(s.projectiles.length, 3);
  assert.ok(
    s.projectiles.every((p) => p.kind === "fragment" && p.expires === 600),
  );
  assert.equal(
    facts.some((f) => f.type === "blast"),
    false,
  );
});
test("a downward launch collides with a one-cell support rather than spawning below it", () => {
  const s = arena(),
    p = s.players[0]!;
  s.terrain.bits.fill(0);
  for (let x = 190; x <= 210; x++) {
    const i = 450 * 1536 + x;
    s.terrain.bits[i >>> 3]! |= 1 << (i & 7);
  }
  const facts = advance(s, [
    command(s, { type: "launch", weapon: "pebble", vx: 0, vy: 1024 }),
  ]);
  const blast = facts.find((f) => f.type === "blast");
  assert.ok(blast);
  assert.ok(
    blast.y! < 451,
    "projectile must hit the support before the nominal muzzle below it",
  );
  assert.equal(s.projectiles.length, 0);
  assert.ok(s.terrain.version > 0);
  assert.equal(p.ammo, 3);
});
test("contact wins an apex tie, collects a descending crate once and suppresses the split", () => {
  const s = arena();
  s.phase = "flight";
  s.shot = 1;
  s.players[0]!.ammo = 2;
  s.projectiles = [projectile(s, { kind: "scatter", vy: -24 })];
  s.crates = [
    {
      id: s.nextEntity++,
      x: 306 * UNIT,
      y: 441 * UNIT,
      vy: 110,
      grounded: false,
    },
  ];
  const facts = advance(s);
  assert.equal(facts.filter((f) => f.type === "blast").length, 1);
  assert.equal(facts.filter((f) => f.type === "split").length, 0);
  assert.equal(facts.filter((f) => f.type === "pickup").length, 1);
  assert.equal(s.players[0]!.ammo, 3);
  assert.equal(s.crates.length, 0);
});
test("one blast may consume multiple crates but ammunition never exceeds five", () => {
  const s = arena();
  s.phase = "flight";
  s.shot = 1;
  s.players[0]!.ammo = 4;
  s.projectiles = [projectile(s)];
  s.crates = [0, 1].map((i) => ({
    id: s.nextEntity++,
    x: (306 + i * 4) * UNIT,
    y: 441 * UNIT,
    vy: 0,
    grounded: false,
  }));
  const facts = advance(s),
    pickups = facts.filter((f) => f.type === "pickup");
  assert.equal(pickups.length, 2);
  assert.equal(
    pickups.reduce((n, f) => n + (f.amount ?? 0), 0),
    1,
  );
  assert.equal(s.players[0]!.ammo, 5);
  assert.equal(s.crates.length, 0);
  assert.ok(decodeState(encodeState(s)));
});
test("simultaneous final fragments eliminate both birds before deciding the result", () => {
  const s = arena();
  s.phase = "flight";
  s.shot = 1;
  s.players.forEach((p) => {
    p.hp = 20;
  });
  s.projectiles = [
    projectile(s, { kind: "fragment", x: 193 * UNIT, vx: 768 }),
    projectile(s, { kind: "fragment", x: 493 * UNIT, vx: 768 }),
  ];
  const facts = advance(s);
  assert.equal(s.phase, "over");
  assert.equal(s.winner, null);
  assert.equal(facts.filter((f) => f.type === "eliminated").length, 2);
  assert.equal(facts.filter((f) => f.type === "result").length, 1);
  assert.ok(decodeState(encodeState(s)));
});
test("a surviving direct hit adds bounded knockback and replays identically from a checkpoint", () => {
  const s = arena();
  s.phase = "flight";
  s.shot = 1;
  s.projectiles = [projectile(s, { x: 493 * UNIT, vx: 768 })];
  const restored = decodeState(encodeState(s));
  assert.ok(restored);
  const x = s.players[1]!.x;
  assert.deepEqual(advance(restored), advance(s));
  assert.ok(s.players[1]!.x > x);
  assert.ok(Math.abs(s.players[1]!.vx) <= 900);
  assert.deepEqual(restored, s);
});

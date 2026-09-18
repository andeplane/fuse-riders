import assert from "node:assert/strict";
import test from "node:test";
import {
  addPlayer,
  createGame,
  aimSlowMultiplier,
  riderMotionStep,
  startMatch,
  startNextRound,
  step,
  toView,
  COUNTDOWN_TICKS,
  type GameState,
} from "../src/engine/game.ts";
import { MAX_PORTAL_PAIRS } from "../src/engine/portal.ts";
import { classicSettings } from "./fixtures/classic-settings.ts";

function arena() {
  const state = createGame("portal", classicSettings(), 123);
  for (let slot = 0; slot < 3; slot++)
    addPlayer(state, { id: `p${slot}`, name: `P${slot}`, slot, color: "#fff" });
  startMatch(state);
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick++) step(state, new Map());
  // An open board: gate placement and transits are measured against riders and trails alone.
  state.obstacles = [];
  for (const [index, player] of [...state.players.values()].entries())
    Object.assign(player, {
      x: 185 + index * 500,
      y: 200 + index * 200,
      angle: 0,
      trail: [],
    });
  state.portalPairs = [
    {
      id: "pair",
      gates: [
        { x: 200, y: 200, halfLength: 100 },
        { x: 1000, y: 300, halfLength: 100 },
      ],
      expiresAtTick: state.tick + 200,
    },
  ];
  return state;
}

/** A plain rider's travel on the tick just stepped; riders speed up through the round. */
const stride = (state: GameState) =>
  riderMotionStep(
    {
      nitroUntilTicks: [],
      snailUntilTicks: [],
      grip: false,
      aimSlowTicks: 0,
      aimSlowSpentTicks: 0,
    },
    state.tick,
    state.roundStartedTick,
  ).distance;

test("portal transits survivors, breaks trail, preserves heading/charge, counts actual movement", () => {
  const state = arena();
  const player = state.players.get("p0")!;
  player.bombChargeStartedTick = state.tick;
  const beforeDistance = state.matchStats.get("p0")!.distanceUnits;
  step(state, new Map());
  assert.equal(player.x, 1012);
  assert.equal(player.y, 300);
  assert.equal(player.angle, 0);
  assert.equal(player.trail.at(-1)!.x2, 189);
  assert.equal(player.portalCooldownUntilTick, state.tick + 15);
  assert.equal(player.portalGraceUntilTick, state.tick + 10);
  assert.equal(state.matchStats.get("p0")!.portalTransits, 1);
  assert.equal(state.matchStats.get("p0")!.distanceUnits - beforeDistance, 4);
  assert.equal(player.bombChargeStartedTick, state.tick - 1);
  step(state, new Map());
  assert.equal(player.trail.at(-1)!.x1, 1012);
  // Two ticks into the held charge, the rider is two steps into the aiming slowdown.
  assert.equal(player.x, 1012 + stride(state) * aimSlowMultiplier(2));
});

test("entry collision is resolved before transit, and shield remains independent", () => {
  for (const shielded of [false, true]) {
    const state = arena();
    const player = state.players.get("p0")!;
    player.shielded = shielded;
    state.players.get("p1")!.trail.push({
      x1: 188,
      y1: 100,
      x2: 188,
      y2: 250,
      createdTick: 0,
      expiresAtTick: 500,
    });
    step(state, new Map());
    assert.equal(player.alive, shielded);
    assert.equal(state.matchStats.get("p0")!.portalTransits, shielded ? 1 : 0);
    assert.equal(player.shielded, false);
  }
});

test("unsafe exit defers teleport for rider, pending trail, trail, bomb and blast hazards", () => {
  for (const hazard of [
    "rider",
    "pending",
    "trail",
    "bomb",
    "flight",
    "blast",
  ] as const) {
    const state = arena();
    const other = state.players.get("p1")!;
    if (hazard === "rider") Object.assign(other, { x: 999, y: 300 });
    if (hazard === "pending")
      Object.assign(other, { x: 1010, y: 307, angle: Math.PI });
    if (hazard === "trail")
      other.trail.push({
        x1: 990,
        y1: 300,
        x2: 1010,
        y2: 300,
        createdTick: 0,
        expiresAtTick: 500,
      });
    if (hazard === "bomb" || hazard === "flight")
      state.bombs.set(1, {
        id: 1,
        ownerId: "p1",
        x: hazard === "bomb" ? 1000 : 1200,
        y: 300,
        launchX: 1000,
        launchY: 300,
        launchedTick: state.tick,
        landsAtTick: state.tick + 6,
        placedTick: state.tick,
        explodeAtTick: 500,
        blastRange: 150,
        flightPath: [{ x: 1000, y: 300, angle: 0 }],
      });
    if (hazard === "blast")
      state.blasts.push({
        bombId: 99,
        ownerId: "p1",
        circle: { x: 1000, y: 300, radius: 10 },
        expiresAtTick: 500,
      });
    step(state, new Map());
    assert.equal(state.players.get("p0")!.x, 185 + stride(state), hazard);
    assert.equal(state.matchStats.get("p0")!.portalTransits, 0, hazard);
  }
});

test("portal grace is defensive for both riders, protects trails/walls and does not consume shield", () => {
  const state = arena();
  const player = state.players.get("p0")!;
  const other = state.players.get("p1")!;
  state.portalPairs = [];
  player.portalGraceUntilTick = state.tick + 10;
  player.shielded = true;
  Object.assign(other, { x: 180, y: 200, angle: Math.PI });
  step(state, new Map());
  assert.equal(player.alive, true);
  assert.equal(other.alive, true);
  assert.equal(player.shielded, true);
  Object.assign(player, { x: 28, y: 400, angle: Math.PI });
  step(state, new Map());
  assert.equal(player.alive, true);
  assert.equal(player.x, 27);
});

test("portal expiry, snapshot copying, compact geometry omission and round reset", () => {
  const state = arena();
  const snapshot = toView(state);
  snapshot.portalPairs[0]!.gates[0].x = -10;
  assert.equal(state.portalPairs[0]!.gates[0].x, 200);
  state.portalPairs[0]!.expiresAtTick = state.tick + 1;
  step(state, new Map());
  assert.deepEqual(state.portalPairs, []);
  const player = state.players.get("p0")!;
  player.portalCooldownUntilTick = 900;
  player.portalGraceUntilTick = 900;
  state.phase = "roundOver";
  startNextRound(state);
  assert.equal(player.portalCooldownUntilTick, 0);
  assert.equal(player.portalGraceUntilTick, 0);
  assert.deepEqual(state.portalPairs, []);
});

test("portal pickup adds a deterministic pair, records stats, keeps the old pair and the cooldown", () => {
  const states = [arena(), arena()];
  for (const state of states) {
    const player = state.players.get("p0")!;
    player.portalCooldownUntilTick = 200;
    state.pickups.push({
      id: 50,
      type: "portal",
      x: 170,
      y: 200,
      expiresAtTick: 500,
    });
    step(state, new Map());
    assert.equal(state.pickups.length, 0);
    assert.equal(
      state.portalPairs.length,
      2,
      "the running pair keeps its remaining lifetime",
    );
    assert.equal(state.portalPairs[0]!.id, "pair");
    assert.notEqual(state.portalPairs[1]!.id, "pair");
    assert.equal(player.portalCooldownUntilTick, 200);
    assert.equal(state.matchStats.get("p0")!.portalPickups, 1);
    state.phase = "matchOver";
    assert.equal(toView(state).matchStats[0]!.portalPickups, 1);
  }
  assert.deepEqual(states[0]!.portalPairs, states[1]!.portalPairs);
});

test("impossible placement leaves pickup and old pair unconsumed", () => {
  const state = arena();
  state.width = 350;
  state.height = 350;
  state.pickups.push({
    id: 50,
    type: "portal",
    x: 170,
    y: 200,
    expiresAtTick: 500,
  });
  step(state, new Map());
  assert.equal(state.pickups.length, 1);
  assert.deepEqual(state.portalPairs, [], "reclaimed wall pair is removed");
  assert.equal(state.matchStats.get("p0")!.portalPickups, 0);
});

test("reverse transit respects cooldown at its exact deadline through any gate", () => {
  const state = arena();
  const player = state.players.get("p0")!;
  Object.assign(player, {
    x: 985,
    y: 300,
    portalCooldownUntilTick: state.tick + 2,
  });
  state.portalPairs[0]!.id = "second";
  step(state, new Map());
  assert.equal(player.x, 985 + stride(state));
  player.x = 985;
  player.trail = [];
  step(state, new Map());
  assert.equal(player.x, 212);
  assert.equal(player.y, 200);
  assert.equal(state.matchStats.get("p0")!.portalTransits, 1);
});

test("portal defensive grace expires exactly at the authoritative tick", () => {
  for (const remaining of [1, 2]) {
    const state = arena();
    const player = state.players.get("p0")!;
    state.portalPairs = [];
    player.portalGraceUntilTick = state.tick + remaining;
    state.players.get("p1")!.trail.push({
      x1: 188,
      y1: 100,
      x2: 188,
      y2: 250,
      createdTick: 0,
      expiresAtTick: 500,
    });
    step(state, new Map());
    assert.equal(player.alive, remaining === 2);
  }
});

test("concurrent riders preserve separate entry heights at the linked wall", () => {
  const state = arena();
  const first = state.players.get("p0")!;
  const second = state.players.get("p1")!;
  Object.assign(first, { x: 185, y: 185, angle: 0 });
  Object.assign(second, { x: 185, y: 215, angle: 0 });
  step(state, new Map());
  assert.equal(state.matchStats.get("p0")!.portalTransits, 1);
  assert.equal(state.matchStats.get("p1")!.portalTransits, 1);
  assert.deepEqual({ x: first.x, y: first.y }, { x: 1012, y: 285 });
  assert.deepEqual({ x: second.x, y: second.y }, { x: 1012, y: 315 });
});

test("wall placement remains useful on an occupied five-rider field across seeds", () => {
  let placed = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const state = createGame("occupied-walls", classicSettings(), seed);
    for (let slot = 0; slot < 5; slot++)
      addPlayer(state, {
        id: `p${slot}`,
        name: `P${slot}`,
        slot,
        color: "#fff",
      });
    startMatch(state);
    for (let tick = 0; tick < COUNTDOWN_TICKS; tick++) step(state, new Map());
    state.obstacles = [];
    for (const [slot, player] of [...state.players.values()].entries()) {
      const x = 200 + slot * 280;
      const y = slot % 2 ? 600 : 260;
      Object.assign(player, {
        x,
        y,
        angle: 0,
        invulnerableUntilTick: state.tick + 10,
      });
      player.trail = Array.from({ length: 30 }, (_, index) => ({
        x1: x - 150 + index * 5,
        y1: y + Math.sin(index / 5) * 35,
        x2: x - 145 + index * 5,
        y2: y + Math.sin((index + 1) / 5) * 35,
        createdTick: 0,
        expiresAtTick: 9999,
      }));
    }
    state.pickups = [
      { id: 1, type: "portal", x: 200, y: 260, expiresAtTick: 9999 },
    ];
    step(state, new Map());
    if (state.portalPairs.length) placed++;
  }
  assert.ok(
    placed >= 45,
    `at least 90% of representative occupied arenas should place walls; got ${placed}/50`,
  );
});

test("authoritative overtime shrinks portal wall length and removes reclaimed walls from snapshots", () => {
  const state = arena();
  state.tick = state.roundStartedTick! + 1200 + 160;
  state.portalPairs[0]!.expiresAtTick = state.tick + 200;
  state.nextPickupSpawnTick = state.tick + 100;
  const first = state.portalPairs[0]!.gates[0];
  Object.assign(first, { y: 200, halfLength: 140 });
  step(state, new Map());
  const snapshot = toView(state);
  const gate = snapshot.portalPairs[0]!.gates[0];
  assert.equal(gate.y - gate.halfLength, state.boundaryInset + 12);
  assert.ok(gate.halfLength <= (state.height - state.boundaryInset * 2) / 6);
  first.x = 50;
  // The snapshot and current pair are independent copies.
  state.portalPairs[0]!.gates[0].x = 50;
  step(state, new Map());
  assert.deepEqual(toView(state).portalPairs, []);
});

test("compressed linked wall reserves an exit for the first rider rather than overlapping arrivals", () => {
  const state = arena();
  state.portalPairs[0]!.gates[1].halfLength = 10;
  const first = state.players.get("p0")!;
  const second = state.players.get("p1")!;
  Object.assign(first, { x: 185, y: 185, angle: 0 });
  Object.assign(second, { x: 185, y: 215, angle: 0 });
  step(state, new Map());
  assert.equal(state.matchStats.get("p0")!.portalTransits, 1);
  assert.equal(state.matchStats.get("p1")!.portalTransits, 0);
  assert.deepEqual({ x: first.x, y: first.y }, { x: 1012, y: 298.5 });
  assert.deepEqual(
    { x: second.x, y: second.y },
    { x: 185 + stride(state), y: 215 },
  );
});

/** A second pair well clear of the one `arena()` opens, with its own linked wall on the right. */
function secondPair(tick: number, expiresInTicks = 200) {
  return {
    id: "second",
    gates: [
      { x: 400, y: 200, halfLength: 100 },
      { x: 1300, y: 700, halfLength: 100 },
    ] as const,
    expiresAtTick: tick + expiresInTicks,
  };
}

test("pairs run side by side, each leading to its own partner and expiring on its own tick", () => {
  const state = arena();
  state.portalPairs.push({ ...secondPair(state.tick, 4) });
  const first = state.players.get("p0")!;
  const second = state.players.get("p1")!;
  Object.assign(second, { x: 385, y: 200, angle: 0, trail: [] });
  step(state, new Map());
  assert.deepEqual(
    { x: first.x, y: first.y },
    { x: 1012, y: 300 },
    "the older pair still carries its own rider",
  );
  assert.deepEqual(
    { x: second.x, y: second.y },
    { x: 1312, y: 700 },
    "the newer pair leads to its own partner",
  );
  assert.equal(state.portalPairs.length, 2);
  for (let tick = 0; tick < 3; tick++) step(state, new Map());
  assert.deepEqual(
    state.portalPairs.map((pair) => pair.id),
    ["pair"],
    "only the short-lived pair expires",
  );
});

test("a reclaimed wall removes just its own pair, leaving the rest open", () => {
  const state = arena();
  state.portalPairs.push({ ...secondPair(state.tick) });
  state.tick = state.roundStartedTick! + 1200 + 160;
  for (const pair of state.portalPairs) pair.expiresAtTick = state.tick + 200;
  state.nextPickupSpawnTick = state.tick + 100;
  state.portalPairs[0]!.gates[0].x = 50;
  step(state, new Map());
  assert.deepEqual(
    toView(state).portalPairs.map((pair) => pair.id),
    ["second"],
  );
});

/** Distance from a point to a gate's vertical centerline, as the placement clearance measures it. */
function gateDistance(
  point: { x: number; y: number },
  gate: { x: number; y: number; halfLength: number },
): number {
  const y = Math.max(
    gate.y - gate.halfLength,
    Math.min(gate.y + gate.halfLength, point.y),
  );
  return Math.hypot(point.x - gate.x, point.y - y);
}

test("a new pair is never laid over the walls of a live one", () => {
  let checked = 0;
  for (let seed = 1; seed <= 40 && checked === 0; seed++) {
    const state = arena();
    state.randomState = seed;
    state.pickups.push({
      id: 50,
      type: "portal",
      x: 170,
      y: 200,
      expiresAtTick: 500,
    });
    step(state, new Map());
    if (state.pickups.length) continue;
    checked++;
    const [existing, fresh] = state.portalPairs;
    for (const gate of fresh!.gates) {
      for (const sample of [
        gate.y - gate.halfLength,
        gate.y,
        gate.y + gate.halfLength,
      ]) {
        for (const wall of existing!.gates) {
          assert.ok(
            gateDistance({ x: gate.x, y: sample }, wall) > 11,
            `new wall at ${gate.x} clears the live wall at ${wall.x}`,
          );
        }
      }
    }
  }
  assert.equal(checked, 1, "at least one seed should place a second pair");
});

test("a transit is refused rather than dropping a rider inside another pair's wall", () => {
  for (const foreignX of [1013, 1100]) {
    const state = arena();
    const player = state.players.get("p0")!;
    state.portalPairs.push({
      id: "foreign",
      gates: [
        { x: foreignX, y: 300, halfLength: 100 },
        { x: 500, y: 800, halfLength: 100 },
      ],
      expiresAtTick: state.tick + 200,
    });
    step(state, new Map());
    const blocked = foreignX === 1013;
    assert.equal(
      state.matchStats.get("p0")!.portalTransits,
      blocked ? 0 : 1,
      `foreign wall at ${foreignX}`,
    );
    assert.equal(
      player.x,
      blocked ? 185 + stride(state) : 1012,
      `foreign wall at ${foreignX}`,
    );
  }
});

test("at the cap the oldest pair retires, before the riders still aiming at it can enter", () => {
  let checked = 0;
  for (let seed = 1; seed <= 40 && checked === 0; seed++) {
    const state = arena();
    state.randomState = seed;
    state.portalPairs = [
      {
        id: "old-0",
        gates: [
          { x: 200, y: 200, halfLength: 100 },
          { x: 1000, y: 300, halfLength: 100 },
        ],
        expiresAtTick: state.tick + 200,
      },
      ...Array.from({ length: MAX_PORTAL_PAIRS - 1 }, (_unused, index) => ({
        id: `old-${index + 1}`,
        gates: [
          { x: 60 + index * 30, y: 500 + index * 100, halfLength: 40 },
          { x: 1500 - index * 30, y: 500 + index * 100, halfLength: 40 },
        ] as const,
        expiresAtTick: state.tick + 200,
      })),
    ];
    state.pickups.push({
      id: 50,
      type: "portal",
      x: 170,
      y: 200,
      expiresAtTick: 500,
    });
    step(state, new Map());
    assert.ok(
      state.portalPairs.length <= MAX_PORTAL_PAIRS,
      "the list never grows past the cap",
    );
    if (state.pickups.length) continue;
    checked++;
    assert.equal(state.portalPairs.length, MAX_PORTAL_PAIRS);
    assert.equal(
      state.portalPairs.some((pair) => pair.id === "old-0"),
      false,
      "the oldest pair makes room",
    );
    assert.equal(
      state.portalPairs[0]!.id,
      "old-1",
      "the survivors keep their order",
    );
    assert.equal(
      state.portalPairs.at(-1)!.id.startsWith("old-"),
      false,
      "the new pair is appended last",
    );
    // Collection resolves before the transit scan, so the retired pair is already gone this tick.
    assert.equal(state.matchStats.get("p0")!.portalTransits, 0);
    assert.equal(state.players.get("p0")!.x, 185 + stride(state));
  }
  assert.equal(
    checked,
    1,
    "at least one seed should place a pair against a full list",
  );
});

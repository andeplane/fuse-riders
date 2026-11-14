import test from "node:test";
import assert from "node:assert/strict";
import {
  GATE_OFFER,
  HATCH_LIFT,
  HEAD_OVERLAP,
  QUEEN_EGGS,
  QUEEN_LETHAL,
  RESPAWN_INVULN,
  RESPAWN_STEPS,
  S,
  STUN_SPEED,
  STUN_STEPS,
  UNIT,
  WARRIOR_LETHAL,
  WORKER_HEIGHT,
  arenaOf,
  isQueenSlot,
  lethal,
  stepRound,
  teamOf,
  viewOf,
  type Unit,
} from "../src/engine/index.js";
import { exposed, resolveCombat, walled } from "../src/engine/combat.js";
import { firstTeam, turnOrder } from "../src/engine/units.js";
import {
  bare,
  controls,
  ofType,
  put,
  run,
  stand,
  unitOf,
} from "./engine-kit.js";

const FLOOR = 265;
/** Mid-swing: the sword out, the dash still on. */
const SWING = { kind: "warrior", attack: 3, dashing: true } as const;

test("slots: teams alternate, and the first two are the Queens", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(teamOf), [0, 1, 0, 1, 0, 1]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(isQueenSlot), [
    true,
    true,
    false,
    false,
    false,
    false,
  ]);
});

test("which team acts first in a contested step is a coin flip from the seed and the step, fair to both teams", () => {
  const state = bare();
  const firsts = [0, 0];
  for (state.step = 0; state.step < 6000; state.step += 1) {
    const first = firstTeam(state);
    assert.ok(first === 0 || first === 1);
    firsts[first] = (firsts[first] ?? 0) + 1;
    assert.deepEqual(
      turnOrder(state),
      first === 0 ? [0, 1, 2, 3, 4, 5] : [1, 0, 3, 2, 5, 4],
    );
  }
  assert.ok(
    Math.abs((firsts[0] ?? 0) - 3000) < 200,
    `team 0 first ${firsts[0]} times of 6000`,
  );
  // The same seed and step always give the same answer; another seed gives another sequence.
  const flips = (seed: number): number[] => {
    const round = bare();
    round.seed = seed;
    return Array.from({ length: 64 }, (_, step) => {
      round.step = step;
      return firstTeam(round);
    });
  };
  assert.deepEqual(flips(7), flips(7));
  assert.notDeepEqual(flips(7), flips(8));
});

test("a Warrior kills only with its sword: the attack button dashes it into the Worker in front, who respawns later, invulnerable", () => {
  const state = bare();
  const warrior = stand(state, 2, 300, FLOOR, { kind: "warrior", facing: 1 });
  const worker = stand(state, 3, 330, FLOOR);
  // Standing next to it does nothing.
  assert.deepEqual(run(state, 5), []);
  stepRound(state, controls({ 2: { attack: true } }));
  assert.deepEqual(state.events, [{ type: "attack", slot: 2 }]);
  assert.equal(viewOf(state).units[2]?.attacking, true);
  assert.equal(viewOf(state).units[2]?.dashing, true);
  assert.equal(viewOf(state).units[2]?.attackStep, 1);
  const events = run(state, 6);
  assert.deepEqual(events, [{ type: "kill", victim: 3, killer: 2 }]);
  assert.equal(worker.dead, true);
  assert.equal(warrior.dashing, true);
  assert.equal(RESPAWN_STEPS, 192);
  const quiet = run(state, worker.respawn - 1);
  assert.deepEqual(quiet, []);
  stepRound(state, []);
  assert.deepEqual(state.events, [{ type: "respawn", slot: 3, egg: -1 }]);
  const spawn = arenaOf(1).spawns[3];
  assert.ok(spawn);
  assert.equal(worker.dead, false);
  assert.deepEqual([worker.x, worker.y], [spawn.x, spawn.y]);
  assert.equal(worker.invuln, RESPAWN_INVULN);
  assert.equal(RESPAWN_INVULN, 132);
  assert.equal(worker.facing, -1);
});

test("the sword kills what is in front of it, not what is behind, and not through a platform", () => {
  const state = bare();
  stand(state, 2, 300, FLOOR, { ...SWING, facing: -1 });
  const behind = stand(state, 3, 308, FLOOR);
  resolveCombat(state);
  assert.equal(behind.dead, false);
  unitOf(state, 2).facing = 1;
  resolveCombat(state);
  assert.equal(behind.dead, true);
  // A Worker on the far side of a wall is safe: map 2 has a pillar at x 235..245, y 100..115.
  const split = bare(2);
  const attacker = put(split, 2, 232, 112, { ...SWING, facing: 1 });
  const hidden = put(split, 3, 248, 112);
  assert.equal(walled(arenaOf(2), attacker, hidden), true);
  resolveCombat(split);
  assert.equal(hidden.dead, false);
  attacker.y = 70 * S;
  hidden.y = 70 * S;
  assert.equal(walled(arenaOf(2), attacker, hidden), false);
  resolveCombat(split);
  assert.equal(hidden.dead, true);
});

test("the sword is lethal through step 19 of the attack and not on step 20; a Queen's dash through step 17", () => {
  const strike = (kind: Unit["kind"], attack: number): boolean => {
    const state = bare();
    const slot = kind === "queen" ? 0 : 2;
    put(state, slot, 300, 200, { kind, attack, dashing: true, facing: 1 });
    const victim = put(state, 3, 309, kind === "queen" ? 190 : 200);
    resolveCombat(state);
    return victim.dead;
  };
  assert.equal(strike("warrior", 1), true);
  assert.equal(strike("warrior", WARRIOR_LETHAL), true);
  assert.equal(strike("warrior", WARRIOR_LETHAL + 1), false);
  assert.equal(strike("warrior", 0), false);
  assert.equal(strike("queen", 1), true);
  assert.equal(strike("queen", QUEEN_LETHAL), true);
  assert.equal(strike("queen", QUEEN_LETHAL + 1), false);
});

test("sword on sword, face to face, is a glance: nobody dies, both attacks end, both are stunned and thrown apart", () => {
  const state = bare();
  const a = stand(state, 2, 300, FLOOR, { kind: "warrior", facing: 1 });
  const b = stand(state, 3, 330, FLOOR, { kind: "warrior", facing: -1 });
  const both = controls({ 2: { attack: true }, 3: { attack: true } });
  stepRound(state, both);
  const glances = ofType(state.events, "glance");
  assert.equal(glances.length, 1);
  assert.deepEqual(ofType(state.events, "kill"), []);
  const [glance] = glances;
  assert.ok(glance);
  assert.deepEqual([glance.a, glance.b], [2, 3]);
  // The contact point is between them, at mid height, in whole art pixels.
  assert.equal(glance.x, 315);
  assert.equal(glance.y, FLOOR - 9);
  assert.equal(a.dead || b.dead, false);
  assert.deepEqual([a.stun, b.stun], [STUN_STEPS, STUN_STEPS]);
  assert.equal(STUN_STEPS, 21);
  assert.deepEqual([a.regular, b.regular], [true, true]);
  assert.deepEqual([a.vx, b.vx], [-STUN_SPEED, STUN_SPEED]);
  assert.deepEqual([a.dashing, b.dashing], [false, false]);
  assert.deepEqual([lethal(a), lethal(b)], [false, false]);
  assert.deepEqual([a.attack, b.attack], [20, 20]);
  const view = viewOf(state).units[2];
  assert.deepEqual(
    [view?.stunned, view?.stun, view?.attacking, view?.dashing],
    [true, STUN_STEPS, false, false],
  );
  // Neither can attack while the glance stun lasts, however often they press.
  const events = run(state, STUN_STEPS - 1, () => both);
  assert.deepEqual(ofType(events, "attack"), []);
  assert.equal(a.facing, 1);
  assert.ok(a.x < 300 * S && b.x > 330 * S);
});

test("a glance throws both along the line between them, capped at 10 u/s on each axis", () => {
  const state = bare();
  const low = put(state, 2, 300, 200, { ...SWING, facing: 1 });
  const high = put(state, 3, 312, 196, { ...SWING, facing: -1 });
  resolveCombat(state);
  assert.equal(ofType(state.events, "glance").length, 1);
  assert.equal(low.vx, -STUN_SPEED);
  assert.equal(high.vx, STUN_SPEED);
  // Four pixels of height in twelve of distance: a third of the 30 u/s throw is still the cap.
  assert.equal(high.vy, -STUN_SPEED);
  assert.equal(low.vy, STUN_SPEED);
  // Stacked on the same x they part by slot.
  const stacked = bare();
  const a = put(stacked, 2, 300, 200, { ...SWING, facing: 1 });
  const b = put(stacked, 3, 300, 200, { ...SWING, facing: -1 });
  b.x += 1;
  resolveCombat(stacked);
  assert.ok(a.vx < 0 && b.vx > 0);
});

test("a sword in the back kills even an attacker: no glance unless the two face each other", () => {
  const state = bare();
  const chaser = put(state, 2, 300, 200, { ...SWING, facing: 1 });
  const runner = put(state, 3, 310, 200, { ...SWING, facing: 1 });
  resolveCombat(state);
  assert.deepEqual(state.events, [{ type: "kill", victim: 3, killer: 2 }]);
  assert.equal(runner.dead, true);
  assert.equal(chaser.dead, false);
  // Killing the dead again changes nothing.
  resolveCombat(state);
  assert.equal(state.events.length, 1);
});

test("a swing at a Warrior that is not attacking kills it, and it comes back as a plain Worker", () => {
  const state = bare();
  put(state, 2, 300, 200, { ...SWING, facing: 1 });
  const idle = put(state, 3, 310, 200, {
    kind: "warrior",
    speed: true,
    facing: -1,
  });
  resolveCombat(state);
  assert.deepEqual(state.events, [{ type: "kill", victim: 3, killer: 2 }]);
  assert.equal(idle.kind, "worker");
  assert.equal(idle.speed, false);
  // A sword past its lethal window is no sword: the cooling-down attacker dies.
  const late = bare();
  const cooling = put(late, 2, 300, 200, {
    kind: "warrior",
    attack: WARRIOR_LETHAL + 1,
    facing: 1,
  });
  put(late, 3, 310, 200, { ...SWING, facing: -1 });
  resolveCombat(late);
  assert.equal(cooling.dead, true);
});

test("kills land in the step's turn order: the first team's strike first, and two killers of one victim credit the one served first", () => {
  // A step the coin gives to team 1: slot 3 kills slot 4 and slot 2 kills slot 5, 3's kill first.
  const state = bare();
  for (state.step = 1; firstTeam(state) !== 1; state.step += 1);
  put(state, 3, 300, 200, { ...SWING, facing: 1 });
  const worker = put(state, 4, 308, 200);
  put(state, 2, 400, 200, { ...SWING, facing: 1 });
  const other = put(state, 5, 408, 200);
  resolveCombat(state);
  assert.deepEqual(ofType(state.events, "kill"), [
    { type: "kill", victim: 4, killer: 3 },
    { type: "kill", victim: 5, killer: 2 },
  ]);
  assert.equal(worker.dead && other.dead, true);
  // Queen and Warrior of one team strike one Worker on the same step: one kill, credited by the turn order.
  for (const coin of [0, 1]) {
    const shared = bare();
    for (shared.step = 1; firstTeam(shared) !== coin; shared.step += 1);
    put(shared, 0, 300, 200, { attack: 2, dashing: true, facing: 1 });
    put(shared, 2, 299, 200, { ...SWING, facing: 1 });
    const victim = put(shared, 3, 305, 200);
    resolveCombat(shared);
    const killer = turnOrder(shared).find((slot) => slot === 0 || slot === 2);
    assert.deepEqual(ofType(shared.events, "kill"), [
      { type: "kill", victim: 3, killer: killer! },
    ]);
    assert.equal(victim.dead, true);
  }
});

test("two swords that pass each other's guard kill each other on the same step", () => {
  const state = bare();
  // Point-blank, a Queen's thin dash blade is already past the Warrior's sword: each finds the other's body.
  const queen = put(state, 0, 300, 200, {
    attack: 2,
    dashing: true,
    facing: 1,
  });
  const warrior = put(state, 3, 304, 200, { ...SWING, facing: -1 });
  resolveCombat(state);
  assert.deepEqual(ofType(state.events, "glance"), []);
  assert.equal(ofType(state.events, "kill").length, 2);
  assert.equal(queen.dead && warrior.dead, true);
  assert.equal(state.eggs[0], QUEEN_EGGS - 1);
});

test("bodies that meet side by side bump: both are stunned and thrown apart, nobody dies", () => {
  const state = bare();
  const a = put(state, 2, 300, 200, { kind: "warrior", vx: 500 });
  const b = put(state, 3, 304, 200, { kind: "warrior", vx: -500 });
  resolveCombat(state);
  assert.deepEqual(state.events, [
    { type: "bounce", a: 2, b: 3, x: 302, y: 192 },
  ]);
  assert.deepEqual([a.vx, b.vx], [-STUN_SPEED, STUN_SPEED]);
  assert.deepEqual([a.stun, b.stun], [STUN_STEPS, STUN_STEPS]);
  assert.deepEqual([a.regular, b.regular], [false, false]);
  // Already parting, they are left alone: one bump per contact.
  resolveCombat(state);
  assert.equal(state.events.length, 1);
  // Workers bump enemies too, and a Worker bumps a Queen; teammates pass through each other.
  const mixed = bare();
  const worker = stand(mixed, 2, 300, FLOOR, { vx: 300 });
  const queen = stand(mixed, 1, 303, FLOOR);
  stand(mixed, 4, 301, FLOOR, { vx: -300 });
  resolveCombat(mixed);
  assert.deepEqual(
    mixed.events.map((event) => event.type),
    ["bounce"],
  );
  assert.equal(worker.vx, -STUN_SPEED);
  assert.equal(queen.vx, STUN_SPEED);
  assert.equal(unitOf(mixed, 4).stun, 0);
  // On the same x they part by slot.
  const stacked = bare();
  const low = put(stacked, 2, 300, 200, { kind: "warrior" });
  const high = put(stacked, 3, 300, 200, { kind: "warrior", vx: -1 });
  resolveCombat(stacked);
  assert.deepEqual([low.vx, high.vx], [-STUN_SPEED, STUN_SPEED]);
});

test("a bump stun lets a Warrior dash at once, which clears the stun; it ends a dash but not a dive", () => {
  const state = bare();
  const a = put(state, 2, 300, 200, { kind: "warrior", vx: 500, facing: 1 });
  put(state, 3, 304, 200, { kind: "warrior", vx: -500, facing: -1 });
  resolveCombat(state);
  assert.equal(a.stun, STUN_STEPS);
  stepRound(state, controls({ 2: { attack: true } }));
  assert.equal(ofType(state.events, "attack").length, 1);
  assert.equal(a.stun, 0);
  // The sword is out point-blank: the other, still stunned, dies.
  assert.deepEqual(ofType(state.events, "kill"), [
    { type: "kill", victim: 3, killer: 2 },
  ]);

  // A dash that runs into a body (its sword already past) ends.
  const dash = bare();
  const dasher = put(dash, 2, 300, 200, {
    kind: "warrior",
    attack: WARRIOR_LETHAL + 1,
    dashing: true,
    vx: 500,
  });
  put(dash, 3, 304, 200, { kind: "warrior", vx: -500, invuln: 0 });
  resolveCombat(dash);
  assert.equal(dasher.dashing, false);
  assert.equal(ofType(dash.events, "bounce").length, 1);

  // A diving Queen bumped from the side, her blade touching nothing, goes on diving.
  const dive = bare();
  const queen = put(dive, 0, 300, 200, { diving: true, vx: 300 });
  const beside = put(dive, 3, 304, 189, { kind: "warrior", vx: -300 });
  resolveCombat(dive);
  assert.equal(ofType(dive.events, "bounce").length, 1);
  assert.equal(beside.dead, false);
  assert.equal(queen.diving, true);
  assert.equal(queen.stun, STUN_STEPS);
});

test("landing on an enemy's head is a bounce, not a kill: both spring apart, nobody is stunned", () => {
  assert.equal(HEAD_OVERLAP, Math.round(0.2 * UNIT));
  const state = bare();
  const lower = stand(state, 3, 300, FLOOR);
  const upper = put(state, 2, 301, 0, { vy: 1000 });
  upper.y = FLOOR * S - WORKER_HEIGHT + S;
  resolveCombat(state);
  assert.deepEqual(state.events, [
    { type: "stomped", slot: 3, by: 2, x: 300, y: Math.trunc(upper.y / S) },
  ]);
  // Restitution 4, equal masses: the closing speed turned round fourfold, shared.
  assert.equal(upper.vy, 1000 - 2500);
  assert.equal(lower.vy, 2500);
  assert.deepEqual([upper.stun, lower.stun], [0, 0]);
  assert.equal(upper.dead || lower.dead, false);
  // Now parting: nothing more.
  resolveCombat(state);
  assert.equal(state.events.length, 1);
  // The same with the higher slot on top, and a Warrior under a Queen.
  const mirror = bare();
  const below = put(mirror, 2, 300, 200, { kind: "warrior", vy: -200 });
  const queen = put(mirror, 1, 300, 0, { vy: 300 });
  queen.y = below.y - arenaHeight(below) + S;
  resolveCombat(mirror);
  assert.deepEqual(
    mirror.events.map((event) => event.type),
    ["stomped"],
  );
  assert.equal(queen.vy, 300 - 1250);
  assert.equal(below.vy, -200 + 1250);
  // Deeper than 0.2 u it is a bump, when they close in sideways.
  const deep = bare();
  put(deep, 2, 300, 200, { kind: "warrior", vx: 100 });
  const sunk = put(deep, 3, 301, 0, { kind: "warrior" });
  sunk.y = 200 * S - arenaHeight(sunk) + HEAD_OVERLAP + S;
  resolveCombat(deep);
  assert.deepEqual(
    deep.events.map((event) => event.type),
    ["bounce"],
  );
});

/** The height of the unit's movement box right now. */
function arenaHeight(unit: Unit): number {
  return unit.kind === "warrior" ? 16127 : WORKER_HEIGHT;
}

test("invulnerable units, Workers locked in a gate or a hive hole, and the snail's meal take no part", () => {
  const cases: Partial<Unit>[] = [
    { invuln: 50 },
    { gate: 1, gateProgress: GATE_OFFER },
    { deposit: 3 },
    { eaten: true },
  ];
  for (const patch of cases) {
    const state = bare();
    put(state, 2, 300, 200, { ...SWING, facing: 1, vx: 500 });
    const safe = put(state, 3, 306, 200, { vx: -500, ...patch });
    assert.equal(exposed(safe), false);
    resolveCombat(state);
    assert.deepEqual(state.events, []);
    assert.equal(safe.dead, false);
  }
  // An invulnerable attacker cannot hit either.
  const state = bare();
  put(state, 2, 300, 200, { ...SWING, facing: 1, invuln: 20 });
  const worker = put(state, 3, 306, 200);
  resolveCombat(state);
  assert.equal(worker.dead, false);
  // A Worker still offering its berry to a gate is fair game.
  const offering = bare();
  put(offering, 2, 300, 200, { ...SWING, facing: 1 });
  const early = put(offering, 3, 306, 200, {
    gate: 1,
    gateProgress: GATE_OFFER - 1,
  });
  assert.equal(exposed(early), true);
  resolveCombat(offering);
  assert.equal(early.dead, true);
});

test("a snail rider can be killed but neither bumps nor is bumped", () => {
  const state = bare();
  const rider = stand(state, 3, 300, FLOOR, { riding: true });
  const walker = stand(state, 2, 303, FLOOR, { vx: -400 });
  resolveCombat(state);
  assert.deepEqual(state.events, []);
  Object.assign(walker, { ...SWING, facing: -1 });
  resolveCombat(state);
  assert.equal(rider.dead, true);
});

test("a Worker killed while carrying drops its berry where it stood", () => {
  const state = bare();
  stand(state, 2, 300, FLOOR, { ...SWING, facing: 1 });
  const worker = stand(state, 3, 308, FLOOR, { carrying: true });
  resolveCombat(state);
  assert.deepEqual(
    state.events.map((event) => event.type),
    ["berryDrop", "kill"],
  );
  assert.equal(worker.carrying, false);
  assert.equal(state.loose.length, 1);
  assert.equal(state.loose[0]?.x, worker.x);
  assert.equal(state.loose[0]?.by, 3);
});

test("a diving Queen kills whatever her blade touches, whichever way she faces, and keeps diving", () => {
  const state = bare();
  const queen = put(state, 0, 315, 150, { facing: -1 });
  const hung = put(state, 3, 316, 195, { kind: "warrior" });
  stand(state, 5, 317, FLOOR);
  const down = controls({ 0: { down: true } });
  const killed: number[] = [];
  for (let i = 0; i < 60 && queen.ground < 0; i += 1) {
    // The Warrior hovers in mid-air for her to pass.
    hung.y = 195 * S;
    hung.vy = 0;
    stepRound(state, down);
    for (const event of ofType(state.events, "kill")) {
      assert.equal(event.killer, 0);
      killed.push(event.victim);
      assert.equal(queen.diving, true);
    }
  }
  assert.deepEqual(killed, [3, 5]);
  assert.equal(queen.dead, false);
  assert.equal(queen.y, FLOOR * S);
  assert.deepEqual(ofType(state.events, "stomped"), []);
});

test("a dive onto a sword pointing at her is a glance; onto a swordsman facing away it is a kill", () => {
  const state = bare();
  const queen = put(state, 0, 300, 196, { diving: true, facing: 1 });
  const warrior = put(state, 3, 306, 200, { ...SWING, facing: -1 });
  resolveCombat(state);
  assert.deepEqual(
    state.events.map((event) => event.type),
    ["glance"],
  );
  // The glance ends her dive and both attacks.
  assert.equal(queen.diving, false);
  assert.equal(lethal(warrior), false);
  const back = bare();
  put(back, 0, 300, 196, { diving: true, facing: 1 });
  const away = put(back, 3, 302, 200, { ...SWING, facing: 1 });
  resolveCombat(back);
  assert.equal(away.dead, true);
});

test("a Queen has three lives: each death costs an egg, she hatches in the air above the next egg, and the third death is a military victory that freezes the round", () => {
  const state = bare();
  const queen = stand(state, 1, 240, FLOOR);
  assert.deepEqual(viewOf(state).hatching, [-1, -1]);
  for (let life = QUEEN_EGGS; life > 0; life -= 1) {
    stand(state, 1, 330, FLOOR, { invuln: 0 });
    put(state, 2, 322, FLOOR, { ...SWING, facing: 1 });
    stepRound(state, []);
    assert.deepEqual(ofType(state.events, "queenKill"), [
      { type: "queenKill", victim: 1, killer: 2, eggsLeft: life - 1 },
    ]);
    assert.equal(state.eggs[1], life - 1);
    if (life > 1) {
      assert.equal(state.winner, null);
      const index = QUEEN_EGGS - life;
      // The view names the egg she will hatch from, and keeps it standing until she does.
      assert.deepEqual(viewOf(state).hatching, [-1, index]);
      assert.equal(viewOf(state).spares[1]?.[index]?.present, true);
      put(state, 2, 20, 40, { kind: "warrior" });
      const events = run(state, RESPAWN_STEPS);
      assert.deepEqual(ofType(events, "respawn"), [
        { type: "respawn", slot: 1, egg: index },
      ]);
      const egg = arenaOf(1).eggSpots[1][index];
      assert.ok(egg);
      assert.deepEqual([queen.x, queen.y], [egg.x, egg.y - HATCH_LIFT]);
      assert.equal(queen.ground, -1);
      assert.equal(queen.invuln, RESPAWN_INVULN);
      assert.deepEqual(viewOf(state).hatching, [-1, -1]);
      assert.deepEqual(
        viewOf(state).spares[1]?.map((spare) => spare.present),
        [false, life > 2],
      );
    }
  }
  assert.deepEqual(state.winner, { team: 0, kind: "military" });
  assert.deepEqual(state.events.at(-1), {
    type: "victory",
    team: 0,
    kind: "military",
  });
  assert.deepEqual(viewOf(state).hatching, [-1, -1]);
  const step = state.step;
  stepRound(state, []);
  assert.equal(state.step, step);
  assert.deepEqual(state.events, []);
});

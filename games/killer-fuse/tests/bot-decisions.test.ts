import test from "node:test";
import assert from "node:assert/strict";
import {
  BOT_LEVELS,
  BOT_LEVEL_ORDER,
  MAPS,
  S,
  TICK_HZ,
  cloneRound,
  stepRound,
  type BotGoal,
  type BotLevel,
  type BotMind,
  type MapId,
  type Round,
} from "../src/engine/index.js";
import { hashSeed } from "../src/engine/rng.js";
import { bare, ofType, put, run, stand, unitOf } from "./engine-kit.js";

const MAP = MAPS[1];
const FLOOR = 258;

/** A round with nobody on the map, whose bots (once woken) play at `level`. */
function botRound(level: BotLevel, mapId: MapId = 1): Round {
  const state = bare(mapId);
  state.teamLevels = [level, level];
  return state;
}

/** Hands `slot` to a bot that decides on the next step, with the given plan for the round. */
function wake(
  state: Round,
  slot: number,
  plan: Partial<BotMind> = {},
): BotMind {
  state.humans[slot] = false;
  const mind = state.bots[slot];
  assert.ok(mind);
  Object.assign(mind, { think: 1, soldier: false, rider: false, ...plan });
  return mind;
}

/**
 * What `slot` decides from exactly this position. A decision rolls dice (a hard bot still plays the simple move 4% of
 * the time), so it is taken on nine copies with different dice and the most common outcome is returned.
 */
function decision(state: Round, slot: number): BotMind {
  const minds: BotMind[] = [];
  const counts = new Map<string, number>();
  for (let dice = 0; dice < 9; dice += 1) {
    const copy = cloneRound(state);
    copy.rng = hashSeed(dice, 99);
    stepRound(copy, []);
    const mind = copy.bots[slot];
    assert.ok(mind);
    minds.push(mind);
    const key = `${mind.goal}:${mind.target}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = minds[0];
  assert.ok(best);
  for (const mind of minds)
    if (
      (counts.get(`${mind.goal}:${mind.target}`) ?? 0) >
      (counts.get(`${best.goal}:${best.target}`) ?? 0)
    )
      best = mind;
  return best;
}

const goalOf = (state: Round, slot: number): BotGoal =>
  decision(state, slot).goal;

test("the levels get sharper from easy to hard, and never differ in what the rules allow", () => {
  assert.deepEqual(BOT_LEVEL_ORDER, ["easy", "medium", "hard"]);
  const [easy, medium, hard] = BOT_LEVEL_ORDER.map(
    (level) => BOT_LEVELS[level],
  );
  assert.ok(easy && medium && hard);
  for (const [worse, better] of [
    [easy, medium],
    [medium, hard],
  ] as const) {
    assert.ok(worse.think > better.think, "reaction delay");
    assert.ok(worse.aimError > better.aimError, "aim error");
    assert.ok(
      worse.flapMin + worse.flapJitter > better.flapMin + better.flapJitter,
      "flap precision",
    );
    assert.ok(worse.blunder > better.blunder, "blunders");
    assert.ok(worse.smart < better.smart, "decision quality");
    assert.ok(worse.lead < better.lead, "leading a target");
    assert.ok(worse.awareness < better.awareness, "awareness");
  }
  assert.equal(hard.blunder, 0);
});

test("an empty-handed Worker goes for the nearest berries: a pile, or a loose berry that is closer", () => {
  const state = botRound("hard");
  stand(state, 2, 300, FLOOR);
  wake(state, 2);
  const mind = decision(state, 2);
  assert.equal(mind.goal, "gather");
  assert.equal(MAP.piles[mind.target]?.x, 350);
  assert.equal(mind.tx, 350 * S);
  state.loose.push({
    x: 290 * S,
    y: FLOOR * S,
    vx: 0,
    vy: 0,
    resting: true,
    wait: 0,
    by: 3,
  });
  const second = decision(state, 2);
  assert.equal(second.goal, "gather");
  assert.equal(second.target, MAP.piles.length);
  assert.equal(second.tx, 290 * S);
  // A berry still bouncing is not yet worth walking to.
  const berry = state.loose[0];
  assert.ok(berry);
  berry.resting = false;
  assert.equal(decision(state, 2).target, 2);
});

test("a carrying Worker follows its plan: the warrior gate, the speed gate, or home to an empty hole", () => {
  const state = botRound("hard");
  stand(state, 2, 300, FLOOR, { carrying: true });
  wake(state, 2);
  const bank = decision(state, 2);
  assert.equal(bank.goal, "bank");
  assert.equal(state.holes[0]?.[bank.target], false);

  wake(state, 2, { soldier: true });
  const soldier = decision(state, 2);
  assert.equal(soldier.goal, "gate");
  assert.equal(MAP.gates[soldier.target]?.kind, "warrior");

  wake(state, 2, { rider: true });
  const rider = decision(state, 2);
  assert.equal(rider.goal, "gate");
  assert.equal(MAP.gates[rider.target]?.kind, "speed");
  // Already fast: the berry goes home.
  unitOf(state, 2).speed = true;
  assert.equal(goalOf(state, 2), "bank");

  // Every warrior gate belongs to the other Queen: nothing to do there.
  wake(state, 2, { soldier: true });
  for (const gate of state.gates) gate.owner = 1;
  assert.equal(goalOf(state, 2), "bank");

  // The nearest empty hole is the one aimed for; a full hive still sends the Worker home.
  const holes = state.holes[0];
  assert.ok(holes);
  holes.fill(true);
  assert.equal(goalOf(state, 2), "bank");
});

test("a rider heads for a free snail, and anyone does once the berries are gone", () => {
  const state = botRound("hard");
  stand(state, 4, 300, FLOOR);
  wake(state, 4, { rider: true });
  assert.equal(goalOf(state, 4), "ride");
  // Just off the snail: gather until it may mount again.
  unitOf(state, 4).mountWait = 30;
  assert.equal(goalOf(state, 4), "gather");
  wake(state, 4);
  unitOf(state, 4).mountWait = 0;
  state.piles.fill(0);
  assert.equal(goalOf(state, 4), "ride");
  // A team-mate has it and there is nothing to carry: wait at the spawn.
  stand(state, 2, 240, FLOOR, { riding: true });
  state.snail.rider = 2;
  const idle = decision(state, 4);
  assert.equal(idle.goal, "idle");
  assert.equal(idle.tx, (MAP.spawns[4]?.x ?? 0) * S);
});

test("a Worker runs from a military unit close by, unless it is invulnerable or an easy bot", () => {
  const state = botRound("hard");
  stand(state, 2, 300, FLOOR);
  put(state, 3, 312, 250, { kind: "warrior" });
  wake(state, 2);
  const flee = decision(state, 2);
  assert.equal(flee.goal, "flee");
  assert.equal(flee.target, 3);
  assert.ok(flee.tx < 300 * S, "away from the threat");
  unitOf(state, 3).x = 288 * S;
  assert.ok(decision(state, 2).tx > 300 * S);
  unitOf(state, 2).invuln = 60;
  assert.equal(goalOf(state, 2), "gather");
  unitOf(state, 2).invuln = 0;
  unitOf(state, 3).x = 380 * S;
  assert.equal(goalOf(state, 2), "gather");

  const easy = botRound("easy");
  stand(easy, 2, 300, FLOOR);
  put(easy, 3, 312, 250, { kind: "warrior" });
  wake(easy, 2);
  assert.notEqual(goalOf(easy, 2), "flee");
});

test("against an enemy rider the nearest free Worker walks into the snail's mouth; the other keeps gathering", () => {
  const state = botRound("hard");
  stand(state, 3, 240, FLOOR, { riding: true });
  state.snail.rider = 3;
  stand(state, 2, 290, FLOOR);
  stand(state, 4, 100, FLOOR);
  wake(state, 2);
  wake(state, 4);
  const stall = decision(state, 2);
  assert.equal(stall.goal, "stall");
  assert.equal(stall.target, 3);
  assert.ok(stall.tx > state.snail.x, "in front of a snail heading right");
  assert.equal(goalOf(state, 4), "gather");
  // The stalling Worker really is eaten, which halts the snail.
  const events = run(state, 6 * TICK_HZ);
  assert.deepEqual(
    ofType(events, "snailEat").map((event) => event.victim),
    [2],
  );
});

test("a Queen claims gates, hunts Workers and riders, takes an opening below and gets out from under a threat", () => {
  const state = botRound("hard");
  put(state, 0, 160, 60);
  wake(state, 0);
  const claim = decision(state, 0);
  assert.equal(claim.goal, "claim");
  assert.equal(MAP.gates[claim.target]?.kind, "warrior");
  assert.equal(claim.dive, false);

  // Nothing left to claim and nobody to fight: she watches over her hive.
  for (const gate of state.gates) gate.owner = 0;
  const guard = decision(state, 0);
  assert.equal(guard.goal, "guard");
  assert.ok(guard.tx < 240 * S);

  // An enemy Worker is prey; one in a gate or with a berry is worth a longer flight than one without.
  stand(state, 3, 300, FLOOR);
  stand(state, 5, 200, FLOOR);
  assert.deepEqual(
    [decision(state, 0).goal, decision(state, 0).target],
    ["hunt", 5],
  );
  unitOf(state, 3).carrying = true;
  unitOf(state, 3).x = 250 * S;
  assert.equal(decision(state, 0).target, 3);
  // A freshly respawned Worker cannot be killed, so it is not prey.
  unitOf(state, 3).invuln = 60;
  assert.equal(decision(state, 0).target, 5);
  unitOf(state, 3).invuln = 0;

  // The enemy's rider comes before any other Worker.
  unitOf(state, 5).riding = true;
  state.snail.rider = 5;
  assert.equal(decision(state, 0).target, 5);
  state.snail.rider = -1;
  unitOf(state, 5).riding = false;

  // A Warrior below her is an opening, and she may dive on it.
  put(state, 3, 170, 110, { kind: "warrior" });
  const strike = decision(state, 0);
  assert.deepEqual(
    [strike.goal, strike.target, strike.dive],
    ["hunt", 3, true],
  );
  // The same Warrior above her is a threat: out sideways and up.
  put(state, 3, 170, 40, { kind: "warrior" });
  const evade = decision(state, 0);
  assert.deepEqual([evade.goal, evade.target], ["evade", 3]);
  assert.ok(evade.tx < 160 * S);
  unitOf(state, 3).x = 150 * S;
  assert.ok(decision(state, 0).tx > 160 * S);
  // While she cannot be hurt she ignores it.
  unitOf(state, 0).invuln = 60;
  assert.notEqual(goalOf(state, 0), "evade");
});

test("a Queen down to her last egg keeps further from Warriors and leaves a guarded gate alone", () => {
  const state = botRound("hard");
  put(state, 0, 160, 100);
  wake(state, 0);
  // A Warrior 55 px off and slightly above: out of mind for a fresh Queen, a threat for a careful one.
  put(state, 3, 215, 92, { kind: "warrior" });
  assert.equal(goalOf(state, 0), "claim");
  state.eggs[0] = 1;
  assert.equal(goalOf(state, 0), "evade");

  // The centre gate with a Warrior sitting on it is not worth the risk; another gate is.
  const guarded = botRound("hard");
  const centre = MAP.gates.findIndex((gate) => gate.x === 240);
  put(guarded, 0, 240, 60);
  wake(guarded, 0);
  assert.equal(decision(guarded, 0).target, centre);
  put(guarded, 3, 240, 126, { kind: "warrior", ground: -1 });
  guarded.eggs[0] = 1;
  const choice = decision(guarded, 0);
  assert.ok(choice.goal !== "claim" || choice.target !== centre);
});

test("a Warrior goes after Workers first and the enemy Queen when there are none", () => {
  const state = botRound("hard");
  put(state, 2, 100, 200, { kind: "warrior" });
  put(state, 1, 400, 60);
  wake(state, 2);
  const royal = decision(state, 2);
  assert.deepEqual([royal.goal, royal.target, royal.dive], ["hunt", 1, false]);
  stand(state, 3, 300, FLOOR);
  assert.equal(decision(state, 2).target, 3);
  // Alone on the map it returns to its hive.
  unitOf(state, 1).dead = true;
  unitOf(state, 3).dead = true;
  assert.equal(goalOf(state, 2), "guard");
});

test("a dead bot forgets its plan, and a blundering easy bot stands still for a moment", () => {
  const state = botRound("hard");
  stand(state, 2, 300, FLOOR);
  const mind = wake(state, 2);
  stepRound(state, []);
  assert.notEqual(mind.goal, "idle");
  const unit = unitOf(state, 2);
  unit.dead = true;
  unit.respawn = 1000;
  mind.edge = 3;
  stepRound(state, []);
  assert.deepEqual(
    [mind.goal, mind.edge, mind.edgeStep, mind.think],
    ["idle", -1, 0, 1],
  );

  const easy = botRound("easy");
  stand(easy, 2, 300, FLOOR);
  const slow = wake(easy, 2);
  let frozen = 0;
  for (let step = 0; step < 40 * TICK_HZ; step += 1) {
    const before = unitOf(easy, 2).x;
    const idle = slow.idle > 1;
    stepRound(easy, []);
    if (idle && unitOf(easy, 2).ground >= 0) {
      frozen += 1;
      assert.ok(Math.abs(unitOf(easy, 2).x - before) <= S, "no new input");
    }
  }
  assert.ok(frozen > 0, "an easy bot blunders within 40 s");
  const hard = botRound("hard");
  stand(hard, 2, 300, FLOOR);
  const sharp = wake(hard, 2);
  for (let step = 0; step < 20 * TICK_HZ; step += 1) {
    stepRound(hard, []);
    assert.equal(sharp.idle, 0);
  }
});

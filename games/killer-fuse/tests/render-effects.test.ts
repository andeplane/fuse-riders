import test from "node:test";
import assert from "node:assert/strict";
import type { GameEvent, RoundView } from "../src/engine/index.js";
import {
  EventLedger,
  bodyLift,
  eventKey,
  mergePlans,
  planEvent,
  planFlap,
  type Plan,
} from "../src/render/effects.js";
import { openingView, SIZES, unitView, withUnit } from "./render-kit.js";

const withEvents = (
  view: RoundView,
  step: number,
  events: GameEvent[],
): RoundView => ({
  ...view,
  step,
  events,
});
const kinds = (plan: Plan): string[] =>
  plan.effects.map((effect) => effect.kind);
const sounds = (plan: Plan): string[] => plan.sounds.map((cue) => cue.name);

test("a step fed again does not fire its events twice", () => {
  const ledger = new EventLedger();
  const kill: GameEvent = { type: "kill", victim: 1, killer: 3 };
  const view = withEvents(openingView(), 40, [kill, { type: "berryRegrow" }]);
  assert.deepEqual(ledger.fresh(view), view.events);
  assert.deepEqual(ledger.fresh(view), []);
  assert.deepEqual(ledger.fresh({ ...view, events: [...view.events] }), []);
});

test("a rollback that changes what happened on a step shows the new outcome only", () => {
  const ledger = new EventLedger();
  const first: GameEvent = { type: "kill", victim: 1, killer: 3 };
  const second: GameEvent = { type: "kill", victim: 3, killer: 1 };
  const base = openingView();
  assert.equal(ledger.fresh(withEvents(base, 40, [first])).length, 1);
  assert.equal(ledger.fresh(withEvents(base, 41, [])).length, 0);
  assert.deepEqual(ledger.fresh(withEvents(base, 40, [first, second])), [
    second,
  ]);
  assert.deepEqual(
    ledger.fresh(withEvents(base, 41, [first])),
    [first],
    "the same event on another step is another event",
  );
  assert.notEqual(eventKey(40, first), eventKey(40, second));
  assert.equal(eventKey(40, first), "40:kill,1,3");
});

test("flaps are reported once per unit and step, and never for the dead", () => {
  const ledger = new EventLedger();
  let view = withUnit(openingView(), 0, { flapped: true });
  view = withUnit(view, 2, { flapped: true, dead: true });
  view = withUnit(view, 4, { flapped: true });
  view = { ...view, step: 12 };
  assert.deepEqual(ledger.freshFlaps(view), [0, 4]);
  assert.deepEqual(ledger.freshFlaps(view), []);
  assert.deepEqual(ledger.freshFlaps({ ...view, step: 13 }), [0, 4]);
});

test("a new round forgets the old one and old steps are dropped", () => {
  const ledger = new EventLedger(10);
  const kill: GameEvent = { type: "kill", victim: 1, killer: 3 };
  const base = openingView();
  for (let step = 1; step <= 60; step += 1)
    assert.equal(ledger.fresh(withEvents(base, step, [kill])).length, 1);
  assert.ok(ledger.size <= 41, `kept ${ledger.size}`);
  assert.equal(ledger.fresh(withEvents(base, 55, [kill])).length, 0);
  // Far behind the newest step: a new round, where step 1 happens again.
  assert.equal(ledger.fresh(withEvents(base, 1, [kill])).length, 1);
  assert.equal(ledger.size, 1);
  assert.equal(ledger.fresh(withEvents(base, 2, [kill])).length, 1);
});

test("a kill bursts in the victim's colour and shakes more for the local player", () => {
  const view = withUnit(openingView(), 4, { x: 400, y: 120, kind: "worker" });
  const event: GameEvent = { type: "kill", victim: 4, killer: 0 };
  const plan = planEvent(event, view, -1, SIZES);
  assert.deepEqual(kinds(plan), ["sprite", "burst"]);
  const [sprite] = plan.effects;
  assert.ok(sprite?.kind === "sprite");
  assert.equal(
    sprite.sheet,
    `kill-burst-${view.units[4]?.team === 1 ? "pink" : "cyan"}`,
  );
  assert.equal(sprite.x, 400);
  assert.equal(sprite.y, 120 - SIZES.worker / 2);
  assert.deepEqual(sounds(plan), ["kill"]);
  assert.ok((plan.sounds[0]?.pan ?? 0) > 0, "heard from the right");
  assert.equal(plan.sounds[0]?.volume, 0.55);
  const mine = planEvent(event, view, 0, SIZES);
  assert.equal(mine.sounds[0]?.volume, 1);
  assert.ok(mine.shake > plan.shake);
  assert.ok(mine.hitStop > plan.hitStop);
});

test("a Queen's death is the biggest thing on the screen, and only once", () => {
  const view = withUnit(openingView(), 0, { x: 240, y: 100 });
  assert.equal(view.units[0]?.kind, "queen");
  const kill = planEvent(
    { type: "kill", victim: 0, killer: 3 },
    view,
    -1,
    SIZES,
  );
  assert.equal(kill.effects.length, 0, "the kill event leaves it to queenKill");
  const plan = planEvent(
    { type: "queenKill", victim: 0, killer: 3, eggsLeft: 2 },
    view,
    -1,
    SIZES,
  );
  assert.deepEqual(kinds(plan), ["sprite", "burst", "burst", "ring", "ring"]);
  assert.equal(plan.shake, 1);
  assert.ok(plan.hitStop >= 100);
  assert.ok(plan.flash > 0);
  assert.deepEqual(sounds(plan), ["queenKill"]);
  assert.equal(plan.sounds[0]?.pan, 0);
  assert.equal(bodyLift(unitView({ kind: "queen" }), SIZES), 9);
  assert.equal(bodyLift(unitView(), SIZES), 8);
});

test("every event has a plan, and events about missing things are silent", () => {
  const view = openingView();
  const events: GameEvent[] = [
    { type: "bounce", a: 0, b: 3 },
    { type: "bump", worker: 1, target: 4 },
    { type: "berryPickup", slot: 1, pile: 0 },
    { type: "berryKick", slot: 1 },
    { type: "berryDeposit", slot: 1, team: 0, hole: 2 },
    { type: "berryKickIn", slot: 1, team: 1, hole: 0 },
    { type: "berryRegrow" },
    { type: "gateUse", slot: 1, gate: 0, kind: "warrior" },
    { type: "gateUse", slot: 1, gate: 0, kind: "speed" },
    { type: "gateClaim", slot: 0, gate: 1, team: 1 },
    { type: "snailMount", slot: 1 },
    { type: "snailEat", victim: 4, rider: 1 },
    { type: "respawn", slot: 2 },
    { type: "victory", team: 0, kind: "military" },
  ];
  for (const event of events) {
    const plan = planEvent(event, view, 1, SIZES);
    assert.equal(plan.sounds.length, 1, event.type);
    for (const cue of plan.sounds) {
      assert.ok(cue.volume > 0 && cue.volume <= 1, event.type);
      assert.ok(cue.pan >= -1 && cue.pan <= 1, event.type);
    }
    assert.ok(plan.shake >= 0 && plan.shake <= 1, event.type);
  }
  const silent: GameEvent[] = [
    { type: "berryDrop", slot: 1 },
    { type: "snailFree", victim: 1 },
    { type: "kill", victim: 9, killer: 0 },
    { type: "queenKill", victim: 9, killer: 0, eggsLeft: 1 },
    { type: "bounce", a: 9, b: 0 },
    { type: "bounce", a: 0, b: 9 },
    { type: "bump", worker: 0, target: 9 },
    { type: "berryPickup", slot: 9, pile: 0 },
    { type: "berryKick", slot: 9 },
    { type: "berryDeposit", slot: 1, team: 0, hole: 99 },
    { type: "berryKickIn", slot: 1, team: 7, hole: 0 },
    { type: "gateUse", slot: 1, gate: 99, kind: "speed" },
    { type: "gateUse", slot: 9, gate: 0, kind: "speed" },
    { type: "gateClaim", slot: 1, gate: 99, team: 0 },
    { type: "respawn", slot: 9 },
  ];
  for (const event of silent) {
    const plan = planEvent(event, view, 1, SIZES);
    assert.equal(
      plan.effects.length + plan.sounds.length,
      0,
      JSON.stringify(event),
    );
  }
});

test("each kind of victory has its own sting", () => {
  const view = openingView();
  const sting = (kind: "military" | "economy" | "snail"): string | undefined =>
    planEvent({ type: "victory", team: 1, kind }, view, -1, SIZES).sounds[0]
      ?.name;
  assert.equal(sting("military"), "victoryMilitary");
  assert.equal(sting("economy"), "victoryEconomy");
  assert.equal(sting("snail"), "victorySnail");
});

test("effects land where the thing happened", () => {
  const base = openingView();
  const view = { ...base, berries: [3, 0] };
  const hole = view.hives[0]?.[2];
  assert.ok(hole);
  const deposit = planEvent(
    { type: "berryDeposit", slot: 1, team: 0, hole: 2 },
    view,
    -1,
    SIZES,
  );
  assert.deepEqual(
    kinds(deposit),
    ["sprite", "burst", "ring"],
    "no number: the hive's plaque counts",
  );
  const halo = deposit.effects[2];
  assert.ok(halo?.kind === "ring");
  assert.equal(halo.x, hole.x);
  const kickIn = planEvent(
    { type: "berryKickIn", slot: 1, team: 0, hole: 2 },
    view,
    -1,
    SIZES,
  );
  assert.ok(
    kickIn.shake > deposit.shake,
    "a kicked-in berry is the better trick",
  );

  const regrow = planEvent({ type: "berryRegrow" }, view, -1, SIZES);
  assert.equal(regrow.effects.length, view.piles.length);

  const gate = view.gates[0];
  assert.ok(gate);
  const use = planEvent(
    { type: "gateUse", slot: 1, gate: 0, kind: "speed" },
    view,
    -1,
    SIZES,
  );
  const burst = use.effects[1];
  assert.ok(burst?.kind === "burst");
  assert.equal(burst.tone, "gold");
  assert.equal(burst.x, gate.x);
  const warrior = planEvent(
    { type: "gateUse", slot: 1, gate: 0, kind: "warrior" },
    view,
    -1,
    SIZES,
  );
  const teamBurst = warrior.effects[1];
  assert.ok(teamBurst?.kind === "burst");
  assert.equal(teamBurst.tone, "team");
  const claim = planEvent(
    { type: "gateClaim", slot: 3, gate: 0, team: 1 },
    view,
    -1,
    SIZES,
  );
  const sparkle = claim.effects[0];
  assert.ok(sparkle?.kind === "sprite");
  assert.equal(sparkle.flip, true);

  const eat = planEvent(
    { type: "snailEat", victim: 9, rider: 1 },
    view,
    -1,
    SIZES,
  );
  const chew = eat.effects[0];
  assert.ok(chew?.kind === "burst");
  assert.equal(chew.team, -1, "an unknown victim still chews");
  const mount = planEvent({ type: "snailMount", slot: 9 }, view, -1, SIZES);
  const ring = mount.effects[0];
  assert.ok(ring?.kind === "ring");
  assert.equal(ring.team, -1);
  assert.equal(ring.x, view.snail.x);
});

test("a bounce across the wrap bursts at one of the two, not mid-screen", () => {
  let view = withUnit(openingView(), 0, { x: 4, y: 100 });
  view = withUnit(view, 3, { x: 476, y: 100 });
  const across = planEvent({ type: "bounce", a: 0, b: 3 }, view, -1, SIZES)
    .effects[0];
  assert.ok(across?.kind === "burst");
  assert.equal(across.x, 4);
  view = withUnit(view, 3, { x: 24, y: 100 });
  const near = planEvent({ type: "bounce", a: 0, b: 3 }, view, -1, SIZES)
    .effects[0];
  assert.ok(near?.kind === "burst");
  assert.equal(near.x, 14);
});

test("a flap puffs behind the wings and a jump under the feet", () => {
  const warrior = planFlap(
    unitView({ kind: "warrior", x: 100, y: 50, facing: -1 }),
    1,
  );
  const puff = warrior.effects[0];
  assert.ok(puff?.kind === "sprite");
  assert.equal(puff.sheet, "flap-puff");
  assert.equal(puff.x, 104);
  assert.equal(puff.flip, true);
  assert.deepEqual(sounds(warrior), ["flap"]);
  assert.equal(warrior.sounds[0]?.volume, 0.7);
  const worker = planFlap(unitView({ x: 100, y: 50 }), 5);
  const hop = worker.effects[0];
  assert.ok(hop?.kind === "sprite");
  assert.equal(hop.x, 100);
  assert.equal(hop.flip, false);
  assert.deepEqual(sounds(worker), ["jump"]);
  assert.ok(
    (worker.sounds[0]?.volume ?? 1) < 0.7,
    "someone else's jump is quiet",
  );
});

test("plans merge into one: everything in order, the strongest shake and freeze", () => {
  const view = openingView();
  const a = planEvent({ type: "kill", victim: 4, killer: 3 }, view, -1, SIZES);
  const b = planEvent(
    { type: "queenKill", victim: 0, killer: 3, eggsLeft: 1 },
    view,
    -1,
    SIZES,
  );
  const merged = mergePlans([a, b]);
  assert.equal(merged.effects.length, a.effects.length + b.effects.length);
  assert.deepEqual(sounds(merged), ["kill", "queenKill"]);
  assert.equal(merged.shake, 1);
  assert.equal(merged.hitStop, b.hitStop);
  assert.equal(merged.flash, b.flash);
  assert.deepEqual(mergePlans([]), {
    effects: [],
    sounds: [],
    shake: 0,
    hitStop: 0,
    flash: 0,
  });
});

test("a victory fires once a round, however often a rollback feeds it", () => {
  const ledger = new EventLedger();
  const base = openingView();
  const won: GameEvent = { type: "victory", team: 1, kind: "military" };
  assert.equal(ledger.fresh(withEvents(base, 900, [won])).length, 1);
  assert.equal(ledger.fresh(withEvents(base, 900, [won])).length, 0);
  assert.equal(
    ledger.fresh(withEvents(base, 903, [won])).length,
    0,
    "the same win on a later step after a rollback",
  );
  assert.equal(
    ledger.fresh(
      withEvents(base, 903, [{ type: "victory", team: 0, kind: "snail" }]),
    ).length,
    1,
    "a different outcome is news",
  );
  ledger.clear();
  assert.equal(ledger.size, 0);
  assert.equal(
    ledger.fresh(withEvents(base, 40, [won])).length,
    1,
    "a new round can be won the same way",
  );
});

test("effects sit on the art's measured sizes", () => {
  const view = withUnit(openingView(), 1, { x: 100, y: 200, kind: "queen" });
  const tall = { ...SIZES, queen: 40, gate: 60, snail: 30, snailFront: 33 };
  const at = (event: GameEvent, sizes = SIZES) =>
    planEvent(event, view, -1, sizes).effects.find(
      (effect) => effect.kind === "burst",
    );
  const kill: GameEvent = {
    type: "queenKill",
    victim: 1,
    killer: 3,
    eggsLeft: 1,
  };
  assert.equal(at(kill)?.y, 200 - 9);
  assert.equal(at(kill, tall)?.y, 200 - 20);
  const gate = view.gates[0];
  assert.ok(gate);
  const use: GameEvent = {
    type: "gateUse",
    slot: 1,
    gate: 0,
    kind: "warrior",
  };
  assert.equal(at(use)?.y, gate.y - SIZES.gate / 2);
  assert.equal(at(use, tall)?.y, gate.y - 30);
  const eat: GameEvent = { type: "snailEat", victim: 1, rider: 4 };
  assert.equal(
    at(eat, tall)?.x,
    view.snail.x + view.snail.facing * tall.snailFront,
  );
  assert.equal(at(eat, tall)?.y, view.snail.y - 10);
});

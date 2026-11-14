import test from "node:test";
import assert from "node:assert/strict";
import type { GameEvent, RoundView } from "../src/engine/index.js";
import {
  EventLedger,
  HeldPlans,
  HELD_PATIENCE,
  NO_ART,
  bodyLift,
  BUMP_SPARKS,
  CLAIM_SECONDS,
  CLASH,
  DEATH,
  CLASH_SHEET,
  HATCH,
  isLoud,
  JUMP_DUST,
  LAND_HEARD,
  loudIdentity,
  STOMP_SPECKS,
  planLanding,
  QUEEN_FLARE,
  eventKey,
  mergePlans,
  planEvent,
  planFlap,
  stands,
  type Plan,
  type TickEvents,
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
const tick = (at: number, events: GameEvent[]): TickEvents => ({
  tick: at,
  events,
});
const kinds = (plan: Plan): string[] =>
  plan.effects.map((effect) => effect.kind);
const sounds = (plan: Plan): string[] => plan.sounds.map((cue) => cue.name);
const heard = (ledger: EventLedger, ...ticks: TickEvents[]): GameEvent[] =>
  ledger.fresh(ticks).map((occurrence) => occurrence.event);

test("a tick fed again does not fire its events twice", () => {
  const ledger = new EventLedger();
  const kill: GameEvent = { type: "kill", victim: 1, killer: 3 };
  const events: GameEvent[] = [kill, { type: "berryRegrow" }];
  assert.deepEqual(ledger.fresh([tick(120, events)]), [
    { tick: 120, index: 0, event: kill },
    { tick: 120, index: 1, event: events[1] },
  ]);
  assert.deepEqual(ledger.fresh([tick(120, events)]), []);
  assert.deepEqual(
    ledger.fresh([
      tick(
        120,
        events.map((event) => ({ ...event })),
      ),
    ]),
    [],
  );
});

test("several ticks folded at once are all heard, oldest first", () => {
  const ledger = new EventLedger();
  const early: GameEvent = { type: "kill", victim: 1, killer: 3 };
  const late: GameEvent = { type: "berryPickup", slot: 2, pile: 0 };
  assert.deepEqual(ledger.fresh([tick(114, [early]), tick(120, [late])]), [
    { tick: 114, index: 0, event: early },
    { tick: 120, index: 0, event: late },
  ]);
  assert.deepEqual(
    heard(ledger, tick(117, []), tick(120, [late])),
    [],
    "the newest tick again, from the frame that carries it",
  );
});

test("a rollback that changes what happened on a tick shows the new outcome only", () => {
  const ledger = new EventLedger();
  const first: GameEvent = { type: "kill", victim: 1, killer: 3 };
  const second: GameEvent = { type: "kill", victim: 3, killer: 1 };
  assert.equal(heard(ledger, tick(120, [first])).length, 1);
  assert.equal(heard(ledger, tick(123, [])).length, 0);
  assert.deepEqual(heard(ledger, tick(120, [first, second])), [second]);
  assert.deepEqual(
    heard(ledger, tick(123, [first])),
    [first],
    "the same event on another tick is another event",
  );
  assert.deepEqual(
    heard(ledger, tick(123, [second])),
    [second],
    "a rollback that changed who died at the same index is news",
  );
  assert.notEqual(eventKey(120, 0, first), eventKey(120, 0, second));
  assert.notEqual(eventKey(120, 0, first), eventKey(120, 1, first));
  assert.equal(eventKey(120, 0, first), "120:kill,1,3#0");
});

test("a rollback that moves an impact by a pixel is not a new impact", () => {
  const ledger = new EventLedger();
  const clash: GameEvent = { type: "glance", a: 0, b: 3, x: 105, y: 91 };
  const moved: GameEvent = { type: "glance", a: 0, b: 3, x: 106, y: 92 };
  const others: GameEvent = { type: "glance", a: 0, b: 4, x: 105, y: 91 };
  assert.equal(eventKey(120, 0, clash), eventKey(120, 0, moved));
  assert.equal(eventKey(120, 0, clash), "120:glance,0,3#0");
  assert.deepEqual(heard(ledger, tick(120, [clash])), [clash]);
  assert.deepEqual(heard(ledger, tick(120, [moved])), []);
  assert.deepEqual(heard(ledger, tick(120, [others])), [others]);
  const used: GameEvent = {
    type: "gateUse",
    slot: 1,
    gate: 0,
    kind: "warrior",
    x: 10,
    y: 20,
  };
  assert.equal(eventKey(120, 2, used), "120:gateUse,1,0,warrior#2");
});

test("loud events are the deaths and the win, and stand while the view shows them", () => {
  const kill: GameEvent = { type: "kill", victim: 1, killer: 3 };
  const queen: GameEvent = {
    type: "queenKill",
    victim: 0,
    killer: 3,
    eggsLeft: 1,
  };
  const won: GameEvent = { type: "victory", team: 1, kind: "military" };
  assert.ok(isLoud(kill) && isLoud(queen) && isLoud(won));
  assert.equal(isLoud({ type: "berryRegrow" }), false);
  assert.equal(isLoud({ type: "glance", a: 0, b: 3, x: 1, y: 1 }), false);
  const alive = openingView();
  assert.equal(stands(kill, alive), false, "the victim is alive: overturned");
  assert.equal(stands(kill, withUnit(alive, 1, { dead: true })), true);
  assert.equal(stands(queen, withUnit(alive, 0, { dead: true })), true);
  assert.equal(stands(kill, { ...alive, units: [] }), false);
  assert.equal(stands(won, alive), false);
  assert.equal(
    stands(won, { ...alive, winner: { team: 1, kind: "military" } }),
    true,
  );
  assert.equal(
    stands(won, { ...alive, winner: { team: 1, kind: "snail" } }),
    false,
  );
  assert.equal(stands({ type: "berryRegrow" }, alive), true);
});

test("a held sound plays once its tick is confirmed and the kill still stands", () => {
  const held = new HeldPlans();
  const kill: GameEvent = { type: "kill", victim: 1, killer: 3 };
  const dead = withUnit(openingView(), 1, { dead: true });
  const plan: Plan = {
    effects: [],
    sounds: [{ name: "kill", volume: 1, pan: 0 }],
    shake: 0,
  };
  held.hold(120, kill, plan);
  assert.deepEqual(held.release(117, 120, dead), [], "not confirmed yet");
  assert.equal(held.size, 1);
  assert.deepEqual(held.release(120, 123, dead), [plan]);
  assert.equal(held.size, 0);
  assert.deepEqual(held.release(126, 126, dead), [], "played once");
});

test("a held sound of a kill a rollback erased is dropped, not played late", () => {
  const held = new HeldPlans();
  const kill: GameEvent = { type: "kill", victim: 1, killer: 3 };
  const plan: Plan = {
    effects: [],
    sounds: [{ name: "kill", volume: 1, pan: 0 }],
    shake: 0,
  };
  held.hold(120, kill, plan);
  assert.deepEqual(held.release(120, 120, openingView()), []);
  assert.equal(held.size, 0);
  held.hold(120, kill, plan);
  held.clear();
  assert.equal(held.size, 0);
});

test("a tick that is never confirmed plays its sound after a while, and the held list is bounded", () => {
  const held = new HeldPlans();
  const kill: GameEvent = { type: "kill", victim: 1, killer: 3 };
  const dead = withUnit(openingView(), 1, { dead: true });
  const plan: Plan = {
    effects: [],
    sounds: [{ name: "kill", volume: 1, pan: 0 }],
    shake: 0,
  };
  held.hold(120, kill, plan);
  assert.deepEqual(held.release(-1, 120 + HELD_PATIENCE - 1, dead), []);
  assert.deepEqual(held.release(-1, 120 + HELD_PATIENCE, dead), [plan]);
  const small = new HeldPlans(HELD_PATIENCE, 3);
  for (let at = 0; at < 5; at += 1)
    small.hold(at, { ...kill, victim: at + 1 }, plan);
  assert.equal(small.size, 3);
  const everyone = {
    ...dead,
    units: dead.units.map((unit) => ({ ...unit, dead: true })),
  };
  assert.equal(small.release(4, 4, everyone).length, 3, "the newest are kept");
});

test("sounds are planned before the art has loaded", () => {
  // Slot 2 is a Worker: a Queen's death is announced by `queenKill`, not by its `kill`.
  const view = withUnit(openingView(), 2, { dead: true });
  const plan = planEvent(
    { type: "kill", victim: 2, killer: 3 },
    view,
    -1,
    NO_ART,
  );
  assert.deepEqual(sounds(plan), ["kill"]);
  assert.equal(bodyLift(view.units[2], NO_ART), 0);
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

test("a new round forgets the old one and old ticks are dropped", () => {
  const ledger = new EventLedger(10);
  const kill: GameEvent = { type: "kill", victim: 1, killer: 3 };
  for (let at = 1; at <= 60; at += 1)
    assert.equal(heard(ledger, tick(at, [kill])).length, 1);
  assert.ok(ledger.size <= 41, `kept ${ledger.size}`);
  assert.equal(heard(ledger, tick(55, [kill])).length, 0);
  // Far behind the newest tick: a new round, where tick 1 happens again.
  assert.equal(heard(ledger, tick(1, [kill])).length, 1);
  assert.equal(ledger.size, 1);
  assert.equal(heard(ledger, tick(2, [kill])).length, 1);
  // Flaps count on the round's step, apart from the events' clock.
  const flapped = withUnit(openingView({ step: 9000 }), 0, { flapped: true });
  assert.deepEqual(ledger.freshFlaps(flapped), [0]);
  assert.deepEqual(ledger.freshFlaps(flapped), []);
  assert.equal(heard(ledger, tick(3, [kill])).length, 1, "not a new round");
  ledger.clear();
  assert.equal(ledger.size, 0);
  assert.deepEqual(ledger.freshFlaps(flapped), [0]);
});

test("a kill is specks of the victim's colour, big and small, and nothing else", () => {
  const view = withUnit(openingView(), 4, { x: 400, y: 120, kind: "worker" });
  const event: GameEvent = { type: "kill", victim: 4, killer: 0 };
  const plan = planEvent(event, view, -1, SIZES);
  assert.deepEqual(kinds(plan), ["burst", "burst"], "no fireball, no sprite");
  const [big, small] = plan.effects;
  assert.ok(big?.kind === "burst" && small?.kind === "burst");
  assert.deepEqual([big.size, small.size], [2, 1]);
  assert.ok(big.count >= 25 && big.count <= 50);
  assert.ok(small.count >= 50 && small.count <= 75);
  assert.equal(big.life, DEATH.life);
  assert.equal(big.team, view.units[4]?.team);
  assert.equal(big.x, 400);
  assert.equal(big.y, 120 - SIZES.worker / 2);
  assert.equal(plan.shake, 0, "only a Queen's death shakes the picture");
  assert.deepEqual(sounds(plan), ["kill"]);
  assert.ok((plan.sounds[0]?.pan ?? 0) > 0, "heard from the right");
  assert.equal(plan.sounds[0]?.volume, 0.55);
  const mine = planEvent(event, view, 0, SIZES);
  assert.equal(mine.sounds[0]?.volume, 1);
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
  assert.deepEqual(kinds(plan), ["flare", "burst", "burst"]);
  const [flare, big, small] = plan.effects;
  assert.ok(flare?.kind === "flare");
  assert.deepEqual({ radius: flare.radius, life: flare.life }, QUEEN_FLARE);
  assert.ok(big?.kind === "burst" && small?.kind === "burst");
  assert.ok(big.count > DEATH.unit.big && small.count > DEATH.unit.small);
  assert.equal(plan.shake, 1);
  assert.deepEqual(sounds(plan), ["queenKill"]);
  assert.equal(plan.sounds[0]?.pan, 0);
  assert.equal(bodyLift(unitView({ kind: "queen" }), SIZES), 9);
  assert.equal(bodyLift(unitView(), SIZES), 8);
});

test("every event has a plan, and events about missing things are silent", () => {
  const view = openingView();
  const events: GameEvent[] = [
    { type: "bounce", a: 0, b: 3 },
    { type: "bounce", a: 0, b: 3, x: 200, y: 90 },
    { type: "glance", a: 0, b: 3, x: 200, y: 90 },
    { type: "stomped", slot: 1, by: 4, x: 200, y: 90 },
    { type: "attack", slot: 0 },
    { type: "gateOffer", slot: 1, gate: 0 },
    { type: "gateLock", slot: 1, gate: 0 },
    { type: "depositStart", slot: 1, team: 0, hole: 2 },
    { type: "snailCatch", victim: 4, rider: 1 },
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
    // Bodies that bump arrive as `bounce` since rules 4: a `bump` from an old recording does nothing.
    { type: "bump", worker: 1, target: 4 },
    { type: "attack", slot: 9 },
    { type: "gateOffer", slot: 1, gate: 99 },
    { type: "gateLock", slot: 1, gate: 99 },
    { type: "depositStart", slot: 1, team: 0, hole: 99 },
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
    "no number: the hive's holes count",
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
  assert.deepEqual(kinds(kickIn), kinds(deposit));

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
  const burst = use.effects[0];
  assert.ok(burst?.kind === "burst", "a speed gate only lights up");
  assert.equal(burst.tone, "gold");
  assert.equal(burst.x, gate.x);
  const warrior = planEvent(
    { type: "gateUse", slot: 1, gate: 0, kind: "warrior" },
    view,
    -1,
    SIZES,
  );
  const rising = warrior.effects[0];
  assert.ok(rising?.kind === "sprite");
  assert.equal(rising.sheet, "gate-emerge-pink");
  assert.equal(rising.slot, 1, "the new Warrior is the rising figure");
  assert.deepEqual([rising.x, rising.y], [gate.x, gate.y - 1]);
  const teamBurst = warrior.effects[1];
  assert.ok(teamBurst?.kind === "burst");
  assert.equal(teamBurst.tone, "team");
  const fast = planEvent(
    { type: "gateUse", slot: 1, gate: 0, kind: "warrior" },
    withUnit(view, 1, { speed: true }),
    -1,
    SIZES,
  );
  const quick = fast.effects[0];
  assert.ok(quick?.kind === "sprite");
  assert.equal(quick.sheet, "gate-emerge-speed-pink");
  const claim = planEvent(
    { type: "gateClaim", slot: 3, gate: 0, team: 1 },
    view,
    -1,
    SIZES,
  );
  assert.ok(claim.effects.every((effect) => effect.kind !== "sprite"));
  assert.ok(claim.effects.length > 0);

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
    .effects[1];
  assert.ok(across?.kind === "burst");
  assert.equal(across.x, 4);
  view = withUnit(view, 3, { x: 24, y: 100 });
  const near = planEvent({ type: "bounce", a: 0, b: 3 }, view, -1, SIZES)
    .effects[1];
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
  const dust = worker.effects[1];
  assert.ok(dust?.kind === "burst", "a jump kicks dust off the ground");
  assert.deepEqual(
    { count: dust.count, x: dust.x, y: dust.y },
    { count: JUMP_DUST, x: 100, y: 49 },
  );
  assert.equal(warrior.effects.length, 1, "wings raise none");
  assert.deepEqual(sounds(worker), ["jump"]);
  assert.ok(
    (worker.sounds[0]?.volume ?? 1) < 0.7,
    "someone else's jump is quiet",
  );
});

test("plans merge into one: everything in order, the strongest shake", () => {
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
  assert.deepEqual(mergePlans([]), {
    effects: [],
    sounds: [],
    shake: 0,
  });
});

test("a victory fires once a round, however often a rollback feeds it", () => {
  const ledger = new EventLedger();
  const won: GameEvent = { type: "victory", team: 1, kind: "military" };
  assert.equal(heard(ledger, tick(900, [won])).length, 1);
  assert.equal(heard(ledger, tick(900, [won])).length, 0);
  assert.equal(
    heard(ledger, tick(903, [won])).length,
    0,
    "the same win on a later tick after a rollback",
  );
  assert.equal(
    heard(ledger, tick(903, [{ type: "victory", team: 0, kind: "snail" }]))
      .length,
    1,
    "a different outcome is news",
  );
  ledger.clear();
  assert.equal(ledger.size, 0);
  assert.equal(
    heard(ledger, tick(40, [won])).length,
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

test("the body's middle is known for every kind and never fails", () => {
  for (const kind of ["worker", "warrior", "queen"] as const) {
    assert.equal(bodyLift(unitView({ kind }), SIZES), SIZES[kind] / 2);
    assert.equal(bodyLift(unitView({ kind }), undefined), 0);
    assert.equal(bodyLift(unitView({ kind }), {}), 0);
  }
  assert.equal(bodyLift(undefined, SIZES), 0);
  assert.equal(bodyLift(undefined, undefined), 0);
});

test("crossed swords flash where they met; bumped bodies spark there", () => {
  const view = withUnit(withUnit(openingView(), 0, { x: 100, y: 100 }), 3, {
    x: 110,
    y: 100,
  });
  const clash = planEvent(
    { type: "glance", a: 0, b: 3, x: 105, y: 91 },
    view,
    -1,
    SIZES,
  );
  const [flash, core, ...bursts] = clash.effects;
  assert.deepEqual(flash, {
    kind: "sprite",
    sheet: CLASH_SHEET,
    x: 105,
    y: 91,
    flip: false,
  });
  assert.ok(core?.kind === "flare");
  assert.equal(core.life, CLASH.core);
  assert.deepEqual([core.x, core.y], [105, 91]);
  assert.equal(bursts.length, CLASH.bursts);
  assert.deepEqual(
    bursts.map((burst) => (burst.kind === "burst" ? burst.delay : -1)),
    Array.from({ length: CLASH.bursts }, (_, index) => index * CLASH.gap),
    "one after the other",
  );
  assert.ok(bursts.every((b) => b.kind === "burst" && b.life === CLASH.life));
  assert.equal(clash.shake, 0, "no hit-stop and no shake: play goes on");
  assert.deepEqual(sounds(clash), ["glance"]);
  assert.equal(
    planEvent({ type: "glance", a: 0, b: 3, x: 105, y: 91 }, view, 3, SIZES)
      .sounds[0]?.volume,
    1,
    "my own clash is loud",
  );

  const bump = planEvent(
    { type: "bounce", a: 0, b: 3, x: 300, y: 40 },
    view,
    -1,
    SIZES,
  );
  const [spark, sparks] = bump.effects;
  assert.ok(spark?.kind === "flare" && sparks?.kind === "burst");
  assert.deepEqual([spark.x, spark.y], [300, 40], "where the engine says");
  assert.deepEqual([sparks.x, sparks.y], [300, 40]);
  assert.equal(sparks.count, BUMP_SPARKS);
  assert.ok((bump.sounds[0]?.pan ?? 0) > 0, "heard from the right");
});

test("a stomp puffs off the head and an attack pushes off behind", () => {
  const view = withUnit(openingView(), 0, { x: 100, y: 60, facing: -1 });
  const stomp = planEvent(
    { type: "stomped", slot: 1, by: 4, x: 210, y: 130 },
    view,
    4,
    SIZES,
  );
  const [puff, specks] = stomp.effects;
  assert.deepEqual(puff, {
    kind: "sprite",
    sheet: "flap-puff",
    x: 210,
    y: 129,
    flip: false,
  });
  assert.ok(specks?.kind === "burst");
  assert.equal(specks.count, STOMP_SPECKS);
  assert.deepEqual(sounds(stomp), ["stomp"]);
  assert.equal(stomp.sounds[0]?.volume, 0.8, "mine");

  const attack = planEvent({ type: "attack", slot: 0 }, view, 0, SIZES);
  assert.deepEqual(attack.effects, [
    {
      kind: "sprite",
      sheet: "flap-puff",
      x: 105,
      y: 60 - SIZES.queen / 2,
      flip: true,
    },
  ]);
  assert.deepEqual(sounds(attack), ["attack"]);
  assert.equal(attack.sounds[0]?.volume, 0.8);
  assert.equal(
    planEvent({ type: "attack", slot: 0 }, view, 3, SIZES).sounds[0]?.volume,
    0.3,
    "someone else's swing is quiet",
  );
});

test("a gate sounds when offered, rings shut, and a hive hole rings as a Worker climbs in", () => {
  const view = openingView();
  const gate = view.gates[0];
  const hole = view.hives[0]?.[2];
  assert.ok(gate && hole);
  const offer = planEvent(
    { type: "gateOffer", slot: 1, gate: 0 },
    view,
    1,
    SIZES,
  );
  assert.deepEqual(offer.effects, [], "the doorway's own pulse shows it");
  assert.deepEqual(sounds(offer), ["gateEnter"]);
  assert.equal(offer.sounds[0]?.volume, 0.9);
  assert.equal(
    planEvent({ type: "gateOffer", slot: 1, gate: 0 }, view, -1, SIZES)
      .sounds[0]?.volume,
    0.4,
  );
  const lock = planEvent(
    { type: "gateLock", slot: 1, gate: 0 },
    view,
    -1,
    SIZES,
  );
  assert.deepEqual(lock.effects, [
    {
      kind: "ring",
      x: gate.x,
      y: gate.y - SIZES.worker / 2,
      tone: "team",
      team: view.units[1]?.team,
      radius: 12,
    },
  ]);
  assert.deepEqual(sounds(lock), ["gateLock"]);
  const unknown = planEvent(
    { type: "gateLock", slot: 9, gate: 0 },
    view,
    -1,
    SIZES,
  ).effects[0];
  assert.ok(unknown?.kind === "ring");
  assert.equal(unknown.team, -1);

  const sit = planEvent(
    { type: "depositStart", slot: 1, team: 0, hole: 2 },
    view,
    -1,
    SIZES,
  );
  assert.deepEqual(sit.effects, [
    { kind: "ring", x: hole.x, y: hole.y, tone: "berry", team: -1, radius: 7 },
  ]);
  assert.deepEqual(sounds(sit), ["pickup"]);
});

test("the snail's catch flashes at its mouth in the victim's colour", () => {
  const view = openingView();
  const plan = planEvent(
    { type: "snailCatch", victim: 4, rider: 1 },
    view,
    -1,
    SIZES,
  );
  const [flash, bits] = plan.effects;
  assert.ok(flash?.kind === "flare" && bits?.kind === "burst");
  assert.equal(flash.x, view.snail.x + view.snail.facing * SIZES.snailFront);
  assert.equal(bits.team, view.units[4]?.team);
  assert.deepEqual(sounds(plan), ["snailCatch"]);
  const nobody = planEvent(
    { type: "snailCatch", victim: 9, rider: 1 },
    view,
    -1,
    SIZES,
  ).effects[1];
  assert.ok(nobody?.kind === "burst");
  assert.equal(nobody.team, -1);
});

test("a re-fed step with sword events plays them once", () => {
  const ledger = new EventLedger();
  const events: GameEvent[] = [
    { type: "attack", slot: 0 },
    { type: "glance", a: 0, b: 3, x: 105, y: 91 },
    { type: "stomped", slot: 1, by: 4, x: 210, y: 130 },
    { type: "bounce", a: 0, b: 3, x: 300, y: 40 },
    { type: "gateOffer", slot: 1, gate: 0 },
    { type: "gateLock", slot: 1, gate: 0 },
    { type: "gateUse", slot: 1, gate: 0, kind: "warrior", x: 10, y: 20 },
    { type: "depositStart", slot: 1, team: 0, hole: 2 },
    { type: "snailCatch", victim: 4, rider: 1 },
    { type: "respawn", slot: 0, egg: 1 },
  ];
  assert.deepEqual(heard(ledger, tick(231, events)), events);
  assert.deepEqual(heard(ledger, tick(231, events)), [], "the same tick again");
  assert.deepEqual(
    heard(
      ledger,
      tick(
        231,
        events.map((event) => ({ ...event })),
      ),
    ),
    [],
    "re-simulated to the same outcome",
  );
  const moved: GameEvent = { type: "glance", a: 0, b: 3, x: 106, y: 91 };
  assert.deepEqual(
    heard(
      ledger,
      tick(
        231,
        events.map((event, index) => (index === 1 ? moved : event)),
      ),
    ),
    [],
    "a rollback that moved the clash by a pixel is the same clash",
  );
  const more: GameEvent = { type: "glance", a: 1, b: 4, x: 106, y: 91 };
  assert.deepEqual(
    heard(ledger, tick(231, [...events, more])),
    [more],
    "a rollback that added a clash shows the new one only",
  );
});

test("a claimed gate sends its new colour up for a second", () => {
  const view = openingView();
  const plan = planEvent(
    { type: "gateClaim", slot: 3, gate: 0, team: 1 },
    view,
    -1,
    SIZES,
  );
  const rising = plan.effects.find((effect) => effect.kind === "fountain");
  assert.ok(rising?.kind === "fountain");
  assert.equal(rising.seconds, CLAIM_SECONDS);
  assert.equal(rising.team, 1);
  assert.equal(rising.tone, "team");
  assert.equal(rising.x, view.gates[0]?.x);
});

test("a rollback that inserts or removes an earlier event in a tick does not re-fire the later ones", () => {
  const ledger = new EventLedger();
  const dust: GameEvent = { type: "stomped", slot: 1, by: 4, x: 210, y: 130 };
  const clash: GameEvent = { type: "glance", a: 0, b: 3, x: 105, y: 91 };
  const flap: GameEvent = { type: "attack", slot: 2 };
  assert.deepEqual(heard(ledger, tick(120, [dust, clash])), [dust, clash]);
  assert.deepEqual(
    heard(ledger, tick(120, [flap, dust, clash])),
    [flap],
    "one inserted before them",
  );
  assert.deepEqual(heard(ledger, tick(120, [clash])), [], "one removed");
  assert.deepEqual(
    heard(ledger, tick(120, [clash, clash])),
    [clash],
    "the same thing twice in a tick is two events",
  );
  assert.deepEqual(heard(ledger, tick(120, [clash, flap, clash])), []);
  assert.equal(eventKey(120, 1, clash), "120:glance,0,3#1");
  assert.deepEqual(
    ledger.fresh([tick(120, [flap, clash, dust, clash, clash])]),
    [{ tick: 120, index: 4, event: clash }],
    "the index is still its place in the list",
  );
});

test("a kill a rollback moves to another tick or credits to another killer is one held sound", () => {
  const held = new HeldPlans();
  const kill: GameEvent = { type: "kill", victim: 2, killer: 3 };
  const credited: GameEvent = { type: "kill", victim: 2, killer: 5 };
  const dead = withUnit(openingView(), 2, { dead: true });
  const plan = (volume: number): Plan => ({
    effects: [],
    sounds: [{ name: "kill", volume, pan: 0 }],
    shake: 0,
  });
  held.hold(120, kill, plan(1));
  held.hold(123, kill, plan(0.5));
  assert.equal(held.size, 1);
  held.hold(123, credited, plan(0.25));
  assert.equal(held.size, 1);
  assert.deepEqual(held.release(123, 123, dead), [plan(0.25)], "the newest");
  assert.deepEqual(held.release(126, 126, dead), []);
  const other: GameEvent = { type: "kill", victim: 4, killer: 3 };
  const queen: GameEvent = {
    type: "queenKill",
    victim: 0,
    killer: 3,
    eggsLeft: 1,
  };
  held.hold(120, kill, plan(1));
  held.hold(120, other, plan(1));
  held.hold(120, queen, plan(1));
  assert.equal(held.size, 3, "other deaths are their own");
  assert.equal(loudIdentity(kill), "kill:2");
  assert.equal(loudIdentity(queen), "queenKill:0");
  assert.equal(
    loudIdentity({ type: "victory", team: 1, kind: "snail" }),
    "won:1,snail",
  );
  assert.equal(loudIdentity({ type: "attack", slot: 2 }), "attack,2");
});

test("a tick fed again without a held kill takes it back before it is confirmed", () => {
  const held = new HeldPlans();
  const kill: GameEvent = { type: "kill", victim: 2, killer: 3 };
  const other: GameEvent = { type: "kill", victim: 4, killer: 3 };
  const dead = withUnit(withUnit(openingView(), 2, { dead: true }), 4, {
    dead: true,
  });
  const plan: Plan = {
    effects: [],
    sounds: [{ name: "kill", volume: 1, pan: 0 }],
    shake: 0,
  };
  held.hold(120, kill, plan);
  held.hold(123, other, plan);
  held.retract(120, [{ type: "berryRegrow" }]);
  assert.equal(held.size, 1, "the kill at 120 is gone");
  held.retract(123, [{ type: "attack", slot: 1 }, { ...other }]);
  assert.equal(held.size, 1, "the same kill again, beside a new event");
  held.retract(126, []);
  assert.deepEqual(held.release(126, 126, dead), [plan], "another tick's");
});

test("a Queen hatches in a burst of shell at her egg, a Worker in its beam", () => {
  const view = openingView();
  const queen = view.units.find((unit) => unit.kind === "queen");
  const worker = view.units.find((unit) => unit.kind === "worker");
  assert.ok(queen && worker);
  const egg = view.spares[queen.team]?.[1];
  assert.ok(egg);
  const hatch = planEvent(
    { type: "respawn", slot: queen.slot, egg: 1 },
    view,
    -1,
    SIZES,
  );
  assert.deepEqual(kinds(hatch), ["flare", "burst", "burst"]);
  const [flash, shell, trim] = hatch.effects;
  assert.ok(
    flash?.kind === "flare" &&
      shell?.kind === "burst" &&
      trim?.kind === "burst",
  );
  assert.equal(flash.radius, HATCH.flare);
  assert.deepEqual(
    { count: shell.count, life: shell.life, tone: shell.tone },
    { count: HATCH.count, life: HATCH.life, tone: "gold" },
  );
  assert.deepEqual(
    { count: trim.count, tone: trim.tone, team: trim.team },
    { count: HATCH.trim, tone: "team", team: queen.team },
  );
  for (const effect of [flash, shell, trim])
    assert.deepEqual(
      [effect.x, effect.y],
      [egg.x, egg.y - HATCH.lift],
      "at the egg, not at the Queen",
    );
  // An engine that names no egg: she hatches where she is.
  for (const event of [
    { type: "respawn", slot: queen.slot },
    { type: "respawn", slot: queen.slot, egg: -1 },
    { type: "respawn", slot: queen.slot, egg: 99 },
  ] satisfies GameEvent[]) {
    const [there] = planEvent(event, view, -1, SIZES).effects;
    assert.ok(there?.kind === "flare");
    assert.deepEqual([there.x, there.y], [queen.x, queen.y - SIZES.queen / 2]);
  }
  const beam = planEvent(
    { type: "respawn", slot: worker.slot, egg: -1 },
    view,
    -1,
    SIZES,
  );
  assert.deepEqual(kinds(beam), ["sprite"]);
});

test("a landing raises dust at the feet, and thuds once the fall is worth hearing", () => {
  const unit = unitView({ slot: 1, x: 50, y: 80, facing: -1 });
  const soft = planLanding(unit, LAND_HEARD - 0.01, 1);
  assert.deepEqual(soft.effects, [
    { kind: "sprite", sheet: "flap-puff", x: 50, y: 79, flip: true },
  ]);
  assert.deepEqual(soft.sounds, [], "a step off a ledge is not a thud");
  assert.equal(soft.shake, 0);
  const mine = planLanding(unit, 1, 1);
  assert.deepEqual(
    mine.sounds.map((cue) => cue.name),
    ["land"],
  );
  const theirs = planLanding(unit, 1, 4);
  assert.ok(
    (theirs.sounds[0]?.volume ?? 0) < (mine.sounds[0]?.volume ?? 0),
    "someone else's landing is quieter than this device's own",
  );
});

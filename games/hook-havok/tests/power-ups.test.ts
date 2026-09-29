import test from "node:test";
import assert from "node:assert/strict";
import {
  createArena,
  syncKeepers,
  stepArena,
  encodeArena,
  decodeArena,
} from "../src/engine/arena.js";
import { DEFAULT_TUNING, NEUTRAL, S } from "../src/engine/world.js";
import { POWER_COOLDOWN, WARD_TICKS } from "../src/engine/power-ups.js";
import { parseTuning } from "../src/engine/codec.js";
import { COUNTDOWN_TICKS } from "../src/engine/contest.js";
const members = [
  { id: "a", slot: 0, generation: 1, connected: true },
  { id: "b", slot: 1, generation: 1, connected: true },
];
function setup() {
  const a = createArena({
    ...DEFAULT_TUNING,
    powerUps: "on",
    jumpMode: "double",
  });
  syncKeepers(a, members);
  return a;
}
test("eliminated keepers and late watchers cannot collect shared pads", () => {
  const a = createArena({
    ...DEFAULT_TUNING,
    powerUps: "on",
    rules: "elimination",
  });
  syncKeepers(a, members);
  for (let i = 0; i < COUNTDOWN_TICKS; i++) stepArena(a);
  syncKeepers(a, [
    ...members,
    { id: "c", slot: 2, generation: 1, connected: true },
  ]);
  a.contest.entries[0]!.out = true;
  a.keepers[0]!.world.x = 490 * S;
  a.keepers[2]!.world.x = 130 * S;
  stepArena(a);
  assert.deepEqual(a.powerCooldowns, [0, 0]);
  assert.deepEqual(a.pickupEvents, []);
});
test("contested Lift belongs to first slot, releases hook, preserves air reserve and restores cooldown", () => {
  const a = setup();
  for (const k of a.keepers) {
    k.world.x = 490 * S;
    k.world.airJump = false;
    k.world.grounded = false;
  }
  stepArena(a);
  assert.equal(a.keepers[0]!.world.vy, -16 * S);
  assert.notEqual(a.keepers[1]!.world.vy, -16 * S);
  assert.equal(a.powerCooldowns[0], POWER_COOLDOWN);
  assert.deepEqual(a.pickupEvents, [{ tick: 1, by: "a", pad: 0 }]);
  // Landing refills the reserve before collection; Lift itself does not add a jump.
  const b = setup();
  b.keepers[0]!.world.x = 490 * S;
  b.keepers[0]!.world.feet = 790 * S;
  b.keepers[0]!.world.grounded = false;
  b.keepers[0]!.world.airJump = false;
  stepArena(b);
  assert.equal(b.keepers[0]!.world.airJump, false);
  assert.equal(b.keepers[0]!.world.hook.phase, "ready");
  for (const k of a.keepers) {
    k.world.x = 310 * S;
    k.world.feet = 810 * S;
    k.world.vx = k.world.vy = 0;
  }
  for (let i = 0; i < POWER_COOLDOWN - 1; i++) stepArena(a);
  assert.equal(a.powerCooldowns[0], 1);
  stepArena(a);
  assert.equal(a.powerCooldowns[0], 0);
  assert.ok(decodeArena(encodeArena(a)));
});
test("Ward lasts five active seconds, rejects rival hits, clears on return and disconnect", () => {
  const a = setup(),
    victim = a.keepers[0]!,
    attacker = a.keepers[1]!;
  victim.world.x = 130 * S;
  stepArena(a);
  assert.equal(victim.ward, WARD_TICKS);
  attacker.world.x = 240 * S;
  attacker.shield = victim.shield = 0;
  attacker.world.input = { ...NEUTRAL, fire: true, aimX: 130, aimY: 780 };
  for (let i = 0; i < 20; i++) stepArena(a);
  assert.equal(attacker.hits, 0);
  assert.equal(victim.world.x, 130 * S);
  assert.equal(victim.ward, WARD_TICKS - 20);
  attacker.world.input = { ...NEUTRAL };
  for (let i = 20; i < WARD_TICKS; i++) stepArena(a);
  assert.equal(victim.ward, 0);
  attacker.world.input = { ...NEUTRAL, fire: true, aimX: 130, aimY: 780 };
  for (let i = 0; i < 20; i++) stepArena(a);
  assert.equal(attacker.hits, 1, "rival hits work when Ward expires");
  victim.ward = 80;
  victim.world.input = { ...NEUTRAL, reset: true };
  stepArena(a);
  assert.equal(victim.ward, 0);
  victim.ward = 80;
  syncKeepers(a, [{ ...members[0]!, connected: false }, members[1]!]);
  assert.equal(a.keepers[0]!.ward, 0);
  const fallen = setup();
  fallen.keepers[0]!.ward = 80;
  fallen.keepers[0]!.world.feet = 1000 * S;
  stepArena(fallen);
  assert.equal(fallen.keepers[0]!.ward, 0);
  assert.ok(fallen.keepers[0]!.world.respawn > 0);
  const returned = setup();
  returned.keepers[0]!.ward = 80;
  syncKeepers(returned, [{ ...members[0]!, generation: 2 }, members[1]!]);
  assert.equal(returned.keepers[0]!.ward, 0);
});
test("both pads can be claimed on one tick, inactive players cannot claim, and lobby timers freeze", () => {
  const a = setup();
  a.keepers[0]!.world.x = 490 * S;
  a.keepers[1]!.world.x = 130 * S;
  stepArena(a, false);
  assert.deepEqual(a.powerCooldowns, [0, 0]);
  stepArena(a);
  assert.deepEqual(
    a.pickupEvents.map((e) => e.by),
    ["a", "b"],
  );
  const saved = [...a.powerCooldowns];
  stepArena(a, false);
  assert.deepEqual(a.powerCooldowns, saved);
  const b = setup();
  syncKeepers(
    b,
    members.map((m) => ({ ...m, connected: false })),
  );
  b.keepers[0]!.world.x = 490 * S;
  stepArena(b);
  assert.equal(b.powerCooldowns[0], 0);
  const c = createArena({
    ...DEFAULT_TUNING,
    powerUps: "on",
    rules: "elimination",
  });
  syncKeepers(c, members);
  c.keepers[0]!.world.x = 490 * S;
  stepArena(c);
  assert.deepEqual(c.powerCooldowns, [0, 0]);
});
test("pickup checkpoints reject malformed timers/events, disabled Ward and aliases", () => {
  const a = setup();
  a.keepers[0]!.world.x = 130 * S;
  stepArena(a);
  const raw = encodeArena(a) as Record<string, unknown>;
  assert.ok(decodeArena(raw));
  for (const powerCooldowns of [
    [],
    [0],
    [-1, 0],
    [601, 0],
    [0.5, 0],
    [0, 0, 0],
  ])
    assert.equal(decodeArena({ ...raw, powerCooldowns }), undefined);
  for (const pickupEvents of [
    [{ tick: 2, by: "a", pad: 0 }],
    [{ tick: 1, by: "a", pad: 2 }],
    [
      { tick: 1, by: "a", pad: 0 },
      { tick: 1, by: "b", pad: 0 },
    ],
  ])
    assert.equal(decodeArena({ ...raw, pickupEvents }), undefined);
  assert.equal(
    parseTuning({ ...DEFAULT_TUNING, powerUps: "unknown" }),
    undefined,
  );
  assert.equal(decodeArena({ ...raw, tuning: DEFAULT_TUNING }), undefined);
  const restored = decodeArena(raw)!;
  restored.powerCooldowns[0] = 77;
  assert.notDeepEqual(restored.powerCooldowns, raw.powerCooldowns);
});
test("power-up replay remains identical across periodic restore on both maps", () => {
  for (const map of ["belfry", "crossroads"] as const) {
    const a = createArena({
      ...DEFAULT_TUNING,
      map,
      powerUps: "on",
      jumpMode: "double",
      wire: "spiked",
      experiment: "surge",
    });
    syncKeepers(a, members);
    let b = decodeArena(encodeArena(a))!;
    for (let tick = 0; tick < 1400; tick++) {
      for (const arena of [a, b])
        for (const k of arena.keepers)
          k.world.input = {
            ...NEUTRAL,
            move: Math.floor(tick / 80) % 2 ? 1 : -1,
            jump: tick % 50 < 15,
            fire: tick % 80 < 30,
            aimX: 800,
            aimY: 200,
          };
      stepArena(a);
      stepArena(b);
      assert.ok(decodeArena(encodeArena(a)), `${map} tick ${tick}`);
      if (tick % 37 === 0) b = decodeArena(encodeArena(b))!;
    }
    assert.deepEqual(encodeArena(a), encodeArena(b));
  }
});

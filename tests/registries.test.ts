import assert from "node:assert/strict";
import test from "node:test";
import { PICKUP_TYPES } from "../src/engine/pickup-types.ts";
import { PICKUPS, PICKUP_WEIGHTS } from "../src/engine/pickups.ts";
import {
  beginMatchParticipant,
  recordPickup,
  type MatchStatsState,
} from "../src/engine/match-stats.ts";
import {
  EFFECTS,
  EFFECT_KINDS,
  type EffectHolder,
  type EffectRule,
  applyEffect,
  effectDeadlines,
  expireEffects,
  hasDefensiveGrace,
  hasEffect,
  isHazardImmune,
  isInvulnerable,
  effectTable,
  speedMultiplier,
} from "../src/engine/effects.ts";
import { addPlayer, classicSettings, createGame } from "../src/engine/game.ts";
import {
  WEAPONS,
  WEAPON_KINDS,
  armWeapon,
  armedProjectile,
  isArmed,
  pullLabel,
  spendPull,
  volleyBombs,
  type WeaponKind,
} from "../src/engine/weapons.ts";

test("every pickup type has exactly one PICKUPS row, and the weights are read in PICKUP_TYPES order", () => {
  assert.deepEqual(Object.keys(PICKUPS).sort(), [...PICKUP_TYPES].sort());
  assert.deepEqual(
    PICKUP_WEIGHTS.map((row) => row.type),
    [...PICKUP_TYPES],
  );
  for (const type of PICKUP_TYPES) {
    const row = PICKUPS[type];
    assert.ok(
      Number.isInteger(row.weight) && row.weight >= 0,
      `${type} has a whole, non-negative default weight`,
    );
    assert.equal(typeof row.collect, "function", `${type} does something`);
  }
});

test("recordPickup counts every type once, and its own counter where the stored results have one", () => {
  for (const type of PICKUP_TYPES) {
    const stats: MatchStatsState = new Map();
    beginMatchParticipant(stats, {
      id: "a",
      name: "A",
      slot: 0,
      color: "#fff",
    });
    const before = { ...stats.get("a")! };
    recordPickup(stats, "a", type);
    const after = stats.get("a")!;
    assert.equal(after.pickupsCollected, before.pickupsCollected + 1, type);
    const changed = Object.keys(after).filter(
      (key) =>
        key !== "pickupsCollected" &&
        after[key as keyof typeof after] !== before[key as keyof typeof before],
    );
    const stat = PICKUPS[type].stat;
    assert.deepEqual(changed, stat ? [stat] : [], type);
  }
});

test("every effect kind has a row, is in force until its deadline and not on it", () => {
  assert.deepEqual(Object.keys(EFFECTS).sort(), [...EFFECT_KINDS].sort());
  for (const kind of EFFECT_KINDS) {
    const game = createGame("effects", classicSettings());
    addPlayer(game, { id: "a", name: "A", slot: 0, color: "#fff" });
    const rider = game.players.get("a")!;
    assert.equal(hasEffect(rider, kind, 0), false, `${kind} starts absent`);
    applyEffect(rider, kind, 10, 20);
    assert.equal(hasEffect(rider, kind, 19), true, `${kind} holds at 19`);
    assert.equal(hasEffect(rider, kind, 20), false, `${kind} is spent at 20`);
    expireEffects(rider, 20);
    assert.equal(hasEffect(rider, kind, 20), false, `${kind} stays spent`);
    const rule = EFFECTS[kind];
    // A stacked deadline leaves the rider; a single one is kept as the record of when it ended.
    assert.deepEqual(
      [...effectDeadlines(rider, kind)].filter((until) => until > 0),
      rule.stacking === "stack" ? [] : [20],
      kind,
    );
    assert.equal(isHazardImmune(rider, 20), false, kind);
    assert.equal(speedMultiplier(rider, 20), 1, kind);
  }
});

test("the readers answer from the table's flags", () => {
  for (const kind of EFFECT_KINDS) {
    const game = createGame("flags", classicSettings());
    addPlayer(game, { id: "a", name: "A", slot: 0, color: "#fff" });
    const rider = game.players.get("a")!;
    applyEffect(rider, kind, 10, 20);
    const rule = EFFECTS[kind];
    assert.equal(isHazardImmune(rider, 15), rule.immune === true, kind);
    assert.equal(isInvulnerable(rider, 15), rule.invulnerable === true, kind);
    assert.equal(
      hasDefensiveGrace(rider, 15),
      rule.defensiveGrace === true,
      kind,
    );
    assert.equal(speedMultiplier(rider, 15), rule.speed ?? 1, kind);
  }
});

test("the weapon table is the priority ladder: Gun, Shell, Five, Triple, then the lob", () => {
  assert.deepEqual(Object.keys(WEAPONS).sort(), [...WEAPON_KINDS].sort());
  // Every combination a rider can hold, against the ladder written out by hand.
  for (let mask = 0; mask < 1 << WEAPON_KINDS.length; mask++) {
    const game = createGame("weapons", classicSettings());
    addPlayer(game, { id: "a", name: "A", slot: 0, color: "#fff" });
    const rider = game.players.get("a")!;
    const held = WEAPON_KINDS.filter((_, bit) => mask & (1 << bit));
    for (const kind of held) armWeapon(rider, kind);
    const has = (kind: WeaponKind) => held.includes(kind);
    const projectile = has("gun") ? "gun" : has("shell") ? "shell" : undefined;
    const volley = has("five") ? "five" : has("triple") ? "triple" : undefined;
    assert.equal(armedProjectile(rider), projectile, held.join("+"));
    assert.equal(pullLabel(rider), projectile ?? volley ?? "bomb");
    assert.equal(volleyBombs(rider), has("five") ? 4 : has("triple") ? 2 : 0);
    spendPull(rider, projectile);
    // A pull spends the projectile it fired and every volley; a second projectile waits for the next pull.
    assert.deepEqual(
      WEAPON_KINDS.filter((kind) => isArmed(rider, kind)),
      projectile === "gun" && has("shell") ? ["shell"] : [],
      held.join("+"),
    );
  }
});

test("a new timed effect is only a row: a table with a kind the game lacks works through the same readers", () => {
  // Haste stacks and triples pace; Ward extends and makes its rider immune; Daze sways the heading.
  const kinds = [...EFFECT_KINDS, "haste", "ward", "daze"] as const;
  type Kind = (typeof kinds)[number];
  const table = effectTable<Kind>(kinds, {
    ...EFFECTS,
    haste: { stacking: "stack", maxDurationTicks: 40, speed: 3 },
    ward: { stacking: "extend", immune: true },
    daze: { stacking: "extend", heading: () => 0.25 },
  });
  const rider: EffectHolder<Kind> & { id: string } = { id: "a", effects: [] };
  table.applyEffect(rider, "haste", 10, 30);
  table.applyEffect(rider, "haste", 12, 20);
  table.applyEffect(rider, "nitro", 10, 25);
  table.applyEffect(rider, "ward", 10, 15);
  table.applyEffect(rider, "ward", 11, 18);
  // Held in table order, and within a kind by deadline.
  assert.deepEqual(
    rider.effects.map((effect) => [effect.kind, effect.untilTick]),
    [
      ["nitro", 25],
      ["haste", 20],
      ["haste", 30],
      ["ward", 18],
    ],
  );
  assert.equal(table.speedMultiplier(rider, 12), 2 * 3 * 3);
  assert.equal(table.isHazardImmune(rider, 17), true);
  assert.equal(table.isHazardImmune(rider, 18), false);
  assert.equal(
    table.effectSince(rider, "ward"),
    10,
    "extending keeps the start",
  );
  table.expireEffects(rider, 20);
  assert.deepEqual(table.effectDeadlines(rider, "haste"), [30]);
  assert.equal(table.speedMultiplier(rider, 20), 2 * 3);
  assert.equal(table.headingOffset(0, rider, 20), 0.25);
  // The checkpoint's guard is the table's own: the new kind's list is canonical, and a deadline past its row's
  // horizon, a second single entry or an unknown kind is refused.
  assert.equal(table.isCanonical(rider.effects, 20), true);
  assert.equal(
    table.isCanonical(
      [...rider.effects, { kind: "haste", sinceTick: 20, untilTick: 61 }],
      20,
    ),
    false,
    "past haste's maxDurationTicks",
  );
  assert.equal(
    table.isCanonical(
      [...rider.effects, { kind: "ward", sinceTick: 12, untilTick: 19 }],
      20,
    ),
    false,
    "two entries of an extending kind",
  );
  assert.equal(
    effectTable(EFFECT_KINDS, EFFECTS).isCanonical(rider.effects as never, 20),
    false,
    "the engine's table does not know haste",
  );
  // A stacking row without its horizon does not compile.
  // @ts-expect-error maxDurationTicks is required on a stacking row
  const incomplete: EffectRule = { stacking: "stack", speed: 3 };
  void incomplete;
  // The engine's own table is untouched by any of it.
  assert.deepEqual(Object.keys(EFFECTS).sort(), [...EFFECT_KINDS].sort());
});

test("each non-stacking effect keeps its own rule: extend pushes out and keeps the start, replace sets both", () => {
  for (const kind of EFFECT_KINDS) {
    const rule = EFFECTS[kind];
    if (rule.stacking === "stack") continue;
    const game = createGame("stacking", classicSettings());
    addPlayer(game, { id: "a", name: "A", slot: 0, color: "#fff" });
    const rider = game.players.get("a")!;
    applyEffect(rider, kind, 10, 50);
    applyEffect(rider, kind, 20, 30);
    const [effect] = rider.effects;
    assert.equal(rider.effects.length, 1, kind);
    if (rule.stacking === "extend") {
      assert.deepEqual(
        [effect!.sinceTick, effect!.untilTick],
        [10, 50],
        `${kind}: a shorter spell does not cut the running one short`,
      );
      applyEffect(rider, kind, 60, 90);
      assert.deepEqual(
        [rider.effects[0]!.sinceTick, rider.effects[0]!.untilTick],
        [60, 90],
        `${kind}: a spell after the last one ran out starts afresh`,
      );
    } else
      assert.deepEqual(
        [effect!.sinceTick, effect!.untilTick],
        [20, 30],
        `${kind}: the newest application wins outright`,
      );
  }
  // The rows as the game plays them.
  assert.deepEqual(
    EFFECT_KINDS.map((kind) => [kind, EFFECTS[kind].stacking]),
    [
      ["star", "extend"],
      ["nitro", "stack"],
      ["snail", "stack"],
      ["drunk", "extend"],
      ["ink", "extend"],
      ["shieldGrace", "replace"],
      ["portalGrace", "replace"],
      ["portalCooldown", "replace"],
    ],
  );
});

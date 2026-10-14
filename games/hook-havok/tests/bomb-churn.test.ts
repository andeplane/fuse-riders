import test from "node:test";
import assert from "node:assert/strict";
import {
  createArena,
  decodeArena,
  encodeArena,
  stepArena,
  syncKeepers,
  type Arena,
  type Keeper,
  type Member,
} from "../src/engine/arena.js";
import {
  BODY,
  DEFAULT_TUNING,
  S,
  type Input,
  type Tuning,
} from "../src/engine/world.js";
import { grantPower, padList } from "../src/engine/power-ups.js";
import { ALL_POWERS, powerPool } from "../src/engine/power-rules.js";
import { stepInputs } from "../src/online/game.js";
import { canonArena } from "./fixtures/canon.js";

/**
 * A bounded version of the 11B review fuzz: seeded inputs through the room's
 * own fold (`stepInputs`), membership churn, fresh rounds, live bombs whose
 * owner leaves play, and a checkpoint after every log tick. Since 11D the
 * pads are on too: pickups, cluster bomblets, Shields and dashes, and bombs
 * whose owners hold powers. Each tick's checkpoint must decode and re-encode
 * exactly, and an arena restored from checkpoints must fold on like one that
 * never was.
 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const ids = ["amber", "blue", "green", "violet", "rose", "ember"];
const stats = {
  throws: 0,
  knockouts: 0,
  orphanSteps: 0,
  orphanBlasts: 0,
  rounds: 0,
  restores: 0,
  churn: 0,
  pickups: 0,
  grants: 0,
  clusterThrows: 0,
  bomblets: 0,
  shieldPops: 0,
  dashes: 0,
  poweredOwners: 0,
};
function run(seed: number, tuning: Tuning, ticks: number): void {
  const rand = rng(seed),
    pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
  let a = createArena(tuning, 0, seed),
    shadow = createArena(tuning, 0, seed),
    members: Member[] = [];
  const next = (prev: Input, me: Keeper, rivals: Arena["keepers"]): Input => {
    const input = { ...prev },
      r = rand();
    // Head for a ready pad now and then, so powers are in play.
    const pad = padList(a).find((p) => p.ready);
    if (pad && r < 0.06) {
      const dx = pad.x * S - me.world.x;
      input.move = (Math.abs(dx) < 8 * S ? 0 : Math.sign(dx)) as Input["move"];
      input.jump = pad.y * S < me.world.feet - BODY && !prev.jump;
      input.drop = pad.y * S > me.world.feet + 40 * S;
    } else if (r < 0.08)
      input.move = (Math.floor(rand() * 3) - 1) as Input["move"];
    else if (r < 0.22) input.bomb = !input.bomb;
    else if (r < 0.25) input.fire = !input.fire;
    else if (r < 0.28) input.jump = !input.jump;
    else if (r < 0.29) input.drop = !input.drop;
    else if (r < 0.5) {
      // Aim at a rival often enough for blasts to find somebody.
      const target = rivals.length && rand() < 0.6 ? pick(rivals) : undefined;
      input.aimX = target
        ? Math.round(target.world.x / 1024)
        : Math.floor(rand() * 1600);
      input.aimY = target
        ? Math.round(target.world.feet / 1024) - 30
        : Math.floor(rand() * 900);
    }
    return input;
  };
  for (let tick = 0; tick < ticks; tick++) {
    const c = rand();
    const free = ids.filter((id) => !members.some((m) => m.id === id)),
      slots = [0, 1, 2, 3, 4].filter((s) => !members.some((m) => m.slot === s));
    if ((c < 0.012 || (members.length < 3 && c < 0.25)) && slots.length)
      members = [
        ...members,
        { id: pick(free), slot: pick(slots), connected: true, generation: 1 },
      ];
    else if (c < 0.016 && members.length) {
      const gone = pick(members);
      members = members.filter((m) => m !== gone);
    } else if (c < 0.024 && members.length) {
      const flip = pick(members);
      members = members.map((m) =>
        m === flip ? { ...m, connected: !m.connected } : m,
      );
    } else if (c < 0.028 && members.length) {
      const back = pick(members);
      members = members.map((m) =>
        m === back
          ? { ...m, generation: m.generation + 1, connected: true }
          : m,
      );
    } else if (c < 0.03 || (a.contest.phase === "over" && rand() < 0.05)) {
      // A lobby return, rematch or settings change: a fresh arena and draw.
      const fresh = (a.seed * 31 + 7) >>> 0;
      a = createArena(a.tuning, a.tick, fresh);
      shadow = createArena(shadow.tuning, shadow.tick, fresh);
      stats.rounds++;
    }
    if (c < 0.028) stats.churn++;
    syncKeepers(a, members);
    syncKeepers(shadow, members);
    const plans = a.keepers.map((k) => {
      const inputs: Input[] = [];
      let prev = k.world.input;
      const n = k.connected && rand() < 0.7 ? Math.floor(rand() * 3) : 0;
      for (let j = 0; j < n; j++)
        inputs.push(
          (prev = next(
            prev,
            k,
            a.keepers.filter((r) => r.id !== k.id),
          )),
        );
      return { id: k.id, steps: stepInputs(k.world.input, inputs) };
    });
    for (let i = 0; i < 3; i++) {
      for (const arena of [a, shadow])
        for (const plan of plans)
          arena.keepers.find((k) => k.id === plan.id)!.world.input = {
            ...plan.steps[i]!,
          };
      const thrown = a.keepers.reduce((n, k) => n + k.bomb.thrown, 0),
        before = a.keepers.reduce((n, k) => n + k.bomb.knockouts, 0),
        blasts = a.blasts.length;
      const orphans = a.bombs.filter((b) => {
        const owner = a.keepers.find((k) => k.id === b.owner)!;
        return (
          !owner.connected ||
          a.contest.entries.some((e) => e.id === owner.id && e.out)
        );
      }).length;
      const known = new Set(a.bombs.map((b) => b.id));
      stepArena(a);
      stepArena(shadow);
      stats.throws += a.keepers.reduce((n, k) => n + k.bomb.thrown, 0) - thrown;
      stats.knockouts +=
        a.keepers.reduce((n, k) => n + k.bomb.knockouts, 0) - before;
      if (orphans) stats.orphanSteps++;
      if (orphans && a.blasts.length > blasts) stats.orphanBlasts++;
      const at = (e: { tick: number }) => e.tick === a.tick;
      stats.pickups += a.pickupEvents.filter(at).length;
      stats.shieldPops += a.shieldPops.filter(at).length;
      for (const b of a.bombs)
        if (!known.has(b.id)) {
          if (b.kind === "cluster") stats.clusterThrows++;
          if (b.kind === "bomblet") stats.bomblets++;
        }
      stats.dashes += a.keepers.filter((k) => k.world.dash).length;
      stats.poweredOwners += a.bombs.filter(
        (b) => a.keepers.find((k) => k.id === b.owner)!.power.kind,
      ).length;
    }
    // Random walks seldom climb to a pad, so a keeper who could collect one
    // now and then gets what a pickup grants (a pad's cooldown and cycle are
    // checked on their own, and the walks still collect some).
    const pool = powerPool(a.tuning),
      eligible = a.keepers.filter(
        (k) =>
          k.connected &&
          !k.world.respawn &&
          (a.tuning.rules === "free" ||
            (a.contest.phase === "active" &&
              a.contest.entries.some((e) => e.id === k.id && !e.out))),
      );
    if (pool.length && eligible.length && rand() < 0.04) {
      const id = pick(eligible).id,
        kind = pick(pool);
      for (const arena of [a, shadow])
        grantPower(
          arena.keepers.find((k) => k.id === id)!,
          kind,
          arena.tuning.jumpMode,
        );
      stats.grants++;
    }
    const label = `seed ${seed} ${tuning.rules}/${tuning.bomb} tick ${tick}`;
    const restored = decodeArena(JSON.parse(JSON.stringify(encodeArena(a))));
    assert.ok(restored, `${label}: a reachable checkpoint decodes`);
    const now = canonArena(a);
    assert.equal(canonArena(restored), now, `${label}: and re-encodes exactly`);
    assert.equal(
      canonArena(shadow),
      now,
      `${label}: restores fold on identically`,
    );
    if (rand() < 0.1) {
      a = restored;
      stats.restores++;
    }
  }
}
test("seeded churn with live bombs and power-ups checkpoints every log tick exactly and restores fold on identically", () => {
  // Shield and Cluster bomb alone (bits 2 and 4) put more bombs in powered hands.
  const bombPowers = 2 | 4;
  const cases: [
    number,
    Tuning["rules"],
    Tuning["bomb"],
    Tuning["map"],
    Tuning["jumpMode"],
    number,
  ][] = [
    [11, "elimination", "fuse", "belfry", "double", ALL_POWERS],
    [12, "elimination", "impact", "crossroads", "single", ALL_POWERS],
    [13, "score", "fuse", "crossroads", "double", bombPowers],
    [14, "score", "impact", "belfry", "single", ALL_POWERS],
    [15, "free", "fuse", "belfry", "single", bombPowers],
    [16, "free", "off", "crossroads", "double", ALL_POWERS],
  ];
  for (const [seed, rules, bomb, map, jumpMode, powerUps] of cases)
    run(
      seed,
      {
        ...DEFAULT_TUNING,
        rules,
        bomb,
        map,
        jumpMode,
        powerUps,
        experiment: "ricochet",
      },
      1500,
    );
  // The workload really exercised what it claims (seeded, so these are exact
  // today; the bounds leave room for rule tuning).
  const summary = JSON.stringify(stats);
  assert.ok(stats.throws > 100, summary);
  assert.ok(stats.knockouts > 10, summary);
  assert.ok(stats.orphanSteps > 50 && stats.orphanBlasts > 0, summary);
  assert.ok(stats.rounds > 10 && stats.churn > 100, summary);
  assert.ok(stats.restores > 300, summary);
  assert.ok(stats.pickups > 10 && stats.grants > 100, summary);
  assert.ok(stats.clusterThrows > 10 && stats.bomblets > 30, summary);
  assert.ok(stats.shieldPops > 0 && stats.dashes > 20, summary);
  assert.ok(stats.poweredOwners > 1000, summary);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  createArena,
  decodeArena,
  encodeArena,
  stepArena,
  syncKeepers,
  type Arena,
  type Member,
} from "../src/engine/arena.js";
import {
  DEFAULT_TUNING,
  type Input,
  type Tuning,
} from "../src/engine/world.js";
import { stepInputs } from "../src/online/game.js";
import { canonArena } from "./fixtures/canon.js";

/**
 * A bounded version of the 11B review fuzz: seeded inputs through the room's
 * own fold (`stepInputs`), membership churn, fresh rounds, live bombs whose
 * owner leaves play, and a checkpoint after every log tick. Each tick's
 * checkpoint must decode and re-encode exactly, and an arena restored from
 * checkpoints must fold on like one that never was.
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
};
function run(seed: number, tuning: Tuning, ticks: number): void {
  const rand = rng(seed),
    pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
  let a = createArena(tuning),
    shadow = createArena(tuning),
    members: Member[] = [];
  const next = (prev: Input, rivals: Arena["keepers"]): Input => {
    const input = { ...prev },
      r = rand();
    if (r < 0.08) input.move = (Math.floor(rand() * 3) - 1) as Input["move"];
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
      // A lobby return, rematch or settings change: a fresh arena.
      a = createArena(a.tuning, a.tick);
      shadow = createArena(shadow.tuning, shadow.tick);
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
      stepArena(a);
      stepArena(shadow);
      stats.throws += a.keepers.reduce((n, k) => n + k.bomb.thrown, 0) - thrown;
      stats.knockouts +=
        a.keepers.reduce((n, k) => n + k.bomb.knockouts, 0) - before;
      if (orphans) stats.orphanSteps++;
      if (orphans && a.blasts.length > blasts) stats.orphanBlasts++;
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
test("seeded churn with live bombs checkpoints every log tick exactly and restores fold on identically", () => {
  const cases: [number, Tuning["rules"], Tuning["bomb"], Tuning["map"]][] = [
    [11, "elimination", "fuse", "belfry"],
    [12, "elimination", "impact", "crossroads"],
    [13, "score", "fuse", "crossroads"],
    [14, "score", "impact", "belfry"],
    [15, "free", "fuse", "belfry"],
    [16, "free", "off", "crossroads"],
  ];
  for (const [seed, rules, bomb, map] of cases)
    run(
      seed,
      { ...DEFAULT_TUNING, rules, bomb, map, experiment: "ricochet" },
      1000,
    );
  // The workload really exercised what it claims (seeded, so these are exact
  // today; the bounds leave room for rule tuning).
  const summary = JSON.stringify(stats);
  assert.ok(stats.throws > 100, summary);
  assert.ok(stats.knockouts > 10, summary);
  assert.ok(stats.orphanSteps > 50 && stats.orphanBlasts > 0, summary);
  assert.ok(stats.rounds > 10 && stats.churn > 100, summary);
  assert.ok(stats.restores > 300, summary);
});

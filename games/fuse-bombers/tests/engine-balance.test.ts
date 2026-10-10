import test from "node:test";
import assert from "node:assert/strict";
import {
  futureAngle,
  predictTrajectory,
  TICK_HZ,
  type RoundState,
} from "../src/engine/index.js";
import { int } from "../src/engine/rng.js";
import { playOut, spamInputs } from "./engine-helpers.js";

// Headless balance checks. They pin the tuning to the design: rounds end within 3 minutes whatever
// the players do, and aiming well ends them well before the fuse, so sudden death is the backstop.

const LIMIT_SECONDS = 180;

/** True when a shot at `angle` hits an opponent or lands right next to one. */
function goodShot(state: RoundState, id: number, angle: number): boolean {
  const t = predictTrajectory(state, id, angle, { maxTicks: 300 });
  if (t.impact.kind === "castle" || t.impact.kind === "shield") return true;
  if (t.impact.kind !== "terrain") return false;
  return state.castles.some(
    (o) => o.alive && o.id !== id && Math.abs(o.x - t.impact.x) < 30,
  );
}

/**
 * A decent aimer, like a practised human: it looks `reaction` ticks ahead with `futureAngle` and
 * presses when that shot would land on an opponent, but the press lands up to 3 ticks (50 ms) early
 * or late. `aims[id]` says which castles it plays; the others fire whenever loaded.
 */
function decentAim(seed: number, aims: (id: number) => boolean, reaction = 8) {
  const rng = { rng: seed };
  const pressAt = new Map<number, number>();
  return (state: RoundState): boolean[] => {
    const spam = spamInputs(state);
    return state.castles.map((c) => {
      if (!aims(c.id)) return spam[c.id] ?? false;
      const at = pressAt.get(c.id);
      if (at !== undefined) {
        if (state.tick < at) return false;
        pressAt.delete(c.id);
        return true;
      }
      if (!c.alive || c.volleyLeft > 0 || c.reloadTicks > reaction)
        return false;
      if (!goodShot(state, c.id, futureAngle(state, c.id, reaction)))
        return false;
      pressAt.set(c.id, state.tick + reaction + int(rng, -3, 3));
      return false;
    });
  };
}

test("headless 'fire whenever loaded' rounds end within the time limit", () => {
  for (const players of [2, 3, 4, 5, 6]) {
    for (const seed of [1, 2, 3]) {
      let peak = 0;
      const s = playOut({ seed, playerCount: players }, spamInputs, (st) => {
        peak = Math.max(peak, st.rockets.length);
      });
      assert.ok(s.result, `round ${players}p seed ${seed} did not end`);
      const seconds = s.result.tick / TICK_HZ;
      assert.ok(
        seconds <= LIMIT_SECONDS,
        `${players}p seed ${seed} took ${seconds}s`,
      );
      assert.ok(
        seconds >= 20,
        `${players}p seed ${seed} ended suspiciously fast (${seconds}s)`,
      );
      assert.ok(peak <= s.tuning.maxRockets);
      assert.notEqual(
        s.result.reason,
        "timeout",
        `${players}p seed ${seed} needed the hard limit`,
      );
    }
  }
});

test("rounds between decent aimers usually end before the fuse burns out", () => {
  const seconds: number[] = [];
  for (const players of [2, 3, 4]) {
    for (const seed of [1, 2, 3, 4]) {
      const s = playOut(
        { seed, playerCount: players },
        decentAim(seed, () => true),
      );
      assert.ok(s.result && s.result.reason !== "timeout");
      seconds.push(s.result.tick / TICK_HZ);
    }
  }
  seconds.sort((a, b) => a - b);
  const median = seconds[seconds.length / 2] ?? Infinity;
  const beforeFuse = seconds.filter((t) => t < 90).length;
  assert.ok(median >= 30 && median <= 80, `median ${median}s: ${seconds}`);
  assert.ok(beforeFuse >= 9, `only ${beforeFuse}/12 before the fuse`);
});

test("a decent aimer usually beats 'fire whenever loaded' before sudden death", () => {
  let wins = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const aimer = seed % 2;
    const s = playOut(
      { seed, playerCount: 2 },
      decentAim(seed, (id) => id === aimer),
    );
    if (s.result?.winner === aimer && s.result.tick < s.fuseTicks) wins++;
  }
  // Crates reward volume, so the spammer sometimes out-heals the aimer until the bombs fall.
  assert.ok(wins >= 14, `the aimer won only ${wins}/20 before sudden death`);
});

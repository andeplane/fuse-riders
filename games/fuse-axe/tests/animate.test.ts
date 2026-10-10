import test from "node:test";
import assert from "node:assert/strict";
import { GRAVITY, JUMP_VZ } from "../src/engine/tuning.js";
import {
  HERO_KINDS,
  HERO_STATES,
  SWING_STEPS,
} from "../src/engine/view-kit.js";
import type { HeroKind } from "../src/engine/view.js";
import {
  BREATH_STEPS,
  HERO_ANIMS,
  HERO_FRAMES,
  HERO_TIMING,
  heroFrame,
  WALK_STEPS,
  type HeroTiming,
} from "../src/render/art/animate.js";

const swings = (...steps: [number, number, number][]) =>
  steps.map(([startup, active, recovery]) => ({ startup, active, recovery }));
/** Timing that differs per hero, so the mapping is seen to read the hero's own. */
const TIMING: Readonly<Record<HeroKind, HeroTiming>> = {
  brakka: { swings: swings([6, 3, 10], [6, 3, 10], [9, 4, 20]), rise: 20 },
  rhea: { swings: swings([4, 3, 8], [4, 3, 8], [7, 4, 16]), rise: 18 },
  gorm: { swings: swings([8, 4, 13], [8, 4, 13], [12, 5, 24]), rise: 22 },
};
const steps = (n: number) => [...Array(n).keys()];

test("a swing shows its strike frame exactly while the blade is out, the wind-up before and the follow-through after", () => {
  for (const kind of HERO_KINDS)
    TIMING[kind].swings.forEach(({ startup, active, recovery }, i) => {
      const frames = steps(startup + active + recovery + 5).map((step) =>
        heroFrame(kind, `attack${i + 1}`, step, TIMING),
      );
      const n = i + 1;
      assert.deepEqual(frames, [
        ...Array<string>(startup).fill(`windup${n}`),
        ...Array<string>(active).fill(`strike${n}`),
        ...Array<string>(recovery + 5).fill(`follow${n}`),
      ]);
    });
});

test("the walk cycles through its six frames, each held for the hero's cadence", () => {
  for (const kind of HERO_KINDS) {
    const hold = WALK_STEPS[kind];
    const cycle = steps(6 * hold).map((step) =>
      heroFrame(kind, "walk", step, TIMING),
    );
    assert.deepEqual(
      cycle,
      steps(6).flatMap((i) => Array<string>(hold).fill(`walk${i}`)),
    );
    for (const step of steps(3 * cycle.length))
      assert.equal(
        heroFrame(kind, "walk", step, TIMING),
        cycle[step % cycle.length],
      );
  }
});

test("idle breathes slowly, a jump rises then falls, and the rest hold one frame", () => {
  const frame = (anim: string, step: number) =>
    heroFrame("brakka", anim, step, TIMING);
  const breath = steps(4 * BREATH_STEPS).map((step) => frame("idle", step));
  assert.deepEqual(breath, [
    ...Array<string>(BREATH_STEPS).fill("idle0"),
    ...Array<string>(BREATH_STEPS).fill("idle1"),
    ...Array<string>(BREATH_STEPS).fill("idle0"),
    ...Array<string>(BREATH_STEPS).fill("idle1"),
  ]);
  for (const kind of HERO_KINDS) {
    const { rise } = TIMING[kind];
    assert.deepEqual(
      [0, rise - 1, rise, rise + 30].map((step) =>
        heroFrame(kind, "jump", step, TIMING),
      ),
      ["rise", "rise", "fall", "fall"],
    );
  }
  const held = ["land", "hurt", "knockdown", "down", "getup", "dead"];
  assert.deepEqual(
    held.map((anim) => [frame(anim, 0), frame(anim, 99)]),
    [
      ["land", "land"],
      ["hurt", "hurt"],
      ["knockdown", "knockdown"],
      ["down", "down"],
      ["getup", "getup"],
      ["down", "down"],
    ],
  );
});

test("every anim the engine has, and every one it will have, maps to a hero frame", () => {
  for (const state of HERO_STATES) assert.ok(HERO_ANIMS.includes(state));
  for (const kind of HERO_KINDS)
    for (const anim of HERO_ANIMS)
      for (const step of steps(80))
        assert.ok(HERO_FRAMES.includes(heroFrame(kind, anim, step, TIMING)));
});

test("an unknown anim, a step that is not a whole number from 0 or a swing without timing fails loudly", () => {
  assert.throws(
    () => heroFrame("brakka", "dance", 0, TIMING),
    /No frames for the anim "dance"/,
  );
  for (const step of [-1, 1.5, Number.NaN])
    assert.throws(
      () => heroFrame("brakka", "idle", step, TIMING),
      /whole number from 0/,
    );
  const short = { ...TIMING, gorm: { ...TIMING.gorm, swings: [] } };
  assert.throws(
    () => heroFrame("gorm", "attack2", 0, short),
    /No timing for gorm's attack2/,
  );
});

test("by default the frames follow the engine's swings and its jump's apex", () => {
  for (const kind of HERO_KINDS) {
    assert.equal(HERO_TIMING[kind].swings, SWING_STEPS[kind]);
    assert.equal(HERO_TIMING[kind].rise, Math.ceil(JUMP_VZ / GRAVITY));
    for (const anim of HERO_ANIMS)
      for (const step of steps(60))
        assert.equal(
          heroFrame(kind, anim, step),
          heroFrame(kind, anim, step, HERO_TIMING),
        );
  }
});

test("the same anim and step always give the same frame", () => {
  const run = () =>
    HERO_KINDS.flatMap((kind) =>
      HERO_ANIMS.flatMap((anim) =>
        steps(120).map((step) => heroFrame(kind, anim, step, TIMING)),
      ),
    );
  assert.deepEqual(run(), run());
});

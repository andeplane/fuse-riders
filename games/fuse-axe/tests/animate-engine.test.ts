import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  HERO_KINDS,
  JUMP,
  createWorld,
  spawnEnemy,
  step,
  toView,
  type HeroKind,
  type HeroState,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import { JUMP_RISE_STEPS } from "../src/engine/view-kit.js";
import { heroFrame } from "../src/render/art/animate.js";

// `heroFrame` against the real engine: the frame the view of a world asks for, step by step, not the timing tables.
const { px } = T;
const FULL = T.ENEMY_HP.ravager;
const solo = (kind: HeroKind) =>
  createWorld({ seed: 1, heroes: [{ seat: 0, kind }] });
const frameOf = (world: World) => {
  const [hero] = toView(world).heroes;
  return heroFrame(hero!.kind, hero!.anim, hero!.animStep);
};
/** A ravager within reach of the hero, a step from being cut if the blade is out. */
const within = (world: World) => {
  const hero = world.heroes[0]!;
  return spawnEnemy(world, "ravager", hero.x + px(10), hero.y);
};
const SWINGS = ["attack1", "attack2", "attack3"] as const satisfies HeroState[];

test("a hero shows its strike exactly on the steps its blade is out, through every swing of the combo", () => {
  for (const kind of HERO_KINDS) {
    let world = solo(kind);
    const struck = new Set<string>();
    for (let index = 0; index < 150; index++) {
      const held = [index % 2 ? 0 : ATTACK];
      // Whether a ravager standing in reach would be cut by this very step, asked of a copy with one in it.
      const bladeOut = step(within(world), held).enemies[0]!.hp < FULL;
      world = step(world, held);
      const frame = frameOf(world);
      assert.equal(frame.startsWith("strike"), bladeOut, `${kind}: ${frame}`);
      if (bladeOut) struck.add(frame);
    }
    assert.deepEqual([...struck].sort(), ["strike1", "strike2", "strike3"]);
  }
});

test("a hit's freeze holds the strike frame, and the swing runs on from it", () => {
  for (const kind of HERO_KINDS)
    T.COMBO[kind].forEach(({ startup }, index) => {
      const [anim, strike] = [SWINGS[index]!, `strike${index + 1}`];
      const start = within(solo(kind));
      // The hero is a step from the blade being out; this step lands the hit.
      let world = step(
        {
          ...start,
          heroes: [{ ...start.heroes[0]!, state: anim, timer: startup - 1 }],
        },
        [0],
      );
      assert.ok(world.enemies[0]!.hp < FULL, `${kind} ${anim} hits`);
      const hit = toView(world).heroes[0]!;
      assert.deepEqual([hit.animStep, frameOf(world)], [startup, strike]);
      for (
        let held = 0;
        held < (index === 2 ? T.HEAVY_HITSTOP : T.HITSTOP);
        held++
      ) {
        world = step(world, [0]);
        assert.equal(
          toView(world).heroes[0]!.animStep,
          startup,
          `${kind} ${anim}`,
        );
        assert.equal(frameOf(world), strike);
      }
      world = step(world, [0]);
      assert.equal(toView(world).heroes[0]!.animStep, startup + 1);
    });
});

test("a jump shows its rise while it climbs and its fall from the step it drops, then the landing", () => {
  for (const kind of HERO_KINDS) {
    let world = solo(kind);
    let [z, rising] = [0, 0];
    for (let index = 0; world.heroes[0]!.state !== "land"; index++) {
      assert.ok(index < 100, "never landed");
      world = step(world, [index === 0 ? JUMP : 0]);
      const hero = world.heroes[0]!;
      if (hero.state === "land") break;
      const climbing = hero.z > z;
      assert.equal(
        frameOf(world),
        climbing ? "rise" : "fall",
        `${kind} ${index}`,
      );
      if (climbing) rising++;
      z = hero.z;
    }
    assert.equal(rising, JUMP_RISE_STEPS);
    assert.equal(frameOf(world), "land");
  }
});

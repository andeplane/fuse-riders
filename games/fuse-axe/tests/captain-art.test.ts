import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorld,
  spawnEnemy,
  spawnMount,
  step,
  toView,
  type EnemyKind,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import type { MountAnim } from "../src/engine/view.js";
import {
  DRAKE_STEPS,
  ENEMY_STATES,
  MOUNT_STATES,
  OGRE_STEPS,
  SPEAR,
} from "../src/engine/view-kit.js";
import {
  enemyFrame,
  enemyRiderFrame,
  stripFrame,
} from "../src/render/art/animate.js";
import {
  CAPTAIN,
  CAPTAIN_ANIMS,
  CAPTAIN_GEAR,
  CAPTAIN_POSES,
  CAPTAIN_SADDLE,
  type CaptainFrame,
} from "../src/render/art/captain.js";
import { FIGURES } from "../src/render/art/index.js";
import {
  LANCER,
  LANCER_ANIMS,
  paintLancer,
  spearEnds,
  type LancerFrame,
} from "../src/render/art/lancer.js";
import {
  CLEAR,
  flipSprite,
  validateSprite,
  type Sprite,
} from "../src/render/pixel/sprite.js";

const { px } = T;
const FRAMES = CAPTAIN.frames;
const sprite = (frame: CaptainFrame) => CAPTAIN.sprite(frame);
/** The columns from the feet anchor of a sprite's pixels on row `y` that `match`. */
const columns = (s: Sprite, y: number, match: RegExp) =>
  [...s.rows[y]!].flatMap((key, x) => (match.test(key) ? [x - s.ax] : []));
/** The furthest column ahead of the anchor that anything but the outline is painted in. */
const front = (s: Sprite) =>
  Math.max(...s.rows.map((_, y) => Math.max(...columns(s, y, /[^.k]/))));
const count = (s: Sprite, match: RegExp) =>
  [...s.rows.join("")].filter((key) => match.test(key)).length;
const party = (seed = 5) =>
  createWorld({ seed, heroes: [{ seat: 0, kind: "brakka" }] });
/** The captain `dx` px in front of the one hero (Brakka), facing him, on his drake if `mounted`. */
function captain(dx: number, mounted: boolean, seed = 5): World {
  const world = party(seed);
  const { x, y } = world.heroes[0]!;
  const next = spawnEnemy(world, "captain", x + px(dx), y, 2);
  const boss = next.enemies.at(-1)!;
  return mounted ? spawnMount(next, boss.x, boss.y, boss.id, "drake") : next;
}

test("every captain frame is a valid sprite, painted inside the lancer's canvas and standing on its anchor", () => {
  assert.deepEqual(FRAMES, Object.keys(CAPTAIN_POSES));
  assert.equal(FIGURES.captain, CAPTAIN);
  const { size, anchor } = CAPTAIN_POSES.idle;
  for (const frame of FRAMES) {
    const pose = CAPTAIN_POSES[frame];
    // Painting throws if anything reaches the canvas's outermost pixels, so a frame that paints fits its canvas.
    const painted = paintLancer(pose, CAPTAIN_GEAR);
    validateSprite(painted);
    assert.deepEqual([pose.size, pose.anchor], [size, anchor], frame);
    assert.deepEqual(painted, sprite(frame), "painted once, the same");
    // The anchor is on every frame's lowest painted row, only the outline under it: his cape drapes along the floor
    // rather than through it when he is flung down or lies.
    assert.equal(painted.ay, painted.h - 2, `${frame} floats or sinks`);
    assert.equal(painted.rows[painted.ay + 1]!.replaceAll("k", CLEAR), CLEAR.repeat(painted.w)); // prettier-ignore
  }
});

test("the captain is no lancer at a glance: black steel edged in gold, a taller crest and a cape behind him", () => {
  for (const frame of FRAMES) {
    const s = sprite(frame);
    // Black steel and gold in every frame, white steel only in the spear's head: a quarter of a lancer's at most.
    assert.ok(count(s, /[Ii#]/) >= 90, `${frame} is not in black steel`);
    assert.ok(count(s, /[Nn8]/) >= 60, `${frame} has no gold`);
    if (!(LANCER.frames as string[]).includes(frame)) continue;
    const lancer = LANCER.sprite(frame as LancerFrame);
    assert.ok(count(s, /[Mm7]/) * 4 <= count(lancer, /[Mm7]/), frame);
    // The cape reaches further behind him than anything a lancer's frame paints.
    assert.ok(s.ax >= lancer.ax, `${frame}'s cape`);
  }
  // Standing, the crest makes him taller than a lancer, and the cape shows behind him.
  const [idle, lancer] = [sprite("idle"), LANCER.sprite("idle")];
  assert.ok(idle.h >= lancer.h + 4, `${idle.h} against ${lancer.h}`);
  assert.ok(idle.ax >= lancer.ax + 2, `${idle.ax} against ${lancer.ax}`);
  // His spear is the heavier one: its head, the steel in the last few pixels to the point, is broader.
  const head = (s: Sprite) =>
    s.rows.reduce((n, _, y) => n + columns(s, y, /[Mm7]/).filter((x) => x > front(s) - 6).length, 0); // prettier-ignore
  assert.ok(head(sprite("thrust")) > head(LANCER.sprite("thrust")));
});

test("every captain anim plays frames he has, every frame is played, and his own strips are the engine's steps", () => {
  const played = new Set<string>();
  const strips = [...Object.entries(CAPTAIN_ANIMS), ...Object.entries(CAPTAIN_SADDLE)]; // prettier-ignore
  for (const [anim, strip] of strips)
    for (const [frame, steps] of strip.frames) {
      assert.ok(FRAMES.includes(frame), `${anim} plays ${frame}`);
      assert.ok(Number.isInteger(steps) && steps > 0, `${anim} ${frame}`);
      played.add(frame);
    }
  assert.deepEqual([...played].sort(), [...FRAMES].sort());
  // On foot a lancer's, but the stagger his own, as long as the engine staggers a boss.
  for (const anim of Object.keys(LANCER_ANIMS) as (keyof typeof LANCER_ANIMS)[])
    // prettier-ignore
    assert.equal(CAPTAIN_ANIMS[anim], LANCER_ANIMS[anim], anim);
  assert.deepEqual(CAPTAIN_ANIMS.stagger, { frames: [["stagger", OGRE_STEPS.stagger]], loop: false }); // prettier-ignore
  assert.equal(OGRE_STEPS.stagger, T.STAGGER_STEPS);
  // `enemyFrame` never throws: any anim the view has at any step is one of his frames.
  for (const anim of ENEMY_STATES)
    for (const animStep of [0, 2.5, -4, Number.NaN, Infinity, 1e9])
      sprite(enemyFrame("captain", anim, animStep) as CaptainFrame);
});

test("in the engine the captain staggers in his own frame on every step his armour holds him, no more", () => {
  // Brakka's finisher, its blade a step from out, at the captain on foot 30 px in front.
  const swing = T.COMBO.brakka[2];
  const afoot = captain(30, false);
  let world: World = {
    ...afoot,
    heroes: afoot.heroes.map((h) => ({ ...h, state: "attack3", timer: swing.startup - 1 })), // prettier-ignore
    enemies: afoot.enemies.map((e) => ({ ...e, thinkAt: 9999 })),
  };
  const staggered: number[] = [];
  for (let i = 0; i < T.HITSTOP + T.STAGGER_STEPS + 20; i++) {
    world = step(world, []);
    const { kind, anim, animStep } = toView(world).enemies[0]!;
    const frame = enemyFrame(kind, anim, animStep);
    assert.equal(frame === "stagger", anim === "stagger", `${anim} ${frame}`);
    if (anim === "stagger") staggered.push(animStep);
  }
  // The engine holds him `STAGGER_STEPS` once the hit's freeze is over, and the strip is as long.
  const steps = new Set(staggered);
  assert.equal(steps.size, T.STAGGER_STEPS);
  assert.equal(Math.max(...steps) + 1, OGRE_STEPS.stagger);
});

test("in the saddle he draws the spear back through the thrust's wind-up and drives it out on the very step it lands", () => {
  // The strip: drawn back below `lanceWindup`, out from it to the thrust's end, held after; odd steps round down.
  for (let animStep = 0; animStep < DRAKE_STEPS.lance + 5; animStep++)
    assert.equal(
      enemyRiderFrame("captain", "lance", animStep),
      animStep < DRAKE_STEPS.lanceWindup ? "ridewindup" : "ridethrust",
    );
  assert.equal(enemyRiderFrame("captain", "lance", DRAKE_STEPS.lanceWindup - 0.5), "ridewindup"); // prettier-ignore
  // He thrusts now and then where the drake would breathe: play seeds until one of his first blows is a thrust.
  for (let seed = 1; seed < 40; seed++) {
    let world = captain(30, true, seed);
    const full = world.heroes[0]!.hp;
    const frames: string[] = [];
    for (let i = 0; i < 120 && world.heroes[0]!.hp === full; i++) {
      world = step(world, []);
      const { anim, animStep } = toView(world).mounts[0]!;
      if (anim === "lance")
        frames.push(enemyRiderFrame("captain", anim, animStep)!);
    }
    if (!frames.length) continue;
    // Drawn back on every step of the wind-up, and out on the step the spear hurts the hero.
    assert.deepEqual(frames, [...Array<string>(DRAKE_STEPS.lanceWindup).fill("ridewindup"), "ridethrust"]); // prettier-ignore
    assert.ok(world.heroes[0]!.hp < full);
    return;
  }
  assert.fail("the captain never thrust");
});

test("the saddle thrust's point is at the spear's reach, the wind-up's drawn back and glinting, and he sits for the rest", () => {
  const thrust = sprite("ridethrust");
  const reach = Math.round(SPEAR.reach);
  assert.ok(Math.abs(front(thrust) - reach) <= 1, `${front(thrust)}`);
  const { tip } = spearEnds(CAPTAIN_POSES.ridethrust);
  assert.equal(tip[0] - CAPTAIN_POSES.ridethrust.anchor[0], SPEAR.reach);
  // The point is steel, on the reach's column facing either way.
  const steel = /[Mm7]/;
  const row = thrust.rows.findIndex((_, y) => columns(thrust, y, steel).includes(front(thrust))); // prettier-ignore
  assert.ok(row >= 0, "the point is steel");
  assert.ok(columns(flipSprite(thrust), row, steel).includes(-front(thrust)));
  // The wind-up draws it back short of where he holds it couched, its point glinting; the thrust streaks.
  const windup = sprite("ridewindup");
  assert.ok(front(windup) <= front(sprite("ride")) - 3, `${front(windup)}`);
  const glows = (frame: CaptainFrame) => /[ZF]/.test(sprite(frame).rows.join("")); // prettier-ignore
  assert.deepEqual(
    (["ride", "ridewindup", "ridethrust"] as const).filter(glows),
    ["ridewindup", "ridethrust"],
  );
  // Seated in all three: the same hips on the seat and boot in the stirrup, the far leg out of sight.
  for (const frame of ["ridewindup", "ridethrust"] as const) {
    const [pose, ride] = [CAPTAIN_POSES[frame], CAPTAIN_POSES.ride];
    assert.deepEqual([pose.far.hip, pose.near.hip, pose.near.ankle], [ride.far.hip, ride.near.hip, ride.near.ankle]); // prettier-ignore
    assert.equal(pose.astride, true);
  }
  // Astride, one boot shows on the anchor's row, not two.
  const boots = (s: Sprite) =>
    s.rows[s.ay]!.replace(/[^Ll9]+/g, " ")
      .trim()
      .split(" ").length;
  assert.deepEqual((["ride", "ridewindup", "ridethrust", "idle"] as const).map((frame) => boots(sprite(frame))), [1, 1, 1, 2]); // prettier-ignore
  // Doing anything else the drake does, he sits; no other rider has a saddle strip.
  for (const anim of MOUNT_STATES.filter((each) => each !== "lance"))
    assert.equal(enemyRiderFrame("captain", anim, 30), undefined, anim);
});

test("an enemy rider's saddle frame never throws: an odd kind, anim or step has none, or one the figure has", () => {
  const odd = JSON.parse('["dance", "__proto__", "toString"]') as string[];
  const kinds = [...(["ravager", "lancer", "captain", "imp", "ogre", "bonewalker"] as const), ...odd] as EnemyKind[]; // prettier-ignore
  const anims = [...MOUNT_STATES, ...odd] as MountAnim[];
  for (const kind of kinds)
    for (const anim of anims)
      for (const animStep of [
        0,
        23,
        24,
        35,
        1e9,
        -3,
        2.5,
        Number.NaN,
        Infinity,
      ]) {
        const frame = enemyRiderFrame(kind, anim, animStep);
        if (kind === "captain" && anim === "lance")
          sprite(frame as CaptainFrame); // prettier-ignore
        else assert.equal(frame, undefined, `${kind} ${anim}`);
      }
  // As `enemyFrame` does for his own anims, rounding an odd step down.
  assert.equal(enemyRiderFrame("captain", "lance", Number.NaN), stripFrame(CAPTAIN_SADDLE.lance!, 0)); // prettier-ignore
  // Otherwise he sits in his own seated frame, however long he rides.
  for (const animStep of [0, 31, 32, 1e6, -2, Number.NaN])
    assert.equal(enemyFrame("captain", "ride", animStep), "ride");
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  JUMP,
  createWorld,
  spawnEnemy,
  spawnMount,
  step,
  toView,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import type { MountAnim, MountKind } from "../src/engine/view.js";
import {
  CLAWBEAK,
  CLAWBEAK_STEPS,
  MOUNT_STATES,
} from "../src/engine/view-kit.js";
import {
  enemyFrame,
  mountFrame,
  stripFrame,
} from "../src/render/art/animate.js";
import {
  CLAWBEAK_ANIMS,
  CLAWBEAK_DIPS,
  CLAWBEAK_FIGURE,
  CLAWBEAK_POSES,
  CLAWBEAK_WALK_STEPS,
  LASH_STEPS,
  paintClawbeak,
  type ClawbeakFrame,
} from "../src/render/art/clawbeak.js";
import { FIGURES } from "../src/render/art/index.js";
import {
  RAVAGER,
  RAVAGER_ANIMS,
  RAVAGER_POSES,
} from "../src/render/art/ravager.js";
import {
  CLEAR,
  flipSprite,
  validateSprite,
  type Sprite,
} from "../src/render/pixel/sprite.js";

const { px } = T;
const FRAMES = CLAWBEAK_FIGURE.frames;
const sprite = (frame: ClawbeakFrame) => CLAWBEAK_FIGURE.sprite(frame);
/** The frames a ridden beast shows: its rider sits on each one's saddle. */
const RIDDEN = new Set(
  (["idle", "walk", "enter", "sweep", "hop"] as const).flatMap((anim) =>
    CLAWBEAK_ANIMS[anim].frames.map(([frame]) => frame),
  ),
);
const length = (anim: MountAnim) =>
  CLAWBEAK_ANIMS[anim].frames.reduce((sum, [, steps]) => sum + steps, 0);
/** The columns from the feet anchor of the pixels in a sprite whose key `match`es, on any row. */
const columns = (s: Sprite, match: RegExp) =>
  s.rows.flatMap((row) =>
    [...row].flatMap((key, x) => (match.test(key) ? [x - s.ax] : [])),
  );
/** The tail's lash: its smear's white-hot rim and gold and ember body (the eye glows too, but in `D`). */
const SMEAR = /[ZFf~]/;

test("every clawbeak frame is a valid sprite, painted inside one canvas and standing on one anchor", () => {
  assert.deepEqual(FRAMES, Object.keys(CLAWBEAK_POSES));
  assert.equal(FIGURES.clawbeak, CLAWBEAK_FIGURE);
  for (const frame of FRAMES) {
    const pose = CLAWBEAK_POSES[frame];
    // Painting throws if anything reaches the canvas's outermost pixels, so a frame that paints fits its canvas.
    const painted = paintClawbeak(pose);
    validateSprite(painted);
    assert.deepEqual(pose.size, CLAWBEAK_POSES.idle.size, frame);
    assert.deepEqual(pose.anchor, CLAWBEAK_POSES.idle.anchor, frame);
    assert.deepEqual(painted, sprite(frame), "painted once, the same");
    // A foot is down in every frame, the run's too: the anchor is on the lowest painted row, only the outline under it.
    assert.equal(painted.ay, painted.h - 2, `${frame} floats or sinks`);
    assert.equal(
      painted.rows[painted.ay + 1]!.replaceAll("k", CLEAR),
      CLEAR.repeat(painted.w),
    );
    // Teal hide, the gold beak, the red crest and blanket, the leather saddle and the bone claws, in every frame.
    const keys = new Set(painted.rows.join(""));
    for (const key of ["y", "n", "c", "l", "b"])
      assert.ok(keys.has(key), `${frame} lacks ${key}`);
  }
  // Standing, winding up and lashing, both feet are on the anchor's row, one either side of it.
  for (const frame of [
    "idle",
    "breathe",
    "coil1",
    "coil2",
    "lash",
    "recover",
  ] as const) {
    // prettier-ignore
    const { anchor, far, near } = CLAWBEAK_POSES[frame];
    assert.deepEqual([far.foot[1], near.foot[1]], [anchor[1] - 0.5, anchor[1] - 0.5]); // prettier-ignore
    assert.ok(far.foot[0] < anchor[0] && near.foot[0] > anchor[0], frame);
  }
  // A little over 40 px from its claws to its crest and a good deal longer, beak to tail, than it is tall.
  const idle = sprite("idle");
  assert.ok(idle.h - 2 >= 40 && idle.h - 2 <= 48, `idle is ${idle.h} tall`);
  assert.ok(idle.w >= idle.h * 1.3, `idle is ${idle.w}×${idle.h}`);
});

test("a planted foot keeps pace with the beast's walk, and nearly so walking in and wandering", () => {
  const pace = (T.BEAST_WALK.x / T.SUB) * CLAWBEAK_WALK_STEPS;
  const cycle = (["walk0", "walk1", "walk2", "walk3", "walk0"] as const).map(
    (frame) => CLAWBEAK_POSES[frame],
  );
  const ground = (i: number, side: "near" | "far") =>
    cycle[i]![side].foot[0] + i * pace;
  // The near foot is down from the first frame to the third, the far foot from the third to the next cycle's first.
  for (const i of [1, 2])
    assert.ok(Math.abs(ground(i, "near") - ground(0, "near")) < 0.05);
  for (const i of [3, 4])
    assert.ok(Math.abs(ground(i, "far") - ground(2, "far")) < 0.05);
  // The other walks hold the strut's frames for so many steps at their own pace: a foot slips at most half a pixel.
  const held = (anim: MountAnim) => CLAWBEAK_ANIMS[anim].frames[0]![1];
  for (const [anim, speed] of [
    ["walk", T.BEAST_WALK.x],
    ["leave", T.BEAST_WALK.x],
    ["enter", T.ENTER_WALK],
    ["wander", T.WANDER],
  ] as const)
    assert.ok(
      Math.abs((speed / T.SUB) * held(anim) - pace) <= 0.5,
      `${anim} slips`,
    );
});

test("every clawbeak anim plays frames the figure has, every frame is played, and the strips are the engine's steps", () => {
  assert.deepEqual(
    Object.keys(CLAWBEAK_ANIMS).sort(),
    [...MOUNT_STATES].sort(),
  );
  const played = new Set<string>();
  for (const [anim, { frames, loop }] of Object.entries(CLAWBEAK_ANIMS)) {
    for (const [frame, steps] of frames) {
      assert.ok(FRAMES.includes(frame), `${anim} plays ${frame}`);
      assert.ok(Number.isInteger(steps) && steps > 0, `${anim} ${frame}`);
      played.add(frame);
    }
    assert.equal(loop, anim !== "sweep" && anim !== "hop", anim);
  }
  assert.deepEqual([...played].sort(), [...FRAMES].sort());
  // The sweep coils for its wind-up, lashes from the very step the tail lands for `LASH_STEPS`, and recovers to its end.
  assert.equal(length("sweep"), CLAWBEAK_STEPS.sweep);
  for (let animStep = 0; animStep < CLAWBEAK_STEPS.sweep; animStep++) {
    const frame = mountFrame("clawbeak", "sweep", animStep);
    const lashing =
      animStep >= CLAWBEAK_STEPS.windup &&
      animStep < CLAWBEAK_STEPS.windup + LASH_STEPS;
    assert.equal(frame === "lash", lashing, `${animStep}`);
    if (animStep < CLAWBEAK_STEPS.windup)
      assert.match(frame, /^coil/, `${animStep}`);
  }
  // `mountFrame` plays the strips as they are and never throws: any anim at any step is one of the figure's frames, an
  // anim or a kind from a build with more of them stands as a clawbeak idles.
  const odd = JSON.parse('"drake"') as MountKind;
  const dance = JSON.parse('"dance"') as MountAnim;
  for (const anim of [...MOUNT_STATES, dance])
    for (const animStep of [0, 12, 33, 64, 2.5, -4, Number.NaN, Infinity])
      for (const kind of ["clawbeak", odd] as const) {
        const frame = mountFrame(kind, anim, animStep);
        sprite(frame as ClawbeakFrame);
        const strip = anim === dance ? CLAWBEAK_ANIMS.idle : CLAWBEAK_ANIMS[anim]; // prettier-ignore
        assert.equal(frame, stripFrame(strip, animStep));
      }
});

test("a hero's hop leaps for as many steps as its jump rises, then drops until it lands", () => {
  assert.deepEqual(CLAWBEAK_ANIMS.hop.frames, [
    ["leap", CLAWBEAK_STEPS.hopRise],
    ["drop", 1],
  ]);
  for (let animStep = 0; animStep < 3 * T.LEAP_STEPS; animStep++)
    assert.equal(
      mountFrame("clawbeak", "hop", animStep),
      animStep < CLAWBEAK_STEPS.hopRise ? "leap" : "drop",
      `${animStep}`,
    );
  // A hop in the engine plays them: the beast leaps for the steps it rises and drops for the steps it falls.
  const start = createWorld({ seed: 5, heroes: [{ seat: 0, kind: "brakka" }] });
  const { x, y } = start.heroes[0]!;
  let world = step(spawnMount(start, x + px(10), y), [JUMP]);
  world = step(step(world, []), [JUMP]);
  let [z, rose] = [0, 0];
  for (; world.mounts[0]!.state === "hop"; world = step(world, [])) {
    const { z: now, state } = world.mounts[0]!;
    const view = toView(world).mounts[0]!;
    assert.equal(view.anim, state);
    const frame = mountFrame("clawbeak", view.anim, view.animStep);
    assert.equal(frame, now > z ? "leap" : "drop", `step ${view.animStep}`);
    rose += now > z ? 1 : 0;
    z = now;
  }
  assert.equal(rose, CLAWBEAK_STEPS.hopRise);
});

test("in the engine's sweep the tail coils on every step of the wind-up and the lash shows from the very step it lands", () => {
  const start = createWorld({ seed: 5, heroes: [{ seat: 0, kind: "brakka" }] }); // prettier-ignore
  const { x, y } = start.heroes[0]!;
  const next = spawnEnemy(start, "ravager", x + px(30), y);
  let world = spawnMount(next, x + px(30), y, next.enemies.at(-1)!.id);
  const full = world.heroes[0]!.hp;
  const shown: string[] = [];
  let landed = -1;
  for (let i = 0; i < 80 && landed < 0; i++) {
    world = step(world, []);
    const { anim, animStep } = toView(world).mounts[0]!;
    if (anim !== "sweep") continue;
    const frame = mountFrame("clawbeak", anim, animStep);
    shown.push(frame);
    if (world.heroes[0]!.hp < full) {
      landed = animStep;
      assert.equal(frame, "lash");
    }
  }
  assert.equal(landed, CLAWBEAK_STEPS.windup, "the tail landed");
  assert.deepEqual(shown, [
    ...Array<string>(CLAWBEAK_STEPS.windup / 2).fill("coil1"),
    ...Array<string>(CLAWBEAK_STEPS.windup / 2).fill("coil2"),
    "lash",
  ]);
});

test("the lash's ring reaches the tail's reach either side, the tail ends on it, and only the lash glows", () => {
  const lash = sprite("lash");
  const reach = Math.round(CLAWBEAK.reach);
  for (const s of [lash, flipSprite(lash)]) {
    const ring = columns(s, SMEAR);
    assert.ok(Math.abs(Math.min(...ring) + reach) <= 1, `${Math.min(...ring)}`);
    assert.ok(Math.abs(Math.max(...ring) - reach) <= 1, `${Math.max(...ring)}`);
  }
  // The tail is whipped out level behind, its tip at the ring's end; wound up, it stood coiled over the back.
  const tip = CLAWBEAK_POSES.lash.tail.at(-1)!;
  assert.ok(Math.abs(tip[0] - CLAWBEAK_POSES.lash.anchor[0] + reach) <= 1.5);
  const crown = (frame: ClawbeakFrame) =>
    Math.min(...CLAWBEAK_POSES[frame].tail.map(([, y]) => y));
  assert.ok(crown("coil2") < CLAWBEAK_POSES.coil2.saddle[1] - 25);
  assert.ok(crown("coil2") < crown("coil1") && crown("coil1") < crown("idle"));
  const glows = (frame: ClawbeakFrame) =>
    SMEAR.test(sprite(frame).rows.join(""));
  assert.deepEqual(FRAMES.filter(glows), ["lash"]);
});

test("the rider sits astride the saddle, its boot in the stirrup, sinking with the saddle as the body dips", () => {
  const ride = RAVAGER.sprite("ride");
  const seat = RAVAGER_POSES.ride;
  const hips = (seat.far.hip[1] + seat.near.hip[1]) / 2;
  for (const frame of FRAMES) {
    const pose = CLAWBEAK_POSES[frame];
    const dip = CLAWBEAK_DIPS[frame];
    assert.equal(pose.saddle[0], pose.anchor[0], frame);
    assert.equal(pose.saddle[1], pose.anchor[1] - CLAWBEAK.saddle + dip, frame);
    if (!RIDDEN.has(frame)) continue;
    assert.ok([0, 1, 2].includes(dip), `${frame} dips ${dip}`);
    // Laid over the beast as the scene lays it, the rider's anchor on the saddle point: its hips just over the seat.
    const s = sprite(frame);
    const at = (dx: number, dy: number) =>
      s.rows[s.ay - CLAWBEAK.saddle + dip + dy]?.[s.ax + dx] ?? CLEAR;
    const rider = (dx: number, dy: number) =>
      ride.rows[ride.ay + dy]?.[ride.ax + dx] ?? CLEAR;
    // The seat's top: the highest leather over the saddle point.
    const top = Math.min(
      ...Array.from({ length: 30 }, (_, i) => -i - 1).filter((dy) =>
        /[Ll9]/.test(at(0, dy)),
      ),
    );
    const sitting = hips - seat.anchor[1];
    assert.ok(
      sitting >= top - 2 && sitting <= top + 1,
      `${frame} ${sitting} ${top}`,
    );
    // The stirrup's brass is under the boot, which hides it.
    const brass = [-1, 0, 1].flatMap((dy) =>
      [3, 4, 5].filter((dx) => /[Nn8]/.test(at(dx, dy)) && dy <= 0),
    );
    assert.ok(brass.length > 0, `${frame} has no stirrup`);
    assert.ok(/[Aa$k]/.test(rider(4, -1)), "the boot is in it");
  }
});

test("a ravager riding sits in its own seated frame, mace raised over its head, whatever the step", () => {
  assert.deepEqual(
    RAVAGER_ANIMS.ride.frames.map(([frame]) => frame),
    ["ride"],
  );
  for (const animStep of [0, 31, 32, 1e6, -2, Number.NaN])
    assert.equal(enemyFrame("ravager", "ride", animStep), "ride");
  const [ride, idle] = [RAVAGER.sprite("ride"), RAVAGER.sprite("idle")];
  // The mace's ball tops it, and astride it shows one boot, not two.
  assert.match(
    ride.rows.find((row) => /[^.k]/.test(row))!,
    /^[.kMm7]+$/,
  );
  const boots = (s: Sprite) =>
    s.rows[s.ay]!.replace(/[^Aa$]+/g, " ")
      .trim()
      .split(" ").length;
  assert.deepEqual([boots(ride), boots(idle)], [1, 2]);
});

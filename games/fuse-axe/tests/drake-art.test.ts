import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorld,
  spawnEnemy,
  spawnMount,
  step,
  toView,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import type { MountAnim, MountView } from "../src/engine/view.js";
import {
  CLAWBEAK,
  DRAKE_STEPS,
  FLAME,
  MOUNT_STATES,
  flamePx,
} from "../src/engine/view-kit.js";
import {
  enemyFrame,
  mountFrame,
  stripFrame,
} from "../src/render/art/animate.js";
import {
  CAPTAIN,
  CAPTAIN_ANIMS,
  CAPTAIN_POSES,
} from "../src/render/art/captain.js";
import {
  DRAKE_ANIMS,
  DRAKE_DIPS,
  DRAKE_FIGURE,
  DRAKE_MOUTHS,
  DRAKE_POSES,
  DRAKE_WALK_STEPS,
  paintDrake,
  type DrakeAnim,
  type DrakeFrame,
} from "../src/render/art/drake.js";
import { FIGURES } from "../src/render/art/index.js";
import { LANCER_ANIMS } from "../src/render/art/lancer.js";
import { RAVAGER, RAVAGER_POSES } from "../src/render/art/ravager.js";
import {
  drawFlame,
  FLAME_PHASES,
  flameSprite,
} from "../src/render/drake-fx.js";
import {
  CLEAR,
  validateSprite,
  type Sprite,
} from "../src/render/pixel/sprite.js";
import { createSpriteBaker } from "../src/render/pixel/surface.js";

const { px } = T;
const FRAMES = DRAKE_FIGURE.frames;
const sprite = (frame: DrakeFrame) => DRAKE_FIGURE.sprite(frame);
const length = (anim: DrakeAnim) =>
  DRAKE_ANIMS[anim].frames.reduce((sum, [, steps]) => sum + steps, 0);
/** A rider of `kind` on a drake `dx` px in front of the one hero (Brakka), facing him, the view's frames from then on. */
function riding(kind: "ravager" | "captain", dx: number, seed = 5): World {
  const world = createWorld({ seed, heroes: [{ seat: 0, kind: "brakka" }] });
  const { x, y } = world.heroes[0]!;
  const next = spawnEnemy(world, kind, x + px(dx), y, 2);
  const rider = next.enemies.at(-1)!;
  return spawnMount(next, rider.x, rider.y, rider.id, "drake");
}
/** The drake's frame for the first beast in the view. */
const shown = (world: World) => {
  const { anim, animStep } = toView(world).mounts[0]!;
  return [mountFrame("drake", anim, animStep) as DrakeFrame, anim, animStep] as const; // prettier-ignore
};

test("every drake frame is a valid sprite, painted inside one canvas and standing on one anchor", () => {
  assert.deepEqual(FRAMES, Object.keys(DRAKE_POSES));
  assert.equal(FIGURES.drake, DRAKE_FIGURE);
  for (const frame of FRAMES) {
    const pose = DRAKE_POSES[frame];
    // Painting throws if anything reaches the canvas's outermost pixels, so a frame that paints fits its canvas.
    const painted = paintDrake(pose);
    validateSprite(painted);
    assert.deepEqual([pose.size, pose.anchor], [DRAKE_POSES.idle.size, DRAKE_POSES.idle.anchor], frame); // prettier-ignore
    assert.deepEqual(painted, sprite(frame), "painted once, the same");
    // A foot is down in every frame: the anchor is on the lowest painted row, only the outline under it.
    assert.equal(painted.ay, painted.h - 2, `${frame} floats or sinks`);
    assert.equal(painted.rows[painted.ay + 1]!.replaceAll("k", CLEAR), CLEAR.repeat(painted.w)); // prettier-ignore
    // Ember hide, gold belly, red wings and spines, bone horns and claws, the black blanket, leather and brass.
    const keys = new Set(painted.rows.join(""));
    for (const key of ["x", "h", "c", "b", "i", "l", "n"])
      assert.ok(keys.has(key), `${frame} lacks ${key}`);
  }
  // About the clawbeak's height to its horns, and a good deal longer, snout to tail, than it is tall.
  const idle = sprite("idle");
  assert.ok(idle.h - 2 >= 40 && idle.h - 2 <= 50, `idle is ${idle.h} tall`);
  assert.ok(idle.w >= idle.h * 1.3, `idle is ${idle.w}×${idle.h}`);
  // Its throat kindles as it inhales and blazes as the flame pours out; at rest it does not glow.
  const glows = (frame: DrakeFrame) => /[F~]/.test(sprite(frame).rows.join(""));
  assert.deepEqual(FRAMES.filter(glows), ["inhale1", "inhale2", "blast0", "blast1"]); // prettier-ignore
});

test("a planted foot keeps pace with the drake's walk, and nearly so walking in and wandering", () => {
  const pace = (T.BEAST_WALK.x / T.SUB) * DRAKE_WALK_STEPS;
  const cycle = (["walk0", "walk1", "walk2", "walk3", "walk0"] as const).map(
    (frame) => DRAKE_POSES[frame].legs,
  );
  const ground = (i: number, leg: "nearFore" | "farFore") =>
    cycle[i]![leg].foot[0] + i * pace;
  // The near forefoot (and the far hind one with it) is down from the first frame to the third, the far forefoot from
  // the third to the next cycle's first.
  for (const i of [1, 2]) assert.ok(Math.abs(ground(i, "nearFore") - ground(0, "nearFore")) < 0.05); // prettier-ignore
  for (const i of [3, 4]) assert.ok(Math.abs(ground(i, "farFore") - ground(2, "farFore")) < 0.05); // prettier-ignore
  const held = (anim: DrakeAnim) => DRAKE_ANIMS[anim].frames[0]![1];
  for (const [anim, speed] of [["walk", T.BEAST_WALK.x], ["leave", T.BEAST_WALK.x], ["enter", T.ENTER_WALK], ["wander", T.WANDER]] as const) // prettier-ignore
    assert.ok(Math.abs((speed / T.SUB) * held(anim) - pace) <= 0.5, `${anim} slips`); // prettier-ignore
});

test("every drake anim plays frames the figure has, every frame is played, and the strips are the engine's steps", () => {
  assert.deepEqual(Object.keys(DRAKE_ANIMS).sort(), MOUNT_STATES.filter((anim) => anim !== "sweep").sort()); // prettier-ignore
  const played = new Set<string>();
  for (const [anim, { frames, loop }] of Object.entries(DRAKE_ANIMS)) {
    for (const [frame, steps] of frames) {
      assert.ok(FRAMES.includes(frame), `${anim} plays ${frame}`);
      assert.ok(Number.isInteger(steps) && steps > 0, `${anim} ${frame}`);
      played.add(frame);
    }
    assert.equal(loop, !["breathe", "lance", "hop"].includes(anim), anim);
  }
  assert.deepEqual([...played].sort(), [...FRAMES].sort());
  // The breath rears and kindles exactly while it inhales, and pours out its flame from the step the flame is out (the
  // flame's frames sharing one pair of jaws); the saddle thrust crouches through its wind-up and braces from the step
  // it lands; the hop leaps for the steps a jump rises.
  assert.deepEqual([length("breathe"), length("lance")], [DRAKE_STEPS.breathe, DRAKE_STEPS.lance]); // prettier-ignore
  for (let animStep = 0; animStep < DRAKE_STEPS.breathe + 9; animStep++) {
    const breath = mountFrame("drake", "breathe", animStep);
    assert.match(breath, animStep < DRAKE_STEPS.inhale ? /^inhale/ : /^blast/, `${animStep}`); // prettier-ignore
    const lance = mountFrame("drake", "lance", animStep);
    assert.equal(
      lance,
      animStep < DRAKE_STEPS.lanceWindup ? "crouch" : "brace",
    );
    const hop = mountFrame("drake", "hop", animStep);
    assert.equal(hop, animStep < DRAKE_STEPS.hopRise ? "leap" : "drop");
  }
  assert.deepEqual(DRAKE_MOUTHS.blast0, DRAKE_MOUTHS.blast1);
  // `mountFrame` never throws: any anim at any step is one of the figure's frames, and a clawbeak's sweep (or an anim
  // from a build with more of them) stands as a drake idles.
  const dance = JSON.parse('"dance"') as MountAnim;
  for (const anim of [...MOUNT_STATES, dance])
    for (const animStep of [0, 12, 33, 64, 2.5, -4, Number.NaN, Infinity]) {
      const frame = mountFrame("drake", anim, animStep) as DrakeFrame;
      sprite(frame);
      const own = anim !== dance && anim !== "sweep";
      assert.equal(frame, stripFrame(own ? DRAKE_ANIMS[anim as DrakeAnim] : DRAKE_ANIMS.idle, animStep)); // prettier-ignore
    }
});

test("in the engine the drake rears and kindles on every step of the inhale and pours flame from the very step it burns", () => {
  let world = riding("ravager", 40);
  const full = world.heroes[0]!.hp;
  const frames: string[] = [];
  let burned = -1;
  for (let i = 0; i < 200 && burned < 0; i++) {
    world = step(world, []);
    const [frame, anim, animStep] = shown(world);
    if (anim !== "breathe") continue;
    frames.push(frame);
    assert.equal(
      frame.startsWith("blast"),
      flamePx(animStep) > 0,
      `${animStep}`,
    );
    if (world.heroes[0]!.hp < full) burned = animStep;
  }
  assert.ok(burned >= DRAKE_STEPS.inhale, "the flame burned the hero");
  assert.deepEqual(frames.slice(0, DRAKE_STEPS.inhale + 1), [
    ...Array<string>(DRAKE_STEPS.inhale / 2).fill("inhale1"),
    ...Array<string>(DRAKE_STEPS.inhale / 2).fill("inhale2"),
    "blast0",
  ]);
});

test("in the engine the drake crouches through the captain's saddle thrust's wind-up and braces from the very step it lands", () => {
  // He thrusts now and then where the drake would breathe: play seeds until one of his first blows is a thrust.
  for (let seed = 1; seed < 40; seed++) {
    let world = riding("captain", 30, seed);
    const full = world.heroes[0]!.hp;
    const frames: string[] = [];
    for (let i = 0; i < 120 && world.heroes[0]!.hp === full; i++) {
      world = step(world, []);
      const [frame, anim] = shown(world);
      if (anim === "lance") frames.push(frame);
    }
    if (!frames.length) continue;
    assert.deepEqual(frames, [...Array<string>(DRAKE_STEPS.lanceWindup).fill("crouch"), "brace"]); // prettier-ignore
    assert.equal(world.heroes[0]!.hp < full, true);
    return;
  }
  assert.fail("the captain never thrust");
});

test("every rider sits astride the drake's saddle on every frame a ridden drake shows: hips on the seat, the boot in the stirrup", () => {
  const ridden = new Set(
    (["idle", "walk", "enter", "breathe", "lance", "hop"] as const).flatMap(
      (anim) => DRAKE_ANIMS[anim].frames.map(([frame]) => frame),
    ),
  );
  const riders = [
    ["ravager", RAVAGER.sprite("ride"), RAVAGER_POSES.ride, /[Aa$k]/],
    ["captain", CAPTAIN.sprite("ride"), CAPTAIN_POSES.ride, /[Ll9k]/],
  ] as const; // prettier-ignore
  for (const frame of FRAMES) {
    const dip = DRAKE_DIPS[frame];
    const { saddle, anchor } = DRAKE_POSES[frame];
    assert.deepEqual(saddle, [anchor[0], anchor[1] - CLAWBEAK.saddle + dip], frame); // prettier-ignore
    if (!ridden.has(frame)) continue;
    assert.ok([-1, 0, 1, 2].includes(dip), `${frame} dips ${dip}`);
    const s = sprite(frame);
    const at = (dx: number, dy: number) =>
      s.rows[s.ay - CLAWBEAK.saddle + dip + dy]?.[s.ax + dx] ?? CLEAR;
    // The seat's top: the highest leather over the saddle point, and the stirrup's brass where the boot goes.
    const top = Math.min(...Array.from({ length: 30 }, (_, i) => -i - 1).filter((dy) => /[Ll9]/.test(at(0, dy)))); // prettier-ignore
    const brass = [-1, 0].flatMap((dy) => [3, 4, 5].filter((dx) => /[Nn8]/.test(at(dx, dy)))); // prettier-ignore
    assert.ok(brass.length > 0, `${frame} has no stirrup`);
    for (const [name, ride, pose, boot] of riders) {
      const hips = (pose.far.hip[1] + pose.near.hip[1]) / 2 - pose.anchor[1];
      assert.ok(hips >= top - 2 && hips <= top + 1, `${name} on ${frame}: hips ${hips}, seat ${top}`); // prettier-ignore
      assert.match(
        ride.rows[ride.ay - 1]![ride.ax + 4]!,
        boot,
        `${name}'s boot`,
      );
    }
  }
});

/** A surface that records its fills, and a pen that records its blits. */
interface Shot {
  readonly w: number;
  readonly h: number;
  readonly cols: number[];
}
class Paint {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  constructor(readonly cols: number[] = []) {}
  fillRect(x: number, _y: number, w: number) {
    this.cols.push(x, x + w - 1);
  }
}
class Pen extends Paint {
  readonly blits: { image: Shot; sx: number; dx: number }[] = [];
  drawImage(image: Shot, sx: number, _sy: number, _sw: number, _sh: number, dx: number) {
    this.blits.push({ image, sx, dx });
  } // prettier-ignore
}
const baker = createSpriteBaker<Shot>((w, h) => {
  const paint = new Paint();
  return { image: { w, h, cols: paint.cols }, paint };
});

test("the flame's jets are valid sprites, white-hot at the jaws, as long as asked and painted to their last column", () => {
  const longest = Math.ceil(FLAME.mouth + FLAME.length);
  for (let n = 1; n <= longest; n++)
    for (const phase of [0, 1, 2, 3, -1, 6.5]) {
      const jet = flameSprite(n, phase);
      validateSprite(jet);
      const painted = (x: number) => jet.rows.some((row) => row[x] !== CLEAR);
      assert.ok(jet.w === n && painted(0) && painted(n - 1), `${n} ${phase}`);
    }
  assert.equal(flameSprite(1e9, 0).w, longest);
  assert.ok(
    flameSprite(40, 0).rows.some((row) => row.slice(0, 8).includes("Z")),
  );
  // The phases differ, and loop: a phase is its own a cycle on.
  assert.notDeepEqual(flameSprite(40, 0).rows, flameSprite(40, 1).rows);
  assert.deepEqual(flameSprite(40, FLAME_PHASES + 1), flameSprite(40, 1));
});

test("a drake's flame runs from its jaws to the flame's front either way, and only a breathing drake's, at any step", () => {
  const drake = (more: Partial<MountView>): MountView => ({
    ...{ id: 4, kind: "drake", x: 160, y: 120, z: 6, facing: 1 },
    ...{ anim: "breathe", animStep: 0, rider: null, ...more },
  });
  for (const facing of [1, -1] as const)
    for (let animStep = 0; animStep <= DRAKE_STEPS.breathe; animStep++) {
      const pen = new Pen();
      const mount = drake({ animStep, facing });
      const frame = mountFrame("drake", "breathe", animStep);
      drawFlame(pen, baker, mount, frame, 30);
      const [jaws, up] = DRAKE_MOUTHS[frame as DrakeFrame];
      const front = flamePx(animStep);
      assert.equal(pen.blits.length, front > jaws ? 1 : 0, `${animStep}`);
      if (!pen.blits.length) continue;
      const { image, sx, dx } = pen.blits[0]!;
      const columns = image.cols.map((x) => dx - sx + x - 130);
      const [from, to] = facing > 0 ? [Math.min(...columns), Math.max(...columns)] : [-Math.max(...columns), -Math.min(...columns)]; // prettier-ignore
      assert.deepEqual([from, to], [jaws, front - 1], `${facing} ${animStep}`);
      assert.ok(up > 10 && up < T.FLAME_HEIGHT / T.SUB, `${frame}'s jaws are ${up} up`); // prettier-ignore
    }
  // Nothing for a clawbeak, a drake doing anything else, a frame with no jaws; odd steps never throw.
  const none = (mount: MountView, frame = "blast0") => {
    const pen = new Pen();
    drawFlame(pen, baker, mount, frame, 0);
    return pen.blits.length;
  };
  const flaming = DRAKE_STEPS.inhale + 20;
  assert.equal(none(drake({ animStep: flaming })), 1);
  assert.equal(none(drake({ animStep: flaming, kind: "clawbeak" })), 0);
  assert.equal(none(drake({ animStep: flaming, anim: "lance" })), 0);
  assert.equal(none(drake({ animStep: flaming }), "coil1"), 0);
  for (const animStep of [-3, 2.5, 40.7, 1e9, Number.NaN, Infinity])
    assert.doesNotThrow(() => none(drake({ animStep })), `${animStep}`);
});

test("the captain sits his drake astride in his own seated frame, and otherwise fights as a lancer, staggering as one reels", () => {
  assert.equal(FIGURES.captain, CAPTAIN);
  for (const frame of CAPTAIN.frames) validateSprite(CAPTAIN.sprite(frame));
  for (const animStep of [0, 31, 32, 1e6, -2, Number.NaN])
    assert.equal(enemyFrame("captain", "ride", animStep), "ride");
  assert.equal(CAPTAIN_ANIMS.stagger, LANCER_ANIMS.hurt);
  // Astride, one boot shows on the anchor's row, not two.
  const boots = (s: Sprite) =>
    s.rows[s.ay]!.replace(/[^Ll9]+/g, " ")
      .trim()
      .split(" ").length;
  assert.deepEqual([boots(CAPTAIN.sprite("ride")), boots(CAPTAIN.sprite("idle"))], [1, 2]); // prettier-ignore
});

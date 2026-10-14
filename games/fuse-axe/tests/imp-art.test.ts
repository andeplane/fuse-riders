import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  JUMP,
  createWorld,
  spawnEnemy,
  step,
  toView,
  type EnemyAnim,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import { ENEMY_KINDS, ENEMY_STATES } from "../src/engine/view-kit.js";
import { IMP_STATES } from "../src/engine/world.js";
import {
  ENEMY_ANIMS,
  enemyFrame,
  stripFrame,
} from "../src/render/art/animate.js";
import {
  IMP,
  IMP_ANIMS,
  IMP_FLEE_STEPS,
  IMP_POSES,
  IMP_WALK_STEPS,
  paintImp,
  type ImpAnim,
} from "../src/render/art/imp.js";
import { FIGURES } from "../src/render/art/index.js";
import { paintPot, POT } from "../src/render/art/pot.js";
import {
  RAVAGER,
  RAVAGER_ANIMS,
  type RavagerAnim,
} from "../src/render/art/ravager.js";
import { CLEAR, validateSprite } from "../src/render/pixel/sprite.js";
import { ENEMY_ART } from "../src/render/scene.js";

const FRAMES = IMP.frames;
const { px } = T;

test("every imp frame is a valid sprite painted inside its canvas, standing on its anchor", () => {
  assert.deepEqual(FRAMES, Object.keys(IMP_POSES));
  assert.equal(FIGURES.imp, IMP);
  for (const frame of FRAMES) {
    const pose = IMP_POSES[frame];
    // Painting throws if anything reaches the canvas's outermost pixels, so a frame that paints fits its canvas.
    const painted = paintImp(pose);
    validateSprite(painted);
    assert.ok(painted.w <= pose.size[0] - 2 && painted.h <= pose.size[1] - 2);
    assert.deepEqual(pose.size, IMP_POSES.idle.size, frame);
    assert.deepEqual(pose.anchor, IMP_POSES.idle.anchor, frame);
    assert.deepEqual(painted, IMP.sprite(frame), "painted once, the same");
    // Every frame but the one flung through the air stands on the floor: the anchor is on its lowest painted row,
    // with only the outline under it.
    if (frame !== "knockdown")
      assert.equal(painted.ay, painted.h - 2, `${frame} floats or sinks`);
  }
  // Small and hunched: about 22 px from the boots to the hood's tip, under 60% of a ravager.
  const [imp, ravager] = [IMP.sprite("idle").h, RAVAGER.sprite("idle").h];
  assert.ok(imp - 2 >= 20 && imp - 2 <= 26, `the imp is ${imp - 2} tall`);
  assert.ok(imp < ravager * 0.6);
  // Lying, it is wider than tall.
  const down = IMP.sprite("down");
  assert.ok(down.w > down.h * 1.5, `down is ${down.w}×${down.h}`);
});

test("the imp wears its colours: a blue hood, a pale sack, yellow eyes in the hood's dark, wide white ones when hurt", () => {
  const HURT = ["stumble1", "stumble2", "knockdown", "down"];
  for (const frame of FRAMES) {
    const keys = new Set(IMP.sprite(frame).rows.join(""));
    for (const key of ["U", "u", "@", "B", "b", "6", "#"])
      assert.ok(keys.has(key), `${frame} lacks ${key}`);
    assert.equal(keys.has("D"), !HURT.includes(frame), frame);
  }
  // Kicked, magic glints out of the torn-open sack.
  const glints = (frame: (typeof FRAMES)[number]) =>
    IMP.sprite(frame).rows.join("").includes("G");
  assert.deepEqual(FRAMES.filter(glints), ["stumble1"], "only the kick glints");
});

test("a planted foot keeps pace with the road through the scurry and the flight, at the engine's speeds", () => {
  for (const [name, speed, steps] of [
    ["walk", T.IMP_WALK, IMP_WALK_STEPS],
    ["flee", T.IMP_FLEE, IMP_FLEE_STEPS],
  ] as const) {
    const pace = (speed / T.SUB) * steps;
    const cycle = [1, 2, 3, 4, 1].map(
      (i) => IMP_POSES[`${name}${i}` as keyof typeof IMP_POSES],
    );
    const ground = (i: number, side: "near" | "far") =>
      cycle[i]![side].ankle[0] + i * pace;
    // The near foot is down from frame 1 to 3 and the far foot from 3 to the next cycle's 1.
    for (const i of [1, 2])
      assert.ok(Math.abs(ground(i, "near") - ground(0, "near")) < 1e-9, name);
    for (const i of [3, 4])
      assert.ok(Math.abs(ground(i, "far") - ground(2, "far")) < 1e-9, name);
    // Each frame's sprite has a boot on the floor row.
    for (const pose of cycle.slice(0, 4)) {
      const s = paintImp(pose);
      assert.match(s.rows[s.ay]!, /[lL9]/, name);
      assert.equal(s.rows[s.ay + 1]!.replaceAll("k", CLEAR), CLEAR.repeat(s.w));
    }
  }
});

test("every imp anim plays frames the figure has, and every frame is played", () => {
  // The imp's states and `idle`, which stands in for an anim it has no frames for.
  assert.deepEqual(
    Object.keys(IMP_ANIMS).sort(),
    ["idle", ...IMP_STATES].sort(),
  );
  const played = new Set<string>();
  for (const [anim, { frames, loop }] of Object.entries(IMP_ANIMS)) {
    for (const [frame, steps] of frames) {
      assert.ok(FRAMES.includes(frame), `${anim} plays ${frame}`);
      assert.ok(Number.isInteger(steps) && steps > 0, `${anim} ${frame}`);
      played.add(frame);
    }
    assert.equal(loop, ["idle", "walk", "flee"].includes(anim), anim);
  }
  assert.deepEqual([...played].sort(), [...FRAMES].sort());
  // Every kind's anims play only frames its art has: the scene draws `enemyFrame` from `ENEMY_ART`.
  assert.deepEqual(Object.keys(ENEMY_ANIMS).sort(), [...ENEMY_KINDS].sort());
  for (const kind of ENEMY_KINDS)
    for (const { frames } of Object.values(ENEMY_ANIMS[kind]))
      for (const [frame] of frames)
        assert.ok(ENEMY_ART[kind].figure.frames.includes(frame), frame);
});

/** The most `animStep` the view shows the imp in each anim over `steps` steps of `held` input. */
function reached(
  start: World,
  held: (index: number) => number,
  steps: number,
): Map<EnemyAnim, number> {
  const peaks = new Map<EnemyAnim, number>();
  let world = start;
  for (let index = 0; index < steps; index++) {
    world = step(world, [held(index)]);
    for (const { kind, anim, animStep } of toView(world).enemies)
      if (kind === "imp")
        peaks.set(anim, Math.max(peaks.get(anim) ?? 0, animStep));
  }
  return peaks;
}

test("a kicked imp's anims last exactly as many steps as the engine keeps it in each state", () => {
  const length = (anim: ImpAnim) =>
    IMP_ANIMS[anim].frames.reduce((sum, [, steps]) => sum + steps, 0);
  const brakka = createWorld({
    seed: 3,
    heroes: [{ seat: 0, kind: "brakka" }],
  });
  const { x, y } = brakka.heroes[0]!;
  // A slash makes it stumble; a back attack (Attack and Jump, the imp behind) knocks it flying, down and up.
  const slashed = reached(
    spawnEnemy(brakka, "imp", x + px(20), y),
    (index) => (index === 0 ? ATTACK : 0),
    200,
  );
  const flung = reached(
    spawnEnemy(brakka, "imp", x - px(20), y),
    (index) => (index === 0 ? ATTACK | JUMP : 0),
    300,
  );
  const lasts = [
    ["stumble", slashed],
    ["knockdown", flung],
    ["down", flung],
    ["getup", flung],
  ] as const;
  // The last step an anim shows is the one before its state ends, so it lasts one more than that.
  for (const [anim, peaks] of lasts) {
    assert.ok(peaks.has(anim), `the imp never reached ${anim}`);
    assert.equal(peaks.get(anim)! + 1, length(anim), anim);
  }
  assert.ok(slashed.has("flee") && flung.has("flee"));
});

test("enemyFrame plays a ravager exactly as its strips do, and never throws on odd input", () => {
  const steps = [0, 1, 7, 8, 23, 31, 32, 59, 64, 100_000];
  for (const anim of Object.keys(RAVAGER_ANIMS) as RavagerAnim[])
    for (const animStep of steps)
      assert.equal(
        enemyFrame("ravager", anim, animStep),
        stripFrame(RAVAGER_ANIMS[anim], animStep),
        `${anim} ${animStep}`,
      );
  for (const anim of Object.keys(IMP_ANIMS) as ImpAnim[])
    for (const animStep of steps)
      assert.equal(
        enemyFrame("imp", anim, animStep),
        stripFrame(IMP_ANIMS[anim], animStep),
      );
  const odd = <V>(json: string) => JSON.parse(json) as V;
  const kinds = [...ENEMY_KINDS, ...["wizard", "constructor", "__proto__"]];
  const anims = [...ENEMY_STATES, "ride", "toString", "__proto__", ""];
  for (const kind of kinds)
    for (const anim of anims)
      for (const animStep of [-3, 2.5, Number.NaN, Infinity, -Infinity, 1e12]) {
        const k = odd<(typeof ENEMY_KINDS)[number]>(JSON.stringify(kind));
        const frame = enemyFrame(
          k,
          odd<EnemyAnim>(JSON.stringify(anim)),
          animStep,
        );
        // A known kind plays its own figure's frames; any other plays the ravager's, the scene's fallback.
        const figure = Object.hasOwn(ENEMY_ART, kind)
          ? ENEMY_ART[k].figure
          : RAVAGER;
        assert.ok(figure.frames.includes(frame), `${kind} ${anim} → ${frame}`);
      }
  // An anim a kind has no strip for stands idle, at its first frame on step 0.
  assert.equal(enemyFrame("ravager", "flee", 0), "idle");
  assert.equal(enemyFrame("imp", "windup", 99), "idle");
  assert.equal(enemyFrame("imp", "walk", Number.NaN), "walk1");
});

test("the magic pot is a small blue pot with a stopper and a glint, standing on its anchor", () => {
  validateSprite(POT);
  assert.deepEqual(paintPot(), POT);
  assert.ok(POT.w <= 9 && POT.h <= 11, `the pot is ${POT.w}×${POT.h}`);
  assert.equal(POT.ay, POT.h - 2);
  assert.ok(Math.abs(POT.ax - (POT.w - 1) / 2) <= 0.5, "on its middle");
  const keys = POT.rows.join("");
  for (const key of ["u", "@", "l", "Z"]) assert.ok(keys.includes(key), key);
  // The stopper sits on top, the glaze below it.
  const top = POT.rows.findIndex((row) => /[^.k]/.test(row));
  assert.match(POT.rows[top]!, /^[.k]*[Ll9]+[.k]*$/);
});

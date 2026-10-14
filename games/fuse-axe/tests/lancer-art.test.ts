import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  createWorld,
  spawnEnemy,
  step,
  toView,
  type Enemy,
  type EnemyAnim,
  type Hero,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import { ENEMY_STATES, LANCER_STEPS, SPEAR } from "../src/engine/view-kit.js";
import { LANCER_STATES } from "../src/engine/world.js";
import { enemyFrame, stripFrame } from "../src/render/art/animate.js";
import { FIGURES } from "../src/render/art/index.js";
import {
  LANCER,
  LANCER_ANIMS,
  LANCER_POSES,
  LANCER_TIERS,
  LANCER_WALK_STEPS,
  paintLancer,
  spearEnds,
  type LancerAnim,
  type LancerFrame,
} from "../src/render/art/lancer.js";
import { RAVAGER, RAVAGER_TIERS } from "../src/render/art/ravager.js";
import { MASTER } from "../src/render/pixel/palette.js";
import {
  CLEAR,
  flipSprite,
  swapPalette,
  validateSprite,
  type Sprite,
} from "../src/render/pixel/sprite.js";

const { px } = T;
const FRAMES = LANCER.frames;
const STEEL = /[Mm7]/;
const party = () =>
  createWorld({ seed: 9, heroes: [{ seat: 0, kind: "brakka" }] });
/** A lancer of `tier` `dx` px along the road from the hero (level with it), facing it, with `change` made to it. */
function lancer(
  dx: number,
  change: Partial<Enemy> = {},
  tier: T.Tier = 0,
): World {
  const world = party();
  const { x, y } = world.heroes[0]!;
  const next = spawnEnemy(world, "lancer", x + px(dx), y, tier);
  const facing: 1 | -1 = dx > 0 ? -1 : 1;
  return {
    ...next,
    enemies: next.enemies.map((e) => ({ ...e, facing, ...change })),
  };
}
const patchHero = (world: World, change: Partial<Hero>): World => ({
  ...world,
  heroes: world.heroes.map((h) => ({ ...h, ...change })),
});
const frameOf = (world: World) => {
  const { kind, anim, animStep } = toView(world).enemies[0]!;
  return enemyFrame(kind, anim, animStep) as LancerFrame;
};
const length = (anim: LancerAnim) =>
  LANCER_ANIMS[anim].frames.reduce((sum, [, steps]) => sum + steps, 0);
/** The columns from the feet anchor of a sprite's pixels on row `y` that `match`. */
const columns = (s: Sprite, y: number, match: RegExp) =>
  [...s.rows[y]!].flatMap((key, x) => (match.test(key) ? [x - s.ax] : []));
/** The furthest column ahead of the anchor that anything but the outline is painted in. */
const front = (s: Sprite) =>
  Math.max(...s.rows.map((_, y) => Math.max(...columns(s, y, /[^.k]/))));

test("every lancer frame is a valid sprite in every tier, painted inside one canvas and standing on one anchor", () => {
  assert.deepEqual(FRAMES, Object.keys(LANCER_POSES));
  assert.equal(FIGURES.lancer, LANCER);
  for (const frame of FRAMES) {
    const pose = LANCER_POSES[frame];
    // Painting throws if anything reaches the canvas's outermost pixels, so a frame that paints fits its canvas.
    const painted = paintLancer(pose);
    validateSprite(painted);
    for (const swap of Object.values(LANCER_TIERS))
      validateSprite(swapPalette(painted, swap));
    assert.deepEqual(pose.size, LANCER_POSES.idle.size, frame);
    assert.deepEqual(pose.anchor, LANCER_POSES.idle.anchor, frame);
    assert.deepEqual(painted, LANCER.sprite(frame), "painted once, the same");
    // The anchor is on every frame's lowest painted row, the leap's and the fallen ones' too, only the outline under
    // it, so no frame sinks into the floor or hovers over it, and the plunged spear is cut off at the floor.
    assert.equal(painted.ay, painted.h - 2, `${frame} floats or sinks`);
    assert.equal(
      painted.rows[painted.ay + 1]!.replaceAll("k", CLEAR),
      CLEAR.repeat(painted.w),
    );
  }
  // A ravager's height, boots to plume; lying, wider than tall.
  const [idle, ravager] = [LANCER.sprite("idle"), RAVAGER.sprite("idle")];
  const ratio = (idle.h - 2) / (ravager.h - 2);
  assert.ok(
    ratio >= 0.95 && ratio <= 1.15,
    `the lancer is ${ratio}× a ravager`,
  );
  const down = LANCER.sprite("down");
  assert.ok(down.w > down.h * 2, `down is ${down.w}×${down.h}`);
});

test("a tier recolours only the plume, skirt and knee bands: the lancer's own red, then the ravagers' rust and violet", () => {
  assert.deepEqual(LANCER_TIERS[0], {});
  const ramp = (palette: Record<string, string>, keys: string) =>
    [...keys].map((key) => palette[key]);
  assert.deepEqual(
    ramp(LANCER_TIERS[1], "Cc0"),
    ramp(RAVAGER_TIERS.rust, "Aa$"),
  );
  assert.deepEqual(
    ramp(LANCER_TIERS[2], "Cc0"),
    ramp(RAVAGER_TIERS.violet, "Aa$"),
  );
  for (const tier of [1, 2] as const)
    assert.deepEqual(Object.keys(LANCER_TIERS[tier]).sort(), ["0", "C", "c"]);
  // Three distinct reds, rusts and violets, every frame showing the tier, the steel cuirass and spear, the bronze helm
  // and the leather boots.
  const bases = Object.values(LANCER_TIERS).map((swap) => swap.c ?? MASTER.c);
  assert.equal(new Set(bases).size, 3);
  for (const frame of FRAMES) {
    const keys = new Set(LANCER.sprite(frame).rows.join(""));
    for (const key of ["c", "m", "n", "l"])
      assert.ok(keys.has(key), `${frame} lacks ${key}`);
  }
});

test("the thrust's point lands at the spear's reach, the wind-up draws it back and glints, the plunge drives it into the floor", () => {
  const thrust = LANCER.sprite("thrust");
  // The steel point is drawn on the very column the engine's spear reaches, facing either way.
  assert.equal(front(thrust), Math.round(SPEAR.reach));
  const tipRow = thrust.rows.findIndex((row, y) =>
    columns(thrust, y, STEEL).includes(front(thrust)),
  );
  assert.ok(tipRow >= 0, "the point is steel");
  const left = flipSprite(thrust);
  assert.ok(columns(left, tipRow, STEEL).includes(-Math.round(SPEAR.reach)));
  // Drawn back for the wind-up: its point well short of the thrust's, its butt further back than in any frame on its
  // feet.
  const windup = LANCER.sprite("windup");
  assert.ok(front(windup) <= front(thrust) - 12, `${front(windup)}`);
  const back = (frame: LancerFrame) => spearEnds(LANCER_POSES[frame]).butt[0];
  for (const frame of FRAMES)
    if (!["windup", "knockdown", "down"].includes(frame))
      assert.ok(back("windup") < back(frame), frame);
  // Only the wind-up's glint and the thrust's speed lines glow.
  const glows = (frame: LancerFrame) =>
    /[ZF]/.test(LANCER.sprite(frame).rows.join(""));
  assert.deepEqual(FRAMES.filter(glows), ["windup", "thrust"]);
  // The plunge's spear enters the floor's row at `SPEAR.plunge`, only clods of earth beside it.
  const plunge = LANCER.sprite("plunge");
  const steel = columns(plunge, plunge.ay, STEEL);
  assert.ok(steel.includes(SPEAR.plunge), `${steel}`);
  assert.ok(
    steel.every((x) => Math.abs(x - SPEAR.plunge) <= 2),
    `${steel}`,
  );
  // The leap raises the spear overhead, then points it down ahead.
  const [rise, fall] = [LANCER_POSES.rise, LANCER_POSES.fall];
  assert.ok(spearEnds(rise).tip[1] < rise.head[1] - 8);
  assert.ok(spearEnds(fall).tip[1] > fall.waist[1] + 10);
  assert.ok(spearEnds(fall).tip[0] > fall.anchor[0] + 10);
});

test("a planted foot keeps pace with an ash lancer's walk", () => {
  const pace = (T.LANCER[0].walk.x / T.SUB) * LANCER_WALK_STEPS;
  const cycle = (["walk0", "walk1", "walk2", "walk3", "walk0"] as const).map(
    (frame) => LANCER_POSES[frame],
  );
  const ground = (i: number, side: "near" | "far") =>
    cycle[i]![side].ankle[0] + i * pace;
  // The near foot is down from the first frame to the third, the far foot from the third to the next cycle's first.
  for (const i of [1, 2])
    assert.ok(Math.abs(ground(i, "near") - ground(0, "near")) < 0.05);
  for (const i of [3, 4])
    assert.ok(Math.abs(ground(i, "far") - ground(2, "far")) < 0.05);
});

test("every lancer anim plays frames the figure has, every frame is played, and the strips are the engine's steps", () => {
  assert.deepEqual(Object.keys(LANCER_ANIMS).sort(), [...LANCER_STATES].sort());
  const played = new Set<string>();
  for (const [anim, { frames, loop }] of Object.entries(LANCER_ANIMS)) {
    for (const [frame, steps] of frames) {
      assert.ok(FRAMES.includes(frame), `${anim} plays ${frame}`);
      assert.ok(Number.isInteger(steps) && steps > 0, `${anim} ${frame}`);
      played.add(frame);
    }
    assert.equal(loop, ["idle", "walk", "enter"].includes(anim), anim);
  }
  assert.deepEqual([...played].sort(), [...FRAMES].sort());
  assert.equal(
    length("windup"),
    Math.max(...Object.values(LANCER_STEPS.windup)),
  );
  assert.equal(length("thrust"), LANCER_STEPS.thrust);
  assert.equal(length("recover"), LANCER_STEPS.recover);
  assert.equal(length("leap"), LANCER_STEPS.leap);
  assert.equal(length("plunge"), LANCER_STEPS.plunge);
  // The leap rises on every step up to its apex and falls after.
  for (let animStep = 0; animStep < LANCER_STEPS.leap; animStep++)
    assert.equal(
      enemyFrame("lancer", "leap", animStep),
      animStep <= LANCER_STEPS.leapApex ? "rise" : "fall",
    );
  // `enemyFrame` plays them as they are, and never throws: any anim the view has at any step is one of its frames.
  for (const anim of Object.keys(LANCER_ANIMS) as LancerAnim[])
    for (const animStep of [0, 7, 9, 10, 23, 24, 39, 40, 100])
      assert.equal(
        enemyFrame("lancer", anim, animStep),
        stripFrame(LANCER_ANIMS[anim], animStep),
      );
  for (const anim of ENEMY_STATES)
    for (const animStep of [0, 2.5, -4, Number.NaN, Infinity, 1e9])
      LANCER.sprite(enemyFrame("lancer", anim, animStep) as LancerFrame);
});

test("the thrust shows from the very step the spear lands for exactly the steps it is out, drawn back before it, at every tier", () => {
  for (const tier of T.TIERS) {
    let world = lancer(40, { state: "windup", target: 1 }, tier);
    const full = world.heroes[0]!.hp;
    const thrusting = new Set<number>();
    let landed = false;
    for (let i = 0; i < 80 && world.enemies[0]!.state !== "idle"; i++) {
      const was = world.heroes[0]!.hp;
      world = step(world, []);
      const { anim, animStep } = toView(world).enemies[0]!;
      // The spear is out exactly while the engine's lancer thrusts, through the hit's freeze too, and the wind-up's
      // drawn-back spear shows on every step before it.
      const frame = frameOf(world);
      assert.equal(frame === "thrust", anim === "thrust", `${anim} ${frame}`);
      assert.equal(frame === "windup", anim === "windup", `${anim} ${frame}`);
      if (anim === "thrust") thrusting.add(animStep);
      if (world.heroes[0]!.hp < was) {
        assert.ok(!landed && anim === "thrust" && animStep === 0);
        landed = true;
      }
    }
    assert.ok(landed && world.heroes[0]!.hp < full, "the spear landed");
    assert.equal(thrusting.size, LANCER_STEPS.thrust);
    assert.equal(Math.max(...thrusting), LANCER_STEPS.thrust - 1);
  }
});

/** The most `animStep` the first enemy shows in each anim over `steps` steps, `held` pressed on each. */
function peaks(
  start: World,
  steps: number,
  held: (index: number, world: World) => number = () => 0,
) {
  const most = new Map<EnemyAnim, number>();
  let world = start;
  for (let i = 0; i < steps; i++) {
    world = step(world, [held(i, world)]);
    const shown = toView(world).enemies[0];
    if (!shown) break;
    most.set(shown.anim, Math.max(most.get(shown.anim) ?? -1, shown.animStep));
  }
  return most;
}

test("each lancer anim lasts exactly as many steps as the engine keeps it in that state", () => {
  // The last step an anim shows is the one before its state ends, so it lasts one more than that.
  const lasts = (most: Map<EnemyAnim, number>, anims: LancerAnim[]) => {
    for (const anim of anims) {
      assert.ok(most.has(anim), `never reached ${anim}`);
      assert.equal(most.get(anim)! + 1, length(anim), anim);
    }
  };
  // An ash lancer's thrust, then the stand open after it.
  lasts(peaks(lancer(40, { state: "windup", target: 1 }), 100), [
    "windup",
    "thrust",
    "recover",
  ]);
  // A lancer far along the road leaps at the hero and plunges.
  lasts(peaks(lancer(100, { thinkAt: 0 }), 100), ["leap", "plunge"]);
  // A slash reels it; Brakka's finisher, its blade a step from out, knocks it down to get up; a slash at one hit
  // point kills it.
  const swing = T.COMBO.brakka[2];
  const once = (index: number) => (index === 0 ? ATTACK : 0);
  lasts(peaks(lancer(18, { state: "windup", target: 1 }), 40, once), ["hurt"]);
  const finisher = patchHero(lancer(18, { target: 1 }), {
    state: "attack3",
    timer: swing.startup - 1,
  });
  lasts(peaks(finisher, 120), ["knockdown", "down", "getup"]);
  lasts(peaks(lancer(18, { state: "windup", hp: 1 }), 120, once), ["dead"]);
});

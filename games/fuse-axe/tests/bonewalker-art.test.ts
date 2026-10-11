import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  STAGE_3,
  createWorld,
  spawnEnemy,
  step,
  toView,
  type Enemy,
  type EnemyAnim,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import {
  BONE_SWORD,
  BONEWALKER_STATES,
  BONEWALKER_STEPS,
  ENEMY_STATES,
} from "../src/engine/view-kit.js";
import { enemyFrame, stripFrame } from "../src/render/art/animate.js";
import {
  BONE_KNIGHT,
  BONEWALKER,
  BONEWALKER_ANIMS,
  BONEWALKER_POSES,
  BONEWALKER_TIERS,
  PILE_STILL,
  paintBonewalker,
  type BonewalkerAnim,
  type BonewalkerFrame,
} from "../src/render/art/bonewalker.js";
import { FIGURES } from "../src/render/art/index.js";
import { RAVAGER } from "../src/render/art/ravager.js";
import { MASTER } from "../src/render/pixel/palette.js";
import {
  CLEAR,
  flipSprite,
  swapPalette,
  validateSprite,
  type Sprite,
} from "../src/render/pixel/sprite.js";
import { ENEMY_ART } from "../src/render/scene.js";

const { px } = T;
const FRAMES = BONEWALKER.frames;
/** The figure each tier draws with: the violet tier is the knight. */
const FIGURE = { 0: BONEWALKER, 1: BONEWALKER, 2: BONE_KNIGHT } as const;
const RISE = ["rise0", "rise1", "rise2", "rise3", "rise4", "rise5"] as const;
const length = (anim: BonewalkerAnim) =>
  BONEWALKER_ANIMS[anim].frames.reduce((sum, [, steps]) => sum + steps, 0);
/** The columns from the feet anchor of a sprite's pixels on row `y` that `match`. */
const columns = (s: Sprite, y: number, match: RegExp) =>
  [...s.rows[y]!].flatMap((key, x) => (match.test(key) ? [x - s.ax] : []));
/** The furthest column ahead of the anchor that anything but the outline is painted in. */
const front = (s: Sprite) =>
  Math.max(...s.rows.map((_, y) => Math.max(...columns(s, y, /[^.k]/))));
const has = (s: Sprite, key: string) => s.rows.join("").includes(key);

const party = (stage = 1) =>
  createWorld({ seed: 9, stage, heroes: [{ seat: 0, kind: "brakka" }] });
/** A bonewalker of `tier` `dx` px along the road from the hero, level with it and facing it, with `change` made. */
function bonewalker(dx: number, change: Partial<Enemy> = {}, tier: T.Tier = 0) {
  const world = party();
  const { x, y } = world.heroes[0]!;
  const next = spawnEnemy(world, "bonewalker", x + px(dx), y, tier);
  const facing: 1 | -1 = dx > 0 ? -1 : 1;
  return {
    ...next,
    enemies: next.enemies.map((e) => ({ ...e, facing, ...change })),
  };
}
/** What the first enemy shows each step over `steps` steps, `held` pressed on each: its anim, step and frame. */
function play(start: World, steps: number, held = (_index: number) => 0) {
  const shown: { anim: EnemyAnim; animStep: number; frame: string }[] = [];
  let world = start;
  for (let i = 0; i < steps; i++) {
    world = step(world, [held(i)]);
    const enemy = toView(world).enemies[0];
    if (!enemy) break;
    const { kind, anim, animStep } = enemy;
    shown.push({ anim, animStep, frame: enemyFrame(kind, anim, animStep) });
  }
  return shown;
}
/** The steps each anim lasted in a run, one more than the last step it showed. */
const lasted = (shown: ReturnType<typeof play>) => {
  const most = new Map<EnemyAnim, number>();
  for (const { anim, animStep } of shown)
    most.set(anim, Math.max(most.get(anim) ?? -1, animStep + 1));
  return most;
};

test("every bonewalker frame is a valid sprite in every tier and the knight's, on one canvas and standing on one anchor", () => {
  assert.deepEqual(FRAMES, Object.keys(BONEWALKER_POSES));
  assert.deepEqual(BONE_KNIGHT.frames, FRAMES);
  assert.equal(FIGURES.bonewalker, BONEWALKER);
  assert.equal(FIGURES.boneknight, BONE_KNIGHT);
  for (const figure of [BONEWALKER, BONE_KNIGHT])
    for (const frame of FRAMES) {
      // Painting throws if anything reaches the canvas's outermost pixels, so a frame that paints fits its canvas.
      const painted = figure.sprite(frame);
      validateSprite(painted);
      for (const swap of Object.values(BONEWALKER_TIERS))
        validateSprite(swapPalette(painted, swap));
      // The anchor is on every frame's lowest painted row, only the outline under it: nothing sinks into the floor
      // or hovers over it, and what is still in the grave is cut off at its lip.
      assert.equal(painted.ay, painted.h - 2, `${frame} floats or sinks`);
      assert.equal(
        painted.rows[painted.ay + 1]!.replaceAll("k", CLEAR),
        CLEAR.repeat(painted.w),
      );
    }
  assert.deepEqual(
    paintBonewalker(BONEWALKER_POSES.idle),
    BONEWALKER.sprite("idle"),
  );
  // Every frame on its feet stands on the one anchor between its feet.
  for (const frame of ["idle", "walk0", "attack", "hurt"] as const) {
    const sprite = BONEWALKER.sprite(frame);
    const feet = columns(sprite, sprite.ay, /[Bb6]/);
    assert.ok(Math.min(...feet) < 0 && Math.max(...feet) > 0, `${frame} ${feet}`); // prettier-ignore
  }
  // A ravager's height, feet to crown, the knight's helm a little more; the pile and the crumbled bones lie low.
  const tall = (figure = BONEWALKER) =>
    (figure.sprite("idle").h - 2) / (RAVAGER.sprite("idle").h - 2);
  for (const ratio of [tall(), tall(BONE_KNIGHT)])
    assert.ok(
      ratio >= 0.88 && ratio <= 1.05,
      `a bonewalker is ${ratio}× a ravager`,
    );
  for (const frame of ["down", "pile", "crumble"] as const) {
    const { w, h } = BONEWALKER.sprite(frame);
    assert.ok(w > h * 2, `${frame} is ${w}×${h}`);
  }
});

test("a tier recolours only the rags (and the knight's cape): grave cloth, rust and violet; the knight wears steel", () => {
  const ramp = (swap: Record<string, string>) => [..."Aa$"].map((key) => swap[key]); // prettier-ignore
  assert.deepEqual(ramp(BONEWALKER_TIERS.grave), [..."Ii#"].map((k) => MASTER[k])); // prettier-ignore
  assert.deepEqual(ramp(BONEWALKER_TIERS.rust), [..."Tt%"].map((k) => MASTER[k])); // prettier-ignore
  assert.deepEqual(ramp(BONEWALKER_TIERS.violet), [..."Qq^"].map((k) => MASTER[k])); // prettier-ignore
  assert.deepEqual(ENEMY_ART.bonewalker.tiers, {
    0: BONEWALKER_TIERS.grave,
    1: BONEWALKER_TIERS.rust,
    2: BONEWALKER_TIERS.violet,
  });
  assert.deepEqual(ENEMY_ART.bonewalker.figures, { 2: BONE_KNIGHT });
  for (const frame of FRAMES) {
    const [walker, knight] = [
      BONEWALKER.sprite(frame),
      BONE_KNIGHT.sprite(frame),
    ];
    // Bone in every frame; the rags on any frame showing the hips; the walker's notched blade dull iron, the knight's
    // bright steel; and the knight is drawn differently in every frame.
    assert.ok(has(walker, "b") && has(knight, "b"), frame);
    if (!["rise0", "rise1", "rise2", "rise3"].includes(frame))
      assert.ok(/[Aa$]/.test(walker.rows.join("")), frame);
    const steel = (s: Sprite) => /[Mm7]/.test(s.rows.join(""));
    assert.ok(!steel(walker) && steel(knight), frame);
    assert.notDeepEqual(walker.rows, knight.rows, frame);
  }
  // The eye sockets glow whenever the skull is above the floor, but not while it lies in a pile or the bones crumble;
  // the twitch lights them again, the warning.
  const lit = FRAMES.filter((frame) => has(BONEWALKER.sprite(frame), "J"));
  const dark = ["rise0", "rise1", "scatter", "pile", "crumble"];
  assert.deepEqual(
    lit,
    FRAMES.filter((frame) => !dark.includes(frame)),
  );
});

test("the slash's arc reaches each tier's sword, the knight's furthest, and only the slash glows", () => {
  for (const tier of T.TIERS) {
    const attack = FIGURE[tier].sprite("attack");
    assert.equal(front(attack), BONE_SWORD[tier], `tier ${tier}`);
    // The arc's front is on the very column either way it faces.
    const row = attack.rows.findIndex((_, y) =>
      columns(attack, y, /[ZFf]/).includes(BONE_SWORD[tier]),
    );
    assert.ok(row >= 0, "the arc is the furthest thing");
    const left = flipSprite(attack);
    assert.ok(columns(left, row, /[ZFf]/).includes(-BONE_SWORD[tier]));
    for (const frame of FRAMES)
      assert.equal(
        /[ZFf]/.test(FIGURE[tier].sprite(frame).rows.join("")),
        frame === "attack",
        frame,
      );
  }
  assert.ok(BONE_SWORD[2] > BONE_SWORD[0]);
  // The wind-up raises the sword over the skull: its painted top well above the idle's.
  for (const figure of [BONEWALKER, BONE_KNIGHT])
    assert.ok(figure.sprite("windup").ay >= figure.sprite("idle").ay + 6);
});

test("every bonewalker anim plays frames the figure has, every frame is played, and the strips are the engine's steps", () => {
  assert.deepEqual(
    Object.keys(BONEWALKER_ANIMS).sort(),
    [...BONEWALKER_STATES].sort(),
  );
  const played = new Set<string>();
  for (const [anim, { frames, loop }] of Object.entries(BONEWALKER_ANIMS)) {
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
    Math.max(...Object.values(BONEWALKER_STEPS.windup)),
  );
  assert.equal(length("attack"), BONEWALKER_STEPS.attack);
  assert.equal(length("recover"), BONEWALKER_STEPS.recover);
  assert.equal(length("rise"), BONEWALKER_STEPS.rise);
  assert.equal(length("pile"), BONEWALKER_STEPS.pile);
  assert.equal(length("reassemble"), BONEWALKER_STEPS.reassemble);
  // Every tier has its sword raised over its head from well before its slash lands.
  for (const windup of Object.values(BONEWALKER_STEPS.windup))
    assert.equal(stripFrame(BONEWALKER_ANIMS.windup, windup - 4), "windup");
  // The pile lies still, then twitches quicker and quicker up to its very last step.
  const pile = (animStep: number) => enemyFrame("bonewalker", "pile", animStep);
  const twitches = Array.from({ length: BONEWALKER_STEPS.pile }, (_, i) => pile(i) === "twitch"); // prettier-ignore
  assert.equal(twitches.indexOf(true), PILE_STILL);
  assert.ok(twitches.at(-1));
  const starts = twitches.flatMap((on, i) =>
    on && !twitches[i - 1] ? [i] : [],
  );
  assert.ok(starts.length >= 4, `${starts}`);
  const gaps = starts.slice(1).map((at, i) => at - starts[i]!);
  assert.deepEqual(
    gaps,
    [...gaps].sort((a, b) => b - a),
    "quicker and quicker",
  );
  // `enemyFrame` plays them as they are, and never throws: any anim the view has at any step is one of its frames.
  for (const anim of Object.keys(BONEWALKER_ANIMS) as BonewalkerAnim[])
    for (const animStep of [0, 9, 10, 29, 59, 107, 108, 149, 400])
      assert.equal(
        enemyFrame("bonewalker", anim, animStep),
        stripFrame(BONEWALKER_ANIMS[anim], animStep),
      );
  for (const anim of ENEMY_STATES)
    for (const animStep of [0, 2.5, -4, Number.NaN, Infinity, 1e9])
      for (const figure of [BONEWALKER, BONE_KNIGHT])
        figure.sprite(
          enemyFrame("bonewalker", anim, animStep) as BonewalkerFrame,
        );
});

test("a bonewalker clawing out of its grave plays the whole rise over every step it rises, then stands", () => {
  let world = party(3);
  // The camera at the first wave's trigger with the party: its bonewalker claws up out of the first grave at once.
  const shift = STAGE_3.waves[0]!.at - world.camX;
  world = {
    ...world,
    camX: world.camX + shift,
    heroes: world.heroes.map((h) => ({ ...h, x: h.x + shift })),
  };
  for (let i = 0; i < 60 && !world.enemies.some((e) => e.state === "rise"); i++) world = step(world, []); // prettier-ignore
  const index = world.enemies.findIndex((e) => e.state === "rise");
  assert.ok(index >= 0, "it rises");
  const id = world.enemies[index]!.id;
  const frames: string[] = [];
  let anim: EnemyAnim = "rise";
  for (let i = 0; i < 80 && anim === "rise"; i++) {
    const shown = toView(world).enemies.find((e) => e.id === id)!;
    if (shown.anim === "rise") frames[shown.animStep] = enemyFrame("bonewalker", "rise", shown.animStep); // prettier-ignore
    world = step(world, []);
    anim = toView(world).enemies.find((e) => e.id === id)!.anim;
  }
  assert.equal(frames.length, BONEWALKER_STEPS.rise);
  assert.notEqual(anim, "rise");
  // Every rise frame, in order, none shorter than a sixth of the rise but by a step: the climb reads all the way.
  const runs = RISE.map(
    (frame) => frames.filter((each) => each === frame).length,
  );
  assert.deepEqual(frames, [...frames].sort());
  for (const run of runs) assert.ok(run >= Math.floor(BONEWALKER_STEPS.rise / RISE.length), `${runs}`); // prettier-ignore
  // It comes up out of the floor: each frame shows more of it above the lip than the one before.
  const above = RISE.map(
    (frame) => BONEWALKER.sprite(frame).rows.join("").replace(/[.k9]/g, "").length, // prettier-ignore
  );
  for (let i = 1; i < above.length; i++)
    assert.ok(above[i]! > above[i - 1]!, `${above}`);
});

test("the slash shows from the very step the sword lands for exactly the steps it is out, raised before it, at every tier", () => {
  for (const tier of T.TIERS) {
    const start = bonewalker(20, { state: "windup", target: 1 }, tier);
    const full = start.heroes[0]!.hp;
    let [world, landed] = [start, false];
    const slashing = new Set<number>();
    for (let i = 0; i < 60 && world.enemies[0]!.state !== "idle"; i++) {
      const was = world.heroes[0]!.hp;
      world = step(world, []);
      const { kind, anim, animStep } = toView(world).enemies[0]!;
      const frame = enemyFrame(kind, anim, animStep);
      assert.equal(frame === "attack", anim === "attack", `${anim} ${frame}`);
      if (anim === "windup") assert.ok(["lift", "windup"].includes(frame));
      if (anim === "attack") slashing.add(animStep);
      if (world.heroes[0]!.hp < was) {
        assert.ok(!landed && anim === "attack" && animStep === 0);
        landed = true;
      }
    }
    assert.ok(landed && world.heroes[0]!.hp < full, `tier ${tier} landed`);
    assert.equal(slashing.size, BONEWALKER_STEPS.attack);
  }
});

test("each bonewalker anim lasts as long as the engine keeps it: the pile twitches out its last steps, then reassembles", () => {
  // A bone pile left alone lies its time, twitching on its last step, and pulls itself together onto one knee.
  const shown = play(bonewalker(40, { state: "pile", hp: 0 }), 200);
  const most = lasted(shown);
  assert.equal(most.get("pile"), length("pile"));
  assert.equal(most.get("reassemble"), length("reassemble"));
  const last = shown.findIndex((each) => each.anim === "reassemble") - 1;
  assert.equal(shown[last]!.frame, "twitch");
  assert.equal(shown[last - (length("pile") - PILE_STILL)]!.frame, "pile");
  assert.equal(shown[last + length("reassemble")]!.frame, "getup");
  // A blade on the pile shatters it: the bones burst and crumble as it lies dead.
  const smashed = play(bonewalker(18, { state: "pile", hp: 0 }), 90, (i) => (i === 0 ? ATTACK : 0)); // prettier-ignore
  assert.equal(lasted(smashed).get("dead"), length("dead"));
  const dead = smashed.filter((each) => each.anim === "dead").map((each) => each.frame); // prettier-ignore
  assert.deepEqual([...new Set(dead)], ["scatter", "crumble"]);
  // The knight's slash and the stand after it.
  const swing = lasted(play(bonewalker(20, { state: "windup", target: 1 }, 2), 60)); // prettier-ignore
  for (const anim of ["attack", "recover"] as const) assert.equal(swing.get(anim), length(anim)); // prettier-ignore
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  STAGE_4,
  createWorld,
  spawnEnemy,
  step,
  toView,
  waveSpawns,
  type Enemy,
  type EnemyAnim,
  type Hero,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import { CUT, VORHAL_STATES, VORHAL_STEPS } from "../src/engine/view-kit.js";
import { enemyFrame, stripFrame } from "../src/render/art/animate.js";
import { FIGURES } from "../src/render/art/index.js";
import { OGRE } from "../src/render/art/ogre.js";
import {
  VORHAL,
  VORHAL_ANIMS,
  VORHAL_POSES,
  VORHAL_RAGE,
  VORHAL_WALK_STEPS,
  paintVorhal,
  type VorhalArtAnim,
  type VorhalFrame,
} from "../src/render/art/vorhal.js";
import {
  CLEAR,
  swapPalette,
  validateSprite,
  type Sprite,
} from "../src/render/pixel/sprite.js";

const { px } = T;
const FRAMES = VORHAL.frames;
const keys = (s: Sprite) => new Set(s.rows.join(""));
/** The furthest column ahead of the anchor painted in a key that `match`es. */
const front = (s: Sprite, match: RegExp) =>
  Math.max(
    ...s.rows.flatMap((row) =>
      [...row].flatMap((key, x) => (match.test(key) ? [x - s.ax] : [])),
    ),
  );
const length = (anim: VorhalArtAnim) =>
  VORHAL_ANIMS[anim].frames.reduce((sum, [, steps]) => sum + steps, 0);

/** The party in Vorhal's throne room, its wave being fought, and Vorhal `dx` px from Brakka, facing him, `change`d. */
function throne(
  dx: number,
  change: Partial<Enemy> = {},
  kinds: Hero["kind"][] = ["brakka"],
): World {
  const start = createWorld({
    seed: 7,
    stage: 4,
    heroes: kinds.map((kind, seat) => ({ seat, kind })),
  });
  const shift = STAGE_4.cameraEnd;
  const world = spawnEnemy(
    {
      ...start,
      ...{
        camX: shift,
        wave: STAGE_4.waves.length,
        locked: true,
        impsSent: STAGE_4.imps.length,
      },
      heroes: start.heroes.map((h) => ({ ...h, x: h.x + shift })),
      spawned: waveSpawns(STAGE_4.waves.at(-1)!, kinds.length).length,
    },
    "vorhal",
    start.heroes[0]!.x + shift + px(dx),
    start.heroes[0]!.y,
  );
  const vorhal = { facing: dx > 0 ? -1 : 1, thinkAt: 1e6, ...change } as const;
  return {
    ...world,
    enemies: world.enemies.map((e) =>
      e.kind === "vorhal" ? { ...e, ...vorhal } : e,
    ),
  };
}
const him = (world: World) =>
  toView(world).enemies.find((e) => e.kind === "vorhal")!;
const frameOf = (world: World) => {
  const { kind, anim, animStep } = him(world);
  return enemyFrame(kind, anim, animStep) as VorhalFrame;
};

test("every Vorhal frame is a valid sprite in both palettes, painted inside one canvas and standing on one anchor", () => {
  assert.deepEqual(FRAMES, Object.keys(VORHAL_POSES));
  assert.equal(FIGURES.vorhal, VORHAL);
  for (const frame of FRAMES) {
    const pose = VORHAL_POSES[frame];
    // Painting throws if anything reaches the canvas's outermost pixels, so a frame that paints fits its canvas.
    const painted = paintVorhal(pose);
    validateSprite(painted);
    validateSprite(swapPalette(painted, VORHAL_RAGE));
    assert.deepEqual([pose.size, pose.anchor], [VORHAL_POSES.idle.size, VORHAL_POSES.idle.anchor], frame); // prettier-ignore
    assert.deepEqual(painted, VORHAL.sprite(frame), "painted once, the same");
    // The anchor is on every frame's lowest painted row, only the outline under it: no frame sinks or hovers, and the
    // planted sword's point is cut off at the floor.
    assert.equal(painted.ay, painted.h - 2, `${frame} floats or sinks`);
    assert.equal(painted.rows[painted.ay + 1]!.replaceAll("k", CLEAR), CLEAR.repeat(painted.w)); // prettier-ignore
  }
  // As tall as an ogre, horns and all; lying, wider than tall; the summons' sword towers over him.
  const [idle, ogre] = [VORHAL.sprite("idle"), OGRE.sprite("idle")];
  assert.ok(idle.h - 2 >= 64 && idle.h - 2 <= 76, `idle is ${idle.h - 2}`);
  assert.ok(idle.h >= ogre.h, "a head taller than an ogre's hunch");
  const down = VORHAL.sprite("down");
  assert.ok(down.w > down.h * 1.5, `down is ${down.w}×${down.h}`);
  assert.ok(VORHAL.sprite("summon").ay > idle.ay + 25, "the sword held high");
});

test("he is a dark knight at a glance: violet plate, bone horns, a red cape, a steel greatsword, eyes burning until he falls", () => {
  for (const frame of FRAMES) {
    const shown = keys(VORHAL.sprite(frame));
    // Each material by any shade of its ramp: violet iron, bone, the cape's red, steel and gold.
    for (const ramp of ["Ii#", "Bb6", "Cc0", "Mm7", "Nn8"])
      assert.ok([...ramp].some((key) => shown.has(key)), `${frame} lacks ${ramp}`); // prettier-ignore
    assert.equal(shown.has("P"), frame !== "dead", `${frame}'s eyes`);
  }
  // Only the cuts show a smear; only the cast's frames fire in his hand, the summons' green light, the roar its aura
  // and the fall cracks in his armour.
  const posed = (
    field: keyof (typeof VORHAL_POSES)["idle"] | "glow" | "cracked",
  ) =>
    FRAMES.filter(
      (frame) => (VORHAL_POSES[frame] as Record<string, unknown>)[field],
    );
  assert.deepEqual(posed("smear"), ["cut1", "cut2"]);
  assert.deepEqual(posed("glow"), [
    "plant",
    "cast",
    "summon",
    "roar1",
    "roar2",
  ]);
  assert.deepEqual(posed("cracked"), ["dying", "dead"]);
  assert.deepEqual(
    FRAMES.filter((frame) => keys(VORHAL.sprite(frame)).has("J")),
    ["summon"],
  );
  // Enraged his eyes, trims and the embers on his cape burn red and gold, his plate's shadows go crimson.
  const rgb = (hex: string) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [r, g, b] = rgb(VORHAL_RAGE.P!);
  assert.ok(r! > 200 && g! < 100 && b! < 100, "red eyes");
  const idle = VORHAL.sprite("idle");
  for (const key of ["P", "=", "q"]) {
    assert.ok(keys(idle).has(key), key);
    assert.notEqual(
      swapPalette(idle, VORHAL_RAGE).palette[key],
      idle.palette[key],
      key,
    );
  }
});

test("a planted foot keeps pace with the road through his tread, at the calm walk", () => {
  const pace = (T.VORHAL.calm.walk.x / T.SUB) * VORHAL_WALK_STEPS;
  const cycle = (["walk1", "walk2", "walk3", "walk4", "walk1"] as const).map((frame) => VORHAL_POSES[frame]); // prettier-ignore
  const ground = (i: number, side: "near" | "far") =>
    cycle[i]![side].ankle[0] + i * pace;
  for (const i of [1, 2])
    assert.ok(Math.abs(ground(i, "near") - ground(0, "near")) < 0.05);
  for (const i of [3, 4])
    assert.ok(Math.abs(ground(i, "far") - ground(2, "far")) < 0.05);
});

test("every Vorhal anim plays frames he has, every frame is played, and the strips are the engine's steps", () => {
  assert.deepEqual(Object.keys(VORHAL_ANIMS).sort(), [...VORHAL_STATES].sort());
  const played = new Set<string>();
  for (const [anim, { frames, loop }] of Object.entries(VORHAL_ANIMS)) {
    for (const [frame, steps] of frames) {
      assert.ok(FRAMES.includes(frame), `${anim} plays ${frame}`);
      assert.ok(Number.isInteger(steps) && steps > 0, `${anim} ${frame}`);
      played.add(frame);
    }
    assert.equal(loop, ["idle", "walk", "enter"].includes(anim), anim);
  }
  assert.deepEqual([...played].sort(), [...FRAMES].sort());
  const S = VORHAL_STEPS;
  const timed = { windup: S.windup, cut1: S.cut1, cut2: S.cut2, recover: S.recover, cast: S.cast, summon: S.summon, leap: S.leap, roar: S.roar, stagger: S.stagger }; // prettier-ignore
  for (const [anim, steps] of Object.entries(timed))
    assert.equal(length(anim as VorhalArtAnim), steps, anim);
  // Each move's second frame starts on the engine's step: the cast's fire when it marks the sigils, the summons'
  // light when the bonewalkers rise, the leap's drop at its apex.
  assert.equal(stripFrame(VORHAL_ANIMS.cast, S.castMark - 1), "plant");
  assert.equal(stripFrame(VORHAL_ANIMS.cast, S.castMark), "cast");
  assert.equal(stripFrame(VORHAL_ANIMS.summon, S.summonAt - 1), "raise");
  assert.equal(stripFrame(VORHAL_ANIMS.summon, S.summonAt), "summon");
  assert.equal(stripFrame(VORHAL_ANIMS.leap, S.leapApex), "vault");
  assert.equal(stripFrame(VORHAL_ANIMS.leap, S.leapApex + 1), "descend");
  for (const anim of Object.keys(VORHAL_ANIMS) as VorhalArtAnim[])
    for (const animStep of [0, 7, 13, 14, 24, 33, 47, 100])
      assert.equal(enemyFrame("vorhal", anim, animStep), stripFrame(VORHAL_ANIMS[anim], animStep)); // prettier-ignore
});

test("in the engine each cut shows its strike on the very step it lands, calm or enraged, its smear out to the cut's reach", () => {
  for (const enraged of [false, true]) {
    let world = throne(40, {
      state: "windup",
      target: 1,
      enraged,
      hp: enraged ? 10 : 260,
    });
    const hp = () => world.heroes[0]!.hp;
    const landed: number[] = [];
    let last = hp();
    for (let i = 0; i < 80 && landed.length < 2; i++) {
      const before = frameOf(world);
      const cut = landed.length === 0 ? "cut1" : "cut2";
      world = step(world, [0]);
      if (hp() < last) {
        landed.push(i);
        assert.deepEqual([frameOf(world), him(world).animStep], [cut, 0]);
        assert.equal(before, cut === "cut1" ? "windup" : "follow1");
      } else assert.notEqual(frameOf(world), cut, `${i}: not before it lands`);
      last = hp();
    }
    assert.equal(landed[0], (enraged ? VORHAL_STEPS.rageWindup : VORHAL_STEPS.windup) - 1); // prettier-ignore
    assert.equal(landed.length, 2);
  }
  // Each cut's smear sweeps out level to the cut's reach in front of his feet, and nothing else of him reaches it.
  for (const cut of ["cut1", "cut2"] as const) {
    const s = VORHAL.sprite(cut);
    assert.ok(
      Math.abs(front(s, /[ZFf]/) - CUT.reach) <= 1,
      `${cut} reaches ${front(s, /[ZFf]/)}`,
    );
    assert.ok(front(s, /[^.ZFfk]/) < CUT.reach, cut);
  }
});

/** The most `animStep` Vorhal shows in each anim over `steps` steps. */
function peaks(start: World, steps: number, held: readonly number[] = [0]) {
  const most = new Map<EnemyAnim, number>();
  let world = start;
  for (let i = 0; i < steps; i++) {
    world = step(world, held);
    const shown = him(world);
    if (!shown) break;
    most.set(shown.anim, Math.max(most.get(shown.anim) ?? -1, shown.animStep));
  }
  return most;
}

test("each of his moves lasts exactly as many steps as the engine keeps him in it", () => {
  const lasts = (most: Map<EnemyAnim, number>, anims: VorhalArtAnim[]) => {
    for (const anim of anims) {
      assert.ok(most.has(anim), `never reached ${anim}`);
      assert.equal(most.get(anim)! + 1, length(anim), anim);
    }
  };
  lasts(peaks(throne(40, { state: "windup", target: 1 }), 120), ["windup", "cut1", "cut2", "recover"]); // prettier-ignore
  lasts(peaks(throne(110, { state: "cast" }), 60), ["cast"]);
  lasts(peaks(throne(110, { state: "summon" }), 60), ["summon"]);
  lasts(peaks(throne(30, { state: "idle", hp: 130, thinkAt: 0 }), 70), ["roar"]); // prettier-ignore
});

test("in the engine the cast burns in his hand from the step he marks the sigils, and the summons glow from the step they rise", () => {
  let cast = throne(110, { state: "cast" }, ["brakka", "gorm"]);
  for (let i = 0; i < 30 && cast.sigils.length === 0; i++) {
    const before = frameOf(cast);
    cast = step(cast, []);
    assert.equal(frameOf(cast), cast.sigils.length > 0 ? "cast" : "plant");
    if (cast.sigils.length) assert.equal(before, "plant");
  }
  assert.ok(cast.sigils.length > 0);
  let summon = throne(110, { state: "summon" });
  const bones = (w: World) =>
    w.enemies.filter((e) => e.kind === "bonewalker").length;
  for (let i = 0; i < 30 && bones(summon) === 0; i++) {
    summon = step(summon, []);
    assert.equal(frameOf(summon), bones(summon) > 0 ? "summon" : "raise");
  }
  assert.ok(bones(summon) > 0);
});

test("in the engine the leap vaults while he climbs and drops from its apex", () => {
  // His back to the screen's left edge and Brakka close in front: he leaps the moment he decides.
  let world = throne(40, { thinkAt: 0, state: "idle" });
  const v = world.enemies.find((e) => e.kind === "vorhal")!;
  world = { ...world, enemies: world.enemies.map((e) => (e === v ? { ...e, x: world.camX + px(30), facing: 1 } : e)) }; // prettier-ignore
  world = { ...world, heroes: world.heroes.map((h) => ({ ...h, x: world.camX + px(70), y: v.y })) }; // prettier-ignore
  let leapt = false;
  for (let rng = 1; rng < 200 && !leapt; rng++) {
    let next = step({ ...world, rng }, []);
    if (him(next).anim !== "leap") continue;
    leapt = true;
    // His height in the engine's units: the view's whole pixels hold still a step at the apex.
    const zOf = (w: World) => w.enemies.find((e) => e.kind === "vorhal")!.z;
    let z = zOf(next);
    while (him(next).anim === "leap") {
      next = step(next, []);
      const shown = him(next);
      if (shown.anim !== "leap") break;
      const rising = zOf(next) > z;
      assert.equal(frameOf(next), rising ? "vault" : "descend", `${shown.animStep}`); // prettier-ignore
      z = zOf(next);
    }
  }
  assert.ok(leapt);
});

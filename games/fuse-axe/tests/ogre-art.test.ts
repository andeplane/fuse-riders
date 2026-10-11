import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorld,
  spawnEnemy,
  step,
  toView,
  type Enemy,
  type EnemyAnim,
  type Hero,
  type World,
} from "../src/engine/index.js";
import { quakeAt } from "../src/engine/ogre.js";
import * as T from "../src/engine/tuning.js";
import type { EnemyView } from "../src/engine/view.js";
import { OGRE_STEPS, QUAKE, VIEW_H, VIEW_W } from "../src/engine/view-kit.js";
import { OGRE_STATES } from "../src/engine/world.js";
import { enemyFrame, stripFrame } from "../src/render/art/animate.js";
import { FIGURES } from "../src/render/art/index.js";
import {
  OGRE,
  OGRE_ANIMS,
  OGRE_CROWNS,
  OGRE_POSES,
  OGRE_RAGE,
  OGRE_TIERS,
  OGRE_WALK_STEPS,
  paintOgre,
  RAGE_EYE,
  type OgreAnim,
  type OgreFrame,
} from "../src/render/art/ogre.js";
import { RAVAGER } from "../src/render/art/ravager.js";
import {
  BURST,
  drawCracks,
  drawShards,
  drawSteam,
  quakeFront,
  SHARD,
} from "../src/render/ogre-fx.js";
import type { Pen } from "../src/render/pen.js";
import {
  CLEAR,
  swapPalette,
  validateSprite,
} from "../src/render/pixel/sprite.js";

const { px } = T;
const FRAMES = OGRE.frames;
const party = (...kinds: Hero["kind"][]) =>
  createWorld({ seed: 5, heroes: kinds.map((kind, seat) => ({ seat, kind })) });
const patchHero = (world: World, index: number, change: Partial<Hero>) => ({
  ...world,
  heroes: world.heroes.map((h, i) => (i === index ? { ...h, ...change } : h)),
});
/** An ogre `dx` px along the road from the first hero (level with it), facing it, with `change` made to it. */
function ogre(world: World, dx: number, change: Partial<Enemy> = {}): World {
  const hero = world.heroes[0]!;
  const next = spawnEnemy(world, "ogre", hero.x + px(dx), hero.y);
  const facing = dx > 0 ? -1 : 1;
  return {
    ...next,
    enemies: next.enemies.map((e, i) =>
      i === next.enemies.length - 1 ? { ...e, facing, ...change } : e,
    ),
  };
}
const frameOf = (world: World) => {
  const { kind, anim, animStep } = toView(world).enemies[0]!;
  return enemyFrame(kind, anim, animStep) as OgreFrame;
};
const length = (anim: OgreAnim) =>
  OGRE_ANIMS[anim].frames.reduce((sum, [, steps]) => sum + steps, 0);

test("every ogre frame is a valid sprite in every palette, painted inside one canvas and standing on one anchor", () => {
  assert.deepEqual(FRAMES, Object.keys(OGRE_POSES));
  assert.equal(FIGURES.ogre, OGRE);
  for (const frame of FRAMES) {
    const pose = OGRE_POSES[frame];
    // Painting throws if anything reaches the canvas's outermost pixels, so a frame that paints fits its canvas.
    const painted = paintOgre(pose);
    validateSprite(painted);
    for (const swap of Object.values(OGRE.swaps))
      validateSprite(swapPalette(painted, swap));
    assert.deepEqual(pose.size, OGRE_POSES.idle.size, frame);
    assert.deepEqual(pose.anchor, OGRE_POSES.idle.anchor, frame);
    assert.deepEqual(painted, OGRE.sprite(frame), "painted once, the same");
    // The anchor is on every frame's lowest painted row (the flung and the fallen too), only the outline under it,
    // so no frame sinks into the floor or hovers over it, and the buried hammer is cut off at the floor.
    assert.equal(painted.ay, painted.h - 2, `${frame} floats or sinks`);
    assert.equal(
      painted.rows[painted.ay + 1]!.replaceAll("k", CLEAR),
      CLEAR.repeat(painted.w),
    );
  }
  // Half as big again as a ravager, boots to crown, and broad; lying, wider than tall; the wind-up towers.
  const [idle, ravager] = [OGRE.sprite("idle"), RAVAGER.sprite("idle")];
  const ratio = (idle.h - 2) / (ravager.h - 2);
  assert.ok(ratio >= 1.4 && ratio <= 1.6, `the ogre is ${ratio}× a ravager`);
  assert.ok(idle.h - 2 >= 64 && idle.h - 2 <= 74, `idle is ${idle.h - 2}`);
  const down = OGRE.sprite("down");
  assert.ok(down.w > down.h * 1.5, `down is ${down.w}×${down.h}`);
  assert.ok(OGRE.sprite("windup").ay > idle.ay + 25, "the hammer held high");
});

test("the twins are green and red, an enraged one's eyes burn, and only the slam's frames bury the hammer", () => {
  const rgb = (hex: string) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [g, r] = [OGRE_TIERS[0].o!, OGRE_TIERS[1].o!].map(rgb);
  assert.ok(g![1]! > g![0]! && g![1]! > g![2]!, "the first twin is green");
  assert.ok(r![0]! > r![1]! && r![0]! > r![2]!, "the second twin is red");
  assert.equal(new Set(Object.values(OGRE_TIERS).map((p) => p.o)).size, 3);
  // The rage palettes are the calm ones with the eyes alone burning red.
  for (const tier of [0, 1, 2] as const)
    assert.deepEqual(OGRE_RAGE[tier], { ...OGRE_TIERS[tier], D: RAGE_EYE });
  // Every frame but those in pain shows the glinting eye the rage recolours; the skin is the olive ramp the twins'
  // palettes swap, with iron, steel and leather gear; standing, its tusks show.
  for (const frame of FRAMES) {
    const keys = new Set(OGRE.sprite(frame).rows.join(""));
    const pain = OGRE_POSES[frame].face === "pain";
    assert.equal(keys.has("D"), !pain, frame);
    for (const key of ["O", "o", "i", "m", "l"])
      assert.ok(keys.has(key), `${frame} lacks ${key}`);
  }
  assert.match(OGRE.sprite("idle").rows.join(""), /[Bb6]/);
  assert.deepEqual(
    FRAMES.filter((frame) => OGRE_POSES[frame].buried),
    ["slam", "quake"],
  );
  // The slam's blow and the sweep's strike show their motion; the hammer is in hand throughout.
  const glows = (frame: OgreFrame) =>
    /[ZFf]/.test(OGRE.sprite(frame).rows.join(""));
  assert.deepEqual(FRAMES.filter(glows), ["slam", "sweep"]);
});

test("a planted foot keeps pace with the road through the stomp, at the calm walk", () => {
  const pace = (T.OGRE.calm.walk.x / T.SUB) * OGRE_WALK_STEPS;
  const cycle = (["walk1", "walk2", "walk3", "walk4", "walk1"] as const).map(
    (frame) => OGRE_POSES[frame],
  );
  const ground = (i: number, side: "near" | "far") =>
    cycle[i]![side].ankle[0] + i * pace;
  // The near foot is down from the first frame to the third, the far foot from the third to the next cycle's first.
  for (const i of [1, 2])
    assert.ok(Math.abs(ground(i, "near") - ground(0, "near")) < 0.05);
  for (const i of [3, 4])
    assert.ok(Math.abs(ground(i, "far") - ground(2, "far")) < 0.05);
});

test("every ogre anim plays frames the figure has, and every frame is played", () => {
  assert.deepEqual(Object.keys(OGRE_ANIMS).sort(), [...OGRE_STATES].sort());
  const played = new Set<string>();
  for (const [anim, { frames, loop }] of Object.entries(OGRE_ANIMS)) {
    for (const [frame, steps] of frames) {
      assert.ok(FRAMES.includes(frame), `${anim} plays ${frame}`);
      assert.ok(Number.isInteger(steps) && steps > 0, `${anim} ${frame}`);
      played.add(frame);
    }
    assert.equal(loop, ["idle", "walk", "enter"].includes(anim), anim);
  }
  assert.deepEqual([...played].sort(), [...FRAMES].sort());
  // The strips timed by the engine's steps.
  assert.equal(length("windup"), OGRE_STEPS.windup);
  assert.equal(length("slam"), OGRE_STEPS.slam);
  assert.equal(length("sweep"), OGRE_STEPS.sweep);
  assert.equal(length("recover"), OGRE_STEPS.recover);
  assert.equal(length("stagger"), OGRE_STEPS.stagger);
  // `enemyFrame` plays them as they are.
  for (const anim of Object.keys(OGRE_ANIMS) as OgreAnim[])
    for (const animStep of [0, 7, 8, 15, 16, 23, 24, 47, 100])
      assert.equal(
        enemyFrame("ogre", anim, animStep),
        stripFrame(OGRE_ANIMS[anim], animStep),
      );
});

/** The most `animStep` the first enemy shows in each anim over `steps` steps, until it is gone. */
function peaks(start: World, steps: number) {
  const most = new Map<EnemyAnim, number>();
  let world = start;
  for (let i = 0; i < steps; i++) {
    world = step(world, [0]);
    const shown = toView(world).enemies[0];
    if (!shown) break;
    most.set(shown.anim, Math.max(most.get(shown.anim) ?? -1, shown.animStep));
  }
  return most;
}

test("the slam's blow shows on the very step the hammer lands, and the wind-up before it, calm or enraged", () => {
  for (const enraged of [false, true]) {
    let world = ogre(party("brakka"), 30, {
      state: "windup",
      target: 1,
      enraged,
    });
    world = patchHero(world, 0, { x: world.enemies[0]!.x - px(40) });
    const full = world.heroes[0]!.hp;
    let landed = -1;
    for (let i = 0; i < 60 && landed < 0; i++) {
      const before = frameOf(world);
      world = step(world, [0]);
      if (world.heroes[0]!.hp < full) {
        landed = i;
        assert.equal(frameOf(world), "slam");
        assert.equal(toView(world).enemies[0]!.animStep, 0);
        assert.equal(before, "windup", "held high until it falls");
      } else assert.notEqual(frameOf(world), "slam");
    }
    const windup = enraged ? OGRE_STEPS.rageWindup : OGRE_STEPS.windup;
    assert.equal(landed, windup - 1, `enraged ${enraged}`);
  }
});

test("the sweep's strike shows from the very step it lands, the wind-up before it", () => {
  // Brakka close behind an ogre that is about to decide, Gorm far off in front.
  let world = ogre(party("brakka", "gorm"), -20, {
    state: "idle",
    facing: -1,
    thinkAt: 0,
  });
  world = patchHero(world, 1, { x: world.enemies[0]!.x - px(90) });
  const full = world.heroes[0]!.hp;
  const shown: OgreFrame[] = [];
  for (let i = 0; i < 40 && world.heroes[0]!.hp === full; i++) {
    world = step(world, [0]);
    shown.push(frameOf(world));
  }
  assert.ok(world.heroes[0]!.hp < full, "the sweep landed");
  assert.equal(toView(world).enemies[0]!.animStep, OGRE_STEPS.sweepWindup);
  assert.equal(shown.at(-1), "sweep");
  assert.ok(shown.slice(0, -1).every((frame) => frame !== "sweep"));
  assert.equal(shown.at(-2), "sweepWindup");
});

test("each ogre anim lasts exactly as many steps as the engine keeps it in that state", () => {
  // The last step an anim shows is the one before its state ends, so it lasts one more than that.
  const lasts = (most: Map<EnemyAnim, number>, anims: OgreAnim[]) => {
    for (const anim of anims) {
      assert.ok(most.has(anim), `never reached ${anim}`);
      assert.equal(most.get(anim)! + 1, length(anim), anim);
    }
  };
  // A calm slam at Brakka in front, then the stand open after it.
  const slam = ogre(party("brakka"), 30, { state: "windup", target: 1 });
  lasts(peaks(slam, 130), ["windup", "slam", "recover"]);
  // A sweep at Brakka behind.
  let sweep = ogre(party("brakka", "gorm"), -20, {
    state: "idle",
    facing: -1,
    thinkAt: 0,
  });
  sweep = patchHero(sweep, 1, { x: sweep.enemies[0]!.x - px(90) });
  lasts(peaks(sweep, 80), ["sweep", "recover"]);
  // Brakka's finisher, its blade a step from out: it staggers an ogre walking, and knocks one down that has taken a
  // quarter of its hit points since it last fell; one with a single hit point left falls dead.
  const swing = T.COMBO.brakka[2];
  const finisher = (change: Partial<Enemy>) =>
    patchHero(ogre(party("brakka"), 30, { target: 1, ...change }), 0, {
      state: "attack3",
      timer: swing.startup - 1,
    });
  lasts(peaks(finisher({ state: "walk" }), 30), ["stagger"]);
  const full = T.enemyMaxHp("ogre", 0, 1);
  const poise = Math.ceil(full / T.POISE) - swing.damage;
  lasts(peaks(finisher({ state: "windup", poise }), 120), [
    "knockdown",
    "down",
    "getup",
  ]);
  lasts(peaks(finisher({ state: "walk", hp: 1 }), 120), ["dead"]);
});

/** A pen recording the pixels each call fills. */
function recorder() {
  const fills: { style: string; x: number; y: number; w: number; h: number }[] =
    [];
  const pen: Pen<never> = {
    fillStyle: "",
    fillRect(x, y, w, h) {
      fills.push({ style: String(this.fillStyle), x, y, w, h });
    },
    drawImage() {},
  };
  return { pen, fills };
}

test("the shockwave runs at the engine's front: the crack from the hammer's reach to it, the shards bursting behind it", () => {
  let world = ogre(party("brakka"), 120, { state: "slam", timer: 0 });
  world = patchHero(world, 0, { y: world.heroes[0]!.y + px(30) });
  const seen: number[] = [];
  for (let n = 1; n <= QUAKE.steps + 2; n++) {
    world = step(world, [0]);
    const big = world.enemies[0]!;
    const view = toView(world);
    const enemy = view.enemies[0]!;
    const front = quakeFront(enemy);
    if (big.state !== "slam" || big.timer > T.QUAKE_STEPS) {
      assert.equal(front, null, `${big.state} ${big.timer}`);
      continue;
    }
    // Where the engine's shockwave is on this step, in the view's pixels.
    assert.equal(front, (big.x + big.facing * quakeAt(big.timer)) / T.SUB);
    seen.push(big.timer);
    const camX = view.camX;
    const crack = recorder();
    drawCracks(crack.pen, view.enemies, camX);
    // It starts at the hammer's reach and ends at the front, a split forking at most 2 px past it.
    const columns = crack.fills.map((f) => f.x);
    const [first, last] = [Math.min(...columns), Math.max(...columns)];
    const [near, far] = enemy.facing > 0 ? [first, last] : [last, first];
    const screen = (x: number) => Math.floor(x - camX);
    assert.equal(near, screen(enemy.x + enemy.facing * QUAKE.reach));
    assert.ok(Math.abs(far - screen(front!)) <= 2);
    // The tallest shard stands where the front was at a burst, at most `BURST` steps back.
    const rocks = recorder();
    drawShards(rocks.pen, view.enemies, camX);
    const tip = rocks.fills
      .filter((f) => f.w === 1 && f.h > 1)
      .reduce((top, f) => (f.y < top.y ? f : top));
    const lag = Math.abs(tip.x + camX - front!);
    assert.ok(lag <= QUAKE.speed * BURST + 1, `${lag} px behind`);
    assert.ok(Math.floor(enemy.y) - tip.y <= Math.max(...SHARD) + 1);
  }
  assert.deepEqual(
    seen,
    Array.from({ length: QUAKE.steps }, (_, i) => i + 1),
  );
});

/** An enemy `animStep` steps into its slam. */
const slamming = (enemy: EnemyView, animStep: number): EnemyView => ({
  ...enemy,
  ...{ anim: "slam", animStep },
});

test("the crack ends where the figures' pixels are under a camera between pixels, and keeps its shape as the camera scrolls", () => {
  const big = toView(ogre(party("brakka"), 120)).enemies[0]!;
  const crack = (x: number, facing: 1 | -1, camX: number) => {
    const { pen, fills } = recorder();
    drawCracks(pen, [slamming({ ...big, x, facing }, 12)], camX);
    return fills;
  };
  for (const facing of [1, -1] as const)
    for (const x of [100, 100.2, 100.5, 100.9])
      for (const camX of [0, 0.25, 10.5, 10.75]) {
        const columns = crack(x, facing, camX).map((f) => f.x);
        const near = facing > 0 ? Math.min(...columns) : Math.max(...columns);
        // The hammer's reach on screen is where a sprite's feet would be put there (`Math.floor(x - camX)`).
        const reach = Math.floor(x + facing * QUAKE.reach - camX);
        assert.equal(near, reach, `${facing} ${x} ${camX}`);
      }
  // A world column's bends and width stay put as the camera moves by whole pixels.
  const shape = (camX: number) => {
    const columns = new Map<number, string[]>();
    for (const f of crack(100, 1, camX)) {
      const column = f.x + Math.floor(camX);
      const drawn = `${f.style} ${f.y} ${f.w} ${f.h}`;
      columns.set(column, [...(columns.get(column) ?? []), drawn]);
    }
    return columns;
  };
  const [home, scrolled] = [shape(0), shape(7)];
  assert.ok(home.size > 20);
  for (const [column, drawn] of home)
    assert.deepEqual(scrolled.get(column), drawn, `column ${column}`);
});

test("the shards go on crumbling after the wave's last step until the hammer rises, then are gone, never popping out tall", () => {
  const big = toView(ogre(party("brakka"), 120)).enemies[0]!;
  const tallest = (animStep: number, anim: EnemyView["anim"] = "slam") => {
    const { pen, fills } = recorder();
    drawShards(pen, [{ ...big, anim, animStep }], 0);
    const heights = fills
      .filter((f) => f.w === 1 && f.h > 1)
      .map((f) => Math.floor(big.y) - f.y + 1);
    return { drawn: fills.length, height: Math.max(0, ...heights) };
  };
  for (let n = 1; n < OGRE_STEPS.slam; n++)
    assert.ok(tallest(n).drawn > 0, `step ${n}`);
  // From the wave's end the tallest shard falls a stage at a time, to the lowest as the hammer rises.
  const drops: number[] = [];
  for (let n = QUAKE.steps; n < OGRE_STEPS.slam - 1; n++)
    drops.push(tallest(n).height - tallest(n + 1).height);
  assert.ok(drops.every((drop) => drop >= 0 && drop <= Math.max(...SHARD) / 2));
  assert.ok(tallest(OGRE_STEPS.slam - 1).height <= SHARD.at(-1)! + 1);
  // None before the hammer lands or once it has risen, and none for any other anim.
  assert.equal(tallest(0).drawn, 0);
  assert.equal(tallest(OGRE_STEPS.slam).drawn, 0);
  for (const anim of ["recover", "sweep", "windup", "idle"] as const)
    assert.equal(tallest(8, anim).drawn, 0, anim);
});

test("an enraged twin's steam rises from its crown on either facing, and the effects never throw on odd input", () => {
  const big = toView(ogre(party("brakka"), 60, { enraged: true })).enemies[0]!;
  for (const facing of [1, -1] as const) {
    const { pen, fills } = recorder();
    const crown = OGRE_CROWNS.idle;
    drawSteam(pen, { ...big, facing }, crown, 0, 5);
    assert.ok(fills.length > 0);
    const head = Math.floor(big.x) + facing * crown[0];
    for (const f of fills) {
      assert.ok(Math.abs(f.x - head) <= 12, `${f.x} vs ${head}`);
      assert.ok(f.y <= Math.floor(big.y) + crown[1] + 2);
    }
  }
  // Every frame's crown is on the head, above the shoulders' height of a standing frame and the floor.
  for (const frame of FRAMES) assert.ok(OGRE_CROWNS[frame][1] < -20, frame);
  const { pen, fills } = recorder();
  const odd = [Number.NaN, Infinity, -Infinity, -5, 1e12, 2.5];
  for (const value of odd) {
    const weird = { ...big, anim: "slam" as const, animStep: value, x: value };
    drawCracks(pen, [weird], value);
    drawShards(pen, [weird], 0);
    // A slam mid-wave with its place or the camera not a sane number draws nothing off screen, or throws.
    for (const lost of [{ x: value }, { y: value }, { facing: value as 1 }])
      for (const camX of [0, value]) {
        const placed = slamming({ ...big, ...lost }, 12);
        drawCracks(pen, [placed], camX);
        drawShards(pen, [placed], camX);
      }
    drawSteam(
      pen,
      { ...big, x: value, z: value },
      [value, value],
      value,
      value,
    );
  }
  // Whatever was drawn lies on the 320 × 180 screen.
  assert.ok(fills.length > 0);
  for (const f of fills)
    assert.ok(
      f.x >= 0 && f.y >= 0 && f.x + f.w <= VIEW_W && f.y + f.h <= VIEW_H,
      JSON.stringify(f),
    );
});

import test from "node:test";
import assert from "node:assert/strict";
import { SUB, WALK } from "../src/engine/tuning.js";
import { HERO_FRAMES, WALK_STEPS } from "../src/render/art/animate.js";
import {
  BRAKKA_POSES,
  paintBrakka,
  paintBrakkaPortrait,
} from "../src/render/art/brakka.js";
import { HEROES } from "../src/render/art/index.js";
import { bend, breath } from "../src/render/pixel/kit.js";
import {
  CLEAR,
  validateSprite,
  type Sprite,
} from "../src/render/pixel/sprite.js";
import {
  createSpriteBaker,
  type MakeSurface,
  type PixelPaint,
} from "../src/render/pixel/surface.js";

const heroes = Object.entries(HEROES).map(([kind, art]) => ({ kind, ...art! }));
/** The sprite's rows from `top` above its anchor to `bottom` below, `left` and `right` of it, as text. */
type Span = readonly [number, number];
const around = (s: Sprite, [left, right]: Span, [top, bottom]: Span) =>
  Array.from({ length: top + bottom + 1 }, (_, j) =>
    Array.from(
      { length: left + right + 1 },
      (_, i) => s.rows[s.ay - top + j]?.[s.ax - left + i] ?? CLEAR,
    ).join(""),
  );

/** A surface that only counts what it is given, for the baker's validation. */
const make: MakeSurface<null> = () => {
  const paint: PixelPaint = { fillStyle: "", fillRect: () => undefined };
  return { image: null, paint };
};

test("every hero paints every frame inside its canvas, with its anchor on its feet's bottom rows", () => {
  const baker = createSpriteBaker(make);
  for (const { figure, portrait } of heroes) {
    assert.deepEqual(figure.frames, HERO_FRAMES);
    for (const frame of HERO_FRAMES) {
      const sprite = figure.sprite(frame);
      validateSprite(sprite);
      // The floor is the anchor's row; at most the outline and a hanging toe reach below it.
      assert.ok(sprite.h - 1 - sprite.ay <= 3, `${frame} hangs below its feet`);
      for (const swap of Object.values(figure.swaps))
        baker.bake(sprite, { swap });
    }
    assert.deepEqual([portrait.w, portrait.h], [16, 16]);
    for (const swap of Object.values(figure.swaps))
      baker.bake(portrait, { swap, flash: true });
  }
  assert.deepEqual(paintBrakkaPortrait(), heroes[0]!.portrait);
});

test("the feet stay planted: idle breathes and every swing of the combo turns above the same soles", () => {
  for (const { figure } of heroes) {
    const soles = (frame: (typeof HERO_FRAMES)[number]) =>
      around(figure.sprite(frame), [16, 14], [2, 1]);
    assert.deepEqual(soles("idle1"), soles("idle0"));
    assert.notDeepEqual(
      figure.sprite("idle1").rows,
      figure.sprite("idle0").rows,
    );
    const combo = HERO_FRAMES.filter((f) => /^(windup|strike|follow)/.test(f));
    assert.equal(combo.length, 9);
    for (const frame of combo)
      assert.deepEqual(soles(frame), soles("windup1"), frame);
  }
});

test("a planted foot keeps pace with the ground through the walk, at Brakka's walking speed", () => {
  const pace = (WALK.brakka.x / SUB) * WALK_STEPS.brakka;
  const cycle = ["walk0", "walk1", "walk2", "walk3", "walk4", "walk5"] as const;
  const walk = [...cycle, cycle[0]].map((frame) => BRAKKA_POSES[frame]);
  const ground = (i: number, side: "near" | "far") =>
    walk[i]![side].ankle[0] + i * pace;
  // The near foot is down from frame 0 to 3 and the far foot from 3 to the next cycle's 0.
  for (const i of [1, 2, 3])
    assert.ok(Math.abs(ground(i, "near") - ground(0, "near")) < 1e-9);
  for (const i of [4, 5, 6])
    assert.ok(Math.abs(ground(i, "far") - ground(3, "far")) < 1e-9);
  const floor = walk[0]!.near.ankle[1];
  assert.ok(walk[1]!.far.ankle[1] < floor && walk[4]!.near.ankle[1] < floor);
});

test("a limb bends at the middle joint the way it is told, and straightens out of reach", () => {
  const knee = bend([0, 0], [0, 10], 6, 6, 1);
  assert.ok(knee[0] > 3 && Math.abs(knee[1] - 5) < 1e-9);
  const elbow = bend([0, 0], [0, 10], 6, 6, -1);
  assert.deepEqual(elbow, [-knee[0], knee[1]]);
  assert.deepEqual(bend([0, 0], [0, 30], 6, 4, 1), [0, 6]);
  assert.ok(bend([2, 2], [2, 2], 3, 3, 1).every(Number.isFinite));
  const { idle0 } = BRAKKA_POSES;
  const out = breath(idle0, 2);
  assert.deepEqual(
    [out.head, out.waist, out.near?.hand],
    [
      [idle0.head[0], idle0.head[1] + 2],
      [idle0.waist[0], idle0.waist[1] + 1],
      [idle0.near.hand[0], idle0.near.hand[1] + 2],
    ],
  );
});

test("a hero frame paints the same rows every time", () => {
  for (const frame of HERO_FRAMES)
    assert.deepEqual(
      paintBrakka(BRAKKA_POSES[frame]),
      paintBrakka(BRAKKA_POSES[frame]),
    );
});

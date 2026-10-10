import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { HERO_KINDS, SUB, WALK } from "../src/engine/tuning.js";
import { HERO_FRAMES, WALK_STEPS } from "../src/render/art/animate.js";
import {
  BRAKKA,
  BRAKKA_PORTRAIT,
  BRAKKA_POSES,
  paintBrakka,
  paintBrakkaPortrait,
} from "../src/render/art/brakka.js";
import {
  GORM_POSES,
  paintGorm,
  paintGormPortrait,
} from "../src/render/art/gorm.js";
import { HEROES } from "../src/render/art/index.js";
import {
  paintRhea,
  paintRheaPortrait,
  RHEA,
  RHEA_PORTRAIT,
  RHEA_POSES,
} from "../src/render/art/rhea.js";
import { turn } from "../src/render/pixel/head.js";
import type { Palette } from "../src/render/pixel/palette.js";
import { armTo, bend, breath, legTo } from "../src/render/pixel/kit.js";
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

const heroes = HERO_KINDS.map((kind) => ({ kind, ...HEROES[kind] }));
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
  // Every hero has art, and nothing else does.
  assert.deepEqual(Object.keys(HEROES).sort(), [...HERO_KINDS].sort());
  assert.deepEqual(paintBrakkaPortrait(), HEROES.brakka.portrait);
  assert.deepEqual(paintRheaPortrait(), HEROES.rhea.portrait);
  assert.deepEqual(paintGormPortrait(), HEROES.gorm.portrait);
});

test("Brakka and Rhea paint the same pixels whatever the shared kit gains", () => {
  const pinned = [
    [
      BRAKKA,
      BRAKKA_PORTRAIT,
      "Brakka",
      "d5aa2a86712a9dddf3be9ca849179fc8786bfc36ddcd9275363110985c08485c",
    ],
    [
      RHEA,
      RHEA_PORTRAIT,
      "Rhea",
      "2f5d857e0e2737a2292874d1bd20405fa071bab7f86544b2e2ac8a42b69e1edd",
    ],
  ] as const;
  for (const [figure, portrait, name, hash] of pinned) {
    const art = {
      frames: HERO_FRAMES.map((frame) => figure.sprite(frame)),
      portrait,
      swaps: figure.swaps,
    };
    assert.equal(
      createHash("sha256").update(JSON.stringify(art)).digest("hex"),
      hash,
      `${name}'s pixels changed. If a pose, a colour or the shared head, kit or portrait code was meant to change ` +
        "them, look at the lab's sheet and refresh this hash; a refactor or a new part must not change them.",
    );
  }
});

test("a hero's five looks are told apart from each other, in its frames and its portrait", () => {
  for (const { kind, figure, portrait } of heroes) {
    const looks = [{}, ...Object.values(figure.swaps)];
    assert.equal(looks.length, 5, kind);
    for (const sprite of [figure.sprite("idle0"), portrait]) {
      // Of the pixels the sprite draws, a tenth or more change colour between any two looks: told apart at a glance.
      const drawn = [...sprite.rows.join("")].filter((key) => key !== CLEAR);
      const colour = (swap: Palette, key: string) =>
        swap[key] ?? sprite.palette[key];
      for (const [i, a] of looks.entries())
        for (const [j, b] of looks.entries()) {
          if (j <= i) continue;
          const apart = drawn.filter(
            (key) => colour(a, key) !== colour(b, key),
          );
          assert.ok(
            apart.length / drawn.length >= 0.1,
            `${kind}: looks ${i} and ${j} differ in ${apart.length} of ${drawn.length} pixels`,
          );
        }
    }
  }
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

test("a planted foot keeps pace with the ground through the walk, at each hero's own walking speed", () => {
  for (const { kind, poses } of heroes) {
    const pace = (WALK[kind].x / SUB) * WALK_STEPS[kind];
    const cycle = [
      ...["walk0", "walk1", "walk2", "walk3", "walk4", "walk5"],
    ] as const;
    const walk = [...cycle, cycle[0]].map((frame) => poses[frame]);
    const ground = (i: number, side: "near" | "far") =>
      walk[i]![side].ankle[0] + i * pace;
    // The near foot is down from frame 0 to 3 and the far foot from 3 to the next cycle's 0.
    for (const i of [1, 2, 3])
      assert.ok(Math.abs(ground(i, "near") - ground(0, "near")) < 1e-9, kind);
    for (const i of [4, 5, 6])
      assert.ok(Math.abs(ground(i, "far") - ground(3, "far")) < 1e-9, kind);
    const floor = walk[0]!.near.ankle[1];
    assert.ok(walk[1]!.far.ankle[1] < floor && walk[4]!.near.ankle[1] < floor);
  }
});

test("a limb bends at the middle joint the way it is told, and straightens out of reach", () => {
  const knee = bend([0, 0], [0, 10], 6, 6, 1);
  assert.ok(knee[0] > 3 && Math.abs(knee[1] - 5) < 1e-9);
  const elbow = bend([0, 0], [0, 10], 6, 6, -1);
  assert.deepEqual(elbow, [-knee[0], knee[1]]);
  assert.deepEqual(bend([0, 0], [0, 30], 6, 4, 1), [0, 6]);
  assert.ok(bend([2, 2], [2, 2], 3, 3, 1).every(Number.isFinite));
  assert.ok(bend([1, 1], [4, 5], 0, 0, 1).every(Number.isFinite));
  // Closer than the bones' difference, the limb folds as far as it goes and its upper bone keeps its length.
  for (const [upper, lower] of [
    [6, 2],
    [2, 6],
  ] as const)
    assert.ok(
      Math.abs(Math.hypot(...bend([0, 0], [0, 1], upper, lower, 1)) - upper) <
        1e-9,
    );
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
  for (const frame of HERO_FRAMES) {
    assert.deepEqual(
      paintBrakka(BRAKKA_POSES[frame]),
      paintBrakka(BRAKKA_POSES[frame]),
    );
    assert.deepEqual(
      paintRhea(RHEA_POSES[frame]),
      paintRhea(RHEA_POSES[frame]),
    );
    assert.deepEqual(
      paintGorm(GORM_POSES[frame]),
      paintGorm(GORM_POSES[frame]),
    );
  }
});

test("a limb set from its ends keeps its bones, and the body's frame turns with the body", () => {
  const { near } = RHEA_POSES.idle0;
  const length = (a: readonly number[], b: readonly number[]) =>
    Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const [upper, lower] = [
    length(near.shoulder, near.elbow),
    length(near.elbow, near.hand),
  ];
  const [thigh, shin] = [
    length(near.hip, near.knee),
    length(near.knee, near.ankle),
  ];
  // Within reach both bones keep their lengths, whichever way the end lies.
  for (const hand of [
    [9, 3],
    [0, 9],
    [-6, 4],
  ] as const) {
    const arm = armTo(near, [0, 0], hand);
    assert.ok(same(length(arm.shoulder, arm.elbow), upper));
    assert.ok(same(length(arm.elbow, arm.hand), lower));
    assert.deepEqual(arm.hand, hand);
  }
  for (const ankle of [
    [2, 16],
    [-3, 14],
  ] as const) {
    const leg = legTo(near, [0, 0], ankle);
    assert.ok(same(length(leg.hip, leg.knee), thigh));
    assert.ok(same(length(leg.knee, leg.ankle), shin));
  }
  // An arm reaching forward bends its elbow below the reach, one told otherwise above it; a knee bends forward.
  const reach = armTo(near, [0, 0], [9, 3]);
  assert.ok(reach.elbow[1] > 1);
  assert.ok(armTo(near, [0, 0], [9, 3], 1).elbow[1] < 1);
  assert.ok(legTo(near, [0, 0], [2, 16]).knee[0] > 1);
  // Out of reach the limb straightens toward its end, the upper bone intact and the end where it was told.
  const straight = armTo(near, [0, 0], [30, 0]);
  assert.ok(same(length(straight.shoulder, straight.elbow), upper));
  assert.ok(same(straight.elbow[1], 0) && straight.elbow[0] > 0);
  assert.deepEqual(straight.hand, [30, 0]);
  // At the root, at full stretch and in a bone's fold the joints stay numbers.
  for (const end of [
    [0, 0],
    [upper + lower, 0],
    [0.5, 0],
  ] as const)
    for (const joint of [
      ...Object.values(armTo(near, [0, 0], end)),
      ...Object.values(legTo(near, [0, 0], end)),
    ])
      assert.ok(joint.every(Number.isFinite));
  assert.deepEqual(turn()([3, 4], 1, 2), [4, 6]);
  const lying = turn(-90)([3, 4], 0, 5);
  assert.ok(same(lying[0], 8) && same(lying[1], 4));
});

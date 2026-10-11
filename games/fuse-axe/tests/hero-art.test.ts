import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { HERO_KINDS, RUN, SUB, WALK } from "../src/engine/tuning.js";
import {
  HERO_FRAMES,
  RUN_STEPS,
  WALK_STEPS,
  type HeroFrame,
} from "../src/render/art/animate.js";
import {
  BRAKKA,
  BRAKKA_PORTRAIT,
  BRAKKA_POSES,
  paintBrakka,
  paintBrakkaPortrait,
} from "../src/render/art/brakka.js";
import {
  GORM,
  GORM_PORTRAIT,
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
import { headTurn, turn } from "../src/render/pixel/head.js";
import { MASTER, type Palette } from "../src/render/pixel/palette.js";
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

/** The frames every hero had before its moves had their own, pinned apart so that new frames leave their pixels be. */
const FIRST_FRAMES = HERO_FRAMES.slice(0, HERO_FRAMES.indexOf("run0"));
const MOVE_FRAMES = HERO_FRAMES.slice(FIRST_FRAMES.length);

test("every hero paints the same pixels whatever the shared kit gains", () => {
  const pinned = [
    [
      BRAKKA,
      BRAKKA_PORTRAIT,
      "Brakka",
      "13adc2440bb0a14c3f86952d201aead2cd2a07380db6d8e1e91159681cf011a6",
      "f2c3b9e348626d22708b53065f7ab88fccd8833122904a340077d0f383657768",
    ],
    [
      RHEA,
      RHEA_PORTRAIT,
      "Rhea",
      "1c1f4a00f64bb228aa0186104628c779a21d1e8288937bfb47ff6c9670066d5f",
      "5743af9eb6e30b252a112a6a9cc2eaa07cffc6fa04320cd88d596c6193771dbe",
    ],
    [
      GORM,
      GORM_PORTRAIT,
      "Gorm",
      "733cf43f939085b4dea152aad9d54ab0aadfa3cc397cbb9dc697d7932f81c6f6",
      "9f4bf23e121c5d3f603682355a99ca10fe59491531d87f70bb3a8dd613b2ab79",
    ],
  ] as const;
  assert.equal(FIRST_FRAMES.length, 26);
  const digest = (art: unknown) =>
    createHash("sha256").update(JSON.stringify(art)).digest("hex");
  for (const [figure, portrait, name, first, moves] of pinned) {
    const sprites = (frames: readonly HeroFrame[]) =>
      frames.map((frame) => figure.sprite(frame));
    const art = {
      frames: sprites(FIRST_FRAMES),
      portrait,
      swaps: figure.swaps,
    };
    assert.deepEqual(
      [digest(art), digest(sprites(MOVE_FRAMES))],
      [first, moves],
      `${name}'s pixels changed. If a pose, a colour or the shared head, kit or portrait code was meant to change ` +
        "them, look at the lab's sheet and refresh the hash; a refactor or a new part must not change them.",
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

test("Gorm's second and fourth looks trade his steel and bronze both ways; his other looks keep his metal", () => {
  const { figure } = HEROES.gorm;
  const drawn = figure.sprite("idle0").rows.join("");
  const shows = (ramp: string) => [...ramp].some((key) => drawn.includes(key));
  // The helm and axe are steel, the rim, buckle and pad bronze: a one-way swap would leave one of them as it was.
  assert.ok(shows("Mm7") && shows("Nn8"));
  const colour = (swap: Palette, key: string) => swap[key] ?? MASTER[key];
  const { second, third, fourth, fifth } = figure.swaps;
  for (const swap of [second!, fourth!])
    for (const [steel, bronze] of [
      ["M", "N"],
      ["m", "n"],
      ["7", "8"],
    ] as const) {
      assert.equal(colour(swap, steel), MASTER[bronze]);
      assert.equal(colour(swap, bronze), MASTER[steel]);
    }
  for (const swap of [third!, fifth!])
    for (const key of "MmNn78") assert.equal(colour(swap, key), MASTER[key]);
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

test("the moves keep the feet down: the back attack and the throw turn above the combo's soles, and the dash and the run land on the floor", () => {
  for (const { kind, figure, poses } of heroes) {
    const soles = (frame: HeroFrame) =>
      around(figure.sprite(frame), [16, 14], [2, 1]);
    const planted = [
      ...["backwindup", "backstrike", "backfollow"],
      ...["grab", "heave", "toss"],
    ] as const;
    for (const frame of planted)
      assert.deepEqual(soles(frame), soles("windup1"), `${kind} ${frame}`);
    // The lower foot stands on the floor the idle stands on, and the sprite reaches as far below its anchor.
    const floor = poses.idle0.near.ankle[1];
    const below = (frame: HeroFrame) => {
      const sprite = figure.sprite(frame);
      return sprite.h - 1 - sprite.ay;
    };
    const grounded = HERO_FRAMES.filter((f) => /^(run\d|dash)/.test(f));
    assert.equal(grounded.length, 8);
    for (const frame of grounded) {
      const { far, near } = poses[frame];
      assert.equal(Math.max(far.ankle[1], near.ankle[1]), floor, frame);
      assert.equal(below(frame), below("idle0"), `${kind} ${frame}`);
    }
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

test("a planted foot keeps pace with the ground through the run, at each hero's own running speed, and is off it otherwise", () => {
  for (const { kind, poses } of heroes) {
    const pace = (RUN[kind] / SUB) * RUN_STEPS[kind];
    const cycle = ["run0", "run1", "run2", "run3", "run4", "run5"] as const;
    const run = cycle.map((frame) => poses[frame]);
    const floor = poses.idle0.near.ankle[1];
    const ground = (i: number, side: "near" | "far") =>
      run[i]![side].ankle[0] + i * pace;
    // The near foot is down on frames 0 to 2 and the far one on 3 to 5; each swings through the air the rest.
    for (const side of ["near", "far"] as const)
      for (const i of [0, 1, 2, 3, 4, 5]) {
        const first = side === "near" ? 0 : 3;
        const ankle = run[i]![side].ankle;
        if (i < first || i > first + 2)
          assert.ok(ankle[1] < floor - 2, `${kind} ${side} ${i}`);
        else {
          assert.equal(ankle[1], floor, `${kind} ${side} ${i}`);
          assert.ok(Math.abs(ground(i, side) - ground(first, side)) < 1e-9);
        }
      }
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
  // Looking back over the shoulder the head's frame is mirrored front to back; otherwise it is the body's own.
  const body = turn();
  const pose = BRAKKA_POSES.idle0;
  assert.equal(headTurn(pose, body), body);
  assert.deepEqual(
    headTurn({ ...pose, lookBack: true }, body)([3, 4], 1, 2),
    [2, 6],
  );
  const lying = turn(-90)([3, 4], 0, 5);
  assert.ok(same(lying[0], 8) && same(lying[1], 4));
});

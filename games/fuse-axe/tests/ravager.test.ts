import test from "node:test";
import assert from "node:assert/strict";
import {
  paintRavager,
  RAVAGER,
  RAVAGER_ANIMS,
  RAVAGER_POSES,
  RAVAGER_TIERS,
  type RavagerFrame,
} from "../src/render/art/ravager.js";
import { MASTER, OUTLINE } from "../src/render/pixel/palette.js";
import {
  CLEAR,
  swapPalette,
  validateSprite,
  type Sprite,
} from "../src/render/pixel/sprite.js";
import {
  createSpriteBaker,
  type MakeSurface,
  type PixelPaint,
} from "../src/render/pixel/surface.js";

const sprite = (frame: RavagerFrame) => RAVAGER.sprite(frame);
const FRAMES = RAVAGER.frames;
const STANDING: readonly RavagerFrame[] = [
  "idle",
  "breathe",
  "walk1",
  "walk2",
  "walk3",
  "walk4",
  "windup",
  "attack",
  "recover",
  "hurt",
];
/** The frames the ravager plants its feet through: standing still, and the whole attack. */
const PLANTED: readonly RavagerFrame[] = [
  "idle",
  "breathe",
  "windup",
  "attack",
  "recover",
];

/** The key at (dx, dy) from the feet anchor, clear off the sprite. */
const fromFeet = (s: Sprite, dx: number, dy: number) =>
  s.rows[s.ay + dy]?.[s.ax + dx] ?? CLEAR;
/** Every opaque pixel as an offset from the feet anchor. */
const silhouette = (s: Sprite) =>
  new Set(
    s.rows.flatMap((row, y) =>
      [...row].flatMap((key, x) =>
        key === CLEAR ? [] : [`${x - s.ax},${y - s.ay}`],
      ),
    ),
  );

test("every frame is a valid sprite in every tier, painted inside its canvas", () => {
  assert.deepEqual(FRAMES, Object.keys(RAVAGER_POSES));
  for (const frame of FRAMES) {
    const pose = RAVAGER_POSES[frame];
    // Painting throws if anything reaches the canvas's outermost pixels, so a frame that paints fits its canvas.
    const painted = paintRavager(pose);
    validateSprite(painted);
    assert.ok(painted.w <= pose.size[0] - 2 && painted.h <= pose.size[1] - 2);
    for (const swap of Object.values(RAVAGER.swaps))
      validateSprite(swapPalette(painted, swap));
  }
  // A foot soldier about 32 wide and 48 tall, the mace and the crest aside.
  const idle = sprite("idle");
  assert.ok(idle.h >= 46 && idle.h <= 52, `idle is ${idle.h} tall`);
  // The anchor is on the feet's bottom row, with only the outline under it.
  const floor = (s: Sprite) => s.h - 2;
  for (const frame of STANDING)
    assert.equal(sprite(frame).ay, floor(sprite(frame)), frame);
  // Lying flat is wider than tall, and the body in the air comes down on its anchor's row.
  const down = sprite("down");
  assert.ok(down.w > down.h * 2, `down is ${down.w}×${down.h}`);
  assert.equal(sprite("knockdown").ay, floor(sprite("knockdown")));
});

test("the face shows its eye glinting under the helm, shut when hurt", () => {
  for (const frame of FRAMES) {
    const keys = new Set(sprite(frame).rows.join(""));
    const hurt = ["hurt", "knockdown", "down"].includes(frame);
    assert.equal(keys.has("D"), !hurt, frame);
  }
});

test("the feet stay planted, on the anchor, while it stands and through the whole attack", () => {
  const feet = (s: Sprite) =>
    Array.from({ length: 5 }, (_, j) =>
      Array.from({ length: 31 }, (_, i) =>
        fromFeet(s, i - 15, j - 4) === CLEAR ? "." : "#",
      ).join(""),
    );
  const idle = feet(sprite("idle"));
  // Both boots on the floor row, the anchor between them.
  assert.match(idle[4]!, /#+\.+#+/);
  assert.equal(fromFeet(sprite("idle"), 0, 1), CLEAR);
  for (const frame of PLANTED)
    assert.deepEqual(feet(sprite(frame)), idle, frame);
});

test("the windup telegraphs: the mace rises over the head, then sweeps out front in a smear", () => {
  const [idle, windup, attack] = [
    sprite("idle"),
    sprite("windup"),
    sprite("attack"),
  ];
  const top = (s: Sprite) => s.ay;
  const reach = (s: Sprite) => s.w - 1 - s.ax;
  // The mace head is the highest thing in the windup, well over the crest; in the attack it is the furthest forward.
  assert.ok(top(windup) >= top(idle) + 10);
  const highest = windup.rows.find((row) => /[^.k]/.test(row))!;
  assert.match(highest, /^[.kMm7]+$/);
  assert.ok(reach(attack) >= reach(idle) + 8);
  // The smear's white-hot rim and gold body; the eye glows too, but in yellow.
  const smear = (s: Sprite) => /[ZFf]/.test(s.rows.join(""));
  assert.deepEqual([smear(windup), smear(attack)], [false, true]);
  // Laid over each other on the feet, the windup's silhouette stands apart from the idle it starts from and from the
  // blow it leads to, where a breath changes almost nothing.
  const overlap = (p: Sprite, q: Sprite) => {
    const [a, b] = [silhouette(p), silhouette(q)];
    return [...a].filter((at) => b.has(at)).length / new Set([...a, ...b]).size;
  };
  assert.ok(overlap(idle, sprite("breathe")) > 0.85);
  assert.ok(overlap(idle, windup) < 0.75);
  assert.ok(overlap(windup, attack) < 0.6);
});

/** A 2D context that keeps the colour each pixel was last filled with. */
class FakePaint implements PixelPaint {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  readonly pixels = new Map<string, string>();
  fillRect(x: number, y: number, width: number, height: number) {
    const color = this.fillStyle;
    if (typeof color !== "string") throw new Error("pixels are flat colours");
    for (let j = y; j < y + height; j++)
      for (let i = x; i < x + width; i++) this.pixels.set(`${i},${j}`, color);
  }
}

test("a tier only recolours the tier ramp: the same pixels, the tunic, crest and boots in its colours", () => {
  const make: MakeSurface<FakePaint> = () => {
    const paint = new FakePaint();
    return { image: paint, paint };
  };
  const baker = createSpriteBaker(make);
  const TIER = ["A", "a", "$"];
  assert.deepEqual(Object.keys(RAVAGER.swaps), ["rust", "violet"]);
  assert.equal(RAVAGER.swaps, RAVAGER_TIERS);
  for (const swap of Object.values(RAVAGER_TIERS)) {
    assert.deepEqual(Object.keys(swap).sort(), [...TIER].sort());
    for (const key of TIER) assert.notEqual(swap[key], MASTER[key]);
  }
  for (const frame of FRAMES) {
    const s = sprite(frame);
    for (const key of TIER) assert.ok(s.rows.join("").includes(key), frame);
    const ash = baker.bake(s).image.pixels;
    for (const [tier, swap] of Object.entries(RAVAGER_TIERS)) {
      const tinted = baker.bake(s, { swap }).image.pixels;
      assert.deepEqual([...tinted.keys()], [...ash.keys()], `${frame} ${tier}`);
      for (const [at, color] of tinted) {
        const [x, y] = at.split(",").map(Number);
        const key = s.rows[y!]![x!]!;
        assert.equal(color, TIER.includes(key) ? swap[key] : ash.get(at));
      }
    }
  }
});

test("a pose paints the same rows every time, and the figure paints each frame once", () => {
  for (const frame of FRAMES) {
    assert.deepEqual(
      paintRavager(RAVAGER_POSES[frame]),
      paintRavager(RAVAGER_POSES[frame]),
    );
    assert.equal(sprite(frame), sprite(frame));
  }
  assert.ok(sprite("idle").rows.join("").includes(OUTLINE));
});

test("every anim plays frames the figure has, for whole steps, and every frame is played", () => {
  // The enemy view's anims, and the ones the enemy AI adds; `dead` lies in the `down` frame while it blinks.
  assert.deepEqual(Object.keys(RAVAGER_ANIMS).sort(), [
    "attack",
    "dead",
    "down",
    "getup",
    "hurt",
    "idle",
    "knockdown",
    "recover",
    "walk",
    "windup",
  ]);
  const played = new Set<string>();
  for (const [anim, { frames, loop }] of Object.entries(RAVAGER_ANIMS)) {
    assert.ok(frames.length > 0, anim);
    for (const [frame, steps] of frames) {
      assert.ok(FRAMES.includes(frame), `${anim} plays ${frame}`);
      assert.ok(Number.isInteger(steps) && steps > 0, `${anim} ${frame}`);
      played.add(frame);
    }
    assert.equal(loop, anim === "idle" || anim === "walk", anim);
  }
  assert.deepEqual(
    RAVAGER_ANIMS.dead.frames.map(([frame]) => frame),
    ["down"],
  );
  assert.deepEqual(
    RAVAGER_ANIMS.walk.frames.map(([frame]) => frame),
    ["walk1", "walk2", "walk3", "walk4"],
  );
  assert.deepEqual([...played].sort(), [...FRAMES].sort());
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  createWorld,
  spawnEnemy,
  step,
  toView,
  type EnemyAnim,
  type World,
} from "../src/engine/index.js";
import { px } from "../src/engine/tuning.js";
import { ENEMY_STATES } from "../src/engine/view-kit.js";
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
  // The anchor is on the lowest row of every frame, the kneeling and the fallen included (boots, body or mace), with
  // only the outline under it, so no frame sinks into the floor line or hovers above it.
  for (const frame of FRAMES) {
    const s = sprite(frame);
    assert.equal(s.ay, s.h - 2, frame);
  }
  // Lying flat is wider than tall.
  const down = sprite("down");
  assert.ok(down.w > down.h * 2, `down is ${down.w}×${down.h}`);
});

test("the face shows its eye glinting under the helm, shut when hurt", () => {
  const SKIN = ["S", "s", "1"];
  for (const frame of FRAMES) {
    const { rows } = sprite(frame);
    const keys = new Set(rows.join(""));
    const hurt = ["hurt", "knockdown", "down"].includes(frame);
    assert.equal(keys.has("D"), !hurt, frame);
    // The glint is stamped where the rotated head puts it: among the face's skin, whatever the head's tilt.
    rows.forEach((row, y) => {
      const x = row.indexOf("D");
      if (x < 0) return;
      const around = [-1, 0, 1].flatMap((dy) =>
        [-1, 0, 1].map((dx) => rows[y + dy]?.[x + dx] ?? CLEAR),
      );
      assert.ok(around.filter((key) => SKIN.includes(key)).length >= 3, frame);
    });
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
  // Each tier's three colours differ from the other's too, so no two tiers are alike at 1×.
  const { rust, violet } = RAVAGER_TIERS;
  for (const key of TIER) assert.notEqual(rust[key], violet[key], key);
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
  // Every anim the enemy view can show, and the ones the enemy AI adds; `dead` lies in the `down` frame while it blinks.
  assert.deepEqual(
    Object.keys(RAVAGER_ANIMS).sort(),
    [...ENEMY_STATES, "walk", "windup", "attack", "recover"].sort(),
  );
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

/** The most `animStep` the enemy view reaches in each anim over `steps` steps of a scripted fight. */
function reached(
  start: World,
  held: (index: number, world: World) => number,
  steps: number,
): Map<EnemyAnim, number> {
  const peaks = new Map<EnemyAnim, number>();
  let world = start;
  for (let index = 0; index < steps; index++) {
    world = step(world, [held(index, world)]);
    for (const { anim, animStep } of toView(world).enemies)
      peaks.set(anim, Math.max(peaks.get(anim) ?? 0, animStep));
  }
  return peaks;
}

test("a state anim lasts exactly as many steps as the engine keeps the enemy in that state", () => {
  const length = (anim: EnemyAnim) =>
    RAVAGER_ANIMS[anim].frames.reduce((sum, [, steps]) => sum + steps, 0);
  /** Brakka with a ravager 18 px in front of it, at `hp` if given. */
  const arena = (hp?: number): World => {
    const world = createWorld({
      seed: 3,
      heroes: [{ seat: 0, kind: "brakka" }],
    });
    const { x, y } = world.heroes[0]!;
    const fight = spawnEnemy(world, "ravager", x + px(18), y);
    return hp === undefined
      ? fight
      : { ...fight, enemies: fight.enemies.map((e) => ({ ...e, hp })) };
  };
  const swingOnce = (index: number) => (index === 0 ? ATTACK : 0);
  // One slash lands and the enemy reels, then stands.
  const reeled = reached(arena(), swingOnce, 120);
  // Mashed to the finisher, it knocks the enemy up: it flies, lies, gets up and stands.
  const finished = reached(
    arena(),
    (index, world) =>
      world.heroes[0]!.state !== "attack3" && index % 2 === 0 ? ATTACK : 0,
    400,
  );
  // The blow that takes the last hp: the enemy flies, lands dead, blinks and is gone.
  const killed = reached(arena(3), swingOnce, 200);
  // The last step an anim shows is the one before its state ends, so it lasts one more than that.
  const lasts: readonly (readonly [EnemyAnim, Map<EnemyAnim, number>])[] = [
    ["hurt", reeled],
    ["knockdown", finished],
    ["down", finished],
    ["getup", finished],
    ["dead", killed],
  ];
  for (const [anim, peaks] of lasts) {
    assert.ok(peaks.has(anim), `the fight never reached ${anim}`);
    assert.equal(peaks.get(anim)! + 1, length(anim), anim);
  }
});

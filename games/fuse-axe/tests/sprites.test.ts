import test from "node:test";
import assert from "node:assert/strict";
import { HERO_FRAMES } from "../src/render/art/animate.js";
import { FIGURES } from "../src/render/art/index.js";
import { BRAKKA, BRAKKA_POSES, paintBrakka } from "../src/render/art/brakka.js";
import { adjust, arm, fist, leg } from "../src/render/pixel/kit.js";
import {
  glows,
  MASTER,
  OUTLINE,
  RAMPS,
  rampSwap,
  shade,
  UNLIT,
} from "../src/render/pixel/palette.js";
import { Rig, type Point } from "../src/render/pixel/rig.js";
import {
  CLEAR,
  cropSprite,
  flashPalette,
  flipSprite,
  swapPalette,
  validateSprite,
  type Sprite,
} from "../src/render/pixel/sprite.js";
import {
  createSpriteBaker,
  type MakeSurface,
  type PixelPaint,
} from "../src/render/pixel/surface.js";

const PALETTE = { a: "#102030", b: "#405060" };
const sprite = (rows: string[], ax = 0, ay = rows.length - 1): Sprite => ({
  w: rows[0]!.length,
  h: rows.length,
  ax,
  ay,
  palette: PALETTE,
  rows,
});
const at = (s: Sprite, x: number, y: number) => s.rows[y]?.[x] ?? CLEAR;
/** Where every key sits, as [x, y] lists. */
const where = (s: Sprite, key: string) =>
  s.rows.flatMap((row, y) =>
    [...row].flatMap((k, x) => (k === key ? [[x, y] as const] : [])),
  );
/** Reads a cropped sprite in the coordinates of the canvas it was painted on, through its anchor there. */
const onCanvas =
  (s: Sprite, [x0, y0]: Point) =>
  (x: number, y: number) =>
    at(s, x - x0 + s.ax, y - y0 + s.ay);
const mean = (points: readonly (readonly [number, number])[], axis: 0 | 1) =>
  points.reduce((sum, p) => sum + p[axis], 0) / points.length;

test("the master palette gives each key one colour, with ramps running light to shadow", () => {
  const ramps = Object.values(RAMPS).flat();
  assert.equal(
    Object.keys(MASTER).length,
    ramps.length * 3 + Object.keys(UNLIT).length,
  );
  assert.deepEqual(
    [shade("s", 0), shade("S", 1), shade("s", 2), shade(OUTLINE, 0)],
    ["S", "s", "1", OUTLINE],
  );
  assert.deepEqual(["F", "Z", OUTLINE, "S", "?"].map(glows), [
    true,
    true,
    false,
    false,
    false,
  ]);
  assert.deepEqual(rampSwap("Aa$", "Tt%"), {
    A: MASTER.T,
    a: MASTER.t,
    $: MASTER["%"],
  });
});

test("every figure's frames and swaps are valid sprites; a bad sprite says what is wrong", () => {
  for (const figure of Object.values(FIGURES))
    for (const frame of figure.frames) {
      validateSprite(figure.sprite(frame));
      for (const swap of Object.values(figure.swaps))
        validateSprite(swapPalette(figure.sprite(frame), swap));
    }
  const good = sprite(["ab", "ba"]);
  validateSprite(good);
  const bad: [Sprite, RegExp][] = [
    [{ ...good, rows: ["ab", "b"] }, /row 1 is 1 wide, not 2/],
    [{ ...good, h: 3 }, /2 rows for height 3/],
    [{ ...good, rows: ["ab", "bc"] }, /row 1 uses c/],
    [{ ...good, palette: { ...PALETTE, b: "red" } }, /palette entry b: red/],
    [{ ...good, palette: { ...PALETTE, ".": "#000000" } }, /palette entry \./],
    [{ ...good, ax: 2 }, /anchor \(2, 1\) lies outside/],
    [{ ...good, ax: 0.5 }, /anchor \(0\.5, 1\) is not on a pixel/],
  ];
  for (const [sprite, problem] of bad)
    assert.throws(() => validateSprite(sprite), problem);
});

test("a palette swap recolours only the keys the sprite uses", () => {
  const swapped = swapPalette(sprite(["ab"]), { a: "#ffffff", z: "#000000" });
  assert.deepEqual(swapped.palette, { a: "#ffffff", b: "#405060" });
  assert.deepEqual(swapped.rows, ["ab"]);
});

test("flipping mirrors a sprite about its feet anchor", () => {
  const right = BRAKKA.sprite("strike1");
  const left = flipSprite(right);
  assert.equal(left.ay, right.ay);
  assert.notDeepEqual(left.rows, right.rows);
  for (let y = 0; y < right.h; y++)
    for (let d = -right.w; d <= right.w; d++)
      assert.equal(at(left, left.ax + d, y), at(right, right.ax - d, y));
  assert.deepEqual(flipSprite(left), right);
});

test("the damage flash tints every colour toward pink and the outline toward wine", () => {
  assert.deepEqual(flashPalette({ [OUTLINE]: "#150c1f", Z: "#ffffff" }), {
    [OUTLINE]: "#3a0f24",
    Z: "#ffc2c7",
  });
});

test("cropping trims the clear margin and keeps the anchor on its pixel", () => {
  const loose = sprite(["....", ".a..", ".ab.", "...."], 2, 2);
  const tight = cropSprite(loose);
  assert.deepEqual(tight.rows, ["a.", "ab"]);
  assert.deepEqual([tight.ax, tight.ay], [1, 1]);
  assert.equal(at(tight, tight.ax, tight.ay), at(loose, 2, 2));
  const empty = sprite(["..", ".."]);
  assert.equal(cropSprite(empty), empty);
});

test("the rig lights a ball from the upper left into three shades and outlines its silhouette", () => {
  const ball = new Rig(16, 16)
    .ellipse([8, 8], 5, 5, "s")
    .bake()
    .sprite([8, 13]);
  const solid = (x: number, y: number) => at(ball, x, y) !== CLEAR;
  const around = (x: number, y: number) =>
    [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as const;
  for (let y = 0; y < ball.h; y++)
    for (let x = 0; x < ball.w; x++) {
      const key = at(ball, x, y);
      if (key === OUTLINE)
        assert.ok(
          around(x, y).some(
            ([i, j]) => at(ball, i, j) !== OUTLINE && solid(i, j),
          ),
        );
      else if (key !== CLEAR)
        assert.ok(
          around(x, y).every(([i, j]) => solid(i, j)),
          `(${x}, ${y}) is bare`,
        );
    }
  const [lit, shadow] = [where(ball, "S"), where(ball, "1")];
  assert.ok(lit.length && where(ball, "s").length && shadow.length);
  assert.ok(mean(lit, 0) < mean(shadow, 0) && mean(lit, 1) < mean(shadow, 1));
});

test("a shape edges the one behind it in ink, in its shade, or not at all, and a group draws no edge", () => {
  // The back ball's left rim faces the light, so a shade edge shows against its lit pixels.
  type Front = { group?: string; edge?: "ink" | "shade" | "none" };
  const pair = (front: Front) => {
    const rig = new Rig(24, 16).ellipse([14, 8], 5, 5, "s", {
      group: front.group,
    });
    const painted = rig
      .ellipse([7, 8], 5, 5, "s", front)
      .bake()
      .sprite([11, 14]);
    return onCanvas(painted, [11, 14]);
  };
  const ink = pair({});
  const seam = [...Array(24).keys()].filter(
    (x) =>
      ink(x, 8) === OUTLINE &&
      ink(x - 1, 8) !== CLEAR &&
      ink(x + 1, 8) !== CLEAR,
  );
  assert.deepEqual(seam, [12]);
  assert.equal(pair({ edge: "shade" })(12, 8), "1");
  for (const plain of [pair({ edge: "none" }), pair({ group: "g" })])
    assert.match(plain(12, 8), /^[Ss]$/);
});

test("glowing pixels take no outline", () => {
  const smear = {
    center: [12, 12],
    inner: 6,
    outer: 10,
    from: -90,
    to: 0,
  } as const;
  const arc = new Rig(24, 24).smear(smear).bake().sprite([12, 23]);
  assert.ok(where(arc, "F").length && where(arc, "Z").length);
  assert.equal(where(arc, OUTLINE).length, 0);
});

test("a blade is lit on the edge facing the light, whichever way it points", () => {
  for (const [from, to] of [
    [
      [3, 8],
      [21, 8],
    ],
    [
      [21, 8],
      [3, 8],
    ],
  ] as const) {
    const blade = new Rig(24, 16)
      .blade(from, to, 5, "m")
      .bake()
      .sprite([12, 12]);
    const [lit, dark] = [where(blade, "M"), where(blade, "7")];
    assert.ok(lit.length && dark.length);
    assert.ok(
      Math.max(...lit.map((p) => p[1])) < Math.min(...dark.map((p) => p[1])),
    );
  }
});

test("stamps set pixels by hand: a space keeps one, a dot clears it, off the canvas is ignored", () => {
  const ball = () => new Rig(11, 11).ellipse([5.5, 5.5], 4, 4, "s").bake();
  const plain = onCanvas(ball().sprite([5, 10]), [5, 10]);
  const stamped = ball()
    .stamp(4, 4, ["...", "...", "..."])
    .stamp(1, 5, ["3 3"])
    .stamp(-1, -1, ["11"])
    .sprite([5, 10]);
  const px = onCanvas(stamped, [5, 10]);
  // The cleared block is a hole, and its rim takes the outline.
  assert.deepEqual([px(5, 5), px(4, 4)], [CLEAR, OUTLINE]);
  assert.deepEqual([px(1, 5), px(2, 5), px(3, 5)], ["3", plain(2, 5), "3"]);
  assert.throws(
    () => new Rig(4, 4).bake().stamp(1, 1, ["?"]).sprite([1, 3]),
    /\? is not in the master palette/,
  );
});

test("a pose paints the same rows every time, and a figure paints each frame once", () => {
  assert.deepEqual(
    paintBrakka(BRAKKA_POSES.strike1),
    paintBrakka(BRAKKA_POSES.strike1),
  );
  assert.deepEqual(BRAKKA.frames, HERO_FRAMES);
  assert.equal(BRAKKA.sprite("idle0"), BRAKKA.sprite("idle0"));
});

test("adjust moves only the joints it names", () => {
  const { idle0: idle } = BRAKKA_POSES;
  const hand: Point = [50, 40];
  const raised = adjust(idle, { near: { hand }, sword: -40 });
  assert.deepEqual(raised.near, { ...idle.near, hand });
  assert.deepEqual(
    [raised.far, raised.head, raised.sword],
    [idle.far, idle.head, -40],
  );
  assert.notDeepEqual(paintBrakka(raised).rows, BRAKKA.sprite("idle0").rows);
});

test("body parts take their materials from the options", () => {
  const side = BRAKKA_POSES.idle0.near;
  const rig = new Rig(84, 78);
  leg(rig, side, { material: "o", boot: "i", cuff: "w", thick: 1.2 });
  arm(rig, side, { material: "L", bracer: "m", pad: "n" });
  fist(rig, side.hand, { material: "B" });
  const ramps = new Set(
    Object.keys(rig.bake().sprite([36, 74]).palette).map((key) =>
      shade(key, 0),
    ),
  );
  for (const ramp of ["O", "I", "W", "L", "M", "N", "B"])
    assert.ok(ramps.has(ramp), ramp);
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
interface FakeImage {
  readonly width: number;
  readonly height: number;
  readonly paint: FakePaint;
}
const expected = (s: Sprite) =>
  new Map(
    s.rows.flatMap((row, y) =>
      [...row].flatMap((key, x) =>
        key === CLEAR ? [] : [[`${x},${y}`, s.palette[key]!] as const],
      ),
    ),
  );

test("the baker paints a sprite, flipped, swapped or flashing, into surfaces it makes once each", () => {
  const made: FakeImage[] = [];
  const make: MakeSurface<FakeImage> = (width, height) => {
    const image = { width, height, paint: new FakePaint() };
    made.push(image);
    return { image, paint: image.paint };
  };
  const baker = createSpriteBaker(make);
  const slash = BRAKKA.sprite("strike1");
  const plain = baker.bake(slash);
  assert.deepEqual(plain.image.paint.pixels, expected(slash));
  assert.deepEqual(
    [plain.image.width, plain.image.height, plain.ax, plain.ay],
    [slash.w, slash.h, slash.ax, slash.ay],
  );
  const left = baker.bake(slash, { flip: true });
  assert.deepEqual(left.image.paint.pixels, expected(flipSprite(slash)));
  assert.equal(left.ax, slash.w - 1 - slash.ax);
  const swap = BRAKKA.swaps.second!;
  const hurt = baker.bake(slash, { swap, flash: true });
  const palette = flashPalette(swapPalette(slash, swap).palette);
  assert.deepEqual(hurt.image.paint.pixels, expected({ ...slash, palette }));

  assert.equal(made.length, 3);
  assert.equal(baker.bake(slash, {}), plain);
  assert.equal(baker.bake(slash, { flip: true }), left);
  assert.equal(baker.bake(slash, { swap, flash: true }), hurt);
  assert.equal(made.length, 3);
  // The swap's identity keys the cache: an equal copy is a variant of its own.
  assert.notEqual(baker.bake(slash, { swap: { ...swap }, flash: true }), hurt);
  assert.equal(made.length, 4);
  assert.throws(
    () => baker.bake({ ...slash, h: slash.h + 1 }),
    /rows for height/,
  );
  assert.equal(made.length, 4);
});

test("every flip and flash combination is a variant of its own, painted from the right sprite", () => {
  const made: FakeImage[] = [];
  const make: MakeSurface<FakeImage> = (width, height) => {
    const image = { width, height, paint: new FakePaint() };
    made.push(image);
    return { image, paint: image.paint };
  };
  const baker = createSpriteBaker(make);
  const slash = BRAKKA.sprite("strike1");
  const swap = BRAKKA.swaps.second!;
  const variants = [false, true].flatMap((flip) =>
    [false, true].map((flash) => ({ flip, flash })),
  );
  for (const swapped of [false, true]) {
    const options = swapped ? { swap } : {};
    const images = variants.map(({ flip, flash }) => {
      const result = baker.bake(slash, { ...options, flip, flash });
      let art = swapped ? swapPalette(slash, swap) : slash;
      if (flash) art = { ...art, palette: flashPalette(art.palette) };
      if (flip) art = flipSprite(art);
      assert.deepEqual(result.image.paint.pixels, expected(art));
      assert.deepEqual([result.ax, result.ay], [art.ax, art.ay]);
      return result;
    });
    assert.equal(new Set(images).size, 4);
    variants.forEach((variant, i) =>
      assert.equal(baker.bake(slash, { ...options, ...variant }), images[i]),
    );
  }
  assert.equal(made.length, 8);
});

test("the baker rejects a swap that is not a colour, whether or not the sprite flashes", () => {
  let made = 0;
  const baker = createSpriteBaker<null>(() => {
    made++;
    return { image: null, paint: new FakePaint() };
  });
  const slash = BRAKKA.sprite("strike1");
  for (const color of ["red", "#abc", "#12345g"])
    for (const flash of [false, true])
      assert.throws(
        () => baker.bake(slash, { swap: { s: color }, flash }),
        /palette entry s/,
      );
  assert.equal(made, 0);
  // A key the sprite does not use is never painted, so it cannot corrupt anything.
  baker.bake(slash, { swap: { "?": "red" } });
  assert.equal(made, 1);
});

test("a smear sweeps any arc: across straight left, and from the larger angle to the smaller", () => {
  const arc = (from: number, to: number) => {
    const rig = new Rig(25, 25).smear({
      center: [12.5, 12.5],
      inner: 4,
      outer: 10,
      from,
      to,
    });
    const px = onCanvas(rig.bake().sprite([12, 24]), [12, 24]);
    return (x: number, y: number) => px(x, y) !== CLEAR;
  };
  const right = arc(-30, 30);
  const left = arc(150, 210);
  const backwards = arc(30, -30);
  let painted = 0;
  for (let y = 0; y < 25; y++)
    for (let x = 0; x < 25; x++) {
      painted += right(x, y) ? 1 : 0;
      // The left arc is the right one turned half a circle, the backwards one the right one flipped upside down.
      assert.equal(left(24 - x, 24 - y), right(x, y), `left (${x}, ${y})`);
      assert.equal(backwards(x, 24 - y), right(x, y), `back (${x}, ${y})`);
    }
  assert.ok(painted > 20);
  assert.throws(() => arc(40, 40), /sweeps no angle/);
});

test("a blade needs a length, and a blunt tip keeps its full width to the end", () => {
  assert.throws(
    () => new Rig(8, 8).blade([4, 4], [4, 4], 2, "m"),
    /blade needs a length/,
  );
  const lastColumn = (tip?: number) => {
    const painted = new Rig(24, 16)
      .blade([3, 8], [21, 8], 5, "m", { tip })
      .bake()
      .sprite([12, 12]);
    const steel = [...where(painted, "M"), ...where(painted, "7")];
    const end = Math.max(...steel.map(([x]) => x));
    return steel.filter(([x]) => x === end).length;
  };
  assert.ok(lastColumn(0) >= 4);
  assert.ok(lastColumn() < 4);
});

test("a polygon's rim faces outward even where a thin slit runs between two of its sides", () => {
  // Each side of the slit is within a probe's reach of the other, which an inside test would take for the interior.
  const slit: Point[] = [
    [2, 2],
    [14, 2],
    [14, 14],
    [8.1, 14],
    [8.1, 5],
    [7.9, 5],
    [7.9, 14],
    [2, 14],
  ];
  const painted = new Rig(16, 16).poly(slit, "s").bake().sprite([8, 14]);
  const px = onCanvas(painted, [8, 14]);
  // The light comes from the left: the pixel left of the slit turns its back to it, the one right of it faces it.
  const level = (key: string) => ["S", "s", "1"].indexOf(key);
  assert.ok(level(px(7, 10)) > level(px(8, 10)));
});

test("a painting refuses a part drawn onto the canvas edge, where its outline would be cut off", () => {
  const ball = (cx: number, r: number) => () =>
    new Rig(12, 12).ellipse([cx, 6], r, r, "s").bake().sprite([6, 10]);
  assert.doesNotThrow(ball(6, 4));
  assert.throws(ball(6, 6), /canvas edge/);
  assert.throws(ball(1, 4), /canvas edge/);
});

test("a figure says which frame it lacks", () => {
  const unknown: string = "walk";
  assert.throws(() => FIGURES.brakka!.sprite(unknown), /no frame "walk"/);
});

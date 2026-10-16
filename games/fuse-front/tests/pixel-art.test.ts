import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Img } from "../src/render/pixel/image.js";
import { BIOME, type BiomeId } from "../src/render/pixel/palette.js";
import {
  HEROES,
  PORTRAIT_SIZE,
  portrait,
} from "../src/render/pixel/portraits.js";
import {
  MAP_THUMB_SEEDS,
  UNIT_CARDS,
  battlefield,
  factoryScene,
  mapThumb,
  titleScene,
  unitCard,
} from "../src/render/pixel/scenes.js";
import {
  FRAME_KINDS,
  FRAME_SIZE,
  frame,
  hudBottom,
  logo,
  steelTile,
} from "../src/render/pixel/ui.js";

const digest = (img: Img): string =>
  createHash("sha256").update(img.d).digest("hex");
const alphaAt = (img: Img, x: number, y: number): number | undefined =>
  img.d[(y * img.w + x) * 4 + 3];

function portraitOf(who: (typeof HEROES)[number]): Img {
  const img = new Img(PORTRAIT_SIZE, PORTRAIT_SIZE);
  portrait(img, 0, 0, who, "red");
  return img;
}

const biomes = Object.keys(BIOME) as BiomeId[];
const renders: Readonly<Record<string, () => Img>> = {
  battlefield,
  hud: () => hudBottom(battlefield()),
  title: titleScene,
  logo: () => logo("FUSE FRONT"),
  steel: steelTile,
  ...Object.fromEntries(
    HEROES.map((h) => [`portrait-${h}`, () => portraitOf(h)]),
  ),
  ...Object.fromEntries(
    UNIT_CARDS.map((u) => [`card-${u}`, () => unitCard(u)]),
  ),
  "factory-robot": () => factoryScene("robot"),
  "factory-vehicle": () => factoryScene("vehicle"),
  ...Object.fromEntries(
    biomes.map((b) => [`map-${b}`, () => mapThumb(b, MAP_THUMB_SEEDS[b])]),
  ),
  ...Object.fromEntries(FRAME_KINDS.map((k) => [`frame-${k}`, () => frame(k)])),
};

test("every image draws the same pixels twice", () => {
  for (const [name, draw] of Object.entries(renders))
    assert.equal(digest(draw()), digest(draw()), name);
});

test("images have their documented sizes", () => {
  const size = (img: Img): string => `${img.w}x${img.h}`;
  assert.equal(size(battlefield()), "480x228");
  assert.equal(size(hudBottom(battlefield())), "480x58");
  assert.equal(size(titleScene()), "320x200");
  assert.equal(size(steelTile()), "16x16");
  // 3 px margin each side plus 9 letters of 18 px and one 8 px space.
  assert.equal(size(logo("FUSE FRONT")), "178x29");
  for (const u of UNIT_CARDS) assert.equal(size(unitCard(u)), "40x30", u);
  assert.equal(size(factoryScene("vehicle")), "80x44");
  for (const b of biomes) assert.equal(size(mapThumb(b, 1)), "80x40", b);
  for (const k of FRAME_KINDS)
    assert.equal(size(frame(k)), `${FRAME_SIZE}x${FRAME_SIZE}`, k);
});

test("scenes and frames cover every pixel; a portrait fills its own square only", () => {
  for (const img of [
    battlefield(),
    titleScene(),
    steelTile(),
    ...FRAME_KINDS.map(frame),
  ])
    for (let i = 3; i < img.d.length; i += 4) assert.equal(img.d[i], 255);
  const canvas = new Img(PORTRAIT_SIZE + 2, PORTRAIT_SIZE + 2);
  portrait(canvas, 1, 1, "brick", "blue");
  assert.equal(alphaAt(canvas, 0, 0), 0);
  assert.equal(alphaAt(canvas, 1, 1), 255);
  assert.equal(alphaAt(canvas, PORTRAIT_SIZE, PORTRAIT_SIZE), 255);
  assert.equal(alphaAt(canvas, PORTRAIT_SIZE + 1, PORTRAIT_SIZE + 1), 0);
});

test("frame tiles have opaque dark corners for nine-slice borders", () => {
  for (const kind of FRAME_KINDS) {
    const img = frame(kind);
    for (const [x, y] of [
      [0, 0],
      [FRAME_SIZE - 1, 0],
      [0, FRAME_SIZE - 1],
      [FRAME_SIZE - 1, FRAME_SIZE - 1],
    ] as const) {
      const i = (y * img.w + x) * 4;
      assert.deepEqual(
        [...img.d.subarray(i, i + 4)],
        [16, 16, 16, 255],
        `${kind} ${x},${y}`,
      );
    }
  }
});

test("an image can draw into a caller's buffer of the right size", () => {
  const buffer = new Uint8ClampedArray(12 * 12 * 4);
  const view = new Img(12, 12, buffer);
  view.rect(0, 0, 1, 1, "#ff0000");
  assert.deepEqual([...buffer.subarray(0, 4)], [255, 0, 0, 255]);
  assert.throws(() => new Img(12, 11, buffer), RangeError);
});

test("team colour tints a portrait", () => {
  const red = new Img(PORTRAIT_SIZE, PORTRAIT_SIZE);
  const blue = new Img(PORTRAIT_SIZE, PORTRAIT_SIZE);
  portrait(red, 0, 0, "vix", "red");
  portrait(blue, 0, 0, "vix", "blue");
  assert.notEqual(digest(red), digest(blue));
});

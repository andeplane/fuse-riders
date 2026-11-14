import test from "node:test";
import assert from "node:assert/strict";
import { MAPS, MAP_IDS } from "../src/engine/index.js";
import type { BurstEffect, Effect } from "../src/render/effects.js";
import { FONTS, layoutText, textWidth } from "../src/render/font.js";
import {
  BOT_TAG_FADE,
  BOT_TAG_STEPS,
  SNAIL_NEAR,
  botTagAlpha,
  dangerOf,
  hexHalfWidth,
  eggStates,
  hiveAnchor,
  hiveSheet,
  IRIS_RADIUS,
  IRIS_SECONDS,
  IRIS_WORDS,
  irisCentre,
  irisRadius,
  victoryFocus,
  victoryLines,
  respawnCount,
  snailThreat,
  tagOf,
} from "../src/render/hud-model.js";
import {
  fitView,
  platformTiles,
  spans,
  wrapOffsets,
  type TileSheet,
} from "../src/render/layout.js";
import {
  REQUIRED_SHEETS,
  animationFrame,
  frameIndex,
  frameRect,
  parseManifest,
  sheetDuration,
  teamName,
  type SheetDef,
} from "../src/render/manifest.js";
import {
  BERRY_COLORS,
  EffectPool,
  GOLD_COLORS,
  MAX_PARTICLES,
  RING_LIFE,
  TEXT_LIFE,
  WHITE_COLORS,
  burstParticles,
  circlePoints,
  easeOutBack,
  toneColors,
} from "../src/render/particles.js";
import { SHAKE_REACH, SHAKE_SECONDS, Shake } from "../src/render/shake.js";
import {
  manifest,
  openingView,
  rawManifest,
  SIZES,
  withUnit,
} from "./render-kit.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The real manifest with one asset replaced (or removed with `undefined`). */
function manifestWith(
  id: string,
  change: (asset: Record<string, unknown>) => unknown,
): unknown {
  const raw = rawManifest();
  assert.ok(isRecord(raw) && isRecord(raw.assets));
  const asset = raw.assets[id];
  assert.ok(isRecord(asset), id);
  const assets = { ...raw.assets, [id]: change({ ...asset }) };
  if (assets[id] === undefined) delete assets[id];
  return { ...raw, assets };
}

const sheetOf = (id: string): SheetDef => {
  const def = manifest().assets[id];
  assert.ok(def, id);
  return def;
};

test("the real manifest parses and has every sheet the renderer needs", () => {
  const art = manifest();
  assert.deepEqual(art.canvas, [480, 270]);
  for (const id of REQUIRED_SHEETS) assert.ok(art.assets[id], id);
  assert.equal(art.teams.cyan?.length, 4);
  assert.equal(art.teams.pink?.length, 4);
  assert.equal(sheetOf("worker-cyan").flash, "worker-flash");
  assert.ok(
    sheetOf("snail").saddle.length > 0,
    "the snail says where its rider sits",
  );
  assert.ok(sheetOf("bg-far").parallax !== sheetOf("bg-near").parallax);
  for (const { name, holes } of MAP_IDS.map((id) => MAPS[id]))
    for (const team of [0, 1]) {
      const id = hiveSheet(name, team, (sheet) => sheet in art.assets);
      assert.ok(id, `a hive wall for ${name}`);
      const hive = sheetOf(id);
      assert.ok((holes[team]?.length ?? 0) > 0, `${name}: holes to draw`);
      assert.ok(
        hive.hole && art.assets[hive.hole],
        `${id} names its hole sheet`,
      );
    }
  assert.ok("filled" in sheetOf("hive-hole-pink").frames);
  assert.equal(teamName(0), "cyan");
  assert.equal(teamName(1), "pink");
  assert.equal(teamName(-1), "cyan");
});

test("a broken manifest fails at load with the reason", () => {
  assert.throws(() => parseManifest(null), /not a manifest/);
  assert.throws(() => parseManifest({ assets: {} }), /not a manifest/);
  assert.throws(
    () => parseManifest({ assets: {}, teams: {} }),
    /no sheet worker-cyan/,
  );
  assert.throws(
    () => parseManifest(manifestWith("snail", () => undefined)),
    /no sheet snail/,
  );
  assert.throws(
    () => parseManifest(manifestWith("snail", () => "snail.png")),
    /snail is not a sheet/,
  );
  assert.throws(
    () =>
      parseManifest(
        manifestWith("snail", (asset) => ({ ...asset, width: "64" })),
      ),
    /snail\.width is not a number/,
  );
  assert.throws(
    () =>
      parseManifest(
        manifestWith("snail", (asset) => ({ ...asset, anchor: [1] })),
      ),
    /snail\.anchor is not a pair/,
  );
  assert.throws(
    () =>
      parseManifest(
        manifestWith("snail", (asset) => ({
          ...asset,
          animations: { crawl: { fps: 3 } },
        })),
      ),
    /snail\.crawl is not an animation/,
  );
  assert.throws(
    () =>
      parseManifest(
        manifestWith("snail", (asset) => ({ ...asset, frames: { idle: "0" } })),
      ),
    /snail\.frames\.idle is not a number/,
  );
  assert.throws(
    () =>
      parseManifest(
        manifestWith("snail", (asset) => ({ ...asset, saddle: [[0]] })),
      ),
    /snail\.saddle is not a pair/,
  );
  const raw = rawManifest();
  assert.ok(isRecord(raw));
  assert.throws(
    () => parseManifest({ ...raw, teams: { cyan: ["#000"] } }),
    /no cyan ramp/,
  );
  assert.throws(
    () => parseManifest({ ...raw, canvas: "big" }),
    /canvas is not a pair/,
  );
});

test("optional parts of a sheet have defaults", () => {
  const art = parseManifest(
    manifestWith("snail", (asset) => ({
      file: asset.file,
      width: asset.width,
      height: asset.height,
      frameWidth: asset.frameWidth,
      frameHeight: asset.frameHeight,
      frameCount: asset.frameCount,
      anchor: asset.anchor,
    })),
  );
  const snail = art.assets.snail;
  assert.ok(snail);
  assert.deepEqual(snail.frames, {});
  assert.deepEqual(snail.animations, {});
  assert.equal(snail.fps, 12);
  assert.equal(snail.flash, undefined);
  assert.deepEqual(snail.saddle, []);
  assert.equal(snail.parallax, 0);
  assert.deepEqual(snail.holes, []);
  assert.equal(snail.hole, undefined);
});

test("frames are cut from the sheet left to right, wrapping into rows", () => {
  const def: SheetDef = {
    ...sheetOf("worker-cyan"),
    width: 64,
    height: 48,
    frameWidth: 16,
    frameHeight: 24,
    frameCount: 7,
  };
  assert.deepEqual(frameRect(def, 0), { sx: 0, sy: 0, sw: 16, sh: 24 });
  assert.deepEqual(frameRect(def, 5), { sx: 16, sy: 24, sw: 16, sh: 24 });
  assert.deepEqual(
    frameRect(def, 99),
    frameRect(def, 6),
    "past the end is the last frame",
  );
  assert.deepEqual(frameRect(def, -3), frameRect(def, 0));
  assert.deepEqual(frameRect(def, 2.9), frameRect(def, 2));
  assert.deepEqual(frameRect({ ...def, width: 8, frameCount: 0 }, 3), {
    sx: 0,
    sy: 0,
    sw: 16,
    sh: 24,
  });
  assert.equal(frameIndex(def, "no such pose"), 0);
});

test("animations loop or hold, and a plain sheet plays through once", () => {
  const worker = sheetOf("worker-cyan");
  const run = worker.animations.run;
  assert.ok(run && run.loop);
  const count = run.frames.length;
  assert.equal(
    animationFrame(worker, "run", count / run.fps),
    animationFrame(worker, "run", 0),
    "a loop comes round",
  );
  assert.equal(
    animationFrame(worker, "run", -4),
    animationFrame(worker, "run", 0),
  );
  const held: SheetDef = {
    ...worker,
    animations: { once: { frames: ["run1", "run2"], fps: 10, loop: false } },
  };
  assert.equal(animationFrame(held, "once", 0.1), frameIndex(worker, "run2"));
  assert.equal(animationFrame(held, "once", 9), frameIndex(worker, "run2"));
  const burst = sheetOf("flap-puff");
  assert.equal(animationFrame(burst, "", 0), 0);
  assert.equal(animationFrame(burst, "", 1 / burst.fps), 1);
  assert.equal(animationFrame(burst, "", 60), burst.frameCount - 1);
  assert.equal(sheetDuration(burst), burst.frameCount / burst.fps);
  assert.equal(sheetDuration({ ...burst, fps: 0, frameCount: 3 }), 3);
});

test("the picture is scaled by whole pixels and centred", () => {
  assert.deepEqual(fitView(1920, 1080, 1), {
    scale: 4,
    width: 1920,
    height: 1080,
    cssWidth: 1920,
    cssHeight: 1080,
    left: 0,
    top: 0,
    smooth: false,
  });
  const tall = fitView(1000, 900, 1);
  assert.equal(tall.scale, 2);
  assert.equal(tall.left, 20);
  assert.equal(tall.top, 180);
  const retina = fitView(960, 540, 2);
  assert.equal(retina.scale, 4, "device pixels count, not CSS pixels");
  assert.equal(retina.cssWidth, 960);
  assert.equal(fitView(100, 50, 1).scale, 1, "never smaller than the art");
  assert.equal(fitView(-5, -5, 1).scale, 1);
  assert.equal(fitView(960, 540, 0).scale, 2, "a bad pixel ratio counts as 1");
  assert.equal(fitView(960, 540, Number.NaN).scale, 2);
});

test("a window between whole scales is filled rather than left a third empty", () => {
  const laptop = fitView(1280, 720, 1);
  assert.equal(laptop.smooth, true);
  assert.equal(laptop.scale, 3, "drawn at the next whole scale");
  assert.equal(laptop.width, 1440);
  assert.equal(Math.round(laptop.cssWidth), 1280);
  assert.equal(Math.round(laptop.cssHeight), 720);
  assert.equal(Math.round(laptop.left), 0);
  const near = fitView(1000, 562, 1);
  assert.equal(near.smooth, false, "2.08 is close enough to 2 to stay crisp");
  assert.equal(near.scale, 2);
  assert.equal(near.cssWidth, 960);
  assert.equal(fitView(100, 50, 1).smooth, false, "never shrunk below the art");
  assert.equal(
    fitView(1280, 720, 2).smooth,
    false,
    "5.33 device pixels: 5 fills 94%",
  );
});

test("something over the seam is drawn on both sides", () => {
  assert.deepEqual(wrapOffsets(100, 120), [0]);
  assert.deepEqual(wrapOffsets(-6, 10), [0, 480]);
  assert.deepEqual(wrapOffsets(470, 486), [0, -480]);
  assert.deepEqual(wrapOffsets(-4, 104, 100), [0, 100, -100]);
});

const SHEET: TileSheet = {
  tile: 8,
  has: (frame) => frame !== "missing" && !frame.startsWith("ledge"),
  rows: (frame) => (frame.startsWith("slab") ? 7 : 5),
};
const withLedge: TileSheet = { ...SHEET, has: () => true };

test("a run of tiles ends in caps, and the last middle is the one cut short", () => {
  assert.deepEqual(spans(0, 0, 8), []);
  const run = spans(96, 29, 8);
  assert.deepEqual(
    run.map((span) => [span.part, span.at, span.offset, span.size]),
    [
      ["start", 96, 0, 8],
      ["middle", 104, 0, 8],
      ["middle", 112, 0, 5],
      ["end", 117, 0, 8],
    ],
  );
  assert.deepEqual(
    run.map((span) => span.index),
    [0, 0, 1, 0],
  );
  assert.deepEqual(
    spans(10, 14, 8).map((span) => [
      span.part,
      span.at,
      span.offset,
      span.size,
    ]),
    [
      ["start", 10, 0, 7],
      ["end", 17, 1, 7],
    ],
    "shorter than two tiles: half of each cap",
  );
  assert.deepEqual(
    spans(0, 3, 8, false, true).map((span) => [
      span.part,
      span.offset,
      span.size,
    ]),
    [["end", 5, 3]],
    "a sliver against the wrap is the far edge of the end cap",
  );
  assert.deepEqual(
    spans(0, 1, 8).map((span) => span.part),
    ["start"],
  );
  assert.deepEqual(
    spans(0, 20, 8, false, false).map((span) => [span.part, span.size]),
    [
      ["middle", 8],
      ["middle", 8],
      ["middle", 4],
    ],
  );
  assert.deepEqual(
    spans(0, 12, 8, true, false).map((span) => [span.part, span.size]),
    [
      ["start", 8],
      ["middle", 4],
    ],
  );
});

test("a platform's tiles follow from its shape", () => {
  const ledge = platformTiles({ x: 96, y: 214, w: 72, h: 6 }, SHEET);
  assert.equal(ledge.length, 9);
  assert.equal(ledge[0]?.frame, "slabLeft");
  assert.equal(ledge.at(-1)?.frame, "slabRight");
  assert.equal(ledge.at(-1)?.x, 96 + 72 - 8);
  assert.ok(
    ledge.every((piece) => piece.h === 7 && piece.y === 214),
    "as tall as the slab's art: the fringe hangs under the solid rows",
  );
  assert.ok(ledge.some((piece) => piece.frame === "slabLamp"));
  const edge = platformTiles({ x: 0, y: 214, w: 52, h: 6 }, SHEET);
  assert.equal(
    edge[0]?.frame,
    "slab",
    "no cap against the screen edge: it continues across the wrap",
  );
  assert.equal(edge.at(-1)?.frame, "slabRight");
  assert.equal(edge.at(-2)?.w, 4, "an odd width cuts the last middle short");
  const right = platformTiles({ x: 440, y: 100, w: 40, h: 6 }, SHEET);
  assert.equal(right[0]?.frame, "slabLeft");
  assert.equal(right.at(-1)?.frame, "slab");
  const ground = platformTiles({ x: 0, y: 265, w: 480, h: 5 }, SHEET);
  assert.equal(ground.length, 60);
  assert.ok(ground.every((piece) => piece.frame.startsWith("track")));
  assert.ok(ground.every((piece) => piece.h === 5));
  assert.equal(
    platformTiles({ x: 10, y: 50, w: 40, h: 5 }, withLedge)[1]?.frame,
    "ledge",
    "a platform no thicker than the ledge art takes it",
  );
  assert.equal(
    platformTiles({ x: 10, y: 50, w: 40, h: 6 }, withLedge)[1]?.frame,
    "slab",
  );
  const bare: TileSheet = { ...SHEET, has: (frame) => frame === "slab" };
  assert.deepEqual(
    [
      ...new Set(
        platformTiles({ x: 96, y: 214, w: 72, h: 6 }, bare).map((p) => p.frame),
      ),
    ],
    ["slab"],
    "a sheet without caps or lamps still draws",
  );
  const custom = platformTiles({ x: 0, y: 8, w: 16, h: 4 }, SHEET, 16, 12);
  assert.deepEqual(
    custom.map((piece) => piece.frame),
    ["track", "track"],
  );
});

test("a thick rectangle is a block with a top, a bottom and sides", () => {
  const block = platformTiles({ x: 235, y: 75, w: 10, h: 15 }, SHEET);
  assert.deepEqual(
    block.map((piece) => [piece.frame, piece.x, piece.y, piece.w, piece.h]),
    [
      ["topLeft", 235, 75, 5, 8],
      ["topRight", 240, 75, 5, 8],
      ["bottomLeft", 235, 83, 5, 7],
      ["bottomRight", 240, 83, 5, 7],
    ],
  );
  assert.equal(block[1]?.sx, 3, "the far edge of the right cap");
  assert.equal(block[2]?.sy, 1, "the lower edge of the bottom row");
  const wall = platformTiles({ x: 0, y: 0, w: 3, h: 118 }, SHEET);
  assert.equal(wall[0]?.frame, "topRight");
  assert.ok(wall.some((piece) => piece.frame === "right"));
  assert.equal(wall.at(-1)?.frame, "bottomRight");
  assert.ok(wall.every((piece) => piece.w === 3 && piece.sx === 5));
  const big = platformTiles({ x: 100, y: 100, w: 32, h: 32 }, SHEET);
  assert.equal(big.filter((piece) => piece.frame === "middle").length, 4);
  assert.equal(big.length, 16);
});

test("every platform of every map is covered exactly by its tiles", () => {
  for (const id of MAP_IDS)
    for (const rect of MAPS[id].platforms) {
      const pieces = platformTiles(rect, SHEET);
      const thick = rect.h > SHEET.tile;
      const area = pieces.reduce((sum, piece) => sum + piece.w * piece.h, 0);
      const rows = thick ? rect.h : (pieces[0]?.h ?? 0);
      assert.equal(area, rect.w * rows, `map ${id} ${JSON.stringify(rect)}`);
      assert.ok(pieces.every((piece) => piece.x >= rect.x));
      assert.ok(pieces.every((piece) => piece.x + piece.w <= rect.x + rect.w));
    }
});

test("the snail's progress and each team's danger come from the view", () => {
  const view = openingView();
  const { start, goals } = view.map.snail;
  const at = (x: number, rider = 2) => ({
    ...view,
    snail: { ...view.snail, x, rider },
  });
  assert.equal(snailThreat(view, 0), 0);
  assert.equal(snailThreat(at(goals[1]), 1), 1);
  assert.equal(
    snailThreat(at(goals[1]), 0),
    0,
    "going the other way is no threat",
  );
  assert.equal(snailThreat(at((start + goals[0]) / 2), 0), 0.5);
  assert.equal(
    snailThreat(
      {
        ...view,
        map: {
          ...view.map,
          snail: { ...view.map.snail, goals: [start, start] },
        },
      },
      0,
    ),
    0,
  );

  assert.equal(dangerOf(view).any, false);
  const lastEgg = dangerOf({ ...view, eggs: [1, 3] });
  assert.deepEqual(lastEgg.lastEgg, [true, false]);
  assert.equal(lastEgg.any, true);
  const holes = view.hives[1]?.length ?? 0;
  assert.deepEqual(dangerOf({ ...view, berries: [0, holes - 1] }).lastBerry, [
    false,
    true,
  ]);
  const near = goals[1] - (goals[1] - start) * (1 - SNAIL_NEAR) + 1;
  assert.deepEqual(dangerOf(at(near)).snailNear, [false, true]);
  assert.deepEqual(
    dangerOf(at(near, -1)).snailNear,
    [false, false],
    "nobody riding",
  );
  assert.deepEqual(
    dangerOf(at(near, -1)).snailClose,
    [false, true],
    "the strip warns whether or not it is ridden",
  );
  assert.deepEqual(dangerOf(at(near - 2)).snailClose, [false, false]);
  assert.deepEqual(dangerOf(at(goals[0])).snailClose, [true, false]);
  const over = dangerOf({
    ...at(near),
    eggs: [0, 3],
    winner: { team: 1, kind: "military" },
  });
  assert.equal(over.any, false, "nothing pulses once the round is won");
  assert.deepEqual(dangerOf({ ...view, hives: [[], []] }).lastBerry, [
    false,
    false,
  ]);
});

test("a hive wall is fitted to the engine's holes only when its layout is the map's", () => {
  const holes = MAPS[1].holes[0];
  const first = holes[0];
  assert.ok(first);
  const offsets = holes.map((hole): [number, number] => [
    hole.x - first.x + 3,
    hole.y - first.y - 4,
  ]);
  assert.deepEqual(hiveAnchor(holes, { holes: offsets }), {
    x: first.x - 3,
    y: first.y + 4,
  });
  const moved = offsets.map(([x, y], index): [number, number] => [
    x,
    index === 5 ? y + 1 : y,
  ]);
  assert.equal(hiveAnchor(holes, { holes: moved }), null, "one hole elsewhere");
  assert.equal(hiveAnchor(holes, { holes: offsets.slice(1) }), null);
  assert.equal(hiveAnchor([], { holes: offsets }), null, "a map with no holes");
  assert.equal(hiveAnchor(holes, { holes: [] }), null, "art with no holes");
  // Whatever the art's layout, each map has a wall to stand on its wall rectangle.
  const art = manifest();
  for (const id of MAP_IDS)
    for (const team of [0, 1])
      assert.ok(hiveSheet(MAPS[id].name, team, (name) => name in art.assets));
});

test("a map's hive wall is found by the map's name, else the one wall for all", () => {
  const has = (ids: string[]) => (id: string) => ids.includes(id);
  assert.equal(
    hiveSheet("Day", 0, has(["hive-day-cyan", "hive-cyan"])),
    "hive-day-cyan",
  );
  assert.equal(hiveSheet("Dusk", 1, has(["hive-pink"])), "hive-pink");
  assert.equal(hiveSheet("Night", 1, has([])), undefined);
});

test("spare eggs are whole until used, and the next one hatches the Queen", () => {
  const spares = (...present: boolean[]) =>
    present.map((value) => ({ present: value }));
  assert.deepEqual(eggStates(spares(true, true), false), ["full", "full"]);
  assert.deepEqual(
    eggStates(spares(true, true), true),
    ["cracked", "full"],
    "she is in it",
  );
  assert.deepEqual(eggStates(spares(false, true), false), ["broken", "full"]);
  assert.deepEqual(eggStates(spares(false, true), true), ["broken", "cracked"]);
  assert.deepEqual(eggStates(spares(false, false), true), ["broken", "broken"]);
  assert.deepEqual(eggStates([], true), []);
});

test("a bot's tag shows for the opening seconds and fades away", () => {
  assert.equal(botTagAlpha(0), 0.5);
  assert.equal(botTagAlpha(-5), 0.5);
  assert.equal(botTagAlpha(BOT_TAG_STEPS - BOT_TAG_FADE), 0.5);
  assert.equal(botTagAlpha(BOT_TAG_STEPS - BOT_TAG_FADE / 2), 0.25);
  assert.equal(botTagAlpha(BOT_TAG_STEPS), 0);
  assert.equal(botTagAlpha(BOT_TAG_STEPS + 100), 0);
});

test("a tag is the name in capitals, cut to fit, or BOT", () => {
  assert.equal(tagOf("Anders", false), "ANDERS");
  assert.equal(tagOf("  the long name  ", false), "THE LONG");
  assert.equal(tagOf("søren ☃", true), "SREN");
  assert.equal(tagOf("", true), "BOT");
  assert.equal(tagOf(undefined, true), "BOT");
  assert.equal(tagOf("☃☃", false), "");
  assert.equal(respawnCount(0, 3), 3);
  assert.equal(respawnCount(0.5, 3), 2);
  assert.equal(respawnCount(1, 3), 1, "never zero");
  assert.equal(respawnCount(-2, 3), 3);
});

test("text is laid out as lit pixels a glyph apart", () => {
  assert.equal(textWidth(""), 0);
  assert.equal(textWidth("BOT"), 11);
  assert.equal(textWidth("12", "big"), 11);
  const one = layoutText("I");
  assert.equal(one.length, 9);
  assert.ok(
    one.every(
      (pixel) => pixel.x < FONTS.small.width && pixel.y < FONTS.small.height,
    ),
  );
  const two = layoutText("I I");
  assert.equal(two.length, 18);
  assert.equal(Math.max(...two.map((pixel) => pixel.x)), 10);
  assert.deepEqual(layoutText("~"), [], "a character the font lacks is a gap");
  const big = layoutText("8", "big");
  assert.equal(Math.max(...big.map((pixel) => pixel.y)), FONTS.big.height - 1);
  for (const font of [FONTS.small, FONTS.big])
    for (const [char, rows] of Object.entries(font.glyphs)) {
      assert.equal(rows.length, font.height, char);
      assert.ok(
        rows.every((row) => row.length === font.width),
        char,
      );
    }
});

test("a full knock shakes about two pixels for eight tenths of a second", () => {
  const shake = new Shake();
  assert.deepEqual(shake.offset(), { x: 0, y: 0 });
  shake.add(0.4);
  assert.equal(shake.level, 0.4);
  shake.add(0.3);
  assert.equal(shake.level, 0.4, "the strongest knock wins, they do not add");
  shake.add(5);
  assert.equal(shake.level, 1);
  shake.add(-1);
  assert.equal(shake.level, 1);
  let furthest = 0;
  for (let i = 0; i < 60; i += 1) {
    shake.tick(1 / 240);
    const { x, y } = shake.offset();
    assert.ok(Number.isInteger(x) && Number.isInteger(y), "whole pixels");
    assert.ok(Math.abs(x) <= SHAKE_REACH && Math.abs(y) <= SHAKE_REACH);
    furthest = Math.max(furthest, Math.abs(x), Math.abs(y));
  }
  assert.equal(furthest, SHAKE_REACH);
  const before = shake.level;
  shake.tick(-3);
  assert.equal(shake.level, before);
  shake.tick(SHAKE_SECONDS / 2);
  assert.ok(shake.level > 0, "still going after half the time");
  shake.tick(SHAKE_SECONDS / 2);
  assert.equal(shake.level, 0);
  assert.deepEqual(shake.offset(), { x: 0, y: 0 });
});

const burst: BurstEffect = {
  kind: "burst",
  x: 100,
  y: 50,
  tone: "team",
  team: 0,
  count: 12,
  speed: 80,
  life: 0.5,
};
/** A fixed sequence standing in for Math.random. */
function sequence(): () => number {
  let n = 0;
  return () => {
    n = (n + 0.37) % 1;
    return n;
  };
}

test("tones pick their colours and a burst throws its pixels all round", () => {
  const ramp = ["#000", "#111", "#222", "#333"];
  assert.deepEqual(toneColors("team", ramp), ["#222", "#333", "#ffffff"]);
  assert.equal(toneColors("team", []), WHITE_COLORS);
  assert.equal(toneColors("berry", ramp), BERRY_COLORS);
  assert.equal(toneColors("gold", ramp), GOLD_COLORS);
  assert.equal(toneColors("white", ramp), WHITE_COLORS);
  const particles = burstParticles(burst, ["#abc"], sequence());
  assert.equal(particles.length, 12);
  assert.ok(
    particles.every((p) => p.x === 100 && p.y === 50 && p.color === "#abc"),
  );
  assert.ok(particles.every((p) => p.life > 0.29 && p.life <= 0.5));
  assert.ok(particles.some((p) => p.vx > 0) && particles.some((p) => p.vx < 0));
  assert.ok(
    particles.some((p) => p.size === 2) && particles.some((p) => p.size === 1),
  );
  assert.equal(burstParticles(burst, [], sequence())[0]?.color, "#ffffff");
  assert.deepEqual(
    burstParticles(burst, ["#abc"], sequence()),
    particles,
    "same dice, same burst",
  );
});

test("the pool starts effects, moves them and drops them when they finish", () => {
  const pool = new EffectPool(sequence());
  const ramp = (): readonly string[] => ["#000", "#111", "#222", "#333"];
  const duration = (sheet: string): number => (sheet === "known" ? 0.3 : 0);
  const effects: Effect[] = [
    burst,
    { kind: "ring", x: 1, y: 2, tone: "white", team: -1, radius: 10 },
    { kind: "text", x: 1, y: 2, text: "1", tone: "berry", team: 0 },
    { kind: "sprite", sheet: "known", x: 1, y: 2, flip: false },
    { kind: "sprite", sheet: "unknown", x: 1, y: 2, flip: false },
  ];
  for (const effect of effects) pool.add(effect, ramp, duration);
  assert.equal(pool.particles.length, 12);
  assert.equal(pool.count, 15, "the sheet nobody knows is not started");
  pool.tick(0.1, duration);
  assert.equal(pool.count, 15);
  assert.ok(pool.particles.every((p) => p.age === 0.1 && p.x !== 100));
  pool.tick(-1, duration);
  assert.equal(pool.sprites[0]?.age, 0.1, "time does not run backwards");
  pool.tick(0.25, duration);
  assert.equal(pool.sprites.length, 0);
  assert.equal(pool.rings.length, 1);
  pool.tick(RING_LIFE - 0.2, duration);
  assert.equal(pool.rings.length, 0);
  assert.equal(pool.particles.length, 0);
  assert.equal(pool.texts.length, 1);
  pool.tick(TEXT_LIFE, duration);
  assert.equal(pool.count, 0);
  pool.add(burst, ramp, duration);
  pool.clear();
  assert.equal(pool.count, 0);
});

test("particles wrap with the screen and the pool has a ceiling", () => {
  const pool = new EffectPool();
  const particle = {
    x: 478,
    y: 10,
    vx: 40,
    vy: 0,
    age: 0,
    life: 5,
    color: "#fff",
    size: 1,
    gravity: 100,
  };
  pool.push([particle, { ...particle, x: 2, vx: -40 }]);
  pool.tick(0.1, () => 0);
  assert.ok(Math.abs((pool.particles[0]?.x ?? 0) - 2) < 1e-9);
  assert.ok(Math.abs((pool.particles[1]?.x ?? 0) - 478) < 1e-9);
  assert.ok((pool.particles[0]?.vy ?? 0) > 0, "gravity pulls");
  pool.push(
    Array.from({ length: MAX_PARTICLES + 50 }, () => ({
      ...particle,
      color: "#new",
    })),
  );
  assert.equal(pool.particles.length, MAX_PARTICLES);
  assert.ok(
    pool.particles.every((p) => p.color === "#new"),
    "the oldest go first",
  );
});

test("a ring is a one-pixel circle and a banner lands with a little overshoot", () => {
  assert.deepEqual(circlePoints(0), [[0, 0]]);
  assert.deepEqual(circlePoints(-3), [[0, 0]]);
  for (const r of [1, 4, 9]) {
    const points = circlePoints(r);
    assert.equal(
      new Set(points.map(([x, y]) => `${x},${y}`)).size,
      points.length,
      "each once",
    );
    for (const [x, y] of points)
      assert.ok(
        Math.abs(Math.hypot(x, y) - r) < 1,
        `${x},${y} is on radius ${r}`,
      );
    assert.ok(points.length >= r * 4);
  }
  assert.ok(Math.abs(easeOutBack(0)) < 1e-9);
  assert.equal(easeOutBack(1), 1);
  assert.equal(easeOutBack(7), 1);
  assert.ok(Math.abs(easeOutBack(-1)) < 1e-9);
  assert.ok(easeOutBack(0.7) > 1, "past the end before settling");
});

test("the ending closes on what decided the round", () => {
  const base = openingView();
  const middle = { x: 240, y: 135 };
  assert.deepEqual(victoryFocus(base, SIZES), middle, "nobody has won");
  const won = (
    team: number,
    kind: "military" | "economy" | "snail",
    timeUp = false,
  ) => ({ ...base, winner: { team, kind }, timeUp });
  const loser = base.units.find(
    (unit) => unit.kind === "queen" && unit.team === 0,
  );
  assert.ok(loser);
  const fallen = withUnit(won(1, "military"), loser.slot, { x: 77, y: 99 });
  assert.deepEqual(victoryFocus(fallen, SIZES), {
    x: 77,
    y: 99 - SIZES.queen / 2,
  });
  const queenless = { ...won(1, "military"), units: [] };
  assert.deepEqual(victoryFocus(queenless, SIZES), middle);
  assert.deepEqual(victoryFocus(won(0, "snail"), SIZES), {
    x: base.snail.x,
    y: base.snail.y - SIZES.snail / 2,
  });
  const holes = base.hives[1] ?? [];
  assert.ok(holes.length > 0);
  const hive = victoryFocus(won(1, "economy"), SIZES);
  assert.ok(hive.x >= Math.min(...holes.map((hole) => hole.x)));
  assert.ok(hive.x <= Math.max(...holes.map((hole) => hole.x)));
  assert.ok(hive.y >= Math.min(...holes.map((hole) => hole.y)));
  assert.ok(hive.y <= Math.max(...holes.map((hole) => hole.y)));
  assert.deepEqual(
    victoryFocus({ ...won(1, "economy"), hives: [] }, SIZES),
    middle,
  );
  const clock = withUnit(won(0, "economy", true), loser.slot, { x: 50, y: 60 });
  assert.deepEqual(
    victoryFocus(clock, SIZES),
    { x: 50, y: 60 - SIZES.queen / 2 },
    "the clock's winner is shown by her Queen",
  );
});

test("the iris is a hexagon that closes and stays on screen with its words", () => {
  assert.ok(irisRadius(0) > 600, "open: the whole picture shows");
  assert.equal(irisRadius(IRIS_SECONDS), IRIS_RADIUS);
  assert.equal(irisRadius(99), IRIS_RADIUS);
  assert.equal(irisRadius(-1), irisRadius(0));
  assert.ok(irisRadius(0.2) > irisRadius(0.5));
  assert.equal(hexHalfWidth(40, 0), 40);
  const reach = (40 * Math.sqrt(3)) / 2;
  assert.ok(Math.abs(hexHalfWidth(40, reach) - 20) < 1e-9, "the flat top");
  assert.equal(hexHalfWidth(40, -reach - 0.01), 0);
  assert.equal(hexHalfWidth(40, 10), hexHalfWidth(40, -10));
  assert.deepEqual(irisCentre({ x: 240, y: 135 }), { x: 240, y: 135 });
  const corner = irisCentre({ x: 2, y: 3 });
  assert.equal(corner.x, IRIS_RADIUS);
  const tall = (IRIS_RADIUS * Math.sqrt(3)) / 2;
  assert.equal(corner.y, Math.round(tall + IRIS_WORDS), "room for the title");
  const far = irisCentre({ x: 900, y: 900 });
  assert.equal(far.x, 480 - IRIS_RADIUS);
  assert.ok(far.y + tall <= 270 - IRIS_WORDS + 9, "and for the line below");
});

test("the ending says who won and how", () => {
  assert.deepEqual(victoryLines({ team: 0, kind: "military" }, false), {
    title: `${teamName(0).toUpperCase()} WINS!`,
    kind: "MILITARY VICTORY",
  });
  assert.equal(
    victoryLines({ team: 1, kind: "snail" }, false).kind,
    "SNAIL VICTORY",
  );
  assert.equal(
    victoryLines({ team: 1, kind: "economy" }, true).kind,
    "TIME UP",
  );
  for (const line of Object.values(
    victoryLines({ team: 1, kind: "economy" }, false),
  ))
    assert.ok(textWidth(line, "big") > line.length * 5, `${line} can be drawn`);
});

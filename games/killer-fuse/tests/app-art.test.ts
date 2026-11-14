import test from "node:test";
import assert from "node:assert/strict";
import {
  fit,
  readIconSheets,
  sheetIcon,
  standing,
  unitIcons,
  winIcons,
  type IconSheet,
} from "../src/app/art.js";

const sheet = (patch: Partial<IconSheet> = {}): IconSheet => ({
  file: "units/worker-cyan.png",
  width: 112,
  height: 28,
  frameWidth: 14,
  frameHeight: 14,
  frameCount: 16,
  frames: { idle: 0 },
  anchor: [7, 13],
  ...patch,
});

test("the manifest is read sheet by sheet, and a broken sheet is left out", () => {
  const sheets = readIconSheets({
    assets: {
      worker: {
        file: "w.png",
        width: 28,
        height: 14,
        frameWidth: 14,
        frameHeight: 14,
        frameCount: 2,
        frames: { idle: 1, odd: "x" },
        anchor: [7, 13],
        animations: {},
      },
      plain: {
        file: "p.png",
        width: 10,
        height: 10,
        frameWidth: 10,
        frameHeight: 10,
        anchor: [5, 9],
      },
      noFile: { width: 1 },
      badSize: {
        file: "b.png",
        width: 0,
        height: 1,
        frameWidth: 1,
        frameHeight: 1,
        anchor: [0, 0],
      },
      badAnchor: {
        file: "b.png",
        width: 1,
        height: 1,
        frameWidth: 1,
        frameHeight: 1,
        anchor: ["a", 0],
      },
      noAnchor: {
        file: "b.png",
        width: 1,
        height: 1,
        frameWidth: 1,
        frameHeight: 1,
      },
      list: [1, 2],
    },
  });
  assert.deepEqual(Object.keys(sheets).sort(), ["plain", "worker"]);
  assert.deepEqual(sheets.worker!.frames, { idle: 1 });
  assert.equal(sheets.plain!.frameCount, 1, "a frame count defaults to one");
  assert.deepEqual(sheets.plain!.frames, {});
  assert.deepEqual(readIconSheets(null), {});
  assert.deepEqual(readIconSheets({ assets: [] }), {});
});

test("a picture is one frame, cut off below the feet, at a whole scale", () => {
  assert.equal(standing(sheet()), 14);
  assert.equal(standing(sheet({ anchor: [9, 17], frameHeight: 23 })), 18);
  assert.equal(standing(sheet({ anchor: [0, -5] })), 1);
  assert.deepEqual(
    sheetIcon(sheet({ frames: { idle: 9 } }), "/art/", "idle", 2),
    {
      url: "/art/units/worker-cyan.png",
      width: 28,
      height: 28,
      size: "224px 56px",
      position: "-28px -28px",
    },
  );
  assert.equal(
    sheetIcon(sheet(), "/", "nope", 1).position,
    "0px 0px",
    "an unknown frame is the first",
  );
  assert.equal(
    sheetIcon(sheet({ frames: { idle: 99 } }), "/", "idle", 1).position,
    "-98px -14px",
    "a frame past the end is the last",
  );
  assert.equal(
    sheetIcon(sheet({ width: 5, frames: { idle: 1 } }), "/", "idle", 1)
      .position,
    "0px -14px",
    "a sheet narrower than a frame is one column",
  );
  assert.deepEqual([fit(48, 19), fit(4, 19), fit(48, 0)], [2, 1, 48]);
});

test("unit pictures share one scale fitted to the tallest unit", () => {
  const sheets = {
    "worker-cyan": sheet({ frames: { walk: 0, idle: 9 } }),
    "queen-cyan": sheet({
      file: "units/queen-cyan.png",
      width: 230,
      height: 24,
      frameWidth: 23,
      frameHeight: 24,
      anchor: [11, 18],
    }),
    "queen-pink": sheet({ file: "units/queen-pink.png" }),
  };
  const icons = unitIcons(sheets, "/art/", 0, 48);
  assert.deepEqual(Object.keys(icons).sort(), ["queen", "worker"]);
  assert.deepEqual([icons.queen!.width, icons.queen!.height], [46, 38]);
  assert.deepEqual([icons.worker!.width, icons.worker!.height], [28, 28]);
  assert.deepEqual(Object.keys(unitIcons(sheets, "/art/", 1, 48)), ["queen"]);
  assert.deepEqual(unitIcons({}, "/art/", 0, 48), {});
});

test("the win pictures: the military win picture in the enemy's colour, a full berry pile, the snail", () => {
  const sheets = {
    "win-military-pink": sheet({
      file: "hud/win-military-pink.png",
      width: 22,
      height: 13,
      frameWidth: 22,
      frameHeight: 13,
      frameCount: 1,
      frames: { icon: 0 },
      anchor: [11, 12],
    }),
    "win-military-cyan": sheet({
      file: "hud/win-military-cyan.png",
      width: 22,
      height: 13,
      frameWidth: 22,
      frameHeight: 13,
      frameCount: 1,
      frames: { icon: 0 },
      anchor: [11, 12],
    }),
    "berry-pile": sheet({
      file: "pile.png",
      frames: { "5": 5 },
      frameHeight: 18,
      anchor: [13, 17],
    }),
    snail: sheet({ file: "snail.png", frameHeight: 20, anchor: [20, 19] }),
  };
  const cyan = winIcons(sheets, "/", 0, 40);
  assert.deepEqual(cyan.military, {
    url: "/hud/win-military-pink.png",
    width: 66,
    height: 39,
    size: "66px 39px",
    position: "0px 0px",
  });
  assert.equal(cyan.economy!.url, "/pile.png");
  assert.equal(cyan.economy!.height, 36);
  assert.equal(cyan.snail!.height, 40);
  assert.equal(
    winIcons(sheets, "/", 1, 40).military!.url,
    "/hud/win-military-cyan.png",
  );
  assert.equal(
    winIcons(sheets, "/", -1, 40).military!.url,
    "/hud/win-military-cyan.png",
  );
  assert.deepEqual(winIcons({}, "/", 0, 40), {});
});

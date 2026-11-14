import test from "node:test";
import assert from "node:assert/strict";
import { EAT_STEPS, MAPS, QUEEN_EGGS, TICK_HZ } from "../src/engine/index.js";
import type { ArtManifest, SheetDef } from "../src/render/manifest.js";
import {
  CONTROLS,
  DEVICE_CONTROLS,
  DEVICE_KEYS,
  HIVE_HOLES,
  HOLD_TO_FLAP,
  HOVER_TAPS,
  RULES,
  TOUCH_CONTROLS,
  UNITS,
  WINS,
  WIN_LINE,
  unitIcons,
} from "../src/app/guide.js";

const sheet = (patch: Partial<SheetDef>): SheetDef => ({
  file: "units/worker-cyan.png",
  width: 96,
  height: 56,
  frameWidth: 24,
  frameHeight: 28,
  frameCount: 8,
  frames: { idle: 0 },
  anchor: [12, 27],
  animations: {},
  fps: 1,
  flash: undefined,
  saddle: [],
  slots: [],
  parallax: 1,
  holes: [],
  count: undefined,
  perch: undefined,
  lane: undefined,
  ...patch,
});
const art = (assets: Record<string, SheetDef>): ArtManifest => ({
  canvas: [480, 270],
  teams: {},
  assets,
});

test("the figures come from the engine's tuning", () => {
  assert.equal(HOVER_TAPS, 3, "about three taps a second hover");
  assert.equal(HIVE_HOLES, MAPS[1].holes[0].length);
  for (const id of [1, 2, 3] as const)
    assert.equal(MAPS[id].holes[0].length, HIVE_HOLES, "every hive alike");
  assert.match(WINS[0]!.how, new RegExp(`${QUEEN_EGGS} times`));
  assert.match(WINS[1]!.how, new RegExp(`${HIVE_HOLES} holes`));
  assert.match(WIN_LINE, new RegExp(`Queen ${QUEEN_EGGS}×`));
  const snail = RULES.find((section) => section.title === "SNAIL")!;
  assert.ok(
    snail.lines.some((line) =>
      line.includes(`${Math.round((EAT_STEPS / TICK_HZ) * 10) / 10} s`),
    ),
  );
  const flying = RULES.find((section) => section.title === "FLYING")!;
  assert.ok(flying.lines.some((line) => line.includes(`${HOVER_TAPS} taps`)));
});

test("the guide covers every unit, and every rule section has lines", () => {
  assert.deepEqual(
    UNITS.map((unit) => unit.art),
    ["worker", "speed-worker", "warrior", "speed-warrior", "queen"],
  );
  for (const unit of UNITS) assert.ok(unit.can && unit.cannot, unit.name);
  assert.deepEqual(
    RULES.map((section) => section.title),
    [
      "COMBAT",
      "BERRIES AND HIVE",
      "GATES",
      "SNAIL",
      "FLYING",
      "THE CLOCK AND THE BOTS",
    ],
  );
  for (const section of RULES) assert.ok(section.lines.length > 0);
});

test("the controls name the bindings of controls.ts and no platform drop", () => {
  const all = [
    ...CONTROLS,
    ...TOUCH_CONTROLS,
    ...DEVICE_CONTROLS.pad,
    ...DEVICE_CONTROLS.keys,
  ];
  assert.ok(!all.some((hint) => /drop through/i.test(hint.action)));
  assert.equal(DEVICE_CONTROLS.keys[1]!.keys, "Space");
  assert.match(DEVICE_CONTROLS.keys[1]!.action, /tap about 3 times a second/);
  assert.match(DEVICE_CONTROLS.keys[2]!.action, /Queen dive, hold/);
  assert.equal(DEVICE_CONTROLS.pad[1]!.keys, "A / Cross");
  assert.match(HOLD_TO_FLAP.how, /7\.5 times a second/);
  assert.equal(TOUCH_CONTROLS, DEVICE_CONTROLS.touch);
  assert.deepEqual(Object.keys(DEVICE_KEYS), ["keys", "pad", "touch"]);
});

test("unit icons share one whole scale that fits the tallest unit, cropped at the feet", () => {
  const manifest = art({
    "worker-cyan": sheet({
      file: "units/worker-cyan.png",
      width: 112,
      height: 28,
      frameWidth: 14,
      frameHeight: 14,
      frameCount: 16,
      anchor: [7, 13],
      frames: { walk: 0, idle: 9 },
    }),
    "queen-cyan": sheet({
      file: "units/queen-cyan.png",
      width: 230,
      height: 24,
      frameWidth: 23,
      frameHeight: 24,
      anchor: [11, 18],
    }),
    "queen-pink": sheet({ file: "units/queen-pink.png" }),
  });
  const icons = unitIcons(manifest, "/art/", 0, 48);
  // The Queen stands 19 art pixels to her feet: 48 / 19 rounds down to 2, and every icon is drawn at 2.
  assert.deepEqual(icons.queen, {
    url: "/art/units/queen-cyan.png",
    width: 46,
    height: 38,
    size: "460px 48px",
    position: "0px 0px",
  });
  assert.deepEqual(icons.worker, {
    url: "/art/units/worker-cyan.png",
    width: 28,
    height: 28,
    size: "224px 56px",
    position: "-28px -28px",
  });
  assert.deepEqual(Object.keys(icons).sort(), ["queen", "worker"]);
  // Too small a box still draws one art pixel to the pixel; a team without sheets has none.
  assert.equal(unitIcons(manifest, "/art/", 0, 4).queen?.height, 19);
  assert.deepEqual(Object.keys(unitIcons(manifest, "/art/", 1, 48)), ["queen"]);
  assert.deepEqual(unitIcons(art({}), "/art/", 0, 48), {});
});

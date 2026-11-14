import test from "node:test";
import assert from "node:assert/strict";
import {
  EAT_STEPS,
  FLAP_IMPULSE,
  FLY_GRAVITY,
  MAPS,
  QUEEN_EGGS,
  TICK_HZ,
} from "../src/engine/index.js";
import type { ArtManifest, SheetDef } from "../src/render/manifest.js";
import {
  CONTROLS,
  DEVICE_CONTROLS,
  DEVICE_KEYS,
  HIVE_HOLES,
  HOVER_TAPS,
  RULES,
  TOUCH_CONTROLS,
  UNITS,
  WINS,
  WIN_LINE,
  unitIcon,
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
  assert.equal(HOVER_TAPS, Math.round((FLY_GRAVITY * TICK_HZ) / FLAP_IMPULSE));
  assert.ok(HOVER_TAPS >= 1);
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
  assert.match(DEVICE_CONTROLS.keys[1]!.keys, /Space.*W.*↑.*Z/);
  assert.equal(TOUCH_CONTROLS, DEVICE_CONTROLS.touch);
  assert.deepEqual(Object.keys(DEVICE_KEYS), ["keys", "pad", "touch"]);
});

test("a unit icon is the idle frame of the team's sheet at a whole scale", () => {
  const manifest = art({
    "queen-pink": sheet({
      file: "units/queen-pink.png",
      frames: { walk: 0, idle: 5 },
    }),
  });
  assert.deepEqual(unitIcon(manifest, "/art/", "queen", 1, 56), {
    url: "/art/units/queen-pink.png",
    width: 48,
    height: 56,
    size: "192px 112px",
    position: "-48px -56px",
  });
  // Too small a box still draws one art pixel to the pixel.
  assert.equal(unitIcon(manifest, "/art/", "queen", 1, 4)?.height, 28);
  assert.equal(unitIcon(manifest, "/art/", "queen", 0, 56), undefined);
});

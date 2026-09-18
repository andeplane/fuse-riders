import { test } from "node:test";
import assert from "node:assert/strict";
import {
  POWERUP_PRESETS,
  rarityOf,
  weightFor,
} from "../src/online/powerup-rarity.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";

const defaults = defaultRoomSettings().weights;

test("rarity chips scale each power-up around its default weight and round-trip", () => {
  const power = defaults.power!;
  assert.equal(weightFor("power", "normal", defaults), power);
  assert.equal(weightFor("power", "off", defaults), 0);
  assert.equal(weightFor("power", "rare", defaults), Math.round(power / 3));
  assert.equal(
    weightFor("power", "common", defaults),
    Math.min(10000, power * 3),
  );
  for (const rarity of ["off", "rare", "normal", "common"] as const)
    assert.equal(
      rarityOf("power", weightFor("power", rarity, defaults), defaults),
      rarity,
    );
});

test("star ships enabled, so its rarities scale its own default weight", () => {
  assert.equal(defaults.star, 160);
  assert.equal(weightFor("star", "normal", defaults), 160);
  assert.equal(weightFor("star", "rare", defaults), 53);
  assert.equal(weightFor("star", "common", defaults), 480);
  assert.equal(rarityOf("star", 0, defaults), "off");
  for (const rarity of ["off", "rare", "normal", "common"] as const)
    assert.equal(
      rarityOf("star", weightFor("star", rarity, defaults), defaults),
      rarity,
    );
});

test("a type with no default weight takes its rarities from the median of the enabled defaults", () => {
  // Star is disabled and beer is missing altogether; the enabled weights are 60, 300 and 900, so the median is 300.
  const sparse = { power: 900, gun: 300, shell: 60, star: 0 };
  for (const type of ["star", "beer"] as const) {
    assert.equal(weightFor(type, "normal", sparse), 300);
    assert.equal(weightFor(type, "rare", sparse), 100);
    assert.equal(weightFor(type, "common", sparse), 900);
    assert.equal(weightFor(type, "off", sparse), 0);
    assert.equal(rarityOf(type, 0, sparse), "off");
    for (const rarity of ["rare", "normal", "common"] as const)
      assert.equal(
        rarityOf(type, weightFor(type, rarity, sparse), sparse),
        rarity,
      );
  }
  assert.equal(
    weightFor("gun", "normal", sparse),
    300,
    "an enabled default still scales its own weight",
  );
  assert.equal(weightFor("shell", "common", sparse), 180);
});

test("a hand-typed weight lights the nearest chip", () => {
  const power = defaults.power!;
  assert.equal(rarityOf("power", Math.round(power * 0.95), defaults), "normal");
  // Power's high default puts COMMON at the 10000 cap, so 20% above normal is already nearest to it.
  assert.equal(rarityOf("power", Math.round(power * 1.2), defaults), "common");
  assert.equal(rarityOf("power", Math.round(power / 2.5), defaults), "rare");
});

test("presets: classic restores defaults, chaos makes everything common, no power-ups zeroes all", () => {
  assert.equal(POWERUP_PRESETS["CLASSIC"]!("power", defaults), defaults.power);
  assert.equal(POWERUP_PRESETS["CLASSIC"]!("star", defaults), defaults.star);
  assert.equal(
    POWERUP_PRESETS["CLASSIC"]!("star", { power: 900 }),
    0,
    "classic leaves a type with no default switched off",
  );
  for (const type of Object.keys(defaults) as (keyof typeof defaults)[])
    assert.equal(
      POWERUP_PRESETS["CHAOS"]!(type, defaults),
      weightFor(type, "common", defaults),
    );
  assert.equal(POWERUP_PRESETS["CHAOS"]!("star", defaults), 480);
  assert.equal(POWERUP_PRESETS["NO POWER-UPS"]!("power", defaults), 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultRoomSettings,
  parseRoomSettings,
  roomPickup,
  loadRoomSettings,
  SETTINGS_KEY,
} from "../src/engine/room-settings.js";
import { BOMB_MAX_CHARGE_TICKS } from "../src/engine/bomb-launch.js";
import { ARENA_MAP_CHOICES } from "../src/engine/arena-map.js";
test("old browser preferences reset to current defaults, and new preferences persist", () => {
  const defaults = defaultRoomSettings();
  const saved = new Map<string, string>([
    [
      "fuse-riders-room-settings-v1",
      JSON.stringify({ ...defaults, length: 9, weights: { power: 8000 } }),
    ],
  ]);
  const storage = { getItem: (key: string) => saved.get(key) ?? null };
  const reset = loadRoomSettings(storage);
  assert.deepEqual(reset, defaults);
  assert.ok(reset.weights.nitro! > 0);
  assert.ok(reset.weights.snail! > 0);

  // Reset only once: an explicit choice made after the reset still wins on reload.
  const updated = {
    ...defaults,
    length: 3,
    weights: { ...defaults.weights, nitro: 0 },
  };
  saved.set(SETTINGS_KEY, JSON.stringify(updated));
  assert.deepEqual(loadRoomSettings(storage), updated);
});

test("room settings reject malformed values, restore safe defaults and allow all drops off", () => {
  const defaults = defaultRoomSettings();
  assert.deepEqual(parseRoomSettings(defaults), defaults);
  assert.equal(parseRoomSettings({ ...defaults, length: 0 }), undefined);
  assert.equal(
    parseRoomSettings({ ...defaults, weights: { shell: Infinity } }),
    undefined,
  );
  assert.equal(
    parseRoomSettings({ ...defaults, weights: { bad: 2 } }),
    undefined,
  );
  assert.equal(roomPickup(0.5, {}), undefined);
  assert.equal(roomPickup(0.1, { shell: 1, gun: 3 }), "gun");
  assert.equal(roomPickup(0.9, { shell: 1, gun: 3 }), "shell");
  assert.deepEqual(loadRoomSettings({ getItem: () => "{broken" }), defaults);
});
test("the arena map validates, and a preference saved before maps existed opts into the rotation", () => {
  const defaults = defaultRoomSettings();
  assert.equal(
    defaults.map,
    "rotate",
    "a new room rotates the maps rather than hiding them behind a setting",
  );
  for (const map of ARENA_MAP_CHOICES)
    assert.equal(parseRoomSettings({ ...defaults, map })?.map, map, map);
  for (const bad of ["atlantis", "", "rotates", 1, null])
    assert.equal(
      parseRoomSettings({ ...defaults, map: bad }),
      undefined,
      String(bad),
    );
  // The migration this exists for: a blob saved before maps reaches what a new room would choose, not the classic arena.
  const { map: _map, ...older } = defaults;
  assert.deepEqual(parseRoomSettings(older), { ...defaults, map: "rotate" });
  assert.equal(
    loadRoomSettings({ getItem: () => JSON.stringify(older) }).map,
    "rotate",
  );
  assert.equal(
    loadRoomSettings({
      getItem: () => JSON.stringify({ ...defaults, map: "city" }),
    }).map,
    "city",
    "an explicit choice is kept",
  );
});
test("bomb aim time, chain reaction and aim bounce validate, and older saved preferences get the defaults", () => {
  const defaults = defaultRoomSettings();
  for (const bad of [0, 1.5, 41, "8"])
    assert.equal(
      parseRoomSettings({ ...defaults, bombChargeTicks: bad }),
      undefined,
      String(bad),
    );
  assert.equal(
    parseRoomSettings({ ...defaults, chainReaction: "yes" }),
    undefined,
  );
  assert.equal(parseRoomSettings({ ...defaults, aimBounce: 1 }), undefined);
  const {
    bombChargeTicks: _charge,
    chainReaction: _chain,
    aimBounce: _bounce,
    ...older
  } = defaults;
  assert.deepEqual(parseRoomSettings(older), {
    ...defaults,
    bombChargeTicks: BOMB_MAX_CHARGE_TICKS,
    chainReaction: true,
    aimBounce: true,
  });
  assert.deepEqual(
    loadRoomSettings({
      getItem: () =>
        JSON.stringify({ ...older, bombChargeTicks: 24, chainReaction: false }),
    }),
    { ...defaults, bombChargeTicks: 24, chainReaction: false },
  );
});

test("a pickup enabled since the save drops at its default, and an explicit off stays off", () => {
  const defaults = defaultRoomSettings();
  const { star: _star, ...beforeStar } = defaults.weights;
  const load = (weights: Record<string, number>) =>
    loadRoomSettings({
      getItem: () => JSON.stringify({ ...defaults, length: 9, weights }),
    });
  assert.deepEqual(
    load({ ...beforeStar, gun: 7 }),
    { ...defaults, length: 9, weights: { ...defaults.weights, gun: 7 } },
    "a blob saved before Star had a default gets it, and keeps its own weights",
  );
  assert.equal(load({ ...beforeStar, star: 0 }).weights.star, 0);
});

test("saved preferences that still weigh a retired pickup keep everything else", () => {
  const defaults = defaultRoomSettings();
  const saved = {
    ...defaults,
    length: 9,
    weights: { ...defaults.weights, boost: 160, target: 165, gun: 7 },
  };
  assert.equal(
    parseRoomSettings(saved),
    undefined,
    "the wire still refuses a pickup the rules do not know",
  );
  assert.deepEqual(loadRoomSettings({ getItem: () => JSON.stringify(saved) }), {
    ...defaults,
    length: 9,
    weights: { ...defaults.weights, gun: 7 },
  });
});

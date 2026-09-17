import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultRoomSettings,
  parseRoomSettings,
  roomPickup,
  loadRoomSettings,
} from "../src/shared/room-settings.js";
import { BOMB_MAX_CHARGE_TICKS } from "../src/shared/bomb-launch.js";
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
  assert.equal(roomPickup(0.1, { shell: 1, gun: 3 }), "shell");
  assert.equal(roomPickup(0.9, { shell: 1, gun: 3 }), "gun");
  assert.deepEqual(loadRoomSettings({ getItem: () => "{broken" }), defaults);
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

test("saved preferences that still weigh a retired pickup keep everything else", () => {
  const defaults = defaultRoomSettings();
  const saved = {
    ...defaults,
    length: 9,
    weights: { ...defaults.weights, boost: 160, gun: 7 },
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

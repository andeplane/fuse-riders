import test from "node:test";
import assert from "node:assert/strict";
import { createPreferencesStore } from "../src/app/preferences.js";

const memory = (initial: Record<string, string>) => {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
};

test("settings saved under the game's old working name carry over and are rewritten under the new key", () => {
  const storage = memory({
    "neural-defence-presentation-v1":
      '{"mute":false,"volume":0.25,"reducedMotion":true,"edgeScroll":false}',
  });
  const store = createPreferencesStore(storage);
  const carried = store.read();
  assert.deepEqual(carried, {
    mute: false,
    volume: 0.25,
    reducedMotion: true,
    edgeScroll: false,
  });
  store.write({ ...carried, volume: 0.75 });
  assert.equal(
    JSON.parse(storage.values.get("fuse-craft-presentation-v1") ?? "{}").volume,
    0.75,
  );
  assert.equal(store.read().volume, 0.75);
});

test("the new key wins over the old one", () => {
  const store = createPreferencesStore(
    memory({
      "fuse-craft-presentation-v1": '{"mute":true}',
      "neural-defence-presentation-v1": '{"mute":false}',
    }),
  );
  assert.equal(store.read().mute, true);
});

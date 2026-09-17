import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIO_SETTINGS_KEY,
  DEFAULT_VOLUME,
  loadAudioSettings,
  requestAmbientAudio,
} from "../src/client/game-audio.ts";
import { createMemoryStorage } from "../src/client/safe-storage.ts";

const defaults = {
  muted: { music: false, effects: false },
  volume: { ...DEFAULT_VOLUME },
};

// Audio settings have to survive the full page load between the landing page and a room, so a
// turned-off soundtrack stays off instead of restarting at full volume on the next screen.
test("mute and volume round-trip through storage per channel", () => {
  const storage = createMemoryStorage();
  assert.deepEqual(
    loadAudioSettings(storage),
    defaults,
    "a first visit uses the defaults",
  );
  storage.setItem(
    AUDIO_SETTINGS_KEY,
    JSON.stringify({
      muted: { music: true, effects: false },
      volume: { music: 0.8, effects: 0 },
    }),
  );
  assert.deepEqual(loadAudioSettings(storage), {
    muted: { music: true, effects: false },
    volume: { music: 0.8, effects: 0 },
  });
});

test("a partial or out-of-range record keeps the defaults for whatever it does not say", () => {
  const storage = createMemoryStorage();
  storage.setItem(
    AUDIO_SETTINGS_KEY,
    JSON.stringify({ muted: { music: true } }),
  );
  assert.deepEqual(loadAudioSettings(storage), {
    muted: { music: true, effects: false },
    volume: { ...DEFAULT_VOLUME },
  });
  storage.setItem(
    AUDIO_SETTINGS_KEY,
    JSON.stringify({ volume: { music: 9, effects: -3 } }),
  );
  assert.deepEqual(
    loadAudioSettings(storage).volume,
    { music: 1, effects: 0 },
    "volume is clamped, not trusted",
  );
  storage.setItem(
    AUDIO_SETTINGS_KEY,
    JSON.stringify({ volume: { music: "loud", effects: null } }),
  );
  assert.deepEqual(
    loadAudioSettings(storage).volume,
    { ...DEFAULT_VOLUME },
    "a non-number falls back",
  );
});

// Phones cannot play before a tap, so music starts off there and the toggle is what turns it on; a stored choice still wins.
test("music can start off by default, and a stored choice overrides that default either way", () => {
  const storage = createMemoryStorage();
  assert.deepEqual(
    loadAudioSettings(storage, true).muted,
    { music: true, effects: false },
    "first visit on a phone",
  );
  assert.deepEqual(
    loadAudioSettings(storage, false).muted,
    { music: false, effects: false },
    "first visit elsewhere",
  );
  storage.setItem(
    AUDIO_SETTINGS_KEY,
    JSON.stringify({ muted: { music: false, effects: false } }),
  );
  assert.deepEqual(
    loadAudioSettings(storage, true).muted,
    { music: false, effects: false },
    "a phone that turned music on keeps it on",
  );
  storage.setItem(
    AUDIO_SETTINGS_KEY,
    JSON.stringify({ muted: { music: true, effects: false } }),
  );
  assert.deepEqual(
    loadAudioSettings(storage, false).muted,
    { music: true, effects: false },
    "a desktop that turned music off keeps it off",
  );
});

// iOS mutes an ambient session with the silent switch and ignores it for a playback session, which is what a page
// with a media element gets by default; the page asks for ambient wherever the Audio Session API exists.
test("the audio session is asked to be ambient where the API exists and ignored where it does not", () => {
  const session = { type: "auto" };
  assert.equal(requestAmbientAudio({ audioSession: session }), true);
  assert.equal(session.type, "ambient");
  assert.equal(requestAmbientAudio({}), false, "no API");
  assert.equal(
    requestAmbientAudio({ audioSession: null }),
    false,
    "a null session is not an API",
  );
  const readOnly = Object.freeze({ type: "auto" });
  assert.equal(
    requestAmbientAudio({ audioSession: readOnly }),
    false,
    "a session that rejects the type reports that instead of throwing",
  );
});

test("corrupt or blocked storage reads as the defaults rather than crashing startup", () => {
  const storage = createMemoryStorage();
  for (const junk of [
    "",
    "not json",
    "null",
    "7",
    '"music"',
    "[]",
    '{"muted":5}',
  ]) {
    storage.setItem(AUDIO_SETTINGS_KEY, junk);
    assert.deepEqual(loadAudioSettings(storage), defaults, junk);
  }
  const blocked = {
    getItem(): string {
      throw new Error("SecurityError");
    },
    setItem() {},
    removeItem() {},
  };
  assert.deepEqual(loadAudioSettings(blocked), defaults);
});

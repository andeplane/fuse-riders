import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDIO_SETTINGS_KEY, DEFAULT_VOLUME, loadAudioSettings } from '../src/client/game-audio.ts';
import { createMemoryStorage } from '../src/client/safe-storage.ts';

const defaults = { muted: { music: false, effects: false }, volume: { ...DEFAULT_VOLUME } };

// Audio settings have to survive the full page load between the landing page and a room, so a
// turned-off soundtrack stays off instead of restarting at full volume on the next screen.
test('mute and volume round-trip through storage per channel', () => {
  const storage = createMemoryStorage();
  assert.deepEqual(loadAudioSettings(storage), defaults, 'a first visit uses the defaults');
  storage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify({ muted: { music: true, effects: false }, volume: { music: .8, effects: 0 } }));
  assert.deepEqual(loadAudioSettings(storage), { muted: { music: true, effects: false }, volume: { music: .8, effects: 0 } });
});

test('a partial or out-of-range record keeps the defaults for whatever it does not say', () => {
  const storage = createMemoryStorage();
  storage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify({ muted: { music: true } }));
  assert.deepEqual(loadAudioSettings(storage), { muted: { music: true, effects: false }, volume: { ...DEFAULT_VOLUME } });
  storage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify({ volume: { music: 9, effects: -3 } }));
  assert.deepEqual(loadAudioSettings(storage).volume, { music: 1, effects: 0 }, 'volume is clamped, not trusted');
  storage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify({ volume: { music: 'loud', effects: null } }));
  assert.deepEqual(loadAudioSettings(storage).volume, { ...DEFAULT_VOLUME }, 'a non-number falls back');
});

test('corrupt or blocked storage reads as the defaults rather than crashing startup', () => {
  const storage = createMemoryStorage();
  for (const junk of ['', 'not json', 'null', '7', '"music"', '[]', '{"muted":5}']) {
    storage.setItem(AUDIO_SETTINGS_KEY, junk);
    assert.deepEqual(loadAudioSettings(storage), defaults, junk);
  }
  const blocked = { getItem(): string { throw new Error('SecurityError'); }, setItem() {}, removeItem() {} };
  assert.deepEqual(loadAudioSettings(blocked), defaults);
});

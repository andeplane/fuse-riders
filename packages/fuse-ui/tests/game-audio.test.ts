import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDIO_KEY,
  createGameAudio,
  createAudioControl,
  readPrefs,
  type AudioLike,
  type BufferSourceLike,
  type FilterLike,
  type GainLike,
  type GameAudioDependencies,
  type MusicElement,
  type NodeLike,
  type OscillatorLike,
  type ParamLike,
} from "../src/game-audio.js";
import { createAudioRig } from "../src/game-audio-fake.js";
import { createMemoryStorage } from "../src/safe-storage.js";
import { page } from "./dom-fixture.js";

test("an effects-only bus exposes no disconnected music volume control", () => {
  const { document } = page();
  const rig = createAudioRig();
  const audio = createGameAudio(rig.deps);
  const control = createAudioControl(document, audio, { music: false });
  const inputs = control.element.querySelectorAll("input");
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0]?.closest("label")?.textContent?.trim(), "Effects");
  control.destroy();
});

/** Runs a handler the way the browser would: with the element as `this` and an event. */
function fire(el: MusicElement, which: "onended" | "onerror") {
  el[which]?.call(el as unknown as GlobalEventHandlers, new Event("x"));
}
const songs = [
  { id: "a", title: "A", path: "music/g/a.mp3" },
  { id: "b", title: "B", path: "music/g/b.mp3" },
];

test("a muted preview never opens audio or writes a choice", () => {
  const r = createAudioRig();
  const audio = createGameAudio(r.deps, { forceMute: true });
  audio.unlock();
  audio.tone({ frequency: 440, duration: 0.1 });
  audio.setMuted(true);
  audio.setVolume("music", 0.1);
  audio.setSongs(songs, "/");
  audio.startMusic();
  assert.equal(r.log.opens, 0);
  assert.equal(r.storage.getItem(AUDIO_KEY), null);
  assert.equal(audio.audible, false);
  assert.equal(r.elements.length, 0);
});

test("nothing sounds before the first input, then effects play", () => {
  const r = createAudioRig("suspended");
  const audio = createGameAudio(r.deps);
  audio.tone({ frequency: 440, duration: 0.1 });
  assert.equal(r.log.oscillators, 0);
  assert.equal(r.log.opens, 0, "audio opens lazily");
  audio.unlock();
  assert.equal(r.log.resumes, 1);
});

test("effects, noise and jingles reach the speakers once unlocked", async () => {
  const r = createAudioRig("suspended");
  const audio = createGameAudio(r.deps);
  audio.unlock();
  await Promise.resolve();
  audio.tone({ frequency: 440, duration: 0.1, slide: 2 });
  audio.noise({ duration: 0.1 });
  audio.jingle([1, 2, 3], 50);
  r.timers.forEach((run) => run());
  assert.equal(r.log.oscillators, 4);
  assert.equal(r.log.noises, 1);
});

test("mute and volumes are remembered and shared through storage", () => {
  const r = createAudioRig();
  const audio = createGameAudio(r.deps);
  audio.unlock();
  let changes = 0;
  const stop = audio.onChange(() => changes++);
  audio.toggleMuted();
  audio.setVolume("music", 2);
  assert.equal(audio.prefs.muted, false, "touching a slider unmutes");
  assert.equal(audio.prefs.music, 1, "volumes clamp");
  audio.setMuted(true);
  stop();
  audio.setMuted(false);
  assert.equal(changes, 3);
  const again = createGameAudio({ ...r.deps });
  assert.equal(again.prefs.muted, false);
  assert.equal(again.prefs.music, 1);
  audio.setMuted(true);
  assert.equal(readPrefs(r.storage).muted, true);
  const muted = createGameAudio(r.deps);
  muted.unlock();
  muted.tone({ frequency: 1, duration: 1 });
  assert.equal(r.log.oscillators, 0, "a remembered mute stays quiet");
});

test("corrupt stored choices fall back to the defaults", () => {
  const storage = createMemoryStorage();
  storage.setItem(AUDIO_KEY, "{nope");
  assert.equal(readPrefs(storage).muted, false);
  storage.setItem(
    AUDIO_KEY,
    JSON.stringify({ muted: true, music: "x", effects: 5 }),
  );
  const prefs = readPrefs(storage);
  assert.deepEqual([prefs.muted, prefs.effects], [true, 1]);
  assert.ok(prefs.music > 0);
});

test("songs load only after unlock, loop alone, advance in a list, and pause on mute", async () => {
  const r = createAudioRig("suspended");
  const audio = createGameAudio(r.deps);
  audio.setSongs(songs, "/base");
  audio.startMusic();
  assert.equal(
    r.elements.length,
    0,
    "no song is fetched before the first input",
  );
  audio.unlock();
  await Promise.resolve();
  const el = r.elements[0]!;
  assert.equal(el.src, "/base/music/g/a.mp3");
  assert.equal(el.plays, 2, "once inside the gesture, once after resume");
  assert.equal(audio.nowPlaying?.id, "a");
  fire(el, "onended");
  assert.equal(el.src, "/base/music/g/b.mp3");
  audio.nextSong();
  assert.equal(el.src, "/base/music/g/a.mp3");
  audio.setMuted(true);
  const pauses = el.pauses;
  assert.ok(pauses > 0);
  audio.setMuted(false);
  assert.ok(el.plays >= 2, "music comes back on unmute");
  audio.stopMusic();
  audio.setHidden(true);
  audio.setHidden(true);
  assert.equal(audio.audible, false);
  audio.setHidden(false);
  await Promise.resolve();
  const single = createGameAudio(createAudioRig().deps);
  single.setSongs([songs[0]!], "/");
  single.unlock();
  single.startMusic();
});

test("a single song loops and a failing song is skipped once", async () => {
  const r = createAudioRig();
  const audio = createGameAudio(r.deps);
  audio.setSongs([songs[0]!], "/");
  audio.unlock();
  audio.startMusic();
  assert.equal(r.elements[0]!.loop, true);
  const two = createAudioRig();
  const both = createGameAudio(two.deps);
  both.setSongs(songs, "/");
  both.unlock();
  both.startMusic();
  const el = two.elements[0]!;
  fire(el, "onerror");
  assert.equal(el.src, "/music/g/b.mp3");
  fire(el, "onerror");
  assert.equal(
    el.src,
    "/music/g/b.mp3",
    "every song failing stops the skipping",
  );
  both.setSongs([], "/");
  both.nextSong();
});

test("ducking drops the music for a moment then restores it", async () => {
  const r = createAudioRig();
  const audio = createGameAudio(r.deps);
  audio.unlock();
  audio.duck();
  const duck = r.gains[2]!.gain;
  assert.equal(duck.value, 0.35);
  r.timers.at(-1)!();
  assert.equal(duck.value, 1);
  audio.duck({ keep: 0.1 });
  audio.duck({ keep: 0.2 });
  r.timers.at(-2)!();
  assert.equal(duck.value, 0.2, "an older duck does not undo a newer one");
});

test("the first gesture starts the song at once, and a hidden tab pauses it", () => {
  const r = createAudioRig("suspended");
  const audio = createGameAudio(r.deps);
  audio.setSongs(songs, "/");
  audio.startMusic();
  audio.unlock();
  const el = r.elements[0]!;
  assert.equal(
    el.plays,
    1,
    "play() runs inside the gesture, before resume settles",
  );
  audio.setHidden(true);
  assert.ok(el.pauses > 0);
  audio.setSongs([songs[1]!], "/");
  assert.equal(el.onended, null, "a replaced song's handlers are dropped");
});

test("a hum is made when first heard, glides, and falls silent when the tab hides", () => {
  const r = createAudioRig();
  const audio = createGameAudio(r.deps);
  const hum = audio.hum({ sub: "square" });
  hum.set(100, 0.05);
  assert.equal(r.log.oscillators, 0, "nothing before the first input");
  audio.unlock();
  hum.set(100, 0);
  assert.equal(r.log.oscillators, 0, "silence makes nothing");
  hum.set(100, 0.05);
  hum.set(140, 0.08);
  assert.equal(r.log.oscillators, 2, "one voice and its octave, made once");
  const gain = r.gains.at(-1)!;
  assert.equal(gain.gain.value, 0.08);
  hum.set(140, 0);
  assert.equal(gain.gain.value, 0, "silence is heard by a live voice");
  hum.set(140, 0.08);
  audio.setMuted(true);
  hum.set(140, 0.08);
  assert.equal(gain.gain.value, 0, "a muted voice keeps no volume for later");
  audio.setMuted(false);
  hum.set(140, 0.08);
  assert.equal(gain.gain.value, 0.08);
  audio.setHidden(true);
  assert.equal(gain.gain.value, 0);
  hum.set(140, 0.08);
  assert.equal(gain.gain.value, 0, "still hidden");
  audio.setHidden(false);
  // The fake's context resumes on a microtask.
  return Promise.resolve().then(() => {
    hum.set(140, 0.08);
    assert.equal(gain.gain.value, 0.08);
  });
});

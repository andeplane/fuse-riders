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

test("a muted preview has no clock and loads no song", async () => {
  const r = createAudioRig();
  r.addSong("/s.mp3", 60);
  const audio = createGameAudio(r.deps, { forceMute: true });
  assert.equal(audio.clock(), undefined);
  assert.equal(await audio.loadSong("/s.mp3"), undefined);
  assert.deepEqual([r.log.opens, r.log.fetches], [0, 0]);
  const none = createGameAudio({ ...r.deps, open: () => undefined });
  assert.equal(none.clock(), undefined, "no Web Audio, no clock");
  assert.equal(await none.loadSong("/s.mp3"), undefined);
});

test("the clock reads the context, its latency and whether it advances", async () => {
  const r = createAudioRig("suspended");
  const audio = createGameAudio(r.deps);
  const clock = audio.clock()!;
  assert.equal(r.log.opens, 1, "asking for the clock opens the context");
  assert.equal(audio.clock(), clock);
  assert.equal(clock.running, false, "not before the first input");
  r.context.currentTime = 12.5;
  assert.equal(clock.now(), 12.5);
  assert.equal(clock.latency(), 0, "no latency reported");
  r.context.baseLatency = 0.01;
  assert.equal(clock.latency(), 0.01, "the base latency stands in");
  r.context.outputLatency = 0;
  assert.equal(clock.latency(), 0.01, "a zero output latency is not known yet");
  r.context.outputLatency = 0.042;
  assert.equal(clock.latency(), 0.042);
  r.context.outputLatency = Number.NaN;
  r.context.baseLatency = -1;
  assert.equal(clock.latency(), 0);
  audio.unlock();
  await Promise.resolve();
  assert.equal(clock.running, true);
  audio.setMuted(true);
  assert.equal(clock.running, true, "a muted player still has a clock");
  audio.setHidden(true);
  assert.equal(clock.running, false, "a hidden tab's clock stops");
  audio.setHidden(false);
  await Promise.resolve();
  assert.equal(clock.running, true);
});

test("a song is fetched and decoded once, and failures are retried", async () => {
  const r = createAudioRig();
  const audio = createGameAudio(r.deps);
  r.addSong("/a.mp3", 90);
  const [first, again] = await Promise.all([
    audio.loadSong("/a.mp3"),
    audio.loadSong("/a.mp3"),
  ]);
  assert.equal(first?.duration, 90);
  assert.equal(again, first, "the same song while it is cached");
  assert.equal(r.log.fetches, 1);
  assert.equal(await audio.loadSong("/missing.mp3"), undefined);
  r.files.set("/noise.bin", new ArrayBuffer(4));
  assert.equal(await audio.loadSong("/noise.bin"), undefined, "not audio");
  r.addSong("/missing.mp3", 30);
  assert.equal((await audio.loadSong("/missing.mp3"))?.duration, 30);
  const bare = createGameAudio({ ...r.deps, fetchAudio: undefined });
  assert.equal(
    await bare.loadSong("/a.mp3"),
    undefined,
    "nothing to fetch with",
  );
});

test("only the latest decoded songs are kept", async () => {
  const r = createAudioRig();
  const audio = createGameAudio(r.deps);
  for (const name of ["a", "b", "c", "d"]) r.addSong(name, 10);
  const a = await audio.loadSong("a");
  await audio.loadSong("b");
  await audio.loadSong("c");
  assert.equal(await audio.loadSong("a"), a, "asked for again, so kept");
  await audio.loadSong("d");
  assert.equal(r.log.fetches, 4);
  assert.equal(await audio.loadSong("a"), a);
  assert.equal(r.log.fetches, 4, "the oldest went, not the one just used");
  await audio.loadSong("b");
  assert.equal(r.log.fetches, 5, "b was dropped and is fetched again");
});

test("a clocked song starts on the music bus at the asked clock time", async () => {
  const r = createAudioRig();
  const audio = createGameAudio(r.deps);
  audio.unlock();
  r.addSong("/a.mp3", 90);
  const song = (await audio.loadSong("/a.mp3"))!;
  const made = r.buffers.length;
  r.context.currentTime = 10;
  song.play(10.5, 3);
  const source = r.buffers.at(-1)!;
  assert.equal(r.buffers.length, made + 1);
  assert.deepEqual(source.started, { at: 10.5, offset: 3 });
  assert.equal(source.output, r.gains[2], "through the duck bus");
  assert.equal(source.buffer?.duration, 90);
  assert.equal(song.playing, true);

  song.play(8, 3);
  assert.equal(source.stopped, true, "a new play replaces the old one");
  assert.equal(source.output, undefined);
  assert.deepEqual(
    r.buffers.at(-1)!.started,
    { at: 10, offset: 5 },
    "late: starts now from where it would have got to",
  );

  song.play(10.5, -2);
  assert.deepEqual(
    r.buffers.at(-1)!.started,
    { at: 12.5, offset: 0 },
    "a negative offset waits",
  );
  song.play(7, -2);
  assert.deepEqual(
    r.buffers.at(-1)!.started,
    { at: 10, offset: 1 },
    "a wait that is already over",
  );

  const count = r.buffers.length;
  song.play(10, 90);
  assert.equal(song.playing, false, "past the end plays nothing");
  song.play(Number.NaN, 0);
  assert.equal(r.buffers.length, count);
  assert.equal(r.buffers.at(-1)!.stopped, true);

  song.play(10, 0);
  const last = r.buffers.at(-1)!;
  song.stop();
  song.stop();
  assert.deepEqual([last.stopped, song.playing], [true, false]);
  assert.equal(last.onended, null);

  song.play(10, 0);
  const ending = r.buffers.at(-1)!;
  ending.end();
  assert.equal(song.playing, false, "the song ran out");
  assert.equal(ending.stopped, false);
  song.play(10, 0);
  ending.end();
  assert.equal(
    song.playing,
    true,
    "an old source ending does not end a new play",
  );
});

test("the looping music waits while a clocked song plays", async () => {
  const r = createAudioRig();
  const audio = createGameAudio(r.deps);
  audio.setSongs(songs, "/");
  audio.unlock();
  audio.startMusic();
  const el = r.elements[0]!;
  r.addSong("/a.mp3", 90);
  const song = (await audio.loadSong("/a.mp3"))!;
  const { plays, pauses } = el;
  song.play(0, 0);
  assert.equal(el.pauses, pauses + 1, "the lobby music pauses");
  audio.unlock();
  audio.setMuted(true);
  audio.setMuted(false);
  audio.nextSong();
  fire(el, "onended");
  audio.setHidden(true);
  audio.setHidden(false);
  await Promise.resolve();
  assert.equal(el.plays, plays, "and nothing starts it under the song");
  song.stop();
  assert.equal(el.plays, plays + 1, "it comes back after the song");

  song.play(0, 0);
  r.buffers.at(-1)!.end();
  assert.equal(el.plays, plays + 2, "and after a song that ran out");

  song.play(0, 0);
  audio.stopMusic();
  song.stop();
  assert.equal(el.plays, plays + 2, "unless music is no longer wanted");

  const gesture = createAudioRig("suspended");
  const waiting = createGameAudio(gesture.deps);
  gesture.addSong("/a.mp3", 90);
  waiting.setSongs(songs, "/");
  waiting.startMusic();
  const early = (await waiting.loadSong("/a.mp3"))!;
  early.play(0, 0);
  waiting.unlock();
  await Promise.resolve();
  assert.equal(
    gesture.elements.length,
    0,
    "the first gesture does not start it either",
  );
});

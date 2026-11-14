import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { MUSIC_TRACKS } from "fuse-ui/assets";
import type { MusicPlayer } from "fuse-ui/radio";
import { createChopperRadio, RADIO_KEY } from "../src/app/radio.js";

function setup({ muted = false, autoStart = false, saved = "null" } = {}) {
  const { document, window } = parseHTML("<html><body></body></html>");
  const values = new Map([[RADIO_KEY, saved]]);
  let plays = 0;
  let pauses = 0;
  const player: MusicPlayer = {
    src: "",
    volume: 0,
    onended: null,
    onerror: null,
    play: async () => {
      plays++;
    },
    pause: () => {
      pauses++;
    },
    load() {},
  };
  const radio = createChopperRadio({
    document: document as unknown as Document,
    player,
    store: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
    baseUrl: "/party/",
    muted,
    autoStart,
  });
  const buttons = radio.element.querySelectorAll("button");
  const [previous, play, next, loop] = buttons;
  const ended = () =>
    player.onended?.call(
      {} as HTMLAudioElement,
      new window.Event("ended") as unknown as Event,
    );
  const error = () =>
    player.onerror?.call(
      {} as GlobalEventHandlers,
      new window.Event("error") as unknown as Event,
    );
  return {
    radio,
    player,
    values,
    window,
    previous: previous!,
    play: play!,
    next: next!,
    loop: loop!,
    ended,
    error,
    get plays() {
      return plays;
    },
    get pauses() {
      return pauses;
    },
  };
}
test("master mute resumes the selected playing radio and cannot override preview mute", () => {
  const active = setup({ autoStart: true });
  active.radio.unlock();
  assert.equal(active.plays, 1);
  active.radio.setMuted(true);
  assert.ok(active.pauses > 0);
  active.radio.setMuted(false);
  assert.equal(active.plays, 2);
  active.radio.destroy();
  const preview = setup({ muted: true, autoStart: true });
  preview.radio.setMuted(false);
  preview.radio.unlock();
  assert.equal(preview.plays, 0);
  preview.radio.destroy();
});

test("desktop unlock starts once; touch is opt-in and pause survives navigation", () => {
  const desktop = setup({ autoStart: true });
  assert.equal(desktop.plays, 0);
  desktop.radio.unlock();
  desktop.radio.unlock();
  assert.equal(desktop.plays, 1);
  assert.equal(desktop.player.src, "/party/" + MUSIC_TRACKS[0].path.slice(1));
  desktop.play.click();
  assert.equal(desktop.play.textContent, "PLAY");
  const restored = setup({
    autoStart: true,
    saved: desktop.values.get(RADIO_KEY)!,
  });
  restored.radio.unlock();
  assert.equal(restored.plays, 0);
  const touch = setup();
  touch.radio.unlock();
  assert.equal(touch.plays, 0);
  touch.play.click();
  assert.equal(touch.plays, 1);
});

test("track navigation wraps, ended advances or repeats, volume and selection persist", () => {
  const f = setup();
  f.play.click();
  f.previous.click();
  assert.ok(f.player.src.endsWith(MUSIC_TRACKS.at(-1)!.path));
  f.next.click();
  f.ended();
  assert.ok(f.player.src.endsWith(MUSIC_TRACKS[1].path));
  f.loop.click();
  f.ended();
  assert.ok(f.player.src.endsWith(MUSIC_TRACKS[1].path));
  const volume = f.radio.element.querySelector("input")!;
  volume.value = "42";
  volume.dispatchEvent(new f.window.Event("input"));
  assert.equal(f.player.volume, 0.42);
  const restored = setup({ saved: f.values.get(RADIO_KEY)! });
  restored.radio.unlock();
  assert.equal(restored.player.src, f.player.src);
  assert.equal(restored.player.volume, 0.42);
  assert.equal(restored.loop.getAttribute("aria-pressed"), "true");
});

test("muted preview never loads or plays music or changes saved preferences", () => {
  const saved = JSON.stringify({ playing: true, volume: 0.5 });
  const f = setup({ muted: true, saved });
  f.radio.unlock();
  for (const control of f.radio.element.querySelectorAll(
    "button:not(:last-child), select, input",
  ))
    assert.ok(control.hasAttribute("disabled"));
  f.play.click();
  f.next.click();
  f.loop.click();
  f.ended();
  assert.equal(f.player.src, "");
  assert.equal(f.plays, 0);
  assert.equal(f.values.get(RADIO_KEY), saved);
});

test("failures allow retry and stale play rejection cannot stop a newer track", async () => {
  const f = setup();
  let reject = (_reason: Error) => {};
  f.player.play = () =>
    new Promise<void>((_resolve, fail) => {
      reject = fail;
    });
  f.play.click();
  const oldReject = reject;
  f.next.click();
  oldReject(new Error("old"));
  await Promise.resolve();
  assert.equal(f.play.textContent, "PAUSE");
  reject(new Error("blocked"));
  await Promise.resolve();
  assert.equal(f.play.textContent, "PLAY");
  assert.match(f.radio.element.textContent!, /Playback unavailable/);
  f.player.play = async () => {};
  f.play.click();
  assert.equal(f.play.textContent, "PAUSE");
  f.error();
  assert.match(f.radio.element.textContent!, /Track unavailable/);
  f.play.click();
  assert.equal(f.play.textContent, "PAUSE");
  f.radio.destroy();
  assert.equal(f.player.src, "");
  assert.equal(f.player.onended, null);
  assert.equal(f.player.onerror, null);
  assert.ok(f.pauses > 0);
});

test("corrupt preferences fall back safely", () => {
  for (const saved of [
    "broken",
    "[]",
    '{"track":"unknown","volume":"bad","playing":4}',
  ]) {
    const f = setup({ saved });
    f.play.click();
    assert.ok(f.player.src.endsWith(MUSIC_TRACKS[0].path));
    assert.equal(f.player.volume, 0.22);
  }
});

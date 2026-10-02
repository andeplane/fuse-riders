import assert from "node:assert/strict";
import { chromium } from "playwright";

// Native Web Audio lifecycle check, not an audible-quality test. Instrument
// source (oscillator and noise) disconnection only. Browser output and the app
// stay muted.
const browser = await chromium.launch({ args: ["--mute-audio"] });
try {
  const page = await browser.newPage();
  await page.goto(
    process.argv[2] ??
      process.env.FUSE_CRAFT_URL ??
      "http://127.0.0.1:5174/games/fuse-craft/?mute",
  );
  const result = await page.evaluate(async () => {
    const moduleUrl = "/games/fuse-craft/src/app/audio.ts";
    const audio: typeof import("../games/fuse-craft/src/app/audio.js") =
      await import(moduleUrl);
    const original = AudioContext.prototype.createOscillator;
    const originalNoise = AudioContext.prototype.createBufferSource;
    let active = 0;
    // Assigned to prototypes, not named consts: tsx's __name helper does not
    // exist inside page.evaluate.
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      const node = original.call(this);
      const disconnect = node.disconnect.bind(node);
      active++;
      node.disconnect = () => {
        active--;
        disconnect();
      };
      return node;
    };
    AudioContext.prototype.createBufferSource = function (this: AudioContext) {
      const node = originalNoise.call(this);
      const disconnect = node.disconnect.bind(node);
      active++;
      node.disconnect = () => {
        active--;
        disconnect();
      };
      return node;
    };
    const adapter = audio.createBrowserAudio(false);
    try {
      adapter.configure({
        mute: false,
        volume: 0.5,
        reducedMotion: false,
        edgeScroll: true,
      });
      adapter.unlock();
      // Allow native resume to settle; no simulation clock is involved.
      await new Promise((resolve) => setTimeout(resolve, 100));
      adapter.play("victory");
      const playing = active;
      const victoryLayers = audio.cueRecipe("victory", Math.random).length;
      // Every cue plays without throwing, then releases its sources on its own.
      const errors: string[] = [];
      for (const cue of [...audio.UI_CUES, ...audio.EVENT_CUES])
        try {
          adapter.play(cue, { pan: -0.5, gain: 0.5 });
        } catch (error) {
          errors.push(`${cue}: ${String(error)}`);
        }
      const everyCue = active > playing;
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const drained = active;
      adapter.configure({
        mute: true,
        volume: 0.5,
        reducedMotion: false,
        edgeScroll: true,
      });
      const muted = active;
      adapter.configure({
        mute: false,
        volume: 0.5,
        reducedMotion: false,
        edgeScroll: true,
      });
      adapter.unlock();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const resumed = active;
      adapter.play("victory");
      adapter.configure({
        mute: false,
        volume: 0,
        reducedMotion: false,
        edgeScroll: true,
      });
      adapter.play("victory");
      const zeroVolume = active;
      adapter.dispose();
      const forced = audio.createBrowserAudio(true);
      forced.configure({
        mute: false,
        volume: 1,
        reducedMotion: false,
        edgeScroll: true,
      });
      forced.unlock();
      forced.play("victory");
      forced.dispose();
      return {
        playing: playing === victoryLayers,
        everyCue,
        errors,
        drained,
        muted,
        resumed,
        zeroVolume,
        disposed: active,
      };
    } finally {
      adapter.dispose();
      AudioContext.prototype.createOscillator = original;
      AudioContext.prototype.createBufferSource = originalNoise;
    }
  });
  assert.deepEqual(result, {
    playing: true,
    everyCue: true,
    errors: [],
    drained: 0,
    muted: 0,
    resumed: 0,
    zeroVolume: 0,
    disposed: 0,
  });
  console.log(
    "chromium: every cue plays and releases its voices; native audio cancels on mute/zero volume/dispose, no stale voices on resume, forced mute remains silent",
  );
} finally {
  await browser.close();
}

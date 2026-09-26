import assert from "node:assert/strict";
import { chromium } from "playwright";

// Native Web Audio lifecycle check, not an audible-quality test. Instrument
// oscillator disconnection only. Browser output and the app stay muted.
const browser = await chromium.launch({ args: ["--mute-audio"] });
try {
  const page = await browser.newPage();
  await page.goto(
    process.argv[2] ?? "http://127.0.0.1:5174/games/neural-defence/?mute",
  );
  const result = await page.evaluate(async () => {
    const moduleUrl = "/games/neural-defence/src/app/audio.ts";
    const audio: typeof import("../games/neural-defence/src/app/audio.js") =
      await import(moduleUrl);
    const original = AudioContext.prototype.createOscillator;
    let active = 0;
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
    const adapter = audio.createBrowserAudio(false);
    try {
      adapter.configure({ mute: false, volume: 0.5, reducedMotion: false });
      adapter.unlock();
      // Allow native resume to settle; no simulation clock is involved.
      await new Promise((resolve) => setTimeout(resolve, 100));
      adapter.play("victory");
      const playing = active;
      adapter.configure({ mute: true, volume: 0.5, reducedMotion: false });
      const muted = active;
      adapter.configure({ mute: false, volume: 0.5, reducedMotion: false });
      adapter.unlock();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const resumed = active;
      adapter.play("victory");
      adapter.configure({ mute: false, volume: 0, reducedMotion: false });
      adapter.play("victory");
      const zeroVolume = active;
      adapter.dispose();
      const forced = audio.createBrowserAudio(true);
      forced.configure({ mute: false, volume: 1, reducedMotion: false });
      forced.unlock();
      forced.play("victory");
      forced.dispose();
      return { playing, muted, resumed, zeroVolume, disposed: active };
    } finally {
      adapter.dispose();
      AudioContext.prototype.createOscillator = original;
    }
  });
  assert.deepEqual(result, {
    playing: 4,
    muted: 0,
    resumed: 0,
    zeroVolume: 0,
    disposed: 0,
  });
  console.log(
    "chromium: native audio cancels on mute/zero volume/dispose, no stale voices on resume, forced mute remains silent",
  );
} finally {
  await browser.close();
}

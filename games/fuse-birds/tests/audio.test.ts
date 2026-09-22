import { test } from "node:test";
import assert from "node:assert/strict";
import { BirdsAudio, type ToneSink } from "../src/app/audio.js";
test("audio is optional, gesture-activated and bounded for simultaneous explosions", () => {
  let created = 0,
    resumed = 0,
    closed = 0;
  const tones: number[] = [];
  const fake: ToneSink = {
    resume: async () => {
      resumed++;
    },
    tone: (frequency) => {
      tones.push(frequency);
    },
    close: () => {
      closed++;
    },
  };
  const audio = new BirdsAudio(false, () => {
    created++;
    return fake;
  });
  audio.unlock();
  audio.play({ type: "shot" }, 0);
  assert.equal(created, 0);
  audio.enabled = true;
  audio.play({ type: "shot" }, 0);
  assert.deepEqual(tones, []);
  audio.unlock();
  audio.play({ type: "shot" }, 0);
  audio.play({ type: "blast" }, 10);
  audio.play({ type: "blast" }, 11);
  audio.play({ type: "blast" }, 50);
  audio.play({ type: "pickup" }, 60);
  audio.play({ type: "result" }, 70);
  audio.play({ type: "turn" }, 80);
  assert.deepEqual(tones, [650, 150, 150, 520, 330]);
  assert.equal(resumed, 1);
  audio.destroy();
  assert.equal(closed, 1);
  const unsupported = new BirdsAudio(true, () => {
    throw new Error("unavailable");
  });
  assert.doesNotThrow(() => unsupported.unlock());
});

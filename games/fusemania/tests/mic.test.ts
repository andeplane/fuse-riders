import test from "node:test";
import assert from "node:assert/strict";
import { CLICK_HZ, CLICK_S, clickSample } from "../src/app/click-track.js";
import {
  MIC_MIN_PRESSES,
  centre,
  createMicAnalyser,
  createMicSession,
  micUsable,
  onset,
} from "../src/app/mic.js";

const RATE = 48000;

/** A seeded generator, so a noisy room is the same room on every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

/**
 * A room as a microphone hears it. Ticks are scheduled on the audio clock every `beat` seconds from `first`; the
 * speaker sounds them `out` later and the microphone delivers everything `mic` later still. A key is pressed
 * `finger(k)` seconds after tick k is heard in the air; the browser stamps it `input` later; the game believes the
 * tick is heard `believed` after its schedule.
 */
function room(spec: {
  ticks: number;
  beat?: number;
  out?: number;
  mic?: number;
  input?: number;
  believed?: number;
  /** Seconds after its tick's sound that the key is pressed; undefined for no press. */
  finger?(tick: number): number | undefined;
  /** How loud a key is next to a tick of 0.5. */
  key?: number;
  noise?: number;
  seed?: number;
}) {
  const beat = spec.beat ?? 0.4,
    out = spec.out ?? 0.045,
    mic = spec.mic ?? 0.018,
    input = spec.input ?? 0.012,
    believed = spec.believed ?? 0.03,
    first = 1,
    seconds = first + spec.ticks * beat + 1,
    samples = new Float32Array(Math.ceil(seconds * RATE)),
    random = seeded(spec.seed ?? 7);
  const noise = spec.noise ?? 0.0008;
  for (let index = 0; index < samples.length; index++)
    samples[index] = (random() - 0.5) * 2 * noise;
  const scheduled: number[] = [],
    presses: { at: number; click: number; gameMs: number; trueMs: number }[] =
      [];
  for (let tick = 0; tick < spec.ticks; tick++) {
    const at = first + tick * beat;
    scheduled.push(at);
    const from = Math.round((at + out + mic) * RATE);
    for (let index = 0; index < CLICK_S * RATE; index++)
      samples[from + index]! += 0.5 * clickSample(RATE, index);
    const finger = spec.finger?.(tick);
    if (finger === undefined) continue;
    // A key: a thud of low noise that dies away in a few ms.
    const pressed = at + out + finger,
      start = Math.round((pressed + mic) * RATE);
    let low = 0;
    for (let index = 0; index < 0.03 * RATE; index++) {
      low += 0.25 * ((random() - 0.5) * 2 - low);
      samples[start + index]! +=
        (spec.key ?? 0.4) *
        low *
        3 *
        Math.exp(-index / (0.005 * RATE)) *
        Math.min(1, index / 6);
    }
    presses.push({
      // The stamp, on the audio clock.
      at: pressed + input,
      click: tick,
      // What the game makes of it: the stamp against where it believes the tick is heard.
      gameMs: (pressed + input - (at + believed)) * 1000,
      trueMs: finger * 1000,
    });
  }
  return { samples, scheduled, presses, beat, out, mic, input, believed };
}

/** Feeds a room to a session the way a page does: blocks of samples, ticks named ahead, presses as they happen. */
function listen(heard: ReturnType<typeof room>) {
  const analyser = createMicAnalyser({ sampleRate: RATE, clickHz: CLICK_HZ }),
    ticks: number[] = [],
    keys: number[] = [],
    session = createMicSession(analyser, heard.beat, {
      click: (_, tripMs) => ticks.push(tripMs),
      heard: (press) => keys.push(press.trueMs),
    });
  let nextPress = 0;
  for (const [index, at] of heard.scheduled.entries())
    session.expectClick({ index, at });
  for (let from = 0; from < heard.samples.length; from += 1024) {
    analyser.push(heard.samples.subarray(from, from + 1024), from);
    const now = (from + 1024) / RATE;
    while (
      nextPress < heard.presses.length &&
      heard.presses[nextPress]!.at <= now
    )
      session.press(heard.presses[nextPress++]!);
    session.settle();
  }
  return { session, analyser, ticks, keys };
}

test("an onset is the start of the sound, not its peak, and a dip in the wave does not move it", () => {
  const values = new Float32Array(200);
  // A sound from bin 80: it swells, dips for 2 ms (8 bins) and peaks later.
  for (let bin = 80; bin < 160; bin++)
    values[bin] = bin >= 100 && bin < 108 ? 0.01 : 0.4 + (bin - 80) * 0.005;
  const found = onset(values, 0.05, 0.00025);
  assert.equal(found?.bin, 80);
  assert.ok(found!.peak > 0.7);
  // Nothing above the floor is no sound.
  assert.equal(onset(values, 5, 0.00025), undefined);
  assert.equal(onset(new Float32Array(10), 0.1, 0.00025), undefined);
  // A sound long before, beyond the bridge, is another sound.
  values[10] = 0.5;
  assert.equal(onset(values, 0.05, 0.00025)?.bin, 80);
});

test("the tick is heard at its round trip, within a bin or two", () => {
  const heard = room({ ticks: 12, out: 0.045, mic: 0.018 });
  const { session, ticks } = listen(heard);
  const report = session.report();
  assert.equal(report.clicks, 12);
  assert.equal(report.clicksHeard, 12);
  assert.ok(
    Math.abs(report.roundTrip.median - 63) < 0.6,
    `round trip ${report.roundTrip.median}`,
  );
  assert.ok(report.roundTrip.spread < 0.5);
  assert.equal(ticks.length, 12);
});

test("the difference between what the game saw and what the finger did is the device's, whatever the player does", () => {
  // The keyboard is 12 ms late and the browser knows of 30 of the speaker's 45 ms: 27 ms the offsets do not cover.
  for (const habit of [-0.025, 0, 0.03]) {
    const random = seeded(11);
    const heard = room({
      ticks: 40,
      // Eight ticks to listen to, then a player with a habit and a few ms of scatter.
      finger: (tick) =>
        tick < 8 ? undefined : habit + (random() - 0.5) * 0.016,
    });
    const { session } = listen(heard);
    const report = session.report();
    assert.equal(report.presses, 32);
    assert.ok(report.pressesHeard >= 30, `heard ${report.pressesHeard}`);
    assert.ok(
      Math.abs(report.residualMs.median - 27) < 1.5,
      `residual ${report.residualMs.median} for a habit of ${habit}`,
    );
    assert.ok(
      report.residualMs.spread < 1.5,
      `spread ${report.residualMs.spread}`,
    );
    assert.ok(
      Math.abs(report.trueMs.median - habit * 1000) < 2,
      `finger ${report.trueMs.median}`,
    );
    // The stamp against the key's sound: the keyboard's 12 ms less the microphone's 18.
    assert.ok(Math.abs(report.stampMs.median - -6) < 1.5);
    assert.equal(micUsable(report), true);
  }
});

test("a Bluetooth-sized round trip, most of a beat long, is still found", () => {
  // Bluetooth: 260 ms out, at three ticks a second the sound of one tick lands close to the next one's schedule.
  const heard = room({
    ticks: 30,
    beat: 1 / 3,
    out: 0.26,
    mic: 0.02,
    believed: 0.17,
    finger: (tick) => (tick < 8 ? undefined : -0.01),
  });
  const { session } = listen(heard);
  const report = session.report();
  assert.ok(Math.abs(report.roundTrip.median - 280) < 1);
  // 12 ms of keyboard and 90 ms of sound the browser did not know about.
  assert.ok(
    Math.abs(report.residualMs.median - 102) < 1.5,
    `residual ${report.residualMs.median}`,
  );
});

test("keys too quiet to tell from the tick are not guessed at", () => {
  const heard = room({
    ticks: 30,
    finger: (tick) => (tick < 8 ? undefined : 0.005),
    key: 0.0004,
  });
  const report = listen(heard).session.report();
  assert.equal(report.presses, 22);
  assert.equal(report.pressesHeard, 0);
  assert.equal(report.residualMs.n, 0);
  assert.equal(micUsable(report), false);
  assert.equal(report.clicksHeard, 30, "the ticks are still heard");
});

test("too few presses are not acted on", () => {
  const heard = room({
    ticks: 8 + MIC_MIN_PRESSES - 2,
    finger: (tick) => (tick < 8 ? undefined : 0),
  });
  const report = listen(heard).session.report();
  assert.ok(report.residualMs.n > 0 && report.residualMs.n < MIC_MIN_PRESSES);
  assert.equal(micUsable(report), false);
});

test("silence is no tick, and a reset forgets everything", () => {
  const analyser = createMicAnalyser({ sampleRate: RATE, clickHz: CLICK_HZ }),
    session = createMicSession(analyser, 0.4);
  session.expectClick({ index: 0, at: 0.5 });
  session.expectClick({ index: 1, at: 0.9 });
  analyser.push(new Float32Array(RATE * 2), 0);
  session.settle();
  let report = session.report();
  assert.deepEqual([report.clicks, report.clicksHeard], [2, 0]);
  assert.equal(report.roundTrip.n, 0);
  session.reset();
  report = session.report();
  assert.deepEqual([report.clicks, report.presses], [0, 0]);
});

test("the envelope is kept by the audio clock's frames, and a gap in them is silence", () => {
  const analyser = createMicAnalyser({ sampleRate: RATE, clickHz: CLICK_HZ });
  assert.equal(analyser.until, 0);
  const tick = new Float32Array(RATE / 10);
  for (let index = 0; index < CLICK_S * RATE; index++)
    tick[index] = clickSample(RATE, index);
  analyser.push(tick, RATE);
  // Half a second was never delivered.
  analyser.push(tick, RATE * 1.6);
  assert.ok(Math.abs(analyser.until - 1.7) < 0.001);
  const peak = (from: number, to: number) =>
    Math.max(0, ...analyser.envelope("click", from, to));
  assert.ok(peak(1, 1.02) > 0.1);
  assert.equal(peak(1.2, 1.5), 0);
  assert.ok(peak(1.6, 1.62) > 0.1);
  assert.equal(analyser.envelope("click", 5, 6).length, 0);
  assert.ok(analyser.level() > 0.5);
  assert.equal(analyser.level(), 0, "the level is since the last look");
});

test("centre is the median and a standard deviation's worth of spread", () => {
  assert.deepEqual(centre([]), { median: 0, spread: 0, n: 0 });
  const found = centre([1, 2, 3, 4, 100]);
  assert.equal(found.median, 3);
  assert.ok(Math.abs(found.spread - 1.4826) < 1e-9);
});

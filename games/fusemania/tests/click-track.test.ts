import test from "node:test";
import assert from "node:assert/strict";
import {
  createFakeAudioClock,
  createFakeClockedSong,
} from "fuse-ui/game-audio-fake";
import { WINDOWS } from "../src/engine/index.js";
import {
  CLICK_HZ,
  CLICK_RATES,
  CLICK_S,
  CLICK_SAMPLE_RATE,
  LAP_TICKS,
  beatS,
  clickRateOf,
  clickSample,
  judgeTap,
  lapWav,
  nearestTick,
} from "../src/app/click-track.js";
import { TICK_LEAD_S, createTickLoop } from "../src/app/tick-loop.js";

test("a lap has a tick on the sample of every beat, silence between, and is exactly its beats long", () => {
  for (const bpm of CLICK_RATES) {
    const wav = lapWav(bpm),
      view = new DataView(wav.buffer),
      beat = beatS(bpm) * CLICK_SAMPLE_RATE;
    assert.equal(String.fromCharCode(...wav.subarray(0, 4)), "RIFF");
    assert.equal(String.fromCharCode(...wav.subarray(8, 12)), "WAVE");
    assert.equal(view.getUint32(24, true), CLICK_SAMPLE_RATE);
    assert.equal(view.getUint16(22, true), 1, "mono");
    assert.equal(view.getUint32(40, true), wav.length - 44);
    // Whole samples: a lap started when the last one ends is on the beat to the sample.
    assert.equal(Number.isInteger(beat), true, `${bpm}`);
    assert.equal((wav.length - 44) / 2, LAP_TICKS * beat);
    const sample = (frame: number) =>
      view.getInt16(44 + frame * 2, true) / 32767;
    for (const tick of [0, 1, LAP_TICKS - 1]) {
      const first = tick * beat;
      if (tick > 0)
        assert.equal(sample(first - 1), 0, `silence before tick ${tick}`);
      // The tick starts on its sample and is loud within a fifth of a millisecond.
      let peak = 0;
      for (let frame = first; frame < first + 20; frame++)
        peak = Math.max(peak, Math.abs(sample(frame)));
      assert.ok(peak > 0.5, `tick ${tick} starts at once (${peak})`);
      assert.equal(
        sample(first + Math.ceil(CLICK_S * CLICK_SAMPLE_RATE) + 5),
        0,
        "and is over after its length",
      );
    }
    assert.equal(sample(LAP_TICKS * beat - 1), 0, "the lap ends in silence");
  }
});

test("the tick is a ping at its pitch that dies away", () => {
  assert.equal(clickSample(48000, 0), 0);
  assert.equal(clickSample(48000, -1), 0);
  assert.equal(clickSample(48000, Math.ceil(CLICK_S * 48000)), 0);
  // Zero crossings in the first 5 ms: two per cycle.
  let crossings = 0;
  for (let index = 1; index < 240; index++)
    if (clickSample(48000, index - 1) < 0 !== clickSample(48000, index) < 0)
      crossings++;
  assert.ok(Math.abs(crossings - CLICK_HZ * 0.005 * 2) <= 2, `${crossings}`);
  const loud = (from: number) => {
    let peak = 0;
    for (let index = from; index < from + 48; index++)
      peak = Math.max(peak, Math.abs(clickSample(48000, index)));
    return peak;
  };
  assert.ok(loud(24) > 4 * loud(480), "it has died away after 10 ms");
});

test("the rates, the nearest tick and a tap's judgment", () => {
  assert.equal(clickRateOf(150), 150);
  assert.equal(clickRateOf(151), undefined);
  assert.equal(clickRateOf(Number.NaN), undefined);
  assert.deepEqual(nearestTick(150, 0), { index: 0, offMs: 0 });
  assert.deepEqual(nearestTick(150, 812), { index: 2, offMs: 12 });
  assert.deepEqual(nearestTick(150, 790), { index: 2, offMs: -10 });
  // There is no tick before the first: an early tap is early for tick 0.
  assert.deepEqual(nearestTick(150, -300), { index: 0, offMs: -300 });
  // The click never ends: an hour in, the nearest tick is still a beat away at most.
  assert.deepEqual(nearestTick(120, 3_600_020), { index: 7200, offMs: 20 });

  assert.deepEqual(judgeTap(150, 812), { index: 2, offMs: 12, judgment: 0 });
  assert.equal(judgeTap(150, 800 + WINDOWS[0]).judgment, 0);
  assert.equal(judgeTap(150, 800 - WINDOWS[0] - 1).judgment, 1);
  assert.equal(judgeTap(150, 800 + WINDOWS[4]).judgment, 4);
  // Two ticks a second leave room between them where a tap is nowhere near a tick.
  assert.equal(judgeTap(120, 250).judgment, -1);
});

test("the click is one lap after another on the audio clock, each started in the silence before it", () => {
  const clock = createFakeAudioClock({ time: 10 }),
    bpm = 150,
    lapS = LAP_TICKS * beatS(bpm),
    song = createFakeClockedSong(lapS, clock),
    loop = createTickLoop({ clock: () => clock, song, bpm });
  assert.equal(loop.origin, undefined);
  loop.frame();
  const origin = 10 + TICK_LEAD_S;
  assert.equal(loop.origin, origin);
  assert.equal(loop.run, 1);
  assert.deepEqual(song.plays, [{ at: origin, offset: 0 }]);
  assert.equal(loop.scheduledAt(0), origin);
  assert.equal(loop.scheduledAt(40), origin + 40 * beatS(bpm));

  // Sixty frames a second through five laps: one start a lap, each on the exact time the last lap ends.
  for (let t = 10; t < origin + 5 * lapS - beatS(bpm); t += 1 / 60) {
    clock.time = t;
    loop.frame();
    // A lap is never replaced while one of its ticks sounds.
    const newest = song.plays[song.plays.length - 1]!,
      before = song.plays[song.plays.length - 2];
    if (before && t < newest.at) {
      const into = (t - before.at) % beatS(bpm);
      assert.ok(into > CLICK_S, `armed ${into.toFixed(3)} s into a beat`);
    }
  }
  assert.deepEqual(
    song.plays.map((play) => play.at),
    [0, 1, 2, 3, 4].map((lap) => origin + lap * lapS),
  );
  assert.equal(
    song.plays.every((play) => play.offset === 0),
    true,
  );
  // What plays at any clock time is the lap's own position: tick 69 is the fifth lap's tick 5.
  const at = loop.scheduledAt(69)!;
  clock.time = at;
  assert.ok(Math.abs(song.scheduled(at)! - 5 * beatS(bpm)) < 1e-9);
});

test("a frame that comes late keeps the beat, and a clock that stopped starts a new run", () => {
  const clock = createFakeAudioClock({ time: 0 }),
    bpm = 120,
    lapS = LAP_TICKS * beatS(bpm),
    song = createFakeClockedSong(lapS, clock),
    loop = createTickLoop({ clock: () => clock, song, bpm });
  loop.frame();
  const origin = loop.origin!;
  // The tab slept through three laps: the lap that should be playing is started where it would have got to.
  clock.time = origin + 3.4 * lapS;
  loop.frame();
  assert.deepEqual(song.plays[1], { at: origin + 3 * lapS, offset: 0 });
  assert.ok(Math.abs(song.scheduled(clock.time)! - 0.4 * lapS) < 1e-9);
  assert.equal(loop.scheduledAt(100), origin + 100 * beatS(bpm));

  clock.running = false;
  loop.frame();
  assert.equal(loop.origin, undefined);
  assert.equal(loop.scheduledAt(0), undefined);
  assert.equal(song.playing, false);
  clock.running = true;
  clock.time = 500;
  loop.frame();
  assert.equal(loop.origin, 500 + TICK_LEAD_S);
  assert.equal(loop.run, 2);
  assert.deepEqual(song.plays[2], { at: 500 + TICK_LEAD_S, offset: 0 });
});

test("a click with an end falls silent on the audio clock right after its last tick, and keeps its origin", () => {
  const clock = createFakeAudioClock({ time: 0 }),
    bpm = 150,
    beat = beatS(bpm),
    lapS = LAP_TICKS * beat,
    song = createFakeClockedSong(lapS, clock),
    // 40 ticks: two whole laps and half of a third.
    loop = createTickLoop({ clock: () => clock, song, bpm, count: 40 });
  assert.equal(loop.last, 39);
  loop.frame();
  const origin = loop.origin!;
  let silentAt: number | undefined;
  for (let t = 0; t < origin + 60 * beat; t += 1 / 60) {
    clock.time = t;
    loop.frame();
    if (silentAt === undefined && !song.playing) silentAt = t;
  }
  assert.deepEqual(
    song.plays.map((play) => play.at),
    [0, 1, 2].map((lap) => origin + lap * lapS),
    "no lap is started that has no tick left to sound",
  );
  // The last tick has sounded in full; the one after it never leaves for the speakers.
  assert.ok(silentAt! > origin + 39 * beat + CLICK_S, `${silentAt}`);
  assert.ok(silentAt! < origin + 40 * beat, `${silentAt}`);
  assert.equal(song.stops, 1);
  // Whoever is still hearing the last ticks (a long output latency) can still place them.
  assert.equal(loop.origin, origin);
  assert.equal(loop.run, 1);
  assert.equal(loop.scheduledAt(39), origin + 39 * beat);
  loop.stop();
  assert.equal(song.stops, 1, "already silent");
  assert.equal(loop.origin, undefined);
  // A click that ends on a lap's edge does not start the lap after it.
  const even = createFakeClockedSong(lapS, clock),
    exact = createTickLoop({ clock: () => clock, song: even, bpm, count: 32 });
  clock.time = 100;
  exact.frame();
  for (let t = 100; t < 100 + 50 * beat; t += 1 / 60) {
    clock.time = t;
    exact.frame();
  }
  assert.equal(even.plays.length, 2);
});

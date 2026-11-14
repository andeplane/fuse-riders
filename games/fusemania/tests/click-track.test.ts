import test from "node:test";
import assert from "node:assert/strict";
import { TAP, createLibrary } from "../src/engine/index.js";
import {
  CLICK_COUNT_IN,
  CLICK_HZ,
  CLICK_RATES,
  CLICK_S,
  CLICK_SAMPLE_RATE,
  clickAudio,
  clickAudioRate,
  clickId,
  clickMs,
  clickNotes,
  clickRate,
  clickSample,
  clickSources,
  clickTicks,
  clickWav,
  nearestClick,
} from "../src/app/click-track.js";

test("every rate is a song the library can play, with a note exactly on every tick after the count-in", () => {
  const library = createLibrary(clickSources());
  assert.deepEqual(
    library.songs.map((song) => song.id),
    CLICK_RATES.map(clickId),
  );
  for (const bpm of CLICK_RATES) {
    const song = library.song(clickId(bpm))!;
    assert.deepEqual(song.bpm, [bpm, bpm]);
    assert.deepEqual(
      song.charts.map((chart) => chart.name),
      ["Beginner", "Easy"],
    );
    const steady = library.steps(song.id, 0)!,
      walk = library.steps(song.id, 1)!;
    assert.equal(steady.notes.length, clickNotes(bpm));
    for (const [index, note] of steady.notes.entries()) {
      assert.equal(note.kind, TAP);
      assert.equal(note.column, 1, "one arrow: nothing to read but the beat");
      assert.equal(
        note.ms,
        clickMs(bpm, CLICK_COUNT_IN + index),
        `note ${index} of ${bpm}`,
      );
    }
    assert.deepEqual(
      walk.notes.slice(0, 5).map((note) => note.column),
      [0, 1, 2, 3, 0],
    );
  }
});

test("the audio has a tick on the sample of every beat and silence between", () => {
  const bpm = 150,
    wav = clickWav(bpm),
    view = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.subarray(8, 12)), "WAVE");
  assert.equal(view.getUint32(24, true), CLICK_SAMPLE_RATE);
  assert.equal(view.getUint16(22, true), 1, "mono");
  assert.equal(view.getUint32(40, true), wav.length - 44);
  const sample = (frame: number) => view.getInt16(44 + frame * 2, true) / 32767;
  for (const tick of [0, 1, CLICK_COUNT_IN, clickTicks(bpm) - 1]) {
    const first = Math.round((clickMs(bpm, tick) / 1000) * CLICK_SAMPLE_RATE);
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
  // No tick after the last.
  const after = Math.round(
    (clickMs(bpm, clickTicks(bpm)) / 1000) * CLICK_SAMPLE_RATE,
  );
  assert.ok(after + 30 >= (wav.length - 44) / 2 || sample(after + 10) === 0);
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

test("ids, audio names and the nearest tick", () => {
  assert.equal(clickRate(clickId(150)), 150);
  assert.equal(clickRate("click-151"), undefined);
  assert.equal(clickRate("arcade-adventure"), undefined);
  assert.equal(clickAudioRate(clickAudio(120)), 120);
  assert.equal(clickAudioRate("music/fusemania/x.mp3"), undefined);
  assert.equal(clickAudioRate("click:99"), undefined);
  assert.deepEqual(nearestClick(150, clickMs(150, 9) + 13), {
    index: 9,
    offMs: 13,
  });
  assert.deepEqual(nearestClick(150, clickMs(150, 9) - 21), {
    index: 9,
    offMs: -21,
  });
  assert.equal(nearestClick(150, -5000).index, 0);
  assert.equal(nearestClick(150, 1e9).index, clickTicks(150) - 1);
});

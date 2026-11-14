import test from "node:test";
import assert from "node:assert/strict";
import { SONGS_DATA } from "../src/engine/songs-data.js";
import { parseSimfile } from "../src/engine/simfile.js";
import {
  bandFlux,
  computeSpectra,
  detailBinAt,
  detailHz,
  Fft,
  LAB_RATE,
  MEL_BANDS,
  melBandAt,
  melBandHz,
} from "../src/lab/spectrum.js";
import {
  chartStats,
  placeChart,
  quantName,
  quantOf,
  snapBeat,
  toggleTap,
} from "../src/lab/charts.js";
import {
  describeNote,
  mergeNotes,
  NotesError,
  parseNotes,
  writeNotes,
  type LabNote,
} from "../src/lab/notes.js";

import {
  revealTop,
  seekDelta,
  typingIn,
  type TransportKey,
} from "../src/lab/playback.js";

const sine = (hz: number, seconds: number, rate = LAB_RATE) =>
  Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) =>
    Math.sin((2 * Math.PI * hz * i) / rate),
  );

const argmax = (values: ArrayLike<number>, from: number, count: number) => {
  let best = 0;
  for (let i = 1; i < count; i++)
    if (values[from + i]! > values[from + best]!) best = i;
  return best;
};

test("the FFT puts a pure tone in its bin", () => {
  const fft = new Fft(64);
  const re = Float64Array.from({ length: 64 }, (_, i) =>
    Math.cos((2 * Math.PI * 5 * i) / 64),
  );
  const im = new Float64Array(64);
  fft.transform(re, im);
  const magnitude = Array.from(re, (r, i) => Math.hypot(r, im[i]!));
  assert.equal(argmax(magnitude, 0, 32), 5);
  assert.ok(Math.abs(magnitude[5]! - 32) < 1e-9);
  assert.throws(() => new Fft(48));
});

test("a 440 Hz tone peaks at 440 Hz in both views, at 100 frames a second", () => {
  const spectra = computeSpectra(sine(440, 1));
  assert.equal(spectra.frames, 101);
  const frame = 50;
  const bin = argmax(
    spectra.detail,
    frame * spectra.detailBins,
    spectra.detailBins,
  );
  assert.ok(
    Math.abs(bin - detailBinAt(440)) <= 1,
    `detail bin ${bin} is ${detailHz(bin)} Hz`,
  );
  const band = argmax(spectra.model, frame * MEL_BANDS, MEL_BANDS);
  assert.ok(
    Math.abs(band - melBandAt(440)) <= 1,
    `mel band ${band} is ${melBandHz(band)} Hz`,
  );
  assert.ok(spectra.onset.every((value) => value >= 0));
});

test("mel band positions and frequencies are inverses", () => {
  for (const hz of [40, 200, 999, 1000, 3000, 10000])
    assert.ok(Math.abs(melBandHz(melBandAt(hz)) - hz) / hz < 1e-9, String(hz));
});

test("band flux hears onsets inside the band and not outside it", () => {
  // A steady low hum, with a 3 kHz blip every quarter second.
  const samples = sine(110, 2);
  for (let k = 1; k < 8; k++) {
    const start = Math.round(k * 0.25 * LAB_RATE);
    for (let i = 0; i < 0.05 * LAB_RATE; i++)
      samples[start + i]! += Math.sin((2 * Math.PI * 3000 * i) / LAB_RATE);
  }
  const spectra = computeSpectra(samples);
  const high = bandFlux(spectra, 2500, 3500);
  const low = bandFlux(spectra, 90, 130);
  const at = (curve: Float32Array, frame: number) =>
    Math.max(...curve.slice(frame - 3, frame + 3));
  const between = (curve: Float32Array, frame: number) =>
    Math.max(...curve.slice(frame + 8, frame + 15));
  for (const frame of [50, 100, 150]) {
    assert.ok(
      at(high, frame) > 10,
      `onset at frame ${frame}: ${at(high, frame)}`,
    );
    assert.ok(between(high, frame) < at(high, frame) / 4);
    assert.ok(at(low, frame) < at(high, frame) / 4);
  }
  assert.equal(
    bandFlux(spectra, 20000, 30000).every((v) => v === 0),
    true,
  );
});

test("quantisation names the coarsest subdivision a beat falls on", () => {
  assert.equal(quantOf(3), 1);
  assert.equal(quantOf(2.5), 2);
  assert.equal(quantOf(1 / 3), 3);
  assert.equal(quantOf(4.75), 4);
  assert.equal(quantOf(0.125), 8);
  assert.equal(quantOf(0.1), 0);
  assert.equal(quantName(4), "16th");
  assert.equal(snapBeat(1.27, 4), 1.25);
  assert.equal(snapBeat(1.3, 3), 4 / 3);
});

test("Final Chase's charts are placed in time and toggling a tap adds and removes it", () => {
  const data = SONGS_DATA.find((song) => song.id === "final-chase")!;
  const sim = parseSimfile(data.ssc);
  const chart = sim.charts.find((c) => c.difficulty === "Challenge")!;
  const placed = placeChart(sim, chart, "song:3", "song");
  assert.equal(placed.notes.length, chart.notes.length);
  assert.ok(
    placed.notes.every(
      (n, i) => i === 0 || n.time >= placed.notes[i - 1]!.time,
    ),
  );
  // Beat 0 is heard at -offset.
  assert.ok(Math.abs(placed.timing.timeAt(0) - 0.889) < 1e-9);
  const stats = chartStats(placed.notes);
  assert.ok(stats.steps > 100 && stats.perSecond > 1);
  const shares = Object.values(stats.quants).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(shares - 1) < 1e-9);

  const free = 1000.25;
  const added = toggleTap(chart, free, 2);
  assert.equal(added.notes.length, chart.notes.length + 1);
  assert.deepEqual(added.notes.at(-1), { beat: free, column: 2, kind: "tap" });
  const removed = toggleTap(added, free, 2);
  assert.deepEqual(removed.notes, chart.notes);
});

const note = (over: Partial<LabNote> = {}): LabNote => ({
  id: "a",
  created: "2026-11-14T19:00:00.000Z",
  song: "final-chase",
  start: 42.1,
  end: 44.5,
  startBeat: 102.8,
  endBeat: 108.8,
  tags: ["melody", "16ths"],
  text: "the lead line runs 16ths here",
  ...over,
});

test("notes files round-trip, merge by id and refuse what is not one", () => {
  const file = {
    version: 1 as const,
    notes: [note({ lowHz: 1200, highHz: 3400, chart: "Hard" })],
  };
  assert.deepEqual(parseNotes(writeNotes(file)), file);
  const merged = mergeNotes(file, {
    version: 1,
    notes: [note({ text: "changed" }), note({ id: "b", start: 1, end: 2 })],
  });
  assert.deepEqual(
    merged.notes.map((n) => [n.id, n.text]),
    [
      ["b", "the lead line runs 16ths here"],
      ["a", "changed"],
    ],
  );
  for (const bad of [
    "nope",
    "[]",
    '{"version":2,"notes":[]}',
    JSON.stringify({ version: 1, notes: [{ ...note(), start: "x" }] }),
    JSON.stringify({ version: 1, notes: [note({ start: 5, end: 1 })] }),
    JSON.stringify({ version: 1, notes: [note({ lowHz: 900, highHz: 100 })] }),
    JSON.stringify({ version: 1, notes: [{ ...note(), lowHz: 100 }] }),
    JSON.stringify({ version: 1, notes: [note({ lowHz: 0, highHz: 100 })] }),
    JSON.stringify({ version: 1, notes: [note({ start: -3 })] }),
  ])
    assert.throws(() => parseNotes(bad), NotesError, bad);
  // Unknown tags are dropped rather than refused.
  const tagged = parseNotes(
    JSON.stringify({
      version: 1,
      notes: [{ ...note(), tags: ["melody", "bogus"] }],
    }),
  );
  assert.deepEqual(tagged.notes[0]!.tags, ["melody"]);
});

test("a note reads as one line for a chat", () => {
  assert.equal(
    describeNote(note({ lowHz: 1200, highHz: 3400, chart: "Hard" })),
    "final-chase 0:42.10–0:44.50 (beats 102.80–108.80) · 1.20 kHz–3.40 kHz · Hard · [melody, 16ths]: the lead line runs 16ths here",
  );
});

const press = (
  key: string,
  held: Partial<TransportKey> = {},
): TransportKey => ({
  key,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  ...held,
});

test("chart lab: the arrow keys seek 0.5 s, 2 s with shift and 5 s with option", () => {
  assert.equal(seekDelta(press("ArrowLeft")), -0.5);
  assert.equal(seekDelta(press("ArrowRight")), 0.5);
  assert.equal(seekDelta(press("ArrowLeft", { shiftKey: true })), -2);
  assert.equal(seekDelta(press("ArrowRight", { shiftKey: true })), 2);
  assert.equal(seekDelta(press("ArrowLeft", { altKey: true })), -5);
  assert.equal(seekDelta(press("ArrowRight", { altKey: true })), 5);
  assert.equal(
    seekDelta(press("ArrowLeft", { altKey: true, shiftKey: true })),
    -5,
  );
});

test("chart lab: other keys, and the browser's own ⌘/ctrl arrows, do not seek", () => {
  assert.equal(seekDelta(press(" ")), undefined);
  assert.equal(seekDelta(press("ArrowUp")), undefined);
  assert.equal(seekDelta(press("ArrowLeft", { metaKey: true })), undefined);
  assert.equal(seekDelta(press("ArrowRight", { ctrlKey: true })), undefined);
});

test("chart lab: text fields keep their keys, other controls give them to playback", () => {
  assert.equal(typingIn(null), false);
  assert.equal(typingIn({ tagName: "BODY" }), false);
  assert.equal(typingIn({ tagName: "TEXTAREA" }), true);
  assert.equal(typingIn({ tagName: "INPUT", type: "text" }), true);
  assert.equal(typingIn({ tagName: "INPUT" }), true);
  assert.equal(typingIn({ tagName: "DIV", isContentEditable: true }), true);
  for (const type of ["checkbox", "range", "file"])
    assert.equal(typingIn({ tagName: "INPUT", type }), false, type);
  assert.equal(typingIn({ tagName: "BUTTON", type: "button" }), false);
  assert.equal(typingIn({ tagName: "SELECT", type: "select-one" }), false);
});

test("chart lab: the view moves only when the playhead leaves it", () => {
  // A 10 s view from 20 s: a playhead in the middle stays put.
  assert.equal(revealTop(25, 20, 10), 20);
  // Above, below, and inside the edge margin: the playhead lands 30% down.
  assert.equal(revealTop(12, 20, 10), 9);
  assert.equal(revealTop(40, 20, 10), 37);
  assert.equal(revealTop(20.2, 20, 10), 17.2);
  assert.equal(revealTop(29.9, 20, 10), 26.9);
});

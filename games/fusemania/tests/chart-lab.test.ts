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
  parseResume,
  resumeHash,
  revealTop,
  seekDelta,
  typingIn,
  type TransportKey,
} from "../src/lab/playback.js";

import { hiddenAtStart, parseShown } from "../src/lab/shown.js";

import { bandMix, coversAll, dragSpan, grabAt } from "../src/lab/band.js";

import { parseNotesUpload, writeNotesUpload } from "../src/lab/notes-upload.js";
import {
  mayStoreNotes,
  storeNotes,
} from "../../../scripts/lib/chart-lab-notes.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { addTap, parseTaps, tapColumn, writeTaps } from "../src/lab/taps.js";

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

test("chart lab: the arrow keys seek 0.5 s, 3 s with shift and 10 s with option", () => {
  assert.equal(seekDelta(press("ArrowLeft")), -0.5);
  assert.equal(seekDelta(press("ArrowRight")), 0.5);
  assert.equal(seekDelta(press("ArrowLeft", { shiftKey: true })), -3);
  assert.equal(seekDelta(press("ArrowRight", { shiftKey: true })), 3);
  assert.equal(seekDelta(press("ArrowLeft", { altKey: true })), -10);
  assert.equal(seekDelta(press("ArrowRight", { altKey: true })), 10);
  assert.equal(
    seekDelta(press("ArrowLeft", { altKey: true, shiftKey: true })),
    -10,
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

test("chart lab: a song opens with one chart shown, or the ones chosen last time", () => {
  const charts = ["Easy", "Medium", "Hard", "Challenge"].map((label, i) => ({
    key: `song:${i}`,
    label,
  }));
  assert.deepEqual(hiddenAtStart(charts, undefined), [
    "song:0",
    "song:1",
    "song:3",
  ]);
  assert.deepEqual(hiddenAtStart(charts, ["Easy", "Challenge"]), [
    "song:1",
    "song:2",
  ]);
  // A remembered difficulty this song lacks falls back to the default, and no Hard falls back to the first chart.
  assert.deepEqual(hiddenAtStart(charts, ["Beginner"]), [
    "song:0",
    "song:1",
    "song:3",
  ]);
  assert.deepEqual(hiddenAtStart(charts.slice(0, 2), undefined), ["song:1"]);
  // Everything unticked stays unticked.
  assert.equal(hiddenAtStart(charts, []).length, 4);
  assert.deepEqual(hiddenAtStart([], undefined), []);
});

test("chart lab: the remembered chart choice survives only as a list of labels", () => {
  assert.equal(parseShown(null), undefined);
  assert.equal(parseShown("not json"), undefined);
  assert.equal(parseShown('{"a":1}'), undefined);
  assert.deepEqual(parseShown('["Hard", 3, "Easy"]'), ["Hard", "Easy"]);
  assert.deepEqual(parseShown("[]"), []);
});

test("chart lab: a press on the frequency axis grabs an edge or the box", () => {
  const span = { from: 100, to: 200 };
  assert.equal(grabAt(span, 97), "low");
  assert.equal(grabAt(span, 104), "low");
  assert.equal(grabAt(span, 204), "high");
  assert.equal(grabAt(span, 150), "move");
  // Beside the box: the nearer edge, to pull it out.
  assert.equal(grabAt(span, 50), "low");
  assert.equal(grabAt(span, 260), "high");
  // A box narrower than the reach: the nearer edge wins.
  assert.equal(grabAt({ from: 100, to: 108 }, 103), "low");
  assert.equal(grabAt({ from: 100, to: 108 }, 106), "high");
});

test("chart lab: the listening box is resized and moved inside the axis", () => {
  const span = { from: 100, to: 200 };
  // Edges follow the pointer, stop short of each other and at the axis ends.
  assert.deepEqual(dragSpan(span, "low", 100, 60, 0, 400), {
    from: 60,
    to: 200,
  });
  assert.deepEqual(dragSpan(span, "low", 100, 300, 0, 400), {
    from: 192,
    to: 200,
  });
  assert.deepEqual(dragSpan(span, "low", 100, -50, 0, 400), {
    from: 0,
    to: 200,
  });
  assert.deepEqual(dragSpan(span, "high", 200, 350, 0, 400), {
    from: 100,
    to: 350,
  });
  assert.deepEqual(dragSpan(span, "high", 200, 20, 0, 400), {
    from: 100,
    to: 108,
  });
  // Moving keeps the width and stays on the axis; a box as wide as the axis has nowhere to go.
  assert.deepEqual(dragSpan(span, "move", 150, 180, 0, 400), {
    from: 130,
    to: 230,
  });
  assert.deepEqual(dragSpan(span, "move", 150, 900, 0, 400), {
    from: 300,
    to: 400,
  });
  assert.deepEqual(dragSpan(span, "move", 150, -900, 0, 400), {
    from: 0,
    to: 100,
  });
  assert.deepEqual(dragSpan({ from: 0, to: 400 }, "move", 150, 250, 0, 400), {
    from: 0,
    to: 400,
  });
});

test("chart lab: a box over the whole axis turns nothing down", () => {
  assert.equal(coversAll({ from: 0, to: 400 }, 0, 400), true);
  assert.equal(coversAll({ from: 0.6, to: 399.5 }, 0, 400), true);
  assert.equal(coversAll({ from: 20, to: 400 }, 0, 400), false);
  assert.equal(coversAll({ from: 0, to: 380 }, 0, 400), false);
});

test("chart lab: outside the band the song keeps a tenth of its level", () => {
  assert.deepEqual(bandMix(false), { dry: 1, band: 0 });
  const mix = bandMix(true);
  assert.equal(mix.dry, 0.1);
  assert.equal(mix.dry + mix.band, 1);
});

/** The smallest PNG: its signature and nothing else, which is all the upload checks. */
const TINY_PNG = `data:image/png;base64,${btoa("\x89PNG\r\n\x1a\n")}`;
const uploadNote: LabNote = {
  id: "abc-123",
  created: "2026-11-14T20:00:00.000Z",
  song: "final-chase",
  start: 12.5,
  end: 14,
  startBeat: 30,
  endBeat: 34,
  lowHz: 400,
  highHz: 900,
  tags: ["melody"],
  text: "the lead should carry the steps here",
};

test("chart lab: an upload becomes a notes file and a picture named by its note", () => {
  const stored = parseNotesUpload(
    writeNotesUpload({
      notes: { version: 1, notes: [uploadNote] },
      shot: { id: uploadNote.id, png: TINY_PNG },
    }),
  );
  assert.deepEqual(parseNotes(stored.notes).notes, [uploadNote]);
  assert.equal(stored.shot?.file, "abc-123.png");
  assert.deepEqual(
    [...(stored.shot?.bytes ?? [])].slice(0, 4),
    [0x89, 0x50, 0x4e, 0x47],
  );
  const plain = parseNotesUpload(
    writeNotesUpload({ notes: { version: 1, notes: [] } }),
  );
  assert.equal(plain.shot, undefined);
});

test("chart lab: a bad upload is refused before anything is written", () => {
  const notes = { version: 1 as const, notes: [uploadNote] };
  const bad = (body: string) =>
    assert.throws(() => parseNotesUpload(body), NotesError);
  bad("not json");
  bad("7");
  bad(JSON.stringify({ notes: { version: 2, notes: [] } }));
  bad(JSON.stringify({ notes, shot: 3 }));
  // A picture cannot choose its own file name, or be for a note that is not there.
  bad(JSON.stringify({ notes, shot: { id: "../../etc/x", png: TINY_PNG } }));
  bad(JSON.stringify({ notes, shot: { id: "other", png: TINY_PNG } }));
  bad(
    JSON.stringify({ notes, shot: { id: "abc-123", png: "data:text/html,x" } }),
  );
  bad(
    JSON.stringify({
      notes,
      shot: { id: "abc-123", png: "data:image/png;base64,%%%" },
    }),
  );
  bad(
    JSON.stringify({
      notes,
      shot: { id: "abc-123", png: `data:image/png;base64,${btoa("GIF89a..")}` },
    }),
  );
});

test("chart lab: the dev server stores notes only for a page it served to this machine", () => {
  const ok = {
    remoteAddress: "127.0.0.1",
    host: "localhost:5180",
    origin: "http://localhost:5180",
    contentType: "application/json",
  };
  assert.equal(mayStoreNotes(ok), true);
  assert.equal(mayStoreNotes({ ...ok, remoteAddress: "::1" }), true);
  assert.equal(mayStoreNotes({ ...ok, origin: undefined }), true);
  assert.equal(mayStoreNotes({ ...ok, remoteAddress: "192.168.1.20" }), false);
  assert.equal(mayStoreNotes({ ...ok, remoteAddress: undefined }), false);
  assert.equal(mayStoreNotes({ ...ok, host: "evil.example" }), false);
  assert.equal(mayStoreNotes({ ...ok, origin: "https://evil.example" }), false);
  assert.equal(mayStoreNotes({ ...ok, origin: "nonsense" }), false);
  assert.equal(mayStoreNotes({ ...ok, contentType: "text/plain" }), false);
  assert.equal(mayStoreNotes({ ...ok, contentType: undefined }), false);
});

test("chart lab: stored notes land in notes.json with the picture beside them", () => {
  const dir = mkdtempSync(join(tmpdir(), "chart-lab-notes-"));
  try {
    const written = storeNotes(
      dir,
      writeNotesUpload({
        notes: { version: 1, notes: [uploadNote] },
        shot: { id: uploadNote.id, png: TINY_PNG },
      }),
    );
    assert.deepEqual(written, ["notes.json", "shots/abc-123.png"]);
    assert.deepEqual(
      parseNotes(readFileSync(join(dir, "notes.json"), "utf8")).notes,
      [uploadNote],
    );
    assert.equal(readFileSync(join(dir, "shots", "abc-123.png")).length, 8);
    assert.throws(() => storeNotes(dir, "not json"), NotesError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("chart lab: the URL fragment remembers the playhead across a reload", () => {
  assert.equal(resumeHash(83.44), "#t=83.4");
  assert.equal(resumeHash(-1), "#t=0.0");
  assert.equal(parseResume(resumeHash(83.44)), 83.4);
  assert.equal(parseResume("#t=12"), 12);
  assert.equal(parseResume(""), undefined);
  assert.equal(parseResume("#t=abc"), undefined);
  assert.equal(parseResume("#t=1e9"), undefined);
  assert.equal(parseResume("#other"), undefined);
});

test("chart lab: WASD and IJKL tap the four lanes", () => {
  assert.deepEqual(["a", "s", "w", "d"].map(tapColumn), [0, 1, 2, 3]);
  assert.deepEqual(["J", "K", "I", "L"].map(tapColumn), [0, 1, 2, 3]);
  assert.equal(tapColumn("x"), undefined);
  assert.equal(tapColumn(" "), undefined);
});

test("chart lab: taps stay in time order and survive storage", () => {
  let taps = addTap([], { time: 2, beat: 4, column: 3 });
  taps = addTap(taps, { time: 1, beat: 2, column: 0 });
  taps = addTap(taps, { time: 2, beat: 4, column: 1 });
  assert.deepEqual(
    taps.map((tap) => [tap.time, tap.column]),
    [
      [1, 0],
      [2, 1],
      [2, 3],
    ],
  );
  const file = { version: 1 as const, song: "final-chase", taps };
  assert.deepEqual(parseTaps(writeTaps(file)), file);
  const bad = (value: unknown) =>
    assert.throws(() => parseTaps(JSON.stringify(value)), NotesError);
  assert.throws(() => parseTaps("nope"), NotesError);
  bad(3);
  bad({ ...file, version: 2 });
  bad({ ...file, song: "../x" });
  bad({ ...file, taps: "x" });
  bad({ ...file, taps: [3] });
  bad({ ...file, taps: [{ time: 1, beat: 1, column: 4 }] });
  bad({ ...file, taps: [{ time: 1, beat: 1, column: 1.5 }] });
  bad({ ...file, taps: [{ time: -1, beat: 1, column: 1 }] });
  bad({ ...file, taps: [{ time: "1", beat: 1, column: 1 }] });
});

test("chart lab: a tapped rhythm is stored under its song's name", () => {
  const dir = mkdtempSync(join(tmpdir(), "chart-lab-taps-"));
  try {
    const taps = {
      version: 1 as const,
      song: "final-chase",
      taps: [{ time: 1.25, beat: 2.5, column: 2 }],
    };
    const written = storeNotes(
      dir,
      writeNotesUpload({ notes: { version: 1, notes: [] }, taps }),
    );
    assert.deepEqual(written, ["notes.json", "taps/final-chase.json"]);
    assert.deepEqual(
      parseTaps(readFileSync(join(dir, "taps", "final-chase.json"), "utf8")),
      taps,
    );
    assert.throws(
      () =>
        storeNotes(
          dir,
          JSON.stringify({
            notes: { version: 1, notes: [] },
            taps: { ...taps, song: "../../x" },
          }),
        ),
      NotesError,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * StepMania simfiles: the `.sm` and `.ssc` text formats, read into plain data and written back as `.ssc`.
 *
 * Both are lists of `#TAG:value;` messages. In `.sm` every chart is one `#NOTES` message with six fields; in `.ssc`
 * a chart starts at `#NOTEDATA:;` and its tags follow, ending with `#NOTES`. A chart's note data is measures
 * separated by commas, each a list of rows, one character per column: `0` empty, `1` tap, `2` hold head, `3` hold or
 * roll tail, `4` roll head, `M` mine, `L` lift (read as a tap), `F` fake and `K` keysound (dropped).
 *
 * The parser is tolerant of what real packs contain (comments, stray whitespace, missing semicolons before a new
 * tag, attack and keysound annotations) and strict about what the game needs: a chart with no playable note is
 * dropped, and a file with no usable timing or chart is refused.
 */

export interface TimingData {
  /** StepMania `#OFFSET` in seconds: beat 0 is heard `-offset` seconds into the music. */
  offset: number;
  bpms: readonly (readonly [beat: number, bpm: number])[];
  /** Pauses after the row at `beat`; an `.ssc` delay (a pause before the row) is read as one. */
  stops: readonly (readonly [beat: number, seconds: number])[];
}
export type NoteKind = "tap" | "hold" | "roll" | "mine";
export interface ChartNote {
  beat: number;
  column: number;
  kind: NoteKind;
  /** Holds and rolls: the beat of the tail. */
  endBeat?: number;
}
export interface SimChart {
  /** `dance-single`, `dance-double`, `pump-single`… */
  stepsType: string;
  /** `Beginner`, `Easy`, `Medium`, `Hard`, `Challenge` or `Edit`, as the file spells it. */
  difficulty: string;
  meter: number;
  description: string;
  credit: string;
  notes: readonly ChartNote[];
  /** `.ssc` split timing, when a chart carries its own. */
  timing?: TimingData;
}
export interface Simfile {
  title: string;
  subtitle: string;
  artist: string;
  credit: string;
  /** The music file's name as the simfile gives it. */
  music: string;
  timing: TimingData;
  /** Seconds into the music where the song select's preview starts, and how long it lasts. */
  sampleStart: number;
  sampleLength: number;
  charts: readonly SimChart[];
}

export class SimfileError extends Error {}

/** The most text a simfile may be: real ones are tens of kilobytes; a megabyte chart is a mistake or an attack. */
export const MAX_SIMFILE_BYTES = 4 * 1024 * 1024;
/** The most notes one chart keeps; the rest of a longer one is cut. */
export const MAX_NOTES = 20_000;
const MAX_BEAT = 100_000;

/** Columns per steps type; a type missing here is read with as many columns as its first row has. */
const COLUMNS: Record<string, number> = {
  "dance-single": 4,
  "dance-double": 8,
  "dance-couple": 8,
  "dance-solo": 6,
  "dance-threepanel": 3,
  "pump-single": 5,
  "pump-double": 10,
  "pump-halfdouble": 6,
};

interface Message {
  tag: string;
  value: string;
}

/** The file as its `#TAG:value;` messages, comments removed. A tag that starts a line ends an unterminated value. */
function messages(text: string): Message[] {
  const out: Message[] = [];
  const clean = text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\/\/[^\n]*/g, "");
  let at = 0;
  while (at < clean.length) {
    const start = clean.indexOf("#", at);
    if (start < 0) break;
    const colon = clean.indexOf(":", start);
    if (colon < 0) break;
    const tag = clean
      .slice(start + 1, colon)
      .trim()
      .toUpperCase();
    let end = colon + 1,
      value = "";
    for (; end < clean.length; end++) {
      const char = clean[end]!;
      if (char === ";") break;
      // A missing semicolon: the next tag at the start of a line ends this one.
      if (
        char === "#" &&
        clean[end - 1] === "\n" &&
        /^#[A-Za-z]+:/.test(clean.slice(end, end + 40))
      )
        break;
      if (char === "\\" && end + 1 < clean.length) {
        value += clean[++end]!;
        continue;
      }
      value += char;
    }
    if (/^[A-Z0-9_]+$/.test(tag)) out.push({ tag, value });
    at = clean[end] === ";" ? end + 1 : end;
  }
  return out;
}

const number = (raw: string | undefined, fallback = 0): number => {
  const value = Number((raw ?? "").trim());
  return Number.isFinite(value) ? value : fallback;
};

/** `beat=value,beat=value` pairs, in beat order; pairs that are not two finite numbers are dropped. */
function pairs(raw: string | undefined): [number, number][] {
  const out: [number, number][] = [];
  for (const part of (raw ?? "").split(",")) {
    const [left, right] = part.split("=");
    if (left === undefined || right === undefined) continue;
    const beat = Number(left.trim()),
      value = Number(right.trim());
    if (
      Number.isFinite(beat) &&
      Number.isFinite(value) &&
      beat >= 0 &&
      beat <= MAX_BEAT
    )
      out.push([beat, value]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

function timingOf(
  tags: ReadonlyMap<string, string>,
  fallback?: TimingData,
): TimingData | undefined {
  // A tempo of zero or less is a warp trick this game does not play: it is read as the tempo's size, or dropped.
  const bpms = pairs(tags.get("BPMS"))
    .map(([beat, bpm]) => [beat, Math.abs(bpm)] as [number, number])
    .filter(([, bpm]) => bpm > 0 && bpm < 100_000);
  if (bpms.length === 0) return fallback;
  if (bpms[0]![0] !== 0) bpms.unshift([0, bpms[0]![1]]);
  const stops = [...pairs(tags.get("STOPS")), ...pairs(tags.get("DELAYS"))]
    .filter(([, seconds]) => seconds > 0 && seconds < 600)
    .sort((a, b) => a[0] - b[0]);
  return {
    offset: number(tags.get("OFFSET"), fallback?.offset ?? 0),
    bpms,
    stops,
  };
}

/** A chart's note data as notes in time order. */
function notesOf(data: string, stepsType: string): ChartNote[] {
  // Attack `{…}` and keysound `[…]` annotations sit inside rows in some files.
  const measures = data.replace(/\{[^}]*\}|\[[^\]]*\]/g, "").split(",");
  const notes: ChartNote[] = [];
  let columns = COLUMNS[stepsType] ?? 0;
  /** The open hold or roll in each column. */
  const open = new Map<number, ChartNote>();
  for (const [measure, text] of measures.entries()) {
    const rows = text
      .split("\n")
      .map((row) => row.trim())
      .filter((row) => row.length > 0);
    for (const [index, row] of rows.entries()) {
      if (!columns) columns = row.length;
      const beat = measure * 4 + (index * 4) / rows.length;
      if (beat > MAX_BEAT) return notes;
      for (let column = 0; column < Math.min(columns, row.length); column++) {
        const char = row[column]!;
        if (char === "0") continue;
        if (char === "3") {
          const head = open.get(column);
          if (head && beat > head.beat) head.endBeat = beat;
          open.delete(column);
          continue;
        }
        // A new note in a column whose hold never got its tail: the hold was a tap after all.
        const unfinished = open.get(column);
        if (unfinished) {
          unfinished.kind = "tap";
          open.delete(column);
        }
        const kind: NoteKind | undefined =
          char === "1" || char === "L"
            ? "tap"
            : char === "2"
              ? "hold"
              : char === "4"
                ? "roll"
                : char === "M"
                  ? "mine"
                  : undefined;
        if (!kind) continue;
        if (notes.length >= MAX_NOTES) return notes;
        const note: ChartNote = { beat, column, kind };
        notes.push(note);
        if (kind === "hold" || kind === "roll") open.set(column, note);
      }
    }
  }
  for (const head of open.values()) head.kind = "tap";
  return notes;
}

/** Reads a `.sm` or `.ssc` file. Throws `SimfileError` when it has no tempo or no chart with a note. */
export function parseSimfile(text: string): Simfile {
  if (text.length > MAX_SIMFILE_BYTES)
    throw new SimfileError("That simfile is too large.");
  const header = new Map<string, string>();
  const charts: SimChart[] = [];
  let chart: Map<string, string> | undefined;
  const all = messages(text);
  const finish = (tags: ReadonlyMap<string, string>, notes: string) => {
    const stepsType = (tags.get("STEPSTYPE") ?? "").trim().toLowerCase();
    const parsed = notesOf(notes, stepsType);
    if (!parsed.some((note) => note.kind !== "mine")) return;
    const timing = timingOf(tags);
    charts.push({
      stepsType,
      difficulty: (tags.get("DIFFICULTY") ?? "").trim() || "Edit",
      meter: Math.max(
        1,
        Math.min(99, Math.round(number(tags.get("METER"), 1))),
      ),
      description: (tags.get("DESCRIPTION") ?? "").trim(),
      credit: (tags.get("CREDIT") ?? "").trim(),
      notes: parsed,
      ...(timing ? { timing } : {}),
    });
  };
  for (const { tag, value } of all) {
    if (tag === "NOTEDATA") {
      chart = new Map();
      continue;
    }
    if (tag === "NOTES" || tag === "NOTES2") {
      if (chart) {
        finish(chart, value);
        chart = undefined;
        continue;
      }
      // `.sm`: steps type, description, difficulty, meter, radar values, note data.
      const fields = value.split(":");
      if (fields.length < 6) continue;
      finish(
        new Map([
          ["STEPSTYPE", fields[0]!],
          ["DESCRIPTION", fields[1]!],
          ["DIFFICULTY", fields[2]!],
          ["METER", fields[3]!],
        ]),
        fields.slice(5).join(":"),
      );
      continue;
    }
    (chart ?? header).set(tag, value);
  }
  const timing = timingOf(header);
  if (!timing) throw new SimfileError("That simfile has no tempo (#BPMS).");
  if (charts.length === 0) throw new SimfileError("That simfile has no steps.");
  return {
    title: (header.get("TITLE") ?? "").trim() || "Untitled",
    subtitle: (header.get("SUBTITLE") ?? "").trim(),
    artist: (header.get("ARTIST") ?? "").trim(),
    credit: (header.get("CREDIT") ?? "").trim(),
    music: (header.get("MUSIC") ?? "").trim(),
    timing,
    sampleStart: Math.max(0, number(header.get("SAMPLESTART"))),
    sampleLength: Math.max(0, number(header.get("SAMPLELENGTH"), 12)),
    charts,
  };
}

/** Rows a measure may be written with, smallest first. */
const ROWS = [4, 8, 12, 16, 24, 32, 48, 64, 96, 192];
const text = (value: string) => value.replace(/[\\#:;]/g, "\\$&");
const trim = (value: number) => String(Number(value.toFixed(6)));
const pairText = (list: readonly (readonly [number, number])[]) =>
  list.map(([beat, value]) => `${trim(beat)}=${trim(value)}`).join(",");

/** A chart's notes as `.ssc` note data: each measure with the fewest rows that hold its notes. */
function noteData(chart: SimChart, columns: number): string {
  const marks = new Map<number, Map<number, string>>();
  const put = (beat: number, column: number, char: string) => {
    const row = Math.round(beat * 48);
    let cells = marks.get(row);
    if (!cells) marks.set(row, (cells = new Map()));
    cells.set(column, char);
  };
  let last = 0;
  for (const note of chart.notes) {
    put(
      note.beat,
      note.column,
      note.kind === "tap"
        ? "1"
        : note.kind === "hold"
          ? "2"
          : note.kind === "roll"
            ? "4"
            : "M",
    );
    last = Math.max(last, note.endBeat ?? note.beat);
    if (note.endBeat !== undefined) put(note.endBeat, note.column, "3");
  }
  const measures: string[] = [];
  for (let measure = 0; measure <= Math.floor(last / 4); measure++) {
    const rows = [...marks.keys()].filter(
      (row) => row >= measure * 192 && row < (measure + 1) * 192,
    );
    const count =
      ROWS.find((size) =>
        rows.every((row) => (row % 192) % (192 / size) === 0),
      ) ?? 192;
    const lines: string[] = [];
    for (let index = 0; index < count; index++) {
      const cells = marks.get(measure * 192 + (index * 192) / count);
      let line = "";
      for (let column = 0; column < columns; column++)
        line += cells?.get(column) ?? "0";
      lines.push(line);
    }
    measures.push(lines.join("\n"));
  }
  return measures.join("\n,\n");
}

/** The simfile as `.ssc` text, readable by StepMania 5 and by `parseSimfile`. */
export function writeSsc(sim: Simfile): string {
  const lines = [
    "#VERSION:0.83;",
    `#TITLE:${text(sim.title)};`,
    `#SUBTITLE:${text(sim.subtitle)};`,
    `#ARTIST:${text(sim.artist)};`,
    `#CREDIT:${text(sim.credit)};`,
    `#MUSIC:${text(sim.music)};`,
    `#OFFSET:${trim(sim.timing.offset)};`,
    `#SAMPLESTART:${trim(sim.sampleStart)};`,
    `#SAMPLELENGTH:${trim(sim.sampleLength)};`,
    `#BPMS:${pairText(sim.timing.bpms)};`,
    `#STOPS:${pairText(sim.timing.stops)};`,
  ];
  for (const chart of sim.charts) {
    lines.push(
      "",
      "#NOTEDATA:;",
      `#STEPSTYPE:${text(chart.stepsType)};`,
      `#DESCRIPTION:${text(chart.description)};`,
      `#DIFFICULTY:${text(chart.difficulty)};`,
      `#METER:${chart.meter};`,
      `#CREDIT:${text(chart.credit)};`,
    );
    if (chart.timing)
      lines.push(
        `#OFFSET:${trim(chart.timing.offset)};`,
        `#BPMS:${pairText(chart.timing.bpms)};`,
        `#STOPS:${pairText(chart.timing.stops)};`,
      );
    lines.push(`#NOTES:\n${noteData(chart, COLUMNS[chart.stepsType] ?? 4)}\n;`);
  }
  return `${lines.join("\n")}\n`;
}

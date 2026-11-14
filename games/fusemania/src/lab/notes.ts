/**
 * Review notes from the chart lab: a time span, optionally a frequency band and a chart, and what the listener heard.
 * They are the hand-off to whoever tunes ChartNet's features, so the file format is plain, versioned JSON and every
 * read validates it.
 */

export const NOTE_TAGS = [
  "melody",
  "16ths",
  "missing steps",
  "extra steps",
  "too dense",
  "too sparse",
  "off beat",
  "good",
  "feature idea",
] as const;
export type NoteTag = (typeof NOTE_TAGS)[number];

export interface LabNote {
  id: string;
  /** ISO time it was written. */
  created: string;
  song: string;
  /** Seconds into the music. */
  start: number;
  end: number;
  /** Beats at `start` and `end` on the song's timing, for reading against the chart. */
  startBeat: number;
  endBeat: number;
  /** A band on the spectrogram, in hertz, when the note is about frequencies. */
  lowHz?: number;
  highHz?: number;
  /** The chart the note is about (`Hard`, `Challenge · candidate.ssc`), when it is about one. */
  chart?: string;
  tags: NoteTag[];
  text: string;
}

export interface NotesFile {
  version: 1;
  notes: LabNote[];
}

export const MAX_NOTES = 2000;
const MAX_TEXT = 4000;

export class NotesError extends Error {}

const finite = (value: unknown, name: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new NotesError(`${name} must be a number`);
  return value;
};
const string = (value: unknown, name: string, max = 200): string => {
  if (typeof value !== "string" || value.length > max)
    throw new NotesError(`${name} must be text of at most ${max} characters`);
  return value;
};

function readNote(raw: unknown, index: number): LabNote {
  if (typeof raw !== "object" || raw === null)
    throw new NotesError(`note ${index} is not an object`);
  const r = raw as Record<string, unknown>;
  const at = (name: string) => `note ${index}: ${name}`;
  const tags = r["tags"] ?? [];
  if (!Array.isArray(tags)) throw new NotesError(at("tags must be a list"));
  const note: LabNote = {
    id: string(r["id"], at("id"), 64),
    created: string(r["created"], at("created"), 64),
    song: string(r["song"], at("song"), 120),
    start: finite(r["start"], at("start")),
    end: finite(r["end"], at("end")),
    startBeat: finite(r["startBeat"], at("startBeat")),
    endBeat: finite(r["endBeat"], at("endBeat")),
    tags: tags.filter((tag): tag is NoteTag =>
      (NOTE_TAGS as readonly unknown[]).includes(tag),
    ),
    text: string(r["text"] ?? "", at("text"), MAX_TEXT),
  };
  if (note.end < note.start) throw new NotesError(at("end is before start"));
  if (r["lowHz"] !== undefined || r["highHz"] !== undefined) {
    note.lowHz = finite(r["lowHz"], at("lowHz"));
    note.highHz = finite(r["highHz"], at("highHz"));
    if (note.highHz < note.lowHz)
      throw new NotesError(at("highHz is below lowHz"));
  }
  if (r["chart"] !== undefined) note.chart = string(r["chart"], at("chart"));
  return note;
}

/** A notes file's text read and checked. Throws `NotesError` with what is wrong. */
export function parseNotes(text: string): NotesFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new NotesError("not JSON");
  }
  if (typeof raw !== "object" || raw === null)
    throw new NotesError("not a notes file");
  const r = raw as Record<string, unknown>;
  if (r["version"] !== 1) throw new NotesError("unknown notes version");
  const notes = r["notes"];
  if (!Array.isArray(notes)) throw new NotesError("notes must be a list");
  if (notes.length > MAX_NOTES)
    throw new NotesError(`more than ${MAX_NOTES} notes`);
  return { version: 1, notes: notes.map(readNote) };
}

export const writeNotes = (file: NotesFile): string =>
  `${JSON.stringify(file, null, 2)}\n`;

/** Notes from `incoming` added to `current`, a note with the same id replaced. */
export function mergeNotes(current: NotesFile, incoming: NotesFile): NotesFile {
  const byId = new Map(current.notes.map((note) => [note.id, note]));
  for (const note of incoming.notes) byId.set(note.id, note);
  return {
    version: 1,
    notes: [...byId.values()]
      .sort((a, b) => a.song.localeCompare(b.song) || a.start - b.start)
      .slice(0, MAX_NOTES),
  };
}

const clock = (seconds: number): string => {
  const whole = Math.max(0, seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${(whole - minutes * 60).toFixed(2).padStart(5, "0")}`;
};
const hz = (value: number): string =>
  value >= 1000
    ? `${(value / 1000).toFixed(2)} kHz`
    : `${Math.round(value)} Hz`;

/** One line a person can read and paste into a chat. */
export function describeNote(note: LabNote): string {
  const parts = [
    `${note.song} ${clock(note.start)}–${clock(note.end)} (beats ${note.startBeat.toFixed(2)}–${note.endBeat.toFixed(2)})`,
  ];
  if (note.lowHz !== undefined && note.highHz !== undefined)
    parts.push(`${hz(note.lowHz)}–${hz(note.highHz)}`);
  if (note.chart) parts.push(note.chart);
  if (note.tags.length > 0) parts.push(`[${note.tags.join(", ")}]`);
  return `${parts.join(" · ")}: ${note.text.trim() || "(no text)"}`;
}

import { END_PAD_MS, LATE_MS, LEAD_IN_MS, MAX_SONG_MS } from "./rules.js";
import { parseSimfile, type Simfile } from "./simfile.js";
import { MINE, compileSteps, type Steps } from "./steps.js";
import { createTiming, type Timing } from "./timing.js";

/**
 * The songs a match can be played on. A library is built from simfile texts (the bundled songs, or one a player
 * loaded for a solo run); the room's state names a song by id and a chart by its place in the song's list, and the
 * fold reads the compiled steps from here. Every device in a room has the same bundled library, which is what
 * `RULES` vouches for.
 */
export interface SongSource {
  readonly id: string;
  /** Where the audio is served from, relative to the site root (or any URL the page can fetch). */
  readonly audio: string;
  /** The `.sm` or `.ssc` text. */
  readonly ssc: string;
}
export interface ChartInfo {
  /** `Easy`, `Medium`, `Hard`, `Challenge`… as the simfile names it; an alternate adds its description, `Hard ChartNet`. */
  name: string;
  meter: number;
  /** Notes that get a judgment. */
  steps: number;
  holds: number;
  mines: number;
  /** The busiest second of the chart, in notes. */
  peak: number;
}
export interface SongInfo {
  id: string;
  title: string;
  artist: string;
  audio: string;
  /** The slowest and fastest tempo, for the song select. */
  bpm: readonly [number, number];
  sampleStart: number;
  sampleLength: number;
  /** The playable (4-column) charts, easiest first. */
  charts: readonly ChartInfo[];
  /** Song time at which a match on this song is over: the same for every chart, so a room ends together. */
  endMs: number;
}
export interface Library {
  readonly songs: readonly SongInfo[];
  song(id: string): SongInfo | undefined;
  /** The steps of a song's chart; a chart index past the song's hardest is its hardest. */
  steps(id: string, chart: number): Steps | undefined;
  /** A song's tempo map, for what is drawn on the beat. */
  timing(id: string): Timing | undefined;
}

const ORDER = ["beginner", "easy", "medium", "hard", "challenge", "edit"];
const rank = (name: string) => {
  const at = ORDER.indexOf(name.toLowerCase());
  return at < 0 ? ORDER.length : at;
};

interface Entry {
  info: SongInfo;
  steps: Steps[];
  timing: Timing;
}

function peakOf(steps: Steps): number {
  const times = steps.notes
    .filter((note) => note.kind !== MINE)
    .map((note) => note.ms);
  let peak = 0,
    from = 0;
  for (let to = 0; to < times.length; to++) {
    while (times[to]! - times[from]! >= 1000) from++;
    peak = Math.max(peak, to - from + 1);
  }
  return peak;
}

/**
 * Whether a chart fits the song time a match can carry: nothing before the lead-in, and an end the log and a
 * checkpoint still accept. A file whose offset or tempo puts it outside is left out, not half played.
 */
const playable = (steps: Steps): boolean =>
  (steps.notes[0]?.ms ?? 0) >= -LEAD_IN_MS / 2 &&
  steps.lastMs + END_PAD_MS + LATE_MS < MAX_SONG_MS;

function entryOf(source: SongSource, sim: Simfile): Entry | undefined {
  // A second chart of a difficulty the file already has (a ChartNet chart, say), and any Edit, is an alternate: it
  // comes after the song's own charts, so their indexes, and the default, stay put. A second chart is named after its
  // description too; an Edit by its description alone, as StepMania shows edits.
  const seen = new Set<string>();
  const charts = sim.charts
    .filter((chart) => chart.stepsType === "dance-single")
    .map((chart) => {
      const level = chart.difficulty.toLowerCase();
      const edit = level === "edit";
      const alternate = edit || seen.has(level);
      seen.add(level);
      const name =
        edit && chart.description
          ? chart.description
          : alternate
            ? `${chart.difficulty} ${chart.description || "Alt"}`
            : chart.difficulty;
      return { chart, name, alternate, steps: compileSteps(chart, sim.timing) };
    })
    .filter(
      (item): item is typeof item & { steps: Steps } =>
        item.steps !== undefined && playable(item.steps),
    )
    .sort(
      (a, b) =>
        Number(a.alternate) - Number(b.alternate) ||
        rank(a.chart.difficulty) - rank(b.chart.difficulty) ||
        a.chart.meter - b.chart.meter,
    );
  if (charts.length === 0) return;
  const tempos = (charts[0]!.chart.timing ?? sim.timing).bpms.map(
    ([, bpm]) => bpm,
  );
  return {
    info: {
      id: source.id,
      title: sim.title,
      artist: sim.artist,
      audio: source.audio,
      bpm: [Math.min(...tempos), Math.max(...tempos)],
      sampleStart: sim.sampleStart,
      sampleLength: sim.sampleLength,
      charts: charts.map(({ chart, name, steps }) => ({
        name,
        meter: chart.meter,
        steps: steps.steps,
        holds: steps.holds,
        mines: steps.mines.reduce((sum, lane) => sum + lane.length, 0),
        peak: peakOf(steps),
      })),
      endMs: Math.max(...charts.map(({ steps }) => steps.lastMs)) + END_PAD_MS,
    },
    steps: charts.map(({ steps }) => steps),
    timing: createTiming(charts[0]!.chart.timing ?? sim.timing),
  };
}

/** A library over `sources`. A source that does not parse, or has no 4-column chart, is left out. */
export function createLibrary(sources: readonly SongSource[]): Library {
  const entries = new Map<string, Entry>();
  for (const source of sources) {
    if (entries.has(source.id)) continue;
    try {
      const entry = entryOf(source, parseSimfile(source.ssc));
      if (entry) entries.set(source.id, entry);
    } catch {
      // A simfile that cannot be read is not a song.
    }
  }
  const songs = [...entries.values()].map((entry) => entry.info);
  return {
    songs,
    song: (id) => entries.get(id)?.info,
    timing: (id) => entries.get(id)?.timing,
    steps(id, chart) {
      const entry = entries.get(id);
      if (!entry || !Number.isInteger(chart) || chart < 0) return;
      return entry.steps[Math.min(chart, entry.steps.length - 1)];
    },
  };
}

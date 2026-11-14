import {
  createLibrary,
  writeSsc,
  type ChartNote,
  type Library,
  type SimChart,
} from "../../src/engine/index.js";

/**
 * A small library for tests: "grid" at 120 BPM (a beat every 500 ms, beat 0 at 0 ms) with two charts. Easy is a tap
 * every beat from beat 4 for 64 beats, walking the columns; Hard adds a hold, a roll, a jump and a mine.
 */
const tap = (beat: number, column: number): ChartNote => ({
  beat,
  column,
  kind: "tap",
});
const chart = (
  difficulty: string,
  meter: number,
  notes: ChartNote[],
): SimChart => ({
  stepsType: "dance-single",
  difficulty,
  meter,
  description: "",
  credit: "test",
  notes,
});

export const EASY_NOTES: ChartNote[] = Array.from({ length: 64 }, (_, index) =>
  tap(4 + index, index % 4),
);
export const HARD_NOTES: ChartNote[] = [
  tap(4, 0),
  tap(4, 3),
  { beat: 6, column: 1, kind: "hold", endBeat: 8 },
  { beat: 9, column: 2, kind: "roll", endBeat: 12 },
  { beat: 13, column: 0, kind: "mine" },
  tap(14, 0),
  ...Array.from({ length: 100 }, (_, index) => tap(16 + index / 2, index % 4)),
];

export const GRID_SSC = writeSsc({
  title: "Grid",
  subtitle: "",
  artist: "Test",
  credit: "",
  music: "grid.mp3",
  timing: { offset: 0, bpms: [[0, 120]], stops: [] },
  sampleStart: 10,
  sampleLength: 12,
  charts: [chart("Easy", 3, EASY_NOTES), chart("Hard", 9, HARD_NOTES)],
});
export const OTHER_SSC = writeSsc({
  title: "Other",
  subtitle: "",
  artist: "Test",
  credit: "",
  music: "other.mp3",
  timing: { offset: -0.25, bpms: [[0, 150]], stops: [] },
  sampleStart: 0,
  sampleLength: 12,
  charts: [chart("Medium", 5, EASY_NOTES)],
});

export const testLibrary = (): Library =>
  createLibrary([
    { id: "grid", audio: "music/grid.mp3", ssc: GRID_SSC },
    { id: "other", audio: "music/other.mp3", ssc: OTHER_SSC },
  ]);
/** Song time of `beat` in "grid". */
export const beatMs = (beat: number): number => beat * 500;

/**
 * Step charts for Fusemania, generated from the Fuse portfolio's own music.
 *
 *   pnpm exec tsx scripts/fusemania-charts.ts [analyze|generate|bundle|report|compare] [song id...]
 *
 * - `analyze` decodes each song with ffmpeg, finds its tempo, beat and bar, and writes what the music does on that
 *   grid to `games/fusemania/charts/analysis/<id>.json` (committed, so the next steps need neither audio nor ffmpeg).
 * - `generate` turns each analysis into `games/fusemania/charts/<id>.ssc`: Easy, Medium, Hard and Challenge.
 * - `bundle` packs every `.ssc` into `games/fusemania/src/engine/songs-data.ts` for the game.
 * - `report` prints one line per song and chart.
 * - `compare` measures the generated charts the way `games/fusemania/charts/reference-patterns.json` measures
 *   published ones and prints the two side by side, a difficulty at a time. It only runs when asked for.
 *
 * With no sub-command the first four run in that order. Song ids narrow all but `bundle`, which always
 * takes every chart on disk. `games/fusemania/charts/README.md` has the conventions and how to hand-edit a chart.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import {
  bpmRange,
  parseAnalysis,
  type Analysis,
} from "./lib/fusemania/analysis.js";
import { analyzeFile } from "./lib/fusemania/analyze.js";
import {
  compareText,
  measureChart,
  type Measures,
} from "./lib/fusemania/compare.js";
import {
  DIFFICULTIES,
  chartStats,
  generateCharts,
  type Difficulty,
} from "./lib/fusemania/generate.js";
import { SONGS, songById, type SongSpec } from "./lib/fusemania/songs.js";
import { songsDataModule, sscText } from "./lib/fusemania/ssc.js";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const CHARTS = "games/fusemania/charts";
const ANALYSIS = join(CHARTS, "analysis");
const BUNDLE = "games/fusemania/src/engine/songs-data.ts";

const analysisPath = (id: string): string => join(ANALYSIS, `${id}.json`);
const chartPath = (id: string): string => join(CHARTS, `${id}.ssc`);
const readAnalysis = (id: string): Analysis =>
  parseAnalysis(readFileSync(analysisPath(id), "utf8"));

async function analyze(song: SongSpec): Promise<void> {
  const started = Date.now();
  const analysis = analyzeFile(song.id, song.file);
  mkdirSync(ANALYSIS, { recursive: true });
  // Through Prettier, so the committed file is already what `pnpm format` would make of it.
  writeFileSync(
    analysisPath(song.id),
    await format(JSON.stringify(analysis), { parser: "json" }),
  );
  console.log(
    `analyzed ${song.id} in ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
}

function generate(song: SongSpec): void {
  const analysis = readAnalysis(song.id);
  writeFileSync(chartPath(song.id), sscText(song, analysis));
}

function bundle(): void {
  const songs = SONGS.filter((song) => existsSync(chartPath(song.id))).map(
    (song) => ({ song, ssc: readFileSync(chartPath(song.id), "utf8") }),
  );
  const strays = readdirSync(CHARTS)
    .filter((name) => name.endsWith(".ssc"))
    .filter((name) => !songById(name.slice(0, -4)));
  if (strays.length > 0)
    throw new Error(
      `charts without a song in scripts/lib/fusemania/songs.ts: ${strays.join(", ")}`,
    );
  writeFileSync(BUNDLE, songsDataModule(songs));
  console.log(`bundled ${songs.length} songs into ${BUNDLE}`);
}

function report(songs: readonly SongSpec[]): void {
  for (const song of songs) {
    const analysis = readAnalysis(song.id);
    const [low, high] = bpmRange(analysis);
    const quality = analysis.quality;
    console.log(
      `${song.id}: bpm ${low === high ? low : `${low}-${high} (${analysis.bpms.length} segments)`}, offset ${analysis.offset}, ` +
        `grid ${analysis.levels}, on-grid ${quality.align} (chance ${quality.chance}), drift ${quality.driftMs} ms ` +
        `(one tempo would drift ${quality.rampMs} ms), pulse ${quality.pulse}, downbeat ${quality.downbeat}`,
    );
    for (const chart of generateCharts(analysis)) {
      const stats = chartStats(analysis, chart);
      console.log(
        `  ${chart.difficulty.padEnd(9)} meter ${String(chart.meter).padStart(2)}  notes ${String(stats.notes).padStart(4)}  ` +
          `avg ${stats.average.toFixed(2)}/s  peak ${stats.peak.toFixed(2)}/s  jumps ${String(stats.jumps).padStart(3)}  ` +
          `holds ${String(stats.holds).padStart(3)}  mines ${stats.mines}`,
      );
    }
  }
}

/** The generated charts beside the published ones' statistics, a difficulty at a time. */
function compare(songs: readonly SongSpec[]): void {
  const measures = new Map<Difficulty, Measures[]>();
  for (const song of songs) {
    const analysis = readAnalysis(song.id);
    for (const chart of generateCharts(analysis)) {
      const found = measures.get(chart.difficulty) ?? [];
      found.push(measureChart(analysis, chart));
      measures.set(chart.difficulty, found);
    }
  }
  for (const difficulty of DIFFICULTIES)
    console.log(`${compareText(difficulty, measures.get(difficulty) ?? [])}\n`);
}

/** `analyze` for several songs at once: one child process per song, a few at a time (each is CPU-bound). */
function analyzeInParallel(songs: readonly SongSpec[]): void {
  const queue = songs.map((song) => song.id);
  const script = fileURLToPath(import.meta.url);
  const size = 4;
  for (let at = 0; at < queue.length; at += size) {
    const batch = queue.slice(at, at + size);
    const run = spawnSync(
      "sh",
      [
        "-c",
        batch
          .map(
            (id) =>
              `"${process.execPath}" --import tsx "${script}" analyze-one ${id} &`,
          )
          .join(" ") + " wait",
      ],
      { stdio: "inherit" },
    );
    if (run.status !== 0) throw new Error("analysis failed");
  }
}

const [command, ...ids] = process.argv.slice(2);
const commands = [
  "analyze",
  "analyze-one",
  "generate",
  "bundle",
  "report",
  "compare",
];
if (command !== undefined && !commands.includes(command)) {
  console.error(
    `usage: fusemania-charts.ts [analyze|generate|bundle|report|compare] [song id...]`,
  );
  process.exit(2);
}
const chosen =
  ids.length === 0
    ? SONGS
    : ids.map((id) => {
        const song = songById(id);
        if (!song) throw new Error(`no song "${id}"`);
        return song;
      });
if (command === "analyze-one") for (const song of chosen) await analyze(song);
if (command === undefined || command === "analyze") {
  if (chosen.length > 1) analyzeInParallel(chosen);
  else for (const song of chosen) await analyze(song);
}
if (command === undefined || command === "generate") {
  for (const song of chosen) generate(song);
  console.log(`generated ${chosen.length} charts in ${CHARTS}`);
}
if (command === undefined || command === "bundle") bundle();
if (command === undefined || command === "report") report(chosen);
if (command === "compare") compare(chosen);

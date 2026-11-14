/**
 * A played song as the result's timing graph shows it: every step this device hit with how far off the press was,
 * every miss, and the combo as it rose and broke.
 *
 * It is read from the picture frame by frame, as `timing-bias.ts` reads its hits, so it costs the engine nothing
 * and is this device's own run only: another rider's presses are not in any picture, and a page opened on a song
 * that is already over has nothing to show. The view carries the newest judgment's offset alone, so two steps hit
 * in one frame with different judgments leave one of them without a dot (`unplaced`); a jump judged the same on
 * both arrows is two dots in one place.
 */
import {
  BOO,
  MARVELOUS,
  MISS,
  WINDOWS,
  WORST_WINDOW,
  type PlayerView,
} from "../engine/index.js";

/** One step that was hit: the note's song time (ms), how far off the press was (negative: early), its judgment. */
export interface LoggedStep {
  at: number;
  off: number;
  judgment: number;
}
export interface RunLog {
  steps: readonly LoggedStep[];
  /** The song time (ms) of each note that went by unhit. */
  misses: readonly number[];
  /** The combo each time it changed: song time (ms) and the combo from then on. */
  combo: readonly (readonly [at: number, combo: number])[];
  /** Steps hit whose offset the picture did not carry. */
  unplaced: number;
}
export interface RunLogger {
  /** `run` names the match: another one starts the log over. `ms` is the song time of the picture. */
  observe(player: PlayerView, run: string, ms: number): void;
  log(): RunLog;
  reset(): void;
}

export function createRunLogger(limit = 6000): RunLogger {
  let steps: LoggedStep[] = [],
    misses: number[] = [],
    combo: [number, number][] = [],
    unplaced = 0,
    current: string | undefined,
    before: number[] = [],
    comboBefore = 0;
  const clear = () => {
    steps = [];
    misses = [];
    combo = [];
    unplaced = 0;
    comboBefore = 0;
  };
  return {
    observe(player, run, ms) {
      const counts = player.counts;
      if (run !== current) {
        current = run;
        clear();
        // A page that opens on a match in progress starts counting from here.
        before = [...counts];
        comboBefore = player.combo;
        return;
      }
      for (let judgment = MARVELOUS; judgment <= BOO; judgment++) {
        const fresh = (counts[judgment] ?? 0) - (before[judgment] ?? 0);
        if (fresh <= 0) continue;
        if (judgment !== player.judged) unplaced += fresh;
        else
          for (let n = 0; n < fresh && steps.length < limit; n++)
            steps.push({
              at: player.judgedAt,
              off: player.judgedOff,
              judgment,
            });
      }
      const missed = (counts[MISS] ?? 0) - (before[MISS] ?? 0);
      // A miss is given when the note's last window closes.
      const missAt =
        (player.judged === MISS ? player.judgedAt : ms) - WORST_WINDOW;
      for (let n = 0; n < missed && misses.length < limit; n++)
        misses.push(missAt);
      before = [...counts];
      if (player.combo !== comboBefore && combo.length < limit) {
        combo.push([ms, player.combo]);
        comboBefore = player.combo;
      }
    },
    log: () => ({ steps, misses, combo, unplaced }),
    reset() {
      current = undefined;
      before = [];
      clear();
    },
  };
}

export interface RunStats {
  /** Steps with a known offset. */
  hits: number;
  /** Mean signed offset, ms: negative = early. */
  meanMs: number;
  /** Standard deviation of the offsets, ms. */
  spreadMs: number;
  /** Mean distance from the note, ms. */
  absMs: number;
  /** Hits outside the Marvelous window on each side. */
  early: number;
  late: number;
  /** The largest distance from a note, ms. */
  worstMs: number;
}

/** What the offsets of a run add up to. */
export function runStats(steps: readonly LoggedStep[]): RunStats {
  const offs = steps.map((step) => step.off).filter(Number.isFinite),
    hits = offs.length;
  if (!hits)
    return {
      hits: 0,
      meanMs: 0,
      spreadMs: 0,
      absMs: 0,
      early: 0,
      late: 0,
      worstMs: 0,
    };
  const meanMs = offs.reduce((sum, off) => sum + off, 0) / hits;
  return {
    hits,
    meanMs,
    spreadMs: Math.sqrt(
      offs.reduce((sum, off) => sum + (off - meanMs) ** 2, 0) / hits,
    ),
    absMs: offs.reduce((sum, off) => sum + Math.abs(off), 0) / hits,
    early: offs.filter((off) => off < -WINDOWS[MARVELOUS]).length,
    late: offs.filter((off) => off > WINDOWS[MARVELOUS]).length,
    worstMs: Math.max(...offs.map(Math.abs)),
  };
}

const signedMs = (ms: number): string =>
  `${ms > 0 ? "+" : ms < 0 ? "−" : ""}${Math.abs(ms).toFixed(1)} ms`;

/** The numbers under the graph, one pair each: ["MEAN", "−4.2 ms EARLY"]. */
export function statLines(stats: RunStats): [label: string, value: string][] {
  if (!stats.hits) return [];
  const side =
    Math.abs(stats.meanMs) < 0.05 ? "" : stats.meanMs < 0 ? " EARLY" : " LATE";
  return [
    ["MEAN", `${signedMs(stats.meanMs)}${side}`],
    ["STD DEV", `${stats.spreadMs.toFixed(1)} ms`],
    ["MEAN ABS", `${stats.absMs.toFixed(1)} ms`],
    ["EARLY", String(stats.early)],
    ["LATE", String(stats.late)],
  ];
}

/** The offset range the graph shows, ms each side of zero: what holds every hit, never less than a Perfect. */
export function graphRange(steps: readonly LoggedStep[]): number {
  let worst = 0;
  for (const step of steps)
    if (Number.isFinite(step.off)) worst = Math.max(worst, Math.abs(step.off));
  return Math.min(WORST_WINDOW, Math.max(WINDOWS[1] + 10, worst + 8));
}

/** How many hits fall in each `binMs` of offset from `-range` to `range`, earliest first. */
export function histogram(
  steps: readonly LoggedStep[],
  range: number,
  binMs = 4,
): number[] {
  const bins = Array.from(
    { length: Math.max(1, Math.ceil((2 * range) / binMs)) },
    () => 0,
  );
  for (const step of steps) {
    if (!Number.isFinite(step.off)) continue;
    const index = Math.floor((step.off + range) / binMs);
    bins[Math.max(0, Math.min(bins.length - 1, index))]!++;
  }
  return bins;
}

import type { MetricCounts, MetricsRow } from "fuse-telemetry/contracts";

export const measures = [
  ["events", "Events"],
  ["users", "Unique browser users"],
  ["sessions", "Sessions"],
  ["roundStarts", "Round plays"],
  ["roundEnds", "Completions"],
] as const;
export type Measure = (typeof measures)[number][0];
export type SortKey = Measure | "gameId";

/** One aligned period at a time: summing daily uniques would misstate weekly users. */
export function comparisonRows(
  rows: readonly MetricsRow[],
  periodStart: string,
  key: SortKey,
  descending: boolean,
): MetricsRow[] {
  return rows
    .filter((row) => row.periodStart === periodStart)
    .sort((a, b) => {
      const order =
        key === "gameId"
          ? (a.gameId ?? "").localeCompare(b.gameId ?? "")
          : a[key] - b[key];
      return (
        (descending ? -order : order) ||
        (a.gameId ?? "").localeCompare(b.gameId ?? "")
      );
    });
}

export function defaultDateRange(now: Date): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 29);
  return { from: start.toISOString().slice(0, 10), to };
}

export function timestamp(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function chartPoints(
  rows: readonly MetricCounts[],
  measure: Measure,
): string {
  const max = Math.max(1, ...rows.map((row) => row[measure]));
  return rows
    .map(
      (row, index) =>
        `${rows.length < 2 ? 300 : (index / (rows.length - 1)) * 600},${120 - (row[measure] / max) * 110}`,
    )
    .join(" ");
}

/** Formats a tick count (20 ticks/second) as a short duration label for the match recap. */
export function durationText(ticks: number): string {
  const seconds = ticks / 20;
  // Short survivals keep a tenth of a second, rounded to one decimal first.
  if (seconds < 10) return `${(Math.round(seconds * 10) / 10).toFixed(1)}s`;
  // Round before splitting so 59.95 s becomes "1m 0s", never "60s" or "1m 60s" (#28).
  const totalSeconds = Math.round(seconds);
  if (totalSeconds >= 60) return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
  return `${totalSeconds}s`;
}

/** Formats a tick count (20 ticks/second) as a short duration label for the match recap. */
export function durationText(ticks: number): string {
  const totalSeconds = Math.round(ticks / 20);
  if (totalSeconds >= 60) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
  }
  return `${totalSeconds}s`;
}

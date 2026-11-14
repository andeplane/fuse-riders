/**
 * Which of a song's charts the chart lab shows when it opens: the difficulties ticked last time, else one.
 */

/** The difficulty shown when nothing was chosen before. */
export const DEFAULT_SHOWN = "Hard";

/** The stored list of shown chart labels, or undefined when there is none or it is not a list of strings. */
export function parseShown(text: string | null): string[] | undefined {
  if (!text) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return undefined;
    return value.filter((item): item is string => typeof item === "string");
  } catch {
    return undefined;
  }
}

/**
 * The keys of the charts to hide when a song opens. With a remembered choice, every chart whose label is not in it;
 * if that would hide them all (this song has none of those difficulties) or nothing was remembered, all but one:
 * `DEFAULT_SHOWN` when the song has it, else its first chart. An explicitly empty choice hides everything.
 */
export function hiddenAtStart(
  charts: readonly { readonly key: string; readonly label: string }[],
  shown: readonly string[] | undefined,
): string[] {
  if (shown?.length === 0) return charts.map((chart) => chart.key);
  const wanted = charts.filter((chart) => shown?.includes(chart.label));
  const keep = wanted.length
    ? wanted
    : [charts.find((chart) => chart.label === DEFAULT_SHOWN) ?? charts[0]];
  return charts
    .filter((chart) => !keep.includes(chart))
    .map((chart) => chart.key);
}

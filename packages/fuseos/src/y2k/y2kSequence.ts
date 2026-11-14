/**
 * The Y2K sequence as a pure timeline: given how long ago it started, which phase it is in and
 * what the taskbar clock should read. Nothing here touches timers or the DOM.
 *
 * countdown  the clock reads 11:59:50 PM 12/31/1999 and counts the last ten seconds
 * rollover   "midnight": the clock rolls to 12:00 AM 1/1/1900
 * glitch     the clock garbles and the desktop flickers (skipped visually under reduced motion)
 * aftermath  the "Year 2000 compliance" warning is up and Clippy has had his say; the clock is stuck in 1900
 * then real time returns.
 */
export const COUNTDOWN_MS = 10_000;
export const ROLLOVER_MS = 1_200;
export const GLITCH_MS = 2_800;
export const AFTERMATH_MS = 8_000;
export const TOTAL_MS = COUNTDOWN_MS + ROLLOVER_MS + GLITCH_MS + AFTERMATH_MS;
/** How often the clock override re-renders while the sequence runs. */
export const TICK_MS = 250;

export type Y2kPhase = "countdown" | "rollover" | "glitch" | "aftermath";

export const Y2K_WARNING_TITLE = "Year 2000 compliance";
export const Y2K_WARNING_MESSAGE =
  "FuseOS has detected a system date earlier than 01/01/1980.\n\nThe real-time clock has rolled over to 01/01/1900. Programs that rely on two-digit years may now believe it is the nineteenth century. Please contact your system administrator before the year 2000.";
export const Y2K_CLIPPY_LINE = "It looks like the millennium bug got us!";

export const ROLLOVER_TEXT = "12:00 AM 1/1/1900";
/** What the garbled clock reads when the user prefers reduced motion: one still frame instead of a flicker. */
export const STILL_GARBLE_TEXT = "1?:0# AM 1/1/19¿0";

/** The phase at `elapsed` ms since the sequence started; null before the start and once it is over. */
export function phaseAt(elapsed: number): Y2kPhase | null {
  if (elapsed < 0 || elapsed >= TOTAL_MS) return null;
  if (elapsed < COUNTDOWN_MS) return "countdown";
  if (elapsed < COUNTDOWN_MS + ROLLOVER_MS) return "rollover";
  if (elapsed < COUNTDOWN_MS + ROLLOVER_MS + GLITCH_MS) return "glitch";
  return "aftermath";
}

/** The countdown clock: 11:59:50 PM through 11:59:59 PM on New Year's Eve 1999. */
export function countdownText(elapsed: number): string {
  const second = Math.min(59, 50 + Math.floor(elapsed / 1000));
  return `11:59:${second} PM 12/31/1999`;
}

const GARBLE_CHARS = "#%&?¿§¤░▒▓";

/** Every digit of the 1900 clock has a chance of being replaced by line noise; `random` is injected so a test can pin it. */
export function garble(text: string, random: () => number): string {
  return Array.from(text, (char) => {
    if (!/[0-9]/.test(char) || random() < 0.5) return char;
    const index = Math.floor(random() * GARBLE_CHARS.length);
    return GARBLE_CHARS[index] ?? char;
  }).join("");
}

export type ClockTextOptions = {
  random: () => number;
  reducedMotion: boolean;
};

/** What the taskbar clock reads at `elapsed` ms into the sequence; null once real time is back. */
export function clockTextAt(
  elapsed: number,
  { random, reducedMotion }: ClockTextOptions,
): string | null {
  switch (phaseAt(elapsed)) {
    case "countdown":
      return countdownText(elapsed);
    case "rollover":
    case "aftermath":
      return ROLLOVER_TEXT;
    case "glitch":
      return reducedMotion ? STILL_GARBLE_TEXT : garble(ROLLOVER_TEXT, random);
    case null:
      return null;
  }
}

/**
 * The fake player's "buffering" as a pure state machine, ticked by the window on a schedule.
 * The bar races to about a fifth, crawls (the drama), then either dies on the codec check or,
 * for the one file that is really a game, sprints to the end.
 */
export type PlaybackState =
  | { phase: "stopped" }
  | { phase: "buffering"; progress: number }
  | { phase: "error"; message: string }
  | { phase: "playing" };

/** Milliseconds between buffering ticks. */
export const BUFFER_TICK_MS = 120;

/** Where the codec check happens, in percent; every file without a game behind it dies here. */
export const CODEC_CHECK_AT = 23;

/** The percent each tick adds: quick, then a crawl around the codec check, then quick again. */
export function tickAdvance(progress: number): number {
  if (progress < 18) return 3;
  if (progress < 24) return 1;
  return 5;
}

export const INITIAL_PLAYBACK: PlaybackState = { phase: "stopped" };

export function startBuffering(): PlaybackState {
  return { phase: "buffering", progress: 0 };
}

/** The Windows Media Player box for a missing codec, named after the file. */
export function codecErrorMessage(file: string): string {
  return [
    `Windows Media Player cannot play "${file}".`,
    "",
    "The video codec required to play this file (FUSEVID 1.0, Teal Edition) is not installed on your computer, and the download site closed in 1999.",
    "",
    "Error C00D11B1: Codec not found.",
  ].join("\n");
}

/**
 * One buffering tick. A file with a game behind it (`launches`) buffers to the end and starts
 * playing; any other file hits the codec check. Ticks in any other phase change nothing.
 */
export function advancePlayback(
  state: PlaybackState,
  file: string,
  launches: boolean,
): PlaybackState {
  if (state.phase !== "buffering") return state;
  const progress = Math.min(100, state.progress + tickAdvance(state.progress));
  if (!launches && progress >= CODEC_CHECK_AT)
    return { phase: "error", message: codecErrorMessage(file) };
  if (progress >= 100) return { phase: "playing" };
  return { phase: "buffering", progress };
}

/** The status bar's left field. */
export function playbackStatus(state: PlaybackState): string {
  switch (state.phase) {
    case "stopped":
      return "Stopped";
    case "buffering":
      return `Buffering... ${state.progress}%`;
    case "error":
      return "Cannot play file";
    case "playing":
      return "Playing";
  }
}

/** A deterministic, faintly ridiculous running time for the status bar, from the file name. */
export function fakeDuration(file: string): string {
  let hash = 0;
  for (const char of file) hash = (hash * 31 + char.charCodeAt(0)) % 7919;
  const totalSeconds = 1800 + (hash % 5400);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

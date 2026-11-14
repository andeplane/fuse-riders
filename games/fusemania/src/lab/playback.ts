/**
 * The chart lab's transport keys, as pure functions: which key seeks how far, which focused control keeps its own
 * keys, and where the view must sit to show the playhead.
 */

/** The parts of a keyboard event the transport reads. */
export interface TransportKey {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}

export const SEEK_STEP = 0.5;
/** VLC's "very short jump" (shift) and "short jump" (alt/option). */
export const SEEK_SHIFT = 3;
export const SEEK_ALT = 10;

/**
 * Seconds a key press seeks: ← back and → forward by 0.5 s, 3 s with shift, 10 s with option/alt as in VLC (alt wins over
 * shift). Undefined for any other key, and with ⌘ or ctrl held, which belong to the browser (back, forward).
 */
export function seekDelta(event: TransportKey): number | undefined {
  if (event.metaKey || event.ctrlKey) return undefined;
  const direction =
    event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
  if (!direction) return undefined;
  const step = event.altKey
    ? SEEK_ALT
    : event.shiftKey
      ? SEEK_SHIFT
      : SEEK_STEP;
  return direction * step;
}

/** The focused element, as far as the transport keys care. */
export interface KeyTarget {
  readonly tagName: string;
  readonly type?: string;
  readonly isContentEditable?: boolean;
}

/**
 * Whether the focused control needs the keys itself: anywhere text is typed (the notes field, a text input). Buttons,
 * checkboxes, sliders and menus do not, so space and the arrows still drive playback after clicking one.
 */
export function typingIn(target: KeyTarget | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA") return true;
  if (target.tagName !== "INPUT") return false;
  return !["checkbox", "range", "button", "file", "radio"].includes(
    target.type ?? "text",
  );
}

/**
 * The view's top time that shows the playhead: unchanged while the playhead is comfortably in view, otherwise the
 * playhead 30% down the view, where playback keeps it.
 */
export function revealTop(
  playhead: number,
  topTime: number,
  viewSeconds: number,
): number {
  const margin = viewSeconds * 0.08;
  if (
    playhead >= topTime + margin &&
    playhead <= topTime + viewSeconds - margin
  )
    return topTime;
  return playhead - viewSeconds * 0.3;
}

/** The URL fragment that remembers where the playhead is, to a tenth of a second: `#t=83.4`. */
export const resumeHash = (seconds: number): string =>
  `#t=${Math.max(0, seconds).toFixed(1)}`;

/** The playhead a URL fragment remembers, or undefined when it has none. */
export function parseResume(hash: string): number | undefined {
  const match = /^#t=(\d{1,6}(?:\.\d{1,3})?)$/.exec(hash);
  return match ? Number(match[1]) : undefined;
}

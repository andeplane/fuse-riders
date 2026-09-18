import { el } from "./dom.js";

export type NoticeTone = "info" | "good" | "warn" | "error";

export interface NoticeOptions {
  /** A toast hides itself after `holdMs`; a status line (the default) stays until replaced or cleared. */
  holdMs?: number;
  /** Timer for the toast; inject in tests. */
  setTimeout?: (run: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  className?: string;
  document?: Document;
}

export interface Notice {
  element: HTMLElement;
  /**
   * Show `text` in `tone`. Repeating the same text and tone changes nothing, so it is safe to call every frame; for a
   * toast that includes a hold that already ran out: the toast stays hidden until the text or tone changes.
   */
  show(text: string, tone?: NoticeTone): void;
  /** Show `text` as a new event: a toast restarts its hold even when the same text is already up or has just hidden. */
  flash(text: string, tone?: NoticeTone): void;
  clear(): void;
}

/**
 * A status line or a toast. It is a polite live region: a screen reader reads a change once, and an error is
 * announced as an alert. The tone is `data-tone`, for the stylesheet. `show` is for state a screen re-renders every
 * frame, `flash` for one event (two "Rolled a 1" in a row are two flashes).
 */
export function createNotice(options: NoticeOptions = {}): Notice {
  const doc = options.document ?? document;
  const element = el("div", "", options.className ?? "fui-notice", doc);
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  element.hidden = true;
  const later = options.setTimeout ?? ((run, ms) => setTimeout(run, ms));
  const cancel =
    options.clearTimeout ??
    ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  // `shown` is the last text and tone asked for, kept after a toast's hold hides it, so a per-frame `show` of the same
  // text does not bring it back.
  let timer: unknown,
    shown = "";
  const stopTimer = () => {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
  };
  const hide = () => {
    timer = undefined;
    element.textContent = "";
    element.hidden = true;
  };
  const clear = () => {
    stopTimer();
    shown = "";
    hide();
  };
  const display = (text: string, tone: NoticeTone) => {
    shown = `${tone}\n${text}`;
    element.textContent = text;
    element.dataset.tone = tone;
    element.setAttribute("role", tone === "error" ? "alert" : "status");
    element.setAttribute(
      "aria-live",
      tone === "error" ? "assertive" : "polite",
    );
    element.hidden = false;
    stopTimer();
    if (options.holdMs !== undefined) timer = later(hide, options.holdMs);
  };
  return {
    element,
    clear,
    show(text, tone = "info") {
      if (!text) return clear();
      if (`${tone}\n${text}` !== shown) display(text, tone);
    },
    flash(text, tone = "info") {
      if (!text) return clear();
      display(text, tone);
    },
  };
}

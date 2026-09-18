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
  /** Show `text` in `tone`. Repeating the same text and tone changes nothing, so it is safe to call every frame. */
  show(text: string, tone?: NoticeTone): void;
  clear(): void;
}

/**
 * A status line or a toast. It is a polite live region: a screen reader reads a change once, and an error is
 * announced as an alert. The tone is `data-tone`, for the stylesheet.
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
  let timer: unknown,
    shown = "";
  const stopTimer = () => {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
  };
  const clear = () => {
    stopTimer();
    shown = "";
    element.textContent = "";
    element.hidden = true;
  };
  return {
    element,
    clear,
    show(text, tone = "info") {
      if (!text) return clear();
      const key = `${tone}\n${text}`;
      if (key === shown) return;
      shown = key;
      element.textContent = text;
      element.dataset.tone = tone;
      element.setAttribute("role", tone === "error" ? "alert" : "status");
      element.hidden = false;
      stopTimer();
      if (options.holdMs !== undefined) timer = later(clear, options.holdMs);
    },
  };
}

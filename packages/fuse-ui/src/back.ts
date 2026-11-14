import { el } from "./dom.js";

export interface BackButtonOptions {
  /** What the button says; its accessible name too. */
  label?: string;
  /** Classes besides `fui-back` (a game's own hook for tests or layout). */
  className?: string;
  onBack?: () => void;
  document?: Document;
}

/** The one Back there is: a chevron (drawn in CSS) and a word, the top-left control of a page or a dialog. */
export function createBackButton(
  options: BackButtonOptions = {},
): HTMLButtonElement {
  const back = el("button", "", "", options.document);
  back.type = "button";
  dress(back, options);
  if (options.onBack) {
    const onBack = options.onBack;
    back.onclick = () => onBack();
  }
  return back;
}

/** Back as a link, for a page that is left by going to another address (a room, a screen with its own URL). */
export function createBackLink(
  options: BackButtonOptions & { href: string },
): HTMLAnchorElement {
  const back = el("a", "", "", options.document);
  back.href = options.href;
  dress(back, options);
  return back;
}

function dress(back: HTMLElement, options: BackButtonOptions): void {
  const label = options.label ?? "Back";
  back.className = options.className
    ? `fui-back ${options.className}`
    : "fui-back";
  back.textContent = label;
  back.setAttribute("aria-label", label);
}

export interface PageHeaderOptions {
  /** The page's heading, beside Back. */
  title?: string;
  /** From `createBackButton` or `createBackLink`. Omit on a page with nowhere to go back to. */
  back?: HTMLElement;
  /** Right of the title: secondary actions first, the primary action last. */
  actions?: readonly Node[];
  document?: Document;
}

export interface PageHeader {
  element: HTMLElement;
  title: HTMLElement;
  /** Where a page's actions go: the same place a dialog's bar has them. */
  actions: HTMLElement;
}

/**
 * The bar at the top of a page that is not the front door: Back at the left, the title beside it, the page's
 * actions at the right. A dialog's bar (`createDialog`) is the same thing with the same parts in the same order.
 */
export function createPageHeader(options: PageHeaderOptions = {}): PageHeader {
  const doc = options.document;
  const element = el("header", "", "fui-page-head", doc),
    title = el("h2", options.title ?? "", "fui-page-title", doc),
    actions = el("div", "", "fui-page-actions", doc);
  title.hidden = !options.title;
  actions.append(...(options.actions ?? []));
  if (options.back) element.append(options.back);
  element.append(title, actions);
  return { element, title, actions };
}

export interface SubPageOptions {
  title: string;
  /** Where Back goes: the game's front door. */
  backHref: string;
  /** Under the header. */
  content?: readonly Node[];
  document?: Document;
}

export interface SubPage {
  element: HTMLElement;
  header: PageHeader;
  back: HTMLAnchorElement;
}

/**
 * A page of a game that is not its front door or a room (a screen with its own address, a room code that is not
 * one): a `main` that starts under the shared top bar with the page's header first. Put it beside the top bar
 * and call `backOnEscape(page.back)` once the page's own keys are bound.
 */
export function createSubPage(options: SubPageOptions): SubPage {
  const doc = options.document;
  const back = createBackLink({ href: options.backHref, document: doc });
  const header = createPageHeader({
    title: options.title,
    back,
    document: doc,
  });
  const element = el("main", "", "fui-page", doc);
  element.append(header.element, ...(options.content ?? []));
  return { element, header, back };
}

/** A line that says what went wrong on a sub page: read as an alert, set in the body face. */
export function createPageMessage(
  text: string,
  doc?: Document,
): HTMLParagraphElement {
  const message = el("p", text, "fui-page-message", doc);
  message.setAttribute("role", "alert");
  return message;
}

export interface BackOnEscapeOptions {
  /** False while Escape means something else (a song is playing, a key is being bound). Default: always. */
  enabled?: () => boolean;
  document?: Document;
}

/**
 * Escape presses `back`, as it closes a dialog. Not while a dialog is open (Escape is that dialog's), not while
 * Back is hidden or disabled, and not for a key something else already used. Returns what removes the listener.
 */
export function backOnEscape(
  back: HTMLElement,
  options: BackOnEscapeOptions = {},
): () => void {
  const doc = options.document ?? back.ownerDocument;
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (!back.isConnected || back.closest("[hidden]")) return;
    if (back.hasAttribute("disabled")) return;
    if (doc.querySelector("dialog[open]")) return;
    if (options.enabled && !options.enabled()) return;
    event.preventDefault();
    back.click();
  };
  doc.addEventListener("keydown", onKey);
  return () => doc.removeEventListener("keydown", onKey);
}

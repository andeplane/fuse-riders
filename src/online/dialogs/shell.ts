import { node } from "../dom.js";

export interface DialogShellOptions {
  /** The bar's heading. */
  title: string;
  /** The dialog's accessible name. */
  label: string;
  /** Classes besides `game-dialog` (the results use `recap-dialog`). */
  variant?: string;
  /** The CLOSE button's text; its accessible name is always CLOSE. */
  closeText?: string;
  /** The CLOSE button's class: the room's dialogs use `dialog-close`, the landing page's SETTINGS none. */
  closeClass?: string;
  document?: Document;
}

/** A game dialog's parts. `actions` holds CLOSE; a dialog adds its own buttons before it. */
export interface DialogShell {
  dialog: HTMLDialogElement;
  bar: HTMLElement;
  title: HTMLElement;
  actions: HTMLElement;
  close: HTMLButtonElement;
  body: HTMLElement;
}

/** Whether a click at (x, y) landed outside the dialog's box, on its backdrop. */
export function outside(
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  x: number,
  y: number,
): boolean {
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
}

/**
 * The markup every game dialog shares: `dialog.game-dialog` > `header.dialog-bar` (title, actions with CLOSE) and
 * `div.dialog-body`. CLOSE, Escape and a click on the backdrop close it; which dialog is open is the registry's.
 */
export function createDialogShell(options: DialogShellOptions): DialogShell {
  const doc = options.document ?? document;
  const dialog = node(
    "dialog",
    "",
    options.variant ? `game-dialog ${options.variant}` : "game-dialog",
    doc,
  );
  dialog.setAttribute("aria-label", options.label);
  const close = node(
    "button",
    options.closeText ?? "✕  CLOSE",
    options.closeClass ?? "dialog-close",
    doc,
  );
  close.type = "button";
  close.setAttribute("aria-label", "CLOSE");
  close.onclick = () => dialog.close();
  const actions = node("span", "", "dialog-actions", doc);
  actions.append(close);
  const bar = node("header", "", "dialog-bar", doc),
    title = node("strong", options.title, "", doc);
  bar.append(title, actions);
  const body = node("div", "", "dialog-body", doc);
  dialog.append(bar, body);
  dialog.addEventListener("click", (event) => {
    if (
      event.target === dialog &&
      outside(dialog.getBoundingClientRect(), event.clientX, event.clientY)
    )
      dialog.close();
  });
  return { dialog, bar, title, actions, close, body };
}

import { el, partClass, type PartClasses } from "./dom.js";

export type DialogPart =
  "root" | "bar" | "title" | "actions" | "close" | "body";

const DIALOG_CLASSES: Record<DialogPart, string> = {
  root: "fui-dialog",
  bar: "fui-dialog-bar",
  title: "fui-dialog-title",
  actions: "fui-dialog-actions",
  close: "fui-dialog-close",
  body: "fui-dialog-body",
};

export interface DialogOptions {
  /** The bar's heading. */
  title: string;
  /** The accessible name; defaults to the title. */
  label?: string;
  /** The close button's text. */
  closeText?: string;
  /** Close when a click lands on the backdrop outside the dialog box. Default true. */
  closeOnBackdrop?: boolean;
  classes?: PartClasses<DialogPart>;
  document?: Document;
}

export interface DialogShell {
  dialog: HTMLDialogElement;
  bar: HTMLElement;
  title: HTMLElement;
  /** Right of the title: the close button, and anything a game adds before it. */
  actions: HTMLElement;
  close: HTMLButtonElement;
  /** Where the game puts the dialog's content. */
  body: HTMLElement;
  /**
   * Show one view in the shell: set the title and accessible name, replace the body with `content`, and open the
   * dialog if it is not open yet. One dialog can serve several menus this way; on close the title and name go back to
   * the ones the shell was created with.
   */
  show(view: DialogView): void;
}

export interface DialogView {
  title: string;
  /** The accessible name; defaults to the title. */
  label?: string;
  /** Replaces the body. Omit to keep what the body holds (a game that fills it itself). */
  content?: readonly Node[];
}

/**
 * A modal `<dialog>` with a title bar, an actions slot with CLOSE, and a body. The game fills the body and calls
 * `dialog.showModal()`; Escape and CLOSE both close it, and a click on the backdrop does too unless turned off.
 */
export function createDialog(options: DialogOptions): DialogShell {
  const doc = options.document ?? document;
  const c = (part: DialogPart) =>
    partClass(DIALOG_CLASSES, options.classes, part);
  const dialog = el("dialog", "", c("root"), doc);
  dialog.setAttribute("aria-label", options.label ?? options.title);
  const bar = el("header", "", c("bar"), doc),
    title = el("strong", options.title, c("title"), doc),
    actions = el("span", "", c("actions"), doc),
    close = el("button", options.closeText ?? "✕  CLOSE", c("close"), doc);
  close.type = "button";
  close.setAttribute("aria-label", "CLOSE");
  close.onclick = () => dialog.close();
  actions.append(close);
  bar.append(title, actions);
  const body = el("div", "", c("body"), doc);
  dialog.append(bar, body);
  if (options.closeOnBackdrop ?? true) closeOnBackdrop(dialog);
  const label = options.label ?? options.title;
  dialog.addEventListener("close", () => {
    title.textContent = options.title;
    dialog.setAttribute("aria-label", label);
  });
  return {
    dialog,
    bar,
    title,
    actions,
    close,
    body,
    show(view) {
      title.textContent = view.title;
      dialog.setAttribute("aria-label", view.label ?? view.title);
      if (view.content) body.replaceChildren(...view.content);
      if (!dialog.open) dialog.showModal();
    },
  };
}

/**
 * A modal dialog's backdrop is the dialog element itself, so a click whose target is the dialog and whose point
 * lies outside its box landed on the backdrop.
 */
export function closeOnBackdrop(dialog: HTMLDialogElement): void {
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      dialog.close();
  });
}

import { createDialog, type DialogShell } from "fuse-ui";

/** Fuse Riders' dialog classes: fuse-ui's (components.css) plus the game's own, which online.css adds to. */
export const FUSE_DIALOG_CLASSES = {
  root: "fui-dialog game-dialog",
  bar: "fui-dialog-bar dialog-bar",
  title: "fui-dialog-title",
  actions: "fui-dialog-actions dialog-actions",
  close: "",
  body: "fui-dialog-body dialog-body",
} as const;

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
export type GameDialogShell = Omit<DialogShell, "show">;

/**
 * One game dialog on fuse-ui's shell: `dialog.game-dialog` > `header.dialog-bar` (title, actions with CLOSE) and
 * `div.dialog-body`. CLOSE, Escape and a click on the backdrop close it. Each dialog keeps its own title; which
 * dialog is open is the registry's.
 */
export function createDialogShell(
  options: DialogShellOptions,
): GameDialogShell {
  const { dialog, bar, title, actions, close, body } = createDialog({
    title: options.title,
    label: options.label,
    ...(options.closeText ? { closeText: options.closeText } : {}),
    classes: {
      ...FUSE_DIALOG_CLASSES,
      root: options.variant
        ? `${FUSE_DIALOG_CLASSES.root} ${options.variant}`
        : FUSE_DIALOG_CLASSES.root,
      close: options.closeClass ?? "dialog-close",
    },
    ...(options.document ? { document: options.document } : {}),
  });
  return { dialog, bar, title, actions, close, body };
}

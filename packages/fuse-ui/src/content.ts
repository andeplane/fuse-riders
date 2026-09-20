import { button, el, partClass, type PartClasses } from "./dom.js";

export interface KeyGroup {
  title: string;
  /** `[keys, what they do]`, in reading order. */
  entries: readonly (readonly [string, string])[];
}

export type KeyListPart = "group" | "list";

const KEY_LIST_CLASSES: Record<KeyListPart, string> = {
  group: "fui-key-group",
  list: "fui-key-list",
};

/** Keyboard shortcuts as headed definition lists: a `<h3>` per group, then `<dt>` keys and `<dd>` actions. */
export function createKeyList(
  groups: readonly KeyGroup[],
  options: { classes?: PartClasses<KeyListPart>; document?: Document } = {},
): HTMLElement[] {
  const doc = options.document ?? document;
  const c = (part: KeyListPart) =>
    partClass(KEY_LIST_CLASSES, options.classes, part);
  return groups.flatMap((group) => {
    const list = el("dl", "", c("list"), doc);
    for (const [keys, action] of group.entries)
      list.append(el("dt", keys, "", doc), el("dd", action, "", doc));
    return [el("h3", group.title, c("group"), doc), list];
  });
}

export type ConfirmPart = "question" | "choices" | "confirm" | "cancel";

const CONFIRM_CLASSES: Record<ConfirmPart, string> = {
  question: "fui-confirm-question",
  choices: "fui-confirm",
  confirm: "fui-confirm-yes",
  cancel: "fui-confirm-no",
};

export interface ConfirmOptions {
  question: string;
  confirmText: string;
  cancelText: string;
  /** The confirm button was pressed. It may be async; the game disables the buttons if it must. */
  onConfirm(): void | Promise<void>;
  onCancel(): void;
  classes?: PartClasses<ConfirmPart>;
  document?: Document;
}

export interface Confirm {
  question: HTMLElement;
  /** The row of buttons: cancel first, then confirm. */
  choices: HTMLElement;
  confirm: HTMLButtonElement;
  cancel: HTMLButtonElement;
}

/** A yes/no question for a dialog body, such as "Leave this room?" with STAY and LEAVE ROOM. */
export function createConfirm(options: ConfirmOptions): Confirm {
  const doc = options.document ?? document;
  const c = (part: ConfirmPart) =>
    partClass(CONFIRM_CLASSES, options.classes, part);
  const question = el("p", options.question, c("question"), doc),
    confirm = button(options.confirmText, c("confirm"), doc),
    cancel = button(options.cancelText, c("cancel"), doc),
    choices = el("div", "", c("choices"), doc);
  cancel.onclick = () => options.onCancel();
  choices.append(cancel, confirm);
  confirm.onclick = () => void options.onConfirm();
  return { question, choices, confirm, cancel };
}

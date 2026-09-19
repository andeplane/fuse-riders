import { el, partClass, type PartClasses } from "./dom.js";

export type PickerPart = "root" | "options" | "option" | "summary" | "change";

const PICKER_CLASSES: Record<PickerPart, string> = {
  root: "fui-picker",
  options: "fui-picker-options",
  option: "fui-picker-option",
  summary: "fui-picker-summary",
  change: "fui-picker-change",
};

export interface PickerChoice<Id extends string> {
  id: Id;
  /** The option's text and its accessible name. */
  label: string;
}

export interface PickerOptions<Id extends string> {
  /** The fieldset's legend. */
  legend: string;
  choices: readonly PickerChoice<Id>[];
  selected: Id;
  /** The option's picture, drawn before its label (an avatar, a colour swatch). Omit for text-only options. */
  art?: (id: Id) => HTMLElement;
  /** A player picked an option (also when it was already selected). `sync` does not call it. */
  onPick?: (id: Id) => void;
  /** The `data-*` key that carries each option's id, e.g. `"avatarId"` for `data-avatar-id`. Default `"choice"`. */
  dataKey?: string;
  /**
   * Fold the options away behind one button that shows the current choice and a CHANGE label. The button toggles the
   * options; a pick folds them again and returns focus to the button.
   */
  fold?: {
    /** What the button shows before CHANGE for the current choice. */
    summary(id: Id): Node[];
    /** The button's accessible name for the current choice. */
    label(id: Id): string;
    changeText?: string;
    /** The options' element id, for `aria-controls`. Default: a generated one. */
    id?: string;
  };
  classes?: PartClasses<PickerPart>;
  document?: Document;
}

export interface Picker<Id extends string> {
  /** The `<fieldset>` of options. */
  element: HTMLFieldSetElement;
  buttons: HTMLButtonElement[];
  /** The folded summary button, when `fold` was given. */
  summary: HTMLButtonElement | undefined;
  selected(): Id;
  /** Select `id` without calling `onPick`, e.g. when another control chose it. */
  sync(id: Id): void;
  /** Open or close the folded options. */
  unfold(open: boolean): void;
}

let generated = 0;

/**
 * One choice out of a few, as pressed/unpressed buttons in a fieldset (avatars, colours, styles). Optionally folded
 * behind a summary button, so a long grid does not crowd a small form.
 */
export function createPicker<Id extends string>(
  options: PickerOptions<Id>,
): Picker<Id> {
  const doc = options.document ?? document;
  const c = (part: PickerPart) =>
    partClass(PICKER_CLASSES, options.classes, part);
  let selected = options.selected;
  const element = el("fieldset", "", c("root"), doc);
  element.append(el("legend", options.legend, "", doc));
  const list = el("div", "", c("options"), doc);
  element.append(list);
  const dataKey = options.dataKey ?? "choice";
  const paint = () =>
    buttons.forEach((button, index) =>
      button.setAttribute(
        "aria-pressed",
        String(options.choices[index]!.id === selected),
      ),
    );
  const buttons = options.choices.map((choice) => {
    const button = el("button", "", c("option"), doc);
    button.type = "button";
    button.setAttribute("aria-label", choice.label);
    button.setAttribute("aria-pressed", String(choice.id === selected));
    button.dataset[dataKey] = choice.id;
    if (options.art) button.append(options.art(choice.id));
    button.append(el("span", choice.label, "", doc));
    list.append(button);
    button.addEventListener("click", () => {
      selected = choice.id;
      paint();
      options.onPick?.(selected);
      if (summary) {
        showSummary();
        unfold(false);
        summary.focus();
      }
    });
    return button;
  });
  let summary: HTMLButtonElement | undefined;
  const fold = options.fold;
  const showSummary = () => {
    if (!fold || !summary) return;
    summary.replaceChildren(
      ...fold.summary(selected),
      el("span", fold.changeText ?? "CHANGE", c("change"), doc),
    );
    summary.setAttribute("aria-label", fold.label(selected));
  };
  const unfold = (open: boolean) => {
    if (!summary) return;
    element.hidden = !open;
    summary.setAttribute("aria-expanded", String(open));
  };
  if (fold) {
    summary = el("button", "", c("summary"), doc);
    summary.type = "button";
    element.id = fold.id ?? `fui-picker-${++generated}`;
    summary.setAttribute("aria-controls", element.id);
    summary.onclick = () => unfold(element.hidden);
    showSummary();
    unfold(false);
  }
  return {
    element,
    buttons,
    summary,
    selected: () => selected,
    sync(id) {
      if (selected === id) return;
      selected = id;
      paint();
      showSummary();
    },
    unfold,
  };
}

import { el, partClass, type PartClasses } from "./dom.js";

export type NameEntryPart =
  "root" | "input" | "submit" | "secondary" | "note" | "hint";

const NAME_ENTRY_CLASSES: Record<NameEntryPart, string> = {
  root: "fui-name-entry",
  input: "fui-name-input",
  submit: "fui-button",
  secondary: "fui-name-secondary",
  note: "fui-name-note",
  hint: "fui-name-hint",
};

export interface NameEntryOptions {
  /**
   * The name the room would seat for what was typed, or `""` if nothing seatable is left. A game passes its own
   * rule (trim, length, allowed characters); the field then shows exactly the name that joins.
   */
  normalize(raw: string): string;
  /** Called on every valid submit; two quick taps call it twice, so a game whose join is not idempotent guards it. */
  onSubmit(name: string): void;
  /** A remembered name to prefill. It never submits by itself. */
  initial?: string;
  /** Called on every edit with the trimmed text, e.g. to remember it. */
  onInput?: (value: string) => void;
  /**
   * A second, quieter way in under the submit button (e.g. JOIN AS SPECTATOR). It is a plain button, never the
   * form's submit, so Enter still takes the first way; it checks the name the same way.
   */
  secondary?: { text: string; title?: string; onSubmit(name: string): void };
  /** Shown under the buttons once `fix` locks the name, saying where it is changed (e.g. an account name). */
  note?: { text: string; id?: string };
  /** Anything the game adds under the hint, such as an avatar picker. */
  extra?: readonly Node[];
  /** Start with the buttons disabled, e.g. until the room is reachable; `setDisabled(false)` enables them. */
  disabled?: boolean;
  maxLength?: number;
  placeholder?: string;
  buttonText?: string;
  missingText?: string;
  classes?: PartClasses<NameEntryPart>;
  document?: Document;
}

export interface NameEntry {
  form: HTMLFormElement;
  input: HTMLInputElement;
  submit: HTMLButtonElement;
  /** The second way in, when `secondary` was given. */
  secondary: HTMLButtonElement | undefined;
  /** The note `fix` reveals, when `note` was given. */
  note: HTMLElement | undefined;
  /** The `role="alert"` line shown when JOIN is pressed without a name. */
  hint: HTMLElement;
  /**
   * The name that would be seated now, written back into the field; `undefined` shows the hint and focuses the field.
   * Both buttons go through it.
   */
  confirm(): string | undefined;
  /** Lock the field to `name` (read-only) and show the note. Can be called late, while the form is up. */
  fix(name: string): void;
  /** Whether the name is locked by `fix`. */
  fixed(): boolean;
  setDisabled(disabled: boolean): void;
}

/** Name field and JOIN. An empty name says what is missing instead of doing nothing. */
export function createNameEntry(options: NameEntryOptions): NameEntry {
  const doc = options.document ?? document;
  const c = (part: NameEntryPart) =>
    partClass(NAME_ENTRY_CLASSES, options.classes, part);
  const form = el("form", "", c("root"), doc),
    input = el("input", "", c("input"), doc),
    submit = el("button", options.buttonText ?? "JOIN", c("submit"), doc),
    hint = el(
      "p",
      options.missingText ?? "Enter your name to join",
      c("hint"),
      doc,
    );
  const placeholder = options.placeholder ?? "Your name";
  input.placeholder = placeholder;
  input.maxLength = options.maxLength ?? 20;
  input.setAttribute("aria-required", "true");
  input.setAttribute("autocomplete", "nickname");
  input.setAttribute("aria-label", placeholder);
  input.value = options.initial ?? "";
  submit.type = "submit";
  hint.setAttribute("role", "alert");
  hint.hidden = true;
  let secondary: HTMLButtonElement | undefined;
  if (options.secondary) {
    const spec = options.secondary;
    secondary = el("button", spec.text, c("secondary"), doc);
    secondary.type = "button";
    if (spec.title) secondary.title = spec.title;
    secondary.onclick = () => {
      const value = confirm();
      if (value) spec.onSubmit(value);
    };
  }
  let note: HTMLElement | undefined;
  if (options.note) {
    note = el("p", "", c("note"), doc);
    if (options.note.id) note.id = options.note.id;
    note.hidden = true;
    note.textContent = options.note.text;
  }
  let locked = false;
  const setDisabled = (disabled: boolean) => {
    submit.disabled = disabled;
    if (secondary) secondary.disabled = disabled;
  };
  if (options.disabled) setDisabled(true);
  const confirm = (): string | undefined => {
    const value = options.normalize(input.value);
    if (!value) {
      hint.hidden = false;
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return undefined;
    }
    input.value = value;
    return value;
  };
  input.addEventListener("input", () => {
    hint.hidden = true;
    input.removeAttribute("aria-invalid");
    options.onInput?.(input.value.trim());
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = confirm();
    if (value) options.onSubmit(value);
  });
  form.append(input, submit);
  if (secondary) form.append(secondary);
  if (note) form.append(note);
  form.append(hint, ...(options.extra ?? []));
  return {
    form,
    input,
    submit,
    secondary,
    note,
    hint,
    confirm,
    fix(name) {
      locked = true;
      input.value = name;
      input.readOnly = true;
      if (note) {
        if (note.id) input.setAttribute("aria-describedby", note.id);
        note.hidden = false;
      }
      hint.hidden = true;
      input.removeAttribute("aria-invalid");
    },
    fixed: () => locked,
    setDisabled,
  };
}

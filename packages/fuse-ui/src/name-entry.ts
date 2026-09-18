import { el } from "./dom.js";

export interface NameEntryOptions {
  /**
   * The name the room would seat for what was typed, or `""` if nothing seatable is left. A game passes its own
   * rule (trim, length, allowed characters); the field then shows exactly the name that joins.
   */
  normalize(raw: string): string;
  onSubmit(name: string): void;
  /** A remembered name to prefill. It never submits by itself. */
  initial?: string;
  /** Called on every edit with the trimmed text, e.g. to remember it. */
  onInput?: (value: string) => void;
  maxLength?: number;
  placeholder?: string;
  buttonText?: string;
  missingText?: string;
  document?: Document;
}

export interface NameEntry {
  form: HTMLFormElement;
  input: HTMLInputElement;
  submit: HTMLButtonElement;
  /** The `role="alert"` line shown when JOIN is pressed without a name. */
  hint: HTMLElement;
}

/** Name field and JOIN. An empty name says what is missing instead of doing nothing. */
export function createNameEntry(options: NameEntryOptions): NameEntry {
  const doc = options.document ?? document;
  const form = el("form", "", "fui-name-entry", doc),
    input = el("input", "", "fui-name-input", doc),
    submit = el("button", options.buttonText ?? "JOIN", "fui-button", doc),
    hint = el(
      "p",
      options.missingText ?? "Enter your name to join",
      "fui-name-hint",
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
  input.addEventListener("input", () => {
    hint.hidden = true;
    input.removeAttribute("aria-invalid");
    options.onInput?.(input.value.trim());
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = options.normalize(input.value);
    if (!value) {
      hint.hidden = false;
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    input.value = value;
    options.onSubmit(value);
  });
  form.append(input, submit, hint);
  return { form, input, submit, hint };
}

/**
 * The one element factory for every game's DOM (#255 P2 found four with different argument orders).
 *
 * Text goes in through `textContent` only, so a player's name is always text and never markup. The document is a
 * parameter so tests can pass a `linkedom` document instead of touching globals.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
  doc: Document = document,
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

/** `el` bound to one document, for modules that build a whole view against an injected document. */
export function elementsFor(doc: Document) {
  return <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text = "",
    className = "",
  ): HTMLElementTagNameMap[K] => el(tag, text, className, doc);
}

/** A `<button type="button">`: a plain button never submits the form it happens to sit in. */
export function button(
  text: string,
  className = "",
  doc: Document = document,
): HTMLButtonElement {
  const result = el("button", text, className, doc);
  result.type = "button";
  return result;
}

/** What `copyText` needs from the page. The browser's own objects satisfy it. */
export interface ClipboardHost {
  clipboard?: { writeText?(text: string): Promise<void> } | undefined;
  document: Document;
}

/**
 * Clipboard write with an execCommand fallback. `navigator.clipboard` is secure-context only, so on an insecure
 * origin it is undefined rather than throwing: only a write that actually ran reports success.
 */
export async function copyText(
  text: string,
  host: ClipboardHost = { clipboard: navigator.clipboard, document },
): Promise<boolean> {
  const clipboard = host.clipboard;
  if (typeof clipboard?.writeText === "function") {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      /* Fall through to the legacy path below. */
    }
  }
  const doc = host.document;
  const field = doc.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;top:-1000px;opacity:0";
  doc.body.append(field);
  field.select();
  try {
    return doc.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

/** Part names a component builds, mapped to class names. `""` leaves a part without a class. */
export type PartClasses<Part extends string> = Partial<Record<Part, string>>;

/** The class for `part`: the caller's override if it gave one, the component's default otherwise. */
export function partClass<Part extends string>(
  defaults: Record<Part, string>,
  overrides: PartClasses<Part> | undefined,
  part: Part,
): string {
  return overrides?.[part] ?? defaults[part];
}

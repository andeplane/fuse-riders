/**
 * The room UI's element factory. Text goes in through `textContent` only, and the class attribute is always written
 * (an empty `className` still leaves `class=""`), so markup built here matches what `ui.ts` built inline before.
 * Pass `doc` to build outside the page (the unit tests pass linkedom's document).
 */
export function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
  doc: Document = document,
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
}

/**
 * Writes `target[key] = value` only when it differs. The room page writes its whole view every frame; assigning a
 * reflected property (`hidden`, `title`, `disabled`, `textContent`, a `dataset` entry) with the value it already has
 * still mutates the DOM, and that was about 55 DOM mutations per frame (#350's review).
 */
export function setIfChanged<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K],
): void {
  if (target[key] !== value) target[key] = value;
}

/** `setAttribute` only when the attribute holds something else (or nothing). */
export function setAttributeIfChanged(
  element: Pick<Element, "getAttribute" | "setAttribute">,
  name: string,
  value: string,
): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

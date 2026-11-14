/** The fields of a `KeyboardEvent` the Blue Screen looks at; a real event satisfies it. */
export type BsodKeyEvent = {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly repeat: boolean;
};

/**
 * Ctrl+Alt+Delete, or Ctrl+Alt+Backspace. Windows keeps the real three-finger salute for
 * itself and never delivers it to a page, and a Mac laptop has no Delete key (its "delete" is
 * Backspace), so both count. Cmd is deliberately not Ctrl here: Cmd+Option+Backspace belongs
 * to the browser.
 */
export function isBsodChord(event: BsodKeyEvent): boolean {
  return (
    event.ctrlKey &&
    event.altKey &&
    !event.repeat &&
    (event.key === "Delete" || event.key === "Backspace")
  );
}

const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  "Control",
  "Alt",
  "AltGraph",
  "Shift",
  "Meta",
  "OS",
  "CapsLock",
]);

/**
 * "Any key", as far as leaving the screen goes: not a modifier on its own and not an
 * auto-repeat, so the chord that raised the screen (still held down) cannot also dismiss it.
 */
export function isDismissKey(event: BsodKeyEvent): boolean {
  return !event.repeat && !MODIFIER_KEYS.has(event.key);
}

/** The longest name a rider may carry, in code points; the arena's labels are laid out for it. */
export const MAX_RIDER_NAME = 18;

/**
 * One rule for every place a name is accepted or stored: a room seat, a reported match, an account's username. A name
 * valid in one is valid in all. Already trimmed, no control characters, no half surrogate pairs.
 */
export function validRiderName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    Array.from(value).length <= MAX_RIDER_NAME &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !/\p{Cs}/u.test(value)
  );
}

/** A starting point for a username from free text (a Google display name): the first word that fits, or nothing. */
export function suggestRiderName(text: string): string {
  const cleaned = text
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/\p{Cs}/gu, "")
      .trim(),
    first = cleaned.split(/\s+/)[0] ?? "";
  return Array.from(first).slice(0, MAX_RIDER_NAME).join("");
}

/**
 * Rider names: the one guard, the one normaliser, and the bound the log holds a name to. Every place a name is
 * accepted, seated, folded or stored reads it from here (#253 A3; they used to be four rules that disagreed).
 *
 * It lives in the engine because the log's validation (`input-log.ts`) and the checkpoint guard are engine code; the
 * service, the account panel and the room runtime import it from here.
 */

/** The longest name a rider may carry, in code points; the arena's labels are laid out for it. */
export const MAX_RIDER_NAME = 18;
/**
 * The longest name a log entry or a checkpoint may carry, in UTF-16 units. It is older than `MAX_RIDER_NAME` and
 * counts differently, so it admits names the guard refuses (19 or 20 letters, half a surrogate pair) and refuses some
 * the guard admits (eleven emoji). Replicas on one `RULES` must accept exactly the same entries, so it stays as it is
 * until a rules bump can replace `loggedRiderName` with `validRiderName`; until then `seatRiderName` keeps every new
 * seat inside both.
 */
export const MAX_LOGGED_NAME_UNITS = 20;

const CONTROL = /[\u0000-\u001f\u007f]/;
const CONTROLS = /[\u0000-\u001f\u007f]/g;
const LONE_SURROGATE = /\p{Cs}/u;
const LONE_SURROGATES = /\p{Cs}/gu;

/**
 * The guard. One rule for every place a name is accepted or stored: a room seat, a reported match, an account's
 * username. A name valid in one is valid in all. Already trimmed, no control characters, no half surrogate pairs.
 */
export function validRiderName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    Array.from(value).length <= MAX_RIDER_NAME &&
    !CONTROL.test(value) &&
    !LONE_SURROGATE.test(value)
  );
}

/** What a message may carry as a name: a valid rider name, padding allowed around it, no control character anywhere. Returns it trimmed. */
export function trimmedRiderName(raw: unknown): string | undefined {
  if (typeof raw !== "string" || CONTROL.test(raw)) return;
  const name = raw.trim();
  return validRiderName(name) ? name : undefined;
}

/**
 * The normaliser: the name a rider is seated under, from whatever they typed or a peer sent. Trimmed; cut to what
 * both the guard and the log allow, by code point, so a surrogate pair is never split and a cut emoji sequence does
 * not end on its joiner; half pairs dropped. A control character inside the name refuses it, as it always has, rather
 * than being repaired. The result is a `validRiderName` that `loggedRiderName` accepts, or nothing.
 */
export function seatRiderName(raw: string): string | undefined {
  const cleaned = raw.replace(LONE_SURROGATES, "").trim();
  if (CONTROL.test(cleaned)) return;
  let name = "",
    points = 0;
  for (const point of cleaned) {
    if (
      points === MAX_RIDER_NAME ||
      name.length + point.length > MAX_LOGGED_NAME_UNITS
    )
      break;
    name += point;
    points += 1;
  }
  // A cut can land inside a joined emoji sequence, or on the space before a word: neither is left dangling.
  name = name.replace(/[\s\u200d]+$/u, "");
  return name || undefined;
}

/**
 * What a replica accepts as a name in a log entry (JOIN, BOT) and in a checkpoint. Deliberately the rule the log has
 * always had, character for character: see `MAX_LOGGED_NAME_UNITS`. `seatRiderName` is what writes names into the
 * log, so a room of current clients only ever sees valid rider names here.
 */
export function loggedRiderName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_LOGGED_NAME_UNITS &&
    !CONTROL.test(value)
  );
}

/** A starting point for a username from free text (a Google display name): the first word that fits, or nothing. */
export function suggestRiderName(text: string): string {
  const cleaned = text
      .replace(CONTROLS, "")
      .replace(LONE_SURROGATES, "")
      .trim(),
    first = cleaned.split(/\s+/)[0] ?? "";
  return Array.from(first).slice(0, MAX_RIDER_NAME).join("");
}
